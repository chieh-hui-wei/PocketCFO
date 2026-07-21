from datetime import datetime, timedelta
import secrets
from fastapi import APIRouter, Depends, HTTPException, status, Request
from pydantic import BaseModel, EmailStr
from jose import jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
import bcrypt

from src.instances.config import get_settings
from src.instances.database import get_db
from src.dbs.models import User, UserInvitation, PasswordReset
from src.middleware.auth import verify_token
from src.services.email_service import send_verification_email, send_reset_password_email

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()

class LoginRequest(BaseModel):
    email: str
    password: str

class InviteRequest(BaseModel):
    email: EmailStr

class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    pin_code: str

# In-memory dictionary to track login attempts: IP -> list of timestamps
login_attempts: dict[str, list[float]] = {}

@router.post("/login")
async def login(
    request: Request,
    body: LoginRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Authenticate user using email and password, returning a JWT token.
    """
    import time
    client_ip = request.client.host if request.client else "unknown"
    
    # Clean up old attempts for the current IP
    now = time.time()
    if client_ip in login_attempts:
        login_attempts[client_ip] = [t for t in login_attempts[client_ip] if now - t < 60]
        
    # Prevent memory leaks: if dictionary size exceeds 2000 records, prune expired ones globally
    if len(login_attempts) > 2000:
        expired_ips = [ip for ip, ts in login_attempts.items() if not ts or all(now - t >= 60 for t in ts)]
        for ip in expired_ips:
            login_attempts.pop(ip, None)
        # If still over 2000 (extreme load), clear all to prevent crash
        if len(login_attempts) > 2000:
            login_attempts.clear()

    # Check limit (max 5 attempts per minute)
    attempts = login_attempts.get(client_ip, [])
    if len(attempts) >= 5:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="登入嘗試次數過多，請於一分鐘後再試。"
        )
        
    # Record current attempt
    login_attempts.setdefault(client_ip, []).append(now)

    stmt = select(User).where(User.email == body.email.strip().lower())
    res = await db.execute(stmt)
    user = res.scalar_one_or_none()
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="帳號或密碼錯誤"
        )
        
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="此帳戶已被停用"
        )
        
    # Verify password hash
    if not bcrypt.checkpw(body.password.encode('utf-8'), user.hashed_password.encode('utf-8')):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="帳號或密碼錯誤"
        )
        
    # Generate token (expires in 24 hours)
    expiration = datetime.utcnow() + timedelta(hours=24)
    payload = {
        "sub": str(user.id),
        "exp": expiration
    }
    token = jwt.encode(payload, settings.app_secret_key, algorithm="HS256")
    
    return {
        "status": "success",
        "token": token,
        "expires_at": expiration.isoformat(),
        "user": {
            "id": user.id,
            "email": user.email,
            "role": user.role
        }
    }

@router.post("/invite")
async def invite_friend(
    body: InviteRequest, 
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(verify_token)
):
    """
    Admin only: Generate a registration verification PIN and send an email invitation.
    """
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="只有管理員可以邀請新使用者"
        )
        
    email_clean = body.email.strip().lower()
    
    # Check if user already exists
    stmt_user = select(User).where(User.email == email_clean)
    res_user = await db.execute(stmt_user)
    if res_user.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="此信箱已註冊帳戶"
        )
        
    # Generate 6-digit PIN code
    pin_code = f"{secrets.randbelow(1000000):06d}"
    expiry = datetime.utcnow() + timedelta(minutes=30)
    
    # Check if invitation already exists to update it
    stmt_inv = select(UserInvitation).where(UserInvitation.email == email_clean)
    res_inv = await db.execute(stmt_inv)
    invitation = res_inv.scalar_one_or_none()
    
    if invitation:
        invitation.pin_code = pin_code
        invitation.expires_at = expiry
        invitation.is_verified = False
    else:
        invitation = UserInvitation(
            email=email_clean,
            pin_code=pin_code,
            expires_at=expiry,
            is_verified=False
        )
        db.add(invitation)
        
    await db.commit()
    
    # Send email asynchronously (runs inside to_thread in service)
    await send_verification_email(email_clean, pin_code)
    
    return {
        "status": "success",
        "message": f"邀請驗證信已寄送至 {email_clean}"
    }

@router.post("/register")
async def register(body: RegisterRequest, db: AsyncSession = Depends(get_db)):
    """
    Verify the invitation PIN code, hash the password, and create the User account.
    """
    email_clean = body.email.strip().lower()
    
    # Fetch latest invitation
    stmt = select(UserInvitation).where(
        UserInvitation.email == email_clean,
        UserInvitation.is_verified == False
    )
    res = await db.execute(stmt)
    invitation = res.scalar_one_or_none()
    
    if not invitation:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="無此信箱的有效邀請記錄"
        )
        
    if invitation.pin_code != body.pin_code.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="驗證碼錯誤，請重新輸入"
        )
        
    if invitation.expires_at < datetime.utcnow():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="驗證碼已過期，請管理員重新邀請"
        )
        
    # Check if user already exists (backup check)
    stmt_user = select(User).where(User.email == email_clean)
    res_user = await db.execute(stmt_user)
    if res_user.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="此信箱已註冊帳戶"
        )
        
    # Hash password and create User
    hashed = bcrypt.hashpw(body.password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
    user = User(
        email=email_clean,
        hashed_password=hashed,
        role="user",
        is_active=True
    )
    db.add(user)
    
    # Mark invitation as verified
    invitation.is_verified = True
    
    await db.commit()
    
    return {
        "status": "success",
        "message": "帳戶註冊成功，請使用新帳密登入"
    }

class ProfileUpdateRequest(BaseModel):
    email: EmailStr | None = None
    password: str | None = None

@router.put("/profile")
async def update_profile(
    body: ProfileUpdateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(verify_token)
):
    """
    Update active user's profile (email and/or password).
    """
    if not body.email and not body.password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="請提供欲修改的信箱或密碼"
        )
        
    if body.email:
        email_clean = body.email.strip().lower()
        if email_clean != current_user.email:
            # Check if email already taken
            stmt = select(User).where(User.email == email_clean)
            res = await db.execute(stmt)
            if res.scalar_one_or_none():
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="此信箱已被其他帳戶使用"
                )
            current_user.email = email_clean
            
    if body.password:
        password_clean = body.password.strip()
        if len(password_clean) < 6:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="密碼長度必須大於或等於 6 個字元"
            )
        hashed = bcrypt.hashpw(password_clean.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
        current_user.hashed_password = hashed
        
    await db.commit()
    
    return {
        "status": "success",
        "message": "個人帳戶設定更新成功",
        "user": {
            "id": current_user.id,
            "email": current_user.email,
            "role": current_user.role
        }
    }

class ForgotPasswordRequest(BaseModel):
    email: EmailStr

class ResetPasswordRequest(BaseModel):
    email: EmailStr
    pin_code: str
    new_password: str

@router.post("/forgot-password")
async def forgot_password(body: ForgotPasswordRequest, db: AsyncSession = Depends(get_db)):
    """
    Generate a 6-digit PIN code and send it to the user's email to reset password.
    """
    email_clean = body.email.strip().lower()
    
    # Check if user exists
    stmt_user = select(User).where(User.email == email_clean)
    res_user = await db.execute(stmt_user)
    user = res_user.scalar_one_or_none()
    
    # For security reasons, we do not want to expose whether the email exists or not.
    # We always return success, but only generate/send PIN if user exists.
    if user:
        pin_code = f"{secrets.randbelow(1000000):06d}"
        expiry = datetime.utcnow() + timedelta(minutes=15)
        
        # Invalidate previous unused resets for this email
        from sqlalchemy import update
        await db.execute(
            update(PasswordReset)
            .where(PasswordReset.email == email_clean, PasswordReset.is_used == False)
            .values(is_used=True)
        )
        
        # Create new reset token
        reset_token = PasswordReset(
            email=email_clean,
            pin_code=pin_code,
            expires_at=expiry,
            is_used=False
        )
        db.add(reset_token)
        await db.commit()
        
        # Dispatch email
        await send_reset_password_email(email_clean, pin_code)
        
    return {
        "status": "success",
        "message": "若此信箱已註冊，重設驗證碼已寄出"
    }

@router.post("/reset-password")
async def reset_password(body: ResetPasswordRequest, db: AsyncSession = Depends(get_db)):
    """
    Verify the PIN code and update the user's password.
    """
    email_clean = body.email.strip().lower()
    
    # Fetch active user
    stmt_user = select(User).where(User.email == email_clean)
    res_user = await db.execute(stmt_user)
    user = res_user.scalar_one_or_none()
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="無效的請求"
        )
        
    # Fetch latest unused reset request
    stmt_reset = (
        select(PasswordReset)
        .where(
            PasswordReset.email == email_clean,
            PasswordReset.pin_code == body.pin_code.strip(),
            PasswordReset.is_used == False
        )
        .order_by(PasswordReset.id.desc())
        .limit(1)
    )
    res_reset = await db.execute(stmt_reset)
    reset_req = res_reset.scalar_one_or_none()
    
    if not reset_req:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="驗證碼錯誤，請重新輸入"
        )
        
    if reset_req.expires_at < datetime.utcnow():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="驗證碼已過期，請重新申請"
        )
        
    # Validate new password length
    password_clean = body.new_password.strip()
    if len(password_clean) < 6:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="密碼長度必須大於或等於 6 個字元"
        )
        
    # Hash and save password
    hashed = bcrypt.hashpw(password_clean.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
    user.hashed_password = hashed
    reset_req.is_used = True
    
    await db.commit()
    
    return {
        "status": "success",
        "message": "密碼重設成功，請使用新密碼登入"
    }



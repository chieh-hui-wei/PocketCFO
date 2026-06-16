from datetime import datetime, timedelta, timezone
import secrets
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from jose import jwt
from src.instances.config import get_settings

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()

class LoginRequest(BaseModel):
    password: str

@router.post("/login")
async def login(body: LoginRequest):
    """
    Validate password and return a JWT access token valid for 7 days.
    """
    if not settings.app_password:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Server password is not configured."
        )
        
    if not secrets.compare_digest(body.password, settings.app_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="密碼錯誤，請重新輸入"
        )
        
    # Generate token
    expiration = datetime.now(timezone.utc) + timedelta(days=7)
    payload = {
        "sub": "user",
        "exp": expiration
    }
    token = jwt.encode(payload, settings.app_secret_key, algorithm="HS256")
    
    return {
        "status": "success",
        "token": token,
        "expires_at": expiration.isoformat()
    }

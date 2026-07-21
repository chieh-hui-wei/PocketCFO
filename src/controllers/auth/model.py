"""
src/controllers/auth/model.py
Pydantic schemas for authentication and user profile operations.
"""
from __future__ import annotations

from typing import Optional
from pydantic import BaseModel, EmailStr


class LoginRequest(BaseModel):
    email: str
    password: str


class InviteRequest(BaseModel):
    email: EmailStr


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    pin_code: str


class ProfileUpdateRequest(BaseModel):
    email: Optional[EmailStr] = None
    password: Optional[str] = None


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    email: EmailStr
    pin_code: str
    new_password: str

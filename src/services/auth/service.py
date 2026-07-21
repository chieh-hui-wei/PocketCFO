"""
src/services/auth/service.py
Service layer for Authentication, password hashing, and token handling.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
import bcrypt
from jose import jwt

from src.instances.config import get_settings

log = logging.getLogger(__name__)
settings = get_settings()


class AuthService:
    @staticmethod
    def hash_password(password: str) -> str:
        return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

    @staticmethod
    def verify_password(plain_password: str, hashed_password: str) -> bool:
        return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))

    @staticmethod
    def create_access_token(user_id: int, expires_hours: int = 24) -> tuple[str, datetime]:
        expiration = datetime.utcnow() + timedelta(hours=expires_hours)
        payload = {
            "sub": str(user_id),
            "exp": expiration
        }
        token = jwt.encode(payload, settings.app_secret_key, algorithm="HS256")
        return token, expiration

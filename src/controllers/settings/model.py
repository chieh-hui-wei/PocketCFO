"""
src/controllers/settings/model.py
Pydantic schemas for system settings and credentials management.
"""
from __future__ import annotations

from typing import Optional, Literal
from pydantic import BaseModel


class UpdateCredentialsRequest(BaseModel):
    # Gemini
    gemini_api_key: Optional[str] = None
    
    # E-Sun
    esun_account: Optional[str] = None
    esun_password: Optional[str] = None
    esun_cert_password: Optional[str] = None
    esun_api_key: Optional[str] = None
    esun_api_secret: Optional[str] = None
    
    # Taishin
    taishin_api_key: Optional[str] = None
    taishin_api_secret: Optional[str] = None
    taishin_account_id: Optional[str] = None
    taishin_cert_password: Optional[str] = None
    
    # Sinopac
    sinopac_api_key: Optional[str] = None
    sinopac_api_secret: Optional[str] = None
    sinopac_account_id: Optional[str] = None
    sinopac_cert_password: Optional[str] = None


class TestConnectionRequest(BaseModel):
    broker: Literal["taishin", "sinopac", "esun", "gemini"]

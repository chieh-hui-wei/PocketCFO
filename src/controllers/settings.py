"""
src/controllers/settings.py
Settings and credentials management endpoints.
"""
from __future__ import annotations

import os
from typing import Annotated
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from src.instances.config import get_settings

router = APIRouter(prefix="/settings", tags=["settings"])
settings = get_settings()

class UpdateCredentialsRequest(BaseModel):
    # Gemini
    gemini_api_key: str | None = None
    
    # E-Sun
    esun_account: str | None = None
    esun_password: str | None = None
    esun_cert_password: str | None = None
    esun_api_key: str | None = None
    esun_api_secret: str | None = None
    
    # Taishin
    taishin_api_key: str | None = None
    taishin_api_secret: str | None = None
    taishin_account_id: str | None = None
    taishin_cert_password: str | None = None
    
    # Sinopac
    sinopac_api_key: str | None = None
    sinopac_api_secret: str | None = None
    sinopac_account_id: str | None = None
    sinopac_cert_password: str | None = None


def update_env_variable(key: str, value: str):
    env_path = ".env"
    if not os.path.exists(env_path):
        with open(env_path, "w", encoding="utf-8") as f:
            f.write(f"{key}={value}\n")
        return
        
    with open(env_path, "r", encoding="utf-8") as f:
        lines = f.readlines()
        
    updated = False
    new_lines = []
    for line in lines:
        if line.strip().startswith(f"{key}="):
            new_lines.append(f"{key}={value}\n")
            updated = True
        else:
            new_lines.append(line)
            
    if not updated:
        new_lines.append(f"{key}={value}\n")
        
    with open(env_path, "w", encoding="utf-8") as f:
        f.writelines(new_lines)


def mask_value(val: str | None) -> str:
    if not val:
        return ""
    if len(val) <= 4:
        return "****"
    return f"{val[:2]}****{val[-2:]}"


@router.get("/")
async def get_current_settings():
    # Read E-Sun config details safely
    from configparser import ConfigParser
    esun_config_path = "secrets/config.ini"
    esun_acc = ""
    esun_key = ""
    has_esun_pass = False
    has_esun_cert_pass = False
    
    if os.path.exists(esun_config_path):
        try:
            config = ConfigParser()
            config.read(esun_config_path)
            esun_acc = config.get("User", "Account", fallback="")
            esun_key = config.get("Api", "Key", fallback="")
            has_esun_pass = bool(config.get("User", "Password", fallback=""))
            has_esun_cert_pass = bool(config.get("Cert", "Password", fallback=""))
        except Exception:
            pass

    # Check which cert files exist
    cert_statuses = {
        "taishin": os.path.exists("secrets/Taishin.pfx"),
        "sinopac": os.path.exists("secrets/Sinopac.pfx"),
        "esun": os.path.exists("secrets/esun_cert_20270611.p12")
    }

    return {
        "gemini_api_key": mask_value(settings.gemini_api_key),
        "gemini_model": settings.gemini_model,
        
        "esun_account": esun_acc,
        "esun_api_key": mask_value(esun_key),
        "has_esun_password": has_esun_pass,
        "has_esun_cert_password": has_esun_cert_pass,
        
        "taishin_account_id": settings.taishin_account_id,
        "taishin_api_key": mask_value(settings.taishin_api_key),
        "has_taishin_cert_password": bool(settings.taishin_cert_password),
        
        "sinopac_account_id": settings.sinopac_account_id,
        "sinopac_api_key": mask_value(settings.sinopac_api_key),
        "has_sinopac_cert_password": bool(settings.sinopac_cert_password),
        
        "cert_statuses": cert_statuses
    }


@router.post("/credentials")
async def save_credentials(body: UpdateCredentialsRequest):
    # 1. Update Gemini / Taishin / Sinopac in .env
    if body.gemini_api_key is not None:
        update_env_variable("GEMINI_API_KEY", body.gemini_api_key)
        
    if body.taishin_account_id is not None:
        update_env_variable("TAISHIN_ACCOUNT_ID", body.taishin_account_id)
    if body.taishin_api_key is not None:
        update_env_variable("TAISHIN_API_KEY", body.taishin_api_key)
    if body.taishin_api_secret is not None:
        update_env_variable("TAISHIN_API_SECRET", body.taishin_api_secret)
    if body.taishin_cert_password is not None:
        update_env_variable("TAISHIN_CERT_PASSWORD", body.taishin_cert_password)
        
    if body.sinopac_account_id is not None:
        update_env_variable("SINOPAC_ACCOUNT_ID", body.sinopac_account_id)
    if body.sinopac_api_key is not None:
        update_env_variable("SINOPAC_API_KEY", body.sinopac_api_key)
    if body.sinopac_api_secret is not None:
        update_env_variable("SINOPAC_API_SECRET", body.sinopac_api_secret)
    if body.sinopac_cert_password is not None:
        update_env_variable("SINOPAC_CERT_PASSWORD", body.sinopac_cert_password)

    # 2. Update E-Sun in config.ini
    esun_config_path = "secrets/config.ini"
    os.makedirs("secrets", exist_ok=True)
    
    from configparser import ConfigParser
    config = ConfigParser()
    if os.path.exists(esun_config_path):
        config.read(esun_config_path)
        
    # Ensure sections exist
    for sec in ["Core", "Cert", "Api", "User"]:
        if not config.has_section(sec):
            config.add_section(sec)
            
    # Default values for Core/Cert Path if not present
    if not config.get("Core", "Entry", fallback=""):
        config.set("Core", "Entry", "https://esuntradingapi.esunsec.com.tw/api/v1")
    if not config.get("Cert", "Path", fallback=""):
        config.set("Cert", "Path", "secrets/esun_cert_20270611.p12")

    # Update User Acc/Pass
    if body.esun_account is not None:
        config.set("User", "Account", body.esun_account)
    if body.esun_password is not None:
        config.set("User", "Password", body.esun_password)
        
    # Update Cert Pass
    if body.esun_cert_password is not None:
        config.set("Cert", "Password", body.esun_cert_password)
        
    # Update Api Key/Secret
    if body.esun_api_key is not None:
        config.set("Api", "Key", body.esun_api_key)
    if body.esun_api_secret is not None:
        config.set("Api", "Secret", body.esun_api_secret)
        
    with open(esun_config_path, "w", encoding="utf-8") as f:
        config.write(f)

    # Return success
    return {"status": "success", "message": "Credentials updated successfully. Please restart containers to apply .env changes."}


@router.post("/upload-cert")
async def upload_certificate(
    file: Annotated[UploadFile, File(description="Broker Certificate file (.pfx or .p12)")],
    broker: Annotated[str, Form(description="taishin | sinopac | esun")]
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="Filename missing")
        
    # Map target path based on broker selection
    os.makedirs("secrets", exist_ok=True)
    if broker == "taishin":
        target_path = "secrets/Taishin.pfx"
    elif broker == "sinopac":
        target_path = "secrets/Sinopac.pfx"
    elif broker == "esun":
        target_path = "secrets/esun_cert_20270611.p12"
    else:
        raise HTTPException(status_code=400, detail="Invalid broker selection")
        
    contents = await file.read()
    with open(target_path, "wb") as f:
        f.write(contents)
        
    return {"status": "success", "filename": file.filename, "broker": broker}


class TestConnectionRequest(BaseModel):
    broker: str  # "taishin" | "sinopac" | "esun" | "gemini"


@router.post("/test-connection")
async def test_connection(body: TestConnectionRequest):
    if body.broker == "gemini":
        import google.generativeai as genai
        try:
            if not settings.gemini_api_key:
                raise ValueError("Gemini API 金鑰尚未設定。")
            genai.configure(api_key=settings.gemini_api_key)
            model = genai.GenerativeModel(settings.gemini_model or "gemini-1.5-flash")
            response = model.generate_content("Ping")
            if response.text:
                return {"status": "success", "message": "Gemini API 連線成功！"}
            raise Exception("Gemini 回傳內容為空。")
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Gemini API 連線失敗：{str(e)}")

    elif body.broker == "taishin":
        try:
            # Check if cert exists
            if not os.path.exists("secrets/Taishin.pfx"):
                raise FileNotFoundError("找不到 secrets/Taishin.pfx 憑證檔案，請先上傳憑證。")
            from src.services.brokers.taishin_client import TaishinClient
            client = TaishinClient()
            return {"status": "success", "message": "台新證券 API 連線與憑證驗證成功！"}
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"台新證券連線失敗：{str(e)}")

    elif body.broker == "sinopac":
        try:
            # Check if cert exists
            if not os.path.exists("secrets/Sinopac.pfx"):
                raise FileNotFoundError("找不到 secrets/Sinopac.pfx 憑證檔案，請先上傳憑證。")
            from src.services.brokers.sinopac_client import SinopacClient
            client = SinopacClient()
            return {"status": "success", "message": "永豐金證券 API 連線與憑證驗證成功！"}
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"永豐金證券連線失敗：{str(e)}")

    elif body.broker == "esun":
        try:
            # Check if cert exists
            if not os.path.exists("secrets/esun_cert_20270611.p12"):
                raise FileNotFoundError("找不到 secrets/esun_cert_20270611.p12 憑證檔案，請先上傳憑證。")
            from src.services.brokers.esun_client import EsunClient
            client = EsunClient()
            return {"status": "success", "message": "玉山證券 API 連線與憑證驗證成功！"}
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"玉山證券連線失敗：{str(e)}")

    else:
        raise HTTPException(status_code=400, detail="未知的券商選擇")

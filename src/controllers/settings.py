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
from src.middleware.auth import verify_token

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

        raise HTTPException(status_code=400, detail="未知的券商選擇")


import datetime
import random
from zoneinfo import ZoneInfo

# In-memory daily cache for Gemini quote
_daily_tip_cache: dict[str, str] = {}


@router.get("/daily-tip")
async def get_daily_tip():
    """Retrieve an inspiring personal finance daily tip or quote generated by Gemini (cached daily)."""
    # Get current date in Taipei timezone
    taipei_now = datetime.datetime.now(ZoneInfo("Asia/Taipei"))
    date_str = taipei_now.strftime("%Y-%m-%d")
    
    if date_str in _daily_tip_cache:
        return {"status": "ok", "date": date_str, "tip": _daily_tip_cache[date_str]}
        
    # Attempt to generate via Gemini
    if settings.gemini_api_key:
        try:
            from src.instances.gemini import get_gemini_client
            from google.genai import types
            
            client = get_gemini_client()
            prompt = (
                "You are an expert personal finance helper. Generate ONE inspiring, short personal finance tip, quote, "
                "or budgeting wisdom in Traditional Chinese (繁體中文). Keep it concise, practical, and under 50 characters. "
                "Do NOT include any markdown, numbering, quotes, or extra text. Output the tip text directly."
            )
            response = await client.aio.models.generate_content(
                model=settings.gemini_model or "gemini-1.5-flash",
                contents=[prompt],
                config=types.GenerateContentConfig(
                    temperature=0.7,
                    max_output_tokens=100,
                ),
            )
            tip = response.text.strip()
            if tip:
                _daily_tip_cache[date_str] = tip
                return {"status": "ok", "date": date_str, "tip": tip}
        except Exception as e:
            log.warning(f"Failed to generate daily tip with Gemini: {e}")
            
    # Fallback to random default tip if Gemini is unavailable or errors out
    fallback_tips = [
        "延遲滿足：將想買的物品放入購物車，等待 48 小時後再決定是否購買。",
        "三個帳戶理財法：將收入分流為生活開銷、投資儲蓄、以及享樂娛樂三個專戶。",
        "檢查訂閱服務：定期退訂已經很少使用的串流、軟體或月費訂閱服務。",
        "先存錢、後消費：每月發薪後，先將預算存入儲蓄帳戶，剩下的才是可支配所得。",
        "固定支出檢視：每半年比價一次保費、電信費或寬頻方案，往往有省錢空間。",
        "減少微小浪費：每天一杯手搖杯或拿鐵，累積一年的費用十分驚人（拿鐵因子）。",
        "投資自己：提升自身專業技能，是創造主動收入報酬率最高的方式。",
        "緊急備用金：準備 3 至 6 個月的生活開銷作為備用金，應對突發狀況。"
    ]
    # Seed random selection based on the day to keep it consistent for the day
    random.seed(int(taipei_now.timestamp()) // 86400)
    tip = random.choice(fallback_tips)
    # Reset random seed
    random.seed()
    
    _daily_tip_cache[date_str] = tip
    return {"status": "ok", "date": date_str, "tip": tip}


@router.get("/scheduler-status")
async def get_scheduler_status():
    from src.services.scheduler import load_scheduler_state
    try:
        state = load_scheduler_state()
        return {
            "status": "success",
            "last_asset_sync_day": state.get("last_asset_sync_day"),
            "sync_history": state.get("sync_history", {})
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"無法讀取排程狀態：{str(e)}")


@router.post("/scheduler-sync")
async def trigger_scheduler_sync(
    current_user = Depends(verify_token)
):
    from src.services.scheduler import sync_taishin_assets, sync_esun_assets
    import datetime
    from zoneinfo import ZoneInfo
    
    taipei_now = datetime.datetime.now(ZoneInfo("Asia/Taipei"))
    try:
        # Run asset sync which also pulls trades internally
        await sync_taishin_assets(taipei_now.year, taipei_now.month, user_id=current_user.id, target_date=taipei_now.date())
        await sync_esun_assets(taipei_now.year, taipei_now.month, user_id=current_user.id, target_date=taipei_now.date())
        return {"status": "success", "message": "手動觸發排程同步成功！交易明細與持股餘額已更新！"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"手動排程同步失敗：{str(e)}")

"""
main.py
pocketCFO FastAPI application entry point.
"""
from __future__ import annotations

import logging
from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware

from src.controllers.auth import router as auth_router
from src.middleware.auth import verify_token
from src.controllers.account import router as account_router
from src.controllers.reports.balance_sheet import router as bs_router
from src.controllers.reports.income_statement import router as is_router
from src.controllers.upload import router as upload_router
from src.controllers.reports.report import router as report_router
from src.controllers.transactions import router as txns_router
from src.controllers.settings import router as settings_router
from src.controllers.category_rules import router as category_rules_router
from src.controllers.savings_pots import router as savings_pots_router
from src.controllers.ai_assistant import router as ai_assistant_router
from src.instances.config import get_settings
from src.instances.database import create_all_tables
from src.middleware.error_middleware import (
    file_not_found_handler,
    global_exception_handler,
    value_error_handler,
)
from src.middleware.logging_middleware import LoggingMiddleware

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger(__name__)
settings = get_settings()

app = FastAPI(
    title="pocketCFO",
    description="Personal Balance Sheet & Income Statement Tracker",
    version="0.1.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# ── Middleware ─────────────────────────────────────────────────────────────────
app.add_middleware(LoggingMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Exception handlers ─────────────────────────────────────────────────────────
app.add_exception_handler(Exception, global_exception_handler)
app.add_exception_handler(ValueError, value_error_handler)
app.add_exception_handler(FileNotFoundError, file_not_found_handler)

# ── Routers ────────────────────────────────────────────────────────────────────
app.include_router(auth_router, prefix="/api/v1")
app.include_router(upload_router, prefix="/api/v1", dependencies=[Depends(verify_token)])
app.include_router(bs_router, prefix="/api/v1", dependencies=[Depends(verify_token)])
app.include_router(is_router, prefix="/api/v1", dependencies=[Depends(verify_token)])
app.include_router(account_router, prefix="/api/v1", dependencies=[Depends(verify_token)])
app.include_router(report_router, prefix="/api/v1", dependencies=[Depends(verify_token)])
app.include_router(settings_router, prefix="/api/v1", dependencies=[Depends(verify_token)])
app.include_router(ai_assistant_router, prefix="/api/v1", dependencies=[Depends(verify_token)])
app.include_router(txns_router, dependencies=[Depends(verify_token)])
app.include_router(category_rules_router, dependencies=[Depends(verify_token)])
app.include_router(savings_pots_router, dependencies=[Depends(verify_token)])


# ── Lifecycle ──────────────────────────────────────────────────────────────────
@app.on_event("startup")
async def on_startup() -> None:
    log.info(f"pocketCFO.startup env={settings.app_env}")
    await create_all_tables()
    
    # Start automated background scheduler
    import asyncio
    from src.services.scheduler import start_scheduler
    asyncio.create_task(start_scheduler())


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "version": "0.1.0"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=settings.app_host,
        port=settings.app_port,
        workers=1,
    )

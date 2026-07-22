"""
src/controllers/rebalance/api.py
Web API Router for Portfolio Rebalance Strategy endpoints.
"""
from __future__ import annotations

import logging
from datetime import datetime
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from src.instances.database import get_db
from src.middleware.auth import verify_token
from src.dbs.models import User
from src.controllers.rebalance.model import UpdateRebalanceSettingsRequest
from src.services.rebalance.service import RebalanceService

log = logging.getLogger(__name__)
router = APIRouter(prefix="/rebalance", tags=["rebalance"])


@router.get("/")
async def get_rebalance_analysis(
    date_str: str | None = Query(None, alias="date", description="YYYY-MM-DD"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(verify_token),
):
    """
    Get current portfolio rebalance analysis, trade recommendations, and strategy settings.
    """
    target_date = None
    if date_str:
        try:
            target_date = datetime.strptime(date_str, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format, expected YYYY-MM-DD")

    service = RebalanceService(db, current_user.id)
    return await service.analyze_rebalance(target_date)


@router.put("/settings")
async def update_rebalance_settings(
    body: UpdateRebalanceSettingsRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(verify_token),
):
    """
    Update target portfolio allocation percentages, trigger thresholds, and bond ticker list.
    """
    if body.target_stock_pct is not None and body.target_bond_pct is not None and body.target_cash_pct is not None:
        total = body.target_stock_pct + body.target_bond_pct + body.target_cash_pct
        if abs(total - 100.0) > 0.01:
            raise HTTPException(status_code=400, detail="Target allocation percentages must sum to 100%")

    service = RebalanceService(db, current_user.id)
    strategy = await service.update_strategy(
        target_stock_pct=body.target_stock_pct,
        target_bond_pct=body.target_bond_pct,
        target_cash_pct=body.target_cash_pct,
        stock_trigger_threshold=body.stock_trigger_threshold,
        stock_min_threshold=body.stock_min_threshold,
        bond_tickers=body.bond_tickers,
        enable_email_alert=body.enable_email_alert,
    )
    return {
        "status": "success",
        "strategy": {
            "target_stock_pct": strategy.target_stock_pct,
            "target_bond_pct": strategy.target_bond_pct,
            "target_cash_pct": strategy.target_cash_pct,
            "stock_trigger_threshold": strategy.stock_trigger_threshold,
            "stock_min_threshold": getattr(strategy, "stock_min_threshold", 40.0),
            "bond_tickers": strategy.bond_tickers,
            "enable_email_alert": strategy.enable_email_alert,
        }
    }


@router.post("/send-alert")
async def send_rebalance_alert(
    date_str: str | None = Query(None, alias="date", description="YYYY-MM-DD"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(verify_token),
):
    """
    Trigger sending a portfolio rebalance reminder email to current user.
    """
    target_date = None
    if date_str:
        try:
            target_date = datetime.strptime(date_str, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format, expected YYYY-MM-DD")

    service = RebalanceService(db, current_user.id)
    try:
        return await service.send_alert_email(target_date)
    except Exception as e:
        log.error(f"Failed to send rebalance alert email: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to send email: {str(e)}")

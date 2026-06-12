"""
src/controllers/balance_sheet_controller.py
Balance sheet API endpoints.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from src.instances.database import get_db
from src.services.reports.balance_sheet import BalanceSheetService

router = APIRouter(prefix="/balance-sheet", tags=["balance_sheet"])


@router.get("/")
async def list_balance_sheets(db: AsyncSession = Depends(get_db)):
    """Return all computed balance sheets (history)."""
    svc = BalanceSheetService(db)
    return await svc.get_history(months=36)


@router.post("/compute")
async def compute_balance_sheet(
    year: int = Query(..., ge=2020, le=2100),
    month: int = Query(..., ge=1, le=12),
    db: AsyncSession = Depends(get_db),
):
    """Trigger computation of balance sheet for a given month."""
    svc = BalanceSheetService(db)
    bs = await svc.compute(year, month)
    return {
        "period": bs.period_date.isoformat(),
        "total_assets": bs.total_assets,
        "total_liabilities": bs.total_liabilities,
        "net_worth": bs.net_worth,
        "total_cash": bs.total_cash,
        "total_securities_market_value": bs.total_securities_market_value,
        "detail": __import__("json").loads(bs.detail_json) if bs.detail_json else {},
    }


@router.post("/sync-broker")
async def sync_from_broker(
    year: int = Query(...),
    month: int = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """Pull live positions from broker APIs (永豐金 + 台新)."""
    svc = BalanceSheetService(db)
    return await svc.sync_from_broker_api(year, month)


@router.post("/sync-trades")
async def sync_trades(
    year: int = Query(...),
    month: int = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """Sync brokerage transactions from APIs (台新 + 玉山) for a specific month."""
    from src.services.scheduler import sync_taishin_trades, sync_esun_trades
    await sync_taishin_trades(year, month)
    await sync_esun_trades(year, month)
    return {"status": "ok", "message": f"Synced brokerage trades for {year}-{month:02d}"}


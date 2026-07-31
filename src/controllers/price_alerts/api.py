"""
src/controllers/price_alerts/api.py
Web API Router for target-price auto-trade alert endpoints.
"""
from __future__ import annotations

import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from src.instances.database import get_db
from src.middleware.auth import verify_token
from src.dbs.models import User
from src.controllers.price_alerts.model import CreatePriceAlertRequest
from src.services.price_alerts.service import PriceAlertService

log = logging.getLogger(__name__)
router = APIRouter(prefix="/price-alerts", tags=["price-alerts"])


def _serialize(alert) -> dict:
    return {
        "id": alert.id,
        "ticker": alert.ticker,
        "name": alert.name,
        "alert_type": alert.alert_type.value,
        "side": alert.side.value if alert.side else None,
        "direction": alert.direction.value if alert.direction else None,
        "broker": alert.broker.value if alert.broker else None,
        "target_price": alert.target_price,
        "quantity": alert.quantity,
        "status": alert.status.value,
        "order_result": alert.order_result,
        "triggered_at": alert.triggered_at.isoformat() if alert.triggered_at else None,
        "created_at": alert.created_at.isoformat() if alert.created_at else None,
    }


@router.get("/")
async def list_price_alerts(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(verify_token),
):
    """List all target-price alerts (active and historical) for the current user."""
    service = PriceAlertService(db, current_user.id)
    alerts = await service.list_alerts()
    return {"alerts": [_serialize(a) for a in alerts]}


@router.post("/")
async def create_price_alert(
    body: CreatePriceAlertRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(verify_token),
):
    """Create a new price alert: auto-trade (places a limit order via a broker when hit)
    or notify-only (target price / MA20, sends an email when hit)."""
    service = PriceAlertService(db, current_user.id)
    try:
        alert = await service.create_alert(
            ticker=body.ticker,
            target_price=body.target_price,
            alert_type=body.alert_type,
            side=body.side,
            quantity=body.quantity,
            direction=body.direction,
            broker=body.broker,
            name=body.name,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    await db.commit()
    return _serialize(alert)


@router.delete("/{alert_id}")
async def cancel_price_alert(
    alert_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(verify_token),
):
    """Cancel an active target-price alert before it triggers."""
    service = PriceAlertService(db, current_user.id)
    alert = await service.cancel_alert(alert_id)
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found or not active")
    return _serialize(alert)

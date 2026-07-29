"""
src/services/price_alerts/service.py
Service for user-defined target-price alerts that auto-place a limit order via
E-Sun when the target price is hit, and notify the user by email.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.dbs.models import PriceAlert, PriceAlertSide, PriceAlertStatus, User
from src.dbs.repository import PriceAlertRepository
from src.instances.database import AsyncSessionLocal
from src.services.brokers.esun_client import get_esun_client
from src.services.email.service import send_price_alert_result_email
from src.utils.stock_utils import fetch_live_quote

log = logging.getLogger(__name__)


class PriceAlertService:
    def __init__(self, db: AsyncSession, user_id: int) -> None:
        self.db = db
        self.user_id = user_id
        self.repo = PriceAlertRepository(db, user_id)

    async def list_alerts(self) -> list[PriceAlert]:
        return await self.repo.list_all()

    async def create_alert(self, ticker: str, side: str, target_price: float, quantity: int, name: str | None = None) -> PriceAlert:
        alert = PriceAlert(
            ticker=ticker.strip().upper(),
            name=name,
            side=PriceAlertSide(side),
            target_price=target_price,
            quantity=quantity,
            status=PriceAlertStatus.ACTIVE,
        )
        return await self.repo.create(alert)

    async def cancel_alert(self, alert_id: int) -> PriceAlert | None:
        alert = await self.repo.cancel(alert_id)
        if alert:
            await self.db.commit()
        return alert


def _is_triggered(alert: PriceAlert, current_price: float) -> bool:
    if alert.side == PriceAlertSide.BUY:
        return current_price <= alert.target_price
    return current_price >= alert.target_price


async def check_and_execute_price_alerts() -> None:
    """
    Scheduler entry point: poll live prices for all ACTIVE price alerts across all
    users, and auto-place a limit order at E-Sun when the target price is hit.
    Fire-once: an alert is moved to FILLED/FAILED as soon as an order attempt is
    made, so it will never be picked up again (no automatic retries).
    """
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(PriceAlert).where(PriceAlert.status == PriceAlertStatus.ACTIVE))
        alerts = result.scalars().all()

        if not alerts:
            return

        for alert in alerts:
            try:
                await _process_alert(db, alert)
            except Exception as e:
                log.error(f"Failed to process price alert id={alert.id} ticker={alert.ticker}: {e}")


async def _process_alert(db: AsyncSession, alert: PriceAlert) -> None:
    current_price = await fetch_live_quote(alert.ticker)
    if current_price is None:
        log.warning(f"Could not fetch live quote for {alert.ticker}, skipping alert id={alert.id}")
        return

    if not _is_triggered(alert, current_price):
        return

    log.info(f"Price alert triggered: id={alert.id} ticker={alert.ticker} side={alert.side} target={alert.target_price} current={current_price}")

    user_result = await db.execute(select(User).where(User.id == alert.user_id))
    user = user_result.scalar_one_or_none()

    success = False
    detail = ""
    order_result_str = ""
    try:
        esun = get_esun_client()
        order_result = await esun.place_order(
            ticker=alert.ticker,
            side=alert.side.value,
            price=alert.target_price,
            quantity=alert.quantity,
        )
        success = True
        detail = f"現價 {current_price:.2f} 已觸及目標價 {alert.target_price:.2f}，已成功送出限價委託單。"
        order_result_str = json.dumps(order_result, ensure_ascii=False, default=str)
        alert.status = PriceAlertStatus.FILLED
    except Exception as e:
        success = False
        detail = f"現價 {current_price:.2f} 已觸及目標價 {alert.target_price:.2f}，但送出委託單時發生錯誤：{e}"
        order_result_str = str(e)
        alert.status = PriceAlertStatus.FAILED
        log.error(f"Failed to auto-place order for price alert id={alert.id}: {e}")

    alert.order_result = order_result_str
    alert.triggered_at = datetime.utcnow()
    await db.commit()

    if user and user.email:
        await send_price_alert_result_email(
            user.email, alert.ticker, alert.side.value, alert.target_price, alert.quantity, success, detail
        )

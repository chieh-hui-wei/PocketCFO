"""
src/services/price_alerts/service.py
Service for user-defined price alerts: either auto-place a limit order via a
broker when a target price is hit (AUTO_TRADE), or send a plain notification
email when a target price or MA20 condition is hit (NOTIFY_PRICE / NOTIFY_MA20).
"""
from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.dbs.models import (
    PriceAlert,
    PriceAlertBroker,
    PriceAlertDirection,
    PriceAlertSide,
    PriceAlertStatus,
    PriceAlertType,
    User,
)
from src.dbs.repository import PriceAlertRepository
from src.instances.database import AsyncSessionLocal
from src.services.brokers.esun_client import get_esun_client
from src.services.brokers.taishin_client import get_taishin_client
from src.services.email.service import send_price_alert_notify_email, send_price_alert_result_email
from src.utils.stock_utils import fetch_live_quote, fetch_ma20

log = logging.getLogger(__name__)

BROKERS_SUPPORTING_ORDERS = {PriceAlertBroker.ESUN, PriceAlertBroker.TAISHIN}


class PriceAlertService:
    def __init__(self, db: AsyncSession, user_id: int) -> None:
        self.db = db
        self.user_id = user_id
        self.repo = PriceAlertRepository(db, user_id)

    async def list_alerts(self) -> list[PriceAlert]:
        return await self.repo.list_all()

    async def create_alert(
        self,
        ticker: str,
        target_price: float,
        alert_type: str = "auto_trade",
        side: str | None = None,
        quantity: int | None = None,
        direction: str | None = None,
        broker: str | None = None,
        name: str | None = None,
    ) -> PriceAlert:
        resolved_type = PriceAlertType(alert_type)

        if resolved_type == PriceAlertType.AUTO_TRADE:
            resolved_broker = PriceAlertBroker(broker or "esun")
            if resolved_broker not in BROKERS_SUPPORTING_ORDERS:
                raise ValueError(f"該券商尚未支援自動下單：{resolved_broker.value}")
            alert = PriceAlert(
                ticker=ticker.strip().upper(),
                name=name,
                alert_type=resolved_type,
                side=PriceAlertSide(side),
                quantity=quantity,
                broker=resolved_broker,
                target_price=target_price,
                status=PriceAlertStatus.ACTIVE,
            )
        else:
            alert = PriceAlert(
                ticker=ticker.strip().upper(),
                name=name,
                alert_type=resolved_type,
                direction=PriceAlertDirection(direction),
                target_price=target_price,
                status=PriceAlertStatus.ACTIVE,
            )
        return await self.repo.create(alert)

    async def cancel_alert(self, alert_id: int) -> PriceAlert | None:
        alert = await self.repo.cancel(alert_id)
        if alert:
            await self.db.commit()
        return alert


def _is_triggered(alert: PriceAlert, current_price: float, reference_value: float) -> bool:
    if alert.alert_type == PriceAlertType.AUTO_TRADE:
        if alert.side == PriceAlertSide.BUY:
            return current_price <= reference_value
        return current_price >= reference_value

    # NOTIFY_PRICE / NOTIFY_MA20 use direction (above = price/close rose to-or-past
    # the reference value, below = price/close fell to-or-past it)
    if alert.direction == PriceAlertDirection.ABOVE:
        return current_price >= reference_value
    return current_price <= reference_value


def _get_broker_client(broker: PriceAlertBroker | None):
    if broker == PriceAlertBroker.TAISHIN:
        return get_taishin_client()
    return get_esun_client()


async def check_and_execute_price_alerts() -> None:
    """
    Scheduler entry point: poll live prices for all ACTIVE price alerts across all
    users. AUTO_TRADE alerts auto-place a limit order via the selected broker when
    the target price is hit; NOTIFY_PRICE alerts check the live price every tick;
    NOTIFY_MA20 alerts are only evaluated once, right after market close, using the
    day's closing price vs the 20-day moving average.
    Fire-once: an alert is moved to FILLED/FAILED as soon as it is processed, so it
    will never be picked up again (no automatic retries).
    """
    now = datetime.now(ZoneInfo("Asia/Taipei"))
    is_post_close_window = (13, 31) <= (now.hour, now.minute) <= (13, 35)

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(PriceAlert).where(PriceAlert.status == PriceAlertStatus.ACTIVE))
        alerts = result.scalars().all()

        if not alerts:
            return

        for alert in alerts:
            if alert.alert_type == PriceAlertType.NOTIFY_MA20 and not is_post_close_window:
                continue
            try:
                await _process_alert(db, alert)
            except Exception as e:
                log.error(f"Failed to process price alert id={alert.id} ticker={alert.ticker}: {e}")


async def _process_alert(db: AsyncSession, alert: PriceAlert) -> None:
    if alert.alert_type == PriceAlertType.NOTIFY_MA20:
        reference_value = await fetch_ma20(alert.ticker)
        compare_price = await fetch_live_quote(alert.ticker)
        if reference_value is None or compare_price is None:
            log.warning(f"Could not compute MA20/price for {alert.ticker}, skipping alert id={alert.id}")
            return
    else:
        compare_price = await fetch_live_quote(alert.ticker)
        if compare_price is None:
            log.warning(f"Could not fetch live quote for {alert.ticker}, skipping alert id={alert.id}")
            return
        reference_value = alert.target_price

    if not _is_triggered(alert, compare_price, reference_value):
        return

    log.info(
        f"Price alert triggered: id={alert.id} ticker={alert.ticker} type={alert.alert_type} "
        f"current={compare_price} reference={reference_value}"
    )

    user_result = await db.execute(select(User).where(User.id == alert.user_id))
    user = user_result.scalar_one_or_none()

    if alert.alert_type == PriceAlertType.AUTO_TRADE:
        await _execute_auto_trade(db, alert, compare_price, user)
    else:
        alert.triggered_at = datetime.utcnow()
        alert.status = PriceAlertStatus.FILLED
        await db.commit()
        if user and user.email:
            await send_price_alert_notify_email(
                user.email, alert.ticker, alert.alert_type.value, compare_price, reference_value, alert.direction.value
            )


async def _execute_auto_trade(db: AsyncSession, alert: PriceAlert, current_price: float, user: User | None) -> None:
    success = False
    detail = ""
    order_result_str = ""
    try:
        broker_client = _get_broker_client(alert.broker)
        order_result = await broker_client.place_order(
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

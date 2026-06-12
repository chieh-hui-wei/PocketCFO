"""
src/services/brokers/sinopac_client.py
永豐金證券 / 豐存股 API client (shioaji SDK wrapper).

Sinopac uses the `shioaji` Python SDK which handles TLS certificate auth.
Install: pip install shioaji

Docs: https://sinotrade.github.io/
"""
from __future__ import annotations

import asyncio
from datetime import date
from functools import lru_cache
from typing import Any

import logging
from dotenv import load_dotenv
import os

log = logging.getLogger(__name__)


load_dotenv()


class SinopacClient:
    """
    Async-friendly wrapper around the synchronous shioaji SDK.
    All blocking calls run in a thread executor.
    """

    def __init__(self) -> None:
        import shioaji as sj
        self._logged_in = False
        self._api = sj.Shioaji(simulation=False)  # 模擬模式
        self.accounts = self._api.login(
            api_key=os.getenv("SINOPAC_API_KEY"),     # 請修改此處
            secret_key=os.getenv("SINOPAC_API_SECRET")   # 請修改此處
        )

    async def get_positions(self, period_date: date | None = None) -> list[dict[str, Any]]:
        """Return current stock positions."""
        positions = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: self._api.list_positions(
                self._api.stock_account, unit=self._api.constant.Unit.Share
            ),
        )
        holdings = []
        for pos in positions:
            holdings.append(
                {
                    "ticker": pos.code,
                    "name": pos.name,
                    "quantity": float(pos.quantity),
                    "avg_cost": float(pos.price),
                    "current_price": float(pos.last_price),
                    "market_value": float(pos.last_price) * float(pos.quantity),
                    "unrealized_pnl": float(pos.pnl),
                }
            )
        return holdings
    async def get_account_balance(self) -> dict[str, float]:
        """Return cash balance from 永豐金 API."""
        return await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: self._api.query_funds_availability(self._api.stock_account),
        )   

    async def logout(self) -> None:
        if self._api and self._logged_in:
            await asyncio.get_event_loop().run_in_executor(None, self._api.logout)
            self._logged_in = False


@lru_cache(maxsize=1)
def get_sinopac_client() -> SinopacClient:
    return SinopacClient()

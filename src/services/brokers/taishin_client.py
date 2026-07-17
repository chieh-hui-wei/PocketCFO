"""
src/services/brokers/taishin_client.py
台新證券 API client.

台新 uses a REST API with mTLS client certificate authentication.
Certificate is a .pfx / .p12 file downloaded from the broker's website.
"""
from __future__ import annotations

import ssl
from datetime import date
from functools import lru_cache
from pathlib import Path
from typing import Any
import os
import httpx
import logging
import asyncio
from dotenv import load_dotenv

log = logging.getLogger(__name__)

class TaishinClient:
    """Async REST client for 台新證券."""

    def __init__(self) -> None:
        from src.instances.config import get_settings
        from taishin_sdk import TaishinSDK
        settings = get_settings()
        id = settings.taishin_account_id
        password = settings.taishin_account_password or os.getenv("TAISHIN_ACCOUNT_PASSWORD")
        taishin_cert_path = settings.taishin_cert_path
        taishin_cert_pass = settings.taishin_cert_password
        self.sdk = TaishinSDK()
        self.accounts = self.sdk.login(id, password, taishin_cert_path, taishin_cert_pass)

    async def get_account_balance(self) -> dict[str, float]:
        """Fetch cash balance from 台新 API."""
        res = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: self.sdk.accounting.skbank_balance(self.accounts[0])
        )
        return {"cash_balance": res.available_balance}

    async def get_positions(self) -> list[dict[str, Any]]:
        """Fetch current stock positions from 台新 API."""
        inventories = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: self.sdk.accounting.inventories(self.accounts[0])
        )
        holdings = []

        for target in inventories.position_summaries:

            holdings.append(
                {
                    "ticker": target.symbol,
                    "name": target.symbol_name,
                    "quantity": target.current_quantity,
                    "cost": target.cost,
                    "current_price": target.current_price,
                    "market_value": target.market_value,
                    "unrealized_pnl": target.total_profit,
                }
            )
        return holdings

    async def get_filled_history(self, start_date: str, end_date: str) -> list[Any]:
        """
        Fetch filled history (歷史成交明細) from 台新 API.
        Dates should be formatted as YYYYMMDD (e.g. '20241004').
        """
        res = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: self.sdk.stock.filled_history(self.accounts[0], start_date, end_date)
        )
        return res


def get_taishin_client() -> TaishinClient:
    return TaishinClient()

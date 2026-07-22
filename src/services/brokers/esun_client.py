"""
src/services/brokers/esun_client.py
玉山證券 / Fugle API client wrapper.
"""
from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta
from functools import lru_cache
from typing import Any
import logging
from configparser import ConfigParser

# Ensure keyring backend is memory-based at the module import level to avoid prompts
import keyring
from keyring.backend import KeyringBackend

log = logging.getLogger(__name__)

class InMemoryKeyring(KeyringBackend):
    priority = 9

    def __init__(self):
        self._passwords = {}

    def set_password(self, servicename, username, password):
        self._passwords[(servicename, username)] = password

    def get_password(self, servicename, username):
        return self._passwords.get((servicename, username))

    def delete_password(self, servicename, username):
        self._passwords.pop((servicename, username), None)

# Set the memory keyring immediately on import
keyring.set_keyring(InMemoryKeyring())

try:
    # Mock setup_keyring inside esun_trade to prevent password prompts
    import esun_trade.sdk
    esun_trade.sdk.setup_keyring = lambda *args, **kwargs: None
    import esun_trade.util
    esun_trade.util.setup_keyring = lambda *args, **kwargs: None
    from esun_trade.sdk import SDK
except ImportError:
    SDK = None

class EsunClient:
    """Async-friendly wrapper around E-Sun SDK."""

    def __init__(self) -> None:
        config = ConfigParser()
        config.read('secrets/config.ini')

        account = config["User"]["Account"]
        password = config["User"]["Password"]
        cert_password = config["Cert"]["Password"]

        # Store credentials in the memory keyring
        keyring.set_password("esun_trade_sdk:account", account, password)
        keyring.set_password("esun_trade_sdk:cert", account, cert_password)

        self.sdk = SDK(config)
        self.sdk.login()

    async def get_account_balance(self) -> dict[str, float]:
        """Return cash balance from E-Sun API."""
        try:
            res = await asyncio.get_event_loop().run_in_executor(
                None,
                self.sdk.get_balance
            )
            cash_balance = 0.0
            if isinstance(res, dict):
                cash_balance = float(res.get("available_balance") or res.get("balance") or res.get("withdrawable_balance") or 0.0)
            elif isinstance(res, (int, float)):
                cash_balance = float(res)
            return {"cash_balance": cash_balance}
        except Exception as e:
            log.warning(f"Failed to fetch E-Sun bank balance: {e}")
            return {"cash_balance": 0.0}

    async def get_positions(self) -> list[dict[str, Any]]:
        """Return current stock positions."""
        res = await asyncio.get_event_loop().run_in_executor(
            None,
            self.sdk.get_inventories
        )
        holdings = []
        for item in res:
            qty = float(item.get("cost_qty") or item.get("qty_l") or 0.0)
            cost_sum = abs(float(item.get("cost_sum") or 0.0))
            holdings.append(
                {
                    "ticker": item["stk_no"],
                    "name": item.get("stk_na") or item["stk_no"],
                    "quantity": qty,
                    "cost": cost_sum,
                    "current_price": float(item.get("price_mkt") or item.get("price_now") or 0.0),
                    "market_value": float(item.get("value_mkt") or item.get("value_now") or 0.0),
                    "unrealized_pnl": float(item.get("make_a_sum") or 0.0),
                }
            )
        return holdings

    async def get_filled_history(self, start_date: str, end_date: str) -> list[dict[str, Any]]:
        """
        Fetch filled history from E-Sun API.
        Dates should be formatted as YYYY-MM-DD.
        Queries E-Sun with yyyy-MM-dd date formats, limiting to 90 days.
        """
        try:
            start_dt = datetime.strptime(start_date, "%Y-%m-%d").date()
            end_dt = datetime.strptime(end_date, "%Y-%m-%d").date()
        except ValueError:
            try:
                start_dt = datetime.strptime(start_date, "%Y%m%d").date()
                end_dt = datetime.strptime(end_date, "%Y%m%d").date()
            except ValueError:
                end_dt = date.today()
                start_dt = end_dt - timedelta(days=90)

        # Enforce 180-day lookup limit from today and prevent future end dates
        today = date.today()
        limit_days_ago = today - timedelta(days=180)
        if start_dt < limit_days_ago:
            start_dt = limit_days_ago
        if end_dt > today:
            end_dt = today

        start_str = start_dt.strftime("%Y-%m-%d")
        end_str = end_dt.strftime("%Y-%m-%d")

        log.info(f"Querying E-Sun transactions from {start_str} to {end_str}")
        res = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: self.sdk.get_transactions_by_date(start_str, end_str)
        )
        return res

@lru_cache(maxsize=1)
def get_esun_client() -> EsunClient:
    return EsunClient()

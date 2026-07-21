"""
src/services/exchange_rate_service.py
Service for fetching historical exchange rates.
"""

import httpx
import logging
from datetime import date
from typing import Optional

log = logging.getLogger(__name__)

# Default fallback rates for common currencies to TWD
_FALLBACK_RATES: dict[str, float] = {
    "usd": 32.0,
    "eur": 35.0,
    "jpy": 0.22,
    "gbp": 41.0,
    "aud": 21.0,
    "cad": 23.5,
    "hkd": 4.1,
    "sgd": 24.0,
    "cny": 4.5,
    "chf": 36.0,
}


async def get_currency_twd_rate(target_date: date, from_currency: str = "usd") -> float:
    """
    Fetches the exchange rate from any currency to TWD for a given date.
    Uses the free currency-api. Falls back to a hardcoded rate on failure.

    Args:
        target_date: The date to fetch the rate for (uses last available if weekend/holiday).
        from_currency: The source currency code (e.g. "usd", "eur", "jpy"). Case-insensitive.
    """
    currency = from_currency.lower()
    date_str = target_date.strftime("%Y-%m-%d")
    url = f"https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@{date_str}/v1/currencies/{currency}.json"
    fallback_url = f"https://latest.currency-api.pages.dev/v1/currencies/{currency}.json"

    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(url, timeout=5.0)
            if response.status_code == 200:
                data = response.json()
                rate = data.get(currency, {}).get("twd")
                if rate:
                    return float(rate)
            log.warning(f"Failed to fetch {currency}/TWD for {date_str}, trying fallback URL.")
            response = await client.get(fallback_url, timeout=5.0)
            if response.status_code == 200:
                data = response.json()
                rate = data.get(currency, {}).get("twd")
                if rate:
                    return float(rate)
    except Exception as e:
        log.error(f"Error fetching exchange rate {currency}/TWD: {e}")

    fallback = _FALLBACK_RATES.get(currency, 1.0)
    log.warning(f"Using hardcoded fallback exchange rate for {currency.upper()}/TWD ({fallback})")
    return fallback


async def get_usd_twd_rate(target_date: date) -> float:
    """Backward-compatible wrapper: fetch USD→TWD rate for a given date."""
    return await get_currency_twd_rate(target_date, from_currency="usd")

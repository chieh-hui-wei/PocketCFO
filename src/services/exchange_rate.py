"""
src/services/exchange_rate_service.py
Service for fetching historical exchange rates.
"""

import httpx
import logging
from datetime import date
from typing import Optional

log = logging.getLogger(__name__)

async def get_usd_twd_rate(target_date: date) -> float:
    """
    Fetches the USD to TWD exchange rate for a given date.
    Uses the free currency-api. If it fails, falls back to a default rate.
    """
    date_str = target_date.strftime("%Y-%m-%d")
    url = f"https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@{date_str}/v1/currencies/usd.json"
    
    # Also add a fallback URL
    fallback_url = f"https://latest.currency-api.pages.dev/v1/currencies/usd.json"
    
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(url, timeout=5.0)
            if response.status_code == 200:
                data = response.json()
                rate = data.get("usd", {}).get("twd")
                if rate:
                    return float(rate)
            else:
                log.warning(f"Failed to fetch historical exchange rate for {date_str}, falling back to latest.")
                response = await client.get(fallback_url, timeout=5.0)
                if response.status_code == 200:
                    data = response.json()
                    rate = data.get("usd", {}).get("twd")
                    if rate:
                        return float(rate)
    except Exception as e:
        log.error(f"Error fetching exchange rate: {e}")
        
    log.warning("Using hardcoded fallback exchange rate for USD/TWD (32.0)")
    return 32.0

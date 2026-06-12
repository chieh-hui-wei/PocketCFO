"""
src/utils/stock_utils.py
Utilities for stock holdings, transaction parsing, and price fetching.
"""
from __future__ import annotations

import json
import re
import logging
import calendar
import httpx
from datetime import date, datetime, timedelta
from typing import Any, Tuple, Optional

log = logging.getLogger(__name__)


def parse_stock_transaction(txn: Any) -> Tuple[Optional[str], float, Optional[str], float]:
    """
    Parses a brokerage transaction to extract:
    (ticker, quantity, action_type, price)
    action_type is either 'BUY' or 'SELL'.
    """
    ticker = None
    qty = 0.0
    action = None
    price = 0.0

    # 1. Try to parse from raw_data if available
    if hasattr(txn, "raw_data") and txn.raw_data:
        try:
            data = json.loads(txn.raw_data)
            if isinstance(data, dict):
                ticker = data.get("ticker")
                qty = float(data.get("quantity") or 0.0)
                price = float(data.get("price") or 0.0)
                act = str(data.get("action") or data.get("buy_sell") or "").upper()
                if "BUY" in act or "買" in act:
                    action = "BUY"
                elif "SELL" in act or "賣" in act:
                    action = "SELL"
        except Exception:
            pass

    # 2. Try to parse from description using regex if ticker or quantity is missing
    if not ticker or qty == 0.0:
        desc = txn.description or ""
        # Match standard patterns like:
        # [買進] 2330 1000股 @ 600
        # 買進 2330 1,000股 @ 600
        # BUY AAPL 10股 @ 150
        # SELL VT 5 @ 100
        match = re.search(
            r"(買進|賣出|買|賣|BUY|SELL)\s*\]?\s*([A-Za-z0-9.]+)\s*([\d,]+(?:\.\d+)?)\s*股?\s*@?\s*([\d,]+(?:\.\d+)?)",
            desc,
            re.IGNORECASE,
        )
        if match:
            act_str = match.group(1).upper()
            ticker = match.group(2)
            qty_str = match.group(3).replace(",", "")
            price_str = match.group(4).replace(",", "")
            
            qty = float(qty_str)
            price = float(price_str)
            
            if "BUY" in act_str or "買" in act_str:
                action = "BUY"
            elif "SELL" in act_str or "賣" in act_str:
                action = "SELL"
        else:
            # Firstrade description pattern fallback: BUY ... (VT)
            match_ft = re.search(r"^(BUY|SELL)\s+.*\(([^)]+)\)", desc, re.IGNORECASE)
            if match_ft:
                action = match_ft.group(1).upper()
                ticker = match_ft.group(2)
                # Attempt to extract quantity and price from amount and description if not in raw_data
                # But since Firstrade has raw_data parsed by Gemini, this is rarely needed.
                pass

    return ticker, qty, action, price


async def fetch_month_end_price(ticker: str, period_date: date) -> Optional[float]:
    """
    Fetches the closing price for a stock on the last trading day of the target month.
    Queries Yahoo Finance v8 chart API.
    """
    # Clean ticker
    ticker = ticker.strip()
    if not ticker:
        return None

    # Handle Taiwan tickers: if numeric, try .TW first, then .TWO
    tickers_to_try = []
    if ticker.isdigit():
        tickers_to_try = [f"{ticker}.TW", f"{ticker}.TWO"]
    else:
        tickers_to_try = [ticker]

    # Period bounds
    start_dt = datetime(period_date.year, period_date.month, 1)
    last_day = calendar.monthrange(period_date.year, period_date.month)[1]
    # Fetch until last day of month + 2 days to account for weekends / timezones
    end_dt = datetime(period_date.year, period_date.month, last_day) + timedelta(days=2)
    
    period1 = int(start_dt.timestamp())
    period2 = int(end_dt.timestamp())
    
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "max-age=0"
    }
    
    async with httpx.AsyncClient() as client:
        for t in tickers_to_try:
            url = f"https://query1.finance.yahoo.com/v8/finance/chart/{t}?period1={period1}&period2={period2}&interval=1d"
            try:
                response = await client.get(url, headers=headers, timeout=10.0)
                if response.status_code == 200:
                    res_json = response.json()
                    result = res_json.get("chart", {}).get("result")
                    if result and len(result) > 0:
                        adjclose = result[0].get("indicators", {}).get("adjclose", [{}])[0].get("adjclose", [])
                        close = result[0].get("indicators", {}).get("quote", [{}])[0].get("close", [])
                        
                        prices = adjclose if adjclose else close
                        valid_prices = [p for p in prices if p is not None]
                        if valid_prices:
                            last_price = valid_prices[-1]
                            log.info(f"Successfully fetched price for {t} at month-end of {period_date}: {last_price}")
                            return float(last_price)
            except Exception as e:
                log.warning(f"Error querying Yahoo Finance for {t}: {e}")
                
    return None


def normalize_stock_name(ticker: Optional[str], current_name: str) -> str:
    """Unify stock names (like VT) to standard formal names."""
    if not ticker:
        return current_name
    t = ticker.strip().upper()
    if t == "VT":
        return "Vanguard Total World Stock ETF"
    if t == "BND":
        return "Vanguard Total Bond Market ETF"
    if t == "TQQQ":
        return "ProShares UltraPro QQQ"
    return current_name


def normalize_transaction_description(desc: str) -> str:
    """Normalize names in transaction descriptions."""
    if not desc:
        return desc
    # Unify Vanguard Total World Stock ETF (VT) variations
    desc = re.sub(
        r"VANGUARD INTL EQUITY INDEX FD( TOTAL WORLD STOCK INDEX ETF)?",
        "Vanguard Total World Stock ETF",
        desc,
        flags=re.IGNORECASE
    )
    return desc


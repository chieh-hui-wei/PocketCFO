"""src/utils/date_utils.py"""
from __future__ import annotations
from datetime import date


def first_of_month(year: int, month: int) -> date:
    """Return the first day of the given year/month."""
    return date(year, month, 1)


def parse_period_date(year: int, month: int) -> date:
    return first_of_month(year, month)


def parse_tw_date_robust(date_str: str) -> date:
    """Parse date strings that might be in ROC (Taiwan) format or standard ISO format.
    E.g. '115-06-09' -> 2026-06-09
    '2026-06-09' -> 2026-06-09
    """
    if not date_str:
        raise ValueError("Empty date string")
    
    date_str = date_str.strip().replace("/", "-")
    parts = date_str.split("-")
    
    if len(parts) == 3:
        try:
            year = int(parts[0])
            if year < 1000:  # Assumed ROC year
                year += 1911
            return date(year, int(parts[1]), int(parts[2]))
        except ValueError:
            pass
            
    return date.fromisoformat(date_str)

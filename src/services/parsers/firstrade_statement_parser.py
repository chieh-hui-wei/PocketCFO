"""
src/services/parsers/firstrade_statement_parser.py
Uses Gemini to extract structured data from Firstrade statement PDFs.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

from src.instances.gemini import extract_structured

FIRSTRADE_STATEMENT_PROMPT = """
You are a financial data extraction assistant.
Analyze this Firstrade brokerage account statement PDF and extract data in JSON format.

Return ONLY valid JSON with this exact schema:
{
  "institution": "Firstrade",
  "account_number": "string",
  "period_year": integer,
  "period_month": integer,
  "currency": "USD",
  "cash_balance": float or null,
  "total_market_value": float or null,
  "holdings": [
    {
      "ticker": "string or null (e.g. VT, VTI)",
      "name": "string",
      "quantity": float or null,
      "avg_cost": float or null,
      "current_price": float or null,
      "market_value": float or null,
      "unrealized_pnl": float or null
    }
  ],
  "transactions": [
    {
      "date": "YYYY-MM-DD",
      "action": "string (e.g., BUY, SELL, DIVIDEND, INTEREST, TAX)",
      "ticker": "string or null",
      "name": "string (stock name)",
      "quantity": float or null,
      "price": float or null,
      "amount": float or null,
      "fee": float or null
    }
  ]
}

Important rules:
- ALL dates MUST be formatted as YYYY-MM-DD.
- `holdings` represents the user's stock inventory (PORTFOLIO SUMMARY -> EQUITIES / OPTIONS).
- `unrealized_pnl` is the unrealized profit/loss, if not available put null.
- `transactions` represents the trading activity (ACCOUNT ACTIVITY -> BUY / SELL TRANSACTIONS / DIVIDENDS AND INTEREST).
- `amount` in transactions is the total settlement amount (DEBIT or CREDIT). Use positive values.
- `action` should be one of BUY, SELL, DIVIDEND, INTEREST, TAX or OTHER.
- Ensure that the sum of `market_value` for all holdings roughly matches `total_market_value`.
"""

async def parse_firstrade_statement(pdf_path: Path) -> dict[str, Any]:
    """Parse a Firstrade statement PDF and return structured data."""
    data = await extract_structured(pdf_path, FIRSTRADE_STATEMENT_PROMPT)
    data["currency"] = "USD"
    data["institution"] = "Firstrade"
    return data

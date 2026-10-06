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
      "ticker": "string (US ticker symbol, e.g. VT, QQQM)",
      "name": "string (standard fund/company name, e.g. Vanguard Total World Stock ETF)",
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
      "ticker": "string or null (US ticker symbol; null only for INTEREST or cash-only rows)",
      "name": "string (standard fund/company name, same as in holdings for the same ticker)",
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
- `cash_balance` is the closing "Cash account" / "Total Cash (Net Portfolio Balance)" amount.
- `total_market_value` is the securities value ONLY ("Total Equities" / closing "Securities"), EXCLUDING cash. Do NOT use "TOTAL PRICED PORTFOLIO" or "Total Equity Holdings" — those already include cash.
- Ensure that the sum of `market_value` for all holdings roughly matches `total_market_value`.
- **Ticker symbols — VERY IMPORTANT**: Every holding and every security-related transaction (BUY, SELL, DIVIDEND, TAX, reinvest) MUST have its US ticker symbol in `ticker`.
  - Use the SYMBOL/CUSIP column of PORTFOLIO SUMMARY when available.
  - ACCOUNT ACTIVITY rows usually show only the issuer description and CUSIP (e.g. `VANGUARD INTL EQUITY INDEX FD`, `CUSIP: 922042742`). Resolve the ticker by matching the description/CUSIP to the PORTFOLIO SUMMARY, or from your own knowledge of the security if it is not held anymore (e.g. sold positions).
  - The same security MUST use the same `ticker` and `name` across holdings and transactions.
- `name` must be the security's common fund/company name in title case (e.g. `Vanguard Total World Stock ETF` for VT, `Invesco NASDAQ 100 ETF` for QQQM), NOT the issuer trust line printed on the statement (e.g. NOT `VANGUARD INTL EQUITY INDEX FD` or `INVESCO EXCHANGE TRADED FD TR`).
- If the account number in the PDF contains asterisks/X (e.g. `***-12345` or `**812345`), you MUST retain the asterisks/X. Do NOT guess or randomly fill in missing digits.
"""

async def parse_firstrade_statement(pdf_path: Path) -> dict[str, Any]:
    """Parse a Firstrade statement PDF and return structured data."""
    data = await extract_structured(pdf_path, FIRSTRADE_STATEMENT_PROMPT)
    data["currency"] = "USD"
    data["institution"] = "Firstrade"
    return data

"""
src/services/parsers/bank_statement_parser.py
Uses Gemini to extract structured data from bank statement PDFs.
"""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path
from typing import Any

from src.instances.gemini import extract_structured
from src.utils.date_utils import parse_period_date

BANK_STATEMENT_PROMPT = """
You are a financial data extraction assistant.
Analyze this Taiwan bank statement PDF and extract the following data in JSON format.
Note: A statement might contain multiple accounts (e.g. TWD savings, foreign currency savings, checking, or multiple sub-accounts). You MUST extract each account separately.

Return ONLY valid JSON (no markdown, no explanation) with this exact schema:
{
  "institution": "string (bank name in Traditional Chinese)",
  "period_year": integer,
  "period_month": integer,
  "accounts": [
    {
      "account_number": "string (MUST search the entire document, including headers and summaries, to find and extract the FULL, UNMASKED account number for this specific account. Do not mask/truncate digits with 'X' or '*' if the complete account number is visible anywhere in the file.)",
      "closing_balance": float,
      "currency": "string (e.g., TWD, USD, EUR, etc. Default to TWD if not specified)",
      "transactions": [
        {
          "date": "YYYY-MM-DD",
          "description": "string",
          "debit": float or null,
          "credit": float or null,
          "balance": float or null
        }
      ]
    }
  ]
}

Important rules:
- ALL dates MUST be formatted as YYYY-MM-DD in the Gregorian calendar (西元年). If the statement uses the Taiwan ROC calendar (民國), you MUST convert it by adding 1911 to the year. (e.g. 民國 113 年 = 2024).
- account_number: You MUST extract the full, unmasked account number (完整帳號) for each account if available anywhere in the document. Do not mask digits if you can find the complete account number.
- closing_balance should be the balance at the end of the statement period for this specific account. It may be labeled as "台幣存款本期結餘", "本月餘額", "外幣結餘", "期末餘額", or found under "資產總覽" / "往來帳戶餘額彙整表".
- period_year and period_month MUST represent the month the transactions actually took place in (the statement cycle month), NOT the statement issue date or billing date. For example, a statement issued in June covering May's transactions should have period_month = 5.
- debit = money going out (negative to account), credit = money coming in
- For description, MUST combine the transaction summary (摘要) with any counterparty account (對方帳號/行庫) or notes (備註). Example: "網路轉帳 - 0008 000077720XXXX736"
- For inter-account transfers, include them but they will be filtered later
- If you cannot find a field, use null
"""


async def parse_bank_statement(pdf_path: Path) -> dict[str, Any]:
    """Parse a bank statement PDF and return structured data."""
    data = await extract_structured(pdf_path, BANK_STATEMENT_PROMPT)
    return data


CREDIT_CARD_PROMPT = """
You are a financial data extraction assistant.
Analyze this Taiwan credit card statement PDF and extract data in JSON format.

Return ONLY valid JSON with this exact schema:
{
  "institution": "string (bank/card issuer name)",
  "card_last_four": "string",
  "period_year": integer,
  "period_month": integer,
  "total_amount": float,
  "payment_due_date": "YYYY-MM-DD or null",
  "currency": "TWD",
  "items": [
    {
      "date": "YYYY-MM-DD",
      "merchant": "string",
      "category": "string (餐飲/購物/交通/娛樂/醫療/其他)",
      "amount": float,
      "currency": "TWD",
      "is_refund": boolean
    }
  ]
}

Important:
- ALL dates MUST be formatted as YYYY-MM-DD in the Gregorian calendar (西元年). If the statement uses the Taiwan ROC calendar (民國), convert it by adding 1911 to the year.
- total_amount is the total billed amount for this cycle
- period_year and period_month MUST represent the month the transactions actually took place in (the statement cycle month), NOT the statement issue date or billing date. For example, a bill due in June for May's consumption should have period_month = 5.
- Refunds / 退款 should have is_refund: true and positive amount
- Categorize merchants as best as you can
"""


async def parse_credit_card_statement(pdf_path: Path) -> dict[str, Any]:
    """Parse a credit card statement PDF and return structured data."""
    return await extract_structured(pdf_path, CREDIT_CARD_PROMPT)


BROKERAGE_STATEMENT_PROMPT = """
You are a financial data extraction assistant.
Analyze this Taiwan brokerage account statement PDF and extract data in JSON format.

Return ONLY valid JSON with this exact schema:
{
  "institution": "string (broker name e.g. 永豐金/台新證券)",
  "account_number": "string",
  "period_year": integer,
  "period_month": integer,
  "cash_balance": float or null,
  "total_market_value": float or null,
  "holdings": [
    {
      "ticker": "string or null (e.g. 0050, 2330)",
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
      "action": "string (e.g., 買進 / 賣出)",
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
- `holdings` represents the user's stock inventory (庫存餘額 / 集保餘額 / 證券庫存). You MUST extract every individual stock listed in the inventory section.
- If a stock doesn't have a ticker, use its name.
- `unrealized_pnl` is the unrealized profit/loss (預估損益 / 未實現損益).
- If `quantity` or `market_value` is present, you MUST include the holding even if other fields are missing.
- `transactions` represents the trading activity (交易明細 / 買賣紀錄) during the statement period.
- `amount` in transactions is the total settlement amount (應付/應收金額 或 價金). Use positive values.
- `fee` in transactions represents trading fees/taxes (手續費 + 交易稅).
- Ensure that the sum of `market_value` for all holdings roughly matches `total_market_value`.
"""


async def parse_brokerage_statement(pdf_path: Path) -> dict[str, Any]:
    """Parse a brokerage statement PDF and return structured data."""
    return await extract_structured(pdf_path, BROKERAGE_STATEMENT_PROMPT)


EINVOICE_PROMPT = """
You are a financial data extraction assistant.
Analyze this Taiwan Electronic Invoice (電子發票) statement / purchase details PDF or text and extract the data in JSON format.

Return ONLY valid JSON with this exact schema:
{
  "period_year": integer,
  "period_month": integer,
  "items": [
    {
      "date": "YYYY-MM-DD",
      "merchant": "string (store/merchant name)",
      "description": "string (brief summary of purchased items/services)",
      "amount": float,
      "payment_method": "string (e.g. 現金 / 信用卡 / 街口支付 / LINE Pay / 悠遊卡 / 其他)",
      "invoice_number": "string or null (e.g., AB-12345678)"
    }
  ]
}

Important rules:
- ALL dates MUST be formatted as YYYY-MM-DD in the Gregorian calendar (西元年). If the statement uses the Taiwan ROC calendar (民國), convert it by adding 1911 to the year.
- If payment method is not explicitly shown, use "其他" or guess if context allows (e.g. Apple Pay -> Apple Pay / 信用卡).
- Categorize the merchant and clean up common suffix words if possible.
"""


async def parse_einvoice_statement(pdf_path: Path) -> dict[str, Any]:
    """Parse an electronic invoice PDF and return structured data."""
    return await extract_structured(pdf_path, EINVOICE_PROMPT)


async def parse_einvoice_csv(csv_path: Path) -> dict[str, Any]:
    """Parse an electronic invoice carrier CSV file and return aggregated structured data."""
    import pandas as pd
    from datetime import datetime

    rows = []
    header = None
    with open(csv_path, 'r', encoding='utf-8') as f:
        # Read the header
        header_line = f.readline().strip()
        if header_line.startswith('\ufeff'):
            header_line = header_line[1:]
        header = header_line.split(',')
        
        for line in f:
            line = line.strip()
            if not line:
                continue
            if "注意" in line or "捐贈" in line or "字軌" in line:
                continue
            parts = line.split(',')
            if len(parts) < 14:
                continue
            row = parts[:13]
            product_name = ",".join(parts[13:])
            row.append(product_name)
            rows.append(row)
            
    df = pd.DataFrame(rows, columns=header)
    df['發票日期'] = df['發票日期'].astype(str)
    df['消費明細_金額'] = pd.to_numeric(df['消費明細_金額'], errors='coerce').fillna(0)
    
    period_year = None
    period_month = None
    
    grouped = df.groupby('發票號碼').agg({
        '發票日期': 'first',
        '賣方名稱': 'first',
        '載具自訂名稱': 'first',
        '消費明細_金額': 'sum',
    }).reset_index()
    
    items = []
    for _, row in grouped.iterrows():
        date_str = str(row['發票日期'])
        try:
            dt = datetime.strptime(date_str, "%Y%m%d")
            formatted_date = dt.strftime("%Y-%m-%d")
            if period_year is None:
                period_year = dt.year
                period_month = dt.month
        except Exception:
            formatted_date = date_str
            
        merchant = str(row['賣方名稱']).strip()
        items.append({
            "date": formatted_date,
            "merchant": merchant,
            "description": merchant,
            "amount": float(row['消費明細_金額']),
            "payment_method": str(row['載具自訂名稱']).strip() if pd.notna(row['載具自訂名稱']) and str(row['載具自訂名稱']).strip() else "電子載具",
            "invoice_number": row['發票號碼']
        })
        
    if period_year is None:
        period_year = datetime.now().year
        period_month = datetime.now().month
        
    return {
        "period_year": int(period_year),
        "period_month": int(period_month),
        "items": items
    }



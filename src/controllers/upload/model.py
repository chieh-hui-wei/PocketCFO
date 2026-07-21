"""
src/controllers/upload/model.py
Pydantic schemas for statement uploads and confirmation payload review.
"""
from __future__ import annotations

from typing import List, Optional, Literal
from pydantic import BaseModel

StatementKind = Literal["bank", "credit_card", "brokerage", "einvoice"]


class ConfirmHolding(BaseModel):
    ticker: str
    name: str
    quantity: float
    avg_cost: float
    current_price: float


class ConfirmTransaction(BaseModel):
    date: str
    description: Optional[str] = None
    merchant: Optional[str] = None
    amount: float
    balance: Optional[float] = None
    action: Optional[str] = None
    ticker: Optional[str] = None
    name: Optional[str] = None
    quantity: Optional[float] = None
    price: Optional[float] = None
    fee: Optional[float] = None
    is_refund: bool = False
    payment_method: Optional[str] = None
    invoice_number: Optional[str] = None
    is_duplicate: bool = False


class ConfirmAccountData(BaseModel):
    account_number: Optional[str] = None
    currency: str = "TWD"
    exchange_rate: float = 1.0
    closing_balance: Optional[float] = None
    transactions: Optional[List[ConfirmTransaction]] = None


class ConfirmStatementRequest(BaseModel):
    kind: str
    filename: str
    file_hash: str
    period_year: int
    period_month: int
    institution: Optional[str] = None
    currency: str = "TWD"
    exchange_rate: float = 1.0
    account_code: Optional[str] = None
    account_number: Optional[str] = None
    card_last_four: Optional[str] = None
    
    closing_balance: Optional[float] = None
    
    total_amount: Optional[float] = None
    payment_due_date: Optional[str] = None
    
    cash_balance: Optional[float] = None
    total_market_value: Optional[float] = None
    holdings: Optional[List[ConfirmHolding]] = None
    
    transactions: Optional[List[ConfirmTransaction]] = None
    accounts: Optional[List[ConfirmAccountData]] = None

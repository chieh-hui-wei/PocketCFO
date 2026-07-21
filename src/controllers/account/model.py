"""
src/controllers/account/model.py
Pydantic schemas for account management.
"""
from __future__ import annotations

from typing import List, Optional
from pydantic import BaseModel

from src.dbs.models import AccountType


class CreateAccountRequest(BaseModel):
    code: Optional[str] = None
    name: str
    account_type: AccountType
    institution: str
    currency: str = "TWD"
    is_internal: bool = True
    notes: Optional[str] = None
    is_installment: bool = False
    installment_amount: float = 0.0


class SaveSnapshotRequest(BaseModel):
    period_date: str
    balance: float


class SaveSecurityRequest(BaseModel):
    ticker: str
    name: Optional[str] = None
    quantity: float
    avg_cost: Optional[float] = None
    current_price: Optional[float] = None


class SaveSecuritiesForAccountRequest(BaseModel):
    securities: List[SaveSecurityRequest]


class UpdateAccountRequest(BaseModel):
    name: Optional[str] = None
    account_type: Optional[AccountType] = None
    institution: Optional[str] = None
    currency: Optional[str] = None
    is_internal: Optional[bool] = None
    code: Optional[str] = None
    notes: Optional[str] = None
    is_installment: Optional[bool] = None
    installment_amount: Optional[float] = None

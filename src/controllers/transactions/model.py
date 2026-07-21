"""
src/controllers/transactions/model.py
Pydantic schemas for transactions API.
"""
from __future__ import annotations

from typing import List, Optional
from pydantic import BaseModel


class CreateTransactionRequest(BaseModel):
    date: str
    description: str
    amount: float
    category: str
    source: str = "bank"
    merchant: Optional[str] = None
    account_id: Optional[int] = None


class UpdateTransactionRequest(BaseModel):
    date: Optional[str] = None
    merchant: Optional[str] = None
    description: Optional[str] = None
    amount: Optional[float] = None
    category: Optional[str] = None


class BulkDeleteRequest(BaseModel):
    ids: List[int]


class BulkUpdateCategoryRequest(BaseModel):
    ids: List[int]
    category: str

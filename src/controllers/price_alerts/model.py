"""
src/controllers/price_alerts/model.py
Pydantic schemas for Price Alert (target-price auto-trade) endpoints.
"""
from __future__ import annotations

from typing import Optional
from pydantic import BaseModel, Field


class CreatePriceAlertRequest(BaseModel):
    ticker: str = Field(..., min_length=1, max_length=16)
    name: Optional[str] = None
    side: str = Field(..., pattern="^(buy|sell)$")
    target_price: float = Field(..., gt=0)
    quantity: int = Field(..., gt=0)

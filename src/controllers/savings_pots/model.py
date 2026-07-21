"""
src/controllers/savings_pots/model.py
Pydantic schemas for Virtual Savings Pots.
"""
from __future__ import annotations

from typing import Optional
from pydantic import BaseModel


class CreatePotRequest(BaseModel):
    name: str
    target_amount: float
    allocated_amount: float = 0.0


class UpdatePotRequest(BaseModel):
    name: Optional[str] = None
    target_amount: Optional[float] = None
    allocated_amount: Optional[float] = None

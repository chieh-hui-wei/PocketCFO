"""
src/controllers/rebalance/model.py
Pydantic schemas for Portfolio Rebalance endpoints.
"""
from __future__ import annotations

from typing import Optional
from pydantic import BaseModel, Field


class UpdateRebalanceSettingsRequest(BaseModel):
    target_stock_pct: Optional[float] = Field(None, ge=0.0, le=100.0)
    target_bond_pct: Optional[float] = Field(None, ge=0.0, le=100.0)
    target_cash_pct: Optional[float] = Field(None, ge=0.0, le=100.0)
    stock_trigger_threshold: Optional[float] = Field(None, ge=0.0, le=100.0)
    stock_min_threshold: Optional[float] = Field(None, ge=0.0, le=100.0)
    bond_tickers: Optional[str] = None
    enable_email_alert: Optional[bool] = None

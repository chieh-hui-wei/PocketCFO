"""
src/controllers/price_alerts/model.py
Pydantic schemas for Price Alert (auto-trade / notify-only) endpoints.
"""
from __future__ import annotations

from typing import Optional
from pydantic import BaseModel, Field, model_validator

BROKERS_SUPPORTING_ORDERS = {"esun", "taishin"}


class CreatePriceAlertRequest(BaseModel):
    ticker: str = Field(..., min_length=1, max_length=16)
    name: Optional[str] = None
    alert_type: str = Field(default="auto_trade", pattern="^(auto_trade|notify_price|notify_ma20)$")
    side: Optional[str] = Field(default=None, pattern="^(buy|sell)$")
    quantity: Optional[int] = Field(default=None, gt=0)
    broker: Optional[str] = Field(default="esun", pattern="^(esun|taishin|sinopac)$")
    direction: Optional[str] = Field(default=None, pattern="^(above|below)$")
    target_price: float = Field(..., gt=0)

    @model_validator(mode="after")
    def validate_by_type(self) -> "CreatePriceAlertRequest":
        if self.alert_type == "auto_trade":
            if not self.side or not self.quantity:
                raise ValueError("到價自動下單需要提供 side 與 quantity")
            broker = self.broker or "esun"
            if broker not in BROKERS_SUPPORTING_ORDERS:
                raise ValueError(f"該券商尚未支援自動下單：{broker}")
        else:
            if not self.direction:
                raise ValueError("到價/均線通知需要提供 direction")
        return self

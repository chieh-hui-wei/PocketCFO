"""
src/controllers/category_rules/model.py
Pydantic schemas for merchant-to-category classification rules.
"""
from __future__ import annotations

from typing import Optional
from pydantic import BaseModel


class CreateRuleRequest(BaseModel):
    keyword: str
    category: str


class UpdateRuleRequest(BaseModel):
    keyword: Optional[str] = None
    category: Optional[str] = None

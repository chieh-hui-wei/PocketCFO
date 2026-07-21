"""
src/controllers/reports/model.py
Pydantic schemas for financial reports endpoints.
"""
from __future__ import annotations

from pydantic import BaseModel


class ReportComputeQuery(BaseModel):
    year: int
    month: int

"""
src/services/savings_pots/service.py
Service layer for virtual savings goals and cash calculation logic.
"""
from __future__ import annotations

import logging
from typing import Any
from src.dbs.models import SavingsPot

log = logging.getLogger(__name__)


class SavingsPotsService:
    @staticmethod
    def pot_to_dict(pot: SavingsPot) -> dict[str, Any]:
        return {
            "id": pot.id,
            "name": pot.name,
            "target_amount": pot.target_amount,
            "allocated_amount": pot.allocated_amount,
            "created_at": pot.created_at.isoformat() if pot.created_at else None,
        }

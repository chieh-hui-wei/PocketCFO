"""
src/services/category_rules/service.py
Service layer for managing transaction category classification rules.
"""
from __future__ import annotations

import logging
from typing import Any
from fastapi import HTTPException
from src.utils.category_classifier import VALID_CATEGORIES, CATEGORY_LABELS

log = logging.getLogger(__name__)


class CategoryRulesService:
    @staticmethod
    def validate_category(category: str) -> str:
        if category not in VALID_CATEGORIES:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid category '{category}'. Must be one of: {', '.join(VALID_CATEGORIES)}"
            )
        return category

    @staticmethod
    def rule_to_dict(rule: Any) -> dict[str, Any]:
        return {
            "id": rule.id,
            "keyword": rule.keyword,
            "category": rule.category,
            "category_label": CATEGORY_LABELS.get(rule.category, rule.category),
            "created_at": rule.created_at.isoformat() if rule.created_at else None,
        }

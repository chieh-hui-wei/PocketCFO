"""
src/controllers/category_rules.py
CRUD endpoints for user-defined merchant→category classification rules.
"""
from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from src.dbs.repository import CategoryRuleRepository
from src.instances.database import get_db
from src.middleware.auth import verify_token
from src.dbs.models import User
from src.utils.category_classifier import VALID_CATEGORIES, CATEGORY_LABELS

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/category-rules", tags=["Category Rules"])


# ── Request / Response schemas ─────────────────────────────────────────────────

class CreateRuleRequest(BaseModel):
    keyword: str
    category: str  # food / transport / medical / entertainment / salary / other


class UpdateRuleRequest(BaseModel):
    keyword: str | None = None
    category: str | None = None


def _validate_category(category: str) -> str:
    if category not in VALID_CATEGORIES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid category '{category}'. Must be one of: {', '.join(VALID_CATEGORIES)}"
        )
    return category


def _rule_to_dict(rule) -> dict[str, Any]:
    return {
        "id": rule.id,
        "keyword": rule.keyword,
        "category": rule.category,
        "category_label": CATEGORY_LABELS.get(rule.category, rule.category),
        "created_at": rule.created_at.isoformat() if rule.created_at else None,
    }


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("/")
async def list_rules(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(verify_token),
) -> dict[str, Any]:
    """List all category rules for the current user."""
    repo = CategoryRuleRepository(db, current_user.id)
    rules = await repo.list_all()
    return {
        "status": "ok",
        "rules": [_rule_to_dict(r) for r in rules],
        "categories": [
            {"key": k, "label": v} for k, v in CATEGORY_LABELS.items()
        ],
    }


@router.post("/")
async def create_rule(
    body: CreateRuleRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(verify_token),
) -> dict[str, Any]:
    """Create a new keyword → category rule."""
    _validate_category(body.category)
    if not body.keyword.strip():
        raise HTTPException(status_code=400, detail="Keyword cannot be empty")
    try:
        repo = CategoryRuleRepository(db, current_user.id)
        rule = await repo.create(body.keyword, body.category)
        await db.commit()
        return {"status": "ok", "rule": _rule_to_dict(rule)}
    except Exception as e:
        await db.rollback()
        if "UNIQUE" in str(e).upper():
            raise HTTPException(status_code=409, detail=f"Keyword '{body.keyword}' already exists")
        log.error(f"create_rule error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{rule_id}")
async def update_rule(
    rule_id: int,
    body: UpdateRuleRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(verify_token),
) -> dict[str, Any]:
    """Update a rule's keyword and/or category."""
    if body.category is not None:
        _validate_category(body.category)
    if body.keyword is not None and not body.keyword.strip():
        raise HTTPException(status_code=400, detail="Keyword cannot be empty")
    try:
        repo = CategoryRuleRepository(db, current_user.id)
        rule = await repo.update(rule_id, keyword=body.keyword, category=body.category)
        if not rule:
            raise HTTPException(status_code=404, detail="Rule not found")
        await db.commit()
        return {"status": "ok", "rule": _rule_to_dict(rule)}
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        log.error(f"update_rule error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{rule_id}")
async def delete_rule(
    rule_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(verify_token),
) -> dict[str, Any]:
    """Delete a category rule."""
    try:
        repo = CategoryRuleRepository(db, current_user.id)
        deleted = await repo.delete(rule_id)
        if not deleted:
            raise HTTPException(status_code=404, detail="Rule not found")
        await db.commit()
        return {"status": "ok"}
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        log.error(f"delete_rule error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/seed-defaults")
async def seed_default_rules(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(verify_token),
) -> dict[str, Any]:
    """Seed the built-in default keyword rules (skips any that already exist)."""
    try:
        repo = CategoryRuleRepository(db, current_user.id)
        added = await repo.seed_defaults()
        await db.commit()
        return {"status": "ok", "added": added}
    except Exception as e:
        await db.rollback()
        log.error(f"seed_default_rules error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

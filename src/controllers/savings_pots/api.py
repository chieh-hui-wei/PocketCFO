"""
src/controllers/savings_pots/api.py
Web API Router for Savings Pots endpoints.
"""
from __future__ import annotations

import logging
from typing import Any
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from src.instances.database import get_db
from src.middleware.auth import verify_token
from src.dbs.models import User, SavingsPot, Account, AccountSnapshot, AccountType
from src.controllers.savings_pots.model import CreatePotRequest, UpdatePotRequest
from src.services.savings_pots.service import SavingsPotsService

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/savings-pots", tags=["Savings Pots"])


@router.get("/")
async def list_pots(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(verify_token),
) -> dict[str, Any]:
    """List all savings pots for the current user alongside the latest known total cash balance."""
    try:
        stmt = select(SavingsPot).where(SavingsPot.user_id == current_user.id).order_by(SavingsPot.created_at.desc())
        res = await db.execute(stmt)
        pots = res.scalars().all()

        stmt_latest_period = select(AccountSnapshot.period_date).join(Account).where(
            AccountSnapshot.user_id == current_user.id,
            Account.account_type == AccountType.BANK
        ).order_by(AccountSnapshot.period_date.desc()).limit(1)
        res_latest_period = await db.execute(stmt_latest_period)
        latest_period = res_latest_period.scalar_one_or_none()

        stmt_accts = select(Account).where(
            Account.user_id == current_user.id,
            Account.account_type == AccountType.BANK
        )
        res_accts = await db.execute(stmt_accts)
        bank_accounts = res_accts.scalars().all()
        
        total_cash = 0.0
        missing_accounts = []
        
        if latest_period:
            for acct in bank_accounts:
                stmt_snap = select(AccountSnapshot.balance).where(
                    AccountSnapshot.account_id == acct.id,
                    AccountSnapshot.user_id == current_user.id,
                    AccountSnapshot.period_date == latest_period
                )
                res_snap = await db.execute(stmt_snap)
                bal = res_snap.scalar_one_or_none()
                if bal is not None:
                    total_cash += bal
                else:
                    label = f"{acct.institution} - {acct.name}" if acct.institution else acct.name
                    missing_accounts.append(label)

        return {
            "status": "ok",
            "pots": [SavingsPotsService.pot_to_dict(p) for p in pots],
            "total_cash": total_cash,
            "latest_period": latest_period.strftime("%Y-%m") if latest_period else None,
            "missing_accounts": missing_accounts
        }
    except Exception as e:
        log.error(f"list_pots error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/")
async def create_pot(
    body: CreatePotRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(verify_token),
) -> dict[str, Any]:
    """Create a new savings pot."""
    if not body.name.strip():
        raise HTTPException(status_code=400, detail="Name cannot be empty")
    if body.target_amount < 0:
        raise HTTPException(status_code=400, detail="Target amount cannot be negative")
    if body.allocated_amount < 0:
        raise HTTPException(status_code=400, detail="Allocated amount cannot be negative")

    try:
        pot = SavingsPot(
            user_id=current_user.id,
            name=body.name,
            target_amount=body.target_amount,
            allocated_amount=body.allocated_amount
        )
        db.add(pot)
        await db.commit()
        await db.refresh(pot)
        return {"status": "ok", "pot": SavingsPotsService.pot_to_dict(pot)}
    except Exception as e:
        await db.rollback()
        log.error(f"create_pot error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{pot_id}")
async def update_pot(
    pot_id: int,
    body: UpdatePotRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(verify_token),
) -> dict[str, Any]:
    """Update a savings pot's name, target, and/or allocated amount."""
    try:
        stmt = select(SavingsPot).where(SavingsPot.id == pot_id, SavingsPot.user_id == current_user.id)
        res = await db.execute(stmt)
        pot = res.scalar_one_or_none()
        if not pot:
            raise HTTPException(status_code=404, detail="Savings pot not found")

        if body.name is not None:
            if not body.name.strip():
                raise HTTPException(status_code=400, detail="Name cannot be empty")
            pot.name = body.name
        if body.target_amount is not None:
            if body.target_amount < 0:
                raise HTTPException(status_code=400, detail="Target amount cannot be negative")
            pot.target_amount = body.target_amount
        if body.allocated_amount is not None:
            if body.allocated_amount < 0:
                raise HTTPException(status_code=400, detail="Allocated amount cannot be negative")
            pot.allocated_amount = body.allocated_amount

        await db.commit()
        await db.refresh(pot)
        return {"status": "ok", "pot": SavingsPotsService.pot_to_dict(pot)}
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        log.error(f"update_pot error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{pot_id}")
async def delete_pot(
    pot_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(verify_token),
) -> dict[str, Any]:
    """Delete a savings pot."""
    try:
        stmt = select(SavingsPot).where(SavingsPot.id == pot_id, SavingsPot.user_id == current_user.id)
        res = await db.execute(stmt)
        pot = res.scalar_one_or_none()
        if not pot:
            raise HTTPException(status_code=404, detail="Savings pot not found")

        await db.delete(pot)
        await db.commit()
        return {"status": "ok"}
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        log.error(f"delete_pot error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

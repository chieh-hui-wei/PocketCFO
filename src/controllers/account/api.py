"""
src/controllers/account/api.py
Web API Router for Account Management endpoints.
"""
from __future__ import annotations

import calendar
import re
import time
from datetime import datetime
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy import select, delete as sa_delete
from sqlalchemy.ext.asyncio import AsyncSession

from src.dbs.models import Account, AccountType, AccountSnapshot, Security, Transaction, User
from src.dbs.repository import AccountRepository, SnapshotRepository
from src.instances.database import get_db
from src.middleware.auth import verify_token
from src.controllers.account.model import (
    CreateAccountRequest,
    SaveSnapshotRequest,
    SaveSecurityRequest,
    SaveSecuritiesForAccountRequest,
    UpdateAccountRequest,
)
from src.services.account.service import AccountService
from src.services.reports.income_statement import IncomeStatementService
from src.services.reports.balance_sheet import BalanceSheetService
from src.services.reports.stock_holding import StockHoldingService
from src.utils.date_utils import first_of_month

router = APIRouter(prefix="/accounts", tags=["accounts"])


@router.get("/")
async def list_accounts(
    include_all: bool = Query(False, description="Include credit cards and liabilities"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(verify_token),
):
    repo = AccountRepository(db, current_user.id)
    accounts = await repo.get_all()
    return [
        {
            "id": a.id,
            "code": a.code,
            "name": a.name,
            "type": a.account_type,
            "institution": a.institution,
            "currency": a.currency,
            "is_internal": a.is_internal,
            "is_installment": getattr(a, "is_installment", False),
            "installment_amount": getattr(a, "installment_amount", 0.0),
        }
        for a in accounts
        if include_all or a.account_type not in (AccountType.CREDIT_CARD, AccountType.LIABILITY)
    ]


@router.post("/")
async def create_account(
    body: CreateAccountRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(verify_token),
):
    repo = AccountRepository(db, current_user.id)
    
    code = body.code
    if code:
        code = re.sub(r'[^0-9]', '', str(code))
    if not code:
        code = f"manual_{body.account_type.value}_{int(time.time())}"
        
    data = body.model_dump()
    data["code"] = code
    account = Account(**data)
    created = await repo.create(account)
    return {
        "id": created.id,
        "code": created.code,
        "name": created.name,
        "type": created.account_type,
        "institution": created.institution,
        "currency": created.currency,
        "is_internal": created.is_internal,
        "is_installment": getattr(created, "is_installment", False),
        "installment_amount": getattr(created, "installment_amount", 0.0),
    }


@router.get("/securities/history")
async def list_securities_history(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(verify_token),
):
    stmt = (
        select(Security)
        .where(Security.user_id == current_user.id)
        .order_by(Security.period_date.desc(), Security.ticker.asc())
    )
    result = await db.execute(stmt)
    securities = result.scalars().all()

    # The sync scheduler writes a new Security snapshot every day it runs, keyed by
    # that day's date, without clearing prior days within the same month. Pick the
    # month-end snapshot per (account_id, ticker, year, month) if present; otherwise
    # fall back to the latest day actually recorded within that month. This keeps a
    # month's total reflecting one snapshot instead of summing every daily sync.
    latest_by_key = {}
    for sec in securities:
        key = (sec.account_id, sec.ticker, sec.period_date.year, sec.period_date.month)
        month_end_day = calendar.monthrange(sec.period_date.year, sec.period_date.month)[1]
        is_month_end = sec.period_date.day == month_end_day
        current = latest_by_key.get(key)
        if current is None:
            latest_by_key[key] = sec
            continue
        current_is_month_end = current.period_date.day == calendar.monthrange(current.period_date.year, current.period_date.month)[1]
        if is_month_end and not current_is_month_end:
            latest_by_key[key] = sec
        elif is_month_end == current_is_month_end and sec.period_date > current.period_date:
            latest_by_key[key] = sec
    securities = sorted(latest_by_key.values(), key=lambda s: (s.period_date, s.ticker), reverse=True)

    acc_stmt = select(Account.id, Account.name).where(Account.user_id == current_user.id)
    acc_res = await db.execute(acc_stmt)
    acc_map = {row.id: row.name for row in acc_res.all()}

    output = []
    for sec in securities:
        # sec.market_value / sec.unrealized_pnl are already TWD-converted at write time
        # (see stock_holding.py and the manual statement upload endpoint); sec.exchange_rate
        # is kept only for reference/back-conversion of the original_* fields, not for
        # reapplying to market_value here.
        output.append({
            "id": sec.id,
            "account_id": sec.account_id,
            "account_name": acc_map.get(sec.account_id, "Unknown"),
            "period_date": str(sec.period_date),
            "ticker": sec.ticker,
            "name": sec.name,
            "quantity": sec.quantity,
            "avg_cost": sec.avg_cost,
            "current_price": sec.current_price,
            "market_value": sec.market_value,
            "unrealized_pnl": sec.unrealized_pnl,
            "original_avg_cost": sec.original_avg_cost,
            "original_current_price": sec.original_current_price,
            "original_market_value": sec.original_market_value,
            "original_unrealized_pnl": sec.original_unrealized_pnl,
            "currency": sec.currency or "TWD",
            "exchange_rate": sec.exchange_rate or 1.0,
            "created_at": str(sec.created_at) if sec.created_at else None,
        })
    return output


@router.get("/snapshots")
async def list_snapshots_for_period(
    year: int = Query(..., ge=2020, le=2100),
    month: int = Query(..., ge=1, le=12),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(verify_token),
):
    period = first_of_month(year, month)
    acc_repo = AccountRepository(db, current_user.id)
    snap_repo = SnapshotRepository(db, current_user.id)

    accounts = await acc_repo.get_all()
    snapshots = await snap_repo.get_by_period(period)
    snap_map = {s.account_id: s for s in snapshots}

    result = []
    for a in accounts:
        snap = snap_map.get(a.id)
        result.append({
            "id": a.id,
            "code": a.code,
            "name": a.name,
            "type": a.account_type,
            "institution": a.institution,
            "currency": a.currency,
            "is_internal": a.is_internal,
            "balance": snap.balance if snap else None,
            "has_snapshot": snap is not None,
            "snapshot_source": snap.source if snap else None,
        })
    return result


@router.post("/{account_id}/snapshots")
async def save_snapshot(
    account_id: int,
    body: SaveSnapshotRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(verify_token),
):
    snap_repo = SnapshotRepository(db, current_user.id)
    try:
        from datetime import date
        period = date.fromisoformat(body.period_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format, expected YYYY-MM-DD")

    snapshot = await snap_repo.upsert(
        AccountSnapshot(
            account_id=account_id,
            period_date=period,
            balance=body.balance,
            source="manual",
        )
    )
    bs_service = BalanceSheetService(db, current_user.id)
    await bs_service.compute(period.year, period.month)
    await db.commit()
    return {"status": "success", "snapshot_id": snapshot.id}


@router.delete("/{account_id}/snapshots/{period_date}")
async def delete_snapshot(
    account_id: int,
    period_date: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(verify_token),
):
    try:
        from datetime import date
        period = date.fromisoformat(period_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format, expected YYYY-MM-DD")

    stmt = sa_delete(AccountSnapshot).where(
        AccountSnapshot.account_id == account_id,
        AccountSnapshot.period_date == period,
    )
    result = await db.execute(stmt)
    bs_service = BalanceSheetService(db, current_user.id)
    await bs_service.compute(period.year, period.month)
    await db.commit()
    return {"status": "deleted", "count": result.rowcount}


@router.get("/securities")
async def list_securities_for_period(
    year: int = Query(..., ge=2020, le=2100),
    month: int = Query(..., ge=1, le=12),
    date_str: str | None = Query(None, alias="date"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(verify_token),
):
    if date_str:
        try:
            target_date = datetime.strptime(date_str, "%Y-%m-%d").date()
        except ValueError:
            target_date = first_of_month(year, month)
    else:
        target_date = first_of_month(year, month)

    stock_service = StockHoldingService(db, current_user.id)
    return await stock_service.get_holdings_for_period(target_date)


@router.post("/{account_id}/securities")
async def save_securities_for_account(
    account_id: int,
    body: SaveSecuritiesForAccountRequest,
    period_date: str = Query(..., description="YYYY-MM-DD format"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(verify_token),
):
    try:
        from datetime import date
        period = date.fromisoformat(period_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format, expected YYYY-MM-DD")

    acc_repo = AccountRepository(db, current_user.id)
    account = await acc_repo.get_by_id(account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    is_foreign = bool(account.currency) and account.currency != "TWD"
    rate = 1.0
    if is_foreign:
        from src.services.exchange_rate.service import get_currency_twd_rate
        try:
            rate = await get_currency_twd_rate(period, from_currency=account.currency)
        except Exception:
            rate = 32.5

    await db.execute(sa_delete(Security).where(
        Security.account_id == account_id,
        Security.period_date == period
    ))

    new_secs = []
    total_market_val = 0.0
    for s in body.securities:
        # Values submitted from the editor are always in the account's native currency
        avg_cost_orig = s.avg_cost or 0.0
        price_orig = s.current_price or 0.0
        m_val_orig = s.quantity * price_orig
        unrealized_orig = m_val_orig - (s.quantity * avg_cost_orig)

        m_val = round(m_val_orig * rate)
        unrealized = round(unrealized_orig * rate)
        sec = Security(
            user_id=current_user.id,
            account_id=account_id,
            period_date=period,
            ticker=s.ticker,
            name=s.name or s.ticker,
            quantity=s.quantity,
            avg_cost=round(avg_cost_orig * rate),
            current_price=round(price_orig * rate),
            market_value=m_val,
            unrealized_pnl=unrealized,
            original_avg_cost=avg_cost_orig if is_foreign else None,
            original_current_price=price_orig if is_foreign else None,
            original_market_value=m_val_orig if is_foreign else None,
            original_unrealized_pnl=unrealized_orig if is_foreign else None,
            currency=account.currency,
            exchange_rate=rate,
        )
        db.add(sec)
        new_secs.append(sec)
        total_market_val += m_val

    snap_repo = SnapshotRepository(db, current_user.id)
    await snap_repo.upsert(
        AccountSnapshot(
            account_id=account_id,
            period_date=period,
            balance=total_market_val,
            source="manual",
        )
    )

    bs_service = BalanceSheetService(db, current_user.id)
    await bs_service.compute(period.year, period.month)
    await db.commit()
    return {"status": "success", "count": len(new_secs)}


@router.put("/{account_id}")
async def update_account(
    account_id: int,
    body: UpdateAccountRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(verify_token),
):
    repo = AccountRepository(db, current_user.id)
    account = await repo.get_by_id(account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    transfer_rules_changed = False
    name_or_institution_changed = False

    if body.name is not None and body.name != account.name:
        account.name = body.name
        name_or_institution_changed = True
    if body.account_type is not None and body.account_type != account.account_type:
        account.account_type = body.account_type
        name_or_institution_changed = True
    if body.institution is not None and body.institution != account.institution:
        account.institution = body.institution
        name_or_institution_changed = True
    if body.currency is not None and body.currency != account.currency:
        account.currency = body.currency
        name_or_institution_changed = True
    if body.is_internal is not None and body.is_internal != account.is_internal:
        account.is_internal = body.is_internal
        transfer_rules_changed = True
    if body.code is not None:
        clean_code = re.sub(r'[^0-9]', '', str(body.code))
        if clean_code and clean_code != account.code:
            stmt = select(Account).where(
                Account.code == clean_code,
                Account.id != account_id,
                Account.user_id == current_user.id
            )
            result = await db.execute(stmt)
            existing = result.scalars().first()
            if existing:
                raise HTTPException(status_code=400, detail="Account number/code already exists")
            account.code = clean_code
            transfer_rules_changed = True
    if body.notes is not None and body.notes != account.notes:
        account.notes = body.notes
        transfer_rules_changed = True
    if body.is_installment is not None and body.is_installment != account.is_installment:
        account.is_installment = body.is_installment
        name_or_institution_changed = True
    if body.installment_amount is not None and body.installment_amount != account.installment_amount:
        account.installment_amount = body.installment_amount
        name_or_institution_changed = True

    await db.flush()

    if transfer_rules_changed:
        await AccountService.reclassify_and_recompute_all(db, current_user.id)
    elif name_or_institution_changed:
        stmt = select(AccountSnapshot.period_date).where(
            AccountSnapshot.user_id == current_user.id,
            AccountSnapshot.account_id == account_id
        )
        res = await db.execute(stmt)
        periods = res.scalars().all()
        if periods:
            is_service = IncomeStatementService(db, current_user.id)
            bs_service = BalanceSheetService(db, current_user.id)
            for period in sorted(set(periods)):
                await is_service.compute(period.year, period.month)
                await bs_service.compute(period.year, period.month)

    await db.commit()
    return {"status": "success"}


@router.delete("/{account_id}")
async def delete_account(
    account_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(verify_token),
):
    repo = AccountRepository(db, current_user.id)
    account = await repo.get_by_id(account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    await db.execute(sa_delete(Security).where(Security.account_id == account_id))
    await db.execute(sa_delete(AccountSnapshot).where(AccountSnapshot.account_id == account_id))
    await db.execute(sa_delete(Transaction).where(Transaction.account_id == account_id))
    await db.delete(account)
    await db.flush()
    await AccountService.reclassify_and_recompute_all(db, current_user.id)
    await db.commit()
    return {"status": "success"}

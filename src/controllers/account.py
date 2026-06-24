"""
src/controllers/account_controller.py
Account management endpoints.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from src.dbs.models import Account, AccountType, User
from src.dbs.repository import AccountRepository, SnapshotRepository
from src.instances.database import get_db
from src.middleware.auth import verify_token

router = APIRouter(prefix="/accounts", tags=["accounts"])


class CreateAccountRequest(BaseModel):
    code: str | None = None
    name: str
    account_type: AccountType
    institution: str
    currency: str = "TWD"
    is_internal: bool = True
    notes: str | None = None


class SaveSnapshotRequest(BaseModel):
    period_date: str
    balance: float


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
    if not code:
        import time
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
    }


@router.get("/securities/history")
async def list_securities_history(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(verify_token),
):
    from sqlalchemy import select
    from src.dbs.models import Security
    from sqlalchemy.orm import joinedload
    
    stmt = (
        select(Security)
        .options(joinedload(Security.account))
        .where(Security.user_id == current_user.id)
        .order_by(Security.period_date.asc())
    )
    result = await db.execute(stmt)
    securities = result.scalars().all()
    
    return [
        {
            "id": s.id,
            "account_id": s.account_id,
            "account_name": s.account.name if s.account else "Unknown Broker",
            "period_date": s.period_date.isoformat(),
            "ticker": s.ticker,
            "name": s.name,
            "quantity": s.quantity,
            "avg_cost": s.avg_cost,
            "current_price": s.current_price,
            "market_value": s.market_value,
            "unrealized_pnl": s.unrealized_pnl,
            "original_avg_cost": s.original_avg_cost,
            "original_current_price": s.original_current_price,
            "original_market_value": s.original_market_value,
            "original_unrealized_pnl": s.original_unrealized_pnl,
            "currency": s.currency,
            "exchange_rate": s.exchange_rate,
        }
        for s in securities
    ]


@router.get("/securities/export")
async def export_securities_history(
    year: int = Query(..., ge=2020, le=2100),
    account_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(verify_token),
):
    from datetime import date
    from sqlalchemy import select
    from src.dbs.models import Security
    from sqlalchemy.orm import joinedload
    import io
    import csv
    from fastapi.responses import StreamingResponse
    from fastapi import HTTPException
    
    try:
        start_date = date(year, 1, 1)
        end_date = date(year, 12, 31)
        
        stmt = (
            select(Security)
            .options(joinedload(Security.account))
            .where(
                Security.period_date >= start_date,
                Security.period_date <= end_date,
                Security.user_id == current_user.id
            )
            .order_by(Security.period_date.asc())
        )
        if account_id is not None:
            stmt = stmt.where(Security.account_id == account_id)
            
        result = await db.execute(stmt)
        securities = result.scalars().all()
        
        tickers_in_year = sorted(list(set(s.ticker for s in securities)))
        ticker_names = {}
        for s in securities:
            ticker_names[s.ticker] = s.name or s.ticker
            
        by_ticker_month = {}
        by_ticker_pnl = {}
        
        for s in securities:
            m = s.period_date.month
            key = (s.ticker, m)
            by_ticker_month[key] = by_ticker_month.get(key, 0.0) + s.market_value
            by_ticker_pnl[key] = by_ticker_pnl.get(key, 0.0) + s.unrealized_pnl
            
        ticker_rows = []
        for ticker in tickers_in_year:
            name = ticker_names[ticker]
            monthly_vals = []
            for m in range(1, 13):
                monthly_vals.append(by_ticker_month.get((ticker, m), 0.0))
            max_val = max(monthly_vals) if monthly_vals else 0.0
            ticker_rows.append({
                "ticker": ticker,
                "name": name,
                "values": monthly_vals,
                "max_val": max_val
            })
            
        ticker_rows.sort(key=lambda r: r["max_val"], reverse=True)
        
        monthly_totals = []
        monthly_pnls = []
        for m in range(1, 13):
            total_mv = sum(by_ticker_month.get((t, m), 0.0) for t in tickers_in_year)
            total_pnl = sum(by_ticker_pnl.get((t, m), 0.0) for t in tickers_in_year)
            monthly_totals.append(total_mv)
            monthly_pnls.append(total_pnl)
            
        stream = io.StringIO()
        writer = csv.writer(stream)
        
        headers = ["標的代號", "標的名稱"] + [f"{m}月" for m in range(1, 13)]
        writer.writerow(headers)
        
        for row in ticker_rows:
            writer.writerow([row["ticker"], row["name"]] + row["values"])
            
        writer.writerow(["總股票市值", ""] + monthly_totals)
        writer.writerow(["累計未實現損益", ""] + monthly_pnls)
        
        csv_content = "\ufeff" + stream.getvalue()
        
        if account_id is not None:
            filename = f"securities_{year}_account_{account_id}_annual.csv"
        else:
            filename = f"securities_{year}_annual.csv"
            
        return StreamingResponse(
            io.BytesIO(csv_content.encode("utf-8")),
            media_type="text/csv",
            headers={
                "Content-Disposition": f"attachment; filename={filename}",
                "Access-Control-Expose-Headers": "Content-Disposition"
            }
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{account_id}/history")
async def account_snapshot_history(
    account_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(verify_token),
):
    repo = SnapshotRepository(db, current_user.id)
    snaps = await repo.get_history(account_id, limit=24)
    return [
        {"period": s.period_date.isoformat(), "balance": s.balance, "source": s.source}
        for s in snaps
    ]


@router.get("/snapshots")
async def list_account_snapshots_for_period(
    year: int = Query(..., ge=2020, le=2100),
    month: int = Query(..., ge=1, le=12),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(verify_token),
):
    from src.utils.date_utils import first_of_month
    acct_repo = AccountRepository(db, current_user.id)
    snap_repo = SnapshotRepository(db, current_user.id)
    
    period = first_of_month(year, month)
    accounts = await acct_repo.get_all()
    snapshots = await snap_repo.get_by_period(period)
    
    snap_map = {s.account_id: s for s in snapshots}
    
    return [
        {
            "id": a.id,
            "code": a.code,
            "name": a.name,
            "type": a.account_type,
            "institution": a.institution,
            "currency": a.currency,
            "is_internal": a.is_internal,
            "balance": snap_map[a.id].balance if a.id in snap_map else None,
            "has_snapshot": a.id in snap_map,
            "snapshot_source": snap_map[a.id].source if a.id in snap_map else None,
        }
        for a in accounts
    ]


@router.post("/{account_id}/snapshots")
async def save_snapshot(
    account_id: int,
    body: SaveSnapshotRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(verify_token),
):
    from datetime import datetime
    from src.dbs.models import AccountSnapshot
    from src.services.reports.balance_sheet import BalanceSheetService
    from src.utils.date_utils import first_of_month
    
    repo = SnapshotRepository(db, current_user.id)
    acct_repo = AccountRepository(db, current_user.id)
    
    account = await acct_repo.get_by_id(account_id)
    if not account:
        return {"error": "Account not found"}, 404
        
    try:
        dt = datetime.strptime(body.period_date, "%Y-%m-%d").date()
    except ValueError:
        return {"error": "Invalid date format, must be YYYY-MM-DD"}, 400
        
    period = first_of_month(dt.year, dt.month)
    
    # Store credit card and liability snapshots as negative balances to be consistent
    balance = body.balance
    if account.account_type in (AccountType.CREDIT_CARD, AccountType.LIABILITY):
        if balance > 0:
            balance = -balance
            
    snapshot = AccountSnapshot(
        user_id=current_user.id,
        account_id=account_id,
        period_date=period,
        balance=balance,
        source="manual"
    )
    
    await repo.upsert(snapshot)
    await db.flush()
    
    # Recompute balance sheet for this month
    bs_service = BalanceSheetService(db, current_user.id)
    await bs_service.compute(period.year, period.month)
    
    return {"status": "success", "period": period.isoformat(), "balance": balance}


@router.delete("/{account_id}/snapshots/{period_str}")
async def delete_account_snapshot(
    account_id: int,
    period_str: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(verify_token),
):
    from sqlalchemy import delete
    from src.dbs.models import AccountSnapshot
    from datetime import datetime
    from src.utils.date_utils import first_of_month
    from src.services.reports.balance_sheet import BalanceSheetService
    
    try:
        dt = datetime.strptime(period_str, "%Y-%m-%d").date()
    except ValueError:
        return {"error": "Invalid date format, must be YYYY-MM-DD"}, 400
        
    period = first_of_month(dt.year, dt.month)
    
    stmt = delete(AccountSnapshot).where(
        AccountSnapshot.account_id == account_id,
        AccountSnapshot.period_date == period,
        AccountSnapshot.user_id == current_user.id
    )
    result = await db.execute(stmt)
    await db.flush()
    
    # Recompute balance sheet for this month
    bs_service = BalanceSheetService(db, current_user.id)
    await bs_service.compute(period.year, period.month)
    
    return {"status": "deleted", "count": result.rowcount}


class SaveSecurityRequest(BaseModel):
    ticker: str
    name: str | None = None
    quantity: float
    avg_cost: float | None = None
    current_price: float | None = None


class SaveSecuritiesForAccountRequest(BaseModel):
    securities: list[SaveSecurityRequest]


@router.get("/securities")
async def list_securities_for_period(
    year: int = Query(..., ge=2020, le=2100),
    month: int = Query(..., ge=1, le=12),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(verify_token),
):
    from src.utils.date_utils import first_of_month
    from src.services.reports.stock_holding import StockHoldingService
    
    period = first_of_month(year, month)
    holding_service = StockHoldingService(db, current_user.id)
    _, securities = await holding_service.get_or_compute_portfolio(period)
    
    return [
        {
            "id": s.id,
            "account_id": s.account_id,
            "period_date": s.period_date.isoformat(),
            "ticker": s.ticker,
            "name": s.name,
            "quantity": s.quantity,
            "avg_cost": s.avg_cost,
            "current_price": s.current_price,
            "market_value": s.market_value,
            "unrealized_pnl": s.unrealized_pnl,
            "original_avg_cost": s.original_avg_cost,
            "original_current_price": s.original_current_price,
            "original_market_value": s.original_market_value,
            "original_unrealized_pnl": s.original_unrealized_pnl,
            "currency": s.currency,
            "exchange_rate": s.exchange_rate,
        }
        for s in securities
    ]


@router.post("/{account_id}/securities")
async def save_securities_for_account(
    account_id: int,
    body: SaveSecuritiesForAccountRequest,
    period_date: str = Query(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(verify_token),
):
    from datetime import datetime, timedelta
    from sqlalchemy import delete, select
    from src.dbs.models import Security, AccountSnapshot, Transaction
    from src.dbs.repository import AccountRepository, SnapshotRepository
    from src.utils.date_utils import first_of_month
    from src.services.reports.balance_sheet import BalanceSheetService
    from src.services.exchange_rate import get_usd_twd_rate
    from src.utils.stock_utils import fetch_month_end_price, normalize_stock_name
    
    acct_repo = AccountRepository(db, current_user.id)
    account = await acct_repo.get_by_id(account_id)
    if not account:
        return {"error": "Account not found"}, 404
        
    try:
        dt = datetime.strptime(period_date, "%Y-%m-%d").date()
    except ValueError:
        return {"error": "Invalid date format, must be YYYY-MM-DD"}, 400
        
    period = first_of_month(dt.year, dt.month)
    
    # Query existing securities to calculate old market value in TWD
    old_secs_stmt = select(Security).where(
        Security.account_id == account_id,
        Security.period_date == period,
        Security.user_id == current_user.id
    )
    old_secs_res = await db.execute(old_secs_stmt)
    old_secs = old_secs_res.scalars().all()
    old_secs_mv_twd = sum(s.market_value for s in old_secs)
    
    # 1. Delete all existing securities for this account and period
    await db.execute(
        delete(Security).where(
            Security.account_id == account_id,
            Security.period_date == period,
            Security.user_id == current_user.id
        )
    )
    
    # Resolve exchange rate
    currency = account.currency or "TWD"
    exchange_rate = 1.0
    if currency == "USD":
        exchange_rate = await get_usd_twd_rate(period)
        
    total_market_value_twd = 0.0
    
    # 2. Insert new securities
    for s in body.securities:
        qty = s.quantity
        avg_cost_orig = s.avg_cost or 0.0
        
        # Resolve current price
        price_orig = s.current_price
        if not price_orig or price_orig == 0.0:
            # Auto-fetch month-end price from Yahoo Finance
            fetched_price = await fetch_month_end_price(s.ticker, period)
            if fetched_price is not None:
                price_orig = fetched_price
            else:
                price_orig = avg_cost_orig
                
        mv_orig = qty * price_orig
        pnl_orig = (price_orig - avg_cost_orig) * qty
        
        # Calculate TWD equivalents
        if currency == "USD":
            price_twd = round(price_orig * exchange_rate)
            avg_cost_twd = round(avg_cost_orig * exchange_rate)
            mv_twd = round(mv_orig * exchange_rate)
            pnl_twd = round(pnl_orig * exchange_rate)
            
            sec = Security(
                user_id=current_user.id,
                account_id=account_id,
                period_date=period,
                ticker=s.ticker,
                name=normalize_stock_name(s.ticker, s.name or s.ticker),
                quantity=qty,
                avg_cost=avg_cost_twd,
                current_price=price_twd,
                market_value=mv_twd,
                unrealized_pnl=pnl_twd,
                original_avg_cost=avg_cost_orig,
                original_current_price=price_orig,
                original_market_value=mv_orig,
                original_unrealized_pnl=pnl_orig,
                currency=currency,
                exchange_rate=exchange_rate
            )
        else:
            sec = Security(
                user_id=current_user.id,
                account_id=account_id,
                period_date=period,
                ticker=s.ticker,
                name=normalize_stock_name(s.ticker, s.name or s.ticker),
                quantity=qty,
                avg_cost=round(avg_cost_orig),
                current_price=round(price_orig),
                market_value=round(mv_orig),
                unrealized_pnl=round(pnl_orig),
                currency=currency,
                exchange_rate=1.0
            )
            mv_twd = round(mv_orig)
            
        db.add(sec)
        total_market_value_twd += mv_twd
        
    await db.flush()
    
    # 3. Update the AccountSnapshot for this brokerage account
    snap_repo = SnapshotRepository(db, current_user.id)
    existing_snap_stmt = select(AccountSnapshot).where(
        AccountSnapshot.account_id == account_id,
        AccountSnapshot.period_date == period,
        AccountSnapshot.user_id == current_user.id
    )
    existing_snap_res = await db.execute(existing_snap_stmt)
    existing_snap = existing_snap_res.scalar_one_or_none()
    
    if existing_snap:
        # Retain cash portion, adjust total balance
        cash_twd = max(existing_snap.balance - old_secs_mv_twd, 0.0)
        new_balance_twd = cash_twd + total_market_value_twd
    else:
        # Carry over cash from previous snapshots + transactions
        prev_snap_stmt = (
            select(AccountSnapshot)
            .where(
                AccountSnapshot.account_id == account_id,
                AccountSnapshot.period_date < period,
                AccountSnapshot.user_id == current_user.id
            )
            .order_by(AccountSnapshot.period_date.desc())
            .limit(1)
        )
        prev_snap_res = await db.execute(prev_snap_stmt)
        prev_snap = prev_snap_res.scalar_one_or_none()
        
        if prev_snap:
            prev_secs_stmt = select(Security).where(
                Security.account_id == account_id,
                Security.period_date == prev_snap.period_date,
                Security.user_id == current_user.id
            )
            prev_secs_res = await db.execute(prev_secs_stmt)
            prev_secs = prev_secs_res.scalars().all()
            prev_secs_mv_twd = sum(s.market_value for s in prev_secs)
            prev_cash_twd = max(prev_snap.balance - prev_secs_mv_twd, 0.0)
            
            # Sum transactions in between
            import calendar
            last_day = calendar.monthrange(period.year, period.month)[1]
            end_date = period.replace(day=last_day)
            txns_stmt = select(Transaction).where(
                Transaction.account_id == account_id,
                Transaction.txn_date >= (prev_snap.period_date + timedelta(days=1)),
                Transaction.txn_date <= end_date,
                Transaction.user_id == current_user.id
            )
            txns_res = await db.execute(txns_stmt)
            txns = txns_res.scalars().all()
            for txn in txns:
                prev_cash_twd += txn.amount
                
            new_balance_twd = prev_cash_twd + total_market_value_twd
        else:
            new_balance_twd = total_market_value_twd
            
    snapshot = AccountSnapshot(
        user_id=current_user.id,
        account_id=account_id,
        period_date=period,
        balance=round(new_balance_twd),
        original_balance=new_balance_twd / exchange_rate if currency != "TWD" and exchange_rate > 0 else None,
        currency=currency,
        exchange_rate=exchange_rate,
        source="manual"
    )
    await snap_repo.upsert(snapshot)
    await db.flush()
    
    # 4. Recompute Balance Sheet
    bs_service = BalanceSheetService(db, current_user.id)
    await bs_service.compute(period.year, period.month)
    
    return {"status": "success", "total_market_value": total_market_value_twd}


class UpdateAccountRequest(BaseModel):
    name: str | None = None
    account_type: AccountType | None = None
    institution: str | None = None
    currency: str | None = None
    is_internal: bool | None = None
    code: str | None = None
    notes: str | None = None


async def reclassify_and_recompute_all(db: AsyncSession, user_id: int):
    from sqlalchemy import select
    from src.dbs.models import Account, Transaction, TransactionCategory, AccountSnapshot
    from src.utils.transfer_detector import TransferDetector
    from src.services.reports.income_statement import IncomeStatementService
    from src.services.reports.balance_sheet import BalanceSheetService

    # 1. Fetch all user accounts
    result_accs = await db.execute(select(Account).where(Account.user_id == user_id, Account.is_active == True))
    accounts = result_accs.scalars().all()
    
    internal_aids = []
    for a in accounts:
        if a.is_internal:
            internal_aids.append(a.code)
            if "_" in a.code:
                internal_aids.append(a.code.split("_")[-1])
            if a.notes:
                internal_aids.append(a.notes)
                
    detector = TransferDetector(list(set(internal_aids)))

    # 2. Fetch and update all transactions
    result_txns = await db.execute(select(Transaction).where(Transaction.user_id == user_id))
    txns = result_txns.scalars().all()
    
    affected_periods = set()
    for txn in txns:
        is_transfer = detector.is_internal_transfer(txn.description)
        old_is_transfer = txn.is_internal_transfer
        old_category = txn.category
        
        txn.is_internal_transfer = is_transfer
        if is_transfer:
            if txn.amount > 0:
                txn.category = TransactionCategory.TRANSFER_IN
            else:
                txn.category = TransactionCategory.TRANSFER_OUT
        else:
            if old_category in (TransactionCategory.TRANSFER_IN, TransactionCategory.TRANSFER_OUT):
                if txn.amount < 0:
                    txn.category = TransactionCategory.EXPENSE
                else:
                    txn.category = TransactionCategory.OTHER

        if txn.is_internal_transfer != old_is_transfer or txn.category != old_category:
            db.add(txn)
            affected_periods.add((txn.txn_date.year, txn.txn_date.month))

    # 3. Add periods from snapshots to ensure we recompute reports (since names/codes might have changed)
    result_snaps = await db.execute(select(AccountSnapshot).where(AccountSnapshot.user_id == user_id))
    snaps = result_snaps.scalars().all()
    for snap in snaps:
        affected_periods.add((snap.period_date.year, snap.period_date.month))

    # 4. Recompute reports for all periods
    if affected_periods:
        is_service = IncomeStatementService(db, user_id)
        bs_service = BalanceSheetService(db, user_id)
        for year, month in sorted(affected_periods):
            await is_service.compute(year, month)
            await bs_service.compute(year, month)


@router.put("/{account_id}")
async def update_account(
    account_id: int,
    body: UpdateAccountRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(verify_token),
):
    repo = AccountRepository(db, current_user.id)
    account = await repo.get_by_id(account_id)
    if not account or not account.is_active:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Account not found")
        
    if body.name is not None:
        account.name = body.name
    if body.account_type is not None:
        account.account_type = body.account_type
    if body.institution is not None:
        account.institution = body.institution
    if body.currency is not None:
        account.currency = body.currency
    if body.is_internal is not None:
        account.is_internal = body.is_internal
    if body.code is not None:
        # Check if the code is already used by another active account for this user
        from sqlalchemy import select
        stmt = select(Account).where(
            Account.code == body.code,
            Account.id != account_id,
            Account.is_active == True,
            Account.user_id == current_user.id
        )
        result = await db.execute(stmt)
        existing = result.scalars().first()
        if existing:
            from fastapi import HTTPException
            raise HTTPException(status_code=400, detail="Account number/code already exists")
        account.code = body.code
    if body.notes is not None:
        account.notes = body.notes
        
    await db.flush()
    await reclassify_and_recompute_all(db, current_user.id)
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
    if not account or not account.is_active:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Account not found")
        
    # Soft delete
    account.is_active = False
    await db.flush()
    await reclassify_and_recompute_all(db, current_user.id)
    await db.commit()
    return {"status": "success"}

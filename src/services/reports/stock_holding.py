"""
src/services/stock_holding_service.py
Service for stock holdings compilation, month-over-month carry-overs,
and applying transactions to positions.
"""
from __future__ import annotations

import json
import logging
import asyncio
import calendar
from datetime import date, datetime, timedelta
from typing import Tuple, List, Dict
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from src.dbs.models import Account, AccountSnapshot, Security, AccountType, Transaction, TransactionSource
from src.dbs.repository import AccountRepository, SnapshotRepository, SecurityRepository, TransactionRepository
from src.utils.stock_utils import parse_stock_transaction, fetch_month_end_price, normalize_stock_name, refresh_live_prices
from src.services.exchange_rate.service import get_usd_twd_rate

log = logging.getLogger(__name__)


class StockHoldingService:
    def __init__(self, db: AsyncSession, user_id: int) -> None:
        self.db = db
        self.user_id = user_id
        self.account_repo = AccountRepository(db, user_id)
        self.snapshot_repo = SnapshotRepository(db, user_id)
        self.security_repo = SecurityRepository(db, user_id)

    async def get_or_compute_portfolio(self, period_date: date) -> Tuple[List[AccountSnapshot], List[Security]]:
        """
        Retrieves the account snapshots and stock holdings for the target period.
        - For API/manual brokers (E-Sun, Taishin, etc.): returns exactly what is stored in the DB for this period. No carry-over.
        - For Firstrade: calculates holdings dynamically by aggregating all transactions up to the end of the period.
        """
        # 1. Fetch all brokerage accounts
        all_accounts = await self.account_repo.get_all()
        brokerage_accounts = [a for a in all_accounts if a.account_type == AccountType.BROKERAGE]

        # 2. Fetch existing snapshots and securities for this period (latest or exact)
        is_first_of_month = (period_date.day == 1)
        existing_snapshots = {}
        existing_securities = []
        today = date.today()
        is_current_month = (period_date.year == today.year and period_date.month == today.month)

        # Check if there is already a snapshot for Firstrade in this month
        firstrade_acct = next((a for a in brokerage_accounts if a.institution.lower() == "firstrade"), None)
        has_db_firstrade = False
        firstrade_inherited = False  # True when positions come from a prior month (no current upload)
        
        if is_first_of_month:
            import calendar
            start_date = period_date.replace(day=1)
            last_day = calendar.monthrange(period_date.year, period_date.month)[1]
            end_date = period_date.replace(day=last_day)
            
            # 2.1 Fetch all snapshots for BANK and CREDIT_CARD accounts in this month in bulk
            bank_card_ids = [a.id for a in all_accounts if a.account_type in (AccountType.BANK, AccountType.CREDIT_CARD)]
            if bank_card_ids:
                stmt_bulk_exact = select(AccountSnapshot).where(
                    AccountSnapshot.user_id == self.user_id,
                    AccountSnapshot.account_id.in_(bank_card_ids),
                    AccountSnapshot.period_date >= start_date,
                    AccountSnapshot.period_date <= end_date
                )
                res_bulk = await self.db.execute(stmt_bulk_exact)
                for snap in res_bulk.scalars().all():
                    existing_snapshots[snap.account_id] = snap

            # 2.2 For Brokerage/Liabilities, batch-load their latest snapshot up to end_date
            other_accounts = [a for a in all_accounts if a.account_type not in (AccountType.BANK, AccountType.CREDIT_CARD)]
            if other_accounts:
                # Perform a subquery to find the maximum (latest) period_date per account_id <= end_date
                subq = (
                    select(AccountSnapshot.account_id, func.max(AccountSnapshot.period_date).label("max_date"))
                    .where(
                        AccountSnapshot.user_id == self.user_id,
                        AccountSnapshot.account_id.in_([a.id for a in other_accounts]),
                        AccountSnapshot.period_date <= end_date
                    )
                    .group_by(AccountSnapshot.account_id)
                    .subquery()
                )
                
                stmt_bulk_latest = (
                    select(AccountSnapshot)
                    .join(subq, (AccountSnapshot.account_id == subq.c.account_id) & (AccountSnapshot.period_date == subq.c.max_date))
                    .where(AccountSnapshot.user_id == self.user_id)
                )
                res_latest = await self.db.execute(stmt_bulk_latest)
                latest_snapshots = res_latest.scalars().all()
                
                acct_map = {a.id: a for a in other_accounts}
                latest_snap_dates = []
                
                for snap in latest_snapshots:
                    acct = acct_map.get(snap.account_id)
                    if not acct:
                        continue
                        
                    # Apply auto-reduction for installment liabilities
                    if getattr(acct, 'is_installment', False) and getattr(acct, 'installment_amount', 0.0) > 0:
                        months_diff = (end_date.year - snap.period_date.year) * 12 + (end_date.month - snap.period_date.month)
                        adjusted_balance = min(0.0, snap.balance + (months_diff * getattr(acct, 'installment_amount', 0.0)))
                        snap = AccountSnapshot(
                            id=snap.id,
                            user_id=snap.user_id,
                            account_id=snap.account_id,
                            period_date=end_date.replace(day=1),
                            balance=adjusted_balance,
                            currency=snap.currency,
                            exchange_rate=snap.exchange_rate,
                            source=snap.source
                        )
                        
                    if acct.institution.lower() == "firstrade":
                        has_db_firstrade = True
                        # Flag if this snapshot is inherited from a prior month (no July upload yet)
                        if snap.period_date < start_date:
                            firstrade_inherited = True
                    existing_snapshots[acct.id] = snap
                    latest_snap_dates.append((snap.account_id, snap.period_date))
                
                # Batch load existing securities for the matched snapshots
                if latest_snap_dates:
                    from sqlalchemy import or_
                    sec_clauses = [
                        (Security.account_id == aid) & (Security.period_date == pdate)
                        for aid, pdate in latest_snap_dates
                    ]
                    sec_stmt = select(Security).where(
                        Security.user_id == self.user_id,
                        or_(*sec_clauses)
                    )
                    sec_res = await self.db.execute(sec_stmt)
                    existing_securities.extend(sec_res.scalars().all())
        else:
            snaps = await self.snapshot_repo.get_by_period(period_date)
            for s in snaps:
                # Apply same auto-reduction if we load directly by period
                if s.account and getattr(s.account, 'is_installment', False) and getattr(s.account, 'installment_amount', 0.0) > 0:
                    # Dynamically calculate the monthly deduction based on baseline snapshots
                    # We look up the oldest snapshot for this account to act as baseline
                    base_stmt = (
                        select(AccountSnapshot)
                        .where(AccountSnapshot.account_id == s.account_id)
                        .order_by(AccountSnapshot.period_date.asc())
                        .limit(1)
                    )
                    base_res = await self.db.execute(base_stmt)
                    base_snap = base_res.scalar_one_or_none()
                    if base_snap:
                        months_diff = (period_date.year - base_snap.period_date.year) * 12 + (period_date.month - base_snap.period_date.month)
                        adjusted_balance = min(0.0, base_snap.balance + (months_diff * getattr(s.account, 'installment_amount', 0.0)))
                        s = AccountSnapshot(
                            id=s.id,
                            user_id=s.user_id,
                            account_id=s.account_id,
                            period_date=s.period_date,
                            balance=adjusted_balance,
                            currency=s.currency,
                            exchange_rate=s.exchange_rate,
                            source=s.source,
                            account=s.account
                        )
                if s.account and s.account.institution.lower() == "firstrade":
                    has_db_firstrade = True
                existing_snapshots[s.account_id] = s
                
            secs = await self.security_repo.get_by_period(period_date)
            existing_securities = list(secs)

        final_snapshots: List[AccountSnapshot] = list(existing_snapshots.values())
        final_securities: List[Security] = list(existing_securities)

        # 3. Handle Firstrade specifically by aggregating all historical transactions up to the query date
        # (Only if we don't already have it stored in the database for this period)
        if firstrade_acct and not has_db_firstrade:
            import calendar
            last_day = calendar.monthrange(period_date.year, period_date.month)[1]
            query_end_date = period_date.replace(day=last_day) if is_first_of_month else period_date
            
            # Only compute Firstrade positions if the user has uploaded data (snapshots or transactions) in the target month
            start_of_target_month = period_date.replace(day=1)
            end_of_target_month = period_date.replace(day=last_day)
            
            has_activity_stmt = (
                select(Transaction.id)
                .where(
                    Transaction.user_id == self.user_id,
                    Transaction.account_id == firstrade_acct.id,
                    Transaction.txn_date >= start_of_target_month,
                    Transaction.txn_date <= end_of_target_month
                )
                .limit(1)
            )
            has_activity_res = await self.db.execute(has_activity_stmt)
            has_activity = has_activity_res.scalar() is not None
            
            if not has_activity:
                has_snap_stmt = (
                    select(AccountSnapshot.id)
                    .where(
                        AccountSnapshot.user_id == self.user_id,
                        AccountSnapshot.account_id == firstrade_acct.id,
                        AccountSnapshot.period_date >= start_of_target_month,
                        AccountSnapshot.period_date <= end_of_target_month
                    )
                    .limit(1)
                )
                has_snap_res = await self.db.execute(has_snap_stmt)
                has_activity = has_snap_res.scalar() is not None
                
            if has_activity:
                txns_stmt = (
                    select(Transaction)
                    .where(
                        Transaction.user_id == self.user_id,
                        Transaction.account_id == firstrade_acct.id,
                        Transaction.txn_date <= query_end_date
                    )
                    .order_by(Transaction.txn_date.asc())
                )
                txns_res = await self.db.execute(txns_stmt)
                txns = txns_res.scalars().all()
            
                positions = {}
                cash_balance_usd = 0.0
                
                for txn in txns:
                    txn_usd = txn.original_amount if txn.original_amount is not None else (txn.amount / (txn.exchange_rate or 32.5))
                    cash_balance_usd += txn_usd
                    
                    ticker, qty, action, price = parse_stock_transaction(txn)
                    if ticker and qty > 0:
                        if ticker not in positions:
                            if action == "BUY":
                                positions[ticker] = {
                                    "ticker": ticker,
                                    "name": normalize_stock_name(ticker, txn.description),
                                    "quantity": qty,
                                    "avg_cost": price,
                                    "currency": "USD",
                                    "exchange_rate": txn.exchange_rate or 32.5,
                                }
                        else:
                            pos = positions[ticker]
                            if action == "BUY":
                                old_qty = pos["quantity"]
                                old_avg = pos["avg_cost"]
                                new_qty = old_qty + qty
                                new_avg = (old_qty * old_avg + qty * price) / new_qty if new_qty > 0 else 0.0
                                pos["quantity"] = new_qty
                                pos["avg_cost"] = new_avg
                            elif action == "SELL":
                                pos["quantity"] = max(0.0, pos["quantity"] - qty)
                                
                active_positions = {t: p for t, p in positions.items() if p["quantity"] > 0.001}
                
                try:
                    rate = await get_usd_twd_rate(query_end_date)
                except Exception:
                    rate = 32.5
                    
                price_fetch_tasks = []
                computed_sec_metadata = []
                
                for ticker, pos in active_positions.items():
                    sec = Security(
                        user_id=self.user_id,
                        account_id=firstrade_acct.id,
                        period_date=query_end_date,
                        ticker=ticker,
                        name=pos["name"],
                        quantity=pos["quantity"],
                        avg_cost=0.0,
                        current_price=0.0,
                        market_value=0.0,
                        unrealized_pnl=0.0,
                        currency="USD",
                        exchange_rate=rate,
                    )
                    computed_sec_metadata.append((sec, pos, ticker, query_end_date))
                    price_fetch_tasks.append(fetch_month_end_price(ticker, query_end_date))
                    
                fetched_prices = []
                if price_fetch_tasks:
                    fetched_prices = await asyncio.gather(*price_fetch_tasks)
                    
                total_sec_mv_twd = 0.0
                for idx, (sec, pos, ticker, p_date) in enumerate(computed_sec_metadata):
                    m_price = fetched_prices[idx] if fetched_prices[idx] is not None else pos["avg_cost"]
                    pos_avg = pos["avg_cost"]
                    pos_qty = pos["quantity"]
                    
                    sec.exchange_rate = rate
                    sec.original_avg_cost = pos_avg
                    sec.original_current_price = m_price
                    sec.original_market_value = pos_qty * m_price
                    sec.original_unrealized_pnl = (m_price - pos_avg) * pos_qty
                    
                    sec.avg_cost = round(pos_avg * rate)
                    sec.current_price = round(m_price * rate)
                    sec.market_value = round((pos_qty * m_price) * rate)
                    sec.unrealized_pnl = round(((m_price - pos_avg) * pos_qty) * rate)
                    
                    total_sec_mv_twd += sec.market_value
                    final_securities.append(sec)
                    
                cash_balance_twd = cash_balance_usd * rate
                total_balance_twd = cash_balance_twd + total_sec_mv_twd
                
                ft_snap = AccountSnapshot(
                    user_id=self.user_id,
                    account_id=firstrade_acct.id,
                    period_date=query_end_date,
                    balance=round(total_balance_twd),
                    original_balance=total_balance_twd / rate if rate > 0 else None,
                    currency="USD",
                    exchange_rate=rate,
                    source="pdf",
                )
                final_snapshots.append(ft_snap)

        return final_snapshots, final_securities

    async def get_holdings_for_period(self, period_date: date) -> List[Dict]:
        """
        Returns a formatted list of security holdings for the given period.
        Called by GET /accounts/securities to power the stock inventory view.
        """
        from sqlalchemy import select as sa_select
        from src.dbs.models import Account

        _, securities = await self.get_or_compute_portfolio(period_date)

        # Always refresh to live prices for current-month views (both TW and US assets)
        today = date.today()
        if period_date.year == today.year and period_date.month == today.month:
            await refresh_live_prices(securities)

        # Build account name lookup
        acc_stmt = sa_select(Account.id, Account.name).where(Account.user_id == self.user_id)
        acc_res = await self.db.execute(acc_stmt)
        acc_map = {row.id: row.name for row in acc_res.all()}

        output = []
        for sec in securities:
            # Use pre-computed TWD fields when available (stored securities),
            # otherwise fall back to raw values
            orig_avg = getattr(sec, "original_avg_cost", None) or sec.avg_cost
            orig_price = getattr(sec, "original_current_price", None) or sec.current_price
            orig_mv = getattr(sec, "original_market_value", None) or sec.market_value
            orig_pnl = getattr(sec, "original_unrealized_pnl", None) or sec.unrealized_pnl

            currency = sec.currency or "TWD"
            rate = sec.exchange_rate or 1.0

            # Convert to TWD for display if foreign currency
            if currency != "TWD" and rate > 0:
                mv_twd = sec.market_value if sec.market_value else (orig_mv * rate)
                pnl_twd = sec.unrealized_pnl if sec.unrealized_pnl else (orig_pnl * rate)
                avg_twd = sec.avg_cost if sec.avg_cost else round(orig_avg * rate)
                price_twd = sec.current_price if sec.current_price else round(orig_price * rate)
            else:
                mv_twd = sec.market_value
                pnl_twd = sec.unrealized_pnl
                avg_twd = sec.avg_cost
                price_twd = sec.current_price

            output.append({
                "id": sec.id,
                "account_id": sec.account_id,
                "account_name": acc_map.get(sec.account_id, "Unknown"),
                "period_date": str(sec.period_date),
                "ticker": sec.ticker,
                "name": sec.name,
                "quantity": sec.quantity,
                "avg_cost": avg_twd,
                "current_price": price_twd,
                "market_value": mv_twd,
                "unrealized_pnl": pnl_twd,
                "original_avg_cost": orig_avg,
                "original_current_price": orig_price,
                "original_market_value": orig_mv,
                "original_unrealized_pnl": orig_pnl,
                "currency": currency,
                "exchange_rate": rate,
                "created_at": str(sec.created_at) if getattr(sec, "created_at", None) else None,
            })

        return output

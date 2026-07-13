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
from src.utils.stock_utils import parse_stock_transaction, fetch_month_end_price, normalize_stock_name
from src.services.exchange_rate import get_usd_twd_rate

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
        
        # Check if there is already a snapshot for Firstrade in this month
        firstrade_acct = next((a for a in brokerage_accounts if a.institution.lower() == "firstrade"), None)
        has_db_firstrade = False
        
        if is_first_of_month:
            import calendar
            start_date = period_date.replace(day=1)
            last_day = calendar.monthrange(period_date.year, period_date.month)[1]
            end_date = period_date.replace(day=last_day)
            
            for acct in all_accounts:
                # If bank or credit card, we only look for snapshots created EXACTLY in this month.
                # If none exists, we don't carry over (it will be missing / 0).
                if acct.account_type in (AccountType.BANK, AccountType.CREDIT_CARD):
                    exact_snap_stmt = (
                        select(AccountSnapshot)
                        .where(
                            AccountSnapshot.user_id == self.user_id,
                            AccountSnapshot.account_id == acct.id,
                            AccountSnapshot.period_date >= start_date,
                            AccountSnapshot.period_date <= end_date
                        )
                        .limit(1)
                    )
                    res = await self.db.execute(exact_snap_stmt)
                    snap = res.scalar_one_or_none()
                    if snap:
                        existing_snapshots[acct.id] = snap
                else:
                    # Brokerage or liabilities carry over latest historical snapshot
                    latest_snap_stmt = (
                        select(AccountSnapshot)
                        .where(
                            AccountSnapshot.user_id == self.user_id,
                            AccountSnapshot.account_id == acct.id,
                            AccountSnapshot.period_date <= end_date
                        )
                        .order_by(AccountSnapshot.period_date.desc())
                        .limit(1)
                    )
                    res = await self.db.execute(latest_snap_stmt)
                    snap = res.scalar_one_or_none()
                    if snap:
                        if acct.institution.lower() == "firstrade":
                            has_db_firstrade = True
                        existing_snapshots[acct.id] = snap
                        
                        sec_stmt = (
                            select(Security)
                            .where(
                                Security.user_id == self.user_id,
                                Security.account_id == acct.id,
                                Security.period_date == snap.period_date
                            )
                        )
                        sec_res = await self.db.execute(sec_stmt)
                        existing_securities.extend(sec_res.scalars().all())
        else:
            snaps = await self.snapshot_repo.get_by_period(period_date)
            for s in snaps:
                if s.account.institution.lower() == "firstrade":
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

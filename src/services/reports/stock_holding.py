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
from sqlalchemy import select
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
        If a brokerage account does not have database entries for the period,
        it automatically carries them over from the previous month and applies
        any intermediate transactions to update stock quantities and cash balances.
        """
        # 1. Fetch all brokerage accounts
        all_accounts = await self.account_repo.get_all()
        brokerage_accounts = [a for a in all_accounts if a.account_type == AccountType.BROKERAGE]

        # 2. Fetch existing snapshots and securities for this period
        existing_snapshots = {s.account_id: s for s in await self.snapshot_repo.get_by_period(period_date)}
        existing_securities = await self.security_repo.get_by_period(period_date)

        # Group existing securities by account_id
        existing_sec_by_acct: Dict[int, List[Security]] = {}
        for s in existing_securities:
            existing_sec_by_acct.setdefault(s.account_id, []).append(s)

        final_snapshots: List[AccountSnapshot] = list(existing_snapshots.values())
        final_securities: List[Security] = list(existing_securities)

        # Accumulate async price fetch tasks
        price_fetch_tasks = []
        computed_sec_metadata = []  # List of tuples: (sec_obj, pos_dict, ticker, period_date)

        import calendar
        last_day = calendar.monthrange(period_date.year, period_date.month)[1]
        end_date = period_date.replace(day=last_day)

        for acct in brokerage_accounts:
            acct_id = acct.id
            has_snap = acct_id in existing_snapshots
            has_sec = acct_id in existing_sec_by_acct

            # If both are in the database, no carry-over calculation needed for this account
            if has_snap and has_sec:
                continue

            # Firstrade does not carry over dynamically. It is strictly based on uploaded PDFs or manual saves.
            if acct.code == "broker_Firstrade":
                continue


            # 3. Find the latest month prior to period_date with Security records
            prev_period_stmt = (
                select(func.max(Security.period_date))
                .where(Security.user_id == self.user_id, Security.account_id == acct_id, Security.period_date < period_date)
                .order_by(Security.period_date.desc())
                .limit(1)
            )
            prev_period_res = await self.db.execute(prev_period_stmt)
            m_prev = prev_period_res.scalar_one_or_none()

            base_positions: Dict[str, dict] = {}  # ticker -> position dict
            base_cash_twd = 0.0
            exchange_rate = 1.0
            currency = acct.currency or "TWD"

            if m_prev:
                if acct.code == "broker_esun" and m_prev < date(2026, 5, 1):
                    log.info(f"Skipping carry-over from before May 2026 for E-Sun account (prev period: {m_prev})")
                    m_prev = None

            if m_prev:
                # Load base positions from m_prev
                prev_secs_stmt = select(Security).where(Security.user_id == self.user_id, Security.account_id == acct_id, Security.period_date == m_prev)
                prev_secs_res = await self.db.execute(prev_secs_stmt)
                prev_secs = prev_secs_res.scalars().all()
                for s in prev_secs:
                    base_positions[s.ticker] = {
                        "ticker": s.ticker,
                        "name": normalize_stock_name(s.ticker, s.name),
                        "quantity": s.quantity,
                        "avg_cost": s.original_avg_cost if s.original_avg_cost is not None else s.avg_cost,
                        "current_price": s.original_current_price if s.original_current_price is not None else s.current_price,
                        "currency": s.currency,
                        "exchange_rate": s.exchange_rate,
                    }

                # Load base snapshot to compute starting cash
                prev_snap_stmt = select(AccountSnapshot).where(AccountSnapshot.user_id == self.user_id, AccountSnapshot.account_id == acct_id, AccountSnapshot.period_date == m_prev)
                prev_snap_res = await self.db.execute(prev_snap_stmt)
                prev_snap = prev_snap_res.scalar_one_or_none()
                if prev_snap:
                    exchange_rate = prev_snap.exchange_rate
                    prev_secs_mv_twd = sum(s.market_value for s in prev_secs)
                    base_cash_twd = max(prev_snap.balance - prev_secs_mv_twd, 0.0)
            else:
                base_cash_twd = 0.0

            # 4. Fetch transactions from m_prev + 1 day to end of period
            if acct.code == "broker_esun" and period_date >= date(2026, 5, 1):
                start_date = max(m_prev + timedelta(days=1) if m_prev else date(2026, 5, 1), date(2026, 5, 1))
            else:
                start_date = m_prev + timedelta(days=1) if m_prev else date(2020, 1, 1)

            txns_stmt = (
                select(Transaction)
                .where(
                    Transaction.user_id == self.user_id,
                    Transaction.account_id == acct_id,
                    Transaction.txn_date >= start_date,
                    Transaction.txn_date <= end_date,
                )
                .order_by(Transaction.txn_date.asc())
            )
            txns_res = await self.db.execute(txns_stmt)
            txns = txns_res.scalars().all()

            # Process transactions
            for txn in txns:
                # Update cash portion in TWD (deposit is +, buy is -, sell is +)
                base_cash_twd += txn.amount

                # Parse brokerage trades
                ticker, qty, action, price = parse_stock_transaction(txn)
                if ticker and qty > 0:
                    txn_currency = txn.currency or "TWD"
                    txn_exchange_rate = txn.exchange_rate or 1.0

                    # Convert transaction price to account currency
                    if txn_currency == "USD" and currency == "USD":
                        pass
                    elif currency == "USD" and txn_currency == "TWD":
                        price = price / txn_exchange_rate if txn_exchange_rate > 0.0 else price / 32.0
                    elif currency == "TWD" and txn_currency == "USD":
                        price = price * txn_exchange_rate

                    if ticker not in base_positions:
                        if action == "BUY":
                            # Extract clean stock name from transaction description
                            clean_name = txn.description
                            if "]" in clean_name:
                                clean_name = clean_name.split("]")[-1].strip()
                            # Strip out quantity/price text from name if any
                            clean_name = clean_name.split(" ")[0].strip()
                            
                            base_positions[ticker] = {
                                "ticker": ticker,
                                "name": normalize_stock_name(ticker, clean_name or ticker),
                                "quantity": qty,
                                "avg_cost": price,
                                "current_price": price,
                                "currency": currency,
                                "exchange_rate": txn_exchange_rate,
                            }
                    else:
                        pos = base_positions[ticker]
                        if action == "BUY":
                            old_qty = pos["quantity"]
                            old_avg_cost = pos["avg_cost"]
                            new_qty = old_qty + qty
                            new_avg_cost = (old_qty * old_avg_cost + qty * price) / new_qty if new_qty > 0 else 0.0
                            pos["quantity"] = new_qty
                            pos["avg_cost"] = new_avg_cost
                        elif action == "SELL":
                            old_qty = pos["quantity"]
                            pos["quantity"] = max(0.0, old_qty - qty)

            # Filter for positions that are still active
            active_positions = {t: p for t, p in base_positions.items() if p["quantity"] > 0.001}

            # If securities list is missing in DB for this period, create dynamic securities
            if not has_sec:
                for ticker, pos in active_positions.items():
                    sec = Security(
                        account_id=acct_id,
                        period_date=period_date,
                        ticker=ticker,
                        name=pos["name"],
                        quantity=pos["quantity"],
                        avg_cost=0.0,
                        current_price=0.0,
                        market_value=0.0,
                        unrealized_pnl=0.0,
                        currency=currency,
                        exchange_rate=exchange_rate,
                    )
                    computed_sec_metadata.append((sec, pos, ticker, period_date))
                    price_fetch_tasks.append(fetch_month_end_price(ticker, period_date))

        # 5. Fetch all month-end prices in parallel
        fetched_prices = []
        if price_fetch_tasks:
            fetched_prices = await asyncio.gather(*price_fetch_tasks)

        # 6. Apply prices and calculate values for dynamically computed securities
        for idx, (sec, pos, ticker, p_date) in enumerate(computed_sec_metadata):
            m_end_price = fetched_prices[idx]
            if m_end_price is not None:
                pos_price = m_end_price
            else:
                pos_price = pos["current_price"] or pos["avg_cost"] or 0.0

            pos_avg_cost = pos["avg_cost"] or 0.0
            pos_qty = pos["quantity"]
            pos_currency = pos["currency"]
            pos_ex_rate = pos["exchange_rate"] or 1.0

            if pos_currency == "USD":
                pos_ex_rate = await get_usd_twd_rate(p_date)
                sec.exchange_rate = pos_ex_rate
                sec.original_avg_cost = pos_avg_cost
                sec.original_current_price = pos_price
                sec.original_market_value = pos_qty * pos_price
                sec.original_unrealized_pnl = (pos_price - pos_avg_cost) * pos_qty

                sec.avg_cost = round(pos_avg_cost * pos_ex_rate)
                sec.current_price = round(pos_price * pos_ex_rate)
                sec.market_value = round((pos_qty * pos_price) * pos_ex_rate)
                sec.unrealized_pnl = round(((pos_price - pos_avg_cost) * pos_qty) * pos_ex_rate)
            else:
                sec.avg_cost = round(pos_avg_cost)
                sec.current_price = round(pos_price)
                sec.market_value = round(pos_qty * pos_price)
                sec.unrealized_pnl = round((pos_price - pos_avg_cost) * pos_qty)
                sec.exchange_rate = 1.0

            final_securities.append(sec)

        # 7. Resolve dynamic snapshots where missing
        for acct in brokerage_accounts:
            acct_id = acct.id
            has_snap = acct_id in existing_snapshots

            if not has_snap:
                acct_secs = [s for s in final_securities if s.account_id == acct_id]
                sec_mv_twd = sum(s.market_value for s in acct_secs)

                # Get cash portion
                prev_snap_stmt = (
                    select(AccountSnapshot)
                    .where(AccountSnapshot.user_id == self.user_id, AccountSnapshot.account_id == acct_id, AccountSnapshot.period_date < period_date)
                    .order_by(AccountSnapshot.period_date.desc())
                    .limit(1)
                )
                prev_snap_res = await self.db.execute(prev_snap_stmt)
                prev_snap = prev_snap_res.scalar_one_or_none()

                m_prev_date = prev_snap.period_date if prev_snap else date(2020, 1, 1)
                acct_currency = acct.currency or "TWD"
                acct_ex_rate = 1.0

                if prev_snap:
                    acct_ex_rate = prev_snap.exchange_rate
                    prev_secs_stmt = select(Security).where(Security.user_id == self.user_id, Security.account_id == acct_id, Security.period_date == m_prev_date)
                    prev_secs_res = await self.db.execute(prev_secs_stmt)
                    prev_secs = prev_secs_res.scalars().all()
                    prev_secs_mv_twd = sum(s.market_value for s in prev_secs)
                    acct_cash_twd = max(prev_snap.balance - prev_secs_mv_twd, 0.0)
                else:
                    acct_cash_twd = 0.0

                # Add intermediate transaction amounts
                txns_stmt = select(Transaction).where(
                    Transaction.user_id == self.user_id,
                    Transaction.account_id == acct_id,
                    Transaction.txn_date >= (m_prev_date + timedelta(days=1)),
                    Transaction.txn_date <= end_date,
                )
                txns_res = await self.db.execute(txns_stmt)
                txns = txns_res.scalars().all()

                for txn in txns:
                    acct_cash_twd += txn.amount

                total_balance_twd = acct_cash_twd + sec_mv_twd

                if acct_currency == "USD":
                    acct_ex_rate = await get_usd_twd_rate(period_date)

                snap = AccountSnapshot(
                    account_id=acct_id,
                    period_date=period_date,
                    balance=round(total_balance_twd),
                    original_balance=total_balance_twd / acct_ex_rate if acct_currency != "TWD" and acct_ex_rate > 0 else None,
                    currency=acct_currency,
                    exchange_rate=acct_ex_rate,
                    source="api",
                )
                final_snapshots.append(snap)

        return final_snapshots, final_securities

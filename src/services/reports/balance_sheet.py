"""
src/services/balance_sheet_service.py
Computes the monthly balance sheet from account snapshots and security holdings.
Also supports pulling live data from broker APIs.
"""
from __future__ import annotations

import json
from datetime import date
from typing import Any

import logging
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.dbs.models import AccountType, BalanceSheet, AccountSnapshot, Account
from src.dbs.repository import (
    AccountRepository,
    BalanceSheetRepository,
    SecurityRepository,
    SnapshotRepository,
    SecurityRepository,
    SnapshotRepository,
)
from src.services.brokers.sinopac_client import get_sinopac_client
from src.services.brokers.taishin_client import get_taishin_client
from src.utils.date_utils import first_of_month

log = logging.getLogger(__name__)


class BalanceSheetService:
    def __init__(self, db: AsyncSession, user_id: int) -> None:
        self.db = db
        self.user_id = user_id
        self.account_repo = AccountRepository(db, user_id)
        self.snapshot_repo = SnapshotRepository(db, user_id)
        self.security_repo = SecurityRepository(db, user_id)
        self.bs_repo = BalanceSheetRepository(db, user_id)

    async def compute(self, year: int, month: int) -> BalanceSheet:
        """
        Compute (or recompute) the balance sheet for a given month.
        Pulls data from DB snapshots already ingested from PDFs or API syncs.
        """
        period = first_of_month(year, month)
        
        from src.services.reports.stock_holding import StockHoldingService
        holding_service = StockHoldingService(self.db, self.user_id)
        snapshots, securities = await holding_service.get_or_compute_portfolio(period)
        
        accounts = {a.id: a for a in await self.account_repo.get_all()}

        total_cash = 0.0
        total_securities_mv = 0.0
        total_brokerage_cash = 0.0
        total_cc_payable = 0.0
        total_other_liabilities = 0.0
        detail: dict[str, Any] = {"cash": [], "securities": [], "brokerage_cash": [], "credit_cards": [], "liabilities": []}

        # Build a map: account_id -> total securities market_value for that account
        securities_mv_by_account: dict[int, float] = {}
        for sec in securities:
            securities_mv_by_account[sec.account_id] = securities_mv_by_account.get(sec.account_id, 0.0) + sec.market_value

        for snap in snapshots:
            acct = accounts.get(snap.account_id)
            if not acct:
                continue
            
            if acct.account_type == AccountType.CREDIT_CARD:
                total_cc_payable += snap.balance
                detail["credit_cards"].append(
                    {"name": acct.name, "payable": abs(snap.balance)}
                )
            elif acct.account_type == AccountType.LIABILITY:
                total_other_liabilities += abs(snap.balance)
                detail["liabilities"].append(
                    {"name": acct.name, "balance": abs(snap.balance)}
                )
            elif acct.account_type == AccountType.BROKERAGE:
                # snap.balance = total_market_value + cash_balance (both converted to TWD)
                # Subtract individual securities MV to get the cash portion
                snap_stocks_mv = securities_mv_by_account.get(snap.account_id, 0.0)
                
                # Check if it is Firstrade (overseas broker)
                is_firstrade = "firstrade" in (acct.name or "").lower() or "firstrade" in (acct.institution or "").lower()
                
                broker_cash_twd = max(snap.balance - snap_stocks_mv, 0.0) if is_firstrade else 0.0
                total_securities_mv += snap_stocks_mv
                total_brokerage_cash += broker_cash_twd
                if broker_cash_twd > 0:
                    detail["brokerage_cash"].append(
                        {"name": acct.name, "balance": round(broker_cash_twd)}
                    )
            else:
                total_cash += snap.balance
                detail["cash"].append({
                    "name": acct.name,
                    "institution": acct.institution or "",
                    "currency": snap.currency or "TWD",
                    "balance": snap.balance,
                    "original_balance": snap.original_balance,
                    "exchange_rate": snap.exchange_rate,
                })

        for sec in securities:
            acct = accounts.get(sec.account_id)
            broker_name = acct.name if acct else "Unknown Broker"
            
            if "securities" not in detail:
                detail["securities"] = []
                
            detail["securities"].append(
                {
                    "broker": broker_name,
                    "ticker": sec.ticker,
                    "name": sec.name,
                    "quantity": sec.quantity,
                    "market_value": sec.market_value,
                    "unrealized_pnl": sec.unrealized_pnl,
                    "original_market_value": sec.original_market_value,
                    "currency": sec.currency or "TWD",
                    "exchange_rate": sec.exchange_rate,
                }
            )

        # Merge brokerage cash into total_cash so it shows in 現金與存款
        total_cash += total_brokerage_cash
        total_assets = total_cash + total_securities_mv
        total_liabilities = abs(total_cc_payable) + total_other_liabilities
        net_worth = total_assets - total_liabilities

        bs = BalanceSheet(
            period_date=period,
            total_cash=total_cash,
            total_securities_market_value=total_securities_mv,
            total_assets=total_assets,
            total_credit_card_payable=total_cc_payable,
            total_liabilities=total_liabilities,
            net_worth=net_worth,
            detail_json=json.dumps(detail, ensure_ascii=False),
        )
        saved = await self.bs_repo.upsert(bs)
        log.info(f"balance_sheet.computed period={period} net_worth={net_worth}")
        return saved

    async def sync_from_broker_api(self, year: int, month: int) -> dict[str, Any]:
        """
        Pull LIVE positions from broker APIs and store as snapshots.
        Call this before compute() to get up-to-date data.
        """
        period = first_of_month(year, month)
        results: dict[str, Any] = {}

        # 永豐金
        # try:
        #     sinopac = get_sinopac_client()
        #     balance = await sinopac.get_account_balance()
        #     positions = await sinopac.get_positions()
        #     results["sinopac"] = {
        #         "cash_balance": balance["cash_balance"],
        #         "positions": len(positions),
        #     }
        #     log.info(f"broker.sinopac.synced info={results['sinopac']}")
        # except Exception as exc:
        #     log.warning(f"broker.sinopac.failed error={exc}")
        #     results["sinopac"] = {"error": str(exc)}

        # 台新
        try:
            taishin = get_taishin_client()
            balance = await taishin.get_account_balance()
            positions = await taishin.get_positions()
            results["taishin"] = {
                "cash_balance": balance["cash_balance"],
                "positions": len(positions),
            }
            log.info(f"broker.taishin.synced info={results['taishin']}")
        except Exception as exc:
            log.warning(f"broker.taishin.failed error={exc}")
            results["taishin"] = {"error": str(exc)}

        return results

    async def get_history(self, months: int = 12) -> list[dict[str, Any]]:
        """Return balance sheet history for charting, dynamically syncing account names and balances from live DB snapshots."""
        all_bs = await self.bs_repo.list_all()
        accounts = {a.id: a for a in await self.account_repo.get_all()}
        
        result = []
        db_needs_commit = False

        for bs in all_bs[:months]:
            # Fetch actual snapshots in the database for this specific month
            month_snaps_res = await self.db.execute(
                select(AccountSnapshot).where(
                    AccountSnapshot.user_id == self.user_id,
                    AccountSnapshot.period_date == bs.period_date
                )
            )
            db_snaps = {s.account_id: s for s in month_snaps_res.scalars().all()}

            detail = {}
            if bs.detail_json:
                try:
                    detail = json.loads(bs.detail_json)
                except Exception:
                    pass

            detail_changed = False
            
            # 1. Sync cash accounts (names & balances)
            if "cash" in detail:
                for item in detail["cash"]:
                    # Match by checking both institution and checking if the name aligns
                    matched = next((a for a in accounts.values() if a.institution == item.get("institution") and a.currency == item.get("currency") and (a.name in item.get("name") or item.get("name") in a.name)), None)
                    # Fallback to institution match if only one such account exists
                    if not matched:
                        matched = next((a for a in accounts.values() if a.institution == item.get("institution") and a.currency == item.get("currency")), None)
                        
                    if matched:
                        if item.get("name") != matched.name:
                            item["name"] = matched.name
                            detail_changed = True
                        # Cross-reference live snapshot balance
                        snap = db_snaps.get(matched.id)
                        if snap and item.get("balance") != snap.balance:
                            item["balance"] = snap.balance
                            if snap.original_balance is not None:
                                item["original_balance"] = snap.original_balance
                            detail_changed = True

            # 2. Sync brokerage cash (names & balances)
            if "brokerage_cash" in detail:
                for item in detail["brokerage_cash"]:
                    matched = next((a for a in accounts.values() if a.account_type == AccountType.BROKERAGE and (a.name in item.get("name") or item.get("name") in a.name)), None)
                    if matched:
                        if item.get("name") != matched.name:
                            item["name"] = matched.name
                            detail_changed = True
                        snap = db_snaps.get(matched.id)
                        if snap and item.get("balance") != snap.balance:
                            item["balance"] = snap.balance
                            detail_changed = True

            # 3. Sync credit cards (names & balances)
            if "credit_cards" in detail:
                for item in detail["credit_cards"]:
                    matched = next((a for a in accounts.values() if a.account_type == AccountType.CREDIT_CARD and (a.name in item.get("name") or item.get("name") in a.name)), None)
                    if matched:
                        if item.get("name") != matched.name:
                            item["name"] = matched.name
                            detail_changed = True
                        snap = db_snaps.get(matched.id)
                        if snap and item.get("payable") != abs(snap.balance):
                            item["payable"] = abs(snap.balance)
                            detail_changed = True

            # If any names or balances were edited directly in DB, recompute total fields of the BalanceSheet record
            if detail_changed:
                # Recalculate sheet sums
                total_cash = sum(c.get("balance", 0.0) for c in detail.get("cash", []))
                total_brokerage = sum(b.get("balance", 0.0) for b in detail.get("brokerage_cash", []))
                total_securities = sum(s.get("market_value", 0.0) for s in detail.get("securities", []))
                total_cc = sum(cc.get("payable", 0.0) for cc in detail.get("credit_cards", []))
                total_liab = sum(l.get("balance", 0.0) for l in detail.get("liabilities", []))

                bs.total_cash = total_cash + total_brokerage
                bs.total_securities_market_value = total_securities
                bs.total_assets = bs.total_cash + total_securities
                bs.total_credit_card_payable = -total_cc
                bs.total_liabilities = total_cc + total_liab
                bs.net_worth = bs.total_assets - bs.total_liabilities

                bs.detail_json = json.dumps(detail, ensure_ascii=False)
                self.db.add(bs)
                db_needs_commit = True

            result.append({
                "period": bs.period_date.isoformat(),
                "total_assets": bs.total_assets,
                "total_liabilities": bs.total_liabilities,
                "net_worth": bs.net_worth,
                "total_cash": bs.total_cash,
                "total_securities_market_value": bs.total_securities_market_value,
                "detail": detail,
            })

        if db_needs_commit:
            try:
                await self.db.commit()
                log.info("Auto-committed database-synchronized balances & names in balance sheet history.")
            except Exception as _e:
                log.warning(f"Failed to auto-commit synced balances in balance sheet history: {_e}")

        return result

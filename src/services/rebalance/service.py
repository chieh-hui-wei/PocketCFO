"""
src/services/rebalance/service.py
Service for portfolio rebalance calculation, strategy configuration, and alert email triggers.
"""
from __future__ import annotations

import logging
from datetime import date, datetime
from typing import Dict, Any, List
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.dbs.models import RebalanceStrategy, User
from src.services.reports.stock_holding import StockHoldingService
from src.services.reports.balance_sheet import BalanceSheetService
from src.services.email.service import send_rebalance_alert_email
from src.utils.date_utils import first_of_month

log = logging.getLogger(__name__)


class RebalanceService:
    def __init__(self, db: AsyncSession, user_id: int) -> None:
        self.db = db
        self.user_id = user_id

    async def get_or_create_strategy(self) -> RebalanceStrategy:

        """Retrieve or initialize user's rebalance strategy config."""
        stmt = select(RebalanceStrategy).where(RebalanceStrategy.user_id == self.user_id)
        res = await self.db.execute(stmt)
        strategy = res.scalar_one_or_none()

        if not strategy:
            strategy = RebalanceStrategy(
                user_id=self.user_id,
                target_stock_pct=50.0,
                target_bond_pct=10.0,
                target_cash_pct=40.0,
                stock_trigger_threshold=60.0,
                stock_min_threshold=40.0,
                bond_tickers="00931B,BND",
                enable_email_alert=True
            )
            self.db.add(strategy)
            await self.db.flush()
        return strategy

    async def update_strategy(
        self,
        target_stock_pct: float | None = None,
        target_bond_pct: float | None = None,
        target_cash_pct: float | None = None,
        stock_trigger_threshold: float | None = None,
        stock_min_threshold: float | None = None,
        bond_tickers: str | None = None,
        custom_cash_amount: float | None = None,
        enable_email_alert: bool | None = None,
    ) -> RebalanceStrategy:
        strategy = await self.get_or_create_strategy()

        if target_stock_pct is not None:
            strategy.target_stock_pct = target_stock_pct
            s_frac = target_stock_pct / 100.0
            # Stock price +50% rise formula: S*1.5 / (1 + 0.5*S)
            strategy.stock_trigger_threshold = round((s_frac * 1.5 / (1.0 + 0.5 * s_frac)) * 100.0, 2)
            # Stock price -33.33% drop formula: S*(2/3) / (1 - (1/3)*S)
            strategy.stock_min_threshold = round((s_frac * (2.0 / 3.0) / (1.0 - (1.0 / 3.0) * s_frac)) * 100.0, 2)
        if target_bond_pct is not None:
            strategy.target_bond_pct = target_bond_pct
        if target_cash_pct is not None:
            strategy.target_cash_pct = target_cash_pct
        if bond_tickers is not None:
            strategy.bond_tickers = bond_tickers.strip()
        if custom_cash_amount is not None:
            # If set to negative (e.g. -1), treat as clearing custom override
            strategy.custom_cash_amount = custom_cash_amount if custom_cash_amount >= 0 else None
        if enable_email_alert is not None:
            strategy.enable_email_alert = enable_email_alert

        await self.db.commit()
        return strategy

    async def analyze_rebalance(self, target_date: date | None = None) -> Dict[str, Any]:
        """
        Calculates current portfolio allocation, rebalance trade requirements,
        and post-rebalance projections.
        """
        if not target_date:
            target_date = date.today().replace(day=1)

        strategy = await self.get_or_create_strategy()
        bond_ticker_set = {t.strip().upper() for t in strategy.bond_tickers.split(",") if t.strip()}

        # 1. Fetch stock holdings
        stock_service = StockHoldingService(self.db, self.user_id)
        _, securities = await stock_service.get_or_compute_portfolio(target_date)

        # 2. Fetch cash balance from custom override or balance sheet service (with fallback to latest month)
        is_custom_cash = False
        if strategy.custom_cash_amount is not None and strategy.custom_cash_amount >= 0:
            total_cash_twd = strategy.custom_cash_amount
            is_custom_cash = True
        else:
            bs_service = BalanceSheetService(self.db, self.user_id)
            bs = await bs_service.compute(target_date.year, target_date.month)
            if bs and bs.total_cash > 0:
                total_cash_twd = bs.total_cash
            else:
                # Fallback: Query the most recent available BalanceSheet snapshot with non-zero cash
                from src.dbs.models import BalanceSheet, AccountSnapshot, Account, AccountType
                stmt = (
                    select(BalanceSheet)
                    .where(
                        BalanceSheet.user_id == self.user_id,
                        BalanceSheet.total_cash > 0
                    )
                    .order_by(BalanceSheet.period_date.desc())
                    .limit(1)
                )
                res = await self.db.execute(stmt)
                latest_bs = res.scalar_one_or_none()
                if latest_bs and latest_bs.total_cash > 0:
                    total_cash_twd = latest_bs.total_cash
                else:
                    # Secondary Fallback: Sum latest positive snapshots from cash/bank accounts
                    snap_stmt = (
                        select(AccountSnapshot.balance * AccountSnapshot.exchange_rate)
                        .join(Account, Account.id == AccountSnapshot.account_id)
                        .where(
                            Account.user_id == self.user_id,
                            Account.account_type == AccountType.BANK
                        )
                        .order_by(AccountSnapshot.period_date.desc())
                    )
                    snap_res = await self.db.execute(snap_stmt)
                    cash_balances = snap_res.scalars().all()
                    total_cash_twd = sum(b for b in cash_balances if b > 0) if cash_balances else 0.0

        # Categorize securities into Stock & Bond
        # Group and aggregate securities by ticker symbol across all broker accounts
        consolidated_map: Dict[str, Dict[str, Any]] = {}
        for sec in securities:
            ticker_upper = (sec.ticker or "").strip().upper()
            mv_twd = sec.market_value if sec.market_value else (sec.original_market_value * (sec.exchange_rate or 1.0))
            price_twd = sec.current_price if sec.current_price else (sec.original_current_price * (sec.exchange_rate or 1.0))

            if ticker_upper in consolidated_map:
                consolidated_map[ticker_upper]["quantity"] += sec.quantity
                consolidated_map[ticker_upper]["market_value"] += mv_twd
            else:
                consolidated_map[ticker_upper] = {
                    "id": sec.id,
                    "ticker": sec.ticker,
                    "name": sec.name or sec.ticker,
                    "quantity": sec.quantity,
                    "current_price": price_twd,
                    "market_value": mv_twd,
                    "currency": sec.currency or "TWD",
                    "exchange_rate": sec.exchange_rate or 1.0,
                }

        stock_items = []
        bond_items = []

        stock_mv_total = 0.0
        bond_mv_total = 0.0

        for ticker_upper, item in consolidated_map.items():
            mv_twd = item["market_value"]
            if ticker_upper in bond_ticker_set:
                bond_items.append(item)
                bond_mv_total += mv_twd
            else:
                stock_items.append(item)
                stock_mv_total += mv_twd

        total_portfolio_mv = stock_mv_total + bond_mv_total + total_cash_twd

        # Avoid division by zero
        safe_total_mv = max(total_portfolio_mv, 1.0)

        actual_stock_pct = (stock_mv_total / safe_total_mv) * 100.0
        actual_bond_pct = (bond_mv_total / safe_total_mv) * 100.0
        actual_cash_pct = (total_cash_twd / safe_total_mv) * 100.0

        # Calculate target market values
        target_stock_mv = (strategy.target_stock_pct / 100.0) * total_portfolio_mv
        target_bond_mv = (strategy.target_bond_pct / 100.0) * total_portfolio_mv
        target_cash_mv = (strategy.target_cash_pct / 100.0) * total_portfolio_mv

        # Per-item calculation logic
        rebalance_items = []

        # 1) Individual Stock holdings (Pro-rata target allocation based on existing stock weight)
        for sec_item in stock_items:
            item_weight_in_stock = (sec_item["market_value"] / stock_mv_total) if stock_mv_total > 0 else (1.0 / max(len(stock_items), 1))
            item_target_mv = target_stock_mv * item_weight_in_stock
            item_actual_pct = (sec_item["market_value"] / safe_total_mv) * 100.0
            trade_amount = item_target_mv - sec_item["market_value"]
            unit_price = max(sec_item["current_price"], 0.001)
            trade_shares = trade_amount / unit_price
            post_shares = sec_item["quantity"] + trade_shares
            post_mv = item_target_mv
            post_pct = (post_mv / safe_total_mv) * 100.0

            rebalance_items.append({
                "category": "STOCK",
                "ticker": sec_item["ticker"],
                "name": sec_item["name"],
                "quantity": sec_item["quantity"],
                "current_price": sec_item["current_price"],
                "current_market_value": sec_item["market_value"],
                "actual_pct": item_actual_pct,
                "target_pct": (item_target_mv / safe_total_mv) * 100.0,
                "trade_amount": round(trade_amount),
                "trade_shares": round(trade_shares),
                "post_rebalance_shares": round(post_shares),
                "post_rebalance_market_value": round(post_mv),
                "post_rebalance_pct": post_pct,
            })

        # 2) Individual Bond holdings
        for sec_item in bond_items:
            item_weight_in_bond = (sec_item["market_value"] / bond_mv_total) if bond_mv_total > 0 else (1.0 / max(len(bond_items), 1))
            item_target_mv = target_bond_mv * item_weight_in_bond
            item_actual_pct = (sec_item["market_value"] / safe_total_mv) * 100.0
            trade_amount = item_target_mv - sec_item["market_value"]
            unit_price = max(sec_item["current_price"], 0.001)
            trade_shares = trade_amount / unit_price
            post_shares = sec_item["quantity"] + trade_shares
            post_mv = item_target_mv
            post_pct = (post_mv / safe_total_mv) * 100.0

            rebalance_items.append({
                "category": "BOND",
                "ticker": sec_item["ticker"],
                "name": sec_item["name"],
                "quantity": sec_item["quantity"],
                "current_price": sec_item["current_price"],
                "current_market_value": sec_item["market_value"],
                "actual_pct": item_actual_pct,
                "target_pct": (item_target_mv / safe_total_mv) * 100.0,
                "trade_amount": round(trade_amount),
                "trade_shares": round(trade_shares),
                "post_rebalance_shares": round(post_shares),
                "post_rebalance_market_value": round(post_mv),
                "post_rebalance_pct": post_pct,
            })

        # 3) Cash item
        cash_trade_amount = target_cash_mv - total_cash_twd
        rebalance_items.append({
            "category": "CASH",
            "ticker": "現金總額",
            "name": "銀行與券商現金",
            "quantity": 1.0,
            "current_price": total_cash_twd,
            "current_market_value": total_cash_twd,
            "actual_pct": actual_cash_pct,
            "target_pct": strategy.target_cash_pct,
            "trade_amount": round(cash_trade_amount),
            "trade_shares": 0,
            "post_rebalance_shares": 1,
            "post_rebalance_market_value": round(target_cash_mv),
            "post_rebalance_pct": strategy.target_cash_pct,
        })

        is_triggered_rise = actual_stock_pct >= strategy.stock_trigger_threshold
        is_triggered_fall = actual_stock_pct <= getattr(strategy, "stock_min_threshold", 40.0)
        is_triggered = is_triggered_rise or is_triggered_fall

        trigger_direction = "RISE" if is_triggered_rise else ("FALL" if is_triggered_fall else "NONE")

        return {
            "period_date": str(target_date),
            "total_portfolio_value": round(total_portfolio_mv),
            "stock_market_value": round(stock_mv_total),
            "bond_market_value": round(bond_mv_total),
            "cash_market_value": round(total_cash_twd),
            "current_stock_pct": round(actual_stock_pct, 2),
            "current_bond_pct": round(actual_bond_pct, 2),
            "current_cash_pct": round(actual_cash_pct, 2),
            "target_stock_pct": strategy.target_stock_pct,
            "target_bond_pct": strategy.target_bond_pct,
            "target_cash_pct": strategy.target_cash_pct,
            "stock_trigger_threshold": strategy.stock_trigger_threshold,
            "stock_min_threshold": getattr(strategy, "stock_min_threshold", 40.0),
            "bond_tickers": strategy.bond_tickers,
            "custom_cash_amount": getattr(strategy, "custom_cash_amount", None),
            "is_custom_cash": is_custom_cash,
            "enable_email_alert": strategy.enable_email_alert,
            "is_triggered": is_triggered,
            "trigger_direction": trigger_direction,
            "rebalance_items": rebalance_items,
        }

    async def send_alert_email(self, target_date: date | None = None) -> Dict[str, Any]:
        """Manually or automatically send rebalance alert email."""
        analysis = await self.analyze_rebalance(target_date)

        user_stmt = select(User).where(User.id == self.user_id)
        res = await self.db.execute(user_stmt)
        user = res.scalar_one_or_none()

        if not user or not user.email:
            raise ValueError("User email not found")

        await send_rebalance_alert_email(user.email, analysis)

        strategy = await self.get_or_create_strategy()
        strategy.last_alert_sent_at = datetime.utcnow()
        await self.db.commit()

        return {"status": "success", "sent_to": user.email}

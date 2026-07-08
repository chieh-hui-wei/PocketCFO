"""
src/services/income_statement_service.py
Computes monthly income statement.

KEY CHALLENGE: Inter-account transfers (e.g. 台新→永豐) must NOT be counted
as income or expense. This service:
1. Collects all transactions for the month
2. Flags transfers using TransferDetector heuristics
3. Sums credit card bill items (net of refunds) as expenses
4. Identifies salary / investment income from bank credits
5. Saves the computed IncomeStatement
"""
from __future__ import annotations

import json
from datetime import date
from typing import Any

import logging
from sqlalchemy.ext.asyncio import AsyncSession

from src.dbs.models import AccountType, IncomeStatement, TransactionCategory, TransactionSource
from src.dbs.repository import (
    AccountRepository,
    IncomeStatementRepository,
    SnapshotRepository,
    TransactionRepository,
)
from src.instances.config import get_settings
from src.utils.date_utils import first_of_month
from src.utils.transfer_detector import TransferDetector

log = logging.getLogger(__name__)
settings = get_settings()

# Keywords that indicate salary / payroll in transaction descriptions
SALARY_KEYWORDS = ["薪資", "薪水", "工資", "月薪", "salary", "payroll", "PAYROLL"]
INVESTMENT_KEYWORDS = ["股息", "配息", "dividend", "DIVIDEND", "利息", "interest"]


class IncomeStatementService:
    def __init__(self, db: AsyncSession, user_id: int) -> None:
        self.db = db
        self.user_id = user_id
        self.account_repo = AccountRepository(db, user_id)
        self.txn_repo = TransactionRepository(db, user_id)
        self.is_repo = IncomeStatementRepository(db, user_id)
        self.transfer_detector = None

    async def compute(self, year: int, month: int) -> IncomeStatement:
        period = first_of_month(year, month)
        accounts = await self.account_repo.get_all()
        
        # Build dynamic list of internal account IDs
        internal_aids = []
        for a in accounts:
            if a.is_internal:
                internal_aids.append(a.code)
                if "_" in a.code:
                    internal_aids.append(a.code.split("_")[-1])
                if a.notes:
                    internal_aids.append(a.notes)
        self.transfer_detector = TransferDetector(list(set(internal_aids)))

        detail: dict[str, Any] = {
            "income_sources": [],
            "expense_sources": [],
            "transfers_excluded": [],
        }

        salary_income = 0.0
        investment_income = 0.0
        other_income = 0.0
        bank_expenses = 0.0
        credit_card_expenses = 0.0

        # ── Process bank transactions ──────────────────────────────────────
        for account in accounts:
            if account.account_type not in (AccountType.BANK,):
                continue
            txns = await self.txn_repo.get_by_period(account.id, period)
            for txn in txns:
                if txn.is_internal_transfer:
                    detail["transfers_excluded"].append(
                        {
                            "date": str(txn.txn_date),
                            "desc": txn.description,
                            "amount": txn.amount,
                            "account": account.name,
                        }
                    )
                    continue

                if txn.amount > 0:
                    # Income
                    desc_upper = (txn.description or "").upper()
                    if txn.category == TransactionCategory.SALARY:
                        salary_income += txn.amount
                        detail["income_sources"].append(
                            {"type": "salary", "amount": txn.amount, "desc": txn.description}
                        )
                    elif txn.category == TransactionCategory.INVESTMENT or any(kw in desc_upper for kw in [k.upper() for k in INVESTMENT_KEYWORDS]):
                        investment_income += txn.amount
                        detail["income_sources"].append(
                            {"type": "investment", "amount": txn.amount, "desc": txn.description}
                        )
                    else:
                        other_income += txn.amount
                        detail["income_sources"].append(
                            {"type": "other", "amount": txn.amount, "desc": txn.description}
                        )
                else:
                    if txn.category not in (
                        TransactionCategory.INVESTMENT,
                        TransactionCategory.TRANSFER_IN,
                        TransactionCategory.TRANSFER_OUT,
                        TransactionCategory.CREDIT_CARD_PAYMENT,
                        TransactionCategory.DEBT_REPAYMENT,
                    ):
                        bank_expenses += abs(txn.amount)
                        detail["expense_sources"].append(
                            {
                                "type": "bank_debit",
                                "amount": abs(txn.amount),
                                "desc": txn.description,
                                "account": account.name,
                            }
                        )
        # ── Process credit card transactions (migrated from bills/items) ────
        cc_txns = await self.txn_repo.get_by_period_and_source(period, TransactionSource.CREDIT_CARD)
        net = 0.0
        by_cat: dict[str, float] = {}
        for tx in cc_txns:
            amt = abs(tx.amount)
            sign = -1 if getattr(tx, "is_refund", False) else 1
            net += sign * amt
            # Attempt to get original category from raw_data if present
            cat = "other"
            try:
                if tx.raw_data:
                    payload = json.loads(tx.raw_data)
                    cat = payload.get("category") or payload.get("merchant") or "other"
            except Exception:
                cat = "other"
            by_cat[cat] = by_cat.get(cat, 0) + sign * amt

        credit_card_expenses += net
        detail["expense_sources"].append(
            {
                "type": "credit_card",
                "account": "credit_card_accounts",
                "total": net,
                "by_category": by_cat,
            }
        )

        # ── Process e-invoice transactions ─────────────────────────────────
        ei_txns = await self.txn_repo.get_by_period_and_source(period, TransactionSource.E_INVOICE)
        einvoice_expenses = 0.0
        for tx in ei_txns:
            if not tx.is_duplicate:
                einvoice_expenses += abs(tx.amount)
                detail["expense_sources"].append(
                    {
                        "type": "einvoice",
                        "amount": abs(tx.amount),
                        "desc": tx.description or tx.merchant,
                        "payment_method": tx.payment_method,
                    }
                )
        detail["einvoice_expenses"] = einvoice_expenses

        total_income = salary_income + investment_income + other_income
        total_expenses = bank_expenses + credit_card_expenses + einvoice_expenses
        net_savings = total_income - total_expenses

        stmt = IncomeStatement(
            period_date=period,
            total_income=total_income,
            salary_income=salary_income,
            investment_income=investment_income,
            other_income=other_income,
            total_expenses=total_expenses,
            credit_card_expenses=credit_card_expenses,
            bank_expenses=bank_expenses,
            net_savings=net_savings,
            detail_json=json.dumps(detail, ensure_ascii=False),
        )
        saved = await self.is_repo.upsert(stmt)
        log.info(
            f"income_statement.computed period={period} income={total_income} expenses={total_expenses} savings={net_savings}"
        )
        return saved

    async def get_history(self, months: int = 12) -> list[dict[str, Any]]:
        all_is = await self.is_repo.list_all()
        return [
            {
                "period": s.period_date.isoformat(),
                "total_income": s.total_income,
                "total_expenses": s.total_expenses,
                "net_savings": s.net_savings,
                "salary_income": s.salary_income,
                "investment_income": s.investment_income,
                "credit_card_expenses": s.credit_card_expenses,
                "bank_expenses": s.bank_expenses,
            }
            for s in all_is[:months]
        ]

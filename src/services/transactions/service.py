"""
src/services/transactions/service.py
Service layer for Transaction operations, category translations, and bulk actions.
"""
from __future__ import annotations

import logging
from typing import Any
from sqlalchemy import select, delete as sa_delete
from sqlalchemy.ext.asyncio import AsyncSession

from src.dbs.models import Transaction, TransactionCategory, AccountSnapshot
from src.services.reports.income_statement import IncomeStatementService
from src.services.reports.balance_sheet import BalanceSheetService

log = logging.getLogger(__name__)

CATEGORY_TRANSLATION = {
    "SALARY": "薪資",
    "INVESTMENT": "投資",
    "TRANSFER_IN": "轉入",
    "TRANSFER_OUT": "轉出",
    "EXPENSE": "固定支出",
    "FOOD": "食物",
    "TRANSPORT": "交通",
    "MEDICAL": "醫療",
    "ENTERTAINMENT": "娛樂",
    "INSURANCE": "保險",
    "EXERCISE": "運動",
    "SHOPPING": "購物",
    "TRAVEL": "旅遊",
    "STUDY": "學習",
    "CREDIT_CARD_PAYMENT": "信用卡繳款",
    "DEBT_REPAYMENT": "本金償還",
    "DIVIDEND": "股利",
    "INTEREST": "利息",
    "OTHER": "非固定支出"
}


_EXTRA_LABEL_ALIASES = {
    "帳內互轉": "TRANSFER_IN",
    "非固定支出": "OTHER",
    "非固定收入": "OTHER",
    "其他收入": "OTHER",
    "其他支出": "OTHER",
    "其他": "OTHER",
    "支出": "EXPENSE",
}


class TransactionService:
    @staticmethod
    def get_category_translation_map() -> dict[str, str]:
        return CATEGORY_TRANSLATION

    @staticmethod
    def resolve_category_update(category_label: str, amount: float) -> tuple[TransactionCategory, bool]:
        """
        Resolve a user-facing category label (Chinese label or raw enum name) plus the
        transaction's amount into the (TransactionCategory, is_internal_transfer) to store.

        The generic "帳內互轉" label doesn't specify a direction, so the direction is derived
        from the amount's sign (credit -> TRANSFER_IN, debit -> TRANSFER_OUT). An explicit
        "轉入"/"轉出" (or TRANSFER_IN/TRANSFER_OUT) choice is always respected as-is, even if it
        doesn't match the amount's sign.
        """
        reverse_cat = {v: k for k, v in CATEGORY_TRANSLATION.items()}
        reverse_cat.update(_EXTRA_LABEL_ALIASES)
        is_generic_transfer_label = category_label == "帳內互轉"

        cat_val = reverse_cat.get(category_label, category_label)
        if isinstance(cat_val, str):
            cat_val = cat_val.upper()
        try:
            category = TransactionCategory(cat_val)
        except ValueError:
            category = TransactionCategory.OTHER

        if category in (TransactionCategory.TRANSFER_IN, TransactionCategory.TRANSFER_OUT):
            if is_generic_transfer_label:
                category = TransactionCategory.TRANSFER_IN if amount > 0 else TransactionCategory.TRANSFER_OUT
            return category, True

        return category, False

    @staticmethod
    async def recompute_affected_periods(db: AsyncSession, user_id: int, periods: set[tuple[int, int]]) -> None:
        """
        Recomputes income statements and balance sheets for affected (year, month) pairs.
        """
        if not periods:
            return
        is_service = IncomeStatementService(db, user_id)
        bs_service = BalanceSheetService(db, user_id)
        for year, month in sorted(periods):
            await is_service.compute(year, month)
            await bs_service.compute(year, month)

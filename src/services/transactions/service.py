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


class TransactionService:
    @staticmethod
    def get_category_translation_map() -> dict[str, str]:
        return CATEGORY_TRANSLATION

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

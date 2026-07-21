"""
src/services/account/service.py
Service layer for account management, snapshots, and report recomputations.
"""
from __future__ import annotations

import logging
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.dbs.models import Account, Transaction, TransactionCategory, AccountSnapshot
from src.utils.transfer_detector import TransferDetector
from src.services.reports.income_statement import IncomeStatementService
from src.services.reports.balance_sheet import BalanceSheetService

log = logging.getLogger(__name__)


class AccountService:
    @staticmethod
    async def reclassify_and_recompute_all(db: AsyncSession, user_id: int) -> None:
        """
        Re-evaluates internal transfers across all user transactions based on account internal flags,
        and recomputes affected income statement and balance sheet reports.
        """
        result_accs = await db.execute(select(Account).where(Account.user_id == user_id))
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

        result_snaps = await db.execute(select(AccountSnapshot).where(AccountSnapshot.user_id == user_id))
        snaps = result_snaps.scalars().all()
        for snap in snaps:
            affected_periods.add((snap.period_date.year, snap.period_date.month))

        if affected_periods:
            is_service = IncomeStatementService(db, user_id)
            bs_service = BalanceSheetService(db, user_id)
            for year, month in sorted(affected_periods):
                await is_service.compute(year, month)
                await bs_service.compute(year, month)

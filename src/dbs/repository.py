"""
src/dbs/repository.py
Data access layer — all DB queries live here, never in services or controllers.
"""
from __future__ import annotations

from datetime import date
from typing import Sequence

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload


from src.dbs.models import (
    Account,
    AccountSnapshot,
    BalanceSheet,
    IncomeStatement,
    Security,
    Transaction,
    UploadHistory,
)


# ── Account ────────────────────────────────────────────────────────────────────

class AccountRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get_all(self) -> Sequence[Account]:
        result = await self.db.execute(select(Account).where(Account.is_active == True))
        return result.scalars().all()

    async def get_by_id(self, account_id: int) -> Account | None:
        return await self.db.get(Account, account_id)

    async def get_by_code(self, code: str) -> Account | None:
        result = await self.db.execute(select(Account).where(Account.code == code))
        return result.scalar_one_or_none()

    async def create(self, account: Account) -> Account:
        self.db.add(account)
        await self.db.flush()
        return account

    async def get_internal(self) -> Sequence[Account]:
        result = await self.db.execute(select(Account).where(Account.is_internal == True))
        return result.scalars().all()


# ── AccountSnapshot ────────────────────────────────────────────────────────────

class SnapshotRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def upsert(self, snapshot: AccountSnapshot) -> AccountSnapshot:
        existing = await self.db.execute(
            select(AccountSnapshot).where(
                AccountSnapshot.account_id == snapshot.account_id,
                AccountSnapshot.period_date == snapshot.period_date,
            )
        )
        row = existing.scalar_one_or_none()
        if row:
            row.balance = snapshot.balance
            row.payment_due_date = snapshot.payment_due_date
            row.source = snapshot.source
            row.raw_data = snapshot.raw_data
            return row
        self.db.add(snapshot)
        await self.db.flush()
        return snapshot

    async def get_by_period(self, period_date: date) -> Sequence[AccountSnapshot]:
        result = await self.db.execute(
            select(AccountSnapshot).where(AccountSnapshot.period_date == period_date)
        )
        return result.scalars().all()

    async def get_latest_before_or_equal(self, period_date: date) -> Sequence[AccountSnapshot]:
        subq = (
            select(
                AccountSnapshot.account_id,
                func.max(AccountSnapshot.period_date).label("max_date")
            )
            .where(AccountSnapshot.period_date <= period_date)
            .group_by(AccountSnapshot.account_id)
            .subquery()
        )
        query = (
            select(AccountSnapshot)
            .join(
                subq,
                (AccountSnapshot.account_id == subq.c.account_id) &
                (AccountSnapshot.period_date == subq.c.max_date)
            )
        )
        result = await self.db.execute(query)
        return result.scalars().all()

    async def get_history(self, account_id: int, limit: int = 24) -> Sequence[AccountSnapshot]:
        result = await self.db.execute(
            select(AccountSnapshot)
            .where(AccountSnapshot.account_id == account_id)
            .order_by(AccountSnapshot.period_date.desc())
            .limit(limit)
        )
        return result.scalars().all()


# ── Security ───────────────────────────────────────────────────────────────────

class SecurityRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def upsert_many(self, securities: list[Security]) -> None:
        for s in securities:
            existing = await self.db.execute(
                select(Security).where(
                    Security.account_id == s.account_id,
                    Security.period_date == s.period_date,
                    Security.ticker == s.ticker,
                )
            )
            row = existing.scalar_one_or_none()
            if row:
                row.quantity = s.quantity
                row.avg_cost = s.avg_cost
                row.current_price = s.current_price
                row.market_value = s.market_value
                row.unrealized_pnl = s.unrealized_pnl
            else:
                self.db.add(s)
        await self.db.flush()

    async def get_by_period(self, period_date: date) -> Sequence[Security]:
        result = await self.db.execute(
            select(Security).where(Security.period_date == period_date)
        )
        return result.scalars().all()

    async def get_latest_before_or_equal(self, period_date: date) -> Sequence[Security]:
        subq = (
            select(
                Security.account_id,
                func.max(Security.period_date).label("max_date")
            )
            .where(Security.period_date <= period_date)
            .group_by(Security.account_id)
            .subquery()
        )
        query = (
            select(Security)
            .join(
                subq,
                (Security.account_id == subq.c.account_id) &
                (Security.period_date == subq.c.max_date)
            )
        )
        result = await self.db.execute(query)
        return result.scalars().all()


# ── Transaction ────────────────────────────────────────────────────────────────

class TransactionRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def bulk_insert(self, txns: list[Transaction]) -> None:
        self.db.add_all(txns)
        await self.db.flush()

    async def get_by_period(self, account_id: int | None, period_date: date) -> Sequence[Transaction]:
        start = period_date.replace(day=1)
        # end = last day of month
        import calendar
        last_day = calendar.monthrange(period_date.year, period_date.month)[1]
        end = period_date.replace(day=last_day)
        stmt = select(Transaction).options(joinedload(Transaction.account)).where(
            Transaction.txn_date >= start,
            Transaction.txn_date <= end,
        )
        if account_id is not None:
            stmt = stmt.where(Transaction.account_id == account_id)
        result = await self.db.execute(stmt)
        return result.scalars().all()

    async def get_by_period_and_source(self, period_date: date, source: str) -> Sequence[Transaction]:
        start = period_date.replace(day=1)
        import calendar
        last_day = calendar.monthrange(period_date.year, period_date.month)[1]
        end = period_date.replace(day=last_day)
        result = await self.db.execute(
            select(Transaction).where(
                Transaction.txn_date >= start,
                Transaction.txn_date <= end,
                Transaction.source == source,
            )
        )
        return result.scalars().all()

    async def mark_duplicates(self, txn_ids: list[int], is_dup: bool = True) -> None:
        from sqlalchemy import update
        if not txn_ids:
            return
        await self.db.execute(
            update(Transaction).where(Transaction.id.in_(txn_ids)).values(is_duplicate=is_dup)
        )
        await self.db.flush()


# ── CreditCardBill ─────────────────────────────────────────────────────────────

# Credit card bills and e-invoice repositories removed — data is now stored in `transactions`.


# ── BalanceSheet ───────────────────────────────────────────────────────────────

class BalanceSheetRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def upsert(self, bs: BalanceSheet) -> BalanceSheet:
        existing = await self.db.execute(
            select(BalanceSheet).where(BalanceSheet.period_date == bs.period_date)
        )
        row = existing.scalar_one_or_none()
        if row:
            for field in ("total_cash", "total_securities_market_value", "total_assets",
                          "total_credit_card_payable", "total_liabilities", "net_worth", "detail_json"):
                setattr(row, field, getattr(bs, field))
            return row
        self.db.add(bs)
        await self.db.flush()
        return bs

    async def list_all(self) -> Sequence[BalanceSheet]:
        result = await self.db.execute(
            select(BalanceSheet).order_by(BalanceSheet.period_date.desc())
        )
        return result.scalars().all()

    async def get_by_period(self, period_date: date) -> BalanceSheet | None:
        result = await self.db.execute(
            select(BalanceSheet).where(BalanceSheet.period_date == period_date)
        )
        return result.scalar_one_or_none()


# ── IncomeStatement ────────────────────────────────────────────────────────────

class IncomeStatementRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def upsert(self, stmt: IncomeStatement) -> IncomeStatement:
        existing = await self.db.execute(
            select(IncomeStatement).where(IncomeStatement.period_date == stmt.period_date)
        )
        row = existing.scalar_one_or_none()
        if row:
            for field in ("total_income", "salary_income", "investment_income", "other_income",
                          "total_expenses", "credit_card_expenses", "bank_expenses",
                          "net_savings", "detail_json"):
                setattr(row, field, getattr(stmt, field))
            return row
        self.db.add(stmt)
        await self.db.flush()
        return stmt

    async def list_all(self) -> Sequence[IncomeStatement]:
        result = await self.db.execute(
            select(IncomeStatement).order_by(IncomeStatement.period_date.desc())
        )
        return result.scalars().all()


# ── EInvoiceItem ───────────────────────────────────────────────────────────────

# EInvoiceItem repository removed — use TransactionRepository with source==TransactionSource.E_INVOICE

# ── UploadHistory ───────────────────────────────────────────────────────────────

class UploadHistoryRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def create(self, filename: str, kind: str, status: str, message: str | None = None, file_hash: str | None = None) -> UploadHistory:
        history = UploadHistory(filename=filename, kind=kind, status=status, message=message, file_hash=file_hash)
        self.db.add(history)
        await self.db.flush()
        return history

    async def get_by_hash(self, file_hash: str) -> UploadHistory | None:
        from sqlalchemy import select
        result = await self.db.execute(
            select(UploadHistory).where(UploadHistory.file_hash == file_hash, UploadHistory.status == 'success')
        )
        return result.scalars().first()

    async def update(self, history_id: int, status: str, message: str | None = None) -> None:
        from sqlalchemy import update
        await self.db.execute(
            update(UploadHistory).where(UploadHistory.id == history_id).values(status=status, message=message)
        )
        await self.db.flush()

    async def delete(self, history_id: int) -> bool:
        from sqlalchemy import delete
        from src.dbs.models import Transaction, AccountSnapshot, Security
        
        # Cascade delete
        await self.db.execute(delete(Transaction).where(Transaction.upload_history_id == history_id))
        await self.db.execute(delete(AccountSnapshot).where(AccountSnapshot.upload_history_id == history_id))
        await self.db.execute(delete(Security).where(Security.upload_history_id == history_id))

        result = await self.db.execute(delete(UploadHistory).where(UploadHistory.id == history_id))
        await self.db.flush()
        return result.rowcount > 0

    async def list_recent(self, limit: int = 50) -> Sequence[UploadHistory]:
        from sqlalchemy import select
        result = await self.db.execute(
            select(UploadHistory).order_by(UploadHistory.created_at.desc()).limit(limit)
        )
        return result.scalars().all()

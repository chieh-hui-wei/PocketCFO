"""
One-time script to recompute all stored IncomeStatement records.
Run from project root: PYTHONPATH=. .venv/bin/python scripts/recompute_all_income_statements.py
"""
import asyncio
import os
from dotenv import load_dotenv

load_dotenv()

import sys
sys.path.insert(0, ".")

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import select

from src.dbs.models import IncomeStatement
from src.services.reports.income_statement import IncomeStatementService


async def main():
    db_url = os.environ.get("DATABASE_URL") or os.environ.get("DB_URL")
    if not db_url:
        print("ERROR: DATABASE_URL / DB_URL not set in .env")
        return

    # Ensure async-compatible URL
    if db_url.startswith("postgres://"):
        db_url = db_url.replace("postgres://", "postgresql+asyncpg://", 1)
    elif db_url.startswith("postgresql://") and "+asyncpg" not in db_url:
        db_url = db_url.replace("postgresql://", "postgresql+asyncpg://", 1)

    engine = create_async_engine(db_url, echo=False)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with async_session() as db:
        # Get all stored income statement records grouped by user
        res = await db.execute(
            select(IncomeStatement.user_id, IncomeStatement.period_date)
            .order_by(IncomeStatement.user_id, IncomeStatement.period_date)
        )
        rows = res.all()

        if not rows:
            print("No stored income statement records found.")
            return

        print(f"Found {len(rows)} stored income statement record(s) to recompute.")

        for user_id, period_date in rows:
            svc = IncomeStatementService(db, user_id)
            try:
                stmt = await svc.compute(period_date.year, period_date.month)
                print(f"  ✓ user={user_id} period={period_date} → income={stmt.total_income:.0f}, expenses={stmt.total_expenses:.0f}, savings={stmt.net_savings:.0f}")
            except Exception as e:
                print(f"  ✗ user={user_id} period={period_date} → ERROR: {e}")

        await db.commit()
        print("\nDone. All records recomputed and committed.")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())

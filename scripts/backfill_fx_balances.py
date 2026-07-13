"""
scripts/backfill_fx_balances.py

One-time migration: for every AccountSnapshot whose currency is not TWD,
re-fetch the end-of-month exchange rate for that period and recompute
`balance` (TWD) from `original_balance`.

Run from project root:
    conda run -n dev python scripts/backfill_fx_balances.py

Or with .venv:
    PYTHONPATH=. .venv/bin/python scripts/backfill_fx_balances.py
"""
import asyncio
import calendar
import os
import sys
from datetime import date

from dotenv import load_dotenv

load_dotenv()
sys.path.insert(0, ".")

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from src.dbs.models import Account, AccountSnapshot
from src.services.exchange_rate import get_currency_twd_rate


def _eom(period_date: date) -> date:
    """Return the last calendar day of the month for a given date."""
    last = calendar.monthrange(period_date.year, period_date.month)[1]
    return date(period_date.year, period_date.month, last)


async def main() -> None:
    db_url = os.environ.get("DATABASE_URL") or os.environ.get("DB_URL")
    if not db_url:
        print("ERROR: DATABASE_URL / DB_URL not set in .env")
        return

    if db_url.startswith("postgres://"):
        db_url = db_url.replace("postgres://", "postgresql+asyncpg://", 1)
    elif db_url.startswith("postgresql://") and "+asyncpg" not in db_url:
        db_url = db_url.replace("postgresql://", "postgresql+asyncpg://", 1)

    engine = create_async_engine(db_url, echo=False)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with async_session() as db:
        # Load all non-TWD snapshots
        res = await db.execute(
            select(AccountSnapshot)
            .where(AccountSnapshot.currency != "TWD")
            .order_by(AccountSnapshot.period_date)
        )
        snaps = res.scalars().all()

        if not snaps:
            print("No non-TWD snapshots found. Nothing to do.")
            await engine.dispose()
            return

        print(f"Found {len(snaps)} non-TWD snapshot(s) to backfill.\n")

        # Cache rates so we don't hammer the API with identical requests
        _rate_cache: dict[tuple[str, date], float] = {}
        updated = 0
        skipped = 0

        for snap in snaps:
            ccy = snap.currency
            eom = _eom(snap.period_date)
            cache_key = (ccy.lower(), eom)

            # Determine the original (foreign-currency) balance
            orig = snap.original_balance
            if orig is None:
                # Treat current balance as the foreign amount when original_balance was never set
                orig = snap.balance

            # Fetch rate (with cache)
            if cache_key not in _rate_cache:
                try:
                    rate = await get_currency_twd_rate(eom, from_currency=ccy)
                    _rate_cache[cache_key] = rate
                except Exception as e:
                    print(f"  x snapshot id={snap.id} {ccy}/{eom}: could not fetch rate - {e}")
                    skipped += 1
                    continue
            rate = _rate_cache[cache_key]

            new_balance_twd = round(orig * rate)

            # Fetch account name for display
            acc_res = await db.execute(select(Account).where(Account.id == snap.account_id))
            acc = acc_res.scalar_one_or_none()
            acc_name = acc.name if acc else f"account_id={snap.account_id}"

            print(
                f"  ok [{snap.period_date}] {acc_name} | {ccy} {orig:,.4f} x {rate:.4f} "
                f"= TWD {new_balance_twd:,.0f}  (was {snap.balance:,.0f})"
            )

            snap.original_balance = orig
            snap.exchange_rate = rate
            snap.balance = new_balance_twd
            db.add(snap)
            updated += 1

        await db.commit()
        print(f"\nDone. Updated {updated} snapshot(s), skipped {skipped}.")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())

import asyncio
from sqlalchemy import select
from src.instances.database import get_db
from src.dbs.models import Account, AccountSnapshot, AccountType

async def run():
    async for db in get_db():
        stmt = select(AccountSnapshot).order_by(AccountSnapshot.period_date.desc())
        res = await db.execute(stmt)
        snaps = res.scalars().all()
        print("Snapshots list:")
        for s in snaps:
            stmt_acct = select(Account).where(Account.id == s.account_id)
            res_acct = await db.execute(stmt_acct)
            acc = res_acct.scalar_one_or_none()
            acc_type = acc.account_type.value if acc else "Unknown"
            print(f"Date: {s.period_date}, Account: {acc.name if acc else 'Unknown'} ({acc_type}), Balance: {s.balance}, Source: {s.source}")

if __name__ == "__main__":
    asyncio.run(run())

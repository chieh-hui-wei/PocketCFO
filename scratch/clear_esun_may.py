import asyncio
from sqlalchemy import select, delete
from src.instances.database import AsyncSessionLocal
from src.dbs.models import Account, AccountSnapshot, Security
from src.services.reports.balance_sheet import BalanceSheetService

async def main():
    async with AsyncSessionLocal() as db:
        # 1. Find E-Sun Securities account
        stmt = select(Account).where(
            Account.account_type == "brokerage",
            Account.institution.like("%玉山%")
        )
        result = await db.execute(stmt)
        accounts = result.scalars().all()
        
        if not accounts:
            print("No E-Sun Securities account found in database.")
            return
            
        target_date = "2026-05-01"
        from datetime import datetime
        period = datetime.strptime(target_date, "%Y-%m-%d").date()
        
        for acc in accounts:
            print(f"Found account: ID={acc.id}, Code={acc.code}, Name={acc.name}")
            
            # Delete snapshots for May 2026
            snap_stmt = delete(AccountSnapshot).where(
                AccountSnapshot.account_id == acc.id,
                AccountSnapshot.period_date == period
            )
            snap_res = await db.execute(snap_stmt)
            print(f"Deleted {snap_res.rowcount} AccountSnapshot records for May 2026.")
            
            # Delete securities for May 2026
            sec_stmt = delete(Security).where(
                Security.account_id == acc.id,
                Security.period_date == period
            )
            sec_res = await db.execute(sec_stmt)
            print(f"Deleted {sec_res.rowcount} Security records for May 2026.")
            
        await db.flush()
        
        # 2. Recompute Balance Sheet for May 2026
        bs_service = BalanceSheetService(db)
        await bs_service.compute(2026, 5)
        print("Recomputed balance sheet for 2026-05.")
        
        await db.commit()
        print("Successfully committed database changes!")

if __name__ == "__main__":
    asyncio.run(main())

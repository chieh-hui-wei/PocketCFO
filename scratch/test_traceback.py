import asyncio
import sys

sys.path.append('/app')

from src.instances.database import AsyncSessionLocal
from src.services.reports.balance_sheet import BalanceSheetService
from src.services.reports.income_statement import IncomeStatementService

async def test():
    async with AsyncSessionLocal() as db:
        is_service = IncomeStatementService(db)
        bs_service = BalanceSheetService(db)
        print("Computing income statement...")
        await is_service.compute(2026, 5)
        print("Computing balance sheet...")
        await bs_service.compute(2026, 5)
        print("Done successfully!")

if __name__ == "__main__":
    asyncio.run(test())

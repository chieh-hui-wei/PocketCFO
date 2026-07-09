import asyncio
from sqlalchemy import select
from sqlalchemy.orm import joinedload
from src.instances.database import get_db
from src.dbs.models import Transaction, Account, AccountType, TransactionCategory

async def migrate():
    async for db in get_db():
        # Select all transactions with their accounts
        res = await db.execute(
            select(Transaction)
            .options(joinedload(Transaction.account))
        )
        txns = res.scalars().all()
        print(f"Total transactions: {len(txns)}")
        
        updated_count = 0
        for t in txns:
            if t.account and t.account.account_type == AccountType.CREDIT_CARD:
                # If credit card txn has positive amount and is not a refund/transfer
                if t.amount > 0 and not t.is_refund and t.category not in (TransactionCategory.TRANSFER_IN, TransactionCategory.TRANSFER_OUT):
                    print(f"Fixing credit card txn {t.id}: {t.description} amount={t.amount} -> {-t.amount}")
                    t.amount = -t.amount
                    db.add(t)
                    updated_count += 1
        
        print(f"Negated {updated_count} positive credit card transactions.")
        
        # Force reclassification and recomputation of all reports
        from src.controllers.account import reclassify_and_recompute_all
        try:
            # We run it for user 1 (default user)
            await reclassify_and_recompute_all(db, user_id=1)
            await db.commit()
            print("Successfully reclassified and recomputed all reports.")
        except Exception as e:
            print(f"Error during reclassification: {e}")
            await db.rollback()

if __name__ == "__main__":
    asyncio.run(migrate())

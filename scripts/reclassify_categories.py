"""
scripts/reclassify_categories.py
One-time migration script: re-classifies all existing transactions that have
category='expense' or category='other' using Gemini AI.

Run once from the project root:
    python scripts/reclassify_categories.py

Optional: target a specific user ID
    python scripts/reclassify_categories.py --user-id 2
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import sys
import os

# Allow imports from project root
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

BATCH = 50  # transactions per Gemini call


async def reclassify(user_id: int) -> None:
    from sqlalchemy import select
    from src.instances.database import AsyncSessionLocal
    from src.dbs.models import Transaction, TransactionCategory
    from src.dbs.repository import CategoryRuleRepository
    from src.utils.category_classifier import classify_transactions_batch, _category_to_enum

    async with AsyncSessionLocal() as db:
        # Fetch all expense/other transactions that have a merchant
        stmt = select(Transaction).where(
            Transaction.user_id == user_id,
            Transaction.category.in_([
                TransactionCategory.EXPENSE,
                TransactionCategory.OTHER,
            ]),
            Transaction.merchant.isnot(None),
            Transaction.merchant != "",
        )
        result = await db.execute(stmt)
        txns = list(result.scalars().all())

        if not txns:
            log.info("No expense/other transactions with a merchant found — nothing to do.")
            return

        log.info(f"Found {len(txns)} transactions to reclassify for user_id={user_id}")

        rule_repo = CategoryRuleRepository(db, user_id)
        rules = list(await rule_repo.list_all())
        log.info(f"Loaded {len(rules)} user-defined override rules")

        updated = 0
        for i in range(0, len(txns), BATCH):
            batch = txns[i : i + BATCH]
            classify_items = [
                {"id": str(t.id), "merchant": t.merchant or "", "description": t.description or ""}
                for t in batch
            ]
            log.info(f"Classifying batch {i // BATCH + 1} ({len(batch)} transactions)...")
            classification = await classify_transactions_batch(classify_items, rules)

            for t in batch:
                cat_str = classification.get(str(t.id))
                if cat_str and cat_str not in ("expense", "other"):
                    old = t.category.value
                    t.category = _category_to_enum(cat_str)
                    log.info(f"  txn {t.id} [{t.merchant}]: {old} → {cat_str}")
                    updated += 1

        await db.commit()
        log.info(f"Done. Updated {updated}/{len(txns)} transactions.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Re-classify expense/other transactions with Gemini")
    parser.add_argument("--user-id", type=int, default=1, help="User ID to reclassify (default: 1)")
    args = parser.parse_args()
    asyncio.run(reclassify(args.user_id))


if __name__ == "__main__":
    main()

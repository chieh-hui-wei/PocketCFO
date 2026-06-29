"""
scripts/reclassify_categories.py
One-time migration script: re-classifies all existing transactions that have
category='EXPENSE' or category='OTHER' using Gemini AI.

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

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

BATCH = 50

# Map classifier output → actual DB enum value (must match what PostgreSQL stores)
# Old values are uppercase (stored by SQLAlchemy using enum .name), new ones lowercase
CATEGORY_TO_DB = {
    "food": "food",
    "transport": "transport",
    "medical": "medical",
    "entertainment": "entertainment",
    "salary": "SALARY",
    "investment": "INVESTMENT",
    "dividend": "DIVIDEND",
    "interest": "INTEREST",
    "other": "OTHER",
}


async def run_schema_migrations() -> None:
    """Ensure new enum values exist. Each ALTER TYPE must be in its own committed transaction."""
    from sqlalchemy import text
    from src.instances.database import engine

    new_values = ["food", "transport", "medical", "entertainment"]
    for val in new_values:
        try:
            async with engine.begin() as conn:
                await conn.execute(text(f"ALTER TYPE transactioncategory ADD VALUE IF NOT EXISTS '{val}'"))
            log.info(f"migration ok: added enum value '{val}'")
        except Exception as e:
            log.warning(f"migration skip '{val}': {e}")

    # Drop orphaned column if it still exists
    try:
        async with engine.begin() as conn:
            await conn.execute(text("ALTER TABLE transactions DROP COLUMN IF EXISTS expense_category"))
        log.info("migration ok: dropped expense_category column")
    except Exception as e:
        log.warning(f"migration skip expense_category drop: {e}")

    # Create category_rules table
    try:
        async with engine.begin() as conn:
            await conn.execute(text("""
                CREATE TABLE IF NOT EXISTS category_rules (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id),
                    keyword VARCHAR(128) NOT NULL,
                    category VARCHAR(32) NOT NULL,
                    created_at TIMESTAMP DEFAULT now(),
                    UNIQUE (user_id, keyword)
                )
            """))
        log.info("migration ok: category_rules table")
    except Exception as e:
        log.warning(f"migration skip category_rules: {e}")


async def reclassify(user_id: int) -> None:
    from sqlalchemy import text
    from src.instances.database import AsyncSessionLocal
    from src.dbs.repository import CategoryRuleRepository
    from src.utils.category_classifier import classify_transactions_batch

    async with AsyncSessionLocal() as db:
        # Old rows store uppercase enum names — filter by actual DB values
        result = await db.execute(text("""
            SELECT id, merchant, description
            FROM transactions
            WHERE user_id = :uid
              AND category::text IN ('EXPENSE', 'OTHER')
              AND merchant IS NOT NULL
              AND merchant != ''
        """), {"uid": user_id})
        rows = result.fetchall()

        if not rows:
            log.info("No EXPENSE/OTHER transactions with a merchant found — nothing to do.")
            return

        log.info(f"Found {len(rows)} transactions to reclassify for user_id={user_id}")

        rule_repo = CategoryRuleRepository(db, user_id)
        rules = list(await rule_repo.list_all())
        log.info(f"Loaded {len(rules)} user-defined override rules")

        updated = 0
        for i in range(0, len(rows), BATCH):
            batch = rows[i : i + BATCH]
            classify_items = [
                {"id": str(r.id), "merchant": r.merchant or "", "description": r.description or ""}
                for r in batch
            ]
            log.info(f"Classifying batch {i // BATCH + 1} ({len(batch)} transactions)...")
            classification = await classify_transactions_batch(classify_items, rules)

            for r in batch:
                cat = classification.get(str(r.id), "other")
                db_val = CATEGORY_TO_DB.get(cat)
                if db_val and cat not in ("other", "expense"):
                    await db.execute(
                        text("UPDATE transactions SET category = CAST(:cat AS transactioncategory) WHERE id = :id"),
                        {"cat": db_val, "id": r.id},
                    )
                    log.info(f"  txn {r.id} [{r.merchant}]: EXPENSE → {db_val}")
                    updated += 1

        await db.commit()
        log.info(f"Done. Updated {updated}/{len(rows)} transactions.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Re-classify expense/other transactions with Gemini")
    parser.add_argument("--user-id", type=int, default=1, help="User ID to reclassify (default: 1)")
    args = parser.parse_args()

    async def _run():
        await run_schema_migrations()
        await reclassify(args.user_id)

    asyncio.run(_run())


if __name__ == "__main__":
    main()

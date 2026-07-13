"""
scripts/rename_accounts.py

One-time migration: rename existing bank accounts to smart display names
using the format "[短銀行名] [帳戶類型] [幣別]".

Run from project root:
    conda run -n dev python scripts/rename_accounts.py
"""
import asyncio
import os
import sys
from dotenv import load_dotenv

load_dotenv()
sys.path.insert(0, ".")

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from src.dbs.models import Account, AccountSnapshot, AccountType


# ── Same mapping as statement.py ─────────────────────────────────────────────
_BANK_SHORT: dict[str, str] = {
    "台新": "台新", "taishin": "台新", "richart": "台新",
    "玉山": "玉山", "esun": "玉山",
    "永豐": "永豐", "sinopac": "永豐",
    "國泰世華": "國泰", "國泰": "國泰", "cathay": "國泰",
    "中信": "中信", "中國信託": "中信", "ctbc": "中信",
    "第一": "第一", "first bank": "第一",
    "富邦": "富邦", "fubon": "富邦",
    "華南": "華南", "huanan": "華南",
    "星展": "星展", "dbs": "星展",
    "聯邦": "聯邦", "union": "聯邦",
    "將來": "將來",
    "連線": "LINE Bank", "line bank": "LINE Bank",
    "firstrade": "Firstrade",
}


def _short(institution: str) -> str:
    inst_lower = institution.lower()
    for key, val in _BANK_SHORT.items():
        if key.lower() in inst_lower or key in institution:
            return val
    return institution


def _smart_name(account: Account, currency: str) -> str:
    short = _short(account.institution or account.name or "")
    is_foreign = currency and currency != "TWD"

    if short == "Firstrade":
        return f"Firstrade ({currency})" if is_foreign else "Firstrade"

    if is_foreign:
        return f"{short} 外幣 {currency}"

    # For TWD accounts — try to detect Richart mother account from account code
    # Richart mother accounts have institution "台新" and code starting with 288810
    code = account.code or ""
    if short == "台新" and code.startswith("288810"):
        return f"{short} Richart 台幣"

    return f"{short} 台幣活存"


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
        res = await db.execute(
            select(Account).where(Account.account_type == AccountType.BANK)
        )
        accounts = res.scalars().all()

        if not accounts:
            print("No bank accounts found.")
            await engine.dispose()
            return

        print(f"Found {len(accounts)} bank account(s) to evaluate.\n")
        updated = 0

        for acc in accounts:
            # Get currency from the account itself (most reliable source)
            currency = acc.currency or "TWD"

            new_name = _smart_name(acc, currency)

            if new_name == acc.name:
                print(f"  -- [{acc.code}] {acc.name!r}  (no change)")
                continue

            print(f"  -> [{acc.code}] {acc.name!r}  =>  {new_name!r}")
            acc.name = new_name
            db.add(acc)
            updated += 1

        await db.commit()
        print(f"\nDone. Renamed {updated} account(s).")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())

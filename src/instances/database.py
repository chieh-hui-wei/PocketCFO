"""
src/instances/database.py
SQLAlchemy async engine & session factory singleton.
"""
from __future__ import annotations

from typing import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from src.instances.config import get_settings

settings = get_settings()

connect_args = {}
if "postgresql" in settings.database_url:
    # Enforce SSL and set search_path to public schema for PostgreSQL
    connect_args["ssl"] = "require"
    connect_args["server_settings"] = {"search_path": "public"}

engine_args = {
    "echo": settings.app_debug,
    "connect_args": connect_args,
}
if "postgresql" in settings.database_url:
    engine_args["pool_size"] = 2
    engine_args["max_overflow"] = 0
    engine_args["pool_recycle"] = 300
    engine_args["pool_pre_ping"] = True
    engine_args["pool_timeout"] = 15


engine = create_async_engine(
    settings.database_url,
    **engine_args,
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
    autocommit=False,
)


class Base(DeclarativeBase):
    """Shared declarative base for all ORM models."""
    pass


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency: yield a database session."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def run_migrations() -> None:
    """
    Apply incremental schema changes to existing tables.
    Uses ADD COLUMN IF NOT EXISTS so it is safe to run on every startup.
    """
    import logging
    log = logging.getLogger(__name__)

    migrations: list[str] = [
        # 2026-06-26: extend TransactionCategory enum with expense sub-categories
        "ALTER TYPE transactioncategory ADD VALUE IF NOT EXISTS 'food'",
        "ALTER TYPE transactioncategory ADD VALUE IF NOT EXISTS 'transport'",
        "ALTER TYPE transactioncategory ADD VALUE IF NOT EXISTS 'medical'",
        "ALTER TYPE transactioncategory ADD VALUE IF NOT EXISTS 'entertainment'",
        "ALTER TYPE transactioncategory ADD VALUE IF NOT EXISTS 'FOOD'",
        "ALTER TYPE transactioncategory ADD VALUE IF NOT EXISTS 'TRANSPORT'",
        "ALTER TYPE transactioncategory ADD VALUE IF NOT EXISTS 'MEDICAL'",
        "ALTER TYPE transactioncategory ADD VALUE IF NOT EXISTS 'ENTERTAINMENT'",
        # 2026-06-26: drop orphaned expense_category column (superseded by category enum)
        "ALTER TABLE transactions DROP COLUMN IF EXISTS expense_category",
        # 2026-06-26: per-user keyword → category override rules
        """
        CREATE TABLE IF NOT EXISTS category_rules (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id),
            keyword VARCHAR(128) NOT NULL,
            category VARCHAR(32) NOT NULL,
            created_at TIMESTAMP DEFAULT now(),
            UNIQUE (user_id, keyword)
        )
        """,
        # 2026-07-07: migrate old prefix-style account codes (bank_inst_num / broker_inst_num)
        # to digits-only codes. Uses a DO block so it is idempotent.
        """
        DO $$
        DECLARE
            r RECORD;
            new_code TEXT;
        BEGIN
            FOR r IN SELECT id, code FROM accounts
                WHERE code LIKE 'bank\\_%' OR code LIKE 'broker\\_%' OR code LIKE 'cc\\_%'
            LOOP
                -- Extract digits from the trailing segment after the last underscore
                new_code := regexp_replace(split_part(r.code, '_', array_length(string_to_array(r.code, '_'), 1)), '[^0-9]', '', 'g');
                IF new_code = '' THEN
                    CONTINUE;
                END IF;
                -- Only update if the digits-only code is not already taken
                IF NOT EXISTS (SELECT 1 FROM accounts WHERE code = new_code AND id <> r.id) THEN
                    UPDATE accounts SET code = new_code WHERE id = r.id;
                END IF;
            END LOOP;
        END $$
        """,
        # 2026-07-07: purge all soft-deleted accounts (is_active=false) and their data
        # Wrapped in a DO block so it is a no-op if the column was already dropped.
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'accounts' AND column_name = 'is_active'
            ) THEN
                -- Cascade delete related rows for inactive accounts
                DELETE FROM securities
                    WHERE account_id IN (SELECT id FROM accounts WHERE is_active = false);
                DELETE FROM account_snapshots
                    WHERE account_id IN (SELECT id FROM accounts WHERE is_active = false);
                DELETE FROM transactions
                    WHERE account_id IN (SELECT id FROM accounts WHERE is_active = false);
                -- Delete the inactive accounts themselves
                DELETE FROM accounts WHERE is_active = false;
            END IF;
        END $$
        """,
        # 2026-07-07: drop is_active from accounts (replaced by hard cascade delete)
        "ALTER TABLE accounts DROP COLUMN IF EXISTS is_active",
    ]

    async with engine.begin() as conn:
        for stmt in migrations:
            try:
                await conn.execute(__import__("sqlalchemy").text(stmt))
                log.info(f"migration.ok: {stmt}")
            except Exception as e:
                log.warning(f"migration.skip: {stmt} — {e}")


async def create_all_tables() -> None:
    """Create all tables on startup, then apply incremental column migrations."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await run_migrations()


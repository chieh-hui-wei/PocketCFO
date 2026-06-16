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
if "sqlite" in settings.database_url:
    connect_args["check_same_thread"] = False
elif "postgresql" in settings.database_url:
    # Enforce SSL and set search_path to public schema for PostgreSQL
    connect_args["ssl"] = "require"
    connect_args["server_settings"] = {"search_path": "public"}

engine_args = {
    "echo": settings.app_debug,
    "connect_args": connect_args,
}
if "postgresql" in settings.database_url:
    engine_args["pool_size"] = 20
    engine_args["max_overflow"] = 10
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


async def create_all_tables() -> None:
    """Create all tables on startup (dev only; use Alembic in prod)."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

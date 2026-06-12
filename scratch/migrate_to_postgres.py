import asyncio
import os
import sqlite3
from datetime import datetime, date
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import select, text

# Add the parent directory to Python path so we can import src modules
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.instances.database import Base
from src.dbs.models import (
    Account,
    AccountSnapshot,
    Security,
    Transaction,
    BalanceSheet,
    IncomeStatement,
    UploadHistory,
    AccountType,
    TransactionCategory,
    TransactionSource
)

SQLITE_DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "pocketCFO.db")

async def migrate(postgres_url: str):
    if postgres_url.startswith("postgres://"):
        # Replace postgres:// with postgresql+asyncpg:// if needed
        postgres_url = postgres_url.replace("postgres://", "postgresql+asyncpg://", 1)
    elif postgres_url.startswith("postgresql://"):
        postgres_url = postgres_url.replace("postgresql://", "postgresql+asyncpg://", 1)
        
    print(f"Connecting to PostgreSQL database...")
    engine = create_async_engine(
        postgres_url, 
        connect_args={
            "server_settings": {"search_path": "public"},
            "ssl": "require"
        },
        echo=False
    )
    
    print("Creating tables on PostgreSQL if they don't exist...")
    async with engine.begin() as conn:
        # Debug schema state
        try:
            path_res = await conn.execute(text("SHOW search_path;"))
            print(f"Initial search_path: {path_res.scalar()}")
        except Exception as e:
            print(f"Could not show search_path: {e}")
            
        # Try to explicitly set search_path
        try:
            await conn.execute(text("CREATE SCHEMA IF NOT EXISTS public;"))
            await conn.execute(text("SET search_path TO public;"))
            print("Set search_path to public.")
        except Exception as e:
            print(f"Could not set search_path: {e}")

        # Show schema state again
        try:
            path_res = await conn.execute(text("SHOW search_path;"))
            print(f"Search_path after setting: {path_res.scalar()}")
            schema_res = await conn.execute(text("SELECT current_schema();"))
            print(f"Current schema: {schema_res.scalar()}")
        except Exception as e:
            print(f"Could not verify schema: {e}")
            
        # Create all tables defined in Base metadata
        await conn.run_sync(Base.metadata.create_all)
    
    print("Connecting to local SQLite database...")
    sqlite_conn = sqlite3.connect(SQLITE_DB_PATH)
    sqlite_conn.row_factory = sqlite3.Row
    sqlite_cursor = sqlite_conn.cursor()
    
    async_session = sessionmaker(
        bind=engine,
        class_=AsyncSession,
        expire_on_commit=False
    )
    
    async with async_session() as session:
        try:
            # 1. Migrate accounts
            print("Migrating 'accounts'...")
            sqlite_cursor.execute("SELECT * FROM accounts")
            accounts = sqlite_cursor.fetchall()
            for row in accounts:
                acc = Account(
                    id=row['id'],
                    code=row['code'],
                    name=row['name'],
                    account_type=AccountType(row['account_type'].lower()),
                    institution=row['institution'],
                    currency=row['currency'],
                    is_internal=bool(row['is_internal']),
                    is_active=bool(row['is_active']),
                    notes=row['notes'],
                    created_at=datetime.strptime(row['created_at'].split('.')[0], "%Y-%m-%d %H:%M:%S") if row['created_at'] else datetime.utcnow()
                )
                session.add(acc)
            await session.flush()
            print(f"Loaded {len(accounts)} accounts.")

            # 2. Migrate upload_histories
            print("Migrating 'upload_histories'...")
            sqlite_cursor.execute("SELECT * FROM upload_histories")
            uploads = sqlite_cursor.fetchall()
            for row in uploads:
                up = UploadHistory(
                    id=row['id'],
                    filename=row['filename'],
                    file_hash=row['file_hash'],
                    kind=row['kind'],
                    status=row['status'],
                    message=row['message'],
                    created_at=datetime.strptime(row['created_at'].split('.')[0], "%Y-%m-%d %H:%M:%S") if row['created_at'] else datetime.utcnow()
                )
                session.add(up)
            await session.flush()
            print(f"Loaded {len(uploads)} upload history items.")

            # 3. Migrate account_snapshots
            print("Migrating 'account_snapshots'...")
            sqlite_cursor.execute("SELECT * FROM account_snapshots")
            snapshots = sqlite_cursor.fetchall()
            for row in snapshots:
                snap = AccountSnapshot(
                    id=row['id'],
                    account_id=row['account_id'],
                    period_date=date.fromisoformat(row['period_date']),
                    balance=row['balance'],
                    original_balance=row['original_balance'],
                    currency=row['currency'],
                    exchange_rate=row['exchange_rate'],
                    source=row['source'],
                    raw_data=row['raw_data'],
                    upload_history_id=row['upload_history_id'],
                    created_at=datetime.strptime(row['created_at'].split('.')[0], "%Y-%m-%d %H:%M:%S") if row['created_at'] else datetime.utcnow()
                )
                session.add(snap)
            await session.flush()
            print(f"Loaded {len(snapshots)} snapshots.")

            # 4. Migrate securities
            print("Migrating 'securities'...")
            sqlite_cursor.execute("SELECT * FROM securities")
            securities = sqlite_cursor.fetchall()
            for row in securities:
                sec = Security(
                    id=row['id'],
                    account_id=row['account_id'],
                    period_date=date.fromisoformat(row['period_date']),
                    ticker=row['ticker'],
                    name=row['name'],
                    quantity=row['quantity'],
                    avg_cost=row['avg_cost'],
                    current_price=row['current_price'],
                    market_value=row['market_value'],
                    unrealized_pnl=row['unrealized_pnl'],
                    original_avg_cost=row['original_avg_cost'],
                    original_current_price=row['original_current_price'],
                    original_market_value=row['original_market_value'],
                    original_unrealized_pnl=row['original_unrealized_pnl'],
                    currency=row['currency'],
                    exchange_rate=row['exchange_rate'],
                    created_at=datetime.strptime(row['created_at'].split('.')[0], "%Y-%m-%d %H:%M:%S") if row['created_at'] else datetime.utcnow()
                )
                session.add(sec)
            await session.flush()
            print(f"Loaded {len(securities)} securities.")

            # 5. Migrate transactions
            print("Migrating 'transactions'...")
            sqlite_cursor.execute("SELECT * FROM transactions")
            transactions = sqlite_cursor.fetchall()
            for row in transactions:
                txn = Transaction(
                    id=row['id'],
                    account_id=row['account_id'],
                    txn_date=date.fromisoformat(row['txn_date']),
                    source=TransactionSource(row['source'].lower()),
                    merchant=row['merchant'],
                    description=row['description'],
                    amount=row['amount'],
                    category=TransactionCategory(row['category'].lower()),
                    is_internal_transfer=bool(row['is_internal_transfer']),
                    is_refund=bool(row['is_refund']),
                    is_duplicate=bool(row['is_duplicate']),
                    raw_data=row['raw_data'],
                    upload_history_id=row['upload_history_id'],
                    created_at=datetime.strptime(row['created_at'].split('.')[0], "%Y-%m-%d %H:%M:%S") if row['created_at'] else datetime.utcnow()
                )
                session.add(txn)
            await session.flush()
            print(f"Loaded {len(transactions)} transactions.")

            # 6. Migrate balance_sheets
            print("Migrating 'balance_sheets'...")
            sqlite_cursor.execute("SELECT * FROM balance_sheets")
            bs_sheets = sqlite_cursor.fetchall()
            for row in bs_sheets:
                bs = BalanceSheet(
                    id=row['id'],
                    period_date=date.fromisoformat(row['period_date']),
                    total_cash=row['total_cash'],
                    total_securities_market_value=row['total_securities_market_value'],
                    total_assets=row['total_assets'],
                    total_credit_card_payable=row['total_credit_card_payable'],
                    total_liabilities=row['total_liabilities'],
                    net_worth=row['net_worth'],
                    detail_json=row['detail_json'],
                    computed_at=datetime.strptime(row['computed_at'].split('.')[0], "%Y-%m-%d %H:%M:%S") if row['computed_at'] else datetime.utcnow()
                )
                session.add(bs)
            await session.flush()
            print(f"Loaded {len(bs_sheets)} balance sheets.")

            # 7. Migrate income_statements
            print("Migrating 'income_statements'...")
            sqlite_cursor.execute("SELECT * FROM income_statements")
            inc_statements = sqlite_cursor.fetchall()
            for row in inc_statements:
                is_stmt = IncomeStatement(
                    id=row['id'],
                    period_date=date.fromisoformat(row['period_date']),
                    total_income=row['total_income'],
                    salary_income=row['salary_income'],
                    investment_income=row['investment_income'],
                    other_income=row['other_income'],
                    total_expenses=row['total_expenses'],
                    credit_card_expenses=row['credit_card_expenses'],
                    bank_expenses=row['bank_expenses'],
                    net_savings=row['net_savings'],
                    detail_json=row['detail_json'],
                    computed_at=datetime.strptime(row['computed_at'].split('.')[0], "%Y-%m-%d %H:%M:%S") if row['computed_at'] else datetime.utcnow()
                )
                session.add(is_stmt)
            await session.flush()
            print(f"Loaded {len(inc_statements)} income statements.")

            await session.commit()
            print("\n🎉 Migration completed successfully! All data has been copied to PostgreSQL.")

            # Reset serial sequences on Postgres
            for table in ['accounts', 'upload_histories', 'account_snapshots', 'securities', 'transactions', 'balance_sheets', 'income_statements']:
                try:
                    await session.execute(text(f"SELECT setval(pg_get_serial_sequence('{table}', 'id'), COALESCE(MAX(id), 1)) FROM {table}"))
                except Exception as seq_err:
                    pass
            await session.commit()

        except Exception as e:
            print(f"\n❌ Migration failed: {e}")
            await session.rollback()
            raise e
        finally:
            sqlite_conn.close()
            await engine.dispose()

if __name__ == "__main__":
    url = input("Please enter your PostgreSQL connection URL (e.g. postgresql://user:password@host:port/dbname): ").strip()
    if not url:
        print("Error: PostgreSQL connection URL cannot be empty.")
        sys.exit(1)
        
    asyncio.run(migrate(url))

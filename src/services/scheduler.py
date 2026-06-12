import asyncio
from datetime import datetime, date, timedelta
import logging
import calendar
import json

from sqlalchemy import select
from src.instances.database import AsyncSessionLocal
from src.dbs.models import Account, AccountType, Transaction, TransactionSource, TransactionCategory, AccountSnapshot, Security
from src.dbs.repository import AccountRepository, TransactionRepository, SnapshotRepository, SecurityRepository
from src.services.brokers.taishin_client import get_taishin_client
from src.services.brokers.esun_client import get_esun_client
from src.services.reports.balance_sheet import BalanceSheetService
from src.utils.date_utils import first_of_month

log = logging.getLogger(__name__)

# Keep track of last run periods in memory to avoid duplicate executions
last_trade_sync_month = None  # (year, month)
last_asset_sync_day = None    # date

async def sync_taishin_trades(year: int, month: int) -> None:
    """
    Sync stock transactions for a specific month from Taishin API.
    """
    log.info(f"sync.taishin.trades.start period={year}-{month:02d}")
    period = first_of_month(year, month)
    
    # Calculate start and end dates in YYYYMMDD format
    start_date = f"{year}{month:02d}01"
    last_day = calendar.monthrange(year, month)[1]
    end_date = f"{year}{month:02d}{last_day:02d}"
    
    async with AsyncSessionLocal() as db:
        # Get or create Taishin brokerage account
        account_repo = AccountRepository(db)
        account = await db.execute(
            select(Account).where(Account.code == "broker_taishin")
        )
        account = account.scalar_one_or_none()
        if not account:
            account = Account(
                code="broker_taishin",
                name="台新證券",
                account_type=AccountType.BROKERAGE,
                institution="台新",
                currency="TWD"
            )
            db.add(account)
            await db.flush()
            log.info(f"Created Taishin brokerage account in scheduler (ID: {account.id})")
            
        account_id = account.id
        
        try:
            taishin = get_taishin_client()
            history = await taishin.get_filled_history(start_date, end_date)
            log.info(f"Fetched {len(history)} filled history records from Taishin API for auto-sync.")
            
            added_count = 0
            for row in history:
                try:
                    txn_date = datetime.strptime(row.filled_date, "%Y%m%d").date()
                except ValueError:
                    txn_date = datetime.now().date()
                    
                buy_sell_str = str(row.buy_sell)
                if "Buy" in buy_sell_str:
                    amount = -float(row.payment)
                    action_str = "買進"
                else:
                    amount = float(row.payment)
                    action_str = "賣出"
                    
                description = f"[{action_str}] {row.symbol} {row.filled_qty}股 @ {row.filled_price}"
                
                # Check for duplicates
                stmt = select(Transaction).where(
                    Transaction.account_id == account_id,
                    Transaction.txn_date == txn_date,
                    Transaction.amount == amount,
                    Transaction.description == description,
                    Transaction.source == TransactionSource.BROKERAGE
                )
                existing = await db.execute(stmt)
                if existing.scalars().first():
                    continue
                    
                txn = Transaction(
                    account_id=account_id,
                    txn_date=txn_date,
                    source=TransactionSource.BROKERAGE,
                    merchant="台新證券",
                    description=description,
                    amount=amount,
                    category=TransactionCategory.INVESTMENT,
                    raw_data=str(vars(row)) if hasattr(row, '__dict__') else str(row)
                )
                db.add(txn)
                added_count += 1
                
            if added_count > 0:
                await db.commit()
                log.info(f"Auto-sync completed. Added {added_count} transactions to Taishin account.")
            else:
                log.info("No new transactions found for Taishin account.")
        except Exception as e:
            log.error(f"Failed to auto-sync Taishin trades: {e}")

async def sync_esun_trades(year: int, month: int) -> None:
    """
    Sync stock transactions for a specific month from E-Sun API.
    """
    log.info(f"sync.esun.trades.start period={year}-{month:02d}")
    period = first_of_month(year, month)
    
    # Calculate start and end dates in YYYY-MM-DD format
    start_date = f"{year}-{month:02d}-01"
    last_day = calendar.monthrange(year, month)[1]
    end_date = f"{year}-{month:02d}-{last_day:02d}"
    
    async with AsyncSessionLocal() as db:
        # Get or create E-Sun brokerage account
        account = await db.execute(
            select(Account).where(Account.code == "broker_esun")
        )
        account = account.scalar_one_or_none()
        if not account:
            account = Account(
                code="broker_esun",
                name="玉山證券",
                account_type=AccountType.BROKERAGE,
                institution="玉山證券",
                currency="TWD"
            )
            db.add(account)
            await db.flush()
            log.info(f"Created E-Sun brokerage account in scheduler (ID: {account.id})")
            
        account_id = account.id
        
        try:
            esun = get_esun_client()
            history = await esun.get_filled_history(start_date, end_date)
            log.info(f"Fetched {len(history)} filled history records from E-Sun API for auto-sync.")
            
            added_count = 0
            for summary in history:
                mat_dats = summary.get("mat_dats") or []
                for row in mat_dats:
                    # E-Sun t_date is typically in YYYYMMDD
                    t_date_str = row.get("t_date")
                    try:
                        txn_date = datetime.strptime(t_date_str, "%Y%m%d").date()
                    except (ValueError, TypeError):
                        txn_date = datetime.now().date()
                        
                    buy_sell_str = row.get("buy_sell")
                    stk_no = row.get("stk_no") or ""
                    qty = float(row.get("qty") or 0.0)
                    price = float(row.get("price") or 0.0)
                    amount = float(row.get("pay_n") or 0.0)
                    
                    if buy_sell_str == "B":
                        if amount > 0:
                            amount = -amount
                        action_str = "買進"
                    else:
                        if amount < 0:
                            amount = -amount
                        action_str = "賣出"
                        
                    description = f"[{action_str}] {stk_no} {qty}股 @ {price}"
                    
                    # Check for duplicates
                    stmt = select(Transaction).where(
                        Transaction.account_id == account_id,
                        Transaction.txn_date == txn_date,
                        Transaction.amount == amount,
                        Transaction.description == description,
                        Transaction.source == TransactionSource.BROKERAGE
                    )
                    existing = await db.execute(stmt)
                    if existing.scalars().first():
                        continue
                        
                    txn = Transaction(
                        account_id=account_id,
                        txn_date=txn_date,
                        source=TransactionSource.BROKERAGE,
                        merchant="玉山證券",
                        description=description,
                        amount=amount,
                        category=TransactionCategory.INVESTMENT,
                        raw_data=json.dumps(row, ensure_ascii=False)
                    )
                    db.add(txn)
                    added_count += 1
                
            if added_count > 0:
                await db.commit()
                log.info(f"Auto-sync completed. Added {added_count} transactions to E-Sun account.")
            else:
                log.info("No new transactions found for E-Sun account.")
        except Exception as e:
            log.error(f"Failed to auto-sync E-Sun trades: {e}")

async def sync_taishin_assets(year: int, month: int) -> None:
    """
    Sync Taishin stock holdings and cash balance, update snapshots, and recalculate balance sheet.
    """
    log.info(f"sync.taishin.assets.start period={year}-{month:02d}")
    period = first_of_month(year, month)
    
    async with AsyncSessionLocal() as db:
        # Get or create Taishin brokerage account
        account = await db.execute(
            select(Account).where(Account.code == "broker_taishin")
        )
        account = account.scalar_one_or_none()
        if not account:
            account = Account(
                code="broker_taishin",
                name="台新證券",
                account_type=AccountType.BROKERAGE,
                institution="台新",
                currency="TWD"
            )
            db.add(account)
            await db.flush()
            log.info(f"Created Taishin brokerage account in scheduler (ID: {account.id})")
            
        account_id = account.id
        
        try:
            taishin = get_taishin_client()
            balance = await taishin.get_account_balance()
            positions = await taishin.get_positions()
            
            # Save snapshots
            total_mv = sum(float(p.get("market_value") or 0.0) for p in positions)
            total_balance = float(balance.get("cash_balance") or 0.0) + total_mv
            
            snapshot = AccountSnapshot(
                account_id=account_id,
                period_date=period,
                balance=total_balance,
                source="api",
                raw_data=json.dumps({"cash_balance": balance["cash_balance"], "positions": positions}, ensure_ascii=False)
            )
            snap_repo = SnapshotRepository(db)
            await snap_repo.upsert(snapshot)
            log.info(f"Upserted account snapshot for Taishin brokerage: balance={total_balance}")
            
            # Save holdings
            securities = []
            for p in positions:
                qty = float(p.get("quantity") or 0)
                cost = float(p.get("cost") or 0)
                securities.append(
                    Security(
                        account_id=account_id,
                        period_date=period,
                        ticker=p["ticker"],
                        name=p.get("name") or p["ticker"],
                        quantity=qty,
                        avg_cost=cost / qty if cost > 0 and qty > 0 else 0.0,
                        current_price=float(p.get("current_price") or 0.0),
                        market_value=float(p.get("market_value") or 0.0),
                        unrealized_pnl=float(p.get("unrealized_pnl") or 0.0)
                    )
                )
                
            if securities:
                sec_repo = SecurityRepository(db)
                await sec_repo.upsert_many(securities)
                log.info(f"Upserted {len(securities)} stock positions for Taishin brokerage.")
                
            # Recompute balance sheet for the month
            bs_service = BalanceSheetService(db)
            await bs_service.compute(year, month)
            
            await db.commit()
            log.info(f"sync.taishin.assets.success period={year}-{month:02d}")
        except Exception as e:
            log.error(f"Failed to auto-sync Taishin assets: {e}")

async def sync_esun_assets(year: int, month: int) -> None:
    """
    Sync E-Sun stock holdings and cash balance, update snapshots, and recalculate balance sheet.
    """
    log.info(f"sync.esun.assets.start period={year}-{month:02d}")
    period = first_of_month(year, month)
    
    async with AsyncSessionLocal() as db:
        # Get or create E-Sun brokerage account
        account = await db.execute(
            select(Account).where(Account.code == "broker_esun")
        )
        account = account.scalar_one_or_none()
        if not account:
            account = Account(
                code="broker_esun",
                name="玉山證券",
                account_type=AccountType.BROKERAGE,
                institution="玉山證券",
                currency="TWD"
            )
            db.add(account)
            await db.flush()
            log.info(f"Created E-Sun brokerage account in scheduler (ID: {account.id})")
            
        account_id = account.id
        
        try:
            esun = get_esun_client()
            balance = await esun.get_account_balance()
            positions = await esun.get_positions()
            
            # Save snapshots
            total_mv = sum(float(p.get("market_value") or 0.0) for p in positions)
            total_balance = float(balance.get("cash_balance") or 0.0) + total_mv
            
            snapshot = AccountSnapshot(
                account_id=account_id,
                period_date=period,
                balance=total_balance,
                source="api",
                raw_data=json.dumps({"cash_balance": balance["cash_balance"], "positions": positions}, ensure_ascii=False)
            )
            snap_repo = SnapshotRepository(db)
            await snap_repo.upsert(snapshot)
            log.info(f"Upserted account snapshot for E-Sun brokerage: balance={total_balance}")
            
            # Save holdings
            grouped = {}
            for p in positions:
                ticker = p["ticker"]
                qty = float(p.get("quantity") or 0.0)
                cost = float(p.get("cost") or 0.0)
                mv = float(p.get("market_value") or 0.0)
                pnl = float(p.get("unrealized_pnl") or 0.0)
                current_price = float(p.get("current_price") or 0.0)
                name = p.get("name") or ticker
                
                if ticker not in grouped:
                    grouped[ticker] = {
                        "name": name,
                        "quantity": qty,
                        "cost": cost,
                        "market_value": mv,
                        "unrealized_pnl": pnl,
                        "current_price": current_price
                    }
                else:
                    grouped[ticker]["quantity"] += qty
                    grouped[ticker]["cost"] += cost
                    grouped[ticker]["market_value"] += mv
                    grouped[ticker]["unrealized_pnl"] += pnl
                    if current_price > 0:
                        grouped[ticker]["current_price"] = current_price

            securities = []
            for ticker, data in grouped.items():
                qty = data["quantity"]
                securities.append(
                    Security(
                        account_id=account_id,
                        period_date=period,
                        ticker=ticker,
                        name=data["name"],
                        quantity=qty,
                        avg_cost=data["cost"] / qty if qty > 0 else 0.0,
                        current_price=data["current_price"],
                        market_value=data["market_value"],
                        unrealized_pnl=data["unrealized_pnl"]
                    )
                )
                
            if securities:
                sec_repo = SecurityRepository(db)
                await sec_repo.upsert_many(securities)
                log.info(f"Upserted {len(securities)} stock positions for E-Sun brokerage.")
                
            # Recompute balance sheet for the month
            bs_service = BalanceSheetService(db)
            await bs_service.compute(year, month)
            
            await db.commit()
            log.info(f"sync.esun.assets.success period={year}-{month:02d}")
        except Exception as e:
            log.error(f"Failed to auto-sync E-Sun assets: {e}")

async def check_and_run_tasks(now: datetime) -> None:
    """
    Check if current time matches scheduled sync times and run them.
    """
    global last_trade_sync_month, last_asset_sync_day
    
    # 1. Trade sync: Run on the 1st day of the month
    # Checks if day is 1, and we haven't synced previous month's trades yet for this month
    if now.day == 1:
        current_month = (now.year, now.month)
        if last_trade_sync_month != current_month:
            # Determine previous month
            first_this_month = now.replace(day=1)
            last_day_prev_month = first_this_month - timedelta(days=1)
            prev_year = last_day_prev_month.year
            prev_month = last_day_prev_month.month
            
            # Sync trades in background tasks so they don't block the main loop
            asyncio.create_task(sync_taishin_trades(prev_year, prev_month))
            asyncio.create_task(sync_esun_trades(prev_year, prev_month))
            last_trade_sync_month = current_month
            
    # 2. Asset value sync: Run on the last day of the month (e.g. at 23:30 or later)
    # Checks if it's the last day, hour is >= 23, and we haven't run it today yet
    last_day_of_month = calendar.monthrange(now.year, now.month)[1]
    if now.day == last_day_of_month and now.hour >= 23:
        current_day = now.date()
        if last_asset_sync_day != current_day:
            asyncio.create_task(sync_taishin_assets(now.year, now.month))
            asyncio.create_task(sync_esun_assets(now.year, now.month))
            last_asset_sync_day = current_day

async def start_scheduler() -> None:
    """
    Background loop running hourly to verify scheduled tasks.
    """
    log.info("Background scheduler starting...")
    # Wait 10 seconds for Fast API initialization to settle
    await asyncio.sleep(10)
    
    log.info("Background scheduler initialized.")
    while True:
        try:
            now = datetime.now()
            await check_and_run_tasks(now)
        except Exception as e:
            log.error(f"Exception in scheduler tick: {e}")
        # Sleep for 1 hour
        await asyncio.sleep(3600)

import asyncio
from datetime import datetime, date, timedelta
import logging
import calendar
import json
import re

def _is_duplicate_transaction(raw_data: str, ord_no: str, seq: str) -> bool:
    if not raw_data or not ord_no:
        return False
    # Matches "ord_no": "value" or 'ord_no': 'value' or 'ord_no': value
    ord_pattern = rf"['\"]ord_no['\"]\s*:\s*['\"]?{re.escape(str(ord_no))}['\"]?"
    if not re.search(ord_pattern, raw_data):
        return False
    if seq:
        seq_pattern = rf"['\"](mat_seq|match_seq|match_no|ord_seq|t_time)['\"]\s*:\s*['\"]?{re.escape(str(seq))}['\"]?"
        if not re.search(seq_pattern, raw_data):
            return False
    return True


from sqlalchemy import select, delete
from src.instances.database import AsyncSessionLocal
from src.dbs.models import Account, AccountType, Transaction, TransactionSource, TransactionCategory, AccountSnapshot, Security, User
from src.dbs.repository import AccountRepository, TransactionRepository, SnapshotRepository, SecurityRepository
from src.services.brokers.taishin_client import get_taishin_client
from src.services.brokers.esun_client import get_esun_client
from src.services.reports.balance_sheet import BalanceSheetService
from src.utils.date_utils import first_of_month
from pathlib import Path

log = logging.getLogger(__name__)

STATE_FILE = Path("data/scheduler_state.json")

def load_scheduler_state() -> dict:
    try:
        if STATE_FILE.exists():
            with open(STATE_FILE, "r") as f:
                return json.load(f)
    except Exception as e:
        log.warning(f"Failed to load scheduler state: {e}")
    return {}

def save_scheduler_state(state: dict) -> None:
    try:
        STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(STATE_FILE, "w") as f:
            json.dump(state, f, indent=2)
    except Exception as e:
        log.error(f"Failed to save scheduler state: {e}")

def get_last_trade_sync_month() -> tuple[int, int] | None:
    state = load_scheduler_state()
    val = state.get("last_trade_sync_month")  # format: "YYYY-MM"
    if val:
        try:
            parts = val.split("-")
            return (int(parts[0]), int(parts[1]))
        except Exception:
            pass
    return None

def set_last_trade_sync_month(year: int, month: int) -> None:
    state = load_scheduler_state()
    state["last_trade_sync_month"] = f"{year}-{month:02d}"
    save_scheduler_state(state)

def get_last_asset_sync_day() -> date | None:
    state = load_scheduler_state()
    val = state.get("last_asset_sync_day")  # format: "YYYY-MM-DD"
    if val:
        try:
            return date.fromisoformat(val)
        except Exception:
            pass
    return None

def set_last_asset_sync_day(d: date) -> None:
    state = load_scheduler_state()
    state["last_asset_sync_day"] = d.isoformat()
    save_scheduler_state(state)

def update_sync_status(broker: str, status: str, error_msg: str | None = None) -> None:
    from datetime import datetime
    from zoneinfo import ZoneInfo
    state = load_scheduler_state()
    if "sync_history" not in state:
        state["sync_history"] = {}
    
    taipei_now = datetime.now(ZoneInfo("Asia/Taipei"))
    state["sync_history"][broker] = {
        "status": status,
        "time": taipei_now.strftime("%Y-%m-%d %H:%M:%S"),
        "error": error_msg
    }
    save_scheduler_state(state)

async def sync_taishin_trades(year: int, month: int, user_id: int = 1) -> None:
    """
    Sync stock transactions for a specific month from Taishin API.
    """
    log.info(f"sync.taishin.trades.start period={year}-{month:02d}")
    period = first_of_month(year, month)
    
    from zoneinfo import ZoneInfo
    today_dt = datetime.now(ZoneInfo("Asia/Taipei")).date()
    start_dt = today_dt - timedelta(days=180)
    
    start_date = start_dt.strftime("%Y%m%d")
    end_date = today_dt.strftime("%Y%m%d")
    log.info(f"sync.taishin.trades.start range={start_date} to {end_date}")
    
    async with AsyncSessionLocal() as db:
        # Get or create Taishin brokerage account
        account_repo = AccountRepository(db, user_id)
        account = await db.execute(
            select(Account).where(Account.code == "broker_taishin", Account.user_id == user_id)
        )
        account = account.scalar_one_or_none()
        if not account:
            account = Account(
                user_id=user_id,
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
            
            # Fetch existing transactions for this account in the last 180 days to check in memory
            stmt = select(Transaction).where(
                Transaction.user_id == user_id,
                Transaction.account_id == account_id,
                Transaction.source == TransactionSource.BROKERAGE,
                Transaction.txn_date >= start_dt
            )
            res = await db.execute(stmt)
            existing_txns = res.scalars().all()
            
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
                
                # Check for duplicates in memory
                ord_no = getattr(row, "ord_no", "")
                mat_seq = getattr(row, "mat_seq", getattr(row, "match_seq", ""))
                
                is_dup = False
                for txn in existing_txns:
                    if ord_no and _is_duplicate_transaction(txn.raw_data, ord_no, mat_seq):
                        is_dup = True
                        break
                    if (txn.txn_date == txn_date and 
                        abs(txn.amount - amount) < 0.01 and 
                        txn.description == description):
                        is_dup = True
                        break
                
                if is_dup:
                    continue
                    
                txn = Transaction(
                    user_id=user_id,
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
            update_sync_status("taishin_trades", "success")
        except Exception as e:
            log.error(f"Failed to auto-sync Taishin trades: {e}")
            update_sync_status("taishin_trades", "failed", str(e))

async def sync_esun_trades(year: int, month: int, user_id: int = 1) -> None:
    """
    Sync stock transactions for a specific month from E-Sun API.
    """
    log.info(f"sync.esun.trades.start period={year}-{month:02d}")
    period = first_of_month(year, month)
    
    from zoneinfo import ZoneInfo
    today_dt = datetime.now(ZoneInfo("Asia/Taipei")).date()
    start_dt = today_dt - timedelta(days=180)
    
    start_date = start_dt.strftime("%Y-%m-%d")
    end_date = today_dt.strftime("%Y-%m-%d")
    log.info(f"sync.esun.trades.start range={start_date} to {end_date}")
    
    async with AsyncSessionLocal() as db:
        # Get or create E-Sun brokerage account
        account = await db.execute(
            select(Account).where(Account.code == "broker_esun", Account.user_id == user_id)
        )
        account = account.scalar_one_or_none()
        if not account:
            account = Account(
                user_id=user_id,
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
            
            # Fetch existing transactions for this account in the last 180 days to check in memory
            stmt = select(Transaction).where(
                Transaction.user_id == user_id,
                Transaction.account_id == account_id,
                Transaction.source == TransactionSource.BROKERAGE,
                Transaction.txn_date >= start_dt
            )
            res = await db.execute(stmt)
            existing_txns = res.scalars().all()
            
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
                    
                    # Check for duplicates in memory
                    ord_no = row.get("ord_no", "")
                    ord_seq = row.get("ord_seq", row.get("match_no", row.get("t_time", "")))
                    
                    is_dup = False
                    for txn in existing_txns:
                        if ord_no and _is_duplicate_transaction(txn.raw_data, ord_no, ord_seq):
                            is_dup = True
                            break
                        if (txn.txn_date == txn_date and 
                            abs(txn.amount - amount) < 0.01 and 
                            txn.description == description):
                            is_dup = True
                            break
                    
                    if is_dup:
                        continue
                        
                    txn = Transaction(
                        user_id=user_id,
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
            update_sync_status("esun_trades", "success")
        except Exception as e:
            log.error(f"Failed to auto-sync E-Sun trades: {e}")
            update_sync_status("esun_trades", "failed", str(e))

async def sync_taishin_assets(year: int, month: int, user_id: int = 1, target_date: date | None = None) -> None:
    """
    Sync Taishin stock holdings and cash balance, update snapshots, and recalculate balance sheet.
    """
    log.info(f"sync.taishin.assets.start period={year}-{month:02d}")
    period = target_date if target_date else date(year, month, calendar.monthrange(year, month)[1])
    
    # Sync trades first to keep transactions list up-to-date
    try:
        await sync_taishin_trades(year, month, user_id)
    except Exception as e:
        log.error(f"Failed to sync Taishin trades prior to assets: {e}")
    
    async with AsyncSessionLocal() as db:
        # Get or create Taishin brokerage account
        account = await db.execute(
            select(Account).where(Account.code == "broker_taishin", Account.user_id == user_id)
        )
        account = account.scalar_one_or_none()
        if not account:
            account = Account(
                user_id=user_id,
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
                user_id=user_id,
                account_id=account_id,
                period_date=period,
                balance=total_balance,
                source="api",
                raw_data=json.dumps({"cash_balance": balance["cash_balance"], "positions": positions}, ensure_ascii=False)
            )
            snap_repo = SnapshotRepository(db, user_id)
            await snap_repo.upsert(snapshot)
            log.info(f"Upserted account snapshot for Taishin brokerage: balance={total_balance}")
            
            # Save holdings
            securities = []
            for p in positions:
                qty = float(p.get("quantity") or 0)
                cost = float(p.get("cost") or 0)
                securities.append(
                    Security(
                        user_id=user_id,
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
                
            # Delete old securities for this account and day first to prevent sold/stale positions from persisting
            await db.execute(
                delete(Security).where(
                    Security.user_id == user_id,
                    Security.account_id == account_id,
                    Security.period_date == period
                )
            )

            if securities:
                sec_repo = SecurityRepository(db, user_id)
                await sec_repo.upsert_many(securities)
                log.info(f"Upserted {len(securities)} stock positions for Taishin brokerage.")
                
            # Recompute balance sheet for the month
            bs_service = BalanceSheetService(db, user_id)
            await bs_service.compute(year, month)
            
            await db.commit()
            log.info(f"sync.taishin.assets.success period={year}-{month:02d}")
            update_sync_status("taishin_assets", "success")
        except Exception as e:
            log.error(f"Failed to auto-sync Taishin assets: {e}")
            update_sync_status("taishin_assets", "failed", str(e))

async def sync_esun_assets(year: int, month: int, user_id: int = 1, target_date: date | None = None) -> None:
    """
    Sync E-Sun stock holdings and cash balance, update snapshots, and recalculate balance sheet.
    """
    log.info(f"sync.esun.assets.start period={year}-{month:02d}")
    period = target_date if target_date else date(year, month, calendar.monthrange(year, month)[1])
    
    # Sync trades first to keep transactions list up-to-date
    try:
        await sync_esun_trades(year, month, user_id)
    except Exception as e:
        log.error(f"Failed to sync E-Sun trades prior to assets: {e}")
    
    async with AsyncSessionLocal() as db:
        # Get or create E-Sun brokerage account
        account = await db.execute(
            select(Account).where(Account.code == "broker_esun", Account.user_id == user_id)
        )
        account = account.scalar_one_or_none()
        if not account:
            account = Account(
                user_id=user_id,
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
                user_id=user_id,
                account_id=account_id,
                period_date=period,
                balance=total_balance,
                source="api",
                raw_data=json.dumps({"cash_balance": balance["cash_balance"], "positions": positions}, ensure_ascii=False)
            )
            snap_repo = SnapshotRepository(db, user_id)
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
                        user_id=user_id,
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
                
            # Delete old securities for this account and day first to prevent sold/stale positions from persisting
            await db.execute(
                delete(Security).where(
                    Security.user_id == user_id,
                    Security.account_id == account_id,
                    Security.period_date == period
                )
            )

            if securities:
                sec_repo = SecurityRepository(db, user_id)
                await sec_repo.upsert_many(securities)
                log.info(f"Upserted {len(securities)} stock positions for E-Sun brokerage.")
                
            # Recompute balance sheet for the month
            bs_service = BalanceSheetService(db, user_id)
            await bs_service.compute(year, month)
            
            await db.commit()
            log.info(f"sync.esun.assets.success period={year}-{month:02d}")
            update_sync_status("esun_assets", "success")
        except Exception as e:
            log.error(f"Failed to auto-sync E-Sun assets: {e}")
            update_sync_status("esun_assets", "failed", str(e))

async def check_and_send_rebalance_alerts(users: list) -> None:
    """
    Automated check for portfolio distortion triggers (Rise / Fall) on active users.
    Sends email alert if enable_email_alert is True and alert hasn't been sent today.
    """
    from src.services.rebalance.service import RebalanceService
    from datetime import datetime, timezone

    for u in users:
        try:
            async with AsyncSessionLocal() as db:
                service = RebalanceService(db, u.id)
                strategy = await service.get_or_create_strategy()

                if not strategy.enable_email_alert:
                    continue

                analysis = await service.analyze_rebalance()
                if analysis.get("is_triggered"):
                    # Avoid sending multiple emails on the same day
                    if strategy.last_alert_sent_at:
                        last_sent_date = strategy.last_alert_sent_at.date()
                        if last_sent_date == date.today():
                            continue

                    log.info(f"Triggering automated rebalance alert email for user_id={u.id}...")
                    await service.send_alert_email()
        except Exception as e:
            log.error(f"Failed to execute automated rebalance alert for user_id={u.id}: {e}")


async def check_and_run_tasks(now: datetime) -> None:
    """
    Check if current time matches scheduled sync times and run them.
    All scheduling evaluations are done in Taiwan timezone (Asia/Taipei).
    """
    from zoneinfo import ZoneInfo
    tz_taipei = ZoneInfo("Asia/Taipei")
    if now.tzinfo is None:
        taipei_now = now.astimezone(tz_taipei)
    else:
        taipei_now = now.astimezone(tz_taipei)

    # Daily Sync: Run DAILY (starting at 17:00 Taipei time or later)
    # Syncs current month's trades, current assets, and previous month's trades (during the first 5 days of the month)
    if taipei_now.hour >= 17:
        current_day = taipei_now.date()
        last_asset_sync = get_last_asset_sync_day()
        if last_asset_sync != current_day:
            # Query all active users
            async with AsyncSessionLocal() as db:
                result = await db.execute(select(User).where(User.is_active == True))
                users = result.scalars().all()
                
            # Calculate previous month for catch-up trade sync at the beginning of the month
            first_this_month = taipei_now.replace(day=1)
            last_day_prev_month = first_this_month - timedelta(days=1)
            prev_year = last_day_prev_month.year
            prev_month = last_day_prev_month.month
            
            for u in users:
                # 1. Sync current assets (which will internally sync trades first) daily
                asyncio.create_task(sync_taishin_assets(taipei_now.year, taipei_now.month, user_id=u.id, target_date=taipei_now.date()))
                asyncio.create_task(sync_esun_assets(taipei_now.year, taipei_now.month, user_id=u.id, target_date=taipei_now.date()))
                
                # 2. At the beginning of the month (day 1-5), also sync previous month's trades to catch late transactions
                if taipei_now.day <= 5:
                    asyncio.create_task(sync_taishin_trades(prev_year, prev_month, user_id=u.id))
                    asyncio.create_task(sync_esun_trades(prev_year, prev_month, user_id=u.id))

            # 3. Check portfolio rebalance distortion and dispatch auto-emails
            asyncio.create_task(check_and_send_rebalance_alerts(users))
                
            set_last_asset_sync_day(current_day)

async def start_scheduler() -> None:
    """
    Background loop running frequently to verify scheduled tasks.
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
        # Sleep for 10 minutes (600 seconds) to ensure we don't miss the 1-hour window
        await asyncio.sleep(600)

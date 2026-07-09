import logging
from typing import Any
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from src.instances.database import get_db
from src.dbs.repository import TransactionRepository
from src.middleware.auth import verify_token
from src.dbs.models import User
from src.utils.date_utils import first_of_month
from pydantic import BaseModel

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/transactions", tags=["Transactions"])

CATEGORY_TRANSLATION = {
    "SALARY": "薪資",
    "INVESTMENT": "投資",
    "TRANSFER_IN": "轉入",
    "TRANSFER_OUT": "轉出",
    "EXPENSE": "固定支出",
    "FOOD": "食物",
    "TRANSPORT": "交通",
    "MEDICAL": "醫療",
    "ENTERTAINMENT": "娛樂",
    "INSURANCE": "保險",
    "EXERCISE": "運動",
    "SHOPPING": "購物",
    "TRAVEL": "旅遊",
    "STUDY": "學習",
    "CREDIT_CARD_PAYMENT": "信用卡繳款",
    "DEBT_REPAYMENT": "本金償還",
    "DIVIDEND": "股利",
    "INTEREST": "利息",
    "OTHER": "非固定支出"
}

@router.get("/")
async def get_transactions(
    year: int = Query(..., description="Year"),
    month: int | None = Query(None, description="Month (Optional)"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(verify_token)
) -> dict[str, Any]:
    try:
        repo = TransactionRepository(db, current_user.id)
        if month is not None:
            period = first_of_month(year, month)
            txns = await repo.get_by_period(account_id=None, period_date=period)
        else:
            # Query for the whole year
            from datetime import date
            from sqlalchemy import select
            from sqlalchemy.orm import joinedload
            from src.dbs.models import Transaction
            start = date(year, 1, 1)
            end = date(year, 12, 31)
            stmt = select(Transaction).options(joinedload(Transaction.account)).where(
                Transaction.user_id == current_user.id,
                Transaction.txn_date >= start,
                Transaction.txn_date <= end,
            )
            result = await db.execute(stmt)
            txns = result.scalars().all()
        
        # Sort by date descending
        sorted_txns = sorted(txns, key=lambda t: t.txn_date, reverse=True)
        
        result = []
        for t in sorted_txns:
            source_str = t.source.value if hasattr(t.source, 'value') else str(t.source)
            if source_str == "brokerage":
                continue # Skip brokerage transactions in the main transaction list
                
            # Check if raw_data exists to pull more specific category if needed
            raw_data = {}
            if t.raw_data:
                import json
                try:
                    raw_data = json.loads(t.raw_data)
                except Exception:
                    pass
            
            # Map category to Chinese
            category_val = t.category.value if hasattr(t.category, 'value') else str(t.category)
            if t.is_internal_transfer:
                display_category = "帳內互轉"
            elif category_val == "OTHER":
                display_category = "非固定收入" if t.amount > 0 else "非固定支出"
            else:
                display_category = CATEGORY_TRANSLATION.get(category_val, category_val)
                
            result.append({
                "id": t.id,
                "date": str(t.txn_date),
                "source": source_str,
                "merchant": t.merchant or "",
                "description": t.description or "",
                "amount": t.amount,
                "category": display_category,
                "is_refund": t.is_refund,
                "raw_category": raw_data.get("category", None),
                "institution": t.account.institution if t.account else "",
                "account_id": t.account_id,
                "is_duplicate": t.is_duplicate
            })
            
        return {"status": "ok", "transactions": result}
    except Exception as e:
        log.error(f"Error fetching transactions: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/export")
async def export_transactions(
    year: int = Query(..., description="Year"),
    month: int | None = Query(None, description="Month (Optional)"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(verify_token),
):
    try:
        import csv
        import io
        from fastapi.responses import StreamingResponse
        from datetime import date
        from sqlalchemy import select
        from sqlalchemy.orm import joinedload
        from src.dbs.models import Transaction

        repo = TransactionRepository(db, current_user.id)
        if month is not None:
            period = first_of_month(year, month)
            txns = await repo.get_by_period(account_id=None, period_date=period)
        else:
            start = date(year, 1, 1)
            end = date(year, 12, 31)
            stmt = select(Transaction).options(joinedload(Transaction.account)).where(
                Transaction.user_id == current_user.id,
                Transaction.txn_date >= start,
                Transaction.txn_date <= end,
            )
            result = await db.execute(stmt)
            txns = result.scalars().all()

        # Sort by date descending
        sorted_txns = sorted(txns, key=lambda t: t.txn_date, reverse=True)

        stream = io.StringIO()
        writer = csv.writer(stream)
        
        # Write headers in Traditional Chinese
        writer.writerow(["日期", "帳戶/來源", "收支分類", "商家/對象", "描述", "金額 (TWD)"])
        
        for t in sorted_txns:
            source_str = t.source.value if hasattr(t.source, 'value') else str(t.source)
            if source_str == "brokerage":
                continue # Skip brokerage transactions
                
            # Date
            date_str = str(t.txn_date)
            
            # Account/Source
            account_str = t.account.name if t.account else (t.institution or source_str)
            
            # Category
            category_val = t.category.value if hasattr(t.category, 'value') else str(t.category)
            if t.is_internal_transfer:
                display_category = "帳內互轉"
            else:
                display_category = CATEGORY_TRANSLATION.get(category_val, category_val)
                
            # Merchant / Object
            merchant_str = t.merchant or ""
            
            # Description
            desc_str = t.description or ""
            
            # Amount
            amount_val = t.amount

            writer.writerow([date_str, account_str, display_category, merchant_str, desc_str, amount_val])

        # Get CSV text and prepend UTF-8 BOM (\ufeff)
        csv_content = "\ufeff" + stream.getvalue()
        
        filename = f"transactions_{year}_{month if month is not None else 'annual'}.csv"
        
        return StreamingResponse(
            io.BytesIO(csv_content.encode("utf-8")),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )
    except Exception as e:
        log.error(f"Error exporting transactions: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/stocks")
async def get_stock_transactions(
    year: int = Query(..., description="Year"),
    month: int | None = Query(None, description="Month (Optional)"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(verify_token),
) -> dict[str, Any]:
    try:
        repo = TransactionRepository(db, current_user.id)
        if month is not None:
            period = first_of_month(year, month)
            txns = await repo.get_by_period(account_id=None, period_date=period)
        else:
            from datetime import date
            from sqlalchemy import select
            from sqlalchemy.orm import joinedload
            from src.dbs.models import Transaction
            start = date(year, 1, 1)
            end = date(year, 12, 31)
            stmt = select(Transaction).options(joinedload(Transaction.account)).where(
                Transaction.user_id == current_user.id,
                Transaction.txn_date >= start,
                Transaction.txn_date <= end,
            )
            result = await db.execute(stmt)
            txns = result.scalars().all()
        
        # Sort by date descending
        sorted_txns = sorted(txns, key=lambda t: t.txn_date, reverse=True)
        
        result = []
        for t in sorted_txns:
            source_str = t.source.value if hasattr(t.source, 'value') else str(t.source)
            if source_str != "brokerage":
                continue # Only include brokerage transactions
            
            category_val = t.category.value if hasattr(t.category, 'value') else str(t.category)
            if t.is_internal_transfer:
                display_category = "帳內互轉"
            else:
                display_category = CATEGORY_TRANSLATION.get(category_val, category_val)
                
            result.append({
                "id": t.id,
                "date": str(t.txn_date),
                "source": source_str,
                "merchant": t.merchant or "",
                "description": t.description or "",
                "amount": t.amount,
                "category": display_category,
                "is_refund": t.is_refund,
                "raw_category": None,
                "institution": t.account.institution if t.account else ""
            })
            
        return {"status": "ok", "transactions": result}
    except Exception as e:
        log.error(f"Error fetching stock transactions: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/stocks/summary")
async def get_stock_transactions_summary(
    months: int = Query(6, ge=1, le=24),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(verify_token),
) -> dict[str, Any]:
    try:
        from datetime import date
        from src.utils.date_utils import first_of_month
        
        current_date = date.today()
        result = []
        
        repo = TransactionRepository(db, current_user.id)
        
        # Generate periods
        periods = []
        for i in range(months):
            y = current_date.year
            m = current_date.month - i
            while m <= 0:
                m += 12
                y -= 1
            periods.append(first_of_month(y, m))
            
        # Order ascending
        periods.reverse()
        
        for p in periods:
            txns = await repo.get_by_period(account_id=None, period_date=p)
            buys = 0.0
            sells = 0.0
            count = 0
            for t in txns:
                source_val = t.source.value if hasattr(t.source, 'value') else str(t.source)
                if source_val != "brokerage":
                    continue
                count += 1
                if t.amount < 0:
                    buys += abs(t.amount)
                else:
                    sells += t.amount
                    
            result.append({
                "period": p.strftime("%Y-%m-%d"),
                "month_label": f"{p.month}月",
                "buys": buys,
                "sells": sells,
                "net": sells - buys,
                "count": count
            })
            
        return {"status": "ok", "summary": result}
    except Exception as e:
        log.error(f"Error fetching stock transactions summary: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class CreateTransactionRequest(BaseModel):
    date: str
    description: str
    amount: float
    category: str
    source: str = "bank"
    merchant: str | None = None
    account_id: int | None = None


class UpdateTransactionRequest(BaseModel):
    date: str | None = None
    merchant: str | None = None
    description: str | None = None
    amount: float | None = None
    category: str | None = None


@router.post("/")
async def create_transaction(
    body: CreateTransactionRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(verify_token),
) -> dict[str, Any]:
    try:
        from src.dbs.models import Transaction, TransactionCategory, TransactionSource, Account
        from datetime import datetime
        from sqlalchemy import select
        
        try:
            txn_date = datetime.strptime(body.date, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format, must be YYYY-MM-DD")
            
        if body.account_id is not None:
            stmt = select(Account).where(Account.id == body.account_id, Account.user_id == current_user.id)
            res = await db.execute(stmt)
            account = res.scalar_one_or_none()
            if not account:
                raise HTTPException(status_code=400, detail="Account not found or access denied")
                
        source_str = body.source
        if source_str == "einvoice":
            source_str = "e_invoice"
        try:
            source = TransactionSource(source_str)
        except ValueError:
            source = TransactionSource.BANK

        # Category mapping
        reverse_cat = {v: k for k, v in CATEGORY_TRANSLATION.items()}
        reverse_cat["帳內互轉"] = "TRANSFER_IN"
        reverse_cat["非固定支出"] = "OTHER"
        reverse_cat["非固定收入"] = "OTHER"
        reverse_cat["其他支出"] = "OTHER"
        reverse_cat["其他收入"] = "OTHER"
        reverse_cat["其他"] = "OTHER"
        reverse_cat["支出"] = "EXPENSE"
        cat_val = reverse_cat.get(body.category, body.category)
        if isinstance(cat_val, str):
            cat_val = cat_val.upper()
        try:
            category = TransactionCategory(cat_val)
        except ValueError:
            category = TransactionCategory.OTHER
            
        # Check transfer status
        is_transfer = False
        if body.category == "帳內互轉" or cat_val in ("transfer_in", "transfer_out"):
            is_transfer = True
        else:
            # Query active accounts to build TransferDetector
            from src.dbs.repository import AccountRepository
            from src.utils.transfer_detector import TransferDetector
            acct_repo = AccountRepository(db, current_user.id)
            accounts = await acct_repo.get_all()
            internal_aids = []
            for a in accounts:
                if a.is_internal:
                    internal_aids.append(a.code)
                    if "_" in a.code:
                        internal_aids.append(a.code.split("_")[-1])
                    if a.notes:
                        internal_aids.append(a.notes)
            detector = TransferDetector(list(set(internal_aids)))
            is_transfer = detector.is_internal_transfer(body.description)

        if is_transfer:
            category = TransactionCategory.TRANSFER_IN if body.amount > 0 else TransactionCategory.TRANSFER_OUT

        txn = Transaction(
            user_id=current_user.id,
            account_id=body.account_id,
            txn_date=txn_date,
            source=source,
            merchant=body.merchant,
            description=body.description,
            amount=body.amount,
            category=category,
            is_internal_transfer=is_transfer,
        )
        
        # Save to database using TransactionRepository
        repo = TransactionRepository(db, current_user.id)
        await repo.create(txn)
        await db.flush()
        
        # Recompute reports
        from src.services.reports.income_statement import IncomeStatementService
        from src.services.reports.balance_sheet import BalanceSheetService
        
        is_service = IncomeStatementService(db, current_user.id)
        bs_service = BalanceSheetService(db, current_user.id)
        
        await is_service.compute(txn_date.year, txn_date.month)
        await bs_service.compute(txn_date.year, txn_date.month)
        await db.commit()
        
        return {"status": "ok", "id": txn.id}
    except HTTPException:
        raise
    except Exception as e:
        log.error(f"Error creating transaction: {e}")
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{txn_id}")
async def update_transaction(
    txn_id: int,
    body: UpdateTransactionRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(verify_token),
) -> dict[str, Any]:
    try:
        from src.dbs.models import Transaction, TransactionCategory
        from datetime import datetime
        from sqlalchemy import select
        
        stmt = select(Transaction).where(Transaction.id == txn_id, Transaction.user_id == current_user.id)
        res = await db.execute(stmt)
        txn = res.scalar_one_or_none()
        if not txn:
            raise HTTPException(status_code=404, detail="Transaction not found")
            
        if body.date is not None:
            try:
                txn.txn_date = datetime.strptime(body.date, "%Y-%m-%d").date()
            except ValueError:
                raise HTTPException(status_code=400, detail="Invalid date format, must be YYYY-MM-DD")
                
        if body.merchant is not None:
            txn.merchant = body.merchant
            
        if body.description is not None:
            txn.description = body.description
            
        if body.amount is not None:
            txn.amount = body.amount
            
        if body.category is not None:
            reverse_cat = {v: k for k, v in CATEGORY_TRANSLATION.items()}
            reverse_cat["帳內互轉"] = "TRANSFER_IN"
            reverse_cat["非固定支出"] = "OTHER"
            reverse_cat["非固定收入"] = "OTHER"
            reverse_cat["其他收入"] = "OTHER"
            reverse_cat["其他支出"] = "OTHER"
            reverse_cat["其他"] = "OTHER"
            reverse_cat["支出"] = "EXPENSE"
            cat_val = reverse_cat.get(body.category, body.category)
            if isinstance(cat_val, str):
                cat_val = cat_val.upper()
            try:
                txn.category = TransactionCategory(cat_val)
            except ValueError:
                txn.category = TransactionCategory.OTHER
            
            # Sync is_internal_transfer flag based on updated category
            if txn.category in (TransactionCategory.TRANSFER_IN, TransactionCategory.TRANSFER_OUT):
                txn.is_internal_transfer = True
                txn.category = TransactionCategory.TRANSFER_IN if txn.amount > 0 else TransactionCategory.TRANSFER_OUT
            else:
                txn.is_internal_transfer = False
                
        await db.flush()
        
        from src.services.reports.income_statement import IncomeStatementService
        from src.services.reports.balance_sheet import BalanceSheetService
        
        is_service = IncomeStatementService(db, current_user.id)
        bs_service = BalanceSheetService(db, current_user.id)
        
        await is_service.compute(txn.txn_date.year, txn.txn_date.month)
        await bs_service.compute(txn.txn_date.year, txn.txn_date.month)
        await db.commit()
        
        return {"status": "ok"}
    except HTTPException:
        raise
    except Exception as e:
        log.error(f"Error updating transaction: {e}")
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{txn_id}")
async def delete_transaction(
    txn_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(verify_token),
) -> dict[str, Any]:
    try:
        from src.dbs.models import Transaction
        from sqlalchemy import select
        
        stmt = select(Transaction).where(Transaction.id == txn_id, Transaction.user_id == current_user.id)
        res = await db.execute(stmt)
        txn = res.scalar_one_or_none()
        if not txn:
            raise HTTPException(status_code=404, detail="Transaction not found")
            
        year = txn.txn_date.year
        month = txn.txn_date.month
        
        await db.delete(txn)
        await db.flush()
        
        from src.services.reports.income_statement import IncomeStatementService
        from src.services.reports.balance_sheet import BalanceSheetService
        
        is_service = IncomeStatementService(db, current_user.id)
        bs_service = BalanceSheetService(db, current_user.id)
        
        await is_service.compute(year, month)
        await bs_service.compute(year, month)
        await db.commit()
        
        return {"status": "ok"}
    except HTTPException:
        raise
    except Exception as e:
        log.error(f"Error deleting transaction: {e}")
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


class BulkDeleteRequest(BaseModel):
    ids: list[int]


class BulkUpdateCategoryRequest(BaseModel):
    ids: list[int]
    category: str


@router.post("/bulk-delete")
async def bulk_delete_transactions(
    body: BulkDeleteRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(verify_token)
) -> dict[str, Any]:
    try:
        from src.dbs.models import Transaction
        from sqlalchemy import select, delete
        
        # Get periods to recompute
        stmt = select(Transaction).where(Transaction.id.in_(body.ids), Transaction.user_id == current_user.id)
        res = await db.execute(stmt)
        txns = res.scalars().all()
        
        if not txns:
            return {"status": "ok", "deleted_count": 0}
            
        periods_to_recompute = set((t.txn_date.year, t.txn_date.month) for t in txns)
        
        # Delete
        stmt_del = delete(Transaction).where(Transaction.id.in_(body.ids), Transaction.user_id == current_user.id)
        await db.execute(stmt_del)
        await db.flush()
        
        # Recompute reports for affected periods
        from src.services.reports.income_statement import IncomeStatementService
        from src.services.reports.balance_sheet import BalanceSheetService
        
        is_service = IncomeStatementService(db, current_user.id)
        bs_service = BalanceSheetService(db, current_user.id)
        
        for y, m in periods_to_recompute:
            await is_service.compute(y, m)
            await bs_service.compute(y, m)
            
        await db.commit()
        return {"status": "ok", "deleted_count": len(txns)}
    except Exception as e:
        log.error(f"Error bulk deleting transactions: {e}")
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/bulk-update-category")
async def bulk_update_category(
    body: BulkUpdateCategoryRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(verify_token)
) -> dict[str, Any]:
    try:
        from src.dbs.models import Transaction, TransactionCategory
        from sqlalchemy import select
        
        # Fetch transactions
        stmt = select(Transaction).where(Transaction.id.in_(body.ids), Transaction.user_id == current_user.id)
        res = await db.execute(stmt)
        txns = res.scalars().all()
        
        if not txns:
            return {"status": "ok", "updated_count": 0}
            
        # Parse category
        reverse_cat = {v: k for k, v in CATEGORY_TRANSLATION.items()}
        reverse_cat["帳內互轉"] = "TRANSFER_IN"
        reverse_cat["非固定支出"] = "OTHER"
        reverse_cat["非固定收入"] = "OTHER"
        reverse_cat["其他收入"] = "OTHER"
        reverse_cat["其他支出"] = "OTHER"
        reverse_cat["其他"] = "OTHER"
        reverse_cat["支出"] = "EXPENSE"
        cat_val = reverse_cat.get(body.category, body.category)
        if isinstance(cat_val, str):
            cat_val = cat_val.upper()
        try:
            new_cat = TransactionCategory(cat_val)
        except ValueError:
            new_cat = TransactionCategory.OTHER

        periods_to_recompute = set((t.txn_date.year, t.txn_date.month) for t in txns)
        
        # Update categories
        for t in txns:
            if new_cat in (TransactionCategory.TRANSFER_IN, TransactionCategory.TRANSFER_OUT):
                t.is_internal_transfer = True
                t.category = TransactionCategory.TRANSFER_IN if t.amount > 0 else TransactionCategory.TRANSFER_OUT
            else:
                t.category = new_cat
                t.is_internal_transfer = False
        await db.flush()
        
        # Recompute reports for affected periods
        from src.services.reports.income_statement import IncomeStatementService
        from src.services.reports.balance_sheet import BalanceSheetService
        
        is_service = IncomeStatementService(db, current_user.id)
        bs_service = BalanceSheetService(db, current_user.id)
        
        for y, m in periods_to_recompute:
            await is_service.compute(y, m)
            await bs_service.compute(y, m)
            
        await db.commit()
        return {"status": "ok", "updated_count": len(txns)}
    except Exception as e:
        log.error(f"Error bulk updating transaction categories: {e}")
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))



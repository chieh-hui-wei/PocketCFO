"""
src/controllers/upload_controller.py
Handles PDF statement uploads, parsing via StatementService, and confirming parsed JSON.
"""
from __future__ import annotations

import uuid
from pathlib import Path
from typing import Annotated, Literal

import aiofiles
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from src.instances.config import get_settings
from src.instances.database import get_db
from src.services.statement import StatementService
from src.dbs.repository import UploadHistoryRepository

import PyPDF2
import logging

log = logging.getLogger(__name__)

router = APIRouter(prefix="/upload", tags=["upload"])
settings = get_settings()

StatementKind = Literal["bank", "credit_card", "brokerage", "einvoice"]


class ConfirmHolding(BaseModel):
    ticker: str
    name: str
    quantity: float
    avg_cost: float
    current_price: float


class ConfirmTransaction(BaseModel):
    date: str
    description: str | None = None
    merchant: str | None = None
    amount: float
    balance: float | None = None
    action: str | None = None
    ticker: str | None = None
    name: str | None = None
    quantity: float | None = None
    price: float | None = None
    fee: float | None = None
    is_refund: bool = False
    payment_method: str | None = None
    invoice_number: str | None = None


class ConfirmStatementRequest(BaseModel):
    kind: str
    filename: str
    file_hash: str
    period_year: int
    period_month: int
    institution: str | None = None
    currency: str = "TWD"
    exchange_rate: float = 1.0
    account_code: str | None = None
    account_number: str | None = None
    card_last_four: str | None = None
    
    # Bank
    closing_balance: float | None = None
    
    # Credit Card
    total_amount: float | None = None
    payment_due_date: str | None = None
    
    # Brokerage
    cash_balance: float | None = None
    total_market_value: float | None = None
    holdings: list[ConfirmHolding] | None = None
    
    # Shared lists
    transactions: list[ConfirmTransaction] | None = None


@router.post("/parse")
async def parse_statement_only(
    file: Annotated[UploadFile, File(description="PDF statement")],
    kind: Annotated[StatementKind, Form(description="bank | credit_card | brokerage | einvoice")],
    account_code: Annotated[str | None, Form()] = None,
    password: Annotated[str | None, Form(description="Password to decrypt PDF if encrypted")] = None,
    db: AsyncSession = Depends(get_db),
):
    """
    Parse a PDF statement using Gemini, returning the JSON structure without writing to the database.
    """
    history_repo = UploadHistoryRepository(db)

    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted")

    contents = await file.read()
    max_bytes = settings.max_upload_size_mb * 1024 * 1024
    if len(contents) > max_bytes:
        raise HTTPException(status_code=413, detail=f"File too large (max {settings.max_upload_size_mb} MB)")

    import hashlib
    file_hash = hashlib.sha256(contents).hexdigest()
    existing = await history_repo.get_by_hash(file_hash)
    if existing:
        raise HTTPException(status_code=409, detail="這份檔案已經上傳過囉！ (Duplicate File)")

    # Save to temp path
    upload_dir = Path(settings.upload_dir) / "statements"
    upload_dir.mkdir(parents=True, exist_ok=True)
    tmp_path = upload_dir / f"{uuid.uuid4()}.pdf"

    async with aiofiles.open(tmp_path, "wb") as f:
        await f.write(contents)

    # Handle decryption
    try:
        reader = PyPDF2.PdfReader(str(tmp_path))
        if reader.is_encrypted:
            if not password:
                raise HTTPException(status_code=400, detail="This PDF file is encrypted. Password is required.")
            reader.decrypt(password)
            try:
                _ = reader.pages[0]
            except Exception:
                raise HTTPException(status_code=400, detail="Failed to decrypt PDF. Incorrect password.")

            writer = PyPDF2.PdfWriter()
            for page in reader.pages:
                writer.add_page(page)
            with open(tmp_path, "wb") as f:
                writer.write(f)
    except HTTPException:
        tmp_path.unlink(missing_ok=True)
        raise
    except Exception as exc:
        tmp_path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=f"Invalid or corrupted PDF file: {exc}")

    try:
        service = StatementService(db)
        parsed_data = await service.parse_statement(tmp_path, kind, file.filename)
        # Add account_code to parsed_data if provided
        if account_code:
            parsed_data["account_code"] = account_code
        return {
            "status": "ok",
            "filename": file.filename,
            "file_hash": file_hash,
            "parsed_data": parsed_data
        }
    except Exception as exc:
        log.error(f"Parsing failed: {exc}")
        raise HTTPException(status_code=500, detail=f"Parsing failed: {str(exc)}")
    finally:
        tmp_path.unlink(missing_ok=True)


@router.post("/confirm")
async def confirm_statement(
    body: ConfirmStatementRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Save the reviewed and edited statement payload to database and trigger recomputations.
    """
    history_repo = UploadHistoryRepository(db)
    
    # Double check if duplicate hash exists
    existing = await history_repo.get_by_hash(body.file_hash)
    if existing:
        raise HTTPException(status_code=409, detail="這份檔案已經上傳過囉！ (Duplicate File)")
        
    # Create success upload history
    history = await history_repo.create(
        filename=body.filename,
        kind=body.kind,
        status="success",
        message="解析與確認完成",
        file_hash=body.file_hash
    )
    
    try:
        service = StatementService(db)
        data = body.model_dump()
        result = await service.save_parsed_statement(data, upload_history_id=history.id)
        
        # Trigger computations
        from src.services.reports.income_statement import IncomeStatementService
        from src.services.reports.balance_sheet import BalanceSheetService
        
        is_service = IncomeStatementService(db)
        bs_service = BalanceSheetService(db)
        
        await is_service.compute(body.period_year, body.period_month)
        await bs_service.compute(body.period_year, body.period_month)
        await db.commit()
        
        return {"status": "ok", "period": f"{body.period_year}-{body.period_month:02d}-01", **result}
    except Exception as exc:
        import traceback
        log.error(f"Confirmation failed traceback: {traceback.format_exc()}")
        await history_repo.delete(history.id)
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Confirmation failed: {str(exc)}")



@router.get("/history")
async def get_upload_history(db: AsyncSession = Depends(get_db)):
    """Get recent upload histories."""
    repo = UploadHistoryRepository(db)
    histories = await repo.list_recent(limit=50)
    return [
        {
            "id": h.id,
            "filename": h.filename,
            "kind": h.kind,
            "status": h.status,
            "message": h.message,
            "created_at": h.created_at.isoformat(),
        }
        for h in histories
    ]

@router.delete("/history/{history_id}")
async def delete_upload_history(history_id: int, db: AsyncSession = Depends(get_db)):
    """Delete an upload history record to allow re-upload."""
    repo = UploadHistoryRepository(db)
    success = await repo.delete(history_id)
    if not success:
        raise HTTPException(status_code=404, detail="Upload history not found")
    return {"status": "ok"}


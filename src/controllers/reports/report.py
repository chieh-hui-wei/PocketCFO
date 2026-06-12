"""
src/controllers/report_controller.py
API endpoints for generating PDF financial reports.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from src.instances.database import get_db
from src.services.reports.report import ReportService

router = APIRouter(prefix="/reports", tags=["reports"])


@router.get("/pdf")
async def generate_pdf_report(
    year: int = Query(..., ge=2020, le=2100),
    month: int = Query(..., ge=1, le=12),
    db: AsyncSession = Depends(get_db),
):
    """
    Generate and download a beautifully styled PDF Financial Report
    containing the Balance Sheet and Income Statement for the given month.
    """
    svc = ReportService(db)
    pdf_io = await svc.generate_monthly_pdf(year, month)
    
    filename = f"pocketCFO_Report_{year}_{month:02d}.pdf"
    
    return StreamingResponse(
        pdf_io,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'}
    )

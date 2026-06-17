"""
src/services/report_service.py
Generates beautiful PDF financial reports using WeasyPrint and Jinja2.
"""
from __future__ import annotations

import json
from datetime import date
from io import BytesIO
from pathlib import Path

from jinja2 import Environment, FileSystemLoader
from sqlalchemy.ext.asyncio import AsyncSession
from weasyprint import HTML

from src.services.reports.balance_sheet import BalanceSheetService
from src.services.reports.income_statement import IncomeStatementService

TEMPLATES_DIR = Path(__file__).parent.parent / "templates"

class ReportService:
    def __init__(self, db: AsyncSession, user_id: int) -> None:
        self.db = db
        self.user_id = user_id
        self.bs_service = BalanceSheetService(db, user_id)
        self.ist_service = IncomeStatementService(db, user_id)
        
        # Setup Jinja2 environment
        self.jinja_env = Environment(
            loader=FileSystemLoader(str(TEMPLATES_DIR)),
            autoescape=True
        )

    async def generate_monthly_pdf(self, year: int, month: int) -> BytesIO:
        """Compute the statements for the month and render a PDF report."""
        # 1. Fetch / Compute Data
        bs = await self.bs_service.compute(year, month)
        ist = await self.ist_service.compute(year, month)
        
        # Parse the JSON details embedded in the models
        bs_details = json.loads(bs.detail_json) if bs.detail_json else {}
        ist_details = json.loads(ist.detail_json) if ist.detail_json else {}

        # 2. Render HTML via Jinja2
        template = self.jinja_env.get_template("financial_report.html")
        period_str = f"{year}-{month:02d}"
        
        html_content = template.render(
            period_date=period_str,
            bs=bs,
            bs_details=bs_details,
            ist=ist,
            ist_details=ist_details,
            css_path=(TEMPLATES_DIR / "report_style.css").resolve()
        )

        # 3. Compile to PDF via WeasyPrint
        pdf_bytes = HTML(string=html_content).write_pdf()
        
        return BytesIO(pdf_bytes)

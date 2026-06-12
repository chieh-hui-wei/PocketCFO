"""
src/controllers/income_statement_controller.py
Income statement API endpoints.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from src.instances.database import get_db
from src.services.reports.income_statement import IncomeStatementService

router = APIRouter(prefix="/income-statement", tags=["income_statement"])


@router.get("/")
async def list_income_statements(db: AsyncSession = Depends(get_db)):
    svc = IncomeStatementService(db)
    return await svc.get_history(months=36)


@router.get("/export")
async def export_income_statement(
    year: int = Query(..., ge=2020, le=2100),
    month: int | None = Query(None, ge=1, le=12),
    db: AsyncSession = Depends(get_db),
):
    import csv
    import io
    from fastapi import HTTPException
    from fastapi.responses import StreamingResponse
    from datetime import date
    from sqlalchemy import select
    from src.dbs.models import IncomeStatement

    try:
        if month is not None:
            # Export single month
            period = date(year, month, 1)
            stmt = select(IncomeStatement).where(IncomeStatement.period_date == period)
            res = await db.execute(stmt)
            istmt = res.scalar_one_or_none()
            
            # If not exists, compute it
            if not istmt:
                try:
                    svc = IncomeStatementService(db)
                    istmt = await svc.compute(year, month)
                    await db.commit()
                except Exception:
                    istmt = IncomeStatement(
                        period_date=period,
                        total_income=0.0,
                        salary_income=0.0,
                        investment_income=0.0,
                        other_income=0.0,
                        total_expenses=0.0,
                        credit_card_expenses=0.0,
                        bank_expenses=0.0,
                        net_savings=0.0
                    )
            
            salary = istmt.salary_income
            investment = istmt.investment_income
            other_inc = istmt.other_income
            total_inc = istmt.total_income
            
            cc = istmt.credit_card_expenses
            bank = istmt.bank_expenses
            total_exp = istmt.total_expenses
            einvoice = max(0.0, total_exp - cc - bank)
            
            savings = istmt.net_savings
            savings_rate = f"{(savings / total_inc * 100):.2f}%" if total_inc > 0 else "0.00%"

            stream = io.StringIO()
            writer = csv.writer(stream)
            writer.writerow(["項目", f"{year}年{month}月金額 (TWD)"])
            
            writer.writerow(["【收入】", ""])
            writer.writerow(["  薪資收入", salary])
            writer.writerow(["  投資收入", investment])
            writer.writerow(["  其他收入", other_inc])
            writer.writerow(["  總收入", total_inc])
            
            writer.writerow(["【支出】", ""])
            writer.writerow(["  信用卡支出", cc])
            writer.writerow(["  銀行扣款", bank])
            writer.writerow(["  電子發票", einvoice])
            writer.writerow(["  總支出", total_exp])
            
            writer.writerow(["【結餘】", ""])
            writer.writerow(["  本月結餘", savings])
            writer.writerow(["  儲蓄率", savings_rate])
            
            csv_content = "\ufeff" + stream.getvalue()
            filename = f"income_statement_{year}_{month}.csv"
        else:
            # Export 12-month comparative grid
            start = date(year, 1, 1)
            end = date(year, 12, 31)
            stmt = select(IncomeStatement).where(
                IncomeStatement.period_date >= start,
                IncomeStatement.period_date <= end
            ).order_by(IncomeStatement.period_date.asc())
            res = await db.execute(stmt)
            statements = res.scalars().all()
            
            by_month = {s.period_date.month: s for s in statements}
            
            def get_vals_and_sum(field_extractor):
                vals = []
                for m in range(1, 13):
                    s = by_month.get(m)
                    vals.append(field_extractor(s) if s else 0.0)
                return vals, sum(vals)

            salary_vals, salary_sum = get_vals_and_sum(lambda s: s.salary_income)
            invest_vals, invest_sum = get_vals_and_sum(lambda s: s.investment_income)
            other_vals, other_sum = get_vals_and_sum(lambda s: s.other_income)
            total_inc_vals, total_inc_sum = get_vals_and_sum(lambda s: s.total_income)
            
            cc_vals, cc_sum = get_vals_and_sum(lambda s: s.credit_card_expenses)
            bank_vals, bank_sum = get_vals_and_sum(lambda s: s.bank_expenses)
            einvoice_vals, einvoice_sum = get_vals_and_sum(
                lambda s: max(0.0, s.total_expenses - s.credit_card_expenses - s.bank_expenses)
            )
            total_exp_vals, total_exp_sum = get_vals_and_sum(lambda s: s.total_expenses)
            
            savings_vals, savings_sum = get_vals_and_sum(lambda s: s.net_savings)
            
            savings_rates = []
            for m in range(12):
                inc = total_inc_vals[m]
                sav = savings_vals[m]
                savings_rates.append(f"{(sav / inc * 100):.2f}%" if inc > 0 else "0.00%")
            overall_rate = f"{(savings_sum / total_inc_sum * 100):.2f}%" if total_inc_sum > 0 else "0.00%"

            stream = io.StringIO()
            writer = csv.writer(stream)
            
            headers = ["項目"] + [f"{m}月" for m in range(1, 13)] + ["年度總計"]
            writer.writerow(headers)
            
            writer.writerow(["【收入】"] + [""] * 13)
            writer.writerow(["  薪資收入"] + salary_vals + [salary_sum])
            writer.writerow(["  投資收入"] + invest_vals + [invest_sum])
            writer.writerow(["  其他收入"] + other_vals + [other_sum])
            writer.writerow(["  總收入"] + total_inc_vals + [total_inc_sum])
            
            writer.writerow(["【支出】"] + [""] * 13)
            writer.writerow(["  信用卡支出"] + cc_vals + [cc_sum])
            writer.writerow(["  銀行扣款"] + bank_vals + [bank_sum])
            writer.writerow(["  電子發票"] + einvoice_vals + [einvoice_sum])
            writer.writerow(["  總支出"] + total_exp_vals + [total_exp_sum])
            
            writer.writerow(["【結餘】"] + [""] * 13)
            writer.writerow(["  本年結餘"] + savings_vals + [savings_sum])
            writer.writerow(["  儲蓄率"] + savings_rates + [overall_rate])
            
            csv_content = "\ufeff" + stream.getvalue()
            filename = f"income_statement_{year}_annual.csv"

        return StreamingResponse(
            io.BytesIO(csv_content.encode("utf-8")),
            media_type="text/csv",
            headers={
                "Content-Disposition": f"attachment; filename={filename}",
                "Access-Control-Expose-Headers": "Content-Disposition"
            }
        )
    except Exception as e:
        import logging
        logger = logging.getLogger(__name__)
        logger.error(f"Error exporting income statement: {e}")
        raise HTTPException(status_code=500, detail=str(e))



@router.post("/compute")
async def compute_income_statement(
    year: int = Query(..., ge=2020, le=2100),
    month: int = Query(..., ge=1, le=12),
    db: AsyncSession = Depends(get_db),
):
    """
    Compute income statement for a given month.
    Inter-account transfers are automatically excluded.
    """
    svc = IncomeStatementService(db)
    stmt = await svc.compute(year, month)
    return {
        "period": stmt.period_date.isoformat(),
        "total_income": stmt.total_income,
        "salary_income": stmt.salary_income,
        "investment_income": stmt.investment_income,
        "other_income": stmt.other_income,
        "total_expenses": stmt.total_expenses,
        "credit_card_expenses": stmt.credit_card_expenses,
        "bank_expenses": stmt.bank_expenses,
        "net_savings": stmt.net_savings,
    }

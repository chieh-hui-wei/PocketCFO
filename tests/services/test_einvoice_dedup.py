"""
Tests for e-invoice line-item totals and payment-account duplicate matching.

- Carrier CSV rows carry per-line amounts, so an invoice total is the sum of its lines.
- 7-11 / 全家 invoices match LINE Bank debits, 全聯 invoices match 國泰世華 card charges,
  by amount within ±3 days.
"""
import pytest
from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from src.dbs.models import TransactionSource


def _build_csv(lines: list[tuple[str, str, str, str]]) -> str:
    """lines: (inv_no, merchant, item, amt) — one CSV row per invoice line."""
    header = (
        "載具自訂名稱,發票日期,發票號碼,發票金額,發票狀態,折讓,賣方統一編號,賣方名稱,"
        "賣方地址,買方統編,消費明細_數量,消費明細_單價,消費明細_金額,消費明細_品名\n"
    )
    rows = [
        f"手機條碼,20260531,{inv},{amt},開立已確認,否,12345678,{merchant},地址X,,1,{amt},{amt},{item}\n"
        for inv, merchant, item, amt in lines
    ]
    return header + "".join(rows)


@pytest.mark.asyncio
async def test_parse_einvoice_csv_sums_line_items(tmp_path):
    from src.services.parsers.bank_statement_parser import parse_einvoice_csv

    csv_path = tmp_path / "einvoice.csv"
    csv_path.write_text(_build_csv([
        ("AP00000001", "全聯實業股份有限公司", "A印花貼紙張", "0"),
        ("AP00000001", "全聯實業股份有限公司", "油雞胸肉", "139"),
        ("AP00000001", "全聯實業股份有限公司", "豬瘦絞肉", "105"),
        ("AP00000001", "全聯實業股份有限公司", "折讓", "-44"),
        ("AZ00000002", "統一超商股份有限公司", "豆奶", "46"),
    ]), encoding="utf-8")

    items = {i["invoice_number"]: i for i in (await parse_einvoice_csv(csv_path))["items"]}

    assert items["AP00000001"]["amount"] == 200
    assert items["AZ00000002"]["amount"] == 46


def test_match_payment_rule():
    from src.services.statement.service import match_payment_rule

    assert match_payment_rule("統一超商股份有限公司")["source"] == TransactionSource.BANK
    assert match_payment_rule("全家便利商店")["source"] == TransactionSource.BANK
    assert match_payment_rule("全聯實業股份有限公司")["source"] == TransactionSource.CREDIT_CARD
    assert match_payment_rule("星巴克") is None


def _txn(id_: int, d: date, amount: float):
    return SimpleNamespace(id=id_, txn_date=d, amount=amount, merchant="", description="")


async def _parse_with(items: list[dict], line_bank: list, cathay: list) -> list[dict]:
    from src.services.statement.service import StatementService

    async def fake_by_institution(start, end, source, institutions):
        return line_bank if source == TransactionSource.BANK else cathay

    svc = StatementService.__new__(StatementService)
    svc.db = AsyncMock()
    svc.user_id = 1
    svc.txn_repo = AsyncMock()
    svc.txn_repo.get_by_period_and_source.return_value = []
    svc.txn_repo.get_txns_by_institution.side_effect = fake_by_institution

    data = {"period_year": 2026, "period_month": 5, "items": items}
    with patch("src.services.statement.service.parse_einvoice_csv", AsyncMock(return_value=data)), \
         patch("src.utils.category_classifier.classify_transactions_batch", AsyncMock(return_value={})):
        result = await svc.parse_statement("x.csv", "einvoice", "x.csv")
    return result["items"]


@pytest.mark.asyncio
async def test_cvs_invoice_matches_line_bank_within_3_days():
    items = await _parse_with(
        [
            {"date": "2026-05-10", "merchant": "統一超商股份有限公司", "amount": 85},
            {"date": "2026-05-10", "merchant": "全家便利商店", "amount": 85},  # only one bank debit to match
            {"date": "2026-05-20", "merchant": "全家便利商店", "amount": 60},  # 4 days off
        ],
        line_bank=[_txn(1, date(2026, 5, 13), -85), _txn(2, date(2026, 5, 24), -60)],
        cathay=[],
    )
    assert [i["is_duplicate"] for i in items] == [True, False, False]


@pytest.mark.asyncio
async def test_pxmart_invoice_matches_cathay_card_and_ignores_others():
    items = await _parse_with(
        [
            {"date": "2026-05-31", "merchant": "全聯實業股份有限公司", "amount": 573},
            {"date": "2026-05-31", "merchant": "星巴克", "amount": 150},  # no payment rule
        ],
        line_bank=[_txn(3, date(2026, 5, 31), -150)],
        cathay=[_txn(4, date(2026, 6, 2), -573)],  # cross-month, 2 days later
    )
    assert [i["is_duplicate"] for i in items] == [True, False]

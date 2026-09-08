"""
Tests for e-invoice amount sign convention.

E-invoice transactions are always consumption (expenses) so the stored
amount must always be negative, mirroring credit-card behaviour.
"""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from pathlib import Path


# ---------------------------------------------------------------------------
# Unit test: parse_einvoice_csv produces positive amounts from CSV data
# ---------------------------------------------------------------------------

def _build_csv(rows: list[dict]) -> str:
    """Return a CSV string in the same format as the Taiwan e-invoice carrier export."""
    header = (
        "載具自訂名稱,發票日期,發票號碼,發票金額,發票狀態,折讓,賣方統一編號,賣方名稱,"
        "賣方地址,買方統編,消費明細_數量,消費明細_單價,消費明細_金額,消費明細_品名\n"
    )
    lines = [header]
    for r in rows:
        lines.append(
            f"載具A,{r['date']},{r['inv_no']},{r['amt']},正常,0,12345678,{r['merchant']},"
            f"地址X,,1,{r['amt']},{r['amt']},{r['item']}\n"
        )
    return "".join(lines)


@pytest.mark.asyncio
async def test_parse_einvoice_csv_positive_amount(tmp_path):
    """parse_einvoice_csv should return positive amounts as-is (raw from CSV)."""
    from src.services.parsers.bank_statement_parser import parse_einvoice_csv

    csv_content = _build_csv([
        {"inv_no": "AA00000001", "date": "20240101", "merchant": "星巴克", "item": "拿鐵", "amt": "150"},
        {"inv_no": "AA00000002", "date": "20240115", "merchant": "全家", "item": "飲料", "amt": "50"},
    ])
    csv_path = tmp_path / "test_einvoice.csv"
    csv_path.write_text(csv_content, encoding="utf-8")

    result = await parse_einvoice_csv(csv_path)
    items = result["items"]

    assert len(items) == 2
    # Raw parser returns positive amounts; sign is flipped during save
    for item in items:
        assert item["amount"] > 0, f"Raw CSV amount should be positive, got {item['amount']}"


# ---------------------------------------------------------------------------
# Unit test: save_einvoice_statement stores amounts as negative (expense)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_save_einvoice_always_negative_amount():
    """
    save_einvoice_statement must store every item with a negative amount
    regardless of whether the raw CSV amount is positive.
    """
    from src.services.statement.service import StatementService

    # Build a minimal data payload
    data = {
        "kind": "einvoice",
        "period_year": 2024,
        "period_month": 1,
        "items": [
            {
                "date": "2024-01-01",
                "merchant": "星巴克",
                "description": "拿鐵",
                "amount": 150,        # positive raw amount
                "payment_method": "載具A",
                "invoice_number": "AA00000001",
                "is_duplicate": False,
            },
            {
                "date": "2024-01-15",
                "merchant": "全家",
                "description": "飲料",
                "amount": -50,        # already negative – should still be stored negative
                "payment_method": "載具A",
                "invoice_number": "AA00000002",
                "is_duplicate": False,
            },
        ],
    }

    # Capture the Transaction objects that would be bulk-inserted
    inserted_txns: list = []

    async def fake_bulk_insert(txns):
        inserted_txns.extend(txns)

    # Minimal mocks so we don't need a real DB
    db = AsyncMock()
    txn_repo = AsyncMock()
    txn_repo.bulk_insert.side_effect = fake_bulk_insert
    account_repo = AsyncMock()
    snapshot_repo = AsyncMock()

    svc = StatementService.__new__(StatementService)
    svc.db = db
    svc.user_id = 1
    svc.txn_repo = txn_repo
    svc.account_repo = account_repo
    svc.snapshot_repo = snapshot_repo

    await svc.save_einvoice_statement(data)

    assert len(inserted_txns) == 2, "Expected 2 transactions to be inserted"
    for txn in inserted_txns:
        assert txn.amount < 0, (
            f"E-invoice transaction amount must be negative (expense), got {txn.amount} "
            f"for merchant '{txn.merchant}'"
        )

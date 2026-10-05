"""
Tests that e-invoice categories confirmed in the preview survive saving,
and that Gemini results with numeric ids still map back to their items.
"""
import pytest
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch


def _service():
    from src.services.statement.service import StatementService

    inserted: list = []
    next_id = iter(range(1000, 2000))

    async def fake_bulk_insert(txns):
        for t in txns:
            t.id = next(next_id)
        inserted.extend(txns)

    svc = StatementService.__new__(StatementService)
    svc.db = AsyncMock()
    svc.user_id = 1
    svc.txn_repo = AsyncMock()
    svc.txn_repo.bulk_insert.side_effect = fake_bulk_insert
    return svc, inserted


def _item(merchant: str, category: str = "") -> dict:
    return {"date": "2026-05-31", "merchant": merchant, "description": merchant, "amount": 100, "category": category}


@pytest.mark.asyncio
async def test_save_einvoice_keeps_preview_category():
    from src.dbs.models import TransactionCategory

    svc, inserted = _service()
    classify = AsyncMock(return_value={})
    data = {"period_year": 2026, "period_month": 5, "items": [_item("曌躍", "運動"), _item("星巴克", "食物")]}

    with patch("src.utils.category_classifier.classify_transactions_batch", classify):
        await svc.save_einvoice_statement(data)

    assert [t.category for t in inserted] == [TransactionCategory.EXERCISE, TransactionCategory.FOOD]
    classify.assert_not_called()


@pytest.mark.asyncio
async def test_save_einvoice_classifies_items_without_category():
    from src.dbs.models import TransactionCategory

    svc, inserted = _service()

    async def fake_classify(items, rules):
        assert [i["merchant"] for i in items] == ["統一超商"]
        return {items[0]["id"]: "food"}

    data = {"period_year": 2026, "period_month": 5, "items": [_item("曌躍", "運動"), _item("統一超商")]}
    with patch("src.utils.category_classifier.classify_transactions_batch", fake_classify), \
         patch("src.services.statement.service.CategoryRuleRepository") as repo:
        repo.return_value.list_all = AsyncMock(return_value=[])
        await svc.save_einvoice_statement(data)

    assert [t.category for t in inserted] == [TransactionCategory.EXERCISE, TransactionCategory.FOOD]


@pytest.mark.asyncio
async def test_classifier_accepts_numeric_ids_from_gemini():
    from src.utils.category_classifier import classify_transactions_batch

    response = SimpleNamespace(text='{"results": [{"id": 1523, "category": "exercise"}]}')
    client = MagicMock()
    client.aio.models.generate_content = AsyncMock(return_value=response)

    with patch("src.instances.gemini.get_gemini_client", return_value=client):
        result = await classify_transactions_batch([{"id": "1523", "merchant": "健身工廠", "description": ""}], [])

    assert result == {"1523": "exercise"}

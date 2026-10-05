"""
Tests that a transaction's source can be changed via the update endpoint.
"""
import pytest
from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi import HTTPException

from src.dbs.models import TransactionSource


async def _update(source: str):
    from src.controllers.transactions.api import update_transaction
    from src.controllers.transactions.model import UpdateTransactionRequest

    txn = SimpleNamespace(id=1, txn_date=date(2026, 5, 31), amount=-100, source=TransactionSource.BANK)
    res = MagicMock()
    res.scalar_one_or_none.return_value = txn
    db = AsyncMock()
    db.execute.return_value = res

    with patch("src.controllers.transactions.api.TransactionService.recompute_affected_periods", AsyncMock()):
        await update_transaction(1, UpdateTransactionRequest(source=source), db=db, current_user=SimpleNamespace(id=1))
    return txn


@pytest.mark.asyncio
@pytest.mark.parametrize("given, expected", [
    ("credit_card", TransactionSource.CREDIT_CARD),
    ("e_invoice", TransactionSource.E_INVOICE),
    ("einvoice", TransactionSource.E_INVOICE),
])
async def test_update_transaction_source(given, expected):
    assert (await _update(given)).source == expected


@pytest.mark.asyncio
async def test_update_transaction_rejects_unknown_source():
    with pytest.raises(HTTPException) as exc:
        await _update("cash")
    assert exc.value.status_code == 400

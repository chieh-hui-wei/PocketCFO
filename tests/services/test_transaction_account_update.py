"""
Tests that a bank transaction can be moved to another bank account via the update endpoint,
while credit card / e-invoice rows stay tied to their uploaded statement.
"""
import pytest
from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi import HTTPException

from src.dbs.models import AccountType, TransactionSource


def _result(value):
    res = MagicMock()
    res.scalar_one_or_none.return_value = value
    return res


async def _update(source: TransactionSource, account):
    from src.controllers.transactions.api import update_transaction
    from src.controllers.transactions.model import UpdateTransactionRequest

    txn = SimpleNamespace(id=1, txn_date=date(2026, 5, 31), amount=-100, source=source, account_id=10)
    db = AsyncMock()
    db.execute.side_effect = [_result(txn), _result(account)]

    with patch("src.controllers.transactions.api.TransactionService.recompute_affected_periods", AsyncMock()):
        await update_transaction(1, UpdateTransactionRequest(account_id=20), db=db, current_user=SimpleNamespace(id=1))
    return txn


@pytest.mark.asyncio
async def test_bank_txn_moves_to_other_bank_account():
    txn = await _update(TransactionSource.BANK, SimpleNamespace(id=20, account_type=AccountType.BANK))
    assert txn.account_id == 20


@pytest.mark.asyncio
@pytest.mark.parametrize("account", [None, SimpleNamespace(id=20, account_type=AccountType.CREDIT_CARD)])
async def test_rejects_missing_or_non_bank_account(account):
    with pytest.raises(HTTPException) as exc:
        await _update(TransactionSource.BANK, account)
    assert exc.value.status_code == 400


@pytest.mark.asyncio
@pytest.mark.parametrize("source", [TransactionSource.CREDIT_CARD, TransactionSource.E_INVOICE])
async def test_non_bank_txn_account_cannot_change(source):
    with pytest.raises(HTTPException) as exc:
        await _update(source, SimpleNamespace(id=20, account_type=AccountType.BANK))
    assert exc.value.status_code == 400

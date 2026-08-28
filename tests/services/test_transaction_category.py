"""
Unit tests for TransactionService.resolve_category_update.

Regression coverage for a bug where selecting an explicit "轉入"/"轉出" direction on a
batch of transactions was silently overridden by the transaction's amount sign, so a
transaction the user explicitly categorized as "轉出" (TRANSFER_OUT) could end up stored
as "轉入" (TRANSFER_IN) if its amount happened to be positive.
"""
import pytest

from src.dbs.models import TransactionCategory
from src.services.transactions.service import TransactionService


@pytest.mark.parametrize(
    "label,amount,expected_category",
    [
        # Explicit direction must be respected regardless of the amount's sign.
        ("轉出", 50000.0, TransactionCategory.TRANSFER_OUT),
        ("轉出", -50000.0, TransactionCategory.TRANSFER_OUT),
        ("轉入", 50000.0, TransactionCategory.TRANSFER_IN),
        ("轉入", -50000.0, TransactionCategory.TRANSFER_IN),
    ],
)
def test_explicit_transfer_direction_is_respected(label, amount, expected_category):
    category, is_internal_transfer = TransactionService.resolve_category_update(label, amount)
    assert category == expected_category
    assert is_internal_transfer is True


@pytest.mark.parametrize(
    "amount,expected_category",
    [
        (50000.0, TransactionCategory.TRANSFER_IN),
        (-50000.0, TransactionCategory.TRANSFER_OUT),
    ],
)
def test_generic_transfer_label_derives_direction_from_amount(amount, expected_category):
    category, is_internal_transfer = TransactionService.resolve_category_update("帳內互轉", amount)
    assert category == expected_category
    assert is_internal_transfer is True


@pytest.mark.parametrize(
    "label,amount,expected_category",
    [
        ("食物", -300.0, TransactionCategory.FOOD),
        ("薪資", 60000.0, TransactionCategory.SALARY),
        ("投資", -10000.0, TransactionCategory.INVESTMENT),
        ("信用卡繳款", -5000.0, TransactionCategory.CREDIT_CARD_PAYMENT),
    ],
)
def test_non_transfer_categories_are_not_marked_as_internal_transfer(label, amount, expected_category):
    category, is_internal_transfer = TransactionService.resolve_category_update(label, amount)
    assert category == expected_category
    assert is_internal_transfer is False


def test_unknown_label_falls_back_to_other():
    category, is_internal_transfer = TransactionService.resolve_category_update("不存在的類別", -100.0)
    assert category == TransactionCategory.OTHER
    assert is_internal_transfer is False


@pytest.mark.parametrize("alias", ["非固定支出", "非固定收入", "其他收入", "其他支出", "其他"])
def test_generic_other_aliases_resolve_to_other(alias):
    category, is_internal_transfer = TransactionService.resolve_category_update(alias, -100.0)
    assert category == TransactionCategory.OTHER
    assert is_internal_transfer is False


def test_raw_enum_name_is_accepted_case_insensitively():
    category, is_internal_transfer = TransactionService.resolve_category_update("transport", -100.0)
    assert category == TransactionCategory.TRANSPORT
    assert is_internal_transfer is False

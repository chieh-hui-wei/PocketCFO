"""
src/services/ai_assistant/tools.py
Function-calling tools exposed to the Gemini AI agent. Each tool wraps an
existing REST endpoint function directly (reusing its validation/side-effect
logic), so behavior stays identical to calling the API by hand.

Tools in CONFIRMATION_REQUIRED are never executed automatically: the caller
(ai_assistant/service.py) must surface them to the user as a pending action and
only call execute_tool_call() again after the user explicitly confirms.
"""
from __future__ import annotations

import logging
from typing import Any

from google.genai import types
from sqlalchemy.ext.asyncio import AsyncSession

from src.controllers.price_alerts.model import CreatePriceAlertRequest
from src.controllers.transactions.model import (
    BulkDeleteRequest,
    CreateTransactionRequest,
    UpdateTransactionRequest,
)
from src.dbs.models import User

log = logging.getLogger(__name__)

CONFIRMATION_REQUIRED: set[str] = {"create_price_alert"}

FUNCTION_DECLARATIONS = [
    types.FunctionDeclaration(
        name="create_transaction",
        description="新增一筆交易紀錄（收入或支出）。",
        parameters={
            "type": "object",
            "properties": {
                "date": {"type": "string", "description": "YYYY-MM-DD"},
                "description": {"type": "string"},
                "amount": {"type": "number", "description": "正數為收入，負數為支出"},
                "category": {"type": "string"},
                "merchant": {"type": "string"},
                "account_id": {"type": "integer"},
            },
            "required": ["date", "description", "amount", "category"],
        },
    ),
    types.FunctionDeclaration(
        name="update_transaction",
        description="更新一筆既有交易紀錄的欄位。",
        parameters={
            "type": "object",
            "properties": {
                "txn_id": {"type": "integer"},
                "date": {"type": "string"},
                "merchant": {"type": "string"},
                "description": {"type": "string"},
                "amount": {"type": "number"},
                "category": {"type": "string"},
            },
            "required": ["txn_id"],
        },
    ),
    types.FunctionDeclaration(
        name="delete_transaction",
        description="刪除一筆交易紀錄。",
        parameters={
            "type": "object",
            "properties": {"txn_id": {"type": "integer"}},
            "required": ["txn_id"],
        },
    ),
    types.FunctionDeclaration(
        name="bulk_delete_transactions",
        description="批次刪除多筆交易紀錄。",
        parameters={
            "type": "object",
            "properties": {
                "ids": {"type": "array", "items": {"type": "integer"}},
            },
            "required": ["ids"],
        },
    ),
    types.FunctionDeclaration(
        name="create_price_alert",
        description=(
            "建立到價自動下單監控（會透過券商 API 自動送出限價委託單，屬於重要決定，"
            "呼叫此工具前一定要先跟使用者確認股票代號、方向、目標價、股數、券商是否正確）。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "ticker": {"type": "string"},
                "side": {"type": "string", "enum": ["buy", "sell"]},
                "target_price": {"type": "number"},
                "quantity": {"type": "integer"},
                "broker": {"type": "string", "enum": ["esun", "taishin"]},
                "name": {"type": "string"},
            },
            "required": ["ticker", "side", "target_price", "quantity"],
        },
    ),
    types.FunctionDeclaration(
        name="cancel_price_alert",
        description="取消一筆監控中的到價提醒或到價自動下單。",
        parameters={
            "type": "object",
            "properties": {"alert_id": {"type": "integer"}},
            "required": ["alert_id"],
        },
    ),
]


async def execute_tool_call(name: str, args: dict[str, Any], user_id: int, current_user: User, db: AsyncSession) -> dict[str, Any]:
    """Executes a tool call by delegating to the corresponding controller function,
    reusing its existing validation and side-effect logic."""
    if name == "create_transaction":
        from src.controllers.transactions.api import create_transaction

        body = CreateTransactionRequest(
            date=args["date"],
            description=args["description"],
            amount=args["amount"],
            category=args["category"],
            merchant=args.get("merchant"),
            account_id=args.get("account_id"),
        )
        return await create_transaction(body=body, db=db, current_user=current_user)

    if name == "update_transaction":
        from src.controllers.transactions.api import update_transaction

        body = UpdateTransactionRequest(
            date=args.get("date"),
            merchant=args.get("merchant"),
            description=args.get("description"),
            amount=args.get("amount"),
            category=args.get("category"),
        )
        return await update_transaction(txn_id=args["txn_id"], body=body, db=db, current_user=current_user)

    if name == "delete_transaction":
        from src.controllers.transactions.api import delete_transaction

        return await delete_transaction(txn_id=args["txn_id"], db=db, current_user=current_user)

    if name == "bulk_delete_transactions":
        from src.controllers.transactions.api import bulk_delete_transactions

        return await bulk_delete_transactions(body=BulkDeleteRequest(ids=args["ids"]), db=db, current_user=current_user)

    if name == "create_price_alert":
        from src.controllers.price_alerts.api import create_price_alert

        body = CreatePriceAlertRequest(
            ticker=args["ticker"],
            name=args.get("name"),
            alert_type="auto_trade",
            side=args["side"],
            quantity=args["quantity"],
            broker=args.get("broker", "esun"),
            target_price=args["target_price"],
        )
        return await create_price_alert(body=body, db=db, current_user=current_user)

    if name == "cancel_price_alert":
        from src.controllers.price_alerts.api import cancel_price_alert

        return await cancel_price_alert(alert_id=args["alert_id"], db=db, current_user=current_user)

    raise ValueError(f"Unknown tool: {name}")

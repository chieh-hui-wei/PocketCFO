from __future__ import annotations

import inspect
import logging
from dataclasses import dataclass
from datetime import date
from typing import Any, Awaitable, Callable

from google.genai import types
from sqlalchemy.ext.asyncio import AsyncSession

from src.controllers.price_alerts.model import CreatePriceAlertRequest
from src.controllers.transactions.model import (
    BulkDeleteRequest,
    CreateTransactionRequest,
    UpdateTransactionRequest,
)
from src.dbs.models import User
from src.dbs.repository import (
    AccountRepository,
    AccountSnapshotRepository,
    BalanceSheetRepository,
    IncomeStatementRepository,
    PriceAlertRepository,
    SecurityRepository,
    TransactionRepository,
)

log = logging.getLogger(__name__)

ToolFunc = Callable[[dict[str, Any], int, User, AsyncSession], Awaitable[dict[str, Any]]]


@dataclass
class ToolSpec:
    name: str
    description: str
    parameters: dict[str, Any]
    confirmation_required: bool
    func: ToolFunc


_REGISTRY: dict[str, ToolSpec] = {}


def tool(*, parameters: dict[str, Any], confirmation_required: bool = False) -> Callable[[ToolFunc], ToolFunc]:
    """
    Registers an async function as a Gemini-callable tool.

    The function's docstring becomes the tool's description (shown to the
    LLM to decide when to call it), so write it for the agent, not for a
    human maintainer. `parameters` is the JSON-schema for the tool's
    arguments. Every registered function must accept
    (args, user_id, current_user, db) and return a JSON-serializable dict.
    """
    def decorator(func: ToolFunc) -> ToolFunc:
        description = inspect.getdoc(func) or ""
        _REGISTRY[func.__name__] = ToolSpec(
            name=func.__name__,
            description=description,
            parameters=parameters,
            confirmation_required=confirmation_required,
            func=func,
        )
        return func
    return decorator


def _parse_period(period: str | None) -> date | None:
    if not period:
        return None
    year_str, month_str = period.split("-")
    return date(int(year_str), int(month_str), 1)


def _serialize_account(a: Any) -> dict[str, Any]:
    return {
        "id": a.id,
        "name": a.name,
        "code": a.code,
        "account_type": a.account_type.value if hasattr(a.account_type, "value") else str(a.account_type),
        "institution": a.institution,
        "currency": a.currency,
        "is_internal": a.is_internal,
    }


def _serialize_snapshot(s: Any) -> dict[str, Any]:
    return {
        "account_id": s.account_id,
        "period": str(s.period_date),
        "balance": s.balance,
        "currency": s.currency,
        "payment_due_date": str(s.payment_due_date) if s.payment_due_date else None,
    }


def _serialize_transaction(t: Any) -> dict[str, Any]:
    return {
        "id": t.id,
        "date": str(t.txn_date),
        "account_id": t.account_id,
        "merchant": t.merchant,
        "description": t.description,
        "amount": t.amount,
        "currency": t.currency,
        "category": t.category.value if hasattr(t.category, "value") else str(t.category),
        "is_internal_transfer": t.is_internal_transfer,
    }


def _serialize_security(s: Any) -> dict[str, Any]:
    return {
        "account_id": s.account_id,
        "period": str(s.period_date),
        "ticker": s.ticker,
        "name": s.name,
        "quantity": s.quantity,
        "avg_cost": s.avg_cost,
        "current_price": s.current_price,
        "market_value": s.market_value,
        "unrealized_pnl": s.unrealized_pnl,
        "currency": s.currency,
    }


def _serialize_balance_sheet(bs: Any) -> dict[str, Any]:
    return {
        "period": str(bs.period_date),
        "total_cash": bs.total_cash,
        "total_securities_market_value": bs.total_securities_market_value,
        "total_assets": bs.total_assets,
        "total_credit_card_payable": bs.total_credit_card_payable,
        "total_liabilities": bs.total_liabilities,
        "net_worth": bs.net_worth,
    }


def _serialize_income_statement(inc: Any) -> dict[str, Any]:
    return {
        "period": str(inc.period_date),
        "total_income": inc.total_income,
        "salary_income": inc.salary_income,
        "investment_income": inc.investment_income,
        "other_income": inc.other_income,
        "total_expenses": inc.total_expenses,
        "credit_card_expenses": inc.credit_card_expenses,
        "bank_expenses": inc.bank_expenses,
        "net_savings": inc.net_savings,
    }


def _serialize_price_alert(pa: Any) -> dict[str, Any]:
    return {
        "id": pa.id,
        "ticker": pa.ticker,
        "name": pa.name,
        "side": pa.side.value if hasattr(pa.side, "value") else str(pa.side),
        "target_price": pa.target_price,
        "quantity": pa.quantity,
        "broker": pa.broker.value if hasattr(pa.broker, "value") else str(pa.broker),
        "status": pa.status.value if hasattr(pa.status, "value") else str(pa.status),
    }


# ── Read tools ──────────────────────────────────────────────────────────────

@tool(parameters={"type": "object", "properties": {}})
async def get_accounts(args: dict[str, Any], user_id: int, current_user: User, db: AsyncSession) -> dict[str, Any]:
    """
    列出使用者名下所有的帳戶（銀行帳戶、信用卡、券商帳戶、負債帳戶等），
    包含帳戶名稱、類型、所屬機構、幣別等基本資料，但不含餘額。
    當使用者詢問「我有哪些帳戶／銀行／信用卡／券商戶頭」，或需要先找出 account_id
    才能查詢餘額、交易、庫存等其他工具時，呼叫此工具。不需要任何參數。
    """
    repo = AccountRepository(db, user_id)
    accounts = await repo.get_all()
    return {"accounts": [_serialize_account(a) for a in accounts]}


@tool(parameters={
    "type": "object",
    "properties": {
        "period": {
            "type": "string",
            "description": "查詢月份，格式 YYYY-MM（例如 '2026-07'）。省略則回傳每個帳戶最新的快照。",
        },
    },
})
async def get_account_balances(args: dict[str, Any], user_id: int, current_user: User, db: AsyncSession) -> dict[str, Any]:
    """
    查詢使用者每個帳戶在某個月份的現金餘額（月結快照），例如銀行存款、信用卡應繳金額等。
    當使用者詢問「我現在／某月有多少錢」、「戶頭餘額」、「信用卡欠多少」時使用。
    若不提供 period，預設回傳每個帳戶『最新一筆』快照（不一定是同一個月份）。
    """
    repo = AccountSnapshotRepository(db, user_id)
    period = _parse_period(args.get("period"))
    snapshots = await (repo.get_by_period(period) if period else repo.get_latest_before_or_equal(date.today()))
    return {"balances": [_serialize_snapshot(s) for s in snapshots]}


@tool(parameters={
    "type": "object",
    "properties": {
        "start_date": {"type": "string", "description": "起始日期 YYYY-MM-DD（含）"},
        "end_date": {"type": "string", "description": "結束日期 YYYY-MM-DD（含）"},
        "category": {
            "type": "string",
            "description": (
                "交易類別（可選）。有效值：SALARY, INVESTMENT, TRANSFER_IN, TRANSFER_OUT, "
                "EXPENSE, FOOD, TRANSPORT, MEDICAL, ENTERTAINMENT, INSURANCE, EXERCISE, "
                "SHOPPING, CREDIT_CARD_PAYMENT, DEBT_REPAYMENT, DIVIDEND, INTEREST, TRAVEL, "
                "STUDY, OTHER"
            ),
        },
        "account_id": {"type": "integer", "description": "只查詢特定帳戶的交易（可選）"},
    },
    "required": ["start_date", "end_date"],
})
async def get_transactions(args: dict[str, Any], user_id: int, current_user: User, db: AsyncSession) -> dict[str, Any]:
    """
    查詢使用者在指定日期區間內的現金交易明細（收入／支出的逐筆紀錄），
    可選擇用類別（category）或帳戶（account_id）篩選。
    當使用者詢問「這個月花了多少」、「某類別花費」、「列出某段期間的交易」時使用。
    為避免回傳過多資料，最多回傳 200 筆，依日期新到舊排序；
    若使用者只問總金額或筆數，仍可用本工具取得資料後自行加總。
    """
    from sqlalchemy import select
    from src.dbs.models import Transaction

    start = date.fromisoformat(args["start_date"])
    end = date.fromisoformat(args["end_date"])
    stmt = select(Transaction).where(
        Transaction.user_id == user_id,
        Transaction.txn_date >= start,
        Transaction.txn_date <= end,
    )
    if args.get("category"):
        stmt = stmt.where(Transaction.category == args["category"])
    if args.get("account_id"):
        stmt = stmt.where(Transaction.account_id == args["account_id"])
    stmt = stmt.order_by(Transaction.txn_date.desc()).limit(200)
    result = await db.execute(stmt)
    txns = result.scalars().all()
    return {"transactions": [_serialize_transaction(t) for t in txns], "count": len(txns)}


@tool(parameters={
    "type": "object",
    "properties": {
        "period": {"type": "string", "description": "查詢月份，格式 YYYY-MM。省略則回傳最新庫存。"},
    },
})
async def get_securities(args: dict[str, Any], user_id: int, current_user: User, db: AsyncSession) -> dict[str, Any]:
    """
    查詢使用者「個股層級」的股票／證券庫存明細，包含股票代號、股數、成本、現價、
    市值、未實現損益等逐檔資料。
    當使用者詢問「我持有哪些股票」、「某檔股票庫存市值／未實現損益」等針對個別
    股票的問題時使用。
    注意：若使用者詢問的是「資產配置」「現金／股票／債券佔比」「目標配置 vs 實際配置」
    等再平衡策略相關的總覽性問題，應改用 get_asset_allocation，不要用本工具
    （本工具只回傳個股明細，不含現金／債券分類與配置比例）。
    若不提供 period，回傳每個帳戶最新一筆庫存快照。
    """
    repo = SecurityRepository(db, user_id)
    period = _parse_period(args.get("period"))
    securities = await (repo.get_by_period(period) if period else repo.get_latest_before_or_equal(date.today()))
    return {"securities": [_serialize_security(s) for s in securities]}


@tool(parameters={
    "type": "object",
    "properties": {
        "period": {"type": "string", "description": "查詢月份，格式 YYYY-MM。省略則回傳最新一期。"},
    },
})
async def get_balance_sheet(args: dict[str, Any], user_id: int, current_user: User, db: AsyncSession) -> dict[str, Any]:
    """
    查詢使用者某個月份（或最新一期）已計算好的資產負債表總覽，包含總現金、
    證券市值、總資產、信用卡應付、總負債、淨資產。
    當使用者詢問「我的淨資產」、「總資產／總負債」、「資產負債表」時使用，
    比自己用 get_account_balances / get_securities 加總更準確、更快。
    注意：若使用者問的是「資產配置」「現金／股票／債券佔比」「目標 vs 實際配置」，
    請改用 get_asset_allocation，該工具才有實際的配置比例與再平衡目標資料。
    """
    repo = BalanceSheetRepository(db, user_id)
    period = _parse_period(args.get("period"))
    if period:
        bs = await repo.get_by_period(period)
        return {"balance_sheet": _serialize_balance_sheet(bs) if bs else None}
    all_sheets = await repo.list_all()
    return {"balance_sheet": _serialize_balance_sheet(all_sheets[0]) if all_sheets else None}


@tool(parameters={
    "type": "object",
    "properties": {
        "period": {
            "type": "string",
            "description": "查詢月份，格式 YYYY-MM。省略則預設為當月第一天。",
        },
    },
})
async def get_asset_allocation(args: dict[str, Any], user_id: int, current_user: User, db: AsyncSession) -> dict[str, Any]:
    """
    查詢使用者「資產配置」的實際比例 vs. 目標比例（來自資產再平衡策略設定），
    包含目前股票／債券／現金各佔投資組合的實際百分比（current_stock_pct /
    current_bond_pct / current_cash_pct）、使用者設定的目標百分比
    （target_stock_pct / target_bond_pct / target_cash_pct）、總投資組合市值、
    是否觸發再平衡提醒（is_triggered / trigger_direction），以及每檔證券／現金
    的明細（rebalance_items，含 actual_pct、target_pct、建議交易金額等）。
    當使用者詢問「資產配置」「現金／股票／債券佔比」「要不要再平衡」「離目標配置
    差多少」時使用此工具，這是使用者真正在意的資產配置資料來源，
    不要誤用 get_securities（只有個股明細，無配置比例）或
    get_balance_sheet（只有現金/證券/負債總額，無目標比例與再平衡建議）。
    """
    from src.services.rebalance.service import RebalanceService

    period = _parse_period(args.get("period"))
    service = RebalanceService(db, user_id)
    return await service.analyze_rebalance(target_date=period)


@tool(parameters={
    "type": "object",
    "properties": {
        "period": {"type": "string", "description": "查詢月份，格式 YYYY-MM。省略則回傳最新一期。"},
    },
})
async def get_income_statement(args: dict[str, Any], user_id: int, current_user: User, db: AsyncSession) -> dict[str, Any]:
    """
    查詢使用者某個月份（或最新一期）已計算好的損益表總覽，包含總收入、薪資收入、
    投資收益、其他收入、總支出、信用卡支出、銀行支出、淨儲蓄。
    當使用者詢問「這個月收入／支出／存了多少錢」、「損益表」時使用，
    比自己用 get_transactions 加總更準確、更快。
    """
    repo = IncomeStatementRepository(db, user_id)
    period = _parse_period(args.get("period"))
    all_statements = await repo.list_all()
    if period:
        match = next((s for s in all_statements if s.period_date == period), None)
        return {"income_statement": _serialize_income_statement(match) if match else None}
    return {"income_statement": _serialize_income_statement(all_statements[0]) if all_statements else None}


@tool(parameters={
    "type": "object",
    "properties": {
        "include_cancelled": {"type": "boolean", "description": "是否包含已取消的提醒，預設 false。"},
    },
})
async def get_price_alerts(args: dict[str, Any], user_id: int, current_user: User, db: AsyncSession) -> dict[str, Any]:
    """
    列出使用者目前監控中的到價提醒／到價自動下單設定，包含股票代號、方向、目標價、
    股數、券商、狀態。當使用者詢問「我設定了哪些到價提醒／監控」、要修改或取消某筆提醒
    但不知道 alert_id 時，先呼叫此工具找出對應的 alert_id。預設不包含已取消的提醒。
    """
    repo = PriceAlertRepository(db, user_id)
    alerts = await repo.list_all(include_cancelled=bool(args.get("include_cancelled", False)))
    return {"price_alerts": [_serialize_price_alert(a) for a in alerts]}


# ── Write tools ─────────────────────────────────────────────────────────────

@tool(parameters={
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
})
async def create_transaction(args: dict[str, Any], user_id: int, current_user: User, db: AsyncSession) -> dict[str, Any]:
    """新增一筆交易紀錄（收入或支出）。"""
    from src.controllers.transactions.api import create_transaction as _create_transaction

    body = CreateTransactionRequest(
        date=args["date"],
        description=args["description"],
        amount=args["amount"],
        category=args["category"],
        merchant=args.get("merchant"),
        account_id=args.get("account_id"),
    )
    return await _create_transaction(body=body, db=db, current_user=current_user)


@tool(parameters={
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
})
async def update_transaction(args: dict[str, Any], user_id: int, current_user: User, db: AsyncSession) -> dict[str, Any]:
    """更新一筆既有交易紀錄的欄位。"""
    from src.controllers.transactions.api import update_transaction as _update_transaction

    body = UpdateTransactionRequest(
        date=args.get("date"),
        merchant=args.get("merchant"),
        description=args.get("description"),
        amount=args.get("amount"),
        category=args.get("category"),
    )
    return await _update_transaction(txn_id=args["txn_id"], body=body, db=db, current_user=current_user)


@tool(parameters={
    "type": "object",
    "properties": {"txn_id": {"type": "integer"}},
    "required": ["txn_id"],
})
async def delete_transaction(args: dict[str, Any], user_id: int, current_user: User, db: AsyncSession) -> dict[str, Any]:
    """刪除一筆交易紀錄。"""
    from src.controllers.transactions.api import delete_transaction as _delete_transaction

    return await _delete_transaction(txn_id=args["txn_id"], db=db, current_user=current_user)


@tool(parameters={
    "type": "object",
    "properties": {"ids": {"type": "array", "items": {"type": "integer"}}},
    "required": ["ids"],
})
async def bulk_delete_transactions(args: dict[str, Any], user_id: int, current_user: User, db: AsyncSession) -> dict[str, Any]:
    """批次刪除多筆交易紀錄。"""
    from src.controllers.transactions.api import bulk_delete_transactions as _bulk_delete_transactions

    return await _bulk_delete_transactions(body=BulkDeleteRequest(ids=args["ids"]), db=db, current_user=current_user)


@tool(
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
    confirmation_required=True,
)
async def create_price_alert(args: dict[str, Any], user_id: int, current_user: User, db: AsyncSession) -> dict[str, Any]:
    """
    建立到價自動下單監控（會透過券商 API 自動送出限價委託單，屬於重要決定，
    呼叫此工具前一定要先跟使用者確認股票代號、方向、目標價、股數、券商是否正確）。
    """
    from src.controllers.price_alerts.api import create_price_alert as _create_price_alert

    body = CreatePriceAlertRequest(
        ticker=args["ticker"],
        name=args.get("name"),
        alert_type="auto_trade",
        side=args["side"],
        quantity=args["quantity"],
        broker=args.get("broker", "esun"),
        target_price=args["target_price"],
    )
    return await _create_price_alert(body=body, db=db, current_user=current_user)


@tool(parameters={
    "type": "object",
    "properties": {"alert_id": {"type": "integer"}},
    "required": ["alert_id"],
})
async def cancel_price_alert(args: dict[str, Any], user_id: int, current_user: User, db: AsyncSession) -> dict[str, Any]:
    """取消一筆監控中的到價提醒或到價自動下單。"""
    from src.controllers.price_alerts.api import cancel_price_alert as _cancel_price_alert

    return await _cancel_price_alert(alert_id=args["alert_id"], db=db, current_user=current_user)


# ── Derived from registry ───────────────────────────────────────────────────

FUNCTION_DECLARATIONS = [
    types.FunctionDeclaration(name=spec.name, description=spec.description, parameters=spec.parameters)
    for spec in _REGISTRY.values()
]

CONFIRMATION_REQUIRED: set[str] = {name for name, spec in _REGISTRY.items() if spec.confirmation_required}


async def execute_tool_call(name: str, args: dict[str, Any], user_id: int, current_user: User, db: AsyncSession) -> dict[str, Any]:
    """Executes a registered tool call by looking it up in the registry."""
    spec = _REGISTRY.get(name)
    if not spec:
        raise ValueError(f"Unknown tool: {name}")
    return await spec.func(args, user_id, current_user, db)

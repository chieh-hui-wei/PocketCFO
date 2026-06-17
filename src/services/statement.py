"""
src/services/statement_service.py
Orchestrates PDF upload → Gemini parsing → DB persistence.
Handles bank statements, credit card bills, and brokerage statements.
"""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path
from typing import Any

import logging
from sqlalchemy.ext.asyncio import AsyncSession

from src.dbs.models import (
    Account,
    AccountSnapshot,
    AccountType,
    Security,
    Transaction,
    TransactionCategory,
    TransactionSource,
)
from src.dbs.repository import (
    AccountRepository,
    SecurityRepository,
    SnapshotRepository,
    TransactionRepository,
)
from src.instances.config import get_settings
from src.services.parsers.bank_statement_parser import (
    parse_bank_statement,
    parse_brokerage_statement,
    parse_credit_card_statement,
    parse_einvoice_statement,
)
from src.services.parsers.firstrade_statement_parser import parse_firstrade_statement
from src.services.exchange_rate import get_usd_twd_rate
from src.utils.date_utils import first_of_month, parse_tw_date_robust
from src.utils.stock_utils import normalize_stock_name, normalize_transaction_description
from src.utils.transfer_detector import TransferDetector

log = logging.getLogger(__name__)
settings = get_settings()


class StatementService:
    def __init__(self, db: AsyncSession, user_id: int) -> None:
        self.db = db
        self.user_id = user_id
        self.account_repo = AccountRepository(db, user_id)
        self.snapshot_repo = SnapshotRepository(db, user_id)
        self.security_repo = SecurityRepository(db, user_id)
        self.txn_repo = TransactionRepository(db, user_id)
        self.transfer_detector = None

    # ── Bank statement ─────────────────────────────────────────────────────

    async def ingest_bank_statement(
        self, pdf_path: Path, account_code: str | None = None, upload_history_id: int | None = None
    ) -> dict[str, Any]:
        """
        Parse a bank statement PDF and save.
        """
        log.info(f"ingest.bank_statement.start path={pdf_path}")
        data = await parse_bank_statement(pdf_path)
        if account_code:
            data["account_code"] = account_code
        return await self.save_bank_statement(data, upload_history_id)

    async def save_bank_statement(
        self, data: dict[str, Any], upload_history_id: int | None = None
    ) -> dict[str, Any]:
        import re
        period = first_of_month(data["period_year"], data["period_month"])
        account_code = data.get("account_code")
        acc_num = data.get("account_number")
        if not account_code:
            inst = data.get("institution", "unknown").strip()
            if acc_num:
                acc_num_clean = re.sub(r'[^A-Za-z0-9]', '', str(acc_num))
                account_code = f"bank_{inst}_{acc_num_clean}"
            else:
                account_code = f"bank_{inst}"

        display_name = data.get("institution", "Unknown Bank")
        if acc_num:
            display_name = f"{display_name} ({acc_num})"

        account = await self._resolve_or_create_account(
            code=account_code,
            name=display_name,
            account_type=AccountType.BANK,
            institution=data.get("institution", ""),
        )

        # Fallback to last transaction's balance if closing_balance is missing
        closing_balance = float(data.get("closing_balance") or 0)
        raw_txns = data.get("transactions", [])
        if closing_balance == 0 and raw_txns:
            # Try to get balance from the last transaction
            last_txn_balance = raw_txns[-1].get("balance")
            if last_txn_balance is not None:
                closing_balance = float(last_txn_balance)

        # Save snapshot
        snapshot = AccountSnapshot(
            account_id=account.id,
            period_date=period,
            balance=closing_balance,
            source="pdf",
            raw_data=json.dumps(data, ensure_ascii=False),
            upload_history_id=upload_history_id,
        )
        await self.snapshot_repo.upsert(snapshot)

        # Dynamically build internal accounts transfer detector from database
        db_accounts = await self.account_repo.get_all()
        internal_aids = []
        for a in db_accounts:
            if a.is_internal:
                internal_aids.append(a.code)
                if "_" in a.code:
                    internal_aids.append(a.code.split("_")[-1])
                if a.notes:
                    internal_aids.append(a.notes)
        self.transfer_detector = TransferDetector(list(set(internal_aids)))

        # Save transactions with transfer detection
        txns = []
        for raw in raw_txns:
            if "amount" in raw:
                amount = float(raw["amount"])
            else:
                amount = float(raw.get("credit") or 0) - float(raw.get("debit") or 0)
            is_transfer = self.transfer_detector.is_internal_transfer(raw.get("description", ""))
            is_taishin = "台新" in (account.institution or "")
            is_salary = is_taishin and amount >= 60000
            
            cat_str = raw.get("category")
            if cat_str:
                reverse_cat = {
                    "薪資": "salary",
                    "投資": "investment",
                    "轉入": "transfer_in",
                    "轉出": "transfer_out",
                    "支出": "expense",
                    "股利": "dividend",
                    "利息": "interest",
                    "其他": "other",
                    "帳內互轉": "transfer_in"
                }
                cat_val = reverse_cat.get(cat_str, cat_str)
                try:
                    category = TransactionCategory(cat_val)
                except ValueError:
                    category = TransactionCategory.OTHER
            else:
                category = (
                    TransactionCategory.TRANSFER_IN
                    if is_transfer and amount > 0
                    else TransactionCategory.TRANSFER_OUT
                    if is_transfer and amount < 0
                    else TransactionCategory.SALARY
                    if amount > 0 and is_salary
                    else TransactionCategory.OTHER
                )
            
            txn_date = raw.get("date")
            if isinstance(txn_date, str):
                from datetime import datetime
                try:
                    actual_date = datetime.strptime(txn_date, "%Y-%m-%d").date()
                except ValueError:
                    actual_date = parse_tw_date_robust(txn_date) or period
            else:
                actual_date = parse_tw_date_robust(raw.get("date")) or period

            txns.append(
                Transaction(
                    account_id=account.id,
                    txn_date=actual_date,
                    source=TransactionSource.BANK,
                    category=category,
                    description=raw.get("description", ""),
                    amount=amount,
                    balance_after=float(raw.get("balance") or 0) if raw.get("balance") else None,
                    is_internal_transfer=is_transfer,
                    upload_history_id=upload_history_id,
                )
            )
        await self.txn_repo.bulk_insert(txns)

        log.info(f"save.bank_statement.done txns={len(txns)} period={period}")
        return {
            "account_id": account.id,
            "period": str(period),
            "transactions": [
                {
                    "date": str(t.txn_date),
                    "description": t.description,
                    "amount": t.amount,
                    "balance": t.balance_after,
                    "category": t.category.value if hasattr(t.category, "value") else str(t.category),
                } for t in txns
            ]
        }

    # ── Credit card statement ──────────────────────────────────────────────

    async def ingest_credit_card_statement(
        self, pdf_path: Path, account_code: str | None = None, upload_history_id: int | None = None
    ) -> dict[str, Any]:
        """Parse a credit card statement PDF and save bill + line items."""
        log.info(f"ingest.credit_card.start path={pdf_path}")
        data = await parse_credit_card_statement(pdf_path)
        if account_code:
            data["account_code"] = account_code
        return await self.save_credit_card_statement(data, upload_history_id)

    async def save_credit_card_statement(
        self, data: dict[str, Any], upload_history_id: int | None = None
    ) -> dict[str, Any]:
        period = first_of_month(data["period_year"], data["period_month"])
        card_name = f"{data.get('institution', 'Card')} ****{data.get('card_last_four', '0000')}"
        account_code = data.get("account_code")
        account = await self._resolve_or_create_account(
            code=account_code or f"cc_{data.get('card_last_four', 'xxxx')}",
            name=card_name,
            account_type=AccountType.CREDIT_CARD,
            institution=data.get("institution", ""),
        )

        payment_due = data.get("payment_due_date")
        payment_due_date = None
        if payment_due:
            if isinstance(payment_due, str):
                from datetime import datetime
                try:
                    payment_due_date = datetime.strptime(payment_due, "%Y-%m-%d").date()
                except ValueError:
                    payment_due_date = parse_tw_date_robust(payment_due)
            else:
                payment_due_date = parse_tw_date_robust(payment_due)

        # Save snapshot
        snapshot = AccountSnapshot(
            account_id=account.id,
            period_date=period,
            balance=-float(data.get("total_amount") or 0),
            payment_due_date=payment_due_date,
            source="pdf",
            raw_data=json.dumps(data, ensure_ascii=False),
            upload_history_id=upload_history_id,
        )
        await self.snapshot_repo.upsert(snapshot)

        # Save transactions
        txns = []
        raw_items = data.get("items") or data.get("transactions") or []
        for item in raw_items:
            amt_orig = float(item.get("amount") or 0)
            amount = -abs(amt_orig) if amt_orig > 0 else amt_orig
            
            txn_date = item.get("date")
            if isinstance(txn_date, str):
                from datetime import datetime
                try:
                    actual_date = datetime.strptime(txn_date, "%Y-%m-%d").date()
                except ValueError:
                    actual_date = parse_tw_date_robust(txn_date) or period
            else:
                actual_date = parse_tw_date_robust(item.get("date")) or period

            txns.append(
                Transaction(
                    account_id=account.id,
                    txn_date=actual_date,
                    merchant=item.get("merchant") or item.get("description") or "",
                    description=item.get("description") or item.get("merchant") or "",
                    amount=amount,
                    balance_after=None,
                    category=TransactionCategory.EXPENSE,
                    is_internal_transfer=False,
                    is_refund=bool(item.get("is_refund", False)),
                    raw_data=json.dumps(item, ensure_ascii=False),
                    source=TransactionSource.CREDIT_CARD,
                    payment_method=item.get("payment_method"),
                    invoice_number=None,
                    upload_history_id=upload_history_id,
                )
            )
        await self.txn_repo.bulk_insert(txns)
        await self.deduplicate_period(period)

        log.info(f"save.credit_card.done txns={len(txns)} period={period}")
        return {
            "account_id": account.id,
            "period": str(period),
            "total_amount": float(data.get("total_amount", 0)),
            "payment_due_date": str(payment_due_date) if payment_due_date else None,
            "transactions": [
                {
                    "date": str(t.txn_date),
                    "merchant": t.merchant,
                    "description": t.description,
                    "amount": t.amount,
                    "is_refund": t.is_refund,
                } for t in txns
            ]
        }

    # ── Brokerage statement ────────────────────────────────────────────────

    async def ingest_brokerage_statement(
        self, pdf_path: Path, account_code: str | None = None, upload_history_id: int | None = None, filename: str = ""
    ) -> dict[str, Any]:
        """Parse a brokerage statement PDF and save holdings + cash snapshot."""
        log.info(f"ingest.brokerage.start path={pdf_path} filename={filename}")
        
        is_firstrade = "firstrade" in filename.lower()
        if is_firstrade:
            data = await parse_firstrade_statement(pdf_path)
        else:
            data = await parse_brokerage_statement(pdf_path)
        if account_code:
            data["account_code"] = account_code
        return await self.save_brokerage_statement(data, upload_history_id)

    async def save_brokerage_statement(
        self, data: dict[str, Any], upload_history_id: int | None = None
    ) -> dict[str, Any]:
        currency = data.get("currency", "TWD")
        exchange_rate = float(data.get("exchange_rate", 1.0))

        import re
        period = first_of_month(data["period_year"], data["period_month"])
        account_code = data.get("account_code")
        acc_num = data.get("account_number")
        if not account_code:
            inst = data.get("institution", "unknown").strip()
            if acc_num:
                acc_num_clean = re.sub(r'[^A-Za-z0-9]', '', str(acc_num))
                account_code = f"broker_{inst}_{acc_num_clean}"
            else:
                account_code = f"broker_{inst}"

        display_name = data.get("institution", "Unknown Broker")
        if acc_num:
            display_name = f"{display_name} ({acc_num})"

        account = await self._resolve_or_create_account(
            code=account_code,
            name=display_name,
            account_type=AccountType.BROKERAGE,
            institution=data.get("institution", ""),
            currency=currency,
        )

        total_market_value = float(data.get("total_market_value") or 0)
        cash_balance = float(data.get("cash_balance") or 0)
        balance_orig = total_market_value + cash_balance
        
        # Save snapshot
        snapshot = AccountSnapshot(
            account_id=account.id,
            period_date=period,
            balance=round(balance_orig * exchange_rate),
            original_balance=balance_orig if currency != "TWD" else None,
            currency=currency,
            exchange_rate=exchange_rate,
            source="pdf",
            raw_data=json.dumps(data, ensure_ascii=False),
            upload_history_id=upload_history_id,
        )
        await self.snapshot_repo.upsert(snapshot)

        # Holdings / Securities
        securities = []
        for h in data.get("holdings", []):
            securities.append(
                Security(
                    account_id=account.id,
                    period_date=period,
                    ticker=h.get("ticker") or h.get("name") or "Unknown",
                    name=normalize_stock_name(h.get("ticker"), h.get("name") or ""),
                    quantity=float(h.get("quantity") or 0),
                    avg_cost=round(float(h.get("avg_cost") or 0) * exchange_rate),
                    current_price=round(float(h.get("current_price") or 0) * exchange_rate),
                    market_value=round(float(h.get("market_value") or 0) * exchange_rate),
                    unrealized_pnl=round(float(h.get("unrealized_pnl") or 0) * exchange_rate),
                    original_avg_cost=float(h.get("avg_cost") or 0) if currency != "TWD" else None,
                    original_current_price=float(h.get("current_price") or 0) if currency != "TWD" else None,
                    original_market_value=float(h.get("market_value") or 0) if currency != "TWD" else None,
                    original_unrealized_pnl=float(h.get("unrealized_pnl") or 0) if currency != "TWD" else None,
                    currency=currency,
                    exchange_rate=exchange_rate,
                    upload_history_id=upload_history_id,
                )
            )

        # Fallback if no holdings
        if not securities and balance_orig > 0:
            securities.append(
                Security(
                    account_id=account.id,
                    period_date=period,
                    ticker="N/A",
                    name=f"{account.name} 總部位",
                    quantity=1,
                    avg_cost=round(total_market_value * exchange_rate),
                    current_price=round(total_market_value * exchange_rate),
                    market_value=round(total_market_value * exchange_rate),
                    unrealized_pnl=0,
                    original_avg_cost=total_market_value if currency != "TWD" else None,
                    original_current_price=total_market_value if currency != "TWD" else None,
                    original_market_value=total_market_value if currency != "TWD" else None,
                    original_unrealized_pnl=0 if currency != "TWD" else None,
                    currency=currency,
                    exchange_rate=exchange_rate,
                )
            )

        await self.security_repo.upsert_many(securities)

        # Transactions
        txns = []
        for t in data.get("transactions", []):
            action = t.get("action") or ""
            amt_orig = float(t.get("amount") or 0)
            if "買" in action or action.upper() == "BUY":
                amt_orig = -abs(amt_orig)
            elif "賣" in action or action.upper() == "SELL" or action.upper() == "DIVIDEND" or action.upper() == "INTEREST":
                amt_orig = abs(amt_orig)
            elif action.upper() == "TAX":
                amt_orig = -abs(amt_orig)
            else:
                amt_orig = abs(amt_orig)

            amt = round(amt_orig * exchange_rate)
            ticker = t.get("ticker")
            ticker_str = f" ({ticker})" if ticker else ""
            desc = f"{action} {t.get('name', '')}{ticker_str}"
            fee_orig = float(t.get("fee") or 0)
            if fee_orig > 0:
                desc += f" (含手續費/稅: {fee_orig})"

            category = TransactionCategory.INVESTMENT
            if action.upper() == "DIVIDEND":
                category = TransactionCategory.DIVIDEND
            elif action.upper() == "INTEREST":
                category = TransactionCategory.INTEREST
            elif action.upper() == "TAX":
                category = TransactionCategory.EXPENSE

            txn_date = t.get("date")
            if isinstance(txn_date, str):
                from datetime import datetime
                try:
                    actual_date = datetime.strptime(txn_date, "%Y-%m-%d").date()
                except ValueError:
                    actual_date = parse_tw_date_robust(txn_date) or period
            else:
                actual_date = parse_tw_date_robust(t.get("date")) or period

            txns.append(
                Transaction(
                    account_id=account.id,
                    txn_date=actual_date,
                    merchant="Brokerage Trade",
                    description=normalize_transaction_description(desc.strip()),
                    amount=amt,
                    original_amount=amt_orig if currency != "TWD" else None,
                    currency=currency,
                    exchange_rate=exchange_rate,
                    balance_after=None,
                    category=category,
                    is_internal_transfer=False,
                    source=TransactionSource.BROKERAGE,
                    raw_data=json.dumps(t, ensure_ascii=False),
                    upload_history_id=upload_history_id
                )
            )
        if txns:
            await self.txn_repo.bulk_insert(txns)

        log.info(f"save.brokerage.done holdings={len(securities)} txns={len(txns)} period={period}")
        return {
            "account_id": account.id,
            "period": str(period),
            "cash_balance": float(data.get("cash_balance") or 0),
            "total_market_value": snapshot.balance,
            "transactions": [
                {
                    "date": str(t.txn_date),
                    "amount": t.amount,
                    "description": t.description
                } for t in txns
            ],
            "holdings": [
                {
                    "ticker": s.ticker,
                    "name": s.name,
                    "quantity": s.quantity,
                    "avg_cost": s.avg_cost,
                    "current_price": s.current_price,
                    "market_value": s.market_value,
                    "unrealized_pnl": s.unrealized_pnl,
                } for s in securities
            ]
        }

    # ── E-Invoice Ingestion & Deduplication ────────────────────────────────
    
    async def ingest_einvoice(self, pdf_path: Path, upload_history_id: int | None = None) -> dict[str, Any]:
        """Parse an electronic invoice PDF and save items, flagging duplicates."""
        log.info(f"ingest.einvoice.start path={pdf_path}")
        data = await parse_einvoice_statement(pdf_path)
        return await self.save_einvoice_statement(data, upload_history_id)

    async def save_einvoice_statement(
        self, data: dict[str, Any], upload_history_id: int | None = None
    ) -> dict[str, Any]:
        period = first_of_month(data["period_year"], data["period_month"])

        txns = []
        raw_items = data.get("items") or data.get("transactions") or []
        for item in raw_items:
            txn_date = item.get("date")
            if isinstance(txn_date, str):
                from datetime import datetime
                try:
                    actual_date = datetime.strptime(txn_date, "%Y-%m-%d").date()
                except ValueError:
                    actual_date = parse_tw_date_robust(txn_date) or period
            else:
                actual_date = parse_tw_date_robust(item.get("date")) or period

            txns.append(
                Transaction(
                    account_id=None,
                    txn_date=actual_date,
                    merchant=item.get("merchant", ""),
                    description=item.get("description", ""),
                    amount=-float(item.get("amount") or 0),
                    balance_after=None,
                    category=TransactionCategory.EXPENSE,
                    is_internal_transfer=False,
                    is_refund=False,
                    raw_data=json.dumps(item, ensure_ascii=False),
                    source=TransactionSource.E_INVOICE,
                    payment_method=item.get("payment_method", "其他"),
                    invoice_number=item.get("invoice_number"),
                    is_duplicate=False,
                    upload_history_id=upload_history_id,
                )
            )

        await self.txn_repo.bulk_insert(txns)
        await self.deduplicate_period(period)

        log.info(f"save.einvoice.done items={len(txns)} period={period}")
        return {
            "period": str(period),
            "items": [
                {
                    "date": str(t.txn_date),
                    "merchant": t.merchant,
                    "description": t.description,
                    "amount": t.amount,
                    "payment_method": t.payment_method,
                    "invoice_number": t.invoice_number,
                } for t in txns
            ]
        }

    async def deduplicate_period(self, period_date: date) -> None:
        """Flags e-invoice transactions that overlap with credit card transactions."""
        cc_txns = await self.txn_repo.get_by_period_and_source(period_date, TransactionSource.CREDIT_CARD)
        einvoice_txns = await self.txn_repo.get_by_period_and_source(period_date, TransactionSource.E_INVOICE)

        matched_cc_ids = set()
        einvoice_dup_ids: list[int] = []

        for e in einvoice_txns:
            for c in cc_txns:
                if c.id in matched_cc_ids:
                    continue
                if abs((c.txn_date - e.txn_date).days) <= 1 and abs(c.amount - e.amount) < 0.01:
                    matched_cc_ids.add(c.id)
                    einvoice_dup_ids.append(e.id)
                    log.info(f"einvoice.deduplicate.match einvoice_txn={e.id} cc_txn={c.id} amount={e.amount}")
                    break

        await self.txn_repo.mark_duplicates(einvoice_dup_ids, True)

    async def parse_statement(self, pdf_path: Path, kind: str, filename: str = "") -> dict[str, Any]:
        """
        Parse a PDF statement without saving it to the database.
        Returns the raw parsed data, injecting exchange rate and other common details.
        """
        log.info(f"parse_statement path={pdf_path} kind={kind} filename={filename}")
        if kind == "bank":
            data = await parse_bank_statement(pdf_path)
            data["kind"] = "bank"
        elif kind == "credit_card":
            data = await parse_credit_card_statement(pdf_path)
            data["kind"] = "credit_card"
        elif kind == "brokerage":
            is_firstrade = "firstrade" in filename.lower()
            if is_firstrade:
                data = await parse_firstrade_statement(pdf_path)
            else:
                data = await parse_brokerage_statement(pdf_path)
            data["kind"] = "brokerage"
            
            currency = data.get("currency", "TWD")
            exchange_rate = 1.0
            if currency == "USD":
                period = first_of_month(data["period_year"], data["period_month"])
                import calendar
                last_day = calendar.monthrange(period.year, period.month)[1]
                target_date = date(period.year, period.month, last_day)
                try:
                    exchange_rate = await get_usd_twd_rate(target_date)
                except Exception as e:
                    log.warning(f"Could not fetch exchange rate during parse phase: {e}")
                    exchange_rate = 32.5
            data["exchange_rate"] = exchange_rate
            data["currency"] = currency
        elif kind == "einvoice":
            data = await parse_einvoice_statement(pdf_path)
            data["kind"] = "einvoice"
        else:
            raise ValueError(f"Unknown kind: {kind}")
            
        return data

    async def save_parsed_statement(self, data: dict[str, Any], upload_history_id: int | None = None) -> dict[str, Any]:
        """
        Save parsed and verified data payload into database.
        """
        kind = data.get("kind")
        if not kind:
            raise ValueError("Data payload is missing 'kind'")
            
        if kind == "bank":
            return await self.save_bank_statement(data, upload_history_id)
        elif kind == "credit_card":
            return await self.save_credit_card_statement(data, upload_history_id)
        elif kind == "brokerage":
            return await self.save_brokerage_statement(data, upload_history_id)
        elif kind == "einvoice":
            return await self.save_einvoice_statement(data, upload_history_id)
        else:
            raise ValueError(f"Unsupported kind for saving: {kind}")

    # ── Helpers ────────────────────────────────────────────────────────────

    async def _resolve_or_create_account(
        self,
        code: str,
        name: str,
        account_type: AccountType,
        institution: str,
        currency: str = "TWD",
    ) -> Account:
        account = await self.account_repo.get_by_code(code)
        if not account:
            account = await self.account_repo.create(
                Account(
                    code=code, name=name, account_type=account_type, institution=institution, currency=currency
                )
            )
            log.info(f"account.created id={account.id} code={code} currency={currency}")
        elif account.currency != currency:
            account.currency = currency
            self.db.add(account)
            await self.db.flush()
            log.info(f"account.updated id={account.id} code={code} set currency={currency}")
        return account


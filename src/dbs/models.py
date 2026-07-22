"""
src/dbs/models.py
SQLAlchemy ORM models for pocketCFO.

Tables:
  accounts          – bank / brokerage accounts
  account_snapshots – monthly balance snapshots (feeds balance sheet)
  securities        – individual holdings per account per month
  transactions      – raw transactions from bank statements
  credit_card_bills – monthly credit card statement summaries
  credit_card_items – line items within each bill
  balance_sheets    – computed monthly balance sheet header
  income_statements – computed monthly income statement header
"""

from __future__ import annotations

import enum
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.instances.database import Base

# ── Enums ──────────────────────────────────────────────────────────────────────


class AccountType(str, enum.Enum):
    BANK = "bank"
    BROKERAGE = "brokerage"
    CREDIT_CARD = "credit_card"
    LIABILITY = "liability"


class StatementType(str, enum.Enum):
    BANK = "bank"
    CREDIT_CARD = "credit_card"
    BROKERAGE = "brokerage"


class TransactionCategory(str, enum.Enum):
    SALARY = "SALARY"
    INVESTMENT = "INVESTMENT"
    TRANSFER_IN = "TRANSFER_IN"
    TRANSFER_OUT = "TRANSFER_OUT"
    EXPENSE = "EXPENSE"       # generic expense (bank transfers, etc.)
    FOOD = "FOOD"             # restaurants, supermarkets, convenience stores
    TRANSPORT = "TRANSPORT"   # gas stations, ride-hailing, MRT, trains
    MEDICAL = "MEDICAL"       # hospitals, clinics, pharmacies
    ENTERTAINMENT = "ENTERTAINMENT"  # streaming, cinemas, KTV, gaming
    INSURANCE = "INSURANCE"          # health, life, auto, annual premiums
    EXERCISE = "EXERCISE"            # gym, sports equipment, fitness classes
    SHOPPING = "SHOPPING"            # shopping, clothes, electronics, luxury, non-essential goods
    CREDIT_CARD_PAYMENT = "CREDIT_CARD_PAYMENT" # paying off credit card balance
    DEBT_REPAYMENT = "DEBT_REPAYMENT"           # paying off loan principal
    DIVIDEND = "DIVIDEND"
    INTEREST = "INTEREST"
    TRAVEL = "TRAVEL"
    STUDY = "STUDY"
    OTHER = "OTHER"


class TransactionSource(str, enum.Enum):
    BANK = "bank"
    CREDIT_CARD = "credit_card"
    E_INVOICE = "e_invoice"
    BROKERAGE = "brokerage"


# ── User & Auth ────────────────────────────────────────────────────────────────

class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(32), default="user", nullable=False)  # "admin" | "user"
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class UserInvitation(Base):
    __tablename__ = "user_invitations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    pin_code: Mapped[str] = mapped_column(String(6), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class PasswordReset(Base):
    __tablename__ = "password_resets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    pin_code: Mapped[str] = mapped_column(String(6), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    is_used: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())



# ── Account ────────────────────────────────────────────────────────────────────


class Account(Base):
    __tablename__ = "accounts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    code: Mapped[str] = mapped_column(
        String(64), unique=True, nullable=False
    )  # e.g. "sinopac_stock"
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    account_type: Mapped[AccountType] = mapped_column(Enum(AccountType), nullable=False)
    institution: Mapped[str] = mapped_column(
        String(128), nullable=False
    )  # 永豐金, 台新
    currency: Mapped[str] = mapped_column(String(8), default="TWD")
    is_internal: Mapped[bool] = mapped_column(
        Boolean, default=True
    )  # user-owned → transfers excluded
    notes: Mapped[str | None] = mapped_column(Text)
    is_installment: Mapped[bool] = mapped_column(Boolean, default=False)
    installment_amount: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    snapshots: Mapped[list["AccountSnapshot"]] = relationship(back_populates="account")
    securities: Mapped[list["Security"]] = relationship(back_populates="account")
    transactions: Mapped[list["Transaction"]] = relationship(
        back_populates="account", foreign_keys="[Transaction.account_id]"
    )


# ── Monthly balance snapshot ───────────────────────────────────────────────────


class AccountSnapshot(Base):
    """One record per account per month — cash balance at month-end."""

    __tablename__ = "account_snapshots"
    __table_args__ = (UniqueConstraint("account_id", "period_date"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), nullable=False, index=True)
    period_date: Mapped[date] = mapped_column(
        Date, nullable=False, index=True
    )  # always 1st of month
    balance: Mapped[float] = mapped_column(Float, nullable=False)
    original_balance: Mapped[float | None] = mapped_column(Float)
    currency: Mapped[str] = mapped_column(String(8), default="TWD")
    exchange_rate: Mapped[float] = mapped_column(Float, default=1.0)
    payment_due_date: Mapped[date | None] = mapped_column(Date)
    source: Mapped[str] = mapped_column(String(32), default="pdf")  # pdf | api
    raw_data: Mapped[str | None] = mapped_column(Text)  # JSON blob from Gemini
    upload_history_id: Mapped[int | None] = mapped_column(ForeignKey("upload_histories.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    account: Mapped["Account"] = relationship(back_populates="snapshots")

# ── Security holdings ──────────────────────────────────────────────────────────


class Security(Base):
    """Stock / ETF position per account per month."""

    __tablename__ = "securities"
    __table_args__ = (UniqueConstraint("account_id", "period_date", "ticker"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), nullable=False, index=True)
    period_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    ticker: Mapped[str] = mapped_column(String(16), nullable=False)
    name: Mapped[str] = mapped_column(String(128))
    quantity: Mapped[float] = mapped_column(Float, nullable=False)
    avg_cost: Mapped[float] = mapped_column(Float)  # 平均成本
    current_price: Mapped[float] = mapped_column(Float)  # 收盤價
    market_value: Mapped[float] = mapped_column(Float)  # 市值
    unrealized_pnl: Mapped[float] = mapped_column(Float, default=0.0)
    original_avg_cost: Mapped[float | None] = mapped_column(Float)
    original_current_price: Mapped[float | None] = mapped_column(Float)
    original_market_value: Mapped[float | None] = mapped_column(Float)
    original_unrealized_pnl: Mapped[float | None] = mapped_column(Float)
    currency: Mapped[str] = mapped_column(String(8), default="TWD")
    exchange_rate: Mapped[float] = mapped_column(Float, default=1.0)
    upload_history_id: Mapped[int | None] = mapped_column(ForeignKey("upload_histories.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    account: Mapped["Account"] = relationship(back_populates="securities")


# ── Bank transactions ──────────────────────────────────────────────────────────


class Transaction(Base):
    """Individual debit/credit from bank statement."""

    __tablename__ = "transactions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    account_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"), index=True)
    txn_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    source: Mapped[TransactionSource] = mapped_column(
        Enum(TransactionSource), default=TransactionSource.BANK, nullable=False
    )
    merchant: Mapped[str | None] = mapped_column(String(256))
    description: Mapped[str] = mapped_column(String(256))
    amount: Mapped[float] = mapped_column(
        Float, nullable=False
    )  # positive=credit, negative=debit
    original_amount: Mapped[float | None] = mapped_column(Float)
    currency: Mapped[str] = mapped_column(String(8), default="TWD")
    exchange_rate: Mapped[float] = mapped_column(Float, default=1.0)
    balance_after: Mapped[float | None] = mapped_column(Float)
    category: Mapped[TransactionCategory] = mapped_column(
        Enum(TransactionCategory), default=TransactionCategory.OTHER
    )
    is_internal_transfer: Mapped[bool] = mapped_column(Boolean, default=False)
    is_refund: Mapped[bool] = mapped_column(Boolean, default=False)
    is_duplicate: Mapped[bool] = mapped_column(Boolean, default=False)
    payment_method: Mapped[str | None] = mapped_column(String(64))
    invoice_number: Mapped[str | None] = mapped_column(String(32))
    counterpart_account_id: Mapped[int | None] = mapped_column(
        ForeignKey("accounts.id")
    )
    raw_data: Mapped[str | None] = mapped_column(Text)
    upload_history_id: Mapped[int | None] = mapped_column(ForeignKey("upload_histories.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    account: Mapped["Account"] = relationship(
        back_populates="transactions", foreign_keys=[account_id]
    )


class BalanceSheet(Base):
    """Computed monthly balance sheet (assets = liabilities + equity)."""

    __tablename__ = "balance_sheets"
    __table_args__ = (UniqueConstraint("user_id", "period_date"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    period_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    total_cash: Mapped[float] = mapped_column(Float, default=0.0)
    total_securities_market_value: Mapped[float] = mapped_column(Float, default=0.0)
    total_assets: Mapped[float] = mapped_column(Float, default=0.0)
    total_credit_card_payable: Mapped[float] = mapped_column(Float, default=0.0)
    total_liabilities: Mapped[float] = mapped_column(Float, default=0.0)
    net_worth: Mapped[float] = mapped_column(Float, default=0.0)  # assets - liabilities
    computed_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    detail_json: Mapped[str | None] = mapped_column(Text)  # per-account breakdown


class IncomeStatement(Base):
    """Computed monthly income statement."""

    __tablename__ = "income_statements"
    __table_args__ = (UniqueConstraint("user_id", "period_date"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    period_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    total_income: Mapped[float] = mapped_column(Float, default=0.0)
    salary_income: Mapped[float] = mapped_column(Float, default=0.0)
    investment_income: Mapped[float] = mapped_column(Float, default=0.0)
    other_income: Mapped[float] = mapped_column(Float, default=0.0)
    total_expenses: Mapped[float] = mapped_column(Float, default=0.0)
    credit_card_expenses: Mapped[float] = mapped_column(Float, default=0.0)
    bank_expenses: Mapped[float] = mapped_column(Float, default=0.0)
    net_savings: Mapped[float] = mapped_column(Float, default=0.0)
    computed_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    detail_json: Mapped[str | None] = mapped_column(Text)
# ── Upload History ─────────────────────────────────────────────────────────────


class UploadHistory(Base):
    __tablename__ = "upload_histories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)  # 'success' or 'error'
    message: Mapped[str | None] = mapped_column(Text)
    file_hash: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


# ── Category Rules ─────────────────────────────────────────────────────────────


class CategoryRule(Base):
    """Per-user keyword → expense_category mapping used for auto-classification."""

    __tablename__ = "category_rules"
    __table_args__ = (UniqueConstraint("user_id", "keyword"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    keyword: Mapped[str] = mapped_column(String(128), nullable=False)  # e.g. "全聯", "uber"
    category: Mapped[str] = mapped_column(String(32), nullable=False)  # food/transport/medical/entertainment/salary/other
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


# ── Savings Pots ───────────────────────────────────────────────────────────────


class SavingsPot(Base):
    """Virtual savings bucket for earmarking specific sums from the total cash pool."""

    __tablename__ = "savings_pots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    target_amount: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    allocated_amount: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


# ── Portfolio Rebalance Strategy ───────────────────────────────────────────────


class RebalanceStrategy(Base):
    """User-specific portfolio rebalancing targets and distortion thresholds."""

    __tablename__ = "rebalance_strategies"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False, index=True)
    target_stock_pct: Mapped[float] = mapped_column(Float, nullable=False, default=50.0)
    target_bond_pct: Mapped[float] = mapped_column(Float, nullable=False, default=10.0)
    target_cash_pct: Mapped[float] = mapped_column(Float, nullable=False, default=40.0)
    stock_trigger_threshold: Mapped[float] = mapped_column(Float, nullable=False, default=60.0)  # Max upper bound
    stock_min_threshold: Mapped[float] = mapped_column(Float, nullable=False, default=40.0)      # Min lower bound
    bond_tickers: Mapped[str] = mapped_column(String(255), nullable=False, default="00931B,BND")
    custom_cash_amount: Mapped[float | None] = mapped_column(Float, nullable=True)  # Manual override for cash amount
    enable_email_alert: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    last_alert_sent_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


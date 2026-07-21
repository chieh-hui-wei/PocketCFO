"""
src/services/ai_assistant/service.py
Service layer for AI Assistant: Text-to-SQL planning, safe execution, and streaming responses.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any, AsyncGenerator

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from google.genai import types

from src.controllers.ai_assistant.model import ChatRequest, SQLPlannerResponse
from src.instances.config import get_settings
from src.instances.gemini import (
    generate_content_with_fallback,
    generate_content_stream_with_fallback,
)

log = logging.getLogger(__name__)
settings = get_settings()

DB_SCHEMA_PROMPT = """
You are pocketCFO SQL planner. Analyze the user's natural language question and generate a single PostgreSQL read-only query (SELECT/WITH) to answer the user's question, if data retrieval is needed.

Important Rules:
1. You MUST ONLY generate read-only SELECT or WITH queries. Mutating operations (INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE, etc.) are strictly forbidden.
2. Crucially, you must filter ALL queries by the current user's ID using the bind parameter `:user_id`. Ensure that data belonging to other users cannot be accessed.
3. Use correct table names and join on keys correctly.
4. Output a valid JSON response matching the required schema.

Database Schema:
- Table: `accounts` (User's bank/credit/liability accounts)
  - `id`: integer (primary key)
  - `user_id`: integer (foreign key to users)
  - `code`: string (unique code, e.g. "sinopac_stock", "richart_cash")
  - `name`: string (account display name)
  - `account_type`: Enum ('cash', 'bank', 'credit_card', 'investment', 'liability', 'asset', 'brokerage')
  - `institution`: string (e.g. "台新", "玉山證券")
  - `currency`: string (default "TWD")
  - `is_internal`: boolean (True if user-owned, exclude from external transfers)
  - `notes`: string/text (contains account number, custom notes)
  - `is_installment`: boolean
  - `installment_amount`: float
  - `created_at`: datetime

- Table: `account_snapshots` (Monthly cash balances)
  - `id`: integer (primary key)
  - `account_id`: integer (foreign key to accounts)
  - `period_date`: date (always 1st of month)
  - `balance`: float (cash balance at month-end)
  - `original_balance`: float
  - `currency`: string
  - `exchange_rate`: float (to TWD)
  - `payment_due_date`: date
  - Note: This table does not have user_id. You must JOIN with the `accounts` table and filter by `accounts.user_id = :user_id`.

- Table: `securities` (Monthly stock holdings)
  - `id`: integer (primary key)
  - `user_id`: integer
  - `account_id`: integer
  - `period_date`: date (always 1st of month)
  - `ticker`: string (e.g., stock code)
  - `name`: string
  - `quantity`: float
  - `avg_cost`: float
  - `current_price`: float
  - `market_value`: float
  - `unrealized_pnl`: float
  - `currency`: string
  - `exchange_rate`: float

- Table: `transactions` (Individual cash ledger entries)
  - `id`: integer (primary key)
  - `user_id`: integer
  - `account_id`: integer
  - `txn_date`: date
  - `merchant`: string
  - `description`: string
  - `amount`: float (positive = deposit/credit, negative = withdrawal/debit)
  - `category`: Enum (e.g., 'food', 'transportation', 'housing', 'utilities', 'entertainment', 'other')
  - `is_internal_transfer`: boolean

- Table: `balance_sheets` (Computed monthly balance sheet)
  - `id`: integer
  - `user_id`: integer
  - `period_date`: date
  - `total_cash`: float
  - `total_securities_market_value`: float
  - `total_assets`: float
  - `total_credit_card_payable`: float
  - `total_liabilities`: float
  - `net_worth`: float

- Table: `income_statements` (Computed monthly income statements)
  - `id`: integer
  - `user_id`: integer
  - `period_date`: date
  - `total_income`: float
  - `salary_income`: float
  - `investment_income`: float
  - `other_income`: float
  - `total_expenses`: float
  - `credit_card_expenses`: float
  - `bank_expenses`: float
  - `net_savings`: float

Example queries:
- To find total assets:
  `SELECT total_assets FROM balance_sheets WHERE user_id = :user_id ORDER BY period_date DESC LIMIT 1;`
- To find transactions list:
  `SELECT txn_date, description, amount FROM transactions WHERE user_id = :user_id ORDER BY txn_date DESC LIMIT 10;`
- To find bank accounts and balances:
  `SELECT a.name, s.balance FROM accounts a JOIN account_snapshots s ON a.id = s.account_id WHERE a.user_id = :user_id AND s.period_date = '2026-07-01';`
"""


def validate_safe_sql(query: str, require_user_id: bool = True) -> None:
    """
    Ensure the SQL query is read-only, does not contain mutating keywords,
    does not access sensitive tables, and enforces tenant scoping via :user_id.
    """
    cleaned = query.strip().lower()

    if not (cleaned.startswith("select") or cleaned.startswith("with")):
        raise ValueError("Only SELECT or WITH statements are allowed.")

    mutating_keywords = [
        "insert", "update", "delete", "drop", "alter",
        "truncate", "grant", "revoke", "create", "replace"
    ]
    for keyword in mutating_keywords:
        if re.search(r"\b" + keyword + r"\b", cleaned):
            raise ValueError(f"Forbidden mutating keyword detected: {keyword}")

    sensitive_tables = ["users", "user_invitations"]
    for table in sensitive_tables:
        if re.search(r"\b" + table + r"\b", cleaned):
            raise ValueError(f"Access to sensitive table '{table}' is forbidden.")

    if require_user_id and ":user_id" not in query:
        raise ValueError("Query must include ':user_id' parameter to ensure user data isolation.")


class AIAssistantService:
    @staticmethod
    async def process_chat_stream(
        request: ChatRequest,
        user_id: int,
        db: AsyncSession
    ) -> AsyncGenerator[str, None]:
        """
        Process chat prompt, execute read-only SQL if needed, and yield SSE formatted chunks.
        """
        requested_model = request.model or settings.gemini_model

        plan_prompt = f"{DB_SCHEMA_PROMPT}\n\nUser Question: {request.message}\n"
        
        plan_response, _ = await generate_content_with_fallback(
            contents=[plan_prompt],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=SQLPlannerResponse,
                temperature=0.0,
            ),
            primary_model=requested_model,
        )

        plan_data = json.loads(plan_response.text)
        needs_db = plan_data.get("needs_db", False)
        generated_sql = plan_data.get("sql")

        db_results_str = ""
        executed_sql = None

        if needs_db and generated_sql:
            try:
                validate_safe_sql(generated_sql, require_user_id=True)
                executed_sql = generated_sql

                result = await db.execute(text(generated_sql), {"user_id": user_id})
                columns = list(result.keys())
                rows = result.fetchall()

                formatted_rows = [
                    dict(zip(columns, [str(v) if v is not None else "None" for v in row]))
                    for row in rows
                ]
                db_results_str = json.dumps(formatted_rows, ensure_ascii=False, indent=2)
                log.info(f"Text-to-SQL Executed SQL: {generated_sql} | Results count: {len(rows)}")
            except Exception as sql_err:
                log.warning(f"SQL validation or execution failed: {sql_err}. Falling back to general chat.")
                db_results_str = f"Error executing database query: {str(sql_err)}"

        system_instruction = (
            "You are pocketCFO AI Assistant, a helpful personal finance assistant.\n"
            "Help the user track assets, liabilities, bank statements, and stock transactions.\n"
            "Keep responses concise, clear, and professional. Use markdown formatting where helpful."
        )

        final_prompt_parts = []
        if executed_sql:
            final_prompt_parts.append(f"[System context: The following read-only SQL was run against the user's database: {executed_sql}]")
            final_prompt_parts.append(f"[System context: Query results returned from database:\n{db_results_str}]")
        elif needs_db:
            final_prompt_parts.append(f"[System context: DB query failed: {db_results_str}]")

        final_prompt_parts.append(f"User Question: {request.message}")
        final_prompt = "\n\n".join(final_prompt_parts)

        contents = []
        for msg in request.history:
            role = "user" if msg.role == "user" else "model"
            contents.append(
                types.Content(role=role, parts=[types.Part.from_text(text=msg.content)])
            )

        contents.append(
            types.Content(role="user", parts=[types.Part.from_text(text=final_prompt)])
        )

        try:
            stream = generate_content_stream_with_fallback(
                contents=contents,
                config=types.GenerateContentConfig(
                    system_instruction=system_instruction,
                    temperature=0.7,
                ),
                primary_model=requested_model,
            )
            async for chunk, stream_model in stream:
                if chunk.text:
                    data = json.dumps({"text": chunk.text, "model": stream_model})
                    yield f"data: {data}\n\n"
        except Exception as stream_err:
            log.error(f"Error in streaming response generation: {stream_err}")
            err_data = json.dumps({"error": str(stream_err)})
            yield f"data: {err_data}\n\n"
        finally:
            yield "data: [DONE]\n\n"

    @staticmethod
    async def execute_raw_sql(
        query: str,
        user_id: int,
        db: AsyncSession
    ) -> dict[str, Any]:
        """
        Execute safe read-only SQL for developer console.
        """
        validate_safe_sql(query, require_user_id=True)
        result = await db.execute(text(query), {"user_id": user_id})
        columns = list(result.keys())
        rows = [
            [str(val) if val is not None else None for val in row]
            for row in result.fetchall()
        ]
        return {"columns": columns, "rows": rows}

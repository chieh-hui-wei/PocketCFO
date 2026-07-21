"""
src/controllers/ai_assistant.py
Controller for Gemini chat assistant and developer SQL console.
"""
from __future__ import annotations

import logging
import json
import re
from typing import Any, List, Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from src.instances.database import get_db
from src.instances.gemini import get_gemini_client
from src.instances.config import get_settings
from src.middleware.auth import verify_token
from src.dbs.models import User
from google.genai import types

log = logging.getLogger(__name__)
router = APIRouter()
settings = get_settings()

class ChatMessage(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    message: str
    history: List[ChatMessage] = []

class SQLRequest(BaseModel):
    query: str

class SQLPlannerResponse(BaseModel):
    needs_db: bool
    sql: Optional[str] = None
    reasoning: str

def validate_safe_sql(query: str) -> None:
    """
    Ensure the SQL query is read-only and does not contain mutating keywords.
    """
    cleaned = query.strip().lower()
    
    # 1. Strictly verify start of the statement
    if not (cleaned.startswith("select") or cleaned.startswith("with")):
        raise ValueError("Only SELECT or WITH statements are allowed.")
        
    # 2. Block mutating SQL keywords
    mutating_keywords = [
        "insert", "update", "delete", "drop", "alter", 
        "truncate", "grant", "revoke", "create", "replace"
    ]
    for keyword in mutating_keywords:
        if re.search(r"\b" + keyword + r"\b", cleaned):
            raise ValueError(f"Forbidden mutating keyword detected: {keyword}")


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

@router.post("/ai/chat")
async def chat_assistant(
    request: ChatRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(verify_token)
) -> dict[str, Any]:
    """
    Text-to-SQL chatbot endpoint. Checks if user question needs DB data,
    safely runs read-only SQL, and feeds results back to Gemini.
    """
    try:
        client = get_gemini_client()
        
        # 1. Ask Gemini to plan the query (needs_db, sql, reasoning)
        plan_prompt = (
            f"{DB_SCHEMA_PROMPT}\n\n"
            f"User Question: {request.message}\n"
        )
        
        plan_response = await client.aio.models.generate_content(
            model=settings.gemini_model,
            contents=[plan_prompt],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=SQLPlannerResponse,
                temperature=0.0,
            )
        )
        
        plan_data = json.loads(plan_response.text)
        needs_db = plan_data.get("needs_db", False)
        generated_sql = plan_data.get("sql")
        reasoning = plan_data.get("reasoning", "")
        
        db_results_str = ""
        executed_sql = None
        
        if needs_db and generated_sql:
            # 2. Safety verification of generated SQL
            try:
                validate_safe_sql(generated_sql)
                executed_sql = generated_sql
                
                # 3. Execute the SQL query
                result = await db.execute(text(generated_sql), {"user_id": current_user.id})
                columns = list(result.keys())
                rows = result.fetchall()
                
                # Format output for LLM context
                formatted_rows = []
                for row in rows:
                    formatted_rows.append(dict(zip(columns, [str(v) if v is not None else "None" for v in row])))
                
                db_results_str = json.dumps(formatted_rows, ensure_ascii=False, indent=2)
                log.info(f"Text-to-SQL Executed SQL: {generated_sql} | Results count: {len(rows)}")
            except Exception as sql_err:
                log.warning(f"SQL validation or execution failed: {sql_err}. Falling back to general chat.")
                db_results_str = f"Error executing database query: {str(sql_err)}"
                
        # 4. Formulate the final response to the user
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
        # Build history contents
        for msg in request.history:
            role = "user" if msg.role == "user" else "model"
            contents.append(
                types.Content(
                    role=role,
                    parts=[types.Part.from_text(text=msg.content)]
                )
            )
            
        contents.append(
            types.Content(
                role="user",
                parts=[types.Part.from_text(text=final_prompt)]
            )
        )
        
        response = await client.aio.models.generate_content(
            model=settings.gemini_model,
            contents=contents,
            config=types.GenerateContentConfig(
                system_instruction=system_instruction,
                temperature=0.7,
            )
        )
        
        return {
            "response": response.text,
            "sql": executed_sql,
            "reasoning": reasoning
        }
    except Exception as e:
        log.error(f"Failed in Text-to-SQL chat assistant: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"AI Assistant Error: {str(e)}")

@router.post("/ai/sql-query")
async def execute_sql_query(
    request: SQLRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(verify_token)
) -> dict[str, Any]:
    """
    Execute read-only SELECT or WITH SQL statements for the developer console.
    """
    try:
        validate_safe_sql(request.query)
    except ValueError as val_err:
        raise HTTPException(status_code=400, detail=str(val_err))
        
    try:
        result = await db.execute(text(request.query))
        columns = list(result.keys())
        # Convert row values to string/json friendly format
        rows = []
        for row in result.fetchall():
            row_vals = []
            for val in row:
                if val is None:
                    row_vals.append(None)
                else:
                    row_vals.append(str(val))
            rows.append(row_vals)
            
        return {
            "columns": columns,
            "rows": rows
        }
    except Exception as e:
        log.error(f"SQL execution failed: {e}")
        raise HTTPException(status_code=400, detail=f"SQL Error: {str(e)}")


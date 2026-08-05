"""
src/services/ai_assistant/service.py
Service layer for AI Assistant: tool-calling (read + write) and streaming
responses. Raw SQL execution (validate_safe_sql/execute_raw_sql) is retained
separately for the developer SQL console only.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any, AsyncGenerator

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from google.genai import types

from src.controllers.ai_assistant.model import ChatRequest
from src.dbs.models import User
from src.instances.config import get_settings
from src.instances.gemini import (
    generate_content_with_fallback,
    generate_content_stream_with_fallback,
)
from src.services.ai_assistant.tools import CONFIRMATION_REQUIRED, FUNCTION_DECLARATIONS, execute_tool_call

log = logging.getLogger(__name__)
settings = get_settings()


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
        db: AsyncSession,
        current_user: User,
    ) -> AsyncGenerator[str, None]:
        """
        Process chat prompt: let Gemini decide whether to call a read tool
        (fetch the user's financial data), a write tool (mutate it, subject to
        confirmation), or neither — then stream the final response.
        """
        requested_model = request.model or settings.gemini_model

        history_contents = []
        for msg in request.history:
            role = "user" if msg.role == "user" else "model"
            history_contents.append(
                types.Content(role=role, parts=[types.Part.from_text(text=msg.content)])
            )

        # Tool-use stage: a single Gemini call, with full conversation history,
        # decides whether the user's request needs data (read tools) and/or a
        # write action (e.g. add a transaction, create a price alert). Actions
        # in CONFIRMATION_REQUIRED are never executed here — they are surfaced
        # to the frontend as a pending_action event and only run after explicit
        # user confirmation via /ai/chat/confirm-action.
        tool_result_parts: list[str] = []
        try:
            tool_response, _ = await generate_content_with_fallback(
                contents=[*history_contents, types.Content(role="user", parts=[types.Part.from_text(text=request.message)])],
                config=types.GenerateContentConfig(
                    system_instruction=(
                        "You are pocketCFO AI Assistant. Decide whether answering the user's request requires "
                        "calling one or more of the available tools first.\n"
                        "- Call a read tool (get_accounts, get_account_balances, get_transactions, "
                        "get_securities, get_balance_sheet, get_income_statement, get_price_alerts) whenever "
                        "the answer depends on the user's actual financial data (balances, transactions, "
                        "holdings, net worth, income/expenses, alerts) rather than something you already know "
                        "from the conversation. Prefer calling a read tool over guessing or saying you don't "
                        "have access to the data — you do, via these tools.\n"
                        "- Call a write tool (create/update/delete-style) only if the user clearly asked for "
                        "that action with enough information to do it.\n"
                        "- If the request is general conversation that needs neither, do not call any tool."
                    ),
                    tools=[types.Tool(function_declarations=FUNCTION_DECLARATIONS)],
                    temperature=0.0,
                ),
                primary_model=requested_model,
            )
            function_calls = getattr(tool_response, "function_calls", None) or []
            for call in function_calls:
                call_args = dict(call.args or {})
                if call.name in CONFIRMATION_REQUIRED:
                    data = json.dumps({"type": "pending_action", "action": call.name, "args": call_args}, ensure_ascii=False)
                    yield f"data: {data}\n\n"
                    yield "data: [DONE]\n\n"
                    return
                try:
                    result = await execute_tool_call(call.name, call_args, user_id, current_user, db)
                    tool_result_parts.append(
                        f"[System context: Tool '{call.name}' was called with args {call_args}. Result: {json.dumps(result, ensure_ascii=False, default=str)}]"
                    )
                except Exception as tool_err:
                    log.error(f"Tool call '{call.name}' failed: {tool_err}")
                    tool_result_parts.append(f"[System context: The '{call.name}' action could not be completed due to an internal error.]")
        except Exception as tool_stage_err:
            log.warning(f"Tool-use stage failed, continuing without tools: {tool_stage_err}")

        system_instruction = (
            "You are pocketCFO AI Assistant, a helpful personal finance assistant.\n"
            "Help the user track assets, liabilities, bank statements, and stock transactions.\n"
            "Keep responses concise, clear, and professional. Use markdown formatting where helpful.\n"
            "Never repeat or paraphrase internal error messages, exception text, SQL, table/column names, "
            "or stack traces to the user. If a system context note says an action or query failed, just "
            "apologize briefly and offer to retry or rephrase the request."
        )

        final_prompt_parts = list(tool_result_parts)
        final_prompt_parts.append(f"User Question: {request.message}")
        final_prompt = "\n\n".join(final_prompt_parts)

        contents = list(history_contents)
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
    async def confirm_action(
        action: str,
        args: dict[str, Any],
        user_id: int,
        current_user: User,
        db: AsyncSession,
    ) -> dict[str, Any]:
        """
        Executes a tool call that was previously surfaced as a pending_action
        (e.g. create_price_alert) after the user has explicitly confirmed it in
        the chat UI.
        """
        result = await execute_tool_call(action, args, user_id, current_user, db)
        return {"action": action, "result": result}

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

"""
src/controllers/ai_assistant/api.py
Web API Router for Gemini AI assistant and developer SQL console.
"""
from __future__ import annotations

import logging
from typing import Any
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from src.instances.database import get_db
from src.middleware.auth import verify_token
from src.dbs.models import User
from src.controllers.ai_assistant.model import ChatRequest, SQLRequest
from src.services.ai_assistant.service import AIAssistantService

log = logging.getLogger(__name__)
router = APIRouter()


@router.post("/ai/chat")
async def chat_assistant(
    request: ChatRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(verify_token)
):
    """
    Text-to-SQL chatbot endpoint. Checks if user question needs DB data,
    safely runs read-only SQL, and feeds results back to Gemini with streaming output.
    """
    try:
        event_gen = AIAssistantService.process_chat_stream(
            request=request,
            user_id=current_user.id,
            db=db
        )
        return StreamingResponse(event_gen, media_type="text/event-stream")
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
        return await AIAssistantService.execute_raw_sql(
            query=request.query,
            user_id=current_user.id,
            db=db
        )
    except ValueError as val_err:
        raise HTTPException(status_code=400, detail=str(val_err))
    except Exception as e:
        log.error(f"SQL execution failed: {e}")
        raise HTTPException(status_code=400, detail=f"SQL Error: {str(e)}")

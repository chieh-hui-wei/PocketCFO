"""
src/controllers/ai_assistant.py
Controller for Gemini chat assistant and developer SQL console.
"""
from __future__ import annotations

import logging
from typing import Any, List
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from src.instances.database import get_db
from src.instances.gemini import get_gemini_client
from src.instances.config import get_settings
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

@router.post("/ai/chat")
async def chat_assistant(request: ChatRequest) -> dict[str, Any]:
    """
    Send messages and history to Gemini, return the chat response.
    """
    try:
        client = get_gemini_client()
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
            
        # Add new message
        contents.append(
            types.Content(
                role="user",
                parts=[types.Part.from_text(text=request.message)]
            )
        )
        
        system_instruction = (
            "You are pocketCFO AI Assistant, a helpful personal finance assistant.\n"
            "Help the user track assets, liabilities, bank statements, and stock transactions.\n"
            "Keep responses concise, clear, and professional. Use markdown formatting where helpful."
        )
        
        response = await client.aio.models.generate_content(
            model=settings.gemini_model,
            contents=contents,
            config=types.GenerateContentConfig(
                system_instruction=system_instruction,
                temperature=0.7,
            )
        )
        
        return {"response": response.text}
    except Exception as e:
        log.error(f"Failed to generate content from Gemini: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Gemini API Error: {str(e)}")

@router.post("/ai/sql-query")
async def execute_sql_query(
    request: SQLRequest,
    db: AsyncSession = Depends(get_db)
) -> dict[str, Any]:
    """
    Execute read-only SELECT or WITH SQL statements for the developer console.
    """
    cleaned = request.query.strip().lower()
    
    # Simple safety guard: only allow SELECT/WITH statements
    if not (cleaned.startswith("select") or cleaned.startswith("with")):
        raise HTTPException(
            status_code=400, 
            detail="Forbidden operation. Only read-only SELECT and WITH statements are allowed."
        )
        
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
                    # Convert dates, datetimes, decimals to string representation
                    row_vals.append(str(val))
            rows.append(row_vals)
            
        return {
            "columns": columns,
            "rows": rows
        }
    except Exception as e:
        log.error(f"SQL execution failed: {e}")
        raise HTTPException(status_code=400, detail=f"SQL Error: {str(e)}")

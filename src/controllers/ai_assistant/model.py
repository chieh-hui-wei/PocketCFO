"""
src/controllers/ai_assistant/model.py
Pydantic schemas for AI Assistant and Developer SQL Console.
"""
from __future__ import annotations

from typing import Any, List, Optional
from pydantic import BaseModel


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    message: str
    history: List[ChatMessage] = []
    model: Optional[str] = None


class ConfirmActionRequest(BaseModel):
    action: str
    args: dict[str, Any]
    model: Optional[str] = None


class SQLRequest(BaseModel):
    query: str

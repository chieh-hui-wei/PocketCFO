"""
src/utils/category_classifier.py
Classify transactions into expense categories using Gemini AI.
Accepts both merchant name and description for richer context.
User-defined CategoryRule overrides are checked first; Gemini handles the rest.
"""
from __future__ import annotations

import json
import logging
import unicodedata
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from src.dbs.models import CategoryRule

log = logging.getLogger(__name__)

# Unified categories — these match TransactionCategory enum values exactly
CATEGORY_LABELS: dict[str, str] = {
    "food": "食物",
    "transport": "交通",
    "medical": "醫療",
    "salary": "薪資",
    "entertainment": "娛樂",
    "expense": "支出",
    "investment": "投資",
    "dividend": "股利",
    "interest": "利息",
    "transfer_in": "轉入",
    "transfer_out": "轉出",
    "other": "其他",
}

VALID_CATEGORIES = ["food", "transport", "medical", "salary", "entertainment", "other"]

_CLASSIFY_PROMPT = """\
You are a financial transaction classifier for Taiwan.
Classify each transaction into exactly ONE of these categories:
  food          – restaurants, supermarkets (全聯/全家/7-11), grocery, food delivery, drinks
  transport     – gas stations, ride-hailing (Uber/Bolt), taxis, MRT, buses, trains, parking, toll
  medical       – hospitals, clinics, pharmacies, health insurance, dental, vision, skincare
  salary        – salary / payroll / employer remittance deposits
  entertainment – streaming (YouTube/Netflix/Disney+/Spotify), cinemas, KTV, gaming, concerts
  other         – anything that doesn't clearly fit the above

Each item has an "id", "merchant", and "description". Use all available fields to make the best decision.
Return ONLY valid JSON (no markdown, no explanation) in this exact schema:
{
  "results": [
    {"id": <same id as input>, "category": "<category key>"},
    ...
  ]
}

Transactions to classify:
"""


def _normalize(text: str) -> str:
    return unicodedata.normalize("NFKC", text).lower().strip()


def _apply_override(merchant: str, description: str, rules: "list[CategoryRule]") -> str | None:
    """Check user-defined rules first (substring match on merchant+description). Returns category or None."""
    combined = _normalize(f"{merchant} {description}")
    for rule in rules:
        if _normalize(rule.keyword) in combined:
            return rule.category
    return None


async def classify_transactions_batch(
    items: list[dict],
    rules: "list[CategoryRule]",
) -> dict[str, str]:
    """
    Classify a list of transaction dicts → category keys.

    Each item must have:
        - "id":          unique key to match results back (usually merchant name or invoice number)
        - "merchant":    store/payee name
        - "description": additional context (items purchased, payment note, etc.)

    Returns a dict mapping each item's "id" → category key.

    Strategy:
    1. Apply user-defined override rules first (instant, no API call).
    2. Send remaining to Gemini in a single batch call with full context.
    """
    from src.instances.gemini import get_gemini_client
    from src.instances.config import get_settings
    from google.genai import types

    result: dict[str, str] = {}
    need_gemini: list[dict] = []

    # Step 1: user override rules
    for item in items:
        item_id = item["id"]
        override = _apply_override(item.get("merchant", ""), item.get("description", ""), rules)
        if override:
            result[item_id] = override
        else:
            need_gemini.append(item)

    if not need_gemini:
        return result

    # Step 2: Gemini batch classification
    settings = get_settings()
    client = get_gemini_client()
    prompt = _CLASSIFY_PROMPT + json.dumps(need_gemini, ensure_ascii=False, indent=2)

    try:
        response = await client.aio.models.generate_content(
            model=settings.gemini_model,
            contents=[prompt],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.0,
            ),
        )
        raw = response.text.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        parsed = json.loads(raw)
        for entry in parsed.get("results", []):
            item_id = entry.get("id")
            category = entry.get("category", "other")
            if category not in VALID_CATEGORIES:
                category = "other"
            if item_id is not None:
                result[item_id] = category
    except Exception as e:
        log.warning(f"Gemini batch classification failed: {e}. Defaulting to 'other'.")

    # Fallback for anything Gemini missed
    for item in need_gemini:
        if item["id"] not in result:
            result[item["id"]] = "other"

    return result


def label(category: str) -> str:
    """Return the Chinese display label for a category key."""
    return CATEGORY_LABELS.get(category, category)


def _category_to_enum(category: str):
    """Convert a classifier category string to the TransactionCategory enum member."""
    from src.dbs.models import TransactionCategory
    _map = {
        "food": TransactionCategory.FOOD,
        "transport": TransactionCategory.TRANSPORT,
        "medical": TransactionCategory.MEDICAL,
        "entertainment": TransactionCategory.ENTERTAINMENT,
        "salary": TransactionCategory.SALARY,
        "investment": TransactionCategory.INVESTMENT,
        "dividend": TransactionCategory.DIVIDEND,
        "interest": TransactionCategory.INTEREST,
        "other": TransactionCategory.OTHER,
    }
    return _map.get(category.lower(), TransactionCategory.OTHER)

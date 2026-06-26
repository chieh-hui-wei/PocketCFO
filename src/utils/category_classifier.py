"""
src/utils/category_classifier.py
Classify merchant names into expense categories using Gemini AI.
User-defined CategoryRule overrides are checked first; Gemini handles everything else.
"""
from __future__ import annotations

import json
import logging
import unicodedata
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from src.dbs.models import CategoryRule

log = logging.getLogger(__name__)

# Supported categories
CATEGORY_LABELS: dict[str, str] = {
    "food": "食物",
    "transport": "交通",
    "medical": "醫療",
    "salary": "薪資",
    "entertainment": "娛樂",
    "other": "其他",
}

VALID_CATEGORIES = list(CATEGORY_LABELS.keys())

_CLASSIFY_PROMPT = """\
You are a financial transaction classifier for Taiwan.
Classify each merchant name into exactly ONE of these categories:
  food         – restaurants, supermarkets, convenience stores, grocery, food delivery
  transport    – gas stations, ride-hailing (Uber/Bolt/Lyft), taxis, MRT, buses, trains, parking, toll
  medical      – hospitals, clinics, pharmacies, health insurance, dental, vision, skincare clinics
  salary       – salary / payroll deposits, employer remittances
  entertainment – streaming services (YouTube/Netflix/Disney+/Spotify), cinemas, KTV, gaming, concerts
  other        – anything that doesn't clearly fit the above

Return ONLY valid JSON with this exact schema (no markdown, no explanation):
{
  "results": [
    {"merchant": "<original merchant name>", "category": "<category key>"},
    ...
  ]
}

Merchants to classify:
"""


def _normalize(text: str) -> str:
    return unicodedata.normalize("NFKC", text).lower().strip()


def _apply_overrides(merchant: str, rules: "list[CategoryRule]") -> str | None:
    """Check user-defined rules first (substring match). Returns category key or None."""
    name = _normalize(merchant)
    for rule in rules:
        if _normalize(rule.keyword) in name:
            return rule.category
    return None


async def classify_merchants_batch(
    merchants: list[str],
    rules: "list[CategoryRule]",
) -> dict[str, str]:
    """
    Classify a list of merchant names → category keys.

    Strategy:
    1. Apply user-defined override rules first (instant, no API call).
    2. Send remaining unresolved merchants to Gemini in a single batch call.

    Returns a dict mapping each merchant name → category key.
    """
    from src.instances.gemini import get_gemini_client
    from src.instances.config import get_settings
    from google.genai import types

    result: dict[str, str] = {}
    need_gemini: list[str] = []

    # Step 1: override rules
    for m in merchants:
        override = _apply_overrides(m, rules)
        if override:
            result[m] = override
        else:
            need_gemini.append(m)

    if not need_gemini:
        return result

    # Step 2: Gemini batch classification
    settings = get_settings()
    client = get_gemini_client()

    merchant_list_str = "\n".join(f"- {m}" for m in need_gemini)
    prompt = _CLASSIFY_PROMPT + merchant_list_str

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
        for item in parsed.get("results", []):
            merchant_name = item.get("merchant", "")
            category = item.get("category", "other")
            if category not in VALID_CATEGORIES:
                category = "other"
            result[merchant_name] = category
    except Exception as e:
        log.warning(f"Gemini batch classification failed: {e}. Defaulting all to 'other'.")

    # Fallback for any merchants Gemini missed
    for m in need_gemini:
        if m not in result:
            result[m] = "other"

    return result


def classify_merchant_sync_with_rules(merchant: str, rules: "list[CategoryRule]") -> str:
    """
    Synchronous classification using only user-defined rules (no Gemini).
    Useful as a quick fallback when async context is not available.
    """
    override = _apply_overrides(merchant, rules)
    return override if override else "other"


def label(category: str) -> str:
    """Return the Chinese display label for a category key."""
    return CATEGORY_LABELS.get(category, category)

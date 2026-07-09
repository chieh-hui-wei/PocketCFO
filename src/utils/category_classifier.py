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
    "insurance": "保險",
    "exercise": "運動",
    "shopping": "購物",
    "expense": "支出",
    "investment": "投資",
    "dividend": "股利",
    "interest": "利息",
    "transfer_in": "轉入",
    "transfer_out": "轉出",
    "credit_card_payment": "信用卡繳款",
    "debt_repayment": "本金償還",
    "other": "其他",
}

VALID_CATEGORIES = ["food", "transport", "medical", "salary", "entertainment", "insurance", "exercise", "shopping", "credit_card_payment", "debt_repayment", "other"]

_CLASSIFY_PROMPT = """\
You are a financial transaction classifier for Taiwan.
Classify each transaction into exactly ONE of these categories:
  food                – restaurants, supermarkets (全聯/全家/7-11), grocery, food delivery, drinks
  transport           – gas stations (加油站, 加油, 中油, 台亞), ride-hailing (Uber/Bolt), taxis, MRT, buses, trains, parking, toll
  medical             – hospitals, clinics, pharmacies, health checkups, dental, vision, skincare (excluding insurance premiums)
  salary              – salary / payroll / employer remittance deposits
  entertainment       – streaming (YouTube/Netflix/Disney+/Spotify), cinemas, KTV, gaming, concerts
  insurance           – health insurance, life insurance, car/scooter insurance, annual premiums (e.g. 南山人壽, 富邦產險)
  exercise            – gym membership, sports centers, sports equipment, fitness training
  shopping            – shopping, department stores, clothes, shoes, bags, electronics, home decor (e.g. 蝦皮, 淘寶, momo, PChome, 宜得利, Uniqlo, MUJI)
  credit_card_payment – paying credit card bills or monthly payments to card issuers (e.g., 信用卡繳款, 繳卡費)
  debt_repayment      – principal repayments on bank loans, installments, or mortgages (e.g., 貸款本金, 分期還款)
  other               – anything that doesn't clearly fit the above

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
    
    # System default overrides for robust classification
    if any(k in combined for k in ["高鐵", "台鐵", "中油", "捷運", "mrt", "uber", "yoxi", "line taxi", "計程車", "和運", "irent", "goshare", "wemo", "加油站", "加油"]):
        return "transport"
    if any(k in combined for k in ["7-11", "7-eleven", "全家", "萊爾富", "ok超商", "全聯", "家樂福", "foodpanda", "uber eats", "外送"]):
        return "food"
    if any(k in combined for k in ["netflix", "spotify", "youtube premium", "disney+", "klook", "kkday"]):
        return "entertainment"
    if any(k in combined for k in ["健保", "勞保", "國民年金"]):
        return "insurance"
    if any(k in combined for k in ["蝦皮", "淘寶", "momo", "pchome", "宜得利", "uniqlo", "無印良品", "muji", "百貨", "服飾"]):
        return "shopping"
        
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
        "insurance": TransactionCategory.INSURANCE,
        "exercise": TransactionCategory.EXERCISE,
        "shopping": TransactionCategory.SHOPPING,
        "salary": TransactionCategory.SALARY,
        "investment": TransactionCategory.INVESTMENT,
        "credit_card_payment": TransactionCategory.CREDIT_CARD_PAYMENT,
        "debt_repayment": TransactionCategory.DEBT_REPAYMENT,
        "dividend": TransactionCategory.DIVIDEND,
        "interest": TransactionCategory.INTEREST,
        "other": TransactionCategory.OTHER,
    }
    return _map.get(category.lower(), TransactionCategory.OTHER)

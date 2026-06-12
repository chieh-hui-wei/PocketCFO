"""
src/instances/gemini.py
Google Gemini client singleton with retry logic.
"""
from __future__ import annotations

import base64
from pathlib import Path
from typing import Any

from google import genai
from google.genai import types
from tenacity import retry, stop_after_attempt, wait_exponential

from src.instances.config import get_settings

settings = get_settings()

_client: genai.Client | None = None


def get_gemini_client() -> genai.Client:
    global _client
    if _client is None:
        _client = genai.Client(api_key=settings.gemini_api_key)
    return _client


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=10),
    reraise=True,
)
async def extract_from_pdf(pdf_path: Path, prompt: str) -> str:
    """
    Send a PDF to Gemini and return the text response.
    Uses inline base64 encoding (files < 20 MB).
    """
    import logging
    log = logging.getLogger(__name__)

    client = get_gemini_client()
    pdf_bytes = pdf_path.read_bytes()
    b64 = base64.b64encode(pdf_bytes).decode()

    # Extract text content locally to assist Gemini parsing and speed
    extracted_text = ""
    try:
        import pdfplumber
        with pdfplumber.open(pdf_path) as pdf:
            pages_text = []
            for i, page in enumerate(pdf.pages):
                text = page.extract_text()
                if text:
                    pages_text.append(f"--- PAGE {i+1} ---\n{text}")
            extracted_text = "\n\n".join(pages_text)
    except Exception as e:
        log.warning(f"Failed to extract text from PDF using pdfplumber: {e}")
        try:
            import PyPDF2
            with open(pdf_path, "rb") as f:
                reader = PyPDF2.PdfReader(f)
                pages_text = []
                for i, page in enumerate(reader.pages):
                    text = page.extract_text()
                    if text:
                        pages_text.append(f"--- PAGE {i+1} ---\n{text}")
                extracted_text = "\n\n".join(pages_text)
        except Exception as e2:
            log.warning(f"Failed to extract text using PyPDF2: {e2}")

    # Build contents with raw bytes and extracted text to avoid OCR delays and errors
    contents = [
        types.Part.from_bytes(data=pdf_bytes, mime_type="application/pdf"),
    ]
    if extracted_text.strip():
        contents.append(f"Here is the locally extracted text content of the PDF statement to ensure 100% data and numerical accuracy:\n\n{extracted_text}")
    contents.append(prompt)

    response = await client.aio.models.generate_content(
        model=settings.gemini_model,
        contents=contents,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            temperature=0.0,
        ),
    )
    return response.text


async def extract_structured(pdf_path: Path, prompt: str) -> dict[str, Any]:
    """Extract and parse JSON from a PDF via Gemini."""
    import json

    raw = await extract_from_pdf(pdf_path, prompt)
    raw = raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    parsed = json.loads(raw)
    if isinstance(parsed, list):
        if len(parsed) > 0:
            return parsed[0]
        return {}
    return parsed

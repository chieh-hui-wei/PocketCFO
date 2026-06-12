"""
src/middleware/error_middleware.py
Global exception handler returning consistent JSON error responses.
"""
from __future__ import annotations

import logging
from fastapi import Request
from fastapi.responses import JSONResponse

log = logging.getLogger(__name__)


async def global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    log.exception(f"unhandled_error path={request.url.path} error={exc}")
    return JSONResponse(
        status_code=500,
        content={"error": "Internal server error", "detail": str(exc)},
    )


async def value_error_handler(request: Request, exc: ValueError) -> JSONResponse:
    return JSONResponse(
        status_code=400,
        content={"error": "Bad request", "detail": str(exc)},
    )


async def file_not_found_handler(request: Request, exc: FileNotFoundError) -> JSONResponse:
    return JSONResponse(
        status_code=404,
        content={"error": "Not found", "detail": str(exc)},
    )

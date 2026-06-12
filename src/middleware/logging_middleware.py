"""
src/middleware/logging_middleware.py
Structured request/response logging middleware.
"""
from __future__ import annotations

import time
import uuid

import logging
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

log = logging.getLogger(__name__)


class LoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        request_id = str(uuid.uuid4())[:8]
        start = time.perf_counter()

        log.info(
            f"request.start request_id={request_id} method={request.method} path={request.url.path}"
        )

        response = await call_next(request)
        elapsed_ms = (time.perf_counter() - start) * 1000

        log.info(
            f"request.end request_id={request_id} status_code={response.status_code} elapsed_ms={elapsed_ms:.2f}"
        )
        response.headers["X-Request-ID"] = request_id
        return response

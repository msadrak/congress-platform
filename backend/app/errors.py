"""Stable, machine-readable API errors.

An `ApiError` is answered as `{"detail": "<English message>", "code": "<UPPER_SNAKE_CODE>"}`. `detail` stays
a plain string, so clients that only read it keep working; clients localize by `code`, never by `detail`.
A plain `HTTPException` is still answered as `{"detail": ...}` and validation errors (422) are unchanged.

    raise ApiError(status.HTTP_410_GONE, "TIER_SOLD_OUT", "Ticket tier is sold out / quota exhausted")

Declare the statuses a route can answer with `responses=error_responses(...)` so the OpenAPI document (and
the generated web types) describe the body.
"""

from typing import Any

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel


class ErrorResponse(BaseModel):
    detail: str
    code: str | None = None


class ApiError(HTTPException):
    def __init__(self, status_code: int, code: str, detail: str, headers: dict[str, str] | None = None) -> None:
        super().__init__(status_code, detail, headers)
        self.code = code


async def api_error_handler(_request: Request, exc: Exception) -> JSONResponse:
    if not isinstance(exc, ApiError):  # registered for ApiError only
        raise exc
    return JSONResponse(
        ErrorResponse(detail=exc.detail, code=exc.code).model_dump(),
        status_code=exc.status_code,
        headers=exc.headers,
    )


def error_responses(*status_codes: int) -> dict[int | str, dict[str, Any]]:
    """OpenAPI `responses=` entries documenting `ErrorResponse` for these statuses."""
    return {status_code: {"model": ErrorResponse} for status_code in status_codes}

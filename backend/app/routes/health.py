"""Liveness and readiness probes. Responses never describe the configuration or the failure."""

import asyncio

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from sqlalchemy import text

router = APIRouter(prefix="/api", tags=["health"])

READY_TIMEOUT_SECONDS = 5.0


@router.get("/health")
async def health() -> dict[str, str]:
    """The process is up and serving requests. Touches nothing else."""
    return {"status": "ok"}


@router.get("/ready", response_model=dict[str, str])
async def ready(request: Request) -> JSONResponse:
    """The database answers within a few seconds; 503 otherwise, without the reason (it may name hosts)."""

    async def probe() -> None:
        async with request.app.state.sessionmaker() as session:
            await session.execute(text("SELECT 1"))

    try:
        await asyncio.wait_for(probe(), timeout=READY_TIMEOUT_SECONDS)
    except Exception:
        return JSONResponse({"status": "unavailable"}, status_code=503)
    return JSONResponse({"status": "ready"})

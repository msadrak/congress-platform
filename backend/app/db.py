from collections.abc import AsyncIterator
from typing import Annotated, TypeVar

from fastapi import Depends, Request
from sqlalchemy import Select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, create_async_engine

from app.config import Settings

T = TypeVar("T")


def build_engine(settings: Settings) -> AsyncEngine:
    """The API's engine: a bounded pool and a server-side statement timeout (see the db_* settings)."""
    return create_async_engine(
        settings.database_url,
        pool_size=settings.db_pool_size,
        max_overflow=settings.db_max_overflow,
        pool_timeout=settings.db_pool_timeout_seconds,
        pool_pre_ping=settings.db_pool_pre_ping,
        # asyncpg sends these as startup parameters, so every pooled connection carries the limit.
        connect_args={"server_settings": {"statement_timeout": str(settings.db_statement_timeout_ms)}},
    )


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    async with request.app.state.sessionmaker() as session:
        yield session


SessionDep = Annotated[AsyncSession, Depends(get_session)]


async def add_or_existing(session: AsyncSession, row: T, existing: Select[T]) -> tuple[T, bool]:
    """Insert `row` in a savepoint; when a unique constraint says a concurrent request inserted it first, return
    that row instead (`existing` selects it). Returns (row, created). Any other integrity error propagates."""
    try:
        async with session.begin_nested():
            session.add(row)
            await session.flush()
    except IntegrityError:
        found = await session.scalar(existing)
        if found is None:
            raise
        return found, False
    return row, True

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.config import Settings, describe_settings_error
from app.routes import (
    access,
    analytics,
    auth,
    booths,
    checkin,
    desk,
    events,
    health,
    leads,
    network,
    organizers,
    pages,
    public,
    ticket_tiers,
    tickets,
)


def create_app(settings: Settings) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        engine = create_async_engine(settings.database_url)
        app.state.sessionmaker = async_sessionmaker(engine, expire_on_commit=False)
        yield
        await engine.dispose()

    app = FastAPI(title="Congress Platform", lifespan=lifespan)
    app.state.settings = settings
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(health.router)
    app.include_router(auth.router)
    app.include_router(access.router)
    app.include_router(organizers.router)
    app.include_router(events.router)
    app.include_router(ticket_tiers.router)
    app.include_router(tickets.router)
    app.include_router(checkin.router)
    app.include_router(desk.router)
    app.include_router(analytics.router)
    app.include_router(booths.router)
    app.include_router(leads.router)
    app.include_router(network.router)
    app.include_router(pages.router)
    app.include_router(public.router)
    return app


def create_app_from_env() -> FastAPI:
    """Entry point for `uvicorn app.main:create_app_from_env --factory`.

    A misconfigured deployment stops here with a list of what to fix, before it opens any connection.
    """
    try:
        settings = Settings()
    except ValidationError as exc:
        raise SystemExit(describe_settings_error(exc)) from None
    return create_app(settings)

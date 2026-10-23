import asyncio
import contextlib
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.config import STRICT_ENVIRONMENTS, Settings, describe_settings_error
from app.errors import ApiError, api_error_handler
from app.logging_setup import configure_logging
from app.observability import install_observability
from app.rate_limit import FailureLimiter
from app.schema_guard import assert_schema_current
from app.platform_config import apply_platform, environment_config, keep_loading_platform, reload_platform
from app.sms import build_gateway
from app.sms.outbox import run_outbox
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
    passes,
    platform,
    program,
    public,
    sms,
    sms_outbox,
    ticket_tiers,
    tickets,
)


def create_app(settings: Settings) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        engine = create_async_engine(settings.database_url, pool_pre_ping=True)
        if settings.environment in STRICT_ENVIRONMENTS:
            await assert_schema_current(engine)
        app.state.sessionmaker = async_sessionmaker(engine, expire_on_commit=False)
        platform_loader = None
        try:
            async with app.state.sessionmaker() as session:
                await reload_platform(app, session)
        except (OSError, SQLAlchemyError):
            # The API still starts (readiness reports the database); saved settings apply once it is reachable.
            apply_platform(app, environment_config(settings))
            platform_loader = asyncio.create_task(keep_loading_platform(app))
        outbox = (
            asyncio.create_task(
                run_outbox(app.state.sessionmaker, app.state.sms, settings.sms_outbox_poll_seconds)
            )
            if settings.sms_outbox_enabled
            else None
        )
        yield
        for task in (outbox, platform_loader):
            if task is not None:
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task
        await app.state.sms.aclose()
        await engine.dispose()

    # Interactive docs and the schema only outside production (scripts/gen-api.mjs reads app.openapi() directly).
    docs = settings.environment != "production"
    app = FastAPI(
        title="Congress Platform",
        lifespan=lifespan,
        openapi_url="/openapi.json" if docs else None,
        docs_url="/docs" if docs else None,
        redoc_url="/redoc" if docs else None,
    )
    app.state.settings = settings
    app.state.limiter = FailureLimiter(enabled=settings.auth_rate_limits_enabled)
    app.state.sms = build_gateway(settings)
    app.add_exception_handler(ApiError, api_error_handler)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    install_observability(app, settings)
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
    app.include_router(program.router)
    app.include_router(public.router)
    app.include_router(public.seo_router)
    app.include_router(passes.router)
    app.include_router(sms.router)
    app.include_router(sms.platform_router)
    app.include_router(platform.router)
    if settings.environment != "production":
        app.include_router(sms_outbox.router)
    return app


def create_app_from_env() -> FastAPI:
    """Entry point for `uvicorn app.main:create_app_from_env --factory`.

    A misconfigured deployment stops here with a list of what to fix, before it opens any connection.
    """
    try:
        settings = Settings()
    except ValidationError as exc:
        configure_logging()
        raise SystemExit(describe_settings_error(exc)) from None
    configure_logging(settings.effective_log_format)
    return create_app(settings)

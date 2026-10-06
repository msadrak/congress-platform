"""Test harness: real PostgreSQL, real Alembic migrations, requests over the HTTP seam."""

import asyncio
from collections.abc import AsyncIterator, Iterator
from pathlib import Path

import asyncpg
import pytest
from alembic import command
from alembic.config import Config
from httpx import ASGITransport, AsyncClient

from app.config import Settings
from app.main import create_app

ADMIN_TOKEN = "test-admin-token"
ADMIN_DSN = "postgresql://congress:congress@localhost:5433/postgres"
TEST_DB = "congress_test"
TEST_URL = f"postgresql+asyncpg://congress:congress@localhost:5433/{TEST_DB}"
BACKEND_DIR = Path(__file__).resolve().parent.parent


async def _recreate_database() -> None:
    conn = await asyncpg.connect(ADMIN_DSN)
    try:
        await conn.execute(f'DROP DATABASE IF EXISTS "{TEST_DB}" WITH (FORCE)')
        await conn.execute(f'CREATE DATABASE "{TEST_DB}"')
    finally:
        await conn.close()


async def _truncate_all() -> None:
    conn = await asyncpg.connect(TEST_URL.replace("+asyncpg", ""))
    try:
        tables = await conn.fetch(
            "SELECT tablename FROM pg_tables "
            "WHERE schemaname = 'public' AND tablename <> 'alembic_version'"
        )
        if tables:
            names = ", ".join(f'"{row["tablename"]}"' for row in tables)
            await conn.execute(f"TRUNCATE {names} RESTART IDENTITY CASCADE")
    finally:
        await conn.close()


@pytest.fixture(scope="session", autouse=True)
def migrated_database() -> Iterator[None]:
    asyncio.run(_recreate_database())
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    cfg.set_main_option("sqlalchemy.url", TEST_URL)
    command.upgrade(cfg, "head")
    yield


@pytest.fixture
async def client(migrated_database: None) -> AsyncIterator[AsyncClient]:
    await _truncate_all()
    settings = Settings(database_url=TEST_URL, platform_admin_token=ADMIN_TOKEN)
    app = create_app(settings)
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as http:
            yield http

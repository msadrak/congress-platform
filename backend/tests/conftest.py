"""Test harness: real PostgreSQL, real Alembic migrations, requests over the HTTP seam.

The harness drops, re-creates and truncates its database, so it is fail-closed about which database
that is. The target (`CONGRESS_TEST_DATABASE_URL`, default `congress_test` on 127.0.0.1:5433) must:
  * be named `<something>_test`;
  * live on the same server as the admin connection used to (re)create it;
  * carry the harness marker (a database comment written when the harness creates it) before any
    TRUNCATE. A pre-existing database without the marker is dropped only if it is the legacy default
    `congress_test`.
`CONGRESS_DATABASE_URL` is never consulted: the app settings and Alembic both receive the test URL
explicitly.
"""

import asyncio
import os
import re
from collections.abc import AsyncIterator, Iterator
from pathlib import Path

import asyncpg
import pytest
from alembic import command
from alembic.config import Config
from httpx import ASGITransport, AsyncClient
from sqlalchemy.engine import URL, make_url

from app.config import Settings
from app.main import create_app

ADMIN_TOKEN = "test-admin-token"
TEST_JWT_SECRET = "test-secure-jwt-secret-minimum-32-chars-long-for-testing"
TEST_HOST = os.environ.get("CONGRESS_TEST_HOST", "127.0.0.1").strip()
TEST_PORT = os.environ.get("CONGRESS_TEST_PORT", "5433").strip()
TEST_URL = os.environ.get(
    "CONGRESS_TEST_DATABASE_URL",
    f"postgresql+asyncpg://congress:congress@{TEST_HOST}:{TEST_PORT}/congress_test",
)
_test_url = make_url(TEST_URL)
ADMIN_DSN = os.environ.get(
    "CONGRESS_TEST_ADMIN_DSN",
    _test_url.set(drivername="postgresql", database="postgres").render_as_string(hide_password=False),
)
TEST_DB = _test_url.database or ""
BACKEND_DIR = Path(__file__).resolve().parent.parent

DISPOSABLE_MARKER = "congress-platform disposable pytest database"
LEGACY_DEFAULT_DB = "congress_test"
_TEST_DB_NAME = re.compile(r"^[a-z][a-z0-9_]*_test$")


def disposable_target_problem(test_url: URL, admin_dsn: URL) -> str | None:
    """Why this pair must not be used destructively, or None when it is an acceptable test target."""
    name = test_url.database or ""
    if not test_url.drivername.startswith("postgresql"):
        return f"test database must be PostgreSQL, got driver {test_url.drivername!r}"
    if not _TEST_DB_NAME.fullmatch(name):
        return f"test database name {name!r} must end in '_test' (lowercase letters, digits, underscores)"
    if (test_url.host, test_url.port) != (admin_dsn.host, admin_dsn.port):
        return "CONGRESS_TEST_ADMIN_DSN must point at the same server as the test database"
    if admin_dsn.database != "postgres":
        return "CONGRESS_TEST_ADMIN_DSN must connect to the 'postgres' maintenance database"
    return None


def require_disposable_target() -> None:
    problem = disposable_target_problem(_test_url, make_url(ADMIN_DSN))
    if problem:
        pytest.exit(f"Refusing to run destructive test setup: {problem}.", returncode=4)


def _plain_dsn(url: str) -> str:
    return url.replace("+asyncpg", "")


async def assert_test_database_identity(conn: asyncpg.Connection) -> None:
    """The open connection is the harness-created test database, by name and by marker."""
    row = await conn.fetchrow(
        "SELECT current_database() AS name, shobj_description(oid, 'pg_database') AS marker "
        "FROM pg_database WHERE datname = current_database()"
    )
    if row is None or row["name"] != TEST_DB or row["marker"] != DISPOSABLE_MARKER:
        name = row["name"] if row else "?"
        raise RuntimeError(
            f"Refusing to modify database {name!r}: it is not the marked disposable test database {TEST_DB!r}."
        )


async def _recreate_database() -> None:
    conn = await asyncpg.connect(ADMIN_DSN)
    try:
        marker = await conn.fetchval(
            "SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = $1", TEST_DB
        )
        exists = await conn.fetchval("SELECT 1 FROM pg_database WHERE datname = $1", TEST_DB)
        if exists and marker != DISPOSABLE_MARKER and TEST_DB != LEGACY_DEFAULT_DB:
            raise RuntimeError(
                f"Refusing to drop existing database {TEST_DB!r}: it was not created by this test harness."
            )
        await conn.execute(f'DROP DATABASE IF EXISTS "{TEST_DB}" WITH (FORCE)')
        await conn.execute(f'CREATE DATABASE "{TEST_DB}"')
        await conn.execute(f"COMMENT ON DATABASE \"{TEST_DB}\" IS '{DISPOSABLE_MARKER}'")
    finally:
        await conn.close()


async def _truncate_all() -> None:
    conn = await asyncpg.connect(_plain_dsn(TEST_URL))
    try:
        await assert_test_database_identity(conn)
        # Terminate lingering connections from previous tests to avoid TRUNCATE deadlocks
        await conn.execute(
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
            "WHERE datname = current_database() AND pid <> pg_backend_pid()"
        )
        tables = await conn.fetch(
            "SELECT tablename FROM pg_tables "
            "WHERE schemaname = 'public' AND tablename <> 'alembic_version'"
        )
        if tables:
            names = ", ".join(f'"{row["tablename"]}"' for row in tables)
            await conn.execute(f"TRUNCATE {names} RESTART IDENTITY CASCADE")
    finally:
        await conn.close()


def alembic_config() -> Config:
    """Alembic bound to the test database; the env override is ignored for an explicit URL."""
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    cfg.attributes["database_url"] = TEST_URL
    return cfg


@pytest.fixture(scope="session", autouse=True)
def migrated_database() -> Iterator[None]:
    require_disposable_target()
    asyncio.run(_recreate_database())
    command.upgrade(alembic_config(), "head")
    yield


@pytest.fixture
def media_root(tmp_path: Path) -> Path:
    return tmp_path / "media"


def make_test_settings(media_root: Path) -> Settings:
    return Settings(
        environment="test",
        database_url=TEST_URL,
        platform_admin_token=ADMIN_TOKEN,
        jwt_secret=TEST_JWT_SECRET,
        media_root=media_root,
    )


@pytest.fixture
async def client(migrated_database: None, media_root: Path) -> AsyncIterator[AsyncClient]:
    await _truncate_all()
    app = create_app(make_test_settings(media_root))
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as http:
            yield http

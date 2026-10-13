"""Refuse to serve against a database whose schema is not the one this build was written for.

Migrations are applied by the one-shot `migrate` service, never by API workers; in staging/production the
API checks the Alembic revision at startup and exits with an actionable message when it differs."""

from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

BACKEND_DIR = Path(__file__).resolve().parent.parent


def expected_revision() -> str:
    config = Config()
    config.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    head = ScriptDirectory.from_config(config).get_current_head()
    assert head is not None
    return head


async def assert_schema_current(engine: AsyncEngine) -> None:
    expected = expected_revision()
    async with engine.connect() as connection:
        try:
            current = (await connection.execute(text("SELECT version_num FROM alembic_version"))).scalar()
        except Exception:
            current = None
    if current != expected:
        raise RuntimeError(
            f"Database schema revision is {current or 'missing'}, this build requires {expected}. "
            "Run the migration service (alembic upgrade head) before starting the API."
        )

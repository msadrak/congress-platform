"""The models and the Alembic migrations describe the same schema, and the migrations reverse cleanly.

Runs only against the disposable, marked test database migrated by tests/conftest.py. A difference here means
a model was changed without a migration (or the other way round): write the migration, or make the model
declare what the migrations already create.
"""

import asyncio
from collections.abc import Callable
from typing import Any

import asyncpg
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import Connection
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

from app.models import Base
from tests.conftest import TEST_URL, _truncate_all, alembic_config, assert_test_database_identity


async def _run_sync(fn: Callable[[Connection], Any]) -> Any:
    engine = create_async_engine(TEST_URL, poolclass=NullPool)
    try:
        async with engine.connect() as conn:
            return await conn.run_sync(fn)
    finally:
        await engine.dispose()


def _schema_differences() -> list[Any]:
    """What autogenerate would write for the current models against the migrated database.

    Types and server defaults are compared too: a model without the migration's server default would build a
    different schema (Base.metadata.create_all) and lets raw SQL inserts fail where the migrated database accepts them.
    """

    def compare(sync_conn: Connection) -> list[Any]:
        context = MigrationContext.configure(sync_conn, opts={"compare_type": True, "compare_server_default": True})
        return list(compare_metadata(context, Base.metadata))

    result: list[Any] = asyncio.run(_run_sync(compare))
    return result


async def _remaining_relations() -> list[str]:
    conn = await asyncpg.connect(TEST_URL.replace("+asyncpg", ""))
    try:
        await assert_test_database_identity(conn)
        rows = await conn.fetch(
            "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
            "WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'i') "
            "AND c.relname NOT IN ('alembic_version', 'alembic_version_pkc') ORDER BY c.relname"
        )
        types = await conn.fetch(
            "SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace "
            "WHERE n.nspname = 'public' AND t.typtype IN ('e', 'd', 'c') "
            "AND NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.reltype = t.oid) ORDER BY t.typname"
        )
        return [row["relname"] for row in rows] + [f"type {row['typname']}" for row in types]
    finally:
        await conn.close()


def _describe(differences: list[Any]) -> str:
    return "models and migrations differ:\n" + "\n".join(repr(difference) for difference in differences)


def test_models_match_the_migrated_schema() -> None:
    differences = _schema_differences()
    assert not differences, _describe(differences)


def test_migrations_downgrade_to_base_and_upgrade_again() -> None:
    asyncio.run(_truncate_all())  # also proves this is the marked disposable test database
    try:
        command.downgrade(alembic_config(), "base")
        leftovers = asyncio.run(_remaining_relations())
    finally:
        command.upgrade(alembic_config(), "head")

    assert leftovers == [], f"downgrade to base left behind: {leftovers}"
    differences = _schema_differences()
    assert not differences, _describe(differences)

"""Refuse to serve against a database whose schema is not one this build can work with.

Migrations are applied by the one-shot `migrate` service, never by API workers; in staging/production the
API checks the Alembic revision at startup and exits with an actionable message when it cannot run on it.

The database may be *ahead* of the build only by migrations explicitly marked backward-compatible (a
module-level `backward_compatible = True` in the migration file; the expand/contract rule in
docs/CODING_STANDARDS.md). That is what makes rolling back to the previous image possible after a release
that only added things. An older build does not have the newer migration files, so the migrate service
records every revision's parent and flag in the `schema_compatibility` table, and the guard walks that chain
from the database's revision down to its own head.

    python -m app.schema_guard migrate   the migrate service: alembic upgrade head + record, or nothing when the
                                         database is already ahead by backward-compatible migrations
    python -m app.schema_guard record    record only
"""

import asyncio
import logging
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine, create_async_engine

from app.config import Settings

BACKEND_DIR = Path(__file__).resolve().parent.parent
COMPAT_TABLE = "schema_compatibility"
logger = logging.getLogger("congress.schema")


@dataclass(frozen=True)
class RevisionInfo:
    revision: str
    # Comma-separated parents for a merge revision; None for the first migration.
    down_revision: str | None
    backward_compatible: bool


def _scripts() -> ScriptDirectory:
    config = Config()
    config.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    return ScriptDirectory.from_config(config)


def expected_revision() -> str:
    head = _scripts().get_current_head()
    assert head is not None
    return head


def known_revisions() -> list[RevisionInfo]:
    """Every migration of this build, with the flag read from its module."""
    out = []
    for script in _scripts().walk_revisions():
        down = script.down_revision
        parents = ",".join(down) if isinstance(down, tuple | list) else down
        flag = getattr(script.module, "backward_compatible", False) is True
        out.append(RevisionInfo(script.revision, parents, flag))
    return out


def ahead_compatibly(current: str, head: str, known: set[str], recorded: dict[str, RevisionInfo]) -> bool:
    """True when every revision from `current` down to this build's `head` is recorded as backward-compatible."""
    revision, seen = current, set()
    while revision not in known:
        info = recorded.get(revision)
        if info is None or revision in seen or not info.backward_compatible:
            return False
        if info.down_revision is None or "," in info.down_revision:
            return False
        seen.add(revision)
        revision = info.down_revision
    return revision == head


async def _recorded(connection: AsyncConnection) -> dict[str, RevisionInfo]:
    try:
        rows = (await connection.execute(
            text(f"SELECT revision, down_revision, backward_compatible FROM {COMPAT_TABLE}")
        )).all()
    except Exception:
        await connection.rollback()
        return {}
    return {r: RevisionInfo(r, d, bool(b)) for r, d, b in rows}


SchemaState = Literal["current", "behind", "ahead-compatible", "ahead-incompatible"]


async def schema_state(connection: AsyncConnection) -> tuple[SchemaState, str | None, str]:
    """(state, database revision or None, this build's head)."""
    expected = expected_revision()
    try:
        current = (await connection.execute(text("SELECT version_num FROM alembic_version"))).scalar()
    except Exception:
        current = None
        await connection.rollback()
    if current == expected:
        return "current", current, expected
    known = {info.revision for info in known_revisions()}
    if current is None or current in known:
        return "behind", current, expected
    if ahead_compatibly(current, expected, known, await _recorded(connection)):
        return "ahead-compatible", current, expected
    return "ahead-incompatible", current, expected


async def assert_schema_current(engine: AsyncEngine) -> None:
    async with engine.connect() as connection:
        state, current, expected = await schema_state(connection)
    if state == "current":
        return
    if state == "ahead-compatible":
        logger.warning(
            "Database schema %s is ahead of this build (%s) by backward-compatible migrations only; "
            "serving (rollback mode).", current, expected,
        )
        return
    if state == "ahead-incompatible":
        raise RuntimeError(
            f"Database schema revision is {current}, newer than this build ({expected}), and not every "
            "migration in between is marked backward_compatible. Deploy the build that matches the database "
            f"(this build requires {expected}), or restore a backup taken before the upgrade."
        )
    raise RuntimeError(
        f"Database schema revision is {current or 'missing'}, this build requires {expected}. "
        "Run the migration service (alembic upgrade head) before starting the API."
    )


async def record_compatibility(connection: AsyncConnection) -> None:
    """Write this build's revision chain, so that older builds can tell whether they may run on it."""
    await connection.execute(text(
        f"CREATE TABLE IF NOT EXISTS {COMPAT_TABLE} ("
        "revision varchar(64) PRIMARY KEY, down_revision varchar(200), "
        "backward_compatible boolean NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now())"
    ))
    for info in known_revisions():
        await connection.execute(
            text(
                f"INSERT INTO {COMPAT_TABLE} (revision, down_revision, backward_compatible) VALUES (:r, :d, :b) "
                "ON CONFLICT (revision) DO UPDATE SET down_revision = excluded.down_revision, "
                "backward_compatible = excluded.backward_compatible, recorded_at = now()"
            ),
            {"r": info.revision, "d": info.down_revision, "b": info.backward_compatible},
        )


async def _state_from_env() -> tuple[SchemaState, str | None, str]:
    engine = create_async_engine(Settings().database_url)
    try:
        async with engine.connect() as connection:
            return await schema_state(connection)
    finally:
        await engine.dispose()


async def _record_from_env() -> None:
    engine = create_async_engine(Settings().database_url)
    try:
        async with engine.begin() as connection:
            await record_compatibility(connection)
    finally:
        await engine.dispose()


def migrate() -> None:
    """The migrate service: upgrade to this build's head and record the chain, unless the database is already
    ahead by backward-compatible migrations (an older image after `stack.mjs rollback`), which is left alone."""
    state, current, expected = asyncio.run(_state_from_env())
    if state == "ahead-compatible":
        print(f"schema_guard: database {current} is ahead of this build ({expected}) by backward-compatible "
              "migrations; nothing to migrate")
        return
    if state == "ahead-incompatible":
        raise SystemExit(
            f"schema_guard: database {current} is newer than this build ({expected}) and not backward-compatible "
            "with it; refusing to migrate. Deploy the newer build or restore a backup."
        )
    from alembic import command

    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    command.upgrade(config, "head")
    asyncio.run(_record_from_env())
    print(f"schema_guard: database at {expected}; revision chain recorded")


if __name__ == "__main__":
    if sys.argv[1:] == ["migrate"]:
        migrate()
    elif sys.argv[1:] == ["record"]:
        asyncio.run(_record_from_env())
        print(f"schema_guard: recorded the revision chain up to {expected_revision()}")
    else:
        raise SystemExit("usage: python -m app.schema_guard migrate | record")

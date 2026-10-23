"""The API runs on its own schema head, or on a newer one reached only by backward-compatible migrations."""

import uuid
from collections.abc import AsyncIterator

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from app.schema_guard import (
    COMPAT_TABLE,
    RevisionInfo,
    ahead_compatibly,
    assert_schema_current,
    expected_revision,
    known_revisions,
    record_compatibility,
    schema_state,
)
from tests.conftest import TEST_URL


def test_known_revisions_form_one_chain_ending_at_head() -> None:
    revisions = known_revisions()
    head = expected_revision()
    assert revisions[0].revision == head
    by_id = {r.revision: r for r in revisions}
    walked: list[str] = []
    revision: str | None = head
    while revision is not None:
        walked.append(revision)
        revision = by_id[revision].down_revision
    assert len(walked) == len(revisions)
    # Nothing is backward-compatible unless its migration says so.
    assert all(r.backward_compatible is False for r in revisions if r.revision <= "0018")


def chain(*links: tuple[str, str, bool]) -> dict[str, RevisionInfo]:
    return {r: RevisionInfo(r, d, ok) for r, d, ok in links}


def test_ahead_compatibly_walks_the_recorded_chain_down_to_this_head() -> None:
    known = {"0017", "0018"}
    assert ahead_compatibly("0019", "0018", known, chain(("0019", "0018", True)))
    assert ahead_compatibly("0020", "0018", known, chain(("0020", "0019", True), ("0019", "0018", True)))
    # One incompatible step anywhere in between refuses.
    assert not ahead_compatibly("0020", "0018", known, chain(("0020", "0019", True), ("0019", "0018", False)))
    # Unknown to the database's record (an older migrate service did not record it).
    assert not ahead_compatibly("0019", "0018", known, {})
    # The chain reaches a revision this build knows, but not its head: the database is on another branch.
    assert not ahead_compatibly("0019", "0018", known, chain(("0019", "0017", True)))
    # Merges and loops are refused rather than guessed.
    assert not ahead_compatibly("0019", "0018", known, chain(("0019", "0018,0017x", True)))
    assert not ahead_compatibly("0019", "0018", known, chain(("0019", "0020", True), ("0020", "0019", True)))


@pytest.fixture
async def isolated_schema() -> AsyncIterator[AsyncEngine]:
    """An engine whose search_path is a throw-away schema with its own alembic_version table."""
    schema = f"guard_{uuid.uuid4().hex[:8]}"
    admin = create_async_engine(TEST_URL)
    async with admin.begin() as connection:
        await connection.execute(text(f"CREATE SCHEMA {schema}"))
        await connection.execute(text(f"CREATE TABLE {schema}.alembic_version (version_num varchar(32) PRIMARY KEY)"))
    engine = create_async_engine(TEST_URL, connect_args={"server_settings": {"search_path": schema}})
    try:
        yield engine
    finally:
        await engine.dispose()
        async with admin.begin() as connection:
            await connection.execute(text(f"DROP SCHEMA {schema} CASCADE"))
        await admin.dispose()


async def set_state(engine: AsyncEngine, version: str, *recorded: tuple[str, str, bool]) -> None:
    async with engine.begin() as connection:
        await connection.execute(text("DELETE FROM alembic_version"))
        await connection.execute(text("INSERT INTO alembic_version VALUES (:v)"), {"v": version})
        await record_compatibility(connection)
        for revision, down, ok in recorded:
            await connection.execute(
                text(f"INSERT INTO {COMPAT_TABLE} (revision, down_revision, backward_compatible) VALUES (:r, :d, :b) "
                     "ON CONFLICT (revision) DO UPDATE SET down_revision = :d, backward_compatible = :b"),
                {"r": revision, "d": down, "b": ok},
            )


async def test_database_ahead_by_backward_compatible_migrations_is_served(isolated_schema: AsyncEngine) -> None:
    head = expected_revision()
    await set_state(isolated_schema, "future_a", ("future_a", head, True))
    await assert_schema_current(isolated_schema)

    await set_state(isolated_schema, "future_b", ("future_b", "future_a", True), ("future_a", head, True))
    await assert_schema_current(isolated_schema)


async def test_database_ahead_by_an_unmarked_migration_is_refused(isolated_schema: AsyncEngine) -> None:
    head = expected_revision()
    await set_state(isolated_schema, "future_b", ("future_b", "future_a", True), ("future_a", head, False))
    with pytest.raises(RuntimeError, match=f"newer than this build \\({head}\\)"):
        await assert_schema_current(isolated_schema)
    # Without any record (the newer build's migrate service never recorded it) the answer is also no.
    async with isolated_schema.begin() as connection:
        await connection.execute(text(f"DROP TABLE {COMPAT_TABLE}"))
    with pytest.raises(RuntimeError, match="not every migration in between is marked backward_compatible"):
        await assert_schema_current(isolated_schema)


async def test_database_behind_or_at_head(isolated_schema: AsyncEngine) -> None:
    head = expected_revision()
    await set_state(isolated_schema, head)
    await assert_schema_current(isolated_schema)
    older = known_revisions()[1].revision
    await set_state(isolated_schema, older)
    with pytest.raises(RuntimeError, match=f"is {older}, this build requires {head}"):
        await assert_schema_current(isolated_schema)


async def test_record_writes_the_whole_chain_with_flags(isolated_schema: AsyncEngine) -> None:
    await set_state(isolated_schema, expected_revision())
    async with isolated_schema.connect() as connection:
        rows = (await connection.execute(text(f"SELECT revision, down_revision, backward_compatible FROM {COMPAT_TABLE}"))).all()
    assert {r for r, _, _ in rows} == {info.revision for info in known_revisions()}
    assert {(r, d, b) for r, d, b in rows} == {(i.revision, i.down_revision, i.backward_compatible) for i in known_revisions()}


async def test_schema_state_tells_the_migrate_service_what_to_do(isolated_schema: AsyncEngine) -> None:
    head = expected_revision()
    await set_state(isolated_schema, "future_a", ("future_a", head, True))
    async with isolated_schema.connect() as connection:
        assert await schema_state(connection) == ("ahead-compatible", "future_a", head)
    await set_state(isolated_schema, "future_a", ("future_a", head, False))
    async with isolated_schema.connect() as connection:
        assert (await schema_state(connection))[0] == "ahead-incompatible"
    async with isolated_schema.begin() as connection:
        await connection.execute(text("DROP TABLE alembic_version"))
    async with isolated_schema.connect() as connection:
        assert await schema_state(connection) == ("behind", None, head)

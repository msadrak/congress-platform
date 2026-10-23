"""Populated 0011 expansion proof on the disposable pytest database only."""
import os
import subprocess
import sys
import uuid
from pathlib import Path
from typing import Any

import asyncpg
import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy.engine import make_url

from tests.conftest import ADMIN_DSN, BACKEND_DIR, TEST_URL, _truncate_all, disposable_target_problem


async def verify_populated_expansion(url: str) -> None:
    """Seed 0011, upgrade once, and compare all historical data without secrets in logs."""
    conn = await asyncpg.connect(url.replace("+asyncpg", ""))
    try:
        assert await conn.fetchval("SELECT version_num FROM alembic_version") == "0011"
        organizer_id, event_id, tier_id = (uuid.uuid4() for _ in range(3))
        await conn.execute(
            "INSERT INTO organizers(id,name,api_key_hash) VALUES($1,'Migration','synthetic-key-hash')",
            organizer_id,
        )
        await conn.execute(
            "INSERT INTO events(id,organizer_id,name,slug,starts_at,ends_at,location,description) "
            "VALUES($1,$2,'Migration',$3,now(),now(),'Fixture','')",
            event_id, organizer_id, f"migration-{uuid.uuid4().hex}",
        )
        await conn.execute(
            "INSERT INTO ticket_tiers(id,event_id,name,description,quota,is_open,reserved_count) "
            "VALUES($1,$2,'Fixture','',10,true,2)", tier_id, event_id,
        )
        for revoked in (False, True):
            user_id, operator_id, ticket_id, qr_id = (uuid.uuid4() for _ in range(4))
            await conn.execute(
                "INSERT INTO users(id,email,password_hash,full_name,organization,title) "
                "VALUES($1,$2,'synthetic-password-hash','Historical operator','','')",
                user_id, f"{user_id}@example.com",
            )
            await conn.execute(
                "INSERT INTO desk_operators(id,event_id,user_id,operator_name,is_revoked,revoked_at) "
                "VALUES($1,$2,$3,'Historical operator',$4,CASE WHEN $4 THEN now() ELSE NULL END)",
                operator_id, event_id, user_id, revoked,
            )
            await conn.execute(
                "INSERT INTO tickets(id,event_id,ticket_tier_id,user_id,status,issued_by_operator_id) "
                "VALUES($1,$2,$3,$4,'active',$5)", ticket_id, event_id, tier_id, user_id, operator_id,
            )
            await conn.execute(
                "INSERT INTO entity_qrs(id,secret,entity_type,entity_id,is_active) "
                "VALUES($1,$2,'attendee_ticket',$3,true)", qr_id, uuid.uuid4().hex, ticket_id,
            )
        tables = [row["tablename"] for row in await conn.fetch(
            "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> 'alembic_version' ORDER BY tablename",
        )]
        before: dict[str, list[dict[str, Any]]] = {}
        for table in tables:
            before[table] = [dict(row) for row in await conn.fetch(f'SELECT * FROM "{table}" ORDER BY id')]
    finally:
        await conn.close()
    # Alembic uses its environment override, not the Config URL.
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "0012"], cwd=BACKEND_DIR,
        env={**os.environ, "CONGRESS_DATABASE_URL": url}, capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    conn = await asyncpg.connect(url.replace("+asyncpg", ""))
    try:
        assert await conn.fetchval("SELECT version_num FROM alembic_version") == "0012"
        for table in tables:
            after = [dict(row) for row in await conn.fetch(f'SELECT * FROM "{table}" ORDER BY id')]
            if table == "desk_operators":
                assert [row.pop("session_version") for row in after] == [0, 0]
            assert after == before[table], f"Historical {table} data changed"
        column = await conn.fetchrow(
            "SELECT is_nullable,column_default,data_type FROM information_schema.columns "
            "WHERE table_name='desk_operators' AND column_name='session_version'",
        )
        assert column is not None
        assert column["is_nullable"] == "NO"
        assert column["data_type"] == "integer"
        assert column["column_default"] == "0"
        new_user, new_operator = uuid.uuid4(), uuid.uuid4()
        await conn.execute(
            "INSERT INTO users(id,email,password_hash,full_name,organization,title) "
            "VALUES($1,$2,'synthetic','New operator','','')", new_user, f"{new_user}@example.com",
        )
        version = await conn.fetchval(
            "INSERT INTO desk_operators(id,event_id,user_id,operator_name) "
            "VALUES($1,$2,$3,'New operator') RETURNING session_version", new_operator, event_id, new_user,
        )
        assert version == 0
        with pytest.raises(asyncpg.NotNullViolationError):
            await conn.execute("UPDATE desk_operators SET session_version=NULL WHERE id=$1", new_operator)
        with pytest.raises(asyncpg.CheckViolationError):
            await conn.execute("UPDATE desk_operators SET session_version=-1 WHERE id=$1", new_operator)
        await conn.execute("UPDATE desk_operators SET session_version=9 WHERE id=$1", new_operator)
        print("Populated 0011 -> 0012: 2 historical operators, 2 attributed tickets and QRs preserved; "
              "all 15 historical tables unchanged; backfill/default0, NOT NULL, negative rejection PASS")
    finally:
        await conn.close()


async def test_populated_desk_session_expansion_is_additive() -> None:
    # This fixture database is explicitly disposable; no other database is touched.
    assert disposable_target_problem(make_url(TEST_URL), make_url(ADMIN_DSN)) is None
    await _truncate_all()
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "downgrade", "0011"], cwd=BACKEND_DIR,
        env={**os.environ, "CONGRESS_DATABASE_URL": TEST_URL}, capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    try:
        await verify_populated_expansion(TEST_URL)
    finally:
        # Later tests expect the current schema.
        restored = subprocess.run(
            [sys.executable, "-m", "alembic", "upgrade", "head"], cwd=BACKEND_DIR,
            env={**os.environ, "CONGRESS_DATABASE_URL": TEST_URL}, capture_output=True, text=True,
        )
        assert restored.returncode == 0, restored.stdout + restored.stderr


def test_desk_session_migration_has_one_linear_head() -> None:
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    scripts = ScriptDirectory.from_config(config)
    assert scripts.get_heads() == ["0021"]
    revisions = list(scripts.walk_revisions())
    assert [revision.revision for revision in revisions] == ["0021", "0023", *(f"{number:04d}" for number in range(20, 0, -1))]
    desk_session = scripts.get_revision("0012")
    assert desk_session is not None and desk_session.down_revision == "0011"
    assert len(list(Path(BACKEND_DIR / "migrations" / "versions").glob("0012_*.py"))) == 1

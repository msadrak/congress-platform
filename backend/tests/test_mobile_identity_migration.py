"""0014 -> 0015 on populated data (disposable pytest database only): accounts, roles and tickets survive."""

import os
import subprocess
import sys
import uuid

import asyncpg
from sqlalchemy.engine import make_url

from tests.conftest import ADMIN_DSN, BACKEND_DIR, TEST_URL, _truncate_all, disposable_target_problem


def alembic(*args: str) -> None:
    result = subprocess.run(
        [sys.executable, "-m", "alembic", *args], cwd=BACKEND_DIR,
        env={**os.environ, "CONGRESS_DATABASE_URL": TEST_URL}, capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr


async def columns(conn: asyncpg.Connection, table: str) -> set[str]:
    rows = await conn.fetch("SELECT column_name FROM information_schema.columns WHERE table_name=$1", table)
    return {row["column_name"] for row in rows}


async def test_mobile_identity_migration_keeps_accounts_and_drops_email_and_passwords() -> None:
    assert disposable_target_problem(make_url(TEST_URL), make_url(ADMIN_DSN)) is None
    await _truncate_all()
    alembic("downgrade", "0014")
    try:
        conn = await asyncpg.connect(TEST_URL.replace("+asyncpg", ""))
        try:
            organizer_id, event_id, tier_id, user_id, ticket_id = (uuid.uuid4() for _ in range(5))
            await conn.execute(
                "INSERT INTO organizers(id,name,api_key_hash) VALUES($1,'Migration','synthetic-key-hash')", organizer_id
            )
            await conn.execute(
                "INSERT INTO events(id,organizer_id,name,slug,starts_at,ends_at,location,description) "
                "VALUES($1,$2,'Migration',$3,now(),now(),'Fixture','')",
                event_id, organizer_id, f"migration-{uuid.uuid4().hex}",
            )
            await conn.execute(
                "INSERT INTO ticket_tiers(id,event_id,name,description,quota,is_open,reserved_count) "
                "VALUES($1,$2,'Fixture','',10,true,1)", tier_id, event_id,
            )
            await conn.execute(
                "INSERT INTO users(id,email,password_hash,full_name,organization,title,share_contact_with_peers) "
                "VALUES($1,'historic@example.com','synthetic-hash','Historic Attendee','Org','Dr',true)", user_id,
            )
            await conn.execute(
                "INSERT INTO tickets(id,event_id,ticket_tier_id,user_id,status) VALUES($1,$2,$3,$4,'active')",
                ticket_id, event_id, tier_id, user_id,
            )
        finally:
            await conn.close()

        alembic("upgrade", "0015")

        conn = await asyncpg.connect(TEST_URL.replace("+asyncpg", ""))
        try:
            user = await conn.fetchrow("SELECT * FROM users WHERE id=$1", user_id)
            assert user is not None
            assert dict(user) | {"created_at": None} == {
                "id": user_id, "mobile": None, "full_name": "Historic Attendee", "organization": "Org",
                "title": "Dr", "share_contact_with_peers": True, "created_at": None,
            }
            assert await conn.fetchval("SELECT user_id FROM tickets WHERE id=$1", ticket_id) == user_id
            assert {"email", "password_hash"}.isdisjoint(await columns(conn, "users"))
            assert {"otp_challenges", "sms_messages"} <= {
                row["tablename"] for row in await conn.fetch("SELECT tablename FROM pg_tables WHERE schemaname='public'")
            }
            await conn.execute("UPDATE users SET mobile='09121234567' WHERE id=$1", user_id)
            other = uuid.uuid4()
            try:
                await conn.execute(
                    "INSERT INTO users(id,mobile,full_name,organization,title) VALUES($1,'09121234567','Dup','','')", other
                )
                raise AssertionError("duplicate mobile accepted")
            except asyncpg.UniqueViolationError:
                pass
            # Several accounts without a number (walk-ins) are allowed.
            for _ in range(2):
                await conn.execute(
                    "INSERT INTO users(id,full_name,organization,title) VALUES($1,'Walk-in','','')", uuid.uuid4()
                )
        finally:
            await conn.close()

        alembic("downgrade", "0014")
        conn = await asyncpg.connect(TEST_URL.replace("+asyncpg", ""))
        try:
            restored = await conn.fetchrow("SELECT email, password_hash FROM users WHERE id=$1", user_id)
            assert restored is not None and restored["email"] == f"user-{user_id}@migrated.invalid"
            assert "mobile" not in await columns(conn, "users")
        finally:
            await conn.close()
    finally:
        await _truncate_all()
        alembic("upgrade", "head")

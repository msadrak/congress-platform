"""Migration 0013 keeps every existing congress public; it runs only against the disposable test database."""

import asyncio
import json
import uuid
from pathlib import Path

import asyncpg
from alembic import command
from httpx import ASGITransport, AsyncClient

from app.main import create_app
from tests.conftest import TEST_URL, _truncate_all, alembic_config, make_test_settings

SLUG = f"legacy-{uuid.uuid4().hex[:8]}"


async def _seed_legacy_event() -> uuid.UUID:
    conn = await asyncpg.connect(TEST_URL.replace("+asyncpg", ""))
    try:
        assert await conn.fetchval("SELECT version_num FROM alembic_version") == "0012"
        organizer_id, event_id = uuid.uuid4(), uuid.uuid4()
        await conn.execute(
            "INSERT INTO organizers(id,name,api_key_hash) VALUES($1,'Legacy','legacy-key-hash')", organizer_id
        )
        await conn.execute(
            "INSERT INTO events(id,organizer_id,name,slug,starts_at,ends_at,location,description) "
            "VALUES($1,$2,'Legacy Congress',$3,now(),now() + interval '1 day','Hall','Before Page Studio')",
            event_id, organizer_id, SLUG,
        )
        return event_id
    finally:
        await conn.close()


async def _page_row(event_id: uuid.UUID) -> asyncpg.Record:
    conn = await asyncpg.connect(TEST_URL.replace("+asyncpg", ""))
    try:
        row = await conn.fetchrow("SELECT * FROM event_pages WHERE event_id = $1", event_id)
        assert row is not None
        return row
    finally:
        await conn.close()


async def _public_status(media_root: Path) -> tuple[int, dict[str, object]]:
    app = create_app(make_test_settings(media_root))
    async with app.router.lifespan_context(app):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as http:
            response = await http.get(f"/api/public/events/{SLUG}")
            return response.status_code, response.json()


def test_existing_events_are_published_with_their_previous_layout(tmp_path: Path) -> None:
    asyncio.run(_truncate_all())
    command.downgrade(alembic_config(), "0012")
    try:
        event_id = asyncio.run(_seed_legacy_event())
        command.upgrade(alembic_config(), "head")

        row = asyncio.run(_page_row(event_id))
        status, body = asyncio.run(_public_status(tmp_path))
    finally:
        command.upgrade(alembic_config(), "head")

    assert row["published_at"] is not None
    assert row["draft_revision"] == row["published_revision"] == 1
    draft, published = json.loads(row["draft"]), json.loads(row["published"])
    assert draft == published
    assert [s["type"] for s in published["sections"]] == ["about", "highlights", "passes", "exhibitors"]
    assert status == 200
    assert body["description"] == "Before Page Studio"

"""Server-side head metadata for crawlers, and the API's refusal to run against an outdated schema."""

import copy
from pathlib import Path

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import create_async_engine

from app.schema_guard import assert_schema_current, expected_revision
from tests.conftest import TEST_URL
from tests.helpers import bearer, provision_organizer, publish_page
from tests.test_booths import BOOTH_PAYLOAD
from tests.test_events import EVENT
from tests.test_page_media import image_bytes, upload
from tests.test_ticket_tiers import create_event


async def test_unpublished_and_unknown_congresses_get_neutral_noindex_heads(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    await create_event(client, organizer)

    unpublished = await client.get(f"/api/public/seo/e/{EVENT['slug']}")
    unknown = await client.get("/api/public/seo/e/does-not-exist")

    assert unpublished.status_code == unknown.status_code == 200
    assert unpublished.text == unknown.text
    assert "noindex" in unpublished.text
    assert EVENT["name"] not in unpublished.text


async def test_published_head_uses_page_studio_seo_escaped_with_absolute_image(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    asset_id = (await upload(client, organizer, event_id, image_bytes())).json()["id"]
    state = (await client.get(f"/api/events/{event_id}/page", headers=bearer(organizer))).json()
    document = copy.deepcopy(state["draft"])
    document["primary_locale"] = "en"
    document["seo"] = {
        "title": {"en": 'Spring "Congress" <2027>', "fa": ""},
        "description": {"en": "Talks & <script>alert(1)</script> workshops", "fa": ""},
        "share_image_asset_id": asset_id,
    }
    await client.put(f"/api/events/{event_id}/page", json={"revision": state["draft_revision"], "document": document}, headers=bearer(organizer))
    await publish_page(client, organizer, event_id)
    # A later draft edit must not reach the crawler head.
    draft = (await client.get(f"/api/events/{event_id}/page", headers=bearer(organizer))).json()
    secret = copy.deepcopy(draft["draft"])
    secret["seo"]["title"]["en"] = "Unannounced title"
    await client.put(f"/api/events/{event_id}/page", json={"revision": draft["draft_revision"], "document": secret}, headers=bearer(organizer))

    head = (await client.get(f"/api/public/seo/e/{EVENT['slug']}")).text

    assert "<title>Spring &quot;Congress&quot; &lt;2027&gt;</title>" in head
    assert "&lt;script&gt;" in head and "<script>" not in head
    assert f'content="http://test/api/public/media/{asset_id}"' in head
    assert '<link rel="canonical" href="http://test/e/spring-congress-2027" />' in head
    assert "noindex" not in head
    assert "Unannounced" not in head


async def test_booth_head_only_for_booths_of_published_congresses(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    booth = (await client.post(f"/api/events/{event_id}/booths", json=BOOTH_PAYLOAD, headers=bearer(organizer))).json()
    path = f"/api/public/seo/e/{EVENT['slug']}/booths/{booth['id']}"

    before = (await client.get(path)).text
    await publish_page(client, organizer, event_id)
    after = (await client.get(path)).text

    assert BOOTH_PAYLOAD["name"] not in before and "noindex" in before
    assert f"<title>{BOOTH_PAYLOAD['name']} · {EVENT['name']}</title>" in after
    assert "noindex" in (await client.get(f"/api/public/seo/e/{EVENT['slug']}/booths/not-a-uuid")).text


async def test_schema_guard_accepts_head_and_refuses_anything_else(tmp_path: Path) -> None:
    engine = create_async_engine(TEST_URL)
    try:
        await assert_schema_current(engine)  # the session fixture migrated to head
    finally:
        await engine.dispose()
    assert expected_revision() == "0015"
    missing = create_async_engine(TEST_URL.rsplit("/", 1)[0] + "/postgres")
    try:
        with pytest.raises(RuntimeError, match="requires 0015"):
            await assert_schema_current(missing)
    finally:
        await missing.dispose()

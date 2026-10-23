"""The booth page edited by its representatives (description, links, logo), and booth logos everywhere.

Representatives change the description, website, brochure and logo; the name, page address and stand stay the
organizer's. Logos are event images: public while the event's page is published, deleted when replaced unless
the page or another booth still uses them.
"""

import asyncio
import copy
import io
import uuid
from pathlib import Path
from typing import Any

import asyncpg
import pytest
from alembic import command
from fastapi import FastAPI
from httpx import AsyncClient
from PIL import Image
from sqlalchemy import select

from app.media import resolve_storage_path
from app.models import AuditEvent, MediaAsset
from tests.conftest import ADMIN_TOKEN, TEST_URL, _truncate_all, alembic_config, assert_test_database_identity
from tests.exhibitors import Congress, setup_congress
from tests.helpers import bearer, provision_organizer
from tests.test_booths import BOOTH_PAYLOAD
from tests.test_events import EVENT

ADMIN = {"X-Admin-Token": ADMIN_TOKEN}


def image_bytes(fmt: str = "PNG", size: tuple[int, int] = (48, 48)) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", size, (32, 0, 205)).save(out, fmt)
    return out.getvalue()


SVG = b'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>'


async def put_logo(client: AsyncClient, congress: Congress, data: bytes, content_type: str = "image/png") -> Any:
    return await client.put(
        f"/api/booths/{congress.booth_id}/logo", content=data, headers={**congress.staff, "Content-Type": content_type}
    )


async def patch_profile(client: AsyncClient, congress: Congress, body: dict[str, Any], headers: dict[str, str] | None = None) -> Any:
    return await client.patch(f"/api/booths/{congress.booth_id}/profile", json=body, headers=headers or congress.staff)


async def assets_of(app: FastAPI, event_id: str) -> list[MediaAsset]:
    async with app.state.sessionmaker() as session:
        return list(await session.scalars(select(MediaAsset).where(MediaAsset.event_id == event_id)))


async def organizer_booth(client: AsyncClient, congress: Congress) -> dict[str, Any]:
    listed = await client.get(f"/api/events/{congress.event_id}/booths", headers=bearer(congress.organizer))
    assert listed.status_code == 200, listed.text
    booth: dict[str, Any] = next(b for b in listed.json() if b["id"] == congress.booth_id)
    return booth


async def test_representatives_edit_the_description_and_links_but_not_the_name_address_or_stand(
    client: AsyncClient, app: FastAPI
) -> None:
    congress = await setup_congress(client)

    saved = await patch_profile(
        client,
        congress,
        {"description": "  Imaging for every clinic.  ", "website_url": " https://example.com ", "brochure_url": ""},
    )
    assert saved.status_code == 200, saved.text
    body = saved.json()
    assert body["description"] == "Imaging for every clinic."
    assert body["website_url"] == "https://example.com"
    assert body["brochure_url"] == ""
    assert body["name"] == BOOTH_PAYLOAD["name"] and body["location"] == BOOTH_PAYLOAD["location"]

    # Omitted fields keep their value.
    kept = await patch_profile(client, congress, {"brochure_url": "https://example.com/b.pdf"})
    assert kept.json()["description"] == "Imaging for every clinic."

    for field, value in (("name", "Renamed"), ("slug", "renamed"), ("location", "Hall 9")):
        refused = await patch_profile(client, congress, {field: value})
        assert refused.status_code == 422, (field, refused.text)
    assert (await organizer_booth(client, congress))["name"] == BOOTH_PAYLOAD["name"]

    async with app.state.sessionmaker() as session:
        audit = list(await session.scalars(select(AuditEvent).where(AuditEvent.action == "booth.page_updated")))
    assert len(audit) == 2
    assert {row.actor_type for row in audit} == {"booth_staff"}
    assert audit[0].entity_id == congress.booth_id
    assert str(audit[0].event_id) == congress.event_id
    assert audit[0].organizer_id is not None


@pytest.mark.parametrize(
    "link",
    ["javascript:alert(1)", "data:text/html,x", "//evil.example", "example.com", "https://" + "a" * 500 + ".com"],
)
async def test_bad_links_are_refused(client: AsyncClient, link: str) -> None:
    congress = await setup_congress(client)
    for field in ("website_url", "brochure_url"):
        response = await patch_profile(client, congress, {field: link})
        assert response.status_code == 422, (field, link, response.text)
    assert (await patch_profile(client, congress, {"description": "x" * 2001})).status_code == 422


async def test_only_the_booths_current_representatives_on_an_open_congress_edit_its_page(client: AsyncClient) -> None:
    congress = await setup_congress(client)
    other = await setup_congress(
        client, organizer=congress.organizer, slug="other-congress", staff_mobile="09121000811", attendee_mobile="09121000812"
    )

    # Another booth's representative, and an attendee.
    for headers in (other.staff, congress.attendee):
        for response in (
            await patch_profile(client, congress, {"description": "x"}, headers=headers),
            await client.put(f"/api/booths/{congress.booth_id}/logo", content=image_bytes(), headers={**headers, "Content-Type": "image/png"}),
            await client.delete(f"/api/booths/{congress.booth_id}/logo", headers=headers),
        ):
            assert response.status_code == 403, response.text
            assert response.json()["code"] == "BOOTH_STAFF_REQUIRED"

    # An archived congress: read-only.
    archived = await client.post(
        f"/api/events/{congress.event_id}/archive", json={"archived": True}, headers=bearer(congress.organizer)
    )
    assert archived.status_code == 200, archived.text
    for response in (
        await patch_profile(client, congress, {"description": "x"}),
        await put_logo(client, congress, image_bytes()),
        await client.delete(f"/api/booths/{congress.booth_id}/logo", headers=congress.staff),
    ):
        assert response.status_code == 409, response.text
        assert response.json()["code"] == "EVENT_ARCHIVED"
    await client.post(f"/api/events/{congress.event_id}/archive", json={"archived": False}, headers=bearer(congress.organizer))
    assert (await patch_profile(client, congress, {"description": "open again"})).status_code == 200

    # A suspended organizer.
    revoked = await client.post(f"/api/organizers/{congress.organizer['id']}/revoke", headers=ADMIN)
    assert revoked.status_code == 200, revoked.text
    suspended = await patch_profile(client, congress, {"description": "x"})
    assert suspended.status_code == 403
    assert suspended.json()["code"] == "BOOTH_ACCESS_SUSPENDED"


async def test_a_removed_representative_is_refused_at_once(client: AsyncClient) -> None:
    congress = await setup_congress(client)
    removed = await client.delete(
        f"/api/events/{congress.event_id}/booths/{congress.booth_id}/staff/{congress.staff_assignment['id']}",
        headers=bearer(congress.organizer),
    )
    assert removed.status_code == 204, removed.text
    response = await patch_profile(client, congress, {"description": "x"})
    assert response.status_code == 403
    assert response.json()["code"] == "BOOTH_STAFF_REQUIRED"


@pytest.mark.parametrize(("fmt", "content_type"), [("PNG", "image/png"), ("JPEG", "image/jpeg"), ("WEBP", "image/webp")])
async def test_a_logo_is_re_encoded_and_shown_everywhere_the_booth_is(
    client: AsyncClient, app: FastAPI, media_root: Path, fmt: str, content_type: str
) -> None:
    congress = await setup_congress(client)
    raw = image_bytes(fmt)

    uploaded = await put_logo(client, congress, raw, content_type)
    assert uploaded.status_code == 200, uploaded.text
    body = uploaded.json()
    assert body["logo_asset_id"]
    logo_url = f"/api/public/media/{body['logo_asset_id']}"
    assert body["logo_url"] == logo_url

    [asset] = await assets_of(app, congress.event_id)
    assert asset.content_type == content_type
    stored = resolve_storage_path(media_root, asset.storage_key).read_bytes()
    assert stored != raw or fmt == "PNG"  # always this server's encoding; a tiny PNG may come out identical
    with Image.open(io.BytesIO(stored)) as decoded:
        assert decoded.size == (48, 48)

    mine = (await client.get("/api/booths/me", headers=congress.staff)).json()
    assert [b["logo_url"] for b in mine] == [logo_url]
    assert (await client.get(f"/api/booths/{congress.booth_id}", headers=congress.staff)).json()["logo_url"] == logo_url
    assert (await organizer_booth(client, congress))["logo_url"] == logo_url
    directory = (await client.get(f"/api/public/events/{congress.slug}/booths")).json()
    assert [b["logo_url"] for b in directory] == [logo_url]
    public = (await client.get(f"/api/public/events/{congress.slug}/booths/{congress.booth_id}")).json()
    assert public["logo_url"] == logo_url

    served = await client.get(logo_url)
    assert served.status_code == 200
    assert served.headers["content-type"] == content_type
    assert served.headers["cache-control"] == "public, max-age=3600"

    async with app.state.sessionmaker() as session:
        actions = [row.actor_type for row in await session.scalars(select(AuditEvent).where(AuditEvent.action == "booth.logo_updated"))]
    assert actions == ["booth_staff"]


@pytest.mark.parametrize(
    ("data", "content_type", "status", "code"),
    [
        (SVG, "image/svg+xml", 415, "IMAGE_TYPE_UNSUPPORTED"),
        (SVG, "image/png", 415, "IMAGE_REJECTED"),
        (b"not an image at all", "image/jpeg", 415, "IMAGE_REJECTED"),
        (b"", "image/png", 400, "IMAGE_EMPTY"),
        (image_bytes() + b"\0" * (5 * 1024 * 1024), "image/png", 413, "IMAGE_TOO_LARGE"),
    ],
)
async def test_unacceptable_logos_are_refused_with_a_code(
    client: AsyncClient, app: FastAPI, data: bytes, content_type: str, status: int, code: str
) -> None:
    congress = await setup_congress(client)
    response = await put_logo(client, congress, data, content_type)
    assert response.status_code == status, response.text
    assert response.json()["code"] == code
    assert await assets_of(app, congress.event_id) == []
    assert (await organizer_booth(client, congress))["logo_url"] is None


async def test_the_event_image_quota_applies_to_logos(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("app.routes.pages.MAX_ASSETS_PER_EVENT", 1)
    congress = await setup_congress(client)
    organizer_upload = await client.post(
        f"/api/events/{congress.event_id}/media",
        content=image_bytes(),
        headers={**bearer(congress.organizer), "Content-Type": "image/png"},
    )
    assert organizer_upload.status_code == 201, organizer_upload.text

    for response in (
        await put_logo(client, congress, image_bytes()),
        await client.post(
            f"/api/events/{congress.event_id}/media",
            content=image_bytes(),
            headers={**bearer(congress.organizer), "Content-Type": "image/png"},
        ),
    ):
        assert response.status_code == 409, response.text
        assert response.json()["code"] == "MEDIA_LIMIT_REACHED"


async def test_organizer_uploads_answer_with_the_same_codes(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = (await client.post("/api/events", json=EVENT, headers=bearer(organizer))).json()["id"]
    response = await client.post(
        f"/api/events/{event_id}/media", content=SVG, headers={**bearer(organizer), "Content-Type": "image/svg+xml"}
    )
    assert response.status_code == 415
    assert response.json() == {"detail": "Upload a PNG, JPEG or WebP image", "code": "IMAGE_TYPE_UNSUPPORTED"}


async def test_replacing_or_removing_a_logo_deletes_the_old_image(client: AsyncClient, app: FastAPI, media_root: Path) -> None:
    congress = await setup_congress(client)
    first = (await put_logo(client, congress, image_bytes())).json()["logo_asset_id"]
    [first_asset] = await assets_of(app, congress.event_id)
    first_file = resolve_storage_path(media_root, first_asset.storage_key)
    assert first_file.is_file()

    second = (await put_logo(client, congress, image_bytes("JPEG"))).json()["logo_asset_id"]
    assert second != first
    assert [a.id for a in await assets_of(app, congress.event_id)] == [uuid.UUID(second)]
    assert not first_file.exists()
    assert (await client.get(f"/api/public/media/{first}")).status_code == 404

    [second_asset] = await assets_of(app, congress.event_id)
    second_file = resolve_storage_path(media_root, second_asset.storage_key)
    removed = await client.delete(f"/api/booths/{congress.booth_id}/logo", headers=congress.staff)
    assert removed.status_code == 200, removed.text
    assert removed.json()["logo_url"] is None and removed.json()["logo_asset_id"] is None
    assert await assets_of(app, congress.event_id) == []
    assert not second_file.exists()
    # Removing it again changes nothing.
    again = await client.delete(f"/api/booths/{congress.booth_id}/logo", headers=congress.staff)
    assert again.status_code == 200 and again.json()["logo_url"] is None


async def test_a_logo_the_page_also_uses_is_kept_when_replaced(client: AsyncClient, app: FastAPI) -> None:
    congress = await setup_congress(client)
    organizer = bearer(congress.organizer)
    asset_id = (
        await client.post(
            f"/api/events/{congress.event_id}/media", content=image_bytes(), headers={**organizer, "Content-Type": "image/png"}
        )
    ).json()["id"]
    state = (await client.get(f"/api/events/{congress.event_id}/page", headers=organizer)).json()
    document = copy.deepcopy(state["draft"])
    document["hero"]["cover_asset_id"] = asset_id
    document["hero"]["layout"] = "cover"
    saved = await client.put(
        f"/api/events/{congress.event_id}/page", json={"revision": state["draft_revision"], "document": document}, headers=organizer
    )
    assert saved.status_code == 200, saved.text
    set_logo = await client.patch(
        f"/api/events/{congress.event_id}/booths/{congress.booth_id}", json={"logo_asset_id": asset_id}, headers=organizer
    )
    assert set_logo.status_code == 200, set_logo.text

    assert (await put_logo(client, congress, image_bytes())).status_code == 200
    assert asset_id in {str(a.id) for a in await assets_of(app, congress.event_id)}


async def test_organizers_set_and_clear_the_logo_with_an_image_of_their_event(
    client: AsyncClient, app: FastAPI, media_root: Path
) -> None:
    congress = await setup_congress(client)
    organizer = bearer(congress.organizer)

    async def upload(event_id: str) -> Any:
        return await client.post(
            f"/api/events/{event_id}/media", content=image_bytes(), headers={**organizer, "Content-Type": "image/png"}
        )

    asset_id = (await upload(congress.event_id)).json()["id"]
    booth_url = f"/api/events/{congress.event_id}/booths/{congress.booth_id}"

    set_logo = await client.patch(booth_url, json={"logo_asset_id": asset_id}, headers=organizer)
    assert set_logo.status_code == 200, set_logo.text
    assert set_logo.json()["logo_url"] == f"/api/public/media/{asset_id}"
    # Another field alone keeps the logo.
    renamed = await client.patch(booth_url, json={"name": "Renamed"}, headers=organizer)
    assert renamed.json()["logo_asset_id"] == asset_id

    other_event = (await client.post("/api/events", json={**EVENT, "slug": "elsewhere"}, headers=organizer)).json()["id"]
    foreign = (await upload(other_event)).json()["id"]
    for response in (
        await client.patch(booth_url, json={"logo_asset_id": foreign}, headers=organizer),
        await client.post(
            f"/api/events/{congress.event_id}/booths",
            json={**BOOTH_PAYLOAD, "slug": "with-foreign-logo", "logo_asset_id": foreign},
            headers=organizer,
        ),
    ):
        assert response.status_code == 404, response.text
        assert response.json()["code"] == "MEDIA_NOT_FOUND"

    created = await client.post(
        f"/api/events/{congress.event_id}/booths",
        json={**BOOTH_PAYLOAD, "slug": "with-logo", "logo_asset_id": asset_id},
        headers=organizer,
    )
    assert created.status_code == 201, created.text
    assert created.json()["logo_asset_id"] == asset_id

    # Cleared on the first booth: the image stays, the second booth still uses it.
    cleared = await client.patch(booth_url, json={"logo_asset_id": None}, headers=organizer)
    assert cleared.status_code == 200
    assert cleared.json()["logo_url"] is None
    assert asset_id in {str(a.id) for a in await assets_of(app, congress.event_id)}

    # Deleting the image from the media library removes the logo (and the file).
    [asset] = [a for a in await assets_of(app, congress.event_id) if str(a.id) == asset_id]
    path = resolve_storage_path(media_root, asset.storage_key)
    deleted = await client.delete(f"/api/events/{congress.event_id}/media/{asset_id}", headers=organizer)
    assert deleted.status_code == 204, deleted.text
    assert not path.exists()
    listed = (await client.get(f"/api/events/{congress.event_id}/booths", headers=organizer)).json()
    assert {b["slug"]: b["logo_url"] for b in listed}["with-logo"] is None


async def test_the_organizer_replacing_a_logo_deletes_the_unused_one(client: AsyncClient, app: FastAPI) -> None:
    congress = await setup_congress(client)
    organizer = bearer(congress.organizer)
    first = (await put_logo(client, congress, image_bytes())).json()["logo_asset_id"]
    second = (
        await client.post(
            f"/api/events/{congress.event_id}/media", content=image_bytes(), headers={**organizer, "Content-Type": "image/png"}
        )
    ).json()["id"]
    replaced = await client.patch(
        f"/api/events/{congress.event_id}/booths/{congress.booth_id}", json={"logo_asset_id": second}, headers=organizer
    )
    assert replaced.status_code == 200, replaced.text
    assert {str(a.id) for a in await assets_of(app, congress.event_id)} == {second}
    assert first != second


async def test_a_logo_is_public_only_while_the_page_is_published_and_the_congress_open(client: AsyncClient) -> None:
    congress = await setup_congress(client)
    organizer = bearer(congress.organizer)
    logo_url = (await put_logo(client, congress, image_bytes())).json()["logo_url"]
    assert (await client.get(logo_url)).status_code == 200

    await client.post(f"/api/events/{congress.event_id}/page/unpublish", headers=organizer)
    assert (await client.get(logo_url)).status_code == 404
    state = (await client.get(f"/api/events/{congress.event_id}/page", headers=organizer)).json()
    await client.post(f"/api/events/{congress.event_id}/page/publish", json={"revision": state["draft_revision"]}, headers=organizer)
    assert (await client.get(logo_url)).status_code == 200

    await client.post(f"/api/events/{congress.event_id}/archive", json={"archived": True}, headers=organizer)
    assert (await client.get(logo_url)).status_code == 404

    # An image that is no booth's logo and not on the page stays private.
    await client.post(f"/api/events/{congress.event_id}/archive", json={"archived": False}, headers=organizer)
    loose = (
        await client.post(
            f"/api/events/{congress.event_id}/media", content=image_bytes(), headers={**organizer, "Content-Type": "image/png"}
        )
    ).json()["id"]
    assert (await client.get(f"/api/public/media/{loose}")).status_code == 404


async def test_a_booth_without_a_logo_says_null_everywhere(client: AsyncClient) -> None:
    congress = await setup_congress(client)
    assert (await client.get("/api/booths/me", headers=congress.staff)).json()[0]["logo_url"] is None
    assert (await organizer_booth(client, congress))["logo_url"] is None
    assert (await client.get(f"/api/public/events/{congress.slug}/booths")).json()[0]["logo_url"] is None
    public = (await client.get(f"/api/public/events/{congress.slug}/booths/{congress.booth_id}")).json()
    assert public["logo_url"] is None


async def _logo_column_exists() -> bool:
    conn = await asyncpg.connect(TEST_URL.replace("+asyncpg", ""))
    try:
        await assert_test_database_identity(conn)
        found = await conn.fetchval(
            "SELECT count(*) FROM information_schema.columns WHERE table_name = 'booths' AND column_name = 'logo_asset_id'"
        )
        return bool(found)
    finally:
        await conn.close()


def test_the_logo_migration_reverses_cleanly() -> None:
    asyncio.run(_truncate_all())
    try:
        command.downgrade(alembic_config(), "0026")
        assert not asyncio.run(_logo_column_exists())
        command.upgrade(alembic_config(), "0031")
        assert asyncio.run(_logo_column_exists())
    finally:
        command.upgrade(alembic_config(), "head")

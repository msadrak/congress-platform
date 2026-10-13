"""Page Studio images: intake validation, re-encoding, tenant isolation and publication-gated access."""

import copy
import io
from pathlib import Path
from typing import Any

import pytest
from httpx import AsyncClient
from PIL import Image

from app.media import resolve_storage_path
from tests.helpers import bearer, provision_organizer, publish_page
from tests.test_events import EVENT
from tests.test_ticket_tiers import create_event


def image_bytes(fmt: str = "PNG", size: tuple[int, int] = (64, 40), **save: Any) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", size, (32, 0, 205)).save(out, fmt, **save)
    return out.getvalue()


async def upload(
    client: AsyncClient, organizer: dict[str, str], event_id: str, data: bytes, content_type: str = "image/png"
) -> Any:
    return await client.post(
        f"/api/events/{event_id}/media",
        content=data,
        headers={**bearer(organizer), "Content-Type": content_type},
    )


async def use_as_cover(client: AsyncClient, organizer: dict[str, str], event_id: str, asset_id: str | None) -> None:
    state = (await client.get(f"/api/events/{event_id}/page", headers=bearer(organizer))).json()
    document = copy.deepcopy(state["draft"])
    document["hero"]["cover_asset_id"] = asset_id
    document["hero"]["layout"] = "cover"
    saved = await client.put(
        f"/api/events/{event_id}/page",
        json={"revision": state["draft_revision"], "document": document},
        headers=bearer(organizer),
    )
    assert saved.status_code == 200, saved.text


async def test_uploaded_image_is_public_only_once_a_published_page_uses_it(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    created = await upload(client, organizer, event_id, image_bytes())
    assert created.status_code == 201, created.text
    asset = created.json()
    assert (asset["width"], asset["height"], asset["content_type"]) == (64, 40, "image/png")
    public_url = f"/api/public/media/{asset['id']}"

    own = await client.get(f"/api/events/{event_id}/media/{asset['id']}/content", headers=bearer(organizer))
    assert own.status_code == 200 and own.headers["content-type"] == "image/png"
    assert (await client.get(public_url)).status_code == 404

    await use_as_cover(client, organizer, event_id, asset["id"])
    assert (await client.get(public_url)).status_code == 404  # draft only

    await publish_page(client, organizer, event_id)
    public = await client.get(public_url)
    assert public.status_code == 200
    assert public.headers["content-type"] == "image/png"
    assert public.headers["x-content-type-options"] == "nosniff"
    assert "sandbox" in public.headers["content-security-policy"]
    page_assets = (await client.get(f"/api/public/events/{EVENT['slug']}")).json()["page"]["assets"]
    assert page_assets == [
        {"id": asset["id"], "url": public_url, "width": 64, "height": 40, "content_type": "image/png"}
    ]

    await use_as_cover(client, organizer, event_id, None)
    await publish_page(client, organizer, event_id)
    assert (await client.get(public_url)).status_code == 404


@pytest.mark.parametrize(
    ("data", "content_type"),
    [
        (b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', "image/svg+xml"),
        (b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', "image/png"),
        (b"<html><script>alert(1)</script></html>", "image/jpeg"),
        (image_bytes("GIF"), "image/webp"),
        (image_bytes("PNG")[:40], "image/png"),
        (b"", "image/png"),
    ],
)
async def test_only_real_png_jpeg_or_webp_images_are_accepted(
    client: AsyncClient, data: bytes, content_type: str
) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)

    response = await upload(client, organizer, event_id, data, content_type)

    assert response.status_code in (400, 415), response.text
    assert (await client.get(f"/api/events/{event_id}/media", headers=bearer(organizer))).json() == []


async def test_oversized_uploads_are_refused(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)

    response = await upload(client, organizer, event_id, image_bytes() + b"\0" * (5 * 1024 * 1024))

    assert response.status_code == 413


async def test_images_are_re_encoded_without_metadata_and_scaled_down(
    client: AsyncClient, media_root: Path
) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    exif = Image.Exif()
    exif[0x010F] = "PhoneMaker"  # Make
    exif[0x0131] = "SecretSoftware"  # Software
    photo = image_bytes("JPEG", (3600, 1800), exif=exif.tobytes())

    asset = (await upload(client, organizer, event_id, photo, "image/jpeg")).json()

    assert (asset["width"], asset["height"]) == (2400, 1200)
    stored = list(media_root.rglob(f"{asset['id']}.jpg"))
    assert len(stored) == 1 and stored[0].parent.name == event_id
    data = stored[0].read_bytes()
    assert b"Exif" not in data and b"PhoneMaker" not in data and b"SecretSoftware" not in data
    with Image.open(io.BytesIO(data)) as reopened:
        assert reopened.format == "JPEG"


async def test_another_organizer_cannot_touch_the_images(client: AsyncClient) -> None:
    owner = await provision_organizer(client, "Owner Co")
    intruder = await provision_organizer(client, "Intruder Co")
    event_id = await create_event(client, owner)
    asset_id = (await upload(client, owner, event_id, image_bytes())).json()["id"]

    attempts = [
        await upload(client, intruder, event_id, image_bytes()),
        await client.get(f"/api/events/{event_id}/media", headers=bearer(intruder)),
        await client.get(f"/api/events/{event_id}/media/{asset_id}/content", headers=bearer(intruder)),
        await client.delete(f"/api/events/{event_id}/media/{asset_id}", headers=bearer(intruder)),
    ]

    assert [r.status_code for r in attempts] == [404, 404, 404, 404]
    assert len((await client.get(f"/api/events/{event_id}/media", headers=bearer(owner))).json()) == 1


async def test_a_page_cannot_reference_another_events_image(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    other = await client.post(
        "/api/events", json={**EVENT, "slug": "autumn-congress-2027"}, headers=bearer(organizer)
    )
    foreign_asset = (await upload(client, organizer, other.json()["id"], image_bytes())).json()["id"]
    state = (await client.get(f"/api/events/{event_id}/page", headers=bearer(organizer))).json()
    document = copy.deepcopy(state["draft"])
    document["branding"]["logo_asset_id"] = foreign_asset

    response = await client.put(
        f"/api/events/{event_id}/page",
        json={"revision": state["draft_revision"], "document": document},
        headers=bearer(organizer),
    )

    assert response.status_code == 400
    assert "not one of this event's images" in response.text


async def test_images_in_use_cannot_be_deleted(client: AsyncClient, media_root: Path) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    used = (await upload(client, organizer, event_id, image_bytes())).json()["id"]
    unused = (await upload(client, organizer, event_id, image_bytes("WEBP"), "image/webp")).json()["id"]
    await use_as_cover(client, organizer, event_id, used)

    blocked = await client.delete(f"/api/events/{event_id}/media/{used}", headers=bearer(organizer))
    deleted = await client.delete(f"/api/events/{event_id}/media/{unused}", headers=bearer(organizer))

    assert blocked.status_code == 409
    assert deleted.status_code == 204
    remaining = (await client.get(f"/api/events/{event_id}/media", headers=bearer(organizer))).json()
    assert [a["id"] for a in remaining] == [used]
    assert not list(media_root.rglob(f"{unused}.*"))


def test_storage_paths_cannot_escape_the_media_root(tmp_path: Path) -> None:
    assert resolve_storage_path(tmp_path, "event/asset.png") == (tmp_path / "event" / "asset.png").resolve()
    for key in ("../outside.png", "event/../../outside.png", "/etc/passwd"):
        with pytest.raises(ValueError):
            resolve_storage_path(tmp_path, key)

"""Page Studio images: intake validation, re-encoding, tenant isolation and publication-gated access."""

import copy
import io
import struct
import zlib
from pathlib import Path
from typing import Any

import pytest
from httpx import AsyncClient
from PIL import Image, PngImagePlugin

from app.media import resolve_storage_path
from tests.helpers import bearer, provision_organizer, publish_page
from tests.test_events import EVENT
from tests.test_ticket_tiers import create_event


def image_bytes(fmt: str = "PNG", size: tuple[int, int] = (64, 40), **save: Any) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", size, (32, 0, 205)).save(out, fmt, **save)
    return out.getvalue()


def noisy_bytes(fmt: str, size: tuple[int, int] = (256, 256)) -> bytes:
    """An image whose pixel data is large and incompressible, so cutting the file always cuts pixels."""
    out = io.BytesIO()
    Image.merge("RGB", [Image.effect_noise(size, 80) for _ in range(3)]).save(out, fmt)
    return out.getvalue()


def png_claiming_size(width: int, height: int) -> bytes:
    """A small PNG whose header (with a valid CRC) claims the given dimensions: a decompression-bomb probe."""
    data = bytearray(image_bytes("PNG"))
    assert data[12:16] == b"IHDR"
    data[16:24] = struct.pack(">II", width, height)
    data[29:33] = struct.pack(">I", zlib.crc32(bytes(data[12:29])))
    return bytes(data)


def png_with_corrupt_pixels() -> bytes:
    data = bytearray(noisy_bytes("PNG", (64, 64)))
    idat = data.index(b"IDAT")
    data[idat + 40] ^= 0xFF  # inside the compressed pixel data; the chunk CRC no longer matches
    return bytes(data)


def animated_bytes(fmt: str) -> bytes:
    frames = [Image.new("RGB", (32, 24), colour) for colour in ((255, 0, 0), (0, 0, 255))]
    out = io.BytesIO()
    frames[0].save(out, fmt, save_all=True, append_images=frames[1:], duration=100, loop=0)
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
        (noisy_bytes("PNG")[: len(noisy_bytes("PNG")) // 2], "image/png"),
        (noisy_bytes("JPEG")[: len(noisy_bytes("JPEG")) // 2], "image/jpeg"),
        (noisy_bytes("WEBP")[: len(noisy_bytes("WEBP")) // 2], "image/webp"),
        (png_with_corrupt_pixels(), "image/png"),
        (image_bytes("PNG")[:8] + b"\0" * 4096, "image/png"),
        (image_bytes("BMP"), "image/png"),
        (image_bytes("TIFF"), "image/jpeg"),
        (b"%PDF-1.7\n" + b"\0" * 64, "image/png"),
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


@pytest.mark.parametrize(
    ("width", "height"),
    [
        (7000, 6000),  # 42 MP: over the app's own limit, under Pillow's warning threshold
        (10_000, 10_000),  # 100 MP: Pillow's DecompressionBombWarning, promoted to an error
        (100_000, 100_000),  # 10 GP: Pillow's DecompressionBombError
    ],
)
async def test_images_claiming_too_many_pixels_are_refused_without_decoding(
    client: AsyncClient, media_root: Path, width: int, height: int
) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)

    response = await upload(client, organizer, event_id, png_claiming_size(width, height))

    assert response.status_code == 415, response.text
    assert (await client.get(f"/api/events/{event_id}/media", headers=bearer(organizer))).json() == []
    assert not [p for p in media_root.rglob("*") if p.is_file()]


@pytest.mark.parametrize(
    ("fmt", "content_type", "extension", "metadata"),
    [
        ("PNG", "image/png", "png", "pnginfo"),
        ("JPEG", "image/jpeg", "jpg", "exif"),
        ("WEBP", "image/webp", "webp", "exif"),
    ],
)
async def test_each_accepted_format_is_re_encoded_without_its_metadata(
    client: AsyncClient, media_root: Path, fmt: str, content_type: str, extension: str, metadata: str
) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    exif = Image.Exif()
    exif[0x010F] = "PhoneMaker"  # Make
    exif[0x0131] = "SecretSoftware"  # Software
    if metadata == "pnginfo":
        info = PngImagePlugin.PngInfo()
        info.add_text("Software", "SecretSoftware")
        info.add_itxt("Comment", "PhoneMaker GPS 35.68N 51.38E")
        uploaded = image_bytes(fmt, pnginfo=info, exif=exif.tobytes())
    else:
        uploaded = image_bytes(fmt, exif=exif.tobytes())
    assert b"SecretSoftware" in uploaded

    created = await upload(client, organizer, event_id, uploaded, content_type)

    assert created.status_code == 201, created.text
    asset = created.json()
    assert (asset["width"], asset["height"], asset["content_type"]) == (64, 40, content_type)
    stored = list(media_root.rglob(f"{asset['id']}.{extension}"))
    assert len(stored) == 1
    data = stored[0].read_bytes()
    assert data != uploaded
    assert b"PhoneMaker" not in data and b"SecretSoftware" not in data
    with Image.open(io.BytesIO(data)) as reopened:
        assert reopened.format == fmt
        assert reopened.size == (64, 40)
        assert not reopened.getexif()
        assert "exif" not in reopened.info and "Software" not in reopened.info


async def test_orientation_is_applied_and_then_dropped(client: AsyncClient, media_root: Path) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    exif = Image.Exif()
    exif[0x0112] = 6  # Orientation: rotate 90 degrees clockwise to display
    photo = image_bytes("JPEG", (60, 20), exif=exif.tobytes())

    asset = (await upload(client, organizer, event_id, photo, "image/jpeg")).json()

    assert (asset["width"], asset["height"]) == (20, 60)
    with Image.open(media_root / event_id / f"{asset['id']}.jpg") as reopened:
        assert reopened.size == (20, 60)
        assert 0x0112 not in reopened.getexif()


async def test_the_format_comes_from_the_bytes_not_the_declared_type(
    client: AsyncClient, media_root: Path
) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)

    asset = (await upload(client, organizer, event_id, image_bytes("WEBP"), "image/jpeg")).json()

    assert asset["content_type"] == "image/webp"
    assert len(list(media_root.rglob(f"{asset['id']}.webp"))) == 1


@pytest.mark.parametrize(
    ("fmt", "content_type", "extension"), [("PNG", "image/png", "png"), ("WEBP", "image/webp", "webp")]
)
async def test_animations_are_flattened_to_their_first_frame(
    client: AsyncClient, media_root: Path, fmt: str, content_type: str, extension: str
) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    uploaded = animated_bytes(fmt)
    with Image.open(io.BytesIO(uploaded)) as source:
        assert getattr(source, "n_frames", 1) == 2

    created = await upload(client, organizer, event_id, uploaded, content_type)

    assert created.status_code == 201, created.text
    asset = created.json()
    assert (asset["width"], asset["height"]) == (32, 24)
    with Image.open(media_root / event_id / f"{asset['id']}.{extension}") as stored:
        assert getattr(stored, "n_frames", 1) == 1
        assert not getattr(stored, "is_animated", False)
        pixel = stored.convert("RGB").getpixel((16, 12))
        assert isinstance(pixel, tuple)
        red, green, blue = pixel[:3]
        assert red > 200 and green < 50 and blue < 50


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

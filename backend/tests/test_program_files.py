"""Schedule files (the program as a PDF or an image): intake validation, storage, organizer management,
tenant isolation and publication-gated public serving."""

from pathlib import Path
from typing import Any
from urllib.parse import quote

import pytest
from httpx import AsyncClient

from app.media import resolve_storage_path
from tests.helpers import bearer, provision_organizer, publish_page
from tests.test_events import EVENT
from tests.test_page_media import image_bytes
from tests.test_ticket_tiers import create_event

PUBLIC_EVENT = f"/api/public/events/{EVENT['slug']}"
PDF = (
    b"%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n"
    b"2 0 obj << /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >> endobj\n"
    b"3 0 obj << /Type /Page /Parent 2 0 R >> endobj\n4 0 obj << /Type /Page /Parent 2 0 R >> endobj\n"
    b"trailer << /Root 1 0 R >>\n%%EOF\n"
)


def files_url(event_id: str) -> str:
    return f"/api/events/{event_id}/program-files"


async def upload(
    client: AsyncClient,
    organizer: dict[str, str],
    event_id: str,
    data: bytes,
    content_type: str = "application/pdf",
    label: str = "Full schedule",
) -> Any:
    return await client.post(
        files_url(event_id),
        params={"label": label},
        content=data,
        headers={**bearer(organizer), "Content-Type": content_type},
    )


async def uploaded(client: AsyncClient, organizer: dict[str, str], event_id: str, *args: Any, **kwargs: Any) -> dict[str, Any]:
    response = await upload(client, organizer, event_id, *args, **kwargs)
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


async def test_a_pdf_schedule_is_public_once_the_page_is_published(client: AsyncClient, media_root: Path) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    pdf = await uploaded(client, organizer, event_id, PDF, label="برنامهٔ روز اول")
    assert (pdf["kind"], pdf["content_type"], pdf["byte_size"], pdf["page_count"]) == ("pdf", "application/pdf", len(PDF), 2)
    assert pdf["is_visible"] is True and pdf["position"] == 0

    stored = (await client.get(files_url(event_id), headers=bearer(organizer))).json()
    assert [f["id"] for f in stored] == [pdf["id"]]
    paths = list((media_root / event_id / "program").iterdir())
    assert [p.name for p in paths] == [f"{pdf['id']}.pdf"]
    assert paths[0].read_bytes() == PDF

    own = await client.get(pdf["content_url"], headers=bearer(organizer))
    assert own.status_code == 200 and own.content == PDF

    public_url = f"/api/public/program-files/{pdf['id']}"
    assert (await client.get(public_url)).status_code == 404  # page not published yet
    await publish_page(client, organizer, event_id)

    public = await client.get(public_url)
    assert public.status_code == 200
    assert public.content == PDF
    assert public.headers["content-type"] == "application/pdf"
    assert public.headers["x-content-type-options"] == "nosniff"
    assert public.headers["content-security-policy"] == "sandbox"
    assert public.headers["cache-control"] == "public, max-age=3600"
    disposition = public.headers["content-disposition"]
    assert disposition.startswith("inline;")
    assert f"filename*=UTF-8''{quote('برنامهٔ روز اول.pdf', safe='')}" in disposition

    files = (await client.get(PUBLIC_EVENT)).json()["program_files"]
    assert files == [
        {
            "id": pdf["id"], "label": "برنامهٔ روز اول", "kind": "pdf", "content_type": "application/pdf",
            "byte_size": len(PDF), "width": None, "height": None, "page_count": 2, "url": public_url,
        }
    ]


async def test_an_image_schedule_is_re_encoded_and_served_sandboxed(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    image = await uploaded(client, organizer, event_id, image_bytes("JPEG", (120, 80)), "image/jpeg", "Day 1")
    assert (image["kind"], image["content_type"], image["width"], image["height"]) == ("image", "image/jpeg", 120, 80)
    await publish_page(client, organizer, event_id)

    public = await client.get(f"/api/public/program-files/{image['id']}")
    assert public.status_code == 200
    assert public.headers["content-type"] == "image/jpeg"
    assert "sandbox" in public.headers["content-security-policy"]
    assert public.headers["x-content-type-options"] == "nosniff"


@pytest.mark.parametrize(
    ("data", "content_type", "expected", "code"),
    [
        (b"<html><script>alert(1)</script></html>", "application/pdf", 415, "PROGRAM_FILE_PDF_REJECTED"),
        (b"  %PDF-1.4 late magic", "application/pdf", 415, "PROGRAM_FILE_PDF_REJECTED"),
        (
            PDF.replace(b"/Type /Catalog", b"/Type /Catalog /OpenAction << /S /JavaScript /JS (app.alert(1)) >>"),
            "application/pdf", 415, "PROGRAM_FILE_PDF_REJECTED",
        ),
        (
            PDF.replace(b"/Type /Catalog", b"/Type /Catalog /Names << /EmbeddedFiles 9 0 R >>"),
            "application/pdf", 415, "PROGRAM_FILE_PDF_REJECTED",
        ),
        (PDF, "image/png", 415, "PROGRAM_FILE_IMAGE_REJECTED"),
        (b'<svg xmlns="http://www.w3.org/2000/svg"/>', "image/svg+xml", 415, "PROGRAM_FILE_TYPE_UNSUPPORTED"),
        (PDF, "text/html", 415, "PROGRAM_FILE_TYPE_UNSUPPORTED"),
        (b"", "application/pdf", 400, "PROGRAM_FILE_EMPTY"),
    ],
)
async def test_unsafe_or_mislabelled_uploads_are_refused(
    client: AsyncClient, media_root: Path, data: bytes, content_type: str, expected: int, code: str
) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    response = await upload(client, organizer, event_id, data, content_type)
    assert response.status_code == expected, response.text
    assert response.json()["code"] == code
    assert (await client.get(files_url(event_id), headers=bearer(organizer))).json() == []
    assert not (media_root / event_id / "program").exists()


async def test_uploads_over_8_mb_or_without_a_label_are_refused(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    big = PDF + b"0" * 8_000_000
    too_large = await upload(client, organizer, event_id, big)
    assert (too_large.status_code, too_large.json()["code"]) == (413, "PROGRAM_FILE_TOO_LARGE")
    unlabelled = await upload(client, organizer, event_id, PDF, label="   ")
    assert (unlabelled.status_code, unlabelled.json()["code"]) == (422, "PROGRAM_FILE_LABEL_REQUIRED")
    missing = await client.post(
        files_url(event_id), content=PDF, headers={**bearer(organizer), "Content-Type": "application/pdf"}
    )
    assert missing.status_code == 422


async def test_an_event_holds_at_most_20_schedule_files(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    for _ in range(20):
        await uploaded(client, organizer, event_id, PDF)
    refused = await upload(client, organizer, event_id, PDF)
    assert (refused.status_code, refused.json()["code"]) == (409, "PROGRAM_FILE_LIMIT_REACHED")


async def test_organizer_relabels_reorders_hides_and_deletes_files(client: AsyncClient, media_root: Path) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    first = await uploaded(client, organizer, event_id, PDF, label="Day 1")
    second = await uploaded(client, organizer, event_id, image_bytes(), "image/png", "Day 2")
    assert second["position"] == 1
    await publish_page(client, organizer, event_id)

    url = files_url(event_id)
    moved = await client.patch(f"{url}/{second['id']}", json={"position": 0, "label": "  Day two "}, headers=bearer(organizer))
    assert moved.status_code == 200 and moved.json()["label"] == "Day two"
    await client.patch(f"{url}/{first['id']}", json={"position": 1}, headers=bearer(organizer))
    assert [f["label"] for f in (await client.get(PUBLIC_EVENT)).json()["program_files"]] == ["Day two", "Day 1"]

    hidden = await client.patch(f"{url}/{first['id']}", json={"is_visible": False}, headers=bearer(organizer))
    assert hidden.json()["is_visible"] is False
    assert [f["id"] for f in (await client.get(PUBLIC_EVENT)).json()["program_files"]] == [second["id"]]
    assert (await client.get(f"/api/public/program-files/{first['id']}")).status_code == 404
    assert (await client.patch(f"{url}/{first['id']}", json={"label": ""}, headers=bearer(organizer))).status_code == 422

    path = resolve_storage_path(media_root, f"{event_id}/program/{first['id']}.pdf")
    assert path.is_file()
    assert (await client.delete(f"{url}/{first['id']}", headers=bearer(organizer))).status_code == 204
    assert not path.exists()
    assert (await client.delete(f"{url}/{first['id']}", headers=bearer(organizer))).status_code == 404
    assert [f["id"] for f in (await client.get(url, headers=bearer(organizer))).json()] == [second["id"]]


async def test_another_organizer_cannot_touch_schedule_files(client: AsyncClient) -> None:
    owner = await provision_organizer(client, "Owner Co")
    intruder = await provision_organizer(client, "Intruder Co")
    event_id = await create_event(client, owner)
    item = await uploaded(client, owner, event_id, PDF)
    url = f"{files_url(event_id)}/{item['id']}"

    assert (await client.get(files_url(event_id), headers=bearer(intruder))).status_code == 404
    assert (await upload(client, intruder, event_id, PDF)).status_code == 404
    assert (await client.get(item["content_url"], headers=bearer(intruder))).status_code == 404
    assert (await client.patch(url, json={"is_visible": False}, headers=bearer(intruder))).status_code == 404
    assert (await client.delete(url, headers=bearer(intruder))).status_code == 404
    assert (await client.get(item["content_url"])).status_code == 401


async def test_archived_events_hide_their_files_and_refuse_uploads(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    item = await uploaded(client, organizer, event_id, PDF)
    await publish_page(client, organizer, event_id)
    await client.post(f"/api/events/{event_id}/archive", json={"archived": True}, headers=bearer(organizer))

    assert (await client.get(f"/api/public/program-files/{item['id']}")).status_code == 404
    refused = [
        await upload(client, organizer, event_id, PDF),
        await client.delete(f"{files_url(event_id)}/{item['id']}", headers=bearer(organizer)),
    ]
    assert [(r.status_code, r.json()["code"]) for r in refused] == [(409, "EVENT_ARCHIVED")] * 2


async def test_deleting_the_event_removes_its_stored_files(client: AsyncClient, media_root: Path) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    await uploaded(client, organizer, event_id, PDF)
    assert (media_root / event_id).is_dir()
    assert (await client.delete(f"/api/events/{event_id}", headers=bearer(organizer))).status_code == 204
    assert not (media_root / event_id).exists()

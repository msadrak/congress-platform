"""Leads: soft delete and restore, timezone-aware timestamps, and the paginated, Persian-aware search."""

import csv
import io
from datetime import datetime, timedelta, timezone
from typing import Any

from httpx import AsyncClient

from tests.exhibitors import Congress, reserve, setup_congress
from tests.test_tickets import register_user


async def capture(client: AsyncClient, congress: Congress, qr_secret: str, **fields: Any) -> dict[str, Any]:
    response = await client.post(
        f"/api/booths/{congress.booth_id}/leads/scan", json={"qr_secret": qr_secret, **fields}, headers=congress.staff
    )
    assert response.status_code in (200, 201), response.text
    body: dict[str, Any] = response.json()
    return body


async def add_attendee(client: AsyncClient, congress: Congress, mobile: str, name: str) -> str:
    _, token = await register_user(client, mobile, name)
    ticket = await reserve(client, congress.event_id, congress.tier_id, token)
    secret: str = ticket["qr_secret"]
    return secret


def csv_rows(text: str) -> list[list[str]]:
    return list(csv.reader(io.StringIO(text.lstrip("﻿"))))


async def test_a_deleted_lead_leaves_lists_and_exports_until_restored(client: AsyncClient) -> None:
    congress = await setup_congress(client)
    lead = await capture(client, congress, congress.ticket["qr_secret"], rating="HOT", notes="Wants a demo")
    base = f"/api/booths/{congress.booth_id}/leads"

    deleted = await client.delete(f"{base}/{lead['id']}", headers=congress.staff)

    assert deleted.status_code == 204, deleted.text
    assert (await client.get(base, headers=congress.staff)).json() == []
    page = (await client.get(f"{base}/search", headers=congress.staff)).json()
    assert (page["items"], page["total"]) == ([], 0)
    trash = (await client.get(f"{base}/search", params={"state": "deleted"}, headers=congress.staff)).json()
    assert [item["id"] for item in trash["items"]] == [lead["id"]]
    assert trash["items"][0]["deleted_at"] is not None
    assert len(csv_rows((await client.get(f"{base}/export-csv", headers=congress.staff)).text)) == 1
    with_deleted = await client.get(f"{base}/export-csv", params={"include_deleted": True}, headers=congress.staff)
    rows = csv_rows(with_deleted.text)
    assert rows[0][-1] == "Deleted At (UTC)" and len(rows) == 2 and rows[1][-1]

    edit = await client.patch(f"{base}/{lead['id']}", json={"rating": "COLD"}, headers=congress.staff)
    assert edit.status_code == 409
    assert edit.json()["code"] == "LEAD_DELETED"

    restored = await client.post(f"{base}/{lead['id']}/restore", headers=congress.staff)
    assert restored.status_code == 200, restored.text
    assert restored.json()["deleted_at"] is None
    assert (restored.json()["rating"], restored.json()["notes"]) == ("HOT", "Wants a demo")
    assert [item["id"] for item in (await client.get(base, headers=congress.staff)).json()] == [lead["id"]]

    missing = await client.delete(f"{base}/00000000-0000-0000-0000-000000000000", headers=congress.staff)
    assert missing.status_code == 404
    assert missing.json()["code"] == "LEAD_NOT_FOUND"


async def test_scanning_a_deleted_lead_again_restores_it(client: AsyncClient) -> None:
    congress = await setup_congress(client)
    lead = await capture(client, congress, congress.ticket["qr_secret"])
    await client.delete(f"/api/booths/{congress.booth_id}/leads/{lead['id']}", headers=congress.staff)

    again = await client.post(
        f"/api/booths/{congress.booth_id}/leads/scan",
        json={"qr_secret": congress.ticket["qr_secret"]},
        headers=congress.staff,
    )

    assert again.status_code == 200, again.text
    assert again.json()["id"] == lead["id"]
    listed = (await client.get(f"/api/booths/{congress.booth_id}/leads", headers=congress.staff)).json()
    assert [item["id"] for item in listed] == [lead["id"]]


async def test_lead_timestamps_are_utc_in_the_api_and_the_export(client: AsyncClient) -> None:
    congress = await setup_congress(client)
    before = datetime.now(timezone.utc)
    lead = await capture(client, congress, congress.ticket["qr_secret"])
    edited = await client.patch(
        f"/api/booths/{congress.booth_id}/leads/{lead['id']}", json={"notes": "Call back"}, headers=congress.staff
    )

    for stamp in (lead["created_at"], lead["updated_at"], edited.json()["updated_at"]):
        parsed = datetime.fromisoformat(stamp)
        assert parsed.utcoffset() is not None
        assert abs(parsed - before) < timedelta(minutes=5)

    rows = csv_rows((await client.get(f"/api/booths/{congress.booth_id}/leads/export-csv", headers=congress.staff)).text)
    header = rows[0]
    captured_at = datetime.fromisoformat(rows[1][header.index("Captured At (UTC)")])
    updated_at = datetime.fromisoformat(rows[1][header.index("Last Updated (UTC)")])
    assert captured_at.utcoffset() == timedelta(0) and updated_at.utcoffset() == timedelta(0)
    assert abs(captured_at - before) < timedelta(minutes=5)


async def test_lead_search_pages_with_a_cursor_and_reports_the_total(client: AsyncClient) -> None:
    congress = await setup_congress(client)
    ids = [(await capture(client, congress, congress.ticket["qr_secret"]))["id"]]
    for i in range(4):
        secret = await add_attendee(client, congress, f"0912100083{i}", f"Visitor {i}")
        ids.append((await capture(client, congress, secret))["id"])

    seen: list[str] = []
    cursor: str | None = None
    totals = set()
    for _ in range(5):
        params: dict[str, Any] = {"limit": 2, **({"cursor": cursor} if cursor else {})}
        page = (await client.get(f"/api/booths/{congress.booth_id}/leads/search", params=params, headers=congress.staff)).json()
        totals.add(page["total"])
        seen += [item["id"] for item in page["items"]]
        cursor = page["next_cursor"]
        if cursor is None:
            break

    assert totals == {5}
    assert seen == list(reversed(ids))  # newest first, each lead exactly once
    bad = await client.get(
        f"/api/booths/{congress.booth_id}/leads/search", params={"cursor": "garbage"}, headers=congress.staff
    )
    assert bad.status_code == 400
    assert bad.json()["code"] == "CURSOR_INVALID"


async def test_lead_search_normalises_persian_letters_and_treats_wildcards_literally(client: AsyncClient) -> None:
    congress = await setup_congress(client, attendee_name="علي كريمي")  # Arabic yeh and kaf
    await capture(client, congress, congress.ticket["qr_secret"])
    secret = await add_attendee(client, congress, "09121000841", "مهدی\u200cزاده")  # with a ZWNJ
    await capture(client, congress, secret)
    secret = await add_attendee(client, congress, "09121000842", "Percent 100% Sure")
    await capture(client, congress, secret)

    async def names(q: str) -> list[str]:
        page = (
            await client.get(f"/api/booths/{congress.booth_id}/leads/search", params={"q": q}, headers=congress.staff)
        ).json()
        return sorted(item["attendee_name"] for item in page["items"])

    assert await names("علی کریمی") == ["علي كريمي"]
    assert await names("كريمي") == ["علي كريمي"]
    assert await names("مهدیزاده") == ["مهدی\u200cزاده"]
    assert await names("مهدی\u200cزاده") == ["مهدی\u200cزاده"]
    assert await names("%") == ["Percent 100% Sure"]
    assert await names("_") == []
    assert await names("0912100084") == []  # mobiles are searchable only with the attendee's consent

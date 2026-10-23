"""Only an active ticket with an active QR admits, appears in a gate manifest, or can be scanned as a lead or a
peer. Every ticket is active today; these tests flip the status in the database to pin the rule down before
cancellation or pass reissue exist."""

import hashlib
import uuid
from typing import Any

from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy import update

from app.models import EntityQR, Ticket
from tests.helpers import bearer, provision_organizer, publish_page, sign_in
from tests.test_ticket_tiers import create_event, tier


async def _event_with_passes(client: AsyncClient) -> tuple[dict[str, str], str, list[dict[str, Any]]]:
    """An event and three reserved passes (active, cancelled ticket, deactivated QR)."""
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    tier_id = (
        await client.post(f"/api/events/{event_id}/ticket-tiers", json=tier(), headers=bearer(organizer))
    ).json()["id"]
    await publish_page(client, organizer, event_id)
    passes = []
    for mobile in ("09121000071", "09121000072", "09121000073"):
        _, token = await sign_in(client, mobile, f"Attendee {mobile[-2:]}")
        reserved = await client.post(
            f"/api/events/{event_id}/tickets/reserve", json={"ticket_tier_id": tier_id},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert reserved.status_code == 201, reserved.text
        passes.append(reserved.json())
    return organizer, event_id, passes


async def _deactivate(app: FastAPI, cancelled: dict[str, Any], qr_off: dict[str, Any]) -> None:
    async with app.state.sessionmaker() as session:
        await session.execute(update(Ticket).where(Ticket.id == uuid.UUID(cancelled["id"])).values(status="cancelled"))
        await session.execute(update(EntityQR).where(EntityQR.secret == qr_off["qr_secret"]).values(is_active=False))
        await session.commit()


async def test_gates_admit_only_active_tickets_with_active_qr(app: FastAPI, client: AsyncClient) -> None:
    organizer, event_id, (active, cancelled, qr_off) = await _event_with_passes(client)
    point_id = (
        await client.post(
            f"/api/events/{event_id}/checkin-points", json={"name": "Gate", "policy_type": "MULTI_ENTRY"},
            headers=bearer(organizer),
        )
    ).json()["id"]
    await _deactivate(app, cancelled, qr_off)

    manifest = await client.get(f"/api/checkin-points/{point_id}/manifest", headers=bearer(organizer))
    scans = await client.post(
        f"/api/checkin-points/{point_id}/scans/batch",
        json={"scans": [
            {"scan_id": str(uuid.uuid4()), "qr_secret": p["qr_secret"], "scanned_at": "2026-10-22T08:00:00Z"}
            for p in (active, cancelled, qr_off)
        ]},
        headers=bearer(organizer),
    )

    # The manifest carries sha256("<event_id>:<secret>") (ws A2), never the raw secret.
    active_hash = hashlib.sha256(f"{event_id}:{active['qr_secret']}".encode()).hexdigest()
    assert [t["qr_hash"] for t in manifest.json()["tickets"]] == [active_hash]
    verdicts = [(r["status"], r["rejection_reason"]) for r in scans.json()["results"]]
    assert verdicts == [("ADMITTED", None), ("REJECTED", "TICKET_INACTIVE"), ("REJECTED", "INVALID_TICKET")]
    assert scans.json()["results"][1]["attendee_name"] == "Attendee 72"
    assert scans.json()["results"][2]["attendee_name"] is None
    # A replay of the same scans returns the stored verdicts.
    replay = await client.post(
        f"/api/checkin-points/{point_id}/scans/batch",
        json={"scans": [
            {"scan_id": r["scan_id"], "qr_secret": r["qr_secret"], "scanned_at": "2026-10-22T08:00:00Z"}
            for r in scans.json()["results"]
        ]},
        headers=bearer(organizer),
    )
    assert replay.json() == scans.json()


async def test_booths_capture_leads_only_from_active_tickets_with_active_qr(app: FastAPI, client: AsyncClient) -> None:
    organizer, event_id, (active, cancelled, qr_off) = await _event_with_passes(client)
    booth_id = (
        await client.post(
            f"/api/events/{event_id}/booths", json={"name": "Booth", "slug": "booth"}, headers=bearer(organizer)
        )
    ).json()["id"]
    await client.post(
        f"/api/events/{event_id}/booths/{booth_id}/staff", json={"mobile": "09121000074"}, headers=bearer(organizer)
    )
    _, staff_token = await sign_in(client, "09121000074")
    await _deactivate(app, cancelled, qr_off)

    statuses = [
        (
            await client.post(
                f"/api/booths/{booth_id}/leads/scan", json={"qr_secret": p["qr_secret"]},
                headers={"Authorization": f"Bearer {staff_token}"},
            )
        ).status_code
        for p in (active, cancelled, qr_off)
    ]

    assert statuses == [201, 404, 404]


async def test_peers_connect_only_through_active_tickets_with_active_qr(app: FastAPI, client: AsyncClient) -> None:
    organizer, event_id, (active, cancelled, qr_off) = await _event_with_passes(client)
    _, token = await sign_in(client, "09121000075")
    # The scanner needs an active ticket of their own for the congress.
    tier_id = (await client.get(f"/api/events/{event_id}/ticket-tiers", headers=bearer(organizer))).json()[0]["id"]
    reserved = await client.post(
        f"/api/events/{event_id}/tickets/reserve", json={"ticket_tier_id": tier_id},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert reserved.status_code == 201, reserved.text
    await _deactivate(app, cancelled, qr_off)

    statuses = [
        (
            await client.post(
                "/api/attendees/me/network/scan", json={"qr_secret": p["qr_secret"], "event_id": event_id},
                headers={"Authorization": f"Bearer {token}"},
            )
        ).status_code
        for p in (active, cancelled, qr_off)
    ]

    assert statuses == [201, 404, 404]

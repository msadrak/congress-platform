"""A ticket scanned at another congress's gate must not expose its holder to that congress."""

import uuid
from datetime import datetime, timezone

from httpx import AsyncClient

from tests.helpers import bearer, provision_organizer
from tests.test_events import EVENT
from tests.test_ticket_tiers import tier
from tests.test_tickets import register_user


async def _congress(client: AsyncClient, name: str, slug: str) -> tuple[dict[str, str], str, str]:
    organizer = await provision_organizer(client, name)
    created = await client.post(
        "/api/events", json={**EVENT, "slug": slug}, headers=bearer(organizer)
    )
    assert created.status_code == 201, created.text
    event_id: str = created.json()["id"]
    tier_resp = await client.post(
        f"/api/events/{event_id}/ticket-tiers",
        json=tier(name="General", quota=10),
        headers=bearer(organizer),
    )
    return organizer, event_id, tier_resp.json()["id"]


async def test_foreign_ticket_scan_is_rejected_without_exposing_its_holder(
    client: AsyncClient,
) -> None:
    organizer_a, event_a, _ = await _congress(client, "Congress A Org", "congress-a")
    organizer_b, event_b, tier_b = await _congress(client, "Congress B Org", "congress-b")

    _, attendee_token = await register_user(client, "foreign.holder@example.com", "Foreign Holder")
    foreign_ticket = (
        await client.post(
            f"/api/events/{event_b}/tickets/reserve",
            json={"ticket_tier_id": tier_b},
            headers={"Authorization": f"Bearer {attendee_token}"},
        )
    ).json()

    point = (
        await client.post(
            f"/api/events/{event_a}/checkin-points",
            json={"name": "Gate A", "policy_type": "MULTI_ENTRY"},
            headers=bearer(organizer_a),
        )
    ).json()
    scanner = (
        await client.post(
            f"/api/checkin-points/{point['id']}/token", headers=bearer(organizer_a)
        )
    ).json()["scanner_token"]
    scan_id = str(uuid.uuid4())
    payload = {
        "scans": [
            {
                "scan_id": scan_id,
                "qr_secret": foreign_ticket["qr_secret"],
                "scanned_at": datetime.now(timezone.utc).isoformat(),
            }
        ]
    }
    url = f"/api/checkin-points/{point['id']}/scans/batch"
    headers = {"Authorization": f"Bearer {scanner}"}

    first = await client.post(url, json=payload, headers=headers)
    replay = await client.post(url, json=payload, headers=headers)

    for response in (first, replay):
        assert response.status_code == 200
        result = response.json()["results"][0]
        assert result["status"] == "REJECTED"
        assert result["rejection_reason"] == "EVENT_MISMATCH"
        assert result.get("attendee_name") is None
        assert result.get("ticket_tier_name") is None

    # Congress A's own reports must not contain the other congress's attendee.
    export = await client.get(
        f"/api/events/{event_a}/analytics/export-csv", headers=bearer(organizer_a)
    )
    assert export.status_code == 200
    assert "EVENT_MISMATCH" in export.text
    assert "Foreign Holder" not in export.text
    assert "foreign.holder@example.com" not in export.text

    # The rejection is recorded once and counts as a scan, never as an admission.
    analytics = (
        await client.get(
            f"/api/events/{event_a}/analytics/attendance", headers=bearer(organizer_a)
        )
    ).json()
    assert analytics["total_scans"] == 1
    assert analytics["total_admitted"] == 0
    assert analytics["total_tickets"] == 0

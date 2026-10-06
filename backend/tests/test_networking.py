import uuid
from httpx import AsyncClient

from tests.helpers import bearer, provision_organizer
from tests.test_events import EVENT
from tests.test_ticket_tiers import create_event, tier
from tests.test_tickets import register_user


async def setup_event_and_attendees(
    client: AsyncClient,
) -> tuple[str, dict[str, str], str, dict[str, str], str, dict[str, str]]:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    tier_resp = await client.post(
        f"/api/events/{event_id}/ticket-tiers",
        json=tier(name="General", quota=100),
        headers=bearer(organizer),
    )
    tier_id = tier_resp.json()["id"]

    # Attendee A
    user_a, token_a = await register_user(
        client, "alice@example.com", "Alice Smith"
    )
    t_a = (
        await client.post(
            f"/api/events/{event_id}/tickets/reserve",
            json={"ticket_tier_id": tier_id},
            headers={"Authorization": f"Bearer {token_a}"},
        )
    ).json()

    # Attendee B
    user_b, token_b = await register_user(
        client, "bob@hospital.org", "Dr. Bob Jones"
    )
    t_b = (
        await client.post(
            f"/api/events/{event_id}/tickets/reserve",
            json={"ticket_tier_id": tier_id},
            headers={"Authorization": f"Bearer {token_b}"},
        )
    ).json()

    return event_id, user_a, token_a, t_a, token_b, t_b


async def test_attendee_scans_peer_badge_and_creates_connection(
    client: AsyncClient,
) -> None:
    event_id, user_a, token_a, t_a, token_b, t_b = (
        await setup_event_and_attendees(client)
    )

    # Alice scans Bob's badge
    scan_resp = await client.post(
        "/api/attendees/me/network/scan",
        json={
            "qr_secret": t_b["qr_secret"],
            "private_notes": "Met during morning keynote.",
        },
        headers={"Authorization": f"Bearer {token_a}"},
    )

    assert scan_resp.status_code == 201, scan_resp.text
    data = scan_resp.json()
    assert data["full_name"] == "Dr. Bob Jones"
    assert data["email"] == "bob@hospital.org"
    assert data["private_notes"] == "Met during morning keynote."
    assert "id" in data


async def test_scanning_own_badge_is_rejected(
    client: AsyncClient,
) -> None:
    event_id, user_a, token_a, t_a, token_b, t_b = (
        await setup_event_and_attendees(client)
    )

    # Alice tries scanning her own badge
    self_resp = await client.post(
        "/api/attendees/me/network/scan",
        json={"qr_secret": t_a["qr_secret"]},
        headers={"Authorization": f"Bearer {token_a}"},
    )

    assert self_resp.status_code == 400
    assert "own badge" in self_resp.json()["detail"].lower()


async def test_duplicate_peer_scan_updates_existing_connection(
    client: AsyncClient,
) -> None:
    event_id, user_a, token_a, t_a, token_b, t_b = (
        await setup_event_and_attendees(client)
    )

    # First scan
    first = await client.post(
        "/api/attendees/me/network/scan",
        json={"qr_secret": t_b["qr_secret"], "private_notes": "First note"},
        headers={"Authorization": f"Bearer {token_a}"},
    )
    assert first.status_code == 201

    # Second scan updates notes
    second = await client.post(
        "/api/attendees/me/network/scan",
        json={"qr_secret": t_b["qr_secret"], "private_notes": "Updated note"},
        headers={"Authorization": f"Bearer {token_a}"},
    )
    assert second.status_code == 200
    assert second.json()["id"] == first.json()["id"]
    assert second.json()["private_notes"] == "Updated note"

    # Verify only 1 connection in list
    listed = await client.get(
        "/api/attendees/me/network",
        headers={"Authorization": f"Bearer {token_a}"},
    )
    assert listed.status_code == 200
    assert len(listed.json()) == 1


async def test_attendee_can_list_connections_and_update_private_notes(
    client: AsyncClient,
) -> None:
    event_id, user_a, token_a, t_a, token_b, t_b = (
        await setup_event_and_attendees(client)
    )

    created = (
        await client.post(
            "/api/attendees/me/network/scan",
            json={"qr_secret": t_b["qr_secret"], "private_notes": "Initial"},
            headers={"Authorization": f"Bearer {token_a}"},
        )
    ).json()
    conn_id = created["id"]

    # Patch private notes
    patched = await client.patch(
        f"/api/attendees/me/network/{conn_id}",
        json={"private_notes": "Schedule collaboration call next week"},
        headers={"Authorization": f"Bearer {token_a}"},
    )
    assert patched.status_code == 200
    assert patched.json()["private_notes"] == "Schedule collaboration call next week"


async def test_vcard_download_returns_rfc_compliant_vcf_file(
    client: AsyncClient,
) -> None:
    event_id, user_a, token_a, t_a, token_b, t_b = (
        await setup_event_and_attendees(client)
    )

    created = (
        await client.post(
            "/api/attendees/me/network/scan",
            json={"qr_secret": t_b["qr_secret"], "private_notes": "Met at keynote"},
            headers={"Authorization": f"Bearer {token_a}"},
        )
    ).json()
    conn_id = created["id"]

    vcard_resp = await client.get(
        f"/api/attendees/me/network/{conn_id}/vcard",
        headers={"Authorization": f"Bearer {token_a}"},
    )
    assert vcard_resp.status_code == 200
    assert "text/vcard" in vcard_resp.headers["content-type"]
    assert "attachment" in vcard_resp.headers["content-disposition"]
    assert ".vcf" in vcard_resp.headers["content-disposition"]

    vcard_text = vcard_resp.text
    assert "BEGIN:VCARD" in vcard_text
    assert "VERSION:3.0" in vcard_text
    assert "FN:Dr. Bob Jones" in vcard_text
    assert "EMAIL;TYPE=INTERNET:bob@hospital.org" in vcard_text
    assert "NOTE:Met at keynote" in vcard_text
    assert "END:VCARD" in vcard_text


async def test_authorization_isolation_on_network(
    client: AsyncClient,
) -> None:
    event_id, user_a, token_a, t_a, token_b, t_b = (
        await setup_event_and_attendees(client)
    )

    # Alice connects with Bob
    created = (
        await client.post(
            "/api/attendees/me/network/scan",
            json={"qr_secret": t_b["qr_secret"]},
            headers={"Authorization": f"Bearer {token_a}"},
        )
    ).json()
    conn_id = created["id"]

    # Charlie (new user) attempts to access Alice's connection -> 404
    _, token_c = await register_user(client, "charlie@example.com")
    intruder_resp = await client.get(
        f"/api/attendees/me/network/{conn_id}/vcard",
        headers={"Authorization": f"Bearer {token_c}"},
    )
    assert intruder_resp.status_code == 404

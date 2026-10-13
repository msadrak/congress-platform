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
    # Issue #19: Default is privacy-preserving (email is None unless peer explicitly opted in)
    assert data["email"] is None
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
    # Issue #19: Default privacy-preserving (email omitted from vCard unless peer opted in)
    assert "EMAIL" not in vcard_text
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


# ---------------------------------------------------------------------------
# Issue #19 Regression Tests: Peer Contact-Sharing Consent
# ---------------------------------------------------------------------------


async def test_peer_privacy_preference_lifecycle_and_unauthorized_isolation(
    client: AsyncClient,
) -> None:
    """Test viewing, updating, and revoking peer contact sharing preference."""
    # Unauthenticated access rejected
    unauth_res = await client.get("/api/attendees/me/network/privacy")
    assert unauth_res.status_code == 401

    # Register user -> default is False
    user, token = await register_user(client, "consent_user@test.org", "Consent Tester")
    auth_header = {"Authorization": f"Bearer {token}"}

    get_res = await client.get("/api/attendees/me/network/privacy", headers=auth_header)
    assert get_res.status_code == 200
    assert get_res.json()["share_contact_with_peers"] is False

    # Opt in to sharing
    patch_res = await client.patch(
        "/api/attendees/me/network/privacy",
        json={"share_contact_with_peers": True},
        headers=auth_header,
    )
    assert patch_res.status_code == 200
    assert patch_res.json()["share_contact_with_peers"] is True

    # Verify persistence on subsequent GET
    get_after = await client.get("/api/attendees/me/network/privacy", headers=auth_header)
    assert get_after.status_code == 200
    assert get_after.json()["share_contact_with_peers"] is True

    # Revoke consent
    revoke_res = await client.patch(
        "/api/attendees/me/network/privacy",
        json={"share_contact_with_peers": False},
        headers=auth_header,
    )
    assert revoke_res.status_code == 200
    assert revoke_res.json()["share_contact_with_peers"] is False


async def test_peer_consent_toggle_governs_api_and_vcard_disclosure(
    client: AsyncClient,
) -> None:
    """When peer opts in, email is included in ConnectionOut and vCard; when revoked, it is redacted."""
    event_id, user_a, token_a, t_a, token_b, t_b = await setup_event_and_attendees(client)
    header_a = {"Authorization": f"Bearer {token_a}"}
    header_b = {"Authorization": f"Bearer {token_b}"}

    # 1. Initially Bob has consent=False. Alice scans Bob -> email is None
    scan1 = await client.post(
        "/api/attendees/me/network/scan",
        json={"qr_secret": t_b["qr_secret"]},
        headers=header_a,
    )
    assert scan1.status_code == 201
    conn_id = scan1.json()["id"]
    assert scan1.json()["email"] is None

    # Initial vCard export has no email
    vcard1 = await client.get(f"/api/attendees/me/network/{conn_id}/vcard", headers=header_a)
    assert vcard1.status_code == 200
    assert "EMAIL" not in vcard1.text

    # 2. Bob grants consent to share email
    opt_in = await client.patch(
        "/api/attendees/me/network/privacy",
        json={"share_contact_with_peers": True},
        headers=header_b,
    )
    assert opt_in.status_code == 200
    assert opt_in.json()["share_contact_with_peers"] is True

    # Subsequent list by Alice now includes Bob's email
    list_after = await client.get("/api/attendees/me/network", headers=header_a)
    assert list_after.status_code == 200
    alice_view_of_bob = next(c for c in list_after.json() if c["id"] == conn_id)
    assert alice_view_of_bob["email"] == "bob@hospital.org"

    # Subsequent vCard export now includes Bob's email
    vcard_after = await client.get(f"/api/attendees/me/network/{conn_id}/vcard", headers=header_a)
    assert "EMAIL;TYPE=INTERNET:bob@hospital.org" in vcard_after.text

    # 3. Bob revokes consent
    opt_out = await client.patch(
        "/api/attendees/me/network/privacy",
        json={"share_contact_with_peers": False},
        headers=header_b,
    )
    assert opt_out.status_code == 200
    assert opt_out.json()["share_contact_with_peers"] is False

    # Subsequent list immediately redacts Bob's email
    list_revoked = await client.get("/api/attendees/me/network", headers=header_a)
    revoked_bob = next(c for c in list_revoked.json() if c["id"] == conn_id)
    assert revoked_bob["email"] is None

    # Subsequent vCard export immediately omits Bob's email
    vcard_revoked = await client.get(f"/api/attendees/me/network/{conn_id}/vcard", headers=header_a)
    assert "EMAIL" not in vcard_revoked.text


async def _second_event_attendee(
    client: AsyncClient, email: str
) -> tuple[str, dict[str, str]]:
    """An attendee holding a ticket in a second congress run by another organizer."""
    organizer = await provision_organizer(client, "Other Congress Co")
    created = await client.post(
        "/api/events",
        json={**EVENT, "name": "Autumn Congress 2027", "slug": "autumn-congress-2027"},
        headers=bearer(organizer),
    )
    assert created.status_code == 201, created.text
    other_event_id: str = created.json()["id"]
    tier_resp = await client.post(
        f"/api/events/{other_event_id}/ticket-tiers",
        json=tier(name="General", quota=100),
        headers=bearer(organizer),
    )
    _, token = await register_user(client, email, "Carol Other")
    ticket = (
        await client.post(
            f"/api/events/{other_event_id}/tickets/reserve",
            json={"ticket_tier_id": tier_resp.json()["id"]},
            headers={"Authorization": f"Bearer {token}"},
        )
    ).json()
    return other_event_id, ticket


async def test_event_scoped_scan_of_another_congress_badge_writes_nothing(
    client: AsyncClient,
) -> None:
    event_id, _, token_a, _, _, _ = await setup_event_and_attendees(client)
    _, carol_ticket = await _second_event_attendee(client, "carol@example.com")
    header_a = {"Authorization": f"Bearer {token_a}"}

    rejected = await client.post(
        "/api/attendees/me/network/scan",
        json={
            "qr_secret": carol_ticket["qr_secret"],
            "private_notes": "met at the other congress",
            "event_id": event_id,
        },
        headers=header_a,
    )

    assert rejected.status_code == 409
    listed = await client.get("/api/attendees/me/network", headers=header_a)
    assert listed.json() == []


async def test_event_scoped_scan_of_another_congress_badge_leaves_existing_notes_untouched(
    client: AsyncClient,
) -> None:
    other_event_id, carol_ticket = await _second_event_attendee(client, "carol@example.com")
    event_id, _, token_a, _, _, _ = await setup_event_and_attendees(client)
    header_a = {"Authorization": f"Bearer {token_a}"}
    legacy = await client.post(
        "/api/attendees/me/network/scan",
        json={"qr_secret": carol_ticket["qr_secret"], "private_notes": "original"},
        headers=header_a,
    )
    assert legacy.status_code == 201

    rejected = await client.post(
        "/api/attendees/me/network/scan",
        json={
            "qr_secret": carol_ticket["qr_secret"],
            "private_notes": "overwritten",
            "event_id": event_id,
        },
        headers=header_a,
    )

    assert rejected.status_code == 409
    notes = (await client.get("/api/attendees/me/network", headers=header_a)).json()
    assert [(c["event_id"], c["private_notes"]) for c in notes] == [(other_event_id, "original")]


async def test_event_scoped_scan_of_same_congress_badge_still_connects(
    client: AsyncClient,
) -> None:
    event_id, _, token_a, _, _, t_b = await setup_event_and_attendees(client)

    accepted = await client.post(
        "/api/attendees/me/network/scan",
        json={"qr_secret": t_b["qr_secret"], "event_id": event_id},
        headers={"Authorization": f"Bearer {token_a}"},
    )

    assert accepted.status_code == 201
    assert accepted.json()["event_id"] == event_id

import uuid
from httpx import AsyncClient

from tests.helpers import bearer, provision_organizer
from tests.test_events import EVENT
from tests.test_ticket_tiers import create_event, tier


async def test_staff_can_register_walkin_attendee_and_receives_instant_qr(
    client: AsyncClient,
) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    tier_resp = await client.post(
        f"/api/events/{event_id}/ticket-tiers",
        json=tier(name="General Admission", quota=100),
        headers=bearer(organizer),
    )
    tier_id = tier_resp.json()["id"]

    # Staff registers walk-in attendee
    resp = await client.post(
        f"/api/events/{event_id}/desk-registrations",
        json={
            "full_name": "Dr. Reza Karimi",
            "email": "reza.karimi@example.com",
            "organization": "Tehran Medical Center",
            "title": "Head of Surgery",
            "ticket_tier_id": tier_id,
        },
        headers=bearer(organizer),
    )

    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["attendee_name"] == "Dr. Reza Karimi"
    assert data["attendee_email"] == "reza.karimi@example.com"
    assert data["organization"] == "Tehran Medical Center"
    assert data["title"] == "Head of Surgery"
    assert data["ticket_tier_name"] == "General Admission"
    assert "ticket_id" in data
    assert "qr_secret" in data
    assert len(data["qr_secret"]) == 26


async def test_desk_registration_supports_walkin_without_email(
    client: AsyncClient,
) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    tier_resp = await client.post(
        f"/api/events/{event_id}/ticket-tiers",
        json=tier(name="Standard Pass", quota=100),
        headers=bearer(organizer),
    )
    tier_id = tier_resp.json()["id"]

    # Walk-in without email
    resp = await client.post(
        f"/api/events/{event_id}/desk-registrations",
        json={
            "full_name": "Walk-in Guest No Email",
            "ticket_tier_id": tier_id,
        },
        headers=bearer(organizer),
    )

    assert resp.status_code == 201
    data = resp.json()
    assert data["attendee_name"] == "Walk-in Guest No Email"
    assert "@" in data["attendee_email"]
    assert len(data["qr_secret"]) == 26


async def test_desk_registration_atomic_quota_enforcement(
    client: AsyncClient,
) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    tier_resp = await client.post(
        f"/api/events/{event_id}/ticket-tiers",
        json=tier(name="Limited VIP", quota=1),
        headers=bearer(organizer),
    )
    tier_id = tier_resp.json()["id"]

    # First succeeds
    r1 = await client.post(
        f"/api/events/{event_id}/desk-registrations",
        json={"full_name": "Attendee 1", "ticket_tier_id": tier_id},
        headers=bearer(organizer),
    )
    assert r1.status_code == 201

    # Second fails with 410 Gone (sold out)
    r2 = await client.post(
        f"/api/events/{event_id}/desk-registrations",
        json={"full_name": "Attendee 2", "ticket_tier_id": tier_id},
        headers=bearer(organizer),
    )
    assert r2.status_code == 410


async def test_staff_can_search_attendees_by_partial_query(
    client: AsyncClient,
) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    tier_resp = await client.post(
        f"/api/events/{event_id}/ticket-tiers",
        json=tier(name="General", quota=100),
        headers=bearer(organizer),
    )
    tier_id = tier_resp.json()["id"]

    # Register 3 attendees
    await client.post(
        f"/api/events/{event_id}/desk-registrations",
        json={
            "full_name": "Dr. Sara Alavi",
            "email": "sara@hospital.org",
            "organization": "Shiraz University",
            "ticket_tier_id": tier_id,
        },
        headers=bearer(organizer),
    )
    await client.post(
        f"/api/events/{event_id}/desk-registrations",
        json={
            "full_name": "Dr. Ali Hosseini",
            "email": "ali@clinic.ir",
            "organization": "Tehran University",
            "ticket_tier_id": tier_id,
        },
        headers=bearer(organizer),
    )
    await client.post(
        f"/api/events/{event_id}/desk-registrations",
        json={
            "full_name": "Maryam Rad",
            "email": "m.rad@tehran.ir",
            "organization": "Tehran University",
            "ticket_tier_id": tier_id,
        },
        headers=bearer(organizer),
    )

    # Search by partial name "alavi"
    res_name = await client.get(
        f"/api/events/{event_id}/attendees?q=alavi", headers=bearer(organizer)
    )
    assert res_name.status_code == 200
    assert len(res_name.json()) == 1
    assert res_name.json()[0]["attendee_name"] == "Dr. Sara Alavi"

    # Search by partial email "clinic.ir"
    res_email = await client.get(
        f"/api/events/{event_id}/attendees?q=clinic.ir", headers=bearer(organizer)
    )
    assert res_email.status_code == 200
    assert len(res_email.json()) == 1
    assert res_email.json()[0]["attendee_name"] == "Dr. Ali Hosseini"

    # Search by partial organization "Tehran" -> matches Ali and Maryam
    res_org = await client.get(
        f"/api/events/{event_id}/attendees?q=Tehran", headers=bearer(organizer)
    )
    assert res_org.status_code == 200
    assert len(res_org.json()) == 2
    names = {a["attendee_name"] for a in res_org.json()}
    assert names == {"Dr. Ali Hosseini", "Maryam Rad"}


async def test_staff_can_view_attendee_ticket_and_scan_history(
    client: AsyncClient,
) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    tier_resp = await client.post(
        f"/api/events/{event_id}/ticket-tiers",
        json=tier(name="General", quota=100),
        headers=bearer(organizer),
    )
    tier_id = tier_resp.json()["id"]

    # Register attendee
    reg_resp = await client.post(
        f"/api/events/{event_id}/desk-registrations",
        json={
            "full_name": "Nima Ebadi",
            "email": "nima@example.com",
            "ticket_tier_id": tier_id,
        },
        headers=bearer(organizer),
    )
    ticket_id = reg_resp.json()["ticket_id"]
    qr_secret = reg_resp.json()["qr_secret"]

    # Create 2 check-in points
    gate1 = await client.post(
        f"/api/events/{event_id}/checkin-points",
        json={"name": "Gate 1", "policy_type": "MULTI_ENTRY"},
        headers=bearer(organizer),
    )
    lunch_gate = await client.post(
        f"/api/events/{event_id}/checkin-points",
        json={"name": "Lunch Gate", "policy_type": "SINGLE_USE"},
        headers=bearer(organizer),
    )

    # Scan at Gate 1 and Lunch Gate
    await client.post(
        f"/api/checkin-points/{gate1.json()['id']}/scans/batch",
        json={
            "scans": [
                {
                    "scan_id": str(uuid.uuid4()),
                    "qr_secret": qr_secret,
                    "scanned_at": "2027-04-10T09:00:00Z",
                }
            ]
        },
        headers=bearer(organizer),
    )
    await client.post(
        f"/api/checkin-points/{lunch_gate.json()['id']}/scans/batch",
        json={
            "scans": [
                {
                    "scan_id": str(uuid.uuid4()),
                    "qr_secret": qr_secret,
                    "scanned_at": "2027-04-10T12:30:00Z",
                }
            ]
        },
        headers=bearer(organizer),
    )

    # Retrieve attendee detail card
    detail_resp = await client.get(
        f"/api/events/{event_id}/attendees/{ticket_id}",
        headers=bearer(organizer),
    )
    assert detail_resp.status_code == 200
    card = detail_resp.json()
    assert card["attendee_name"] == "Nima Ebadi"
    assert card["qr_secret"] == qr_secret
    assert len(card["scan_history"]) == 2
    points_scanned = {s["checkin_point_name"] for s in card["scan_history"]}
    assert points_scanned == {"Gate 1", "Lunch Gate"}
    assert all(s["status"] == "ADMITTED" for s in card["scan_history"])


async def test_tenant_isolation_on_desk_registration_and_search(
    client: AsyncClient,
) -> None:
    owner = await provision_organizer(client, "Owner Co")
    intruder = await provision_organizer(client, "Intruder Co")
    event_id = await create_event(client, owner)
    tier_resp = await client.post(
        f"/api/events/{event_id}/ticket-tiers",
        json=tier(name="General", quota=100),
        headers=bearer(owner),
    )
    tier_id = tier_resp.json()["id"]

    # Intruder attempts desk registration on owner's event -> 404
    reg = await client.post(
        f"/api/events/{event_id}/desk-registrations",
        json={"full_name": "Intruder Guest", "ticket_tier_id": tier_id},
        headers=bearer(intruder),
    )
    assert reg.status_code == 404

    # Intruder attempts attendee search on owner's event -> 404
    search = await client.get(
        f"/api/events/{event_id}/attendees",
        headers=bearer(intruder),
    )
    assert search.status_code == 404

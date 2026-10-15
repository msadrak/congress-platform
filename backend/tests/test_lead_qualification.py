import uuid
from httpx import AsyncClient

from tests.helpers import bearer, provision_organizer
from tests.test_booths import BOOTH_PAYLOAD
from tests.test_events import EVENT
from tests.test_ticket_tiers import create_event, tier
from tests.test_tickets import register_user


async def setup_booth_with_captured_leads(
    client: AsyncClient,
) -> tuple[str, str, str, list[dict[str, str]]]:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    tier_resp = await client.post(
        f"/api/events/{event_id}/ticket-tiers",
        json=tier(name="General", quota=100),
        headers=bearer(organizer),
    )
    tier_id = tier_resp.json()["id"]

    booth = (
        await client.post(
            f"/api/events/{event_id}/booths",
            json=BOOTH_PAYLOAD,
            headers=bearer(organizer),
        )
    ).json()
    booth_id = booth["id"]

    _, staff_token = await register_user(
        client, "09121000042", "Booth Staff Rep"
    )
    await client.post(
        f"/api/events/{event_id}/booths/{booth_id}/staff",
        json={"mobile": "09121000042"},
        headers=bearer(organizer),
    )

    # Capture 3 leads
    leads = []
    attendees_info = [
        ("Dr. Ali Rezaei", "09121000043", "HOT", "Urgent inquiry for 10 units"),
        ("Dr. Sara Alavi", "09121000044", "WARM", "General catalog inquiry"),
        ("Nima Rad", "09121000045", "COLD", "Student visit"),
    ]

    for name, mobile, rating, note in attendees_info:
        _, att_token = await register_user(client, mobile, name)
        ticket = (
            await client.post(
                f"/api/events/{event_id}/tickets/reserve",
                json={"ticket_tier_id": tier_id},
                headers={"Authorization": f"Bearer {att_token}"},
            )
        ).json()

        lead = (
            await client.post(
                f"/api/booths/{booth_id}/leads/scan",
                json={
                    "qr_secret": ticket["qr_secret"],
                    "rating": rating,
                    "notes": note,
                },
                headers={"Authorization": f"Bearer {staff_token}"},
            )
        ).json()
        leads.append(lead)

    return event_id, booth_id, staff_token, leads


async def test_staff_can_update_lead_rating_tags_and_notes(
    client: AsyncClient,
) -> None:
    _, booth_id, staff_token, leads = await setup_booth_with_captured_leads(client)
    target_lead = leads[1]  # Dr. Sara Alavi, originally WARM

    patch_resp = await client.patch(
        f"/api/booths/{booth_id}/leads/{target_lead['id']}",
        json={
            "rating": "HOT",
            "tags": ["Send Quote", "Schedule Demo", "Decision Maker"],
            "notes": "Promoted to HOT: CEO requested commercial quotation for 5 systems.",
        },
        headers={"Authorization": f"Bearer {staff_token}"},
    )

    assert patch_resp.status_code == 200, patch_resp.text
    updated = patch_resp.json()
    assert updated["id"] == target_lead["id"]
    assert updated["rating"] == "HOT"
    assert updated["tags"] == ["Send Quote", "Schedule Demo", "Decision Maker"]
    assert "Promoted to HOT" in updated["notes"]


async def test_staff_can_filter_leads_by_search_query_and_rating(
    client: AsyncClient,
) -> None:
    _, booth_id, staff_token, _ = await setup_booth_with_captured_leads(client)

    # 1. Search by name query "rezaei"
    q_resp = await client.get(
        f"/api/booths/{booth_id}/leads?q=rezaei",
        headers={"Authorization": f"Bearer {staff_token}"},
    )
    assert q_resp.status_code == 200
    assert len(q_resp.json()) == 1
    assert q_resp.json()[0]["attendee_name"] == "Dr. Ali Rezaei"

    # 2. Filter by rating "WARM"
    warm_resp = await client.get(
        f"/api/booths/{booth_id}/leads?rating=WARM",
        headers={"Authorization": f"Bearer {staff_token}"},
    )
    assert warm_resp.status_code == 200
    assert len(warm_resp.json()) == 1
    assert warm_resp.json()[0]["attendee_name"] == "Dr. Sara Alavi"

    # 3. Filter by note query "inquiry" (matches Ali and Sara)
    inq_resp = await client.get(
        f"/api/booths/{booth_id}/leads?q=inquiry",
        headers={"Authorization": f"Bearer {staff_token}"},
    )
    assert inq_resp.status_code == 200
    assert len(inq_resp.json()) == 2


async def test_crm_csv_export_returns_valid_csv(
    client: AsyncClient,
) -> None:
    _, booth_id, staff_token, _ = await setup_booth_with_captured_leads(client)

    csv_resp = await client.get(
        f"/api/booths/{booth_id}/leads/export-csv",
        headers={"Authorization": f"Bearer {staff_token}"},
    )
    assert csv_resp.status_code == 200
    assert "text/csv" in csv_resp.headers["content-type"]
    assert "attachment" in csv_resp.headers["content-disposition"]
    assert "-leads.csv" in csv_resp.headers["content-disposition"]

    csv_text = csv_resp.text
    lines = [line.strip() for line in csv_text.strip().split("\n") if line.strip()]
    assert len(lines) >= 4  # 1 header + 3 leads

    header = lines[0]
    assert "Lead ID" in header
    assert "Attendee Name" in header
    assert "Interest Rating" in header
    assert "Follow-Up Tags" in header
    assert "Notes" in header

    # Verify rows contain lead details
    assert any("Dr. Ali Rezaei" in line and "HOT" in line for line in lines)
    assert any("Dr. Sara Alavi" in line and "WARM" in line for line in lines)


async def test_commercial_isolation_on_patch_and_csv(
    client: AsyncClient,
) -> None:
    _, booth_a_id, staff_a_token, leads_a = (
        await setup_booth_with_captured_leads(client)
    )

    # Setup Booth B with Staff B
    org2 = await provision_organizer(client, "Acme 2")
    event_b_resp = await client.post(
        "/api/events",
        json={**EVENT, "name": "Event B", "slug": "event-b-leads"},
        headers=bearer(org2),
    )
    event_b_id = event_b_resp.json()["id"]

    booth_b = (
        await client.post(
            f"/api/events/{event_b_id}/booths",
            json={**BOOTH_PAYLOAD, "name": "Competitor B", "slug": "competitor-b"},
            headers=bearer(org2),
        )
    ).json()
    booth_b_id = booth_b["id"]

    # Staff A attempts to PATCH lead on Booth B -> 403 Forbidden!
    patch_b = await client.patch(
        f"/api/booths/{booth_b_id}/leads/{leads_a[0]['id']}",
        json={"rating": "HOT"},
        headers={"Authorization": f"Bearer {staff_a_token}"},
    )
    assert patch_b.status_code == 403

    # Staff A attempts to export CSV for Booth B -> 403 Forbidden!
    csv_b = await client.get(
        f"/api/booths/{booth_b_id}/leads/export-csv",
        headers={"Authorization": f"Bearer {staff_a_token}"},
    )
    assert csv_b.status_code == 403


async def test_invalid_rating_value_is_rejected(
    client: AsyncClient,
) -> None:
    _, booth_id, staff_token, leads = await setup_booth_with_captured_leads(client)

    patch_resp = await client.patch(
        f"/api/booths/{booth_id}/leads/{leads[0]['id']}",
        json={"rating": "SUPER_HOT_INVALID"},
        headers={"Authorization": f"Bearer {staff_token}"},
    )
    assert patch_resp.status_code == 422

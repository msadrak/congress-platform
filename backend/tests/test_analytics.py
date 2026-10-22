import uuid
from httpx import AsyncClient

from tests.helpers import bearer, provision_organizer
from tests.test_events import EVENT
from tests.test_ticket_tiers import create_event, tier
from tests.test_tickets import register_user


async def setup_event_with_scans(
    client: AsyncClient,
) -> tuple[dict[str, str], str, dict[str, str], dict[str, str], list[dict[str, str]]]:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)

    # 2 Tiers: General (quota 100), VIP (quota 10)
    gen_tier = (
        await client.post(
            f"/api/events/{event_id}/ticket-tiers",
            json=tier(name="General", quota=100),
            headers=bearer(organizer),
        )
    ).json()

    vip_tier = (
        await client.post(
            f"/api/events/{event_id}/ticket-tiers",
            json=tier(name="VIP", quota=10),
            headers=bearer(organizer),
        )
    ).json()

    # 2 CheckInPoints: Main Entrance (MULTI_ENTRY), Lunch (SINGLE_USE)
    main_gate = (
        await client.post(
            f"/api/events/{event_id}/checkin-points",
            json={"name": "Main Entrance", "policy_type": "MULTI_ENTRY"},
            headers=bearer(organizer),
        )
    ).json()

    lunch_gate = (
        await client.post(
            f"/api/events/{event_id}/checkin-points",
            json={"name": "Lunch Catering", "policy_type": "SINGLE_USE"},
            headers=bearer(organizer),
        )
    ).json()

    # 3 Attendees: 2 General, 1 VIP
    tickets = []
    for i, (name, mobile, t_id) in enumerate(
        [
            ("Attendee One", "09121000005", gen_tier["id"]),
            ("Attendee Two", "09121000006", gen_tier["id"]),
            ("VIP Person", "09121000007", vip_tier["id"]),
        ]
    ):
        _, token = await register_user(client, mobile, name)
        t = (
            await client.post(
                f"/api/events/{event_id}/tickets/reserve",
                json={"ticket_tier_id": t_id},
                headers={"Authorization": f"Bearer {token}"},
            )
        ).json()
        tickets.append(t)

    # Scans:
    # Attendee One scans Main Entrance (ADMITTED) & Lunch (ADMITTED)
    await client.post(
        f"/api/checkin-points/{main_gate['id']}/scans/batch",
        json={
            "scans": [
                {
                    "scan_id": str(uuid.uuid4()),
                    "qr_secret": tickets[0]["qr_secret"],
                    "scanned_at": "2027-04-10T08:30:00Z",
                }
            ]
        },
        headers=bearer(organizer),
    )
    await client.post(
        f"/api/checkin-points/{lunch_gate['id']}/scans/batch",
        json={
            "scans": [
                {
                    "scan_id": str(uuid.uuid4()),
                    "qr_secret": tickets[0]["qr_secret"],
                    "scanned_at": "2027-04-10T12:00:00Z",
                }
            ]
        },
        headers=bearer(organizer),
    )

    # Attendee One attempts 2nd scan at Lunch (REJECTED: ALREADY_ADMITTED)
    await client.post(
        f"/api/checkin-points/{lunch_gate['id']}/scans/batch",
        json={
            "scans": [
                {
                    "scan_id": str(uuid.uuid4()),
                    "qr_secret": tickets[0]["qr_secret"],
                    "scanned_at": "2027-04-10T12:15:00Z",
                }
            ]
        },
        headers=bearer(organizer),
    )

    # Attendee Two scans Main Entrance (ADMITTED)
    await client.post(
        f"/api/checkin-points/{main_gate['id']}/scans/batch",
        json={
            "scans": [
                {
                    "scan_id": str(uuid.uuid4()),
                    "qr_secret": tickets[1]["qr_secret"],
                    "scanned_at": "2027-04-10T08:45:00Z",
                }
            ]
        },
        headers=bearer(organizer),
    )

    # VIP Person has not scanned yet.

    return organizer, event_id, main_gate, lunch_gate, tickets


async def test_attendance_kpis_and_catering_metrics(
    client: AsyncClient,
) -> None:
    organizer, event_id, main_gate, lunch_gate, tickets = (
        await setup_event_with_scans(client)
    )

    resp = await client.get(
        f"/api/events/{event_id}/analytics/attendance",
        headers=bearer(organizer),
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()

    # 1. KPIs
    assert data["total_tickets"] == 3
    assert data["unique_admitted"] == 2  # Attendee 1 and 2
    assert round(data["checkin_rate"], 1) == 66.7
    assert data["total_scans"] == 4  # 3 admitted, 1 rejected

    # 2. Catering widget
    assert len(data["catering_metrics"]) == 1
    catering = data["catering_metrics"][0]
    assert catering["point_name"] == "Lunch Catering"
    assert catering["meals_served"] == 1
    assert catering["total_attendees"] == 3
    assert round(catering["redemption_rate"], 1) == 33.3

    # 3. Gate breakdown
    points = {p["point_name"]: p for p in data["gate_breakdown"]}
    assert "Main Entrance" in points
    assert points["Main Entrance"]["total_admitted"] == 2
    assert points["Main Entrance"]["total_rejected"] == 0

    assert "Lunch Catering" in points
    assert points["Lunch Catering"]["total_admitted"] == 1
    assert points["Lunch Catering"]["total_rejected"] == 1


async def test_analytics_filtering_by_gate_and_tier(
    client: AsyncClient,
) -> None:
    organizer, event_id, main_gate, lunch_gate, tickets = (
        await setup_event_with_scans(client)
    )

    # Filter by Lunch Gate only
    lunch_res = await client.get(
        f"/api/events/{event_id}/analytics/attendance?point_id={lunch_gate['id']}",
        headers=bearer(organizer),
    )
    assert lunch_res.status_code == 200
    lunch_data = lunch_res.json()
    assert lunch_data["total_scans"] == 2
    assert len(lunch_data["gate_breakdown"]) == 1
    assert lunch_data["gate_breakdown"][0]["point_name"] == "Lunch Catering"

    # Filter by VIP tier (0 scans)
    vip_tier_id = tickets[2]["ticket_tier_id"]
    vip_res = await client.get(
        f"/api/events/{event_id}/analytics/attendance?ticket_tier_id={vip_tier_id}",
        headers=bearer(organizer),
    )
    assert vip_res.status_code == 200
    vip_data = vip_res.json()
    assert vip_data["unique_admitted"] == 0
    assert vip_data["total_scans"] == 0


async def test_csv_export_generates_valid_csv_download(
    client: AsyncClient,
) -> None:
    organizer, event_id, main_gate, lunch_gate, tickets = (
        await setup_event_with_scans(client)
    )

    resp = await client.get(
        f"/api/events/{event_id}/analytics/export-csv",
        headers=bearer(organizer),
    )
    assert resp.status_code == 200
    assert "text/csv" in resp.headers["content-type"]
    assert "attachment" in resp.headers["content-disposition"]
    assert "attendance.csv" in resp.headers["content-disposition"]

    csv_text = resp.text
    lines = [line.strip() for line in csv_text.strip().split("\n") if line.strip()]
    assert len(lines) >= 5  # 1 header + 4 scan rows

    header = lines[0]
    assert "Scan ID" in header
    assert "Check-In Point" in header
    assert "Status" in header
    assert "Attendee Name" in header

    # Verify rows contain attendee and status
    assert any("Attendee One" in line and "ADMITTED" in line for line in lines)
    assert any("ALREADY_ADMITTED" in line for line in lines)


async def test_tenant_isolation_on_analytics_and_csv(
    client: AsyncClient,
) -> None:
    owner, event_id, _, _, _ = await setup_event_with_scans(client)
    intruder = await provision_organizer(client, "Intruder Co")

    analytics_resp = await client.get(
        f"/api/events/{event_id}/analytics/attendance",
        headers=bearer(intruder),
    )
    assert analytics_resp.status_code == 404

    csv_resp = await client.get(
        f"/api/events/{event_id}/analytics/export-csv",
        headers=bearer(intruder),
    )
    assert csv_resp.status_code == 404

import csv
import io
import uuid
from datetime import timedelta

import pytest
from fastapi import FastAPI
from httpx import AsyncClient, Response
from sqlalchemy import update

from app.models import Ticket
from app.routes import checkin
from tests.helpers import bearer, provision_organizer, publish_page
from tests.test_events import EVENT
from tests.test_ticket_tiers import create_event, tier
from tests.test_tickets import register_user


@pytest.fixture(autouse=True)
def trust_future_scan_times(monkeypatch: pytest.MonkeyPatch) -> None:
    """These tests replay a congress dated in the future; the gate's clock-skew guard would move those scans to now."""
    monkeypatch.setattr(checkin, "CLOCK_SKEW_TOLERANCE", timedelta(days=3650))


async def setup_event_with_scans(
    client: AsyncClient,
) -> tuple[dict[str, str], str, dict[str, str], dict[str, str], list[dict[str, str]]]:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    await publish_page(client, organizer, event_id)

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


async def scan(
    client: AsyncClient, organizer: dict[str, str], point_id: str, qr_secret: str, scanned_at: str
) -> None:
    response = await client.post(
        f"/api/checkin-points/{point_id}/scans/batch",
        json={"scans": [{"scan_id": str(uuid.uuid4()), "qr_secret": qr_secret, "scanned_at": scanned_at}]},
        headers=bearer(organizer),
    )
    assert response.status_code == 200, response.text


def csv_rows(response: Response) -> list[dict[str, str]]:
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("text/csv")
    assert response.content.startswith(b"\xef\xbb\xbf")
    return list(csv.DictReader(io.StringIO(response.content.decode("utf-8-sig"))))


async def set_ticket_status(app: FastAPI, ticket_id: str, status: str) -> None:
    """Ticket cancellation has no route yet; the analytics must count whatever statuses are stored."""
    async with app.state.sessionmaker() as session:
        await session.execute(update(Ticket).where(Ticket.id == uuid.UUID(ticket_id)).values(status=status))
        await session.commit()


async def test_hourly_buckets_are_local_to_the_event_timezone_and_keep_days_apart(
    client: AsyncClient,
) -> None:
    organizer, event_id, main_gate, lunch_gate, tickets = await setup_event_with_scans(client)
    # 21:00 UTC on day one is 00:30 on day two in Tehran (+03:30); 08:40 UTC on day two is 12:10 there.
    await scan(client, organizer, main_gate["id"], tickets[1]["qr_secret"], "2027-04-10T21:00:00Z")
    await scan(client, organizer, main_gate["id"], tickets[1]["qr_secret"], "2027-04-11T08:40:00Z")

    response = await client.get(f"/api/events/{event_id}/analytics/attendance", headers=bearer(organizer))
    assert response.status_code == 200, response.text
    data = response.json()

    assert data["timezone"] == "Asia/Tehran"
    # The event runs 2027-04-10 11:30 to 2027-04-12 21:30 Tehran time.
    assert data["days"] == ["2027-04-10", "2027-04-11", "2027-04-12"]
    gates = {g["point_name"]: g for g in data["gate_breakdown"]}
    assert gates["Main Entrance"]["hourly_scans"] == [
        {"day": "2027-04-10", "hour": "12:00", "starts_at": "2027-04-10T12:00:00+03:30", "count": 2, "admitted": 2, "rejected": 0},
        {"day": "2027-04-11", "hour": "00:00", "starts_at": "2027-04-11T00:00:00+03:30", "count": 1, "admitted": 1, "rejected": 0},
        {"day": "2027-04-11", "hour": "12:00", "starts_at": "2027-04-11T12:00:00+03:30", "count": 1, "admitted": 1, "rejected": 0},
    ]
    assert gates["Lunch Catering"]["hourly_scans"] == [
        {"day": "2027-04-10", "hour": "15:00", "starts_at": "2027-04-10T15:00:00+03:30", "count": 2, "admitted": 1, "rejected": 1},
    ]
    # The event-wide series sums every gate per local hour.
    assert [(b["day"], b["hour"], b["count"]) for b in data["hourly_scans"]] == [
        ("2027-04-10", "12:00", 2),
        ("2027-04-10", "15:00", 2),
        ("2027-04-11", "00:00", 1),
        ("2027-04-11", "12:00", 1),
    ]

    # A local day selects midnight to midnight on the event's clock.
    day_two = await client.get(
        f"/api/events/{event_id}/analytics/attendance", params={"day": "2027-04-11"}, headers=bearer(organizer)
    )
    assert day_two.status_code == 200, day_two.text
    day_two_data = day_two.json()
    assert day_two_data["total_scans"] == 2
    assert day_two_data["unique_admitted"] == 1
    assert day_two_data["days"] == data["days"]  # the day picker keeps every day
    day_two_gates = {g["point_name"]: g for g in day_two_data["gate_breakdown"]}
    assert day_two_gates["Main Entrance"]["total_admitted"] == 2
    assert day_two_gates["Lunch Catering"]["total_admitted"] == 0

    # A naive bound is wall-clock time in the event's zone; an aware one is an instant.
    naive = await client.get(
        f"/api/events/{event_id}/analytics/attendance",
        params={"from_time": "2027-04-10T15:00:00", "to_time": "2027-04-10T23:59:59"},
        headers=bearer(organizer),
    )
    assert naive.json()["total_scans"] == 2  # the two lunch scans at 15:30 and 15:45
    aware = await client.get(
        f"/api/events/{event_id}/analytics/attendance",
        params={"from_time": "2027-04-10T12:00:00Z"},
        headers=bearer(organizer),
    )
    assert aware.json()["total_scans"] == 4


async def test_admissions_are_labelled_honestly_and_occupancy_is_deprecated(client: AsyncClient) -> None:
    organizer, event_id, main_gate, _, tickets = await setup_event_with_scans(client)
    await scan(client, organizer, main_gate["id"], tickets[0]["qr_secret"], "2027-04-10T13:00:00Z")

    data = (await client.get(f"/api/events/{event_id}/analytics/attendance", headers=bearer(organizer))).json()
    main = next(g for g in data["gate_breakdown"] if g["point_name"] == "Main Entrance")
    # Three admissions by two people: a cumulative count, not who is inside now.
    assert main["admissions"] == 3
    assert main["current_occupancy"] == main["admissions"]

    schema = (await client.get("/openapi.json")).json()["components"]["schemas"]["GateMetric"]
    assert schema["properties"]["current_occupancy"]["deprecated"] is True


async def test_registrations_are_counted_by_status_and_tier(app: FastAPI, client: AsyncClient) -> None:
    organizer, event_id, _, _, tickets = await setup_event_with_scans(client)
    await set_ticket_status(app, tickets[1]["id"], "cancelled")

    data = (await client.get(f"/api/events/{event_id}/analytics/attendance", headers=bearer(organizer))).json()
    assert data["total_tickets"] == 2  # active tickets only
    assert data["tickets_by_status"] == [{"status": "active", "count": 2}, {"status": "cancelled", "count": 1}]
    tiers = {t["tier_name"]: t for t in data["tier_registrations"]}
    assert tiers["General"] == {
        "tier_id": tickets[0]["ticket_tier_id"], "tier_name": "General", "quota": 100, "active": 1, "total": 2
    }
    assert tiers["VIP"]["active"] == 1 and tiers["VIP"]["total"] == 1

    vip = (
        await client.get(
            f"/api/events/{event_id}/analytics/attendance",
            params={"ticket_tier_id": tickets[2]["ticket_tier_id"]},
            headers=bearer(organizer),
        )
    ).json()
    assert vip["tickets_by_status"] == [{"status": "active", "count": 1}]
    assert [t["tier_name"] for t in vip["tier_registrations"]] == ["VIP"]


async def test_attendance_csv_applies_the_dashboard_filters_and_local_time(client: AsyncClient) -> None:
    organizer, event_id, main_gate, lunch_gate, tickets = await setup_event_with_scans(client)
    url = f"/api/events/{event_id}/analytics/export-csv"

    everything = csv_rows(await client.get(url, headers=bearer(organizer)))
    assert len(everything) == 4
    first_lunch = next(r for r in everything if r["Scanned At (UTC)"].startswith("2027-04-10T12:00:00"))
    assert first_lunch["Scanned At (Asia/Tehran)"] == "2027-04-10T15:30:00+03:30"
    assert first_lunch["Attendee Name"] == "Attendee One"

    lunch = csv_rows(await client.get(url, params={"point_id": lunch_gate["id"]}, headers=bearer(organizer)))
    assert len(lunch) == 2 and {r["Check-In Point"] for r in lunch} == {"Lunch Catering"}

    vip = csv_rows(
        await client.get(url, params={"ticket_tier_id": tickets[2]["ticket_tier_id"]}, headers=bearer(organizer))
    )
    assert vip == []

    morning = csv_rows(await client.get(url, params={"to_time": "2027-04-10T12:59:59"}, headers=bearer(organizer)))
    assert {r["Check-In Point"] for r in morning} == {"Main Entrance"} and len(morning) == 2

    other_day = csv_rows(await client.get(url, params={"day": "2027-04-11"}, headers=bearer(organizer)))
    assert other_day == []


async def test_registrations_csv_has_one_row_per_ticket(app: FastAPI, client: AsyncClient) -> None:
    organizer, event_id, main_gate, lunch_gate, tickets = await setup_event_with_scans(client)
    await set_ticket_status(app, tickets[1]["id"], "cancelled")
    _, token = await register_user(client, "09121000008", '=HYPERLINK("http://x")')
    reserved = await client.post(
        f"/api/events/{event_id}/tickets/reserve",
        json={"ticket_tier_id": tickets[2]["ticket_tier_id"]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert reserved.status_code in (200, 201), reserved.text
    url = f"/api/events/{event_id}/analytics/registrations-csv"

    response = await client.get(url, headers=bearer(organizer))
    assert "registrations.csv" in response.headers["content-disposition"]
    rows = {r["Attendee Name"]: r for r in csv_rows(response)}
    assert len(rows) == 4
    one = rows["Attendee One"]
    assert one["Ticket Tier"] == "General"
    assert one["Status"] == "active"
    assert one["Admissions"] == "2"  # the rejected second lunch scan is not an admission
    assert one["First Admission (Asia/Tehran)"] == "2027-04-10T12:00:00+03:30"
    assert one["Registered At (Asia/Tehran)"].endswith("+03:30")
    assert rows["Attendee Two"]["Status"] == "cancelled"
    assert rows["VIP Person"]["Admissions"] == "0"
    assert rows["VIP Person"]["First Admission (Asia/Tehran)"] == ""
    assert "'=HYPERLINK(\"http://x\")" in rows  # formula cells are neutralised

    # The gate and date filters scope the admission columns; the tier filter picks the rows.
    lunch = {
        r["Attendee Name"]: r
        for r in csv_rows(await client.get(url, params={"point_id": lunch_gate["id"]}, headers=bearer(organizer)))
    }
    assert lunch["Attendee One"]["Admissions"] == "1"
    assert lunch["Attendee One"]["First Admission (Asia/Tehran)"] == "2027-04-10T15:30:00+03:30"
    vip = csv_rows(
        await client.get(url, params={"ticket_tier_id": tickets[2]["ticket_tier_id"]}, headers=bearer(organizer))
    )
    assert sorted(r["Attendee Name"] for r in vip) == sorted(["VIP Person", "'=HYPERLINK(\"http://x\")"])

    intruder = await provision_organizer(client, "Intruder Co")
    assert (await client.get(url, headers=bearer(intruder))).status_code == 404


async def test_exports_name_the_registration_not_the_account(client: AsyncClient) -> None:
    organizer, event_id, _, _, tickets = await setup_event_with_scans(client)
    edited = await client.patch(
        f"/api/events/{event_id}/participants/{tickets[0]['id']}",
        json={"attendee_full_name": "Dr. Corrected", "attendee_organization": "Fixed Org", "attendee_title": "MD"},
        headers=bearer(organizer),
    )
    assert edited.status_code == 200, edited.text

    base = f"/api/events/{event_id}/analytics"
    for path in ("export-csv", "registrations-csv"):
        rows = csv_rows(await client.get(f"{base}/{path}", headers=bearer(organizer)))
        names = {r["Attendee Name"] for r in rows}
        assert "Dr. Corrected" in names and "Attendee One" not in names, path
        corrected = next(r for r in rows if r["Attendee Name"] == "Dr. Corrected")
        assert (corrected["Organization"], corrected["Title"]) == ("Fixed Org", "MD"), path


async def test_an_inverted_date_range_is_refused_with_a_code(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    bounds = {"from_time": "2027-04-11T00:00:00Z", "to_time": "2027-04-10T00:00:00Z"}
    for path in ("attendance", "export-csv", "registrations-csv"):
        response = await client.get(
            f"/api/events/{event_id}/analytics/{path}", params=bounds, headers=bearer(organizer)
        )
        assert response.status_code == 400, path
        assert response.json()["code"] == "ANALYTICS_RANGE_INVALID"

"""Event lifecycle: time zone, registration switch and window, public listing, archive, delete; the reservation
rules they imply (with tier sales windows) and tier deletion."""

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest
from httpx import AsyncClient

from tests.helpers import bearer, provision_organizer, publish_page, sign_in
from tests.test_events import EVENT


def iso(delta: timedelta) -> str:
    return (datetime.now(timezone.utc) + delta).isoformat()


async def make_event(client: AsyncClient, organizer: dict[str, str], **overrides: Any) -> dict[str, Any]:
    body = {**EVENT, "slug": f"congress-{uuid.uuid4().hex[:8]}", **overrides}
    response = await client.post("/api/events", json=body, headers=bearer(organizer))
    assert response.status_code == 201, response.text
    created: dict[str, Any] = response.json()
    return created


async def make_tier(client: AsyncClient, organizer: dict[str, str], event_id: str, **overrides: Any) -> dict[str, Any]:
    response = await client.post(
        f"/api/events/{event_id}/ticket-tiers",
        json={"name": "General", "quota": 10, **overrides},
        headers=bearer(organizer),
    )
    assert response.status_code == 201, response.text
    created: dict[str, Any] = response.json()
    return created


async def reserve(client: AsyncClient, event_id: str, tier_id: str, mobile: str = "09121112233") -> Any:
    _, token = await sign_in(client, mobile)
    return await client.post(
        f"/api/events/{event_id}/tickets/reserve",
        json={"ticket_tier_id": tier_id},
        headers={"Authorization": f"Bearer {token}"},
    )


async def patch_event(client: AsyncClient, organizer: dict[str, str], event_id: str, **fields: Any) -> Any:
    return await client.patch(f"/api/events/{event_id}", json=fields, headers=bearer(organizer))


# ── Fields ───────────────────────────────────────────────────────────────────────────────────────


async def test_a_new_event_has_lifecycle_defaults(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event = await make_event(client, organizer)
    assert event["timezone"] == "Asia/Tehran"
    assert event["registration_enabled"] is True
    assert event["registration_opens_at"] is None
    assert event["registration_closes_at"] is None
    assert event["listed"] is False
    assert event["archived_at"] is None


@pytest.mark.parametrize("zone", ["Mars/Olympus", "asia/tehran", "../etc/passwd", "", "+03:30"])
async def test_the_time_zone_must_be_an_iana_name(client: AsyncClient, zone: str) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    created = await client.post(
        "/api/events", json={**EVENT, "timezone": zone}, headers=bearer(organizer)
    )
    assert created.status_code == 422
    event = await make_event(client, organizer, timezone="Europe/Berlin")
    assert event["timezone"] == "Europe/Berlin"
    assert (await patch_event(client, organizer, event["id"], timezone=zone)).status_code == 422


async def test_the_registration_window_must_open_before_it_closes(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    backwards = {"registration_opens_at": iso(timedelta(days=2)), "registration_closes_at": iso(timedelta(days=1))}
    created = await client.post("/api/events", json={**EVENT, **backwards}, headers=bearer(organizer))
    assert created.status_code == 422

    event = await make_event(client, organizer, registration_closes_at=iso(timedelta(days=1)))
    late_open = await patch_event(client, organizer, event["id"], registration_opens_at=iso(timedelta(days=3)))
    assert late_open.status_code == 422
    # An explicit null clears a bound.
    cleared = await patch_event(client, organizer, event["id"], registration_closes_at=None, listed=True)
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["registration_closes_at"] is None
    assert cleared.json()["listed"] is True


# ── Archive and delete ───────────────────────────────────────────────────────────────────────────


async def test_an_archived_event_is_hidden_publicly_and_read_only(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event = await make_event(client, organizer, listed=True)
    event_id = event["id"]
    tier = await make_tier(client, organizer, event_id)
    await publish_page(client, organizer, event_id)
    public = f"/api/public/events/{event['slug']}"
    assert (await client.get(public)).status_code == 200

    archived = await client.post(f"/api/events/{event_id}/archive", json={"archived": True}, headers=bearer(organizer))
    assert archived.status_code == 200, archived.text
    assert archived.json()["archived_at"] is not None

    assert (await client.get(public)).status_code == 404
    assert (await client.get("/api/public/events")).json()["items"] == []
    assert (await client.get(f"/api/events/{event_id}", headers=bearer(organizer))).status_code == 200
    writes = [
        await patch_event(client, organizer, event_id, name="Renamed"),
        await client.post(f"/api/events/{event_id}/ticket-tiers", json={"name": "VIP", "quota": 5}, headers=bearer(organizer)),
        await client.patch(f"/api/events/{event_id}/ticket-tiers/{tier['id']}", json={"quota": 20}, headers=bearer(organizer)),
        await client.post(
            f"/api/events/{event_id}/sessions",
            json={"title": "Talk", "starts_at": "2027-04-10T09:00:00Z", "ends_at": "2027-04-10T10:00:00Z"},
            headers=bearer(organizer),
        ),
        await client.post(f"/api/events/{event_id}/venue-places", json={"kind": "hall", "name": "A"}, headers=bearer(organizer)),
    ]
    for response in writes:
        assert response.status_code == 409, response.text
        assert response.json()["code"] == "EVENT_ARCHIVED"
        assert "archived" in response.json()["detail"].lower()
    refused = await reserve(client, event_id, tier["id"])
    assert (refused.status_code, refused.json()["code"]) == (404, "EVENT_NOT_FOUND")

    restored = await client.post(f"/api/events/{event_id}/archive", json={"archived": False}, headers=bearer(organizer))
    assert restored.status_code == 200 and restored.json()["archived_at"] is None
    assert (await client.get(public)).status_code == 200
    assert (await patch_event(client, organizer, event_id, name="Renamed")).status_code == 200


async def test_an_event_without_tickets_can_be_deleted_with_everything_it_holds(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    intruder = await provision_organizer(client, "Intruder Co")
    event = await make_event(client, organizer)
    event_id = event["id"]
    await make_tier(client, organizer, event_id)
    hall = (await client.post(f"/api/events/{event_id}/venue-places", json={"kind": "hall", "name": "A"}, headers=bearer(organizer))).json()
    await client.post(
        f"/api/events/{event_id}/sessions",
        json={"title": "Talk", "hall_id": hall["id"], "starts_at": "2027-04-10T09:00:00Z", "ends_at": "2027-04-10T10:00:00Z"},
        headers=bearer(organizer),
    )
    booth = await client.post(
        f"/api/events/{event_id}/booths", json={"name": "Booth", "slug": "booth"}, headers=bearer(organizer)
    )
    assert booth.status_code == 201, booth.text
    point = await client.post(
        f"/api/events/{event_id}/checkin-points", json={"name": "Main gate"}, headers=bearer(organizer)
    )
    assert point.status_code == 201, point.text

    assert (await client.delete(f"/api/events/{event_id}", headers=bearer(intruder))).status_code == 404
    deleted = await client.delete(f"/api/events/{event_id}", headers=bearer(organizer))
    assert deleted.status_code == 204, deleted.text
    assert (await client.get(f"/api/events/{event_id}", headers=bearer(organizer))).status_code == 404
    # The slug is free again.
    assert (await client.post("/api/events", json={**EVENT, "slug": event["slug"]}, headers=bearer(organizer))).status_code == 201


async def test_an_event_with_tickets_cannot_be_deleted(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event = await make_event(client, organizer)
    tier = await make_tier(client, organizer, event["id"])
    await publish_page(client, organizer, event["id"])
    assert (await reserve(client, event["id"], tier["id"])).status_code == 201

    refused = await client.delete(f"/api/events/{event['id']}", headers=bearer(organizer))
    assert refused.status_code == 409
    assert refused.json()["code"] == "EVENT_HAS_TICKETS"
    assert "ticket" in refused.json()["detail"].lower()


# ── Reservation rules ────────────────────────────────────────────────────────────────────────────


async def test_reservation_needs_a_published_page(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event = await make_event(client, organizer)
    tier = await make_tier(client, organizer, event["id"])
    unpublished = await reserve(client, event["id"], tier["id"])
    assert unpublished.status_code == 404
    assert unpublished.json() == {"detail": "Event not found", "code": "EVENT_NOT_FOUND"}
    await publish_page(client, organizer, event["id"])
    assert (await reserve(client, event["id"], tier["id"])).status_code == 201


async def test_reservation_is_refused_after_the_event_ended(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event = await make_event(client, organizer, starts_at=iso(timedelta(days=-3)), ends_at=iso(timedelta(hours=-1)))
    tier = await make_tier(client, organizer, event["id"])
    await publish_page(client, organizer, event["id"])
    refused = await reserve(client, event["id"], tier["id"])
    assert refused.status_code == 409
    assert refused.json()["code"] == "EVENT_ENDED"
    assert "ended" in refused.json()["detail"].lower()


async def test_reservation_follows_the_registration_switch_and_window(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event = await make_event(client, organizer, registration_enabled=False)
    event_id = event["id"]
    tier = await make_tier(client, organizer, event_id)
    await publish_page(client, organizer, event_id)

    disabled = await reserve(client, event_id, tier["id"])
    assert disabled.status_code == 409 and "closed" in disabled.json()["detail"].lower()
    assert disabled.json()["code"] == "REGISTRATION_CLOSED"

    await patch_event(client, organizer, event_id, registration_enabled=True, registration_opens_at=iso(timedelta(days=1)))
    early = await reserve(client, event_id, tier["id"])
    assert early.status_code == 409 and "not open" in early.json()["detail"].lower()
    assert early.json()["code"] == "REGISTRATION_NOT_OPEN"

    await patch_event(
        client, organizer, event_id, registration_opens_at=iso(timedelta(days=-2)), registration_closes_at=iso(timedelta(days=-1))
    )
    late = await reserve(client, event_id, tier["id"])
    assert late.status_code == 409 and "closed" in late.json()["detail"].lower()
    assert late.json()["code"] == "REGISTRATION_CLOSED"

    await patch_event(client, organizer, event_id, registration_closes_at=iso(timedelta(days=1)))
    assert (await reserve(client, event_id, tier["id"])).status_code == 201

    public = (await client.get(f"/api/public/events/{event['slug']}")).json()
    assert public["timezone"] == "Asia/Tehran"
    assert public["registration_enabled"] is True
    assert public["registration_open"] is True
    assert public["registration_closes_at"] is not None


async def test_reservation_follows_the_tier_sales_window(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event = await make_event(client, organizer)
    event_id = event["id"]
    upcoming = await make_tier(client, organizer, event_id, name="Later", sales_starts_at=iso(timedelta(days=1)))
    over = await make_tier(client, organizer, event_id, name="Early bird", sales_ends_at=iso(timedelta(minutes=-5)))
    await publish_page(client, organizer, event_id)

    not_yet = await reserve(client, event_id, upcoming["id"])
    assert not_yet.status_code == 409 and "not started" in not_yet.json()["detail"].lower()
    assert not_yet.json()["code"] == "TIER_SALES_NOT_OPEN"
    ended = await reserve(client, event_id, over["id"])
    assert ended.status_code == 409 and "ended" in ended.json()["detail"].lower()
    assert ended.json()["code"] == "TIER_SALES_CLOSED"
    # A refused reservation takes no seat.
    tiers = (await client.get(f"/api/events/{event_id}/ticket-tiers", headers=bearer(organizer))).json()
    assert [t["reserved_count"] for t in tiers] == [0, 0]
    assert tiers[0]["sales_starts_at"] is not None

    backwards = await client.post(
        f"/api/events/{event_id}/ticket-tiers",
        json={"name": "X", "quota": 1, "sales_starts_at": iso(timedelta(days=2)), "sales_ends_at": iso(timedelta(days=1))},
        headers=bearer(organizer),
    )
    assert backwards.status_code == 422

    opened = await client.patch(
        f"/api/events/{event_id}/ticket-tiers/{upcoming['id']}", json={"sales_starts_at": None}, headers=bearer(organizer)
    )
    assert opened.status_code == 200 and opened.json()["sales_starts_at"] is None
    assert (await reserve(client, event_id, upcoming["id"])).status_code == 201


# ── Tiers ────────────────────────────────────────────────────────────────────────────────────────


async def test_a_tier_can_be_deleted_only_while_nobody_reserved_it(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event = await make_event(client, organizer)
    event_id = event["id"]
    unused = await make_tier(client, organizer, event_id, name="Unused")
    taken = await make_tier(client, organizer, event_id, name="Taken")
    await publish_page(client, organizer, event_id)
    assert (await reserve(client, event_id, taken["id"])).status_code == 201

    url = f"/api/events/{event_id}/ticket-tiers"
    refused = await client.delete(f"{url}/{taken['id']}", headers=bearer(organizer))
    assert (refused.status_code, refused.json()["code"]) == (409, "TIER_HAS_RESERVATIONS")
    assert (await client.delete(f"{url}/{unused['id']}", headers=bearer(organizer))).status_code == 204
    assert (await client.delete(f"{url}/{unused['id']}", headers=bearer(organizer))).status_code == 404
    assert [t["name"] for t in (await client.get(url, headers=bearer(organizer))).json()] == ["Taken"]


# ── Public event list ────────────────────────────────────────────────────────────────────────────


async def test_the_public_list_shows_listed_published_events_upcoming_first(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")

    async def public_event(name: str, starts: timedelta, *, listed: bool = True, publish: bool = True) -> dict[str, Any]:
        event = await make_event(
            client, organizer, name=name, listed=listed, starts_at=iso(starts), ends_at=iso(starts + timedelta(days=1))
        )
        if publish:
            await publish_page(client, organizer, event["id"])
        return event

    await public_event("Past", timedelta(days=-30))
    await public_event("Later", timedelta(days=60))
    await public_event("Soon", timedelta(days=5))
    await public_event("Unlisted", timedelta(days=6), listed=False)
    await public_event("Draft", timedelta(days=7), publish=False)
    archived = await public_event("Archived", timedelta(days=8))
    await client.post(f"/api/events/{archived['id']}/archive", json={"archived": True}, headers=bearer(organizer))

    listing = await client.get("/api/public/events")
    assert listing.status_code == 200
    body = listing.json()
    assert [e["name"] for e in body["items"]] == ["Soon", "Later", "Past"]
    assert body["total"] == 3
    assert set(body["items"][0]) == {"id", "name", "slug", "starts_at", "ends_at", "location", "timezone"}

    page = (await client.get("/api/public/events", params={"limit": 1, "offset": 1})).json()
    assert [e["name"] for e in page["items"]] == ["Later"]
    assert (page["total"], page["limit"], page["offset"]) == (3, 1, 1)
    assert (await client.get("/api/public/events", params={"limit": 0})).status_code == 422

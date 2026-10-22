"""Resending the pass link by SMS from the front desk, for an attendee who did not receive it."""

from typing import Any

from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy import select

from app.models import SmsMessage
from app.sms.gateway import SmsGateway
from app.sms.provider import RecordingProvider, SmsResult
from tests.helpers import bearer, pass_link, provision_organizer
from tests.test_events import EVENT
from tests.test_ticket_tiers import create_event, tier

MOBILE = "09121112244"


async def walk_in(client: AsyncClient, **body: Any) -> tuple[dict[str, str], str, str]:
    """A desk-issued pass; returns (organizer, event id, ticket id)."""
    organizer = await provision_organizer(client, "Resend Congress Co")
    event_id = await create_event(client, organizer)
    tier_id = (
        await client.post(f"/api/events/{event_id}/ticket-tiers", json=tier(), headers=bearer(organizer))
    ).json()["id"]
    issued = await client.post(
        f"/api/events/{event_id}/desk-registrations",
        json={"full_name": "Dr. Sima Rad", "ticket_tier_id": tier_id, **body},
        headers=bearer(organizer),
    )
    assert issued.status_code == 201, issued.text
    return organizer, event_id, issued.json()["ticket_id"]


def recorder(app: FastAPI) -> RecordingProvider:
    gateway: SmsGateway = app.state.sms
    return gateway.recorder


async def resends(app: FastAPI) -> list[SmsMessage]:
    async with app.state.sessionmaker() as session:
        return list((await session.scalars(select(SmsMessage).where(SmsMessage.kind == "ticket_resend"))).all())


async def test_desk_resends_the_pass_link_now(app: FastAPI, client: AsyncClient) -> None:
    organizer, event_id, ticket_id = await walk_in(client, mobile=MOBILE)

    resp = await client.post(f"/api/events/{event_id}/attendees/{ticket_id}/resend-sms", headers=bearer(organizer))

    assert resp.status_code == 200, resp.text
    assert resp.json() == {"status": "sent", "mobile": MOBILE, "error": None, "test_mode": True}
    delivered = recorder(app).sent_to(MOBILE)[-1]
    assert delivered.kind == "ticket_resend"
    assert delivered.text == (
        f"Dr. Sima Rad عزیز، ثبت‌نام شما در «{EVENT['name']}» تأیید شد.\n"
        f"کارت ورود: {await pass_link(app, ticket_id)}"
    )
    (logged,) = await resends(app)
    assert (logged.status, logged.mobile, logged.body) == ("sent", MOBILE, delivered.text)
    assert str(logged.event_id) == event_id and logged.sent_at is not None


async def test_resends_are_spaced_out_per_attendee(app: FastAPI, client: AsyncClient) -> None:
    organizer, event_id, ticket_id = await walk_in(client, mobile=MOBILE)
    url = f"/api/events/{event_id}/attendees/{ticket_id}/resend-sms"

    assert (await client.post(url, headers=bearer(organizer))).status_code == 200
    again = await client.post(url, headers=bearer(organizer))

    assert again.status_code == 429
    assert int(again.headers["Retry-After"]) > 0
    assert len(await resends(app)) == 1


async def test_a_failed_resend_is_reported_and_logged(app: FastAPI, client: AsyncClient) -> None:
    organizer, event_id, ticket_id = await walk_in(client, mobile=MOBILE)
    recorder(app).queued_results.append(SmsResult(ok=False, error="REJECTED_11"))

    resp = await client.post(f"/api/events/{event_id}/attendees/{ticket_id}/resend-sms", headers=bearer(organizer))

    assert resp.status_code == 200
    assert (resp.json()["status"], resp.json()["error"]) == ("failed", "REJECTED_11")
    (logged,) = await resends(app)
    assert logged.status == "failed" and logged.sent_at is None


async def test_nothing_to_resend_without_a_mobile(app: FastAPI, client: AsyncClient) -> None:
    organizer, event_id, ticket_id = await walk_in(client)

    resp = await client.post(f"/api/events/{event_id}/attendees/{ticket_id}/resend-sms", headers=bearer(organizer))

    assert resp.status_code == 409
    assert await resends(app) == []


async def test_resend_is_scoped_to_the_event_and_its_desk(app: FastAPI, client: AsyncClient) -> None:
    organizer, event_id, ticket_id = await walk_in(client, mobile=MOBILE)
    other = await provision_organizer(client, "Other Congress Co")
    created = await client.post("/api/events", json={**EVENT, "slug": "other-congress"}, headers=bearer(other))
    assert created.status_code == 201, created.text
    other_event_id = created.json()["id"]

    stranger = await client.post(f"/api/events/{event_id}/attendees/{ticket_id}/resend-sms", headers=bearer(other))
    wrong_event = await client.post(
        f"/api/events/{other_event_id}/attendees/{ticket_id}/resend-sms", headers=bearer(other)
    )
    anonymous = await client.post(f"/api/events/{event_id}/attendees/{ticket_id}/resend-sms")

    assert (stranger.status_code, wrong_event.status_code, anonymous.status_code) == (404, 404, 401)
    assert await resends(app) == []

"""A congress with one booth, one booth representative and one ticket-holding attendee (exhibitor tests)."""

import uuid
from dataclasses import dataclass
from typing import Any

from httpx import AsyncClient

from tests.helpers import bearer, provision_organizer, publish_page
from tests.test_booths import BOOTH_PAYLOAD
from tests.test_events import EVENT
from tests.test_ticket_tiers import tier
from tests.test_tickets import register_user

STAFF_MOBILE = "09121000801"
ATTENDEE_MOBILE = "09121000802"


@dataclass
class Congress:
    organizer: dict[str, str]
    event_id: str
    slug: str
    tier_id: str
    booth: dict[str, Any]
    staff: dict[str, str]
    staff_assignment: dict[str, Any]
    attendee: dict[str, str]
    ticket: dict[str, Any]

    @property
    def booth_id(self) -> str:
        booth_id: str = self.booth["id"]
        return booth_id


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def reserve(client: AsyncClient, event_id: str, tier_id: str, token: str) -> dict[str, Any]:
    response = await client.post(
        f"/api/events/{event_id}/tickets/reserve", json={"ticket_tier_id": tier_id}, headers=auth(token)
    )
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


async def setup_congress(
    client: AsyncClient,
    *,
    organizer: dict[str, str] | None = None,
    slug: str | None = None,
    staff_mobile: str = STAFF_MOBILE,
    attendee_mobile: str = ATTENDEE_MOBILE,
    attendee_name: str = "Dr. Lead Buyer",
) -> Congress:
    organizer = organizer or await provision_organizer(client, "Acme Congress Co")
    slug = slug or EVENT["slug"]
    created = await client.post("/api/events", json={**EVENT, "slug": slug}, headers=bearer(organizer))
    assert created.status_code == 201, created.text
    event_id: str = created.json()["id"]
    await publish_page(client, organizer, event_id)
    tier_id = (
        await client.post(f"/api/events/{event_id}/ticket-tiers", json=tier(), headers=bearer(organizer))
    ).json()["id"]
    booth = (
        await client.post(
            f"/api/events/{event_id}/booths",
            json={**BOOTH_PAYLOAD, "slug": f"booth-{uuid.uuid4().hex[:6]}"},
            headers=bearer(organizer),
        )
    ).json()
    _, staff_token = await register_user(client, staff_mobile, "Booth Rep")
    assigned = await client.post(
        f"/api/events/{event_id}/booths/{booth['id']}/staff", json={"mobile": staff_mobile}, headers=bearer(organizer)
    )
    assert assigned.status_code == 201, assigned.text
    _, attendee_token = await register_user(client, attendee_mobile, attendee_name)
    ticket = await reserve(client, event_id, tier_id, attendee_token)
    return Congress(
        organizer=organizer,
        event_id=event_id,
        slug=slug,
        tier_id=tier_id,
        booth=booth,
        staff=auth(staff_token),
        staff_assignment=assigned.json(),
        attendee=auth(attendee_token),
        ticket=ticket,
    )

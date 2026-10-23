"""Stable machine-readable error codes: `{"detail": <English message>, "code": <UPPER_SNAKE>}`.

`detail` keeps its exact text so existing clients are unaffected; clients localize by `code`.
"""

import uuid
from typing import Any

from httpx import AsyncClient

from tests.conftest import ADMIN_TOKEN
from tests.helpers import bearer, provision_organizer, publish_page, sign_in
from tests.test_ticket_tiers import create_event, tier


async def reserve(client: AsyncClient, event_id: str, tier_id: str, token: str) -> Any:
    return await client.post(
        f"/api/events/{event_id}/tickets/reserve",
        json={"ticket_tier_id": tier_id},
        headers={"Authorization": f"Bearer {token}"},
    )


async def make_tier(client: AsyncClient, organizer: dict[str, str], event_id: str, **overrides: Any) -> str:
    response = await client.post(
        f"/api/events/{event_id}/ticket-tiers", json=tier(**overrides), headers=bearer(organizer)
    )
    assert response.status_code == 201, response.text
    tier_id: str = response.json()["id"]
    return tier_id


async def test_reservation_errors_keep_status_and_detail_and_add_a_code(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    open_tier = await make_tier(client, organizer, event_id, name="Single Seat", quota=1)
    closed_tier = await make_tier(client, organizer, event_id, name="Closed Pass", is_open=False)
    await publish_page(client, organizer, event_id)
    _, first = await sign_in(client, "09121000901")
    _, second = await sign_in(client, "09121000902")

    missing_event = await reserve(client, str(uuid.uuid4()), open_tier, second)
    assert missing_event.status_code == 404
    assert missing_event.json() == {"detail": "Event not found", "code": "EVENT_NOT_FOUND"}

    missing_tier = await reserve(client, event_id, str(uuid.uuid4()), second)
    assert missing_tier.status_code == 404
    assert missing_tier.json() == {"detail": "Ticket tier not found", "code": "TIER_NOT_FOUND"}

    closed = await reserve(client, event_id, closed_tier, second)
    assert closed.status_code == 400
    assert closed.json() == {"detail": "Ticket tier is closed for registration", "code": "TIER_CLOSED"}

    assert (await reserve(client, event_id, open_tier, first)).status_code == 201

    duplicate = await reserve(client, event_id, open_tier, first)
    assert duplicate.status_code == 409
    assert duplicate.json() == {
        "detail": "User already holds a ticket for this event",
        "code": "ALREADY_REGISTERED",
    }

    sold_out = await reserve(client, event_id, open_tier, second)
    assert sold_out.status_code == 410
    assert sold_out.json() == {"detail": "Ticket tier is sold out / quota exhausted", "code": "TIER_SOLD_OUT"}


async def test_unconverted_errors_and_validation_errors_are_unchanged(client: AsyncClient) -> None:
    missing = await client.post(f"/api/organizers/{uuid.uuid4()}/revoke", headers={"X-Admin-Token": ADMIN_TOKEN})
    assert missing.status_code == 404
    assert missing.json() == {"detail": "Organizer not found"}

    _, token = await sign_in(client, "09121000903")
    invalid = await client.post(
        f"/api/events/{uuid.uuid4()}/tickets/reserve",
        json={"ticket_tier_id": "not-a-uuid"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert invalid.status_code == 422
    body = invalid.json()
    assert set(body) == {"detail"}
    assert isinstance(body["detail"], list)


async def test_openapi_describes_the_error_body_with_an_optional_code(client: AsyncClient) -> None:
    schema = (await client.get("/openapi.json")).json()
    error = schema["components"]["schemas"]["ErrorResponse"]
    assert error["required"] == ["detail"]
    assert error["properties"]["detail"]["type"] == "string"
    assert "code" in error["properties"]

    responses = schema["paths"]["/api/events/{event_id}/tickets/reserve"]["post"]["responses"]
    for status_code in ("400", "404", "409", "410"):
        content = responses[status_code]["content"]["application/json"]["schema"]
        assert content == {"$ref": "#/components/schemas/ErrorResponse"}, status_code

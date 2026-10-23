"""Per-IP credential throttles must stop guessing without locking a venue out.

A congress venue puts hundreds of people (scanners, desk, organizer staff) behind one NAT address, so a credential
that verifies is never refused because of its neighbours' failures; only guesses count. Our own signed tokens are
never guesses: an expired one answers TOKEN_EXPIRED and counts nothing. IPv6 clients count per /64.
"""

import time
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import jwt
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.main import create_app
from app.rate_limit import ADMIN_TOKEN_PER_IP, API_KEY_PER_IP
from app.routes.passes import LINK_FAILURES_PER_IP
from tests.conftest import ADMIN_TOKEN, TEST_JWT_SECRET, _truncate_all, make_test_settings
from tests.helpers import bearer, provision_organizer
from tests.test_ticket_tiers import create_event

GUESS = {"Authorization": "Bearer not-a-key"}


def client_at(app: FastAPI, ip: str) -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app, client=(ip, 40000)), base_url="http://test")


def expired(payload: dict[str, Any]) -> dict[str, str]:
    """A bearer header with one of our own tokens (validly signed) that expired a minute ago."""
    now = int(time.time())
    token = jwt.encode({**payload, "iat": now - 3600, "exp": now - 60}, TEST_JWT_SECRET, algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


async def gate(client: AsyncClient, organizer: dict[str, str], event_id: str) -> str:
    point = await client.post(
        f"/api/events/{event_id}/checkin-points", json={"name": "Gate", "policy_type": "MULTI_ENTRY"},
        headers=bearer(organizer),
    )
    assert point.status_code == 201, point.text
    point_id: str = point.json()["id"]
    return point_id


async def spend_api_key_budget(client: AsyncClient) -> None:
    statuses = [(await client.get("/api/events", headers=GUESS)).status_code for _ in range(API_KEY_PER_IP.limit)]
    assert statuses == [401] * API_KEY_PER_IP.limit
    assert (await client.get("/api/events", headers=GUESS)).status_code == 429


async def test_a_valid_api_key_keeps_working_after_its_ip_used_up_the_failure_budget(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Venue NAT Co")
    event_id = await create_event(client, organizer)
    point_id = await gate(client, organizer, event_id)

    await spend_api_key_budget(client)

    assert (await client.get("/api/events", headers=bearer(organizer))).status_code == 200
    assert (await client.get(f"/api/checkin-points/{point_id}/manifest", headers=bearer(organizer))).status_code == 200
    assert (await client.get(f"/api/events/{event_id}/attendees", headers=bearer(organizer))).status_code == 200
    # Guessing stays blocked on every route that accepts an organizer key.
    assert (await client.get(f"/api/checkin-points/{point_id}/manifest", headers=GUESS)).status_code == 429
    assert (await client.get(f"/api/events/{event_id}/attendees", headers=GUESS)).status_code == 429


async def test_expired_sessions_answer_token_expired_and_never_count_as_guesses(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Venue NAT Co")
    event_id = await create_event(client, organizer)
    point_id = await gate(client, organizer, event_id)
    member = expired({"type": "organizer_member", "member_id": str(uuid.uuid4()), "organizer_id": organizer["id"],
                      "session_version": 0})
    scanner = expired({"type": "scanner", "jti": str(uuid.uuid4()), "point_id": point_id, "event_id": event_id})
    desk = expired({"type": "desk_operator", "operator_id": str(uuid.uuid4()), "event_id": event_id,
                    "user_id": str(uuid.uuid4()), "session_version": 0})

    responses = []
    for _ in range(API_KEY_PER_IP.limit // 2 + 1):
        responses += [
            await client.get("/api/events", headers=member),
            await client.get(f"/api/checkin-points/{point_id}/manifest", headers=scanner),
            await client.get(f"/api/events/{event_id}/attendees", headers=desk),
        ]

    assert {(r.status_code, r.json().get("code")) for r in responses} == {(401, "TOKEN_EXPIRED")}
    assert all(r.headers.get("www-authenticate") == "Bearer" for r in responses)
    # None of them counted: a guess is still answered 401, not 429.
    assert (await client.get("/api/events", headers=GUESS)).status_code == 401


async def test_our_own_valid_tokens_on_the_wrong_route_do_not_count_as_guesses(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Venue NAT Co")
    event_id = await create_event(client, organizer)
    now = int(time.time())
    attendee = jwt.encode(
        {"sub": str(uuid.uuid4()), "type": "user", "iat": now, "exp": now + 600}, TEST_JWT_SECRET, algorithm="HS256"
    )
    headers = {"Authorization": f"Bearer {attendee}"}

    statuses = {
        (await client.get(f"/api/events/{event_id}/attendees", headers=headers)).status_code
        for _ in range(API_KEY_PER_IP.limit + 1)
    }

    assert statuses == {401}
    assert (await client.get("/api/events", headers=GUESS)).status_code == 401


@asynccontextmanager
async def venue_app(media_root: Path, networks: str) -> AsyncIterator[tuple[FastAPI, AsyncClient]]:
    await _truncate_all()
    app = create_app(make_test_settings(media_root).model_copy(update={"otp_trusted_networks": networks}))
    async with app.router.lifespan_context(app):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as http:
            yield app, http


async def test_trusted_venue_networks_are_exempt_from_the_api_key_budget(media_root: Path) -> None:
    async with venue_app(media_root, "127.0.0.0/8") as (app, venue):
        statuses = {(await venue.get("/api/events", headers=GUESS)).status_code for _ in range(API_KEY_PER_IP.limit + 5)}
        assert statuses == {401}
        async with client_at(app, "203.0.113.9") as elsewhere:
            await spend_api_key_budget(elsewhere)


async def test_ipv6_clients_share_the_api_key_budget_per_64(app: FastAPI) -> None:
    async with client_at(app, "2001:db8:1:2::1") as first:
        for _ in range(API_KEY_PER_IP.limit):
            await first.get("/api/events", headers=GUESS)
    async with client_at(app, "2001:db8:1:2:abcd::9") as rotated:
        assert (await rotated.get("/api/events", headers=GUESS)).status_code == 429
    async with client_at(app, "2001:db8:1:3::1") as neighbour:
        assert (await neighbour.get("/api/events", headers=GUESS)).status_code == 401


async def test_ipv6_clients_share_the_admin_token_budget_per_64(app: FastAPI) -> None:
    async with client_at(app, "2001:db8:1:2::1") as first:
        for _ in range(ADMIN_TOKEN_PER_IP.limit):
            await first.get("/api/organizers", headers={"X-Admin-Token": "guess"})
    async with client_at(app, "2001:db8:1:2::2") as rotated:
        assert (await rotated.get("/api/organizers", headers={"X-Admin-Token": ADMIN_TOKEN})).status_code == 429


async def test_ipv6_clients_share_the_link_and_booth_qr_budgets_per_64(app: FastAPI) -> None:
    async with client_at(app, "2001:db8:1:2::1") as first:
        for i in range(LINK_FAILURES_PER_IP.limit):
            await first.post("/api/public/passes/resolve", json={"code": f"2345678ab{i % 10}"})
        for i in range(20):
            await first.post("/api/public/booths/resolve", json={"code": f"wrong{i}"})
    async with client_at(app, "2001:db8:1:2::2") as rotated:
        assert (await rotated.post("/api/public/passes/resolve", json={"code": "2345678abc"})).status_code == 429
        assert (await rotated.post("/api/public/booths/resolve", json={"code": "wrong"})).status_code == 429


async def test_a_non_ascii_admin_token_is_refused_and_counted(client: AsyncClient) -> None:
    hostile = {b"X-Admin-Token": "توکن".encode()}

    statuses = [(await client.get("/api/organizers", headers=hostile)).status_code for _ in range(ADMIN_TOKEN_PER_IP.limit)]

    assert statuses == [401] * ADMIN_TOKEN_PER_IP.limit
    assert (await client.get("/api/organizers", headers={"X-Admin-Token": ADMIN_TOKEN})).status_code == 429

"""Organizer key rotation/revocation and throttling of repeated failed authentication."""

from httpx import AsyncClient

from tests.conftest import ADMIN_TOKEN
from tests.helpers import bearer, provision_organizer
from tests.test_ticket_tiers import create_event
from tests.test_tickets import register_user

ADMIN = {"X-Admin-Token": ADMIN_TOKEN}


async def test_rotation_replaces_the_key_immediately_and_shows_the_new_one_once(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)

    rotated = await client.post(f"/api/organizers/{organizer['id']}/rotate-key", headers=ADMIN)

    assert rotated.status_code == 200
    new_key = rotated.json()["api_key"]
    assert new_key != organizer["api_key"] and len(new_key) >= 40
    assert (await client.get("/api/events", headers=bearer(organizer))).status_code == 401
    events = await client.get("/api/events", headers={"Authorization": f"Bearer {new_key}"})
    assert [e["id"] for e in events.json()] == [event_id]
    listed = (await client.get("/api/organizers", headers=ADMIN)).json()
    assert listed[0]["key_rotated_at"] is not None
    assert new_key not in str(listed) and organizer["api_key"] not in str(listed)
    assert set(listed[0]) == {"id", "name", "created_at", "revoked_at", "key_rotated_at"}


async def test_revocation_rejects_the_key_keeps_the_data_and_rotation_reinstates(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    other = await provision_organizer(client, "Other Co")
    event_id = await create_event(client, organizer)

    revoked = await client.post(f"/api/organizers/{organizer['id']}/revoke", headers=ADMIN)

    assert revoked.json()["revoked_at"] is not None
    denied = await client.get(f"/api/events/{event_id}", headers=bearer(organizer))
    unknown = await client.get(f"/api/events/{event_id}", headers={"Authorization": "Bearer not-a-key"})
    assert denied.status_code == unknown.status_code == 401
    assert denied.json() == unknown.json()
    assert (await client.get("/api/events", headers=bearer(other))).status_code == 200
    reinstated = (await client.post(f"/api/organizers/{organizer['id']}/rotate-key", headers=ADMIN)).json()
    again = await client.get(f"/api/events/{event_id}", headers={"Authorization": f"Bearer {reinstated['api_key']}"})
    assert again.status_code == 200
    assert (await client.get(f"/api/events/{event_id}", headers=bearer(organizer))).status_code == 401


async def test_lifecycle_endpoints_require_the_platform_admin_token(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    other = await provision_organizer(client, "Other Co")
    for path in (f"/api/organizers/{organizer['id']}/rotate-key", f"/api/organizers/{organizer['id']}/revoke"):
        assert (await client.post(path)).status_code == 401
        assert (await client.post(path, headers=bearer(other))).status_code == 401
        assert (await client.post(path, headers=bearer(organizer))).status_code == 401
    assert (await client.get("/api/organizers", headers=bearer(organizer))).status_code == 401
    missing = "00000000-0000-0000-0000-000000000000"
    assert (await client.post(f"/api/organizers/{missing}/rotate-key", headers=ADMIN)).status_code == 404
    assert (await client.get("/api/events", headers=bearer(organizer))).status_code == 200


async def test_repeated_failed_logins_lock_the_account_without_affecting_others(client: AsyncClient) -> None:
    await register_user(client, "victim@example.com")
    await register_user(client, "bystander@example.com")
    wrong = {"email": "victim@example.com", "password": "not-the-password"}

    statuses = [(await client.post("/api/auth/login", json=wrong)).status_code for _ in range(10)]
    locked = await client.post("/api/auth/login", json={"email": "victim@example.com", "password": "Password123!"})
    desk_locked = await client.post(
        "/api/events/00000000-0000-0000-0000-000000000000/desk/login",
        json={"email": "victim@example.com", "password": "Password123!"},
    )
    bystander = await client.post("/api/auth/login", json={"email": "bystander@example.com", "password": "Password123!"})

    assert statuses == [401] * 10
    assert locked.status_code == 429 and int(locked.headers["retry-after"]) > 0
    assert desk_locked.status_code in (404, 429)  # unknown event is checked first; never a sign-in
    assert bystander.status_code == 200


async def test_a_successful_login_clears_the_account_failures(client: AsyncClient) -> None:
    await register_user(client, "typo@example.com")
    for _ in range(9):
        await client.post("/api/auth/login", json={"email": "typo@example.com", "password": "wrong-password"})
    ok = await client.post("/api/auth/login", json={"email": "typo@example.com", "password": "Password123!"})
    later = [(await client.post("/api/auth/login", json={"email": "typo@example.com", "password": "wrong-password"})).status_code for _ in range(9)]
    assert ok.status_code == 200
    assert later == [401] * 9


async def test_admin_token_guessing_is_throttled_per_client(client: AsyncClient) -> None:
    for _ in range(10):
        assert (await client.post("/api/organizers", json={"name": "x"}, headers={"X-Admin-Token": "guess"})).status_code == 401
    blocked = await client.post("/api/organizers", json={"name": "x"}, headers=ADMIN)
    assert blocked.status_code == 429

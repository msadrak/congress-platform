"""Attendee sessions end on request: signing out (on every device), account deletion, and legacy tokens."""

import uuid
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy import update

from app import security
from app.models import User
from tests.conftest import TEST_JWT_SECRET
from tests.helpers import bearer, sign_in
from tests.test_participants import congress, register


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def legacy_token(user_id: str, *, issued: datetime, typed: bool = True) -> str:
    """A user token as the API issued it before session versions (no `sv`)."""
    payload: dict[str, object] = {
        "sub": user_id, "iat": int(issued.timestamp()), "exp": int((issued + timedelta(days=7)).timestamp()),
    }
    if typed:
        payload["type"] = "user"
    return jwt.encode(payload, TEST_JWT_SECRET, algorithm="HS256")


async def test_new_tokens_carry_the_session_version(client: AsyncClient) -> None:
    _, token = await sign_in(client, "09124440001", "Versioned")

    payload = jwt.decode(token, TEST_JWT_SECRET, algorithms=["HS256"])

    assert payload["type"] == "user" and payload["sv"] == 0


async def test_signing_out_ends_every_session_of_the_account(client: AsyncClient) -> None:
    user, phone = await sign_in(client, "09124440002", "Two Devices")
    _, laptop = await sign_in(client, "09124440002")
    _, other_person = await sign_in(client, "09124440003", "Someone Else")
    assert (await client.get("/api/auth/me", headers=auth(phone))).status_code == 200

    out = await client.post("/api/auth/logout", headers=auth(laptop))

    assert out.status_code == 204
    for token in (phone, laptop):
        refused = await client.get("/api/auth/me", headers=auth(token))
        assert refused.status_code == 401
        assert refused.headers["www-authenticate"] == "Bearer"
    assert (await client.post("/api/auth/logout", headers=auth(laptop))).status_code == 401
    assert (await client.get("/api/auth/me", headers=auth(other_person))).status_code == 200
    # Signing in again starts a fresh session with the new version.
    again_user, again = await sign_in(client, "09124440002")
    assert again_user["id"] == user["id"]
    assert jwt.decode(again, TEST_JWT_SECRET, algorithms=["HS256"])["sv"] == 1
    assert (await client.get("/api/auth/me", headers=auth(again))).status_code == 200
    assert (await client.post("/api/auth/logout")).status_code == 401


async def test_a_token_with_a_wrong_or_malformed_version_is_refused(client: AsyncClient) -> None:
    user, token = await sign_in(client, "09124440004", "Tampered")
    payload = jwt.decode(token, TEST_JWT_SECRET, algorithms=["HS256"])

    for bad in (1, -1, "0", None, True, 0.0):
        forged = jwt.encode({**payload, "sv": bad}, TEST_JWT_SECRET, algorithm="HS256")
        assert (await client.get("/api/auth/me", headers=auth(forged))).status_code == 401, bad
    assert (await client.get("/api/auth/me", headers=auth(token))).status_code == 200


async def test_tokens_from_before_session_versions_work_until_the_account_signs_out(
    app: FastAPI, client: AsyncClient
) -> None:
    user, _ = await sign_in(client, "09124440005", "Legacy Session")
    before = datetime.now(timezone.utc) - timedelta(hours=1)
    assert int(before.timestamp()) < security.LEGACY_UNVERSIONED_USER_TOKENS_UNTIL
    old = legacy_token(user["id"], issued=before)
    after_cutoff = legacy_token(
        user["id"], issued=datetime.fromtimestamp(security.LEGACY_UNVERSIONED_USER_TOKENS_UNTIL + 60, timezone.utc)
    )

    assert (await client.get("/api/auth/me", headers=auth(old))).status_code == 200
    assert (await client.get("/api/auth/me", headers=auth(after_cutoff))).status_code == 401

    assert (await client.post("/api/auth/logout", headers=auth(old))).status_code == 204
    assert (await client.get("/api/auth/me", headers=auth(old))).status_code == 401
    async with app.state.sessionmaker() as session:
        await session.execute(update(User).where(User.id == uuid.UUID(user["id"])).values(session_version=0))
        await session.commit()
    # Only an account that never signed out honours them: version 0 is the version they were issued under.
    assert (await client.get("/api/auth/me", headers=auth(old))).status_code == 200


async def test_deleting_the_account_ends_its_sessions(app: FastAPI, client: AsyncClient) -> None:
    user, token = await sign_in(client, "09124440006", "Leaving")
    _, second = await sign_in(client, "09124440006")

    assert (await client.delete("/api/auth/me", headers=auth(token))).status_code == 204

    assert (await client.get("/api/auth/me", headers=auth(second))).status_code == 401
    async with app.state.sessionmaker() as session:
        row = await session.get(User, uuid.UUID(user["id"]))
    assert row is not None and row.session_version == 1


async def test_public_pages_ignore_a_signed_out_token(client: AsyncClient) -> None:
    organizer, event_id, tier_id = await congress(client)
    token, _ = await register(client, event_id, tier_id, "09124440007", "Bookmarker")
    slug = (await client.get(f"/api/events/{event_id}", headers=bearer(organizer))).json()["slug"]
    booth = (
        await client.post(f"/api/events/{event_id}/booths", json={"name": "B", "slug": "b"}, headers=bearer(organizer))
    ).json()
    saved = await client.post(f"/api/attendees/me/bookmarks/booths/{booth['id']}", headers=auth(token))
    assert saved.status_code == 201, saved.text
    url = f"/api/public/events/{slug}/booths/{booth['id']}"
    assert (await client.get(url, headers=auth(token))).json()["is_bookmarked"] is True

    await client.post("/api/auth/logout", headers=auth(token))

    assert (await client.get(url, headers=auth(token))).json()["is_bookmarked"] is False

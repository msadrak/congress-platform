"""SMS short links (ADR 0015): one tap from the confirmation SMS opens the attendee's pass, read-only."""

import os
import re
import subprocess
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import asyncpg
import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError
from sqlalchemy import select, update
from sqlalchemy.engine import make_url

from app.config import Settings
from app.links import CODE_ALPHABET, CODE_LENGTH, LINK_LIFETIME_AFTER_EVENT, revoke_ticket_links
from app.main import create_app
from app.models import ShortLink, SmsMessage, Ticket
from app.routes.passes import LINK_FAILURES_PER_IP
from app.sms.outbox import deliver_due
from tests.conftest import ADMIN_DSN, BACKEND_DIR, TEST_URL, _truncate_all, disposable_target_problem, make_test_settings
from tests.helpers import bearer, provision_organizer, sign_in
from tests.test_events import EVENT
from tests.test_ticket_tiers import create_event, tier

MOBILE = "09121112255"
RESOLVE = "/api/public/passes/resolve"
LINK = re.compile(rf"http://test/t/([{CODE_ALPHABET}]{{{CODE_LENGTH}}})")


async def setup(client: AsyncClient) -> tuple[dict[str, str], str, str]:
    organizer = await provision_organizer(client, "Short Link Congress Co")
    event_id = await create_event(client, organizer)
    tier_id = (
        await client.post(f"/api/events/{event_id}/ticket-tiers", json=tier(name="Delegate"), headers=bearer(organizer))
    ).json()["id"]
    return organizer, event_id, tier_id


async def reserve(client: AsyncClient, event_id: str, tier_id: str, mobile: str = MOBILE) -> dict[str, Any]:
    _, token = await sign_in(client, mobile, "Dr. Neda Karimi", organization="Heart Center", title="Cardiologist")
    response = await client.post(
        f"/api/events/{event_id}/tickets/reserve", json={"ticket_tier_id": tier_id},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


async def links_of(app: FastAPI, ticket_id: str) -> list[ShortLink]:
    async with app.state.sessionmaker() as session:
        rows = await session.scalars(
            select(ShortLink).where(ShortLink.ticket_id == uuid.UUID(ticket_id)).order_by(ShortLink.created_at)
        )
        return list(rows)


async def confirmation_body(app: FastAPI, ticket_id: str) -> str:
    async with app.state.sessionmaker() as session:
        body: str | None = await session.scalar(
            select(SmsMessage.body).where(
                SmsMessage.kind == "ticket_confirmation", SmsMessage.ticket_id == uuid.UUID(ticket_id)
            )
        )
    assert body is not None
    return body


async def reserved_link(app: FastAPI, client: AsyncClient) -> tuple[dict[str, str], str, dict[str, Any], str]:
    """A reservation and the code its confirmation SMS carries: (organizer, event id, ticket, code)."""
    organizer, event_id, tier_id = await setup(client)
    ticket = await reserve(client, event_id, tier_id)
    match = LINK.search(await confirmation_body(app, ticket["id"]))
    assert match, "the confirmation carries no short link"
    return organizer, event_id, ticket, match.group(1)


async def set_link(app: FastAPI, code: str, **values: Any) -> None:
    async with app.state.sessionmaker() as session:
        await session.execute(update(ShortLink).where(ShortLink.code == code).values(**values))
        await session.commit()


# --- Minting ----------------------------------------------------------------------------------------------


async def test_a_reservation_mints_one_link_and_the_sms_carries_it(app: FastAPI, client: AsyncClient) -> None:
    _, event_id, ticket, code = await reserved_link(app, client)

    (link,) = await links_of(app, ticket["id"])
    assert link.code == code and len(code) == CODE_LENGTH and set(code) <= set(CODE_ALPHABET)
    assert str(link.event_id) == event_id
    assert link.revoked_at is None and link.open_count == 0 and link.first_opened_at is None
    ends_at = datetime.fromisoformat(EVENT["ends_at"].replace("Z", "+00:00"))
    assert link.expires_at == ends_at + LINK_LIFETIME_AFTER_EVENT == ends_at + timedelta(days=30)

    body = await confirmation_body(app, ticket["id"])
    assert body == (
        f"Dr. Neda Karimi عزیز، ثبت‌نام شما در «{EVENT['name']}» تأیید شد.\n"
        f"کارت ورود: http://test/t/{code}"
    )
    # The long congress path (and a second sign-in code) are gone from the message.
    assert "/c/" not in body and "my-ticket" not in body
    assert len(f"http://test/t/{code}") == 24


async def test_every_ticket_gets_its_own_code(app: FastAPI, client: AsyncClient) -> None:
    _, event_id, tier_id = await setup(client)
    first = await reserve(client, event_id, tier_id, mobile="09121110001")
    second = await reserve(client, event_id, tier_id, mobile="09121110002")

    (a,), (b,) = await links_of(app, first["id"]), await links_of(app, second["id"])
    assert a.code != b.code


async def test_a_desk_walk_in_mints_a_link_with_or_without_a_number(app: FastAPI, client: AsyncClient) -> None:
    organizer, event_id, tier_id = await setup(client)
    url = f"/api/events/{event_id}/desk-registrations"
    with_number = await client.post(
        url, json={"full_name": "Has Number", "mobile": "09351234567", "ticket_tier_id": tier_id}, headers=bearer(organizer)
    )
    without = await client.post(url, json={"full_name": "No Number", "ticket_tier_id": tier_id}, headers=bearer(organizer))
    assert with_number.status_code == without.status_code == 201

    (link,) = await links_of(app, with_number.json()["ticket_id"])
    assert f"/t/{link.code}" in await confirmation_body(app, with_number.json()["ticket_id"])
    assert len(await links_of(app, without.json()["ticket_id"])) == 1


async def test_the_short_link_origin_setting_is_used_in_the_sms(media_root: Path) -> None:
    await _truncate_all()
    settings = make_test_settings(media_root).model_copy(
        update={"short_link_origin": "https://cngr.example", "public_origin": "https://congress.example.org"}
    )
    application = create_app(settings)
    async with application.router.lifespan_context(application):
        async with AsyncClient(transport=ASGITransport(app=application), base_url="http://test") as http:
            _, event_id, tier_id = await setup(http)
            ticket = await reserve(http, event_id, tier_id)
            (link,) = await links_of(application, ticket["id"])
            assert (await confirmation_body(application, ticket["id"])).endswith(f"کارت ورود: https://cngr.example/t/{link.code}")


def strict(environment: str, **overrides: object) -> Settings:
    values: dict[str, object] = {
        "environment": environment, "database_url": "postgresql+asyncpg://congress:s3cret@db:5432/congress",
        "platform_admin_token": "q8F3vKz1Lr9XwT2bN5mY7pC0dH4jS6aG", "jwt_secret": "9b1f0e8c7d6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c",
        "media_root": Path("/srv/congress/media").resolve(), "public_origin": "https://congress.example.org",
        "smsir_api_key": "Zx9Lr2Kq7Wm4Pv1Tn8Hb3Gd6Fs5Ja0Ce", "smsir_line_number": 30001234, **overrides,
    }
    return Settings(**values)  # type: ignore[arg-type]


@pytest.mark.parametrize("environment", ["staging", "production"])
def test_a_deployed_short_link_origin_must_be_an_https_origin(environment: str) -> None:
    assert strict(environment).short_link_origin is None
    assert strict(environment, short_link_origin="").short_link_origin is None
    assert strict(environment, short_link_origin="https://cngr.example/").short_link_origin == "https://cngr.example"
    for bad in ("http://cngr.example", "https://cngr.example/t", "cngr.example", "https://", "https://a.example?x=1"):
        with pytest.raises(ValidationError) as exc:
            strict(environment, short_link_origin=bad)
        assert "CONGRESS_SHORT_LINK_ORIGIN" in str(exc.value) or "short_link_origin" in str(exc.value)


def test_local_development_may_use_a_plain_http_short_link_origin() -> None:
    assert strict("development", short_link_origin="http://localhost:5173").short_link_origin == "http://localhost:5173"


# --- Resolving --------------------------------------------------------------------------------------------


async def test_the_link_opens_the_pass_read_only_without_signing_in(app: FastAPI, client: AsyncClient) -> None:
    _, event_id, ticket, code = await reserved_link(app, client)

    resolved = await client.post(RESOLVE, json={"code": code})

    assert resolved.status_code == 200, resolved.text
    assert resolved.headers["cache-control"] == "no-store"
    body = resolved.json()
    (link,) = await links_of(app, ticket["id"])
    assert body == {
        "ticket_id": ticket["id"],
        "status": "active",
        "issued_at": body["issued_at"],
        "qr_secret": ticket["qr_secret"],
        "tier_name": "Delegate",
        "expires_at": body["expires_at"],
        "event": {
            "id": event_id, "slug": EVENT["slug"], "name": EVENT["name"], "starts_at": body["event"]["starts_at"],
            "ends_at": body["event"]["ends_at"], "location": EVENT["location"],
        },
        "attendee": {"full_name": "Dr. Neda Karimi", "organization": "Heart Center", "title": "Cardiologist"},
    }
    assert datetime.fromisoformat(body["expires_at"]) == link.expires_at
    assert datetime.fromisoformat(body["issued_at"]) == datetime.fromisoformat(ticket["created_at"])
    assert datetime.fromisoformat(body["event"]["ends_at"]) == datetime.fromisoformat(EVENT["ends_at"])
    # Never the attendee's mobile number: a forwarded SMS must not disclose it.
    assert MOBILE not in resolved.text
    # Case and surrounding spaces from a hand-typed code are forgiven.
    assert (await client.post(RESOLVE, json={"code": f" {code.upper()} "})).status_code == 200


async def test_opens_are_counted(app: FastAPI, client: AsyncClient) -> None:
    _, _, ticket, code = await reserved_link(app, client)

    assert (await client.post(RESOLVE, json={"code": code})).status_code == 200
    (first,) = await links_of(app, ticket["id"])
    assert first.open_count == 1 and first.first_opened_at is not None
    assert first.last_opened_at == first.first_opened_at

    assert (await client.post(RESOLVE, json={"code": code})).status_code == 200
    (again,) = await links_of(app, ticket["id"])
    assert again.open_count == 2
    assert again.first_opened_at == first.first_opened_at
    assert again.last_opened_at is not None and first.last_opened_at is not None
    assert again.last_opened_at >= first.last_opened_at


async def test_an_unknown_code_is_not_found(client: AsyncClient) -> None:
    for code in ("2345678abc", "x", "../../etc", ""):
        response = await client.post(RESOLVE, json={"code": code})
        assert response.status_code == 404, code
        assert response.json() == {"detail": "This link is not valid.", "code": "LINK_NOT_FOUND", "event_slug": None}
        assert response.headers["cache-control"] == "no-store"


async def test_a_revoked_link_is_gone(app: FastAPI, client: AsyncClient) -> None:
    _, _, ticket, code = await reserved_link(app, client)
    async with app.state.sessionmaker() as session:
        assert await revoke_ticket_links(session, uuid.UUID(ticket["id"])) == 1
        assert await revoke_ticket_links(session, uuid.UUID(ticket["id"])) == 0  # already revoked
        await session.commit()

    response = await client.post(RESOLVE, json={"code": code})

    assert response.status_code == 410
    assert response.json() == {"detail": "This link is no longer valid.", "code": "LINK_REVOKED", "event_slug": EVENT["slug"]}
    (link,) = await links_of(app, ticket["id"])
    assert link.revoked_at is not None and link.open_count == 0


async def test_an_expired_link_is_gone(app: FastAPI, client: AsyncClient) -> None:
    _, _, ticket, code = await reserved_link(app, client)
    await set_link(app, code, expires_at=datetime.now(timezone.utc) - timedelta(seconds=1))

    response = await client.post(RESOLVE, json={"code": code})

    assert response.status_code == 410
    assert response.json() == {"detail": "This link has expired.", "code": "LINK_EXPIRED", "event_slug": EVENT["slug"]}


async def test_a_link_to_an_inactive_ticket_is_gone(app: FastAPI, client: AsyncClient) -> None:
    _, _, ticket, code = await reserved_link(app, client)
    async with app.state.sessionmaker() as session:
        await session.execute(update(Ticket).where(Ticket.id == uuid.UUID(ticket["id"])).values(status="cancelled"))
        await session.commit()

    response = await client.post(RESOLVE, json={"code": code})

    assert response.status_code == 410
    assert response.json() == {"detail": "This pass is no longer active.", "code": "TICKET_INACTIVE", "event_slug": EVENT["slug"]}


async def test_guessing_is_throttled_per_ip_while_real_opens_are_not(app: FastAPI, client: AsyncClient) -> None:
    _, _, _, code = await reserved_link(app, client)

    # Opening a real link many times (an attendee at the gate, a venue behind one IP) is not a failure.
    for _ in range(LINK_FAILURES_PER_IP.limit + 5):
        assert (await client.post(RESOLVE, json={"code": code})).status_code == 200

    for _ in range(LINK_FAILURES_PER_IP.limit):
        assert (await client.post(RESOLVE, json={"code": "2345678abc"})).status_code == 404
    blocked = await client.post(RESOLVE, json={"code": "2345678abc"})
    assert blocked.status_code == 429 and int(blocked.headers["Retry-After"]) > 0
    # Once the failure budget is spent, this address cannot use a valid code either (no guess-and-check).
    assert (await client.post(RESOLVE, json={"code": code})).status_code == 429


# --- Desk resend and the organizer's SMS log ------------------------------------------------------------------


async def test_a_resend_reuses_the_active_code(app: FastAPI, client: AsyncClient) -> None:
    organizer, event_id, ticket, code = await reserved_link(app, client)

    resent = await client.post(f"/api/events/{event_id}/attendees/{ticket['id']}/resend-sms", headers=bearer(organizer))

    assert resent.status_code == 200, resent.text
    async with app.state.sessionmaker() as session:
        body = await session.scalar(select(SmsMessage.body).where(SmsMessage.kind == "ticket_resend"))
    assert body is not None and body.endswith(f"http://test/t/{code}")
    assert [link.code for link in await links_of(app, ticket["id"])] == [code]


async def test_a_resend_mints_a_fresh_code_when_the_old_one_was_revoked(app: FastAPI, client: AsyncClient) -> None:
    organizer, event_id, ticket, code = await reserved_link(app, client)
    async with app.state.sessionmaker() as session:
        await revoke_ticket_links(session, uuid.UUID(ticket["id"]))
        await session.commit()

    resent = await client.post(f"/api/events/{event_id}/attendees/{ticket['id']}/resend-sms", headers=bearer(organizer))

    assert resent.status_code == 200, resent.text
    old, new = await links_of(app, ticket["id"])
    assert old.code == code and new.code != code and new.revoked_at is None
    async with app.state.sessionmaker() as session:
        body = await session.scalar(select(SmsMessage.body).where(SmsMessage.kind == "ticket_resend"))
    assert body is not None and body.endswith(f"/t/{new.code}")
    assert (await client.post(RESOLVE, json={"code": new.code})).status_code == 200


async def test_the_sms_log_shows_when_the_link_was_first_opened(app: FastAPI, client: AsyncClient) -> None:
    organizer, event_id, ticket, code = await reserved_link(app, client)
    await deliver_due(app.state.sessionmaker, app.state.sms)
    log_url = f"/api/events/{event_id}/sms/messages"

    (before,) = (await client.get(log_url, headers=bearer(organizer))).json()
    assert before["kind"] == "ticket_confirmation" and before["link_opened_at"] is None

    assert (await client.post(RESOLVE, json={"code": code})).status_code == 200
    assert (await client.post(RESOLVE, json={"code": code})).status_code == 200

    (after,) = (await client.get(log_url, headers=bearer(organizer))).json()
    (link,) = await links_of(app, ticket["id"])
    assert after["link_opened_at"] is not None
    assert datetime.fromisoformat(after["link_opened_at"]) == link.first_opened_at


async def test_previews_and_test_sends_show_a_sample_short_link(app: FastAPI, client: AsyncClient) -> None:
    organizer, event_id, _ = await setup(client)
    panel = (await client.get(f"/api/events/{event_id}/sms", headers=bearer(organizer))).json()
    assert re.fullmatch(r"http://test/t/[a-z0-9]{10}", panel["sample"]["link"])
    # The sample can never be a real code: it uses a letter outside the code alphabet.
    assert not set(panel["sample"]["link"].rsplit("/", 1)[1]) <= set(CODE_ALPHABET)


# --- Migration -------------------------------------------------------------------------------------------


def alembic(*args: str) -> None:
    result = subprocess.run(
        [sys.executable, "-m", "alembic", *args], cwd=BACKEND_DIR,
        env={**os.environ, "CONGRESS_DATABASE_URL": TEST_URL}, capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr


async def test_the_migration_backfills_a_link_for_every_existing_ticket() -> None:
    assert disposable_target_problem(make_url(TEST_URL), make_url(ADMIN_DSN)) is None
    await _truncate_all()
    alembic("downgrade", "0018")
    try:
        conn = await asyncpg.connect(TEST_URL.replace("+asyncpg", ""))
        try:
            organizer_id, event_id, tier_id = (uuid.uuid4() for _ in range(3))
            ends_at = datetime(2027, 4, 12, 18, 0, tzinfo=timezone.utc)
            await conn.execute(
                "INSERT INTO organizers(id,name,api_key_hash) VALUES($1,'Migration','synthetic-key-hash')", organizer_id
            )
            await conn.execute(
                "INSERT INTO events(id,organizer_id,name,slug,starts_at,ends_at,location,description) "
                "VALUES($1,$2,'Migration',$3,$4,$5,'Fixture','')",
                event_id, organizer_id, f"migration-{uuid.uuid4().hex}", ends_at - timedelta(days=2), ends_at,
            )
            await conn.execute(
                "INSERT INTO ticket_tiers(id,event_id,name,description,quota,is_open,reserved_count) "
                "VALUES($1,$2,'Fixture','',10,true,3)", tier_id, event_id,
            )
            tickets = []
            for i, status in enumerate(("active", "active", "cancelled")):
                user_id, ticket_id = uuid.uuid4(), uuid.uuid4()
                await conn.execute(
                    "INSERT INTO users(id,mobile,full_name,organization,title) VALUES($1,$2,'Historic','','')",
                    user_id, f"0912000000{i}",
                )
                await conn.execute(
                    "INSERT INTO tickets(id,event_id,ticket_tier_id,user_id,status) VALUES($1,$2,$3,$4,$5)",
                    ticket_id, event_id, tier_id, user_id, status,
                )
                tickets.append(ticket_id)
        finally:
            await conn.close()

        alembic("upgrade", "0019")

        conn = await asyncpg.connect(TEST_URL.replace("+asyncpg", ""))
        try:
            rows = await conn.fetch("SELECT * FROM short_links")
            assert sorted(row["ticket_id"] for row in rows) == sorted(tickets)
            assert len({row["code"] for row in rows}) == 3
            for row in rows:
                assert re.fullmatch(rf"[{CODE_ALPHABET}]{{{CODE_LENGTH}}}", row["code"])
                assert row["event_id"] == event_id
                assert row["expires_at"] == ends_at + timedelta(days=30)
                assert (row["revoked_at"], row["first_opened_at"], row["last_opened_at"], row["open_count"]) == (
                    None, None, None, 0,
                )
            # Deleting a ticket removes its links.
            await conn.execute("DELETE FROM tickets WHERE id=$1", tickets[2])
            assert await conn.fetchval("SELECT count(*) FROM short_links") == 2
        finally:
            await conn.close()

        alembic("downgrade", "0018")
        conn = await asyncpg.connect(TEST_URL.replace("+asyncpg", ""))
        try:
            assert await conn.fetchval("SELECT to_regclass('short_links')") is None
        finally:
            await conn.close()
    finally:
        await _truncate_all()
        alembic("upgrade", "head")

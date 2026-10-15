"""Sign-in by SMS code: single use, short-lived, limited guesses, no account enumeration, send limits."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, update

from app.main import create_app
from app.models import OtpChallenge, SmsMessage
from app.security import create_signup_token
from app.sms.provider import RecordingProvider, SmsResult
from tests.conftest import TEST_JWT_SECRET, _truncate_all, make_test_settings
from tests.helpers import bearer, provision_organizer, request_code, sign_in, sms_code
from tests.test_ticket_tiers import create_event

MOBILE = "09121112233"


def recorder(app: FastAPI) -> RecordingProvider:
    provider = app.state.sms
    assert isinstance(provider, RecordingProvider)
    return provider


async def verify(client: AsyncClient, code: str, mobile: str = MOBILE) -> Any:
    return await client.post("/api/auth/otp/verify", json={"mobile": mobile, "code": code})


@asynccontextmanager
async def strict_app(media_root: Path, **overrides: Any) -> AsyncIterator[tuple[FastAPI, AsyncClient]]:
    """An app with the production send limits (the shared fixture relaxes them)."""
    await _truncate_all()
    settings = make_test_settings(media_root).model_copy(
        update={
            "otp_resend_cooldown_seconds": 60,
            "otp_sends_per_mobile_per_hour": 5,
            "otp_sends_per_ip_per_hour": 100,
            **overrides,
        }
    )
    app = create_app(settings)
    async with app.router.lifespan_context(app):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as http:
            yield app, http


async def test_request_sends_a_six_digit_code_and_logs_the_sms_without_it(app: FastAPI, client: AsyncClient) -> None:
    response = await client.post("/api/auth/otp/request", json={"mobile": "+98 912 111 2233"})

    assert response.status_code == 202
    assert response.json() == {"mobile": MOBILE, "code_length": 6, "expires_in": 120, "resend_after": 0}
    (sent,) = recorder(app).sent_to(MOBILE)
    assert sent.params["CODE"].isdigit() and len(sent.params["CODE"]) == 6
    async with app.state.sessionmaker() as session:
        (log,) = (await session.scalars(select(SmsMessage))).all()
        challenge = await session.scalar(select(OtpChallenge))
    assert (log.kind, log.mobile, log.status, log.params) == ("otp", MOBILE, "sent", None)
    assert challenge is not None and sent.params["CODE"] not in challenge.code_hash


async def test_known_and_unknown_numbers_get_the_same_answer(client: AsyncClient) -> None:
    await sign_in(client, MOBILE)
    known = await client.post("/api/auth/otp/request", json={"mobile": MOBILE})
    unknown = await client.post("/api/auth/otp/request", json={"mobile": "09351234567"})
    assert (known.status_code, unknown.status_code) == (202, 202)
    assert {**known.json(), "mobile": None} == {**unknown.json(), "mobile": None}


async def test_invalid_numbers_are_refused_before_anything_is_sent(app: FastAPI, client: AsyncClient) -> None:
    for mobile in ("02112345678", "0912123", "not-a-number"):
        response = await client.post("/api/auth/otp/request", json={"mobile": mobile})
        assert response.status_code == 422
    assert not recorder(app).messages


async def test_a_code_works_once(client: AsyncClient) -> None:
    code = await request_code(client, MOBILE)
    assert (await verify(client, code)).status_code == 200
    assert (await verify(client, code)).status_code == 401


async def test_a_new_code_supersedes_the_previous_one(client: AsyncClient) -> None:
    first = await request_code(client, MOBILE)
    second = await request_code(client, MOBILE)
    if first != second:
        assert (await verify(client, first)).status_code == 401
    assert (await verify(client, second)).status_code == 200


async def test_codes_typed_with_persian_digits_are_accepted(client: AsyncClient) -> None:
    code = await request_code(client, MOBILE)
    persian = code.translate(str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹"))
    assert (await verify(client, persian)).status_code == 200


async def test_an_expired_code_is_refused(app: FastAPI, client: AsyncClient) -> None:
    code = await request_code(client, MOBILE)
    async with app.state.sessionmaker() as session:
        await session.execute(
            update(OtpChallenge).values(expires_at=datetime.now(timezone.utc) - timedelta(seconds=1))
        )
        await session.commit()
    assert (await verify(client, code)).status_code == 401


async def test_five_wrong_guesses_burn_the_code(client: AsyncClient) -> None:
    code = await request_code(client, MOBILE)
    wrong = "000000" if code != "000000" else "111111"
    for _ in range(5):
        assert (await verify(client, wrong)).status_code == 401
    assert (await verify(client, code)).status_code == 401


async def test_new_numbers_complete_a_profile_and_the_signup_token_is_not_a_session(client: AsyncClient) -> None:
    code = await request_code(client, MOBILE)
    verified = (await verify(client, code)).json()
    assert verified["status"] == "profile_required" and verified["user"] is None
    signup_token = verified["signup_token"]

    assert (await client.get("/api/auth/me", headers={"Authorization": f"Bearer {signup_token}"})).status_code == 401
    forged = create_signup_token(MOBILE, "another-secret-that-is-at-least-32-chars")
    refused = await client.post("/api/auth/otp/complete", json={"signup_token": forged, "full_name": "Mallory"})
    assert refused.status_code == 401
    blank = await client.post("/api/auth/otp/complete", json={"signup_token": signup_token, "full_name": "  "})
    assert blank.status_code == 422

    created = await client.post(
        "/api/auth/otp/complete", json={"signup_token": signup_token, "full_name": "Dr. Neda Karimi"}
    )
    assert created.status_code == 201
    assert created.json()["user"]["mobile"] == MOBILE


async def test_completing_twice_signs_in_the_same_account(client: AsyncClient) -> None:
    signup_token = create_signup_token(MOBILE, TEST_JWT_SECRET)
    first = await client.post("/api/auth/otp/complete", json={"signup_token": signup_token, "full_name": "First"})
    second = await client.post("/api/auth/otp/complete", json={"signup_token": signup_token, "full_name": "Second"})
    assert (first.status_code, second.status_code) == (201, 201)
    assert first.json()["user"] == second.json()["user"]
    assert second.json()["user"]["full_name"] == "First"


async def test_desk_codes_are_only_sent_to_active_operators(app: FastAPI, client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Desk SMS Co")
    event_id = await create_event(client, organizer)
    await client.post(
        f"/api/events/{event_id}/desk/operators",
        json={"operator_name": "Reception", "mobile": MOBILE},
        headers=bearer(organizer),
    )
    stranger = await client.post("/api/auth/otp/request", json={"mobile": "09351234567", "purpose": "desk"})
    operator = await client.post("/api/auth/otp/request", json={"mobile": MOBILE, "purpose": "desk"})

    assert stranger.status_code == operator.status_code == 202
    assert recorder(app).sent_to("09351234567") == []
    code = await sms_code(client, MOBILE)
    login = await client.post(f"/api/events/{event_id}/desk/login", json={"mobile": MOBILE, "code": code})
    assert login.status_code == 200
    # A desk code is not an attendee sign-in code.
    assert (await verify(client, code)).status_code == 401


async def test_provider_refusal_is_reported_and_does_not_block_a_retry(media_root: Path) -> None:
    async with strict_app(media_root) as (app, client):
        recorder(app).queued_results.append(SmsResult(ok=False, error="HTTP_500", retryable=True))
        failed = await client.post("/api/auth/otp/request", json={"mobile": MOBILE})
        retried = await client.post("/api/auth/otp/request", json={"mobile": MOBILE})

        assert failed.status_code == 503
        assert retried.status_code == 202
        async with app.state.sessionmaker() as session:
            statuses = sorted((await session.scalars(select(SmsMessage.status))).all())
        assert statuses == ["failed", "sent"]


async def test_a_timed_out_send_is_treated_as_sent(media_root: Path) -> None:
    async with strict_app(media_root) as (app, client):
        recorder(app).queued_results.append(SmsResult(ok=False, error="TIMEOUT", unknown=True))
        response = await client.post("/api/auth/otp/request", json={"mobile": MOBILE})
        assert response.status_code == 202


async def test_production_send_limits(media_root: Path) -> None:
    async with strict_app(media_root) as (_, client):
        first = await client.post("/api/auth/otp/request", json={"mobile": MOBILE})
        too_soon = await client.post("/api/auth/otp/request", json={"mobile": MOBILE})
        other_number = await client.post("/api/auth/otp/request", json={"mobile": "09351234567"})
        assert first.json()["resend_after"] == 60
        assert too_soon.status_code == 429 and 0 < int(too_soon.headers["retry-after"]) <= 60
        assert other_number.status_code == 202

    async with strict_app(media_root, otp_resend_cooldown_seconds=0, otp_sends_per_mobile_per_hour=2) as (_, client):
        statuses = [
            (await client.post("/api/auth/otp/request", json={"mobile": MOBILE})).status_code for _ in range(3)
        ]
        assert statuses == [202, 202, 429]

    async with strict_app(media_root, otp_resend_cooldown_seconds=0, otp_sends_per_ip_per_hour=2) as (_, client):
        statuses = [
            (await client.post("/api/auth/otp/request", json={"mobile": f"0935000000{i}"})).status_code
            for i in range(3)
        ]
        assert statuses == [202, 202, 429]

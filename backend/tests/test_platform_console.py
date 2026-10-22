"""Platform console: SMS gateway and sign-in rules edited at run time, credentials write-only and encrypted."""

import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.main import create_app
from app.models import PlatformSetting, SmsMessage
from app.platform_config import SMS_API_KEY, reload_platform
from app.secret_box import open_sealed, seal
from app.sms.gateway import SmsGateway
from app.sms.outbox import deliver_due
from tests.conftest import ADMIN_TOKEN, TEST_JWT_SECRET, _truncate_all, make_test_settings
from tests.helpers import bearer, provision_organizer, sign_in
from tests.test_ticket_tiers import create_event, tier

ADMIN = {"X-Admin-Token": ADMIN_TOKEN}
MOBILE = "09121112233"
KEY = "sk_live_abcdefghijklmnop1234"


def gateway(app: FastAPI) -> SmsGateway:
    sms: SmsGateway = app.state.sms
    return sms


def smsir_mock(seen: list[httpx.Request]) -> httpx.MockTransport:
    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.path == "/v1/credit":
            return httpx.Response(200, json={"status": 1, "data": 125000.5})
        if request.url.path == "/v1/line":
            return httpx.Response(200, json={"status": 1, "data": [30001234, 50002222]})
        return httpx.Response(200, json={"status": 1, "data": {"packId": "p", "messageIds": [777], "cost": 1}})

    return httpx.MockTransport(handle)


async def test_the_console_needs_the_platform_admin_token(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Not an admin")
    # Kept under the 10-failure budget of admin-token guessing.
    for path in ("/api/platform/status", "/api/platform/sms", "/api/platform/sign-in", "/api/platform/sms-templates"):
        assert (await client.get(path)).status_code == 401, path
    for headers in ({"X-Admin-Token": "guess"}, bearer(organizer)):
        assert (await client.get("/api/platform/status", headers=headers)).status_code == 401


async def test_status_starts_from_the_environment(client: AsyncClient) -> None:
    status = await client.get("/api/platform/status", headers=ADMIN)
    assert status.status_code == 200
    body = status.json()
    assert body["environment"] == "test"
    assert body["sms"] == {
        "mode": "console", "mode_source": "environment", "effective": "console",
        "api_key_set": False, "api_key_hint": None, "api_key_source": None, "api_key_unreadable": False,
        "line_number": None, "line_number_source": None, "console_allowed": True,
    }
    assert body["sign_in"]["otp_length"] == 6
    assert set(body["sign_in"]["sources"].values()) == {"environment"}


async def test_live_sms_settings_apply_without_a_restart_and_the_key_is_never_shown(app: FastAPI, client: AsyncClient) -> None:
    seen: list[httpx.Request] = []
    gateway(app).transport = smsir_mock(seen)

    saved = await client.put(
        "/api/platform/sms", json={"mode": "smsir", "api_key": f"  {KEY} ", "line_number": 30001234}, headers=ADMIN
    )
    assert saved.status_code == 200, saved.text
    out = saved.json()
    assert (out["effective"], out["api_key_hint"], out["api_key_source"], out["line_number"]) == ("smsir", "…1234", "console", 30001234)
    assert KEY not in saved.text
    async with app.state.sessionmaker() as session:
        stored = await session.get(PlatformSetting, SMS_API_KEY)
    assert stored is not None and KEY not in json.dumps(stored.value)

    # The next sign-in code goes out through sms.ir from the configured line.
    requested = await client.post("/api/auth/otp/request", json={"mobile": MOBILE})
    assert requested.status_code == 202
    (send,) = [r for r in seen if r.url.path == "/v1/send/bulk"]
    assert send.headers["x-api-key"] == KEY
    payload = json.loads(send.content)
    assert payload["lineNumber"] == 30001234 and payload["mobiles"] == [MOBILE]
    assert "کد ورود" in payload["messageText"]
    assert KEY not in (await client.get("/api/platform/status", headers=ADMIN)).text


async def test_without_a_key_nothing_can_be_sent_and_confirmations_wait(app: FastAPI, client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Waiting Co")
    event_id = await create_event(client, organizer)
    tier_id = (await client.post(f"/api/events/{event_id}/ticket-tiers", json=tier(), headers=bearer(organizer))).json()["id"]
    _, token = await sign_in(client, MOBILE)

    switched = await client.put("/api/platform/sms", json={"mode": "smsir"}, headers=ADMIN)
    assert switched.json()["effective"] == "unconfigured"
    refused = await client.post("/api/auth/otp/request", json={"mobile": "09351234567"})
    assert refused.status_code == 503 and "not configured" in refused.json()["detail"]

    await client.post(f"/api/events/{event_id}/tickets/reserve", json={"ticket_tier_id": tier_id},
                      headers={"Authorization": f"Bearer {token}"})
    await deliver_due(app.state.sessionmaker, app.state.sms)
    async with app.state.sessionmaker() as session:
        message = await session.scalar(select(SmsMessage).where(SmsMessage.kind == "ticket_confirmation"))
    assert message is not None and (message.status, message.last_error) == ("pending", "NOT_CONFIGURED")

    # Back to test mode: the waiting confirmation goes out on a later pass.
    back = await client.put("/api/platform/sms", json={"reset": ["mode"]}, headers=ADMIN)
    assert back.json()["effective"] == "console" and back.json()["mode_source"] == "environment"


async def test_a_key_sealed_with_another_secret_must_be_entered_again(app: FastAPI, client: AsyncClient) -> None:
    async with app.state.sessionmaker() as session:
        session.add(PlatformSetting(key=SMS_API_KEY, value={"sealed": seal("a-previous-jwt-secret-of-32-characters!!", KEY)}))
        await session.commit()
    await client.put("/api/platform/sms", json={"mode": "smsir", "line_number": 30001234}, headers=ADMIN)
    out = (await client.get("/api/platform/sms", headers=ADMIN)).json()
    assert (out["api_key_unreadable"], out["effective"], out["api_key_hint"]) == (True, "unconfigured", None)
    reset = await client.put("/api/platform/sms", json={"reset": ["api_key"]}, headers=ADMIN)
    assert (reset.json()["api_key_set"], reset.json()["api_key_unreadable"]) == (False, False)


async def test_short_keys_are_refused(client: AsyncClient) -> None:
    response = await client.put("/api/platform/sms", json={"api_key": "abc"}, headers=ADMIN)
    assert response.status_code == 422


async def test_connection_check_reports_credit_and_whether_the_line_belongs_to_the_account(app: FastAPI, client: AsyncClient) -> None:
    seen: list[httpx.Request] = []
    gateway(app).transport = smsir_mock(seen)
    missing = await client.post("/api/platform/sms/check", json={}, headers=ADMIN)
    assert missing.json() == {"ok": False, "credit": None, "lines": [], "line_ok": None, "error": "NO_API_KEY"}

    good = await client.post("/api/platform/sms/check", json={"api_key": KEY, "line_number": 30001234}, headers=ADMIN)
    assert good.json() == {"ok": True, "credit": 125000.5, "lines": [30001234, 50002222], "line_ok": True, "error": None}
    wrong = await client.post("/api/platform/sms/check", json={"api_key": KEY, "line_number": 1111}, headers=ADMIN)
    assert wrong.json()["line_ok"] is False
    assert not [r for r in seen if r.url.path == "/v1/send/bulk"]  # a check never sends


async def test_platform_test_send_uses_sample_values(app: FastAPI, client: AsyncClient) -> None:
    sent = await client.post("/api/platform/sms/test", json={"mobile": MOBILE, "body": "Code {code} for {minutes} min"}, headers=ADMIN)
    assert sent.json() == {"status": "sent", "text": "Code 111111 for 2 min", "error": None, "test_mode": True}
    assert gateway(app).recorder.sent_to(MOBILE)[-1].kind == "test"
    confirmation = await client.post("/api/platform/sms/test", json={"mobile": MOBILE, "kind": "ticket_confirmation"}, headers=ADMIN)
    assert "همایش نمونه" in confirmation.json()["text"]


async def test_sign_in_rules_apply_immediately_and_reset_to_the_environment(app: FastAPI, client: AsyncClient) -> None:
    saved = await client.put("/api/platform/sign-in", json={"otp_length": 4, "otp_ttl_seconds": 300}, headers=ADMIN)
    assert saved.status_code == 200
    assert saved.json()["sources"]["otp_length"] == "console"

    requested = await client.post("/api/auth/otp/request", json={"mobile": MOBILE})
    assert (requested.json()["code_length"], requested.json()["expires_in"]) == (4, 300)
    message = gateway(app).recorder.sent_to(MOBILE)[-1]
    assert message.code is not None and len(message.code) == 4 and "5 دقیقه" in message.text

    assert (await client.put("/api/platform/sign-in", json={"otp_length": 9}, headers=ADMIN)).status_code == 422
    reset = await client.put("/api/platform/sign-in", json={"reset": ["otp_length", "otp_ttl_seconds"]}, headers=ADMIN)
    assert (reset.json()["otp_length"], reset.json()["otp_ttl_seconds"]) == (6, 120)


@asynccontextmanager
async def production_app(media_root: Path) -> AsyncIterator[AsyncClient]:
    await _truncate_all()
    settings = make_test_settings(media_root).model_copy(
        update={"environment": "production", "sms_provider": "smsir", "public_origin": "https://congress.example.org"}
    )
    app = create_app(settings)
    async with app.router.lifespan_context(app):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as http:
            yield http


async def test_production_refuses_test_mode_and_fast_resends(media_root: Path) -> None:
    async with production_app(media_root) as client:
        status: dict[str, Any] = (await client.get("/api/platform/status", headers=ADMIN)).json()
        assert status["sms"]["effective"] == "unconfigured" and status["sms"]["console_allowed"] is False
        assert (await client.put("/api/platform/sms", json={"mode": "console"}, headers=ADMIN)).status_code == 422
        assert (await client.put("/api/platform/sign-in", json={"otp_resend_cooldown_seconds": 5}, headers=ADMIN)).status_code == 422
        assert (await client.get("/api/platform/sms-outbox", params={"mobile": MOBILE}, headers=ADMIN)).status_code == 404


SECRET_BOX_KEY = "7c2e9a4f1b8d3e6a0c5f2b9e4d7a1c8f3e6b0d5a"


@asynccontextmanager
async def secret_box_app(media_root: Path) -> AsyncIterator[tuple[FastAPI, AsyncClient]]:
    await _truncate_all()
    app = create_app(make_test_settings(media_root).model_copy(update={"secret_box_key": SECRET_BOX_KEY}))
    async with app.router.lifespan_context(app):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as http:
            yield app, http


async def _stored_sealed_key(app: FastAPI) -> str:
    async with app.state.sessionmaker() as session:
        row = await session.get(PlatformSetting, SMS_API_KEY)
    assert row is not None
    return str(row.value["sealed"])


async def test_a_dedicated_secret_box_key_seals_new_credentials(media_root: Path) -> None:
    async with secret_box_app(media_root) as (app, client):
        saved = await client.put("/api/platform/sms", json={"mode": "smsir", "api_key": KEY, "line_number": 30001234}, headers=ADMIN)

        assert (saved.json()["effective"], saved.json()["api_key_hint"]) == ("smsir", "…1234")
        sealed = await _stored_sealed_key(app)
        assert open_sealed(sealed, SECRET_BOX_KEY) == KEY
        assert open_sealed(sealed, TEST_JWT_SECRET) is None


async def test_credentials_sealed_with_the_jwt_secret_still_open_and_are_resealed_on_the_next_save(
    media_root: Path,
) -> None:
    async with secret_box_app(media_root) as (app, client):
        async with app.state.sessionmaker() as session:
            session.add(PlatformSetting(key=SMS_API_KEY, value={"sealed": seal(TEST_JWT_SECRET, KEY)}))
            await session.commit()
        async with app.state.sessionmaker() as session:
            await reload_platform(app, session)

        before = (await client.get("/api/platform/sms", headers=ADMIN)).json()
        assert (before["api_key_set"], before["api_key_unreadable"], before["api_key_hint"]) == (True, False, "…1234")
        assert open_sealed(await _stored_sealed_key(app), SECRET_BOX_KEY) is None

        await client.put("/api/platform/sms", json={"line_number": 30001234}, headers=ADMIN)

        resealed = await _stored_sealed_key(app)
        assert open_sealed(resealed, SECRET_BOX_KEY) == KEY
        assert open_sealed(resealed, TEST_JWT_SECRET) is None
        after = (await client.get("/api/platform/sms", headers=ADMIN)).json()
        assert (after["api_key_hint"], after["line_number"]) == ("…1234", 30001234)


async def test_a_live_test_send_is_reported_as_real_and_a_network_failure_is_named(app: FastAPI, client: AsyncClient) -> None:
    seen: list[httpx.Request] = []
    gateway(app).transport = smsir_mock(seen)
    await client.put("/api/platform/sms", json={"mode": "smsir", "api_key": KEY, "line_number": 30001234}, headers=ADMIN)
    live = await client.post("/api/platform/sms/test", json={"mobile": MOBILE, "body": "Code {code}"}, headers=ADMIN)
    assert live.json() == {"status": "sent", "text": "Code 111111", "error": None, "test_mode": False}

    def unreachable(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no route to api.sms.ir", request=request)

    gateway(app).transport = httpx.MockTransport(unreachable)
    await client.put("/api/platform/sms", json={"api_key": KEY + "x"}, headers=ADMIN)  # new key: new client
    failed = await client.post("/api/platform/sms/test", json={"mobile": MOBILE, "body": "Code {code}"}, headers=ADMIN)
    assert (failed.json()["status"], failed.json()["error"], failed.json()["test_mode"]) == ("failed", "NETWORK", False)

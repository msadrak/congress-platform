"""SMS wording managed in the app: event overrides, platform defaults, validation, tests sends and the log."""

import uuid
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, update

from app.links import SAMPLE_CODE
from app.main import create_app
from app.models import ShortLink, SmsMessage
from app.sms.outbox import deliver_due
from app.sms.gateway import SmsGateway
from app.sms.provider import RecordingProvider, SmsResult
from app.sms.templates import KINDS, render, validate_body
from tests.conftest import ADMIN_TOKEN, _truncate_all, make_test_settings
from tests.helpers import bearer, pass_link, provision_organizer, publish_page, request_code, sign_in
from tests.test_events import EVENT
from tests.test_ticket_tiers import create_event, tier

ADMIN = {"X-Admin-Token": ADMIN_TOKEN}
MOBILE = "09121112233"


async def setup(client: AsyncClient) -> tuple[dict[str, str], str, str]:
    organizer = await provision_organizer(client, "SMS Panel Co")
    event_id = await create_event(client, organizer)
    await publish_page(client, organizer, event_id)
    tier_id = (
        await client.post(f"/api/events/{event_id}/ticket-tiers", json=tier(name="VIP Pass"), headers=bearer(organizer))
    ).json()["id"]
    return organizer, event_id, tier_id


async def reserve(client: AsyncClient, event_id: str, tier_id: str, mobile: str = MOBILE) -> Any:
    _, token = await sign_in(client, mobile, "Neda Karimi")
    response = await client.post(
        f"/api/events/{event_id}/tickets/reserve", json={"ticket_tier_id": tier_id},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 201, response.text
    return response.json()


def recorder(app: FastAPI) -> RecordingProvider:
    gateway: SmsGateway = app.state.sms
    return gateway.recorder


async def test_panel_starts_from_the_default_wording_with_this_events_sample(client: AsyncClient) -> None:
    organizer, event_id, _ = await setup(client)
    panel = await client.get(f"/api/events/{event_id}/sms", headers=bearer(organizer))

    assert panel.status_code == 200
    body = panel.json()
    assert body["delivery"] == "console"
    template, *lifecycle = body["templates"]
    assert [t["kind"] for t in lifecycle] == ["ticket_cancelled", "ticket_reissued"]
    assert template == {
        "kind": "ticket_confirmation",
        "body": KINDS["ticket_confirmation"].default,
        "is_custom": False,
        "default_body": KINDS["ticket_confirmation"].default,
        "placeholders": ["name", "event", "tier", "location", "link"],
        "required": [],
    }
    assert body["sample"]["event"] == EVENT["name"]
    assert body["sample"]["tier"] == "VIP Pass"
    assert body["sample"]["location"] == EVENT["location"]
    assert body["sample"]["link"] == f"http://test/t/{SAMPLE_CODE}"


def test_every_default_is_short_valid_and_keeps_the_link_whole() -> None:
    """One greeting, one fact, one link: at most two lines besides the link, glossary terms only."""
    long_link = "https://congress-registration.example-medical-university.ac.ir/t/k7m2x9q4"
    for kind, spec in KINDS.items():
        assert validate_body(kind, spec.default) == spec.default, kind
        text = render(spec.default, {p: long_link if p == "link" else "x" * 80 for p in spec.placeholders})
        lines = text.split("\n")
        assert len([line for line in lines if long_link not in line]) <= 2, kind
        if "{link}" in spec.default:
            assert any(line.endswith(long_link) for line in lines), kind  # whole, and ends its line
        for banned in ("بلیت", "بلیط", "لینک", "کنسول", "توکن"):
            assert banned not in spec.default, (kind, banned)


async def test_the_panel_shows_what_the_platform_gateway_actually_does(client: AsyncClient) -> None:
    organizer, event_id, _ = await setup(client)
    await client.put("/api/platform/sms", json={"mode": "smsir"}, headers=ADMIN)  # no key yet
    panel = await client.get(f"/api/events/{event_id}/sms", headers=bearer(organizer))
    assert panel.json()["delivery"] == "unconfigured"


async def test_the_events_own_wording_is_what_attendees_receive(app: FastAPI, client: AsyncClient) -> None:
    organizer, event_id, tier_id = await setup(client)
    saved = await client.put(
        f"/api/events/{event_id}/sms/templates/ticket_confirmation",
        json={"body": "  سلام {name}! کارت {tier} شما برای {event} در {location}:\r\n{link}  "},
        headers=bearer(organizer),
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["is_custom"] is True
    assert saved.json()["body"] == "سلام {name}! کارت {tier} شما برای {event} در {location}:\n{link}"

    ticket = await reserve(client, event_id, tier_id)
    await deliver_due(app.state.sessionmaker, app.state.sms)

    delivered = recorder(app).sent_to(MOBILE)[-1]
    assert delivered.kind == "ticket_confirmation"
    assert delivered.text == (
        f"سلام Neda Karimi! کارت VIP Pass شما برای {EVENT['name']} در {EVENT['location']}:\n"
        f"{await pass_link(app, ticket['id'])}"
    )


async def test_invalid_wording_is_refused_with_a_reason(client: AsyncClient) -> None:
    organizer, event_id, _ = await setup(client)
    url = f"/api/events/{event_id}/sms/templates/ticket_confirmation"
    for text, reason in (
        ("   ", "cannot be empty"),
        ("Hi {nmae}, {link}", "Unknown placeholder {nmae}"),
        ("x" * 1001, "longer than 1000"),
    ):
        response = await client.put(url, json={"body": text}, headers=bearer(organizer))
        assert response.status_code == 422, text
        assert reason in response.json()["detail"]
    assert (await client.put(f"/api/events/{event_id}/sms/templates/otp", json={"body": "{code}"}, headers=bearer(organizer))).status_code == 422
    panel = (await client.get(f"/api/events/{event_id}/sms", headers=bearer(organizer))).json()
    assert panel["templates"][0]["is_custom"] is False


async def test_reset_returns_to_the_platform_wording(client: AsyncClient) -> None:
    organizer, event_id, _ = await setup(client)
    url = f"/api/events/{event_id}/sms/templates/ticket_confirmation"
    await client.put(url, json={"body": "Custom {link}"}, headers=bearer(organizer))
    reset = await client.delete(url, headers=bearer(organizer))
    assert reset.status_code == 200
    assert reset.json()["is_custom"] is False
    assert reset.json()["body"] == KINDS["ticket_confirmation"].default


async def test_platform_wording_is_the_default_and_an_event_override_wins(app: FastAPI, client: AsyncClient) -> None:
    organizer, event_id, tier_id = await setup(client)
    assert (await client.get("/api/platform/sms-templates")).status_code == 401
    platform = await client.put(
        "/api/platform/sms-templates/ticket_confirmation", json={"body": "Platform: {event} {link}"}, headers=ADMIN
    )
    assert platform.status_code == 200 and platform.json()["is_custom"] is True

    panel = (await client.get(f"/api/events/{event_id}/sms", headers=bearer(organizer))).json()
    assert panel["templates"][0]["body"] == "Platform: {event} {link}"
    assert panel["templates"][0]["default_body"] == "Platform: {event} {link}"
    await reserve(client, event_id, tier_id)
    await deliver_due(app.state.sessionmaker, app.state.sms)
    assert recorder(app).sent_to(MOBILE)[-1].text.startswith(f"Platform: {EVENT['name']}")

    other_event = await client.post(
        "/api/events", json={**EVENT, "slug": "autumn-congress"}, headers=bearer(organizer)
    )
    await publish_page(client, organizer, other_event.json()["id"])
    other_tier = (
        await client.post(f"/api/events/{other_event.json()['id']}/ticket-tiers", json=tier(), headers=bearer(organizer))
    ).json()["id"]
    await client.put(
        f"/api/events/{other_event.json()['id']}/sms/templates/ticket_confirmation",
        json={"body": "Own: {link}"}, headers=bearer(organizer),
    )
    await reserve(client, other_event.json()["id"], other_tier)
    await deliver_due(app.state.sessionmaker, app.state.sms)
    assert recorder(app).sent_to(MOBILE)[-1].text.startswith("Own: ")

    listed = (await client.get("/api/platform/sms-templates", headers=ADMIN)).json()
    assert {t["kind"] for t in listed} == {
        "otp", "ticket_confirmation", "ticket_cancelled", "ticket_reissued", "staff_invite", "member_invite",
        "operator_invite",
    }


async def test_platform_sets_the_sign_in_code_text(app: FastAPI, client: AsyncClient) -> None:
    refused = await client.put("/api/platform/sms-templates/otp", json={"body": "Your code is ready"}, headers=ADMIN)
    assert refused.status_code == 422 and "{code}" in refused.json()["detail"]
    saved = await client.put(
        "/api/platform/sms-templates/otp", json={"body": "AITeb code {code} ({minutes} min)"}, headers=ADMIN
    )
    assert saved.status_code == 200

    code = await request_code(client, MOBILE)
    assert recorder(app).sent_to(MOBILE)[-1].text == f"AITeb code {code} (2 min)"

    await client.delete("/api/platform/sms-templates/otp", headers=ADMIN)
    code = await request_code(client, MOBILE)
    assert recorder(app).sent_to(MOBILE)[-1].text.startswith(f"کد ورود همایش: {code}")


async def test_another_organizer_cannot_read_edit_test_or_list(client: AsyncClient) -> None:
    _, event_id, _ = await setup(client)
    other = await provision_organizer(client, "Other Co")
    for method, path, body in (
        ("GET", f"/api/events/{event_id}/sms", None),
        ("PUT", f"/api/events/{event_id}/sms/templates/ticket_confirmation", {"body": "Hijack {link}"}),
        ("DELETE", f"/api/events/{event_id}/sms/templates/ticket_confirmation", None),
        ("POST", f"/api/events/{event_id}/sms/test", {"mobile": MOBILE}),
        ("GET", f"/api/events/{event_id}/sms/messages", None),
    ):
        response = await client.request(method, path, json=body, headers=bearer(other))
        assert response.status_code == 404, (method, path)
    for method, path in (("GET", f"/api/events/{event_id}/sms"), ("GET", f"/api/events/{event_id}/sms/messages")):
        assert (await client.request(method, path)).status_code == 401


async def add_operator(client: AsyncClient, organizer: dict[str, str], event_id: str, mobile: str) -> None:
    added = await client.post(
        f"/api/events/{event_id}/desk/operators",
        json={"operator_name": "Reception", "mobile": mobile},
        headers=bearer(organizer),
    )
    assert added.status_code == 201, added.text


async def test_a_test_send_uses_sample_values_is_logged_and_rate_limited(app: FastAPI, client: AsyncClient) -> None:
    organizer, event_id, tier_id = await setup(client)
    await add_operator(client, organizer, event_id, "09351234567")
    await add_operator(client, organizer, event_id, MOBILE)
    draft = await client.post(
        f"/api/events/{event_id}/sms/test",
        json={"mobile": "۰۹۳۵ ۱۲۳ ۴۵۶۷", "body": "Draft for {name}: {tier}"},
        headers=bearer(organizer),
    )
    assert draft.status_code == 200, draft.text
    assert draft.json() == {"status": "sent", "text": "Draft for نام شرکت‌کننده: VIP Pass", "error": None, "test_mode": True}
    assert recorder(app).sent_to("09351234567")[-1].kind == "test"
    # The draft was only tried, not saved.
    panel = (await client.get(f"/api/events/{event_id}/sms", headers=bearer(organizer))).json()
    assert panel["templates"][0]["is_custom"] is False
    invalid = await client.post(
        f"/api/events/{event_id}/sms/test", json={"mobile": MOBILE, "body": "{oops}"}, headers=bearer(organizer)
    )
    assert invalid.status_code == 422 and invalid.json()["code"] == "SMS_TEMPLATE_INVALID"

    await reserve(client, event_id, tier_id)
    logged = (await client.get(f"/api/events/{event_id}/sms/messages", headers=bearer(organizer))).json()
    # The operators' invitations are in the event's log too.
    assert [m["kind"] for m in logged].count("operator_invite") == 2
    messages = [m for m in logged if m["kind"] != "operator_invite"]
    assert [(m["kind"], m["mobile"], m["status"]) for m in messages] == [
        ("ticket_confirmation", "0912***2233", "pending"),
        ("test", "0935***4567", "sent"),
    ]
    assert messages[1]["body"] == "Draft for نام شرکت‌کننده: VIP Pass"

    responses = [
        await client.post(f"/api/events/{event_id}/sms/test", json={"mobile": MOBILE}, headers=bearer(organizer))
        for _ in range(10)
    ]
    assert [r.status_code for r in responses] == [200] * 9 + [429]
    assert responses[-1].json()["code"] == "TEST_SMS_RATE_LIMITED"


async def test_test_messages_only_go_to_people_of_this_event(app: FastAPI, client: AsyncClient) -> None:
    """The platform's sender line must not carry an organizer's arbitrary text to arbitrary numbers."""
    organizer, event_id, tier_id = await setup(client)
    url = f"/api/events/{event_id}/sms/test"
    stranger = await client.post(url, json={"mobile": "09351234567", "body": "Pay here {name}"}, headers=bearer(organizer))
    assert stranger.status_code == 403 and stranger.json()["code"] == "TEST_SMS_RECIPIENT_NOT_ALLOWED"
    assert recorder(app).sent_to("09351234567") == []

    await reserve(client, event_id, tier_id, mobile="09351234567")  # a ticket holder
    await add_operator(client, organizer, event_id, "09361234567")  # a desk operator
    booth = await client.post(
        f"/api/events/{event_id}/booths", json={"name": "Booth", "slug": "booth"}, headers=bearer(organizer)
    )
    assert booth.status_code == 201, booth.text
    staffed = await client.post(
        f"/api/events/{event_id}/booths/{booth.json()['id']}/staff",
        json={"mobile": "09371234567"},
        headers=bearer(organizer),
    )
    assert staffed.status_code == 201, staffed.text
    for mobile in ("09351234567", "09361234567", "09371234567"):
        sent = await client.post(url, json={"mobile": mobile}, headers=bearer(organizer))
        assert sent.status_code == 200, (mobile, sent.text)

    # Another event's people are strangers here.
    other_event = await client.post("/api/events", json={**EVENT, "slug": "another-congress"}, headers=bearer(organizer))
    refused = await client.post(
        f"/api/events/{other_event.json()['id']}/sms/test", json={"mobile": "09361234567"}, headers=bearer(organizer)
    )
    assert refused.status_code == 403


async def test_test_messages_have_a_daily_cap_per_organizer_across_events(media_root: Path) -> None:
    await _truncate_all()
    app = create_app(make_test_settings(media_root).model_copy(update={"sms_test_sends_per_organizer_per_day": 3}))
    async with app.router.lifespan_context(app):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            organizer, first, _ = await setup(client)
            second = (
                await client.post("/api/events", json={**EVENT, "slug": "second-congress"}, headers=bearer(organizer))
            ).json()["id"]
            await add_operator(client, organizer, first, MOBILE)
            await add_operator(client, organizer, second, MOBILE)
            results = []
            for event_id in (first, first, second, second):
                sent = await client.post(f"/api/events/{event_id}/sms/test", json={"mobile": MOBILE},
                                         headers=bearer(organizer))
                results.append((sent.status_code, sent.json().get("code")))
            assert results == [(200, None), (200, None), (200, None), (429, "TEST_SMS_DAILY_CAP_REACHED")]


# A real deployment's origin alone can exceed the 60 characters other values are shortened to; a shortened
# link (".../t/k7m…") opens no page, so the link is always sent whole.
LONG_ORIGIN = "https://congress-registration.example-medical-university.ac.ir"
LONG_SLUG = "international-congress-of-cardiology-and-vascular-surgery-2027"
LONG_SAMPLE_LINK = f"{LONG_ORIGIN}/t/{SAMPLE_CODE}"


async def long_link_event(app: FastAPI, client: AsyncClient) -> tuple[dict[str, str], str, str]:
    app.state.settings.public_origin = LONG_ORIGIN
    organizer = await provision_organizer(client, "Long Link Co")
    created = await client.post("/api/events", json={**EVENT, "slug": LONG_SLUG}, headers=bearer(organizer))
    assert created.status_code == 201, created.text
    event_id: str = created.json()["id"]
    await publish_page(client, organizer, event_id)
    tier_id = (
        await client.post(f"/api/events/{event_id}/ticket-tiers", json=tier(), headers=bearer(organizer))
    ).json()["id"]
    return organizer, event_id, tier_id


async def test_the_pass_link_is_never_shortened_while_long_values_still_are(app: FastAPI, client: AsyncClient) -> None:
    assert len(LONG_SAMPLE_LINK) > 60
    organizer, event_id, tier_id = await long_link_event(app, client)
    await client.put(
        f"/api/events/{event_id}/sms/templates/ticket_confirmation",
        json={"body": "{name}|{link}"}, headers=bearer(organizer),
    )
    _, token = await sign_in(client, MOBILE, "Neda " + "Karimi-" * 12)
    reserved = await client.post(
        f"/api/events/{event_id}/tickets/reserve", json={"ticket_tier_id": tier_id},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert reserved.status_code == 201, reserved.text
    await deliver_due(app.state.sessionmaker, app.state.sms)

    name, link = recorder(app).sent_to(MOBILE)[-1].text.split("|")
    async with app.state.sessionmaker() as session:
        code = await session.scalar(select(ShortLink.code).where(ShortLink.ticket_id == uuid.UUID(reserved.json()["id"])))
    assert link == f"{LONG_ORIGIN}/t/{code}"
    assert len(name) == 60 and name.endswith("…")


async def test_the_organizer_preview_and_test_send_show_the_whole_link(app: FastAPI, client: AsyncClient) -> None:
    organizer, event_id, _ = await long_link_event(app, client)
    panel = (await client.get(f"/api/events/{event_id}/sms", headers=bearer(organizer))).json()
    assert panel["sample"]["link"] == LONG_SAMPLE_LINK

    await add_operator(client, organizer, event_id, MOBILE)
    sent = await client.post(
        f"/api/events/{event_id}/sms/test", json={"mobile": MOBILE, "body": "Pass: {link}"}, headers=bearer(organizer)
    )
    assert sent.status_code == 200, sent.text
    assert sent.json()["text"] == f"Pass: {LONG_SAMPLE_LINK}"


async def test_the_platform_test_send_shows_the_whole_link(app: FastAPI, client: AsyncClient) -> None:
    app.state.settings.public_origin = LONG_ORIGIN
    sent = await client.post(
        "/api/platform/sms/test",
        json={"mobile": MOBILE, "kind": "ticket_confirmation", "body": "Pass: {link}"}, headers=ADMIN,
    )
    assert sent.status_code == 200, sent.text
    assert sent.json()["text"] == f"Pass: {LONG_SAMPLE_LINK}"


async def confirmation(client: AsyncClient, organizer: dict[str, str], event_id: str) -> dict[str, Any]:
    messages = (await client.get(f"/api/events/{event_id}/sms/messages", headers=bearer(organizer))).json()
    (message,) = [m for m in messages if m["kind"] == "ticket_confirmation"]
    result: dict[str, Any] = message
    return result


async def test_the_organizer_retries_a_failed_confirmation(app: FastAPI, client: AsyncClient) -> None:
    organizer, event_id, tier_id = await setup(client)
    await reserve(client, event_id, tier_id)
    recorder(app).queued_results.append(SmsResult(ok=False, error="HTTP_400", retryable=False))
    await deliver_due(app.state.sessionmaker, app.state.sms)
    failed = await confirmation(client, organizer, event_id)
    assert (failed["status"], failed["can_retry"], failed["can_resolve"]) == ("failed", True, False)

    url = f"/api/events/{event_id}/sms/messages/{failed['id']}"
    retried = await client.post(f"{url}/retry", json={}, headers=bearer(organizer))
    assert retried.status_code == 200, retried.text
    assert (retried.json()["status"], retried.json()["attempts"], retried.json()["last_error"]) == ("pending", 0, None)
    await deliver_due(app.state.sessionmaker, app.state.sms)
    assert (await confirmation(client, organizer, event_id))["status"] == "sent"

    again = await client.post(f"{url}/retry", json={}, headers=bearer(organizer))
    assert again.status_code == 409 and again.json()["code"] == "SMS_MESSAGE_NOT_RETRYABLE"
    other = await provision_organizer(client, "Other Co")
    assert (await client.post(f"{url}/retry", json={}, headers=bearer(other))).status_code == 404


async def test_an_unknown_message_is_resolved_or_retried_only_on_purpose(app: FastAPI, client: AsyncClient) -> None:
    organizer, event_id, tier_id = await setup(client)
    await reserve(client, event_id, tier_id)
    recorder(app).queued_results.append(SmsResult(ok=False, error="TIMEOUT", unknown=True))
    await deliver_due(app.state.sessionmaker, app.state.sms)
    unknown = await confirmation(client, organizer, event_id)
    assert (unknown["status"], unknown["can_retry"], unknown["can_resolve"]) == ("unknown", True, True)
    url = f"/api/events/{event_id}/sms/messages/{unknown['id']}"

    # It may already have arrived: a retry must be confirmed.
    unconfirmed = await client.post(f"{url}/retry", json={}, headers=bearer(organizer))
    assert unconfirmed.status_code == 409 and unconfirmed.json()["code"] == "SMS_RETRY_MAY_DUPLICATE"

    resolved = await client.post(f"{url}/resolve", headers=bearer(organizer))
    assert resolved.status_code == 200 and resolved.json()["status"] == "resolved"
    assert (await client.post(f"{url}/resolve", headers=bearer(organizer))).json()["code"] == "SMS_MESSAGE_NOT_UNKNOWN"
    assert await deliver_due(app.state.sessionmaker, app.state.sms) == 0

    async with app.state.sessionmaker() as session:
        await session.execute(
            update(SmsMessage).where(SmsMessage.id == uuid.UUID(unknown["id"])).values(status="unknown")
        )
        await session.commit()
    confirmed = await client.post(f"{url}/retry", json={"confirm_duplicate": True}, headers=bearer(organizer))
    assert confirmed.status_code == 200 and confirmed.json()["status"] == "pending"
    assert await deliver_due(app.state.sessionmaker, app.state.sms) == 1


async def test_a_message_whose_text_was_removed_cannot_be_retried(app: FastAPI, client: AsyncClient) -> None:
    organizer, event_id, tier_id = await setup(client)
    await reserve(client, event_id, tier_id)
    recorder(app).queued_results.append(SmsResult(ok=False, error="HTTP_400", retryable=False))
    await deliver_due(app.state.sessionmaker, app.state.sms)
    async with app.state.sessionmaker() as session:
        await session.execute(update(SmsMessage).where(SmsMessage.kind == "ticket_confirmation").values(body=None))
        await session.commit()
    failed = await confirmation(client, organizer, event_id)
    assert failed["can_retry"] is False
    refused = await client.post(
        f"/api/events/{event_id}/sms/messages/{failed['id']}/retry", json={}, headers=bearer(organizer)
    )
    assert refused.status_code == 409 and refused.json()["code"] == "SMS_MESSAGE_TEXT_REMOVED"

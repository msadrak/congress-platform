"""SMS wording managed in the app: event overrides, platform defaults, validation, tests sends and the log."""

from typing import Any

from fastapi import FastAPI
from httpx import AsyncClient

from app.sms.outbox import deliver_due
from app.sms.gateway import SmsGateway
from app.sms.provider import RecordingProvider
from app.sms.templates import KINDS
from tests.conftest import ADMIN_TOKEN
from tests.helpers import bearer, provision_organizer, request_code, sign_in
from tests.test_events import EVENT
from tests.test_ticket_tiers import create_event, tier

ADMIN = {"X-Admin-Token": ADMIN_TOKEN}
MOBILE = "09121112233"


async def setup(client: AsyncClient) -> tuple[dict[str, str], str, str]:
    organizer = await provision_organizer(client, "SMS Panel Co")
    event_id = await create_event(client, organizer)
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
    (template,) = body["templates"]
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
    assert body["sample"]["link"] == f"http://test/c/{EVENT['slug']}/my-ticket"


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

    await reserve(client, event_id, tier_id)
    await deliver_due(app.state.sessionmaker, app.state.sms)

    delivered = recorder(app).sent_to(MOBILE)[-1]
    assert delivered.kind == "ticket_confirmation"
    assert delivered.text == (
        f"سلام Neda Karimi! کارت VIP Pass شما برای {EVENT['name']} در {EVENT['location']}:\n"
        f"http://test/c/{EVENT['slug']}/my-ticket"
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
    assert {t["kind"] for t in listed} == {"otp", "ticket_confirmation"}


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
    assert recorder(app).sent_to(MOBILE)[-1].text.startswith(f"کد ورود شما به سامانه همایش: {code}")


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


async def test_a_test_send_uses_sample_values_is_logged_and_rate_limited(app: FastAPI, client: AsyncClient) -> None:
    organizer, event_id, tier_id = await setup(client)
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
    assert (await client.post(f"/api/events/{event_id}/sms/test", json={"mobile": MOBILE, "body": "{oops}"}, headers=bearer(organizer))).status_code == 422

    await reserve(client, event_id, tier_id)
    messages = (await client.get(f"/api/events/{event_id}/sms/messages", headers=bearer(organizer))).json()
    assert [(m["kind"], m["mobile"], m["status"]) for m in messages] == [
        ("ticket_confirmation", "0912***2233", "pending"),
        ("test", "0935***4567", "sent"),
    ]
    assert messages[1]["body"] == "Draft for نام شرکت‌کننده: VIP Pass"

    statuses = [
        (await client.post(f"/api/events/{event_id}/sms/test", json={"mobile": MOBILE}, headers=bearer(organizer))).status_code
        for _ in range(10)
    ]
    assert statuses == [200] * 9 + [429]


# A real deployment's origin plus a descriptive slug is far longer than the 60 characters other values are
# shortened to; a shortened link (".../my-tic…") opens no page, so the link is always sent whole.
LONG_ORIGIN = "https://congress-registration.example-medical-university.ac.ir"
LONG_SLUG = "international-congress-of-cardiology-and-vascular-surgery-2027"
LONG_LINK = f"{LONG_ORIGIN}/c/{LONG_SLUG}/my-ticket"


async def long_link_event(app: FastAPI, client: AsyncClient) -> tuple[dict[str, str], str, str]:
    app.state.settings.public_origin = LONG_ORIGIN
    organizer = await provision_organizer(client, "Long Link Co")
    created = await client.post("/api/events", json={**EVENT, "slug": LONG_SLUG}, headers=bearer(organizer))
    assert created.status_code == 201, created.text
    event_id: str = created.json()["id"]
    tier_id = (
        await client.post(f"/api/events/{event_id}/ticket-tiers", json=tier(), headers=bearer(organizer))
    ).json()["id"]
    return organizer, event_id, tier_id


async def test_the_pass_link_is_never_shortened_while_long_values_still_are(app: FastAPI, client: AsyncClient) -> None:
    assert len(LONG_LINK) > 60
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
    assert link == LONG_LINK
    assert len(name) == 60 and name.endswith("…")


async def test_the_organizer_preview_and_test_send_show_the_whole_link(app: FastAPI, client: AsyncClient) -> None:
    organizer, event_id, _ = await long_link_event(app, client)
    panel = (await client.get(f"/api/events/{event_id}/sms", headers=bearer(organizer))).json()
    assert panel["sample"]["link"] == LONG_LINK

    sent = await client.post(
        f"/api/events/{event_id}/sms/test", json={"mobile": MOBILE, "body": "Pass: {link}"}, headers=bearer(organizer)
    )
    assert sent.status_code == 200, sent.text
    assert sent.json()["text"] == f"Pass: {LONG_LINK}"


async def test_the_platform_test_send_shows_the_whole_link(app: FastAPI, client: AsyncClient) -> None:
    app.state.settings.public_origin = LONG_ORIGIN
    sent = await client.post(
        "/api/platform/sms/test",
        json={"mobile": MOBILE, "kind": "ticket_confirmation", "body": "Pass: {link}"}, headers=ADMIN,
    )
    assert sent.status_code == 200, sent.text
    assert sent.json()["text"] == f"Pass: {LONG_ORIGIN}/c/sample/my-ticket"

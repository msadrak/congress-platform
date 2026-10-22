from typing import Any

from httpx import AsyncClient

from tests.conftest import ADMIN_TOKEN


async def sms_code(client: AsyncClient, mobile: str) -> str:
    """The newest sign-in code the console SMS provider "sent" to this number."""
    response = await client.get(
        "/api/platform/sms-outbox", params={"mobile": mobile}, headers={"X-Admin-Token": ADMIN_TOKEN}
    )
    assert response.status_code == 200, response.text
    codes = [m["code"] for m in response.json() if m["code"]]
    assert codes, f"no sign-in code was sent to {mobile}"
    code: str = codes[0]
    return code


async def request_code(client: AsyncClient, mobile: str, purpose: str = "signin") -> str:
    response = await client.post("/api/auth/otp/request", json={"mobile": mobile, "purpose": purpose})
    assert response.status_code == 202, response.text
    return await sms_code(client, mobile)


async def sign_in(
    client: AsyncClient,
    mobile: str,
    name: str = "Test Attendee",
    organization: str = "Test Org",
    title: str = "Engineer",
) -> tuple[dict[str, Any], str]:
    """Sign in by SMS code, completing the profile when the number is new. Returns (user, access token)."""
    code = await request_code(client, mobile)
    verified = await client.post("/api/auth/otp/verify", json={"mobile": mobile, "code": code})
    assert verified.status_code == 200, verified.text
    body: dict[str, Any] = verified.json()
    if body["status"] == "profile_required":
        completed = await client.post(
            "/api/auth/otp/complete",
            json={"signup_token": body["signup_token"], "full_name": name, "organization": organization, "title": title},
        )
        assert completed.status_code == 201, completed.text
        body = completed.json()
    return body["user"], body["access_token"]


async def desk_sign_in(client: AsyncClient, event_id: str, mobile: str) -> Any:
    """Front-desk login by SMS code; returns the raw response so callers can assert refusals too."""
    request = await client.post("/api/auth/otp/request", json={"mobile": mobile, "purpose": "desk"})
    assert request.status_code == 202, request.text
    response = await client.get(
        "/api/platform/sms-outbox", params={"mobile": mobile}, headers={"X-Admin-Token": ADMIN_TOKEN}
    )
    codes = [m["code"] for m in response.json() if m["code"]]
    # Desk codes are only sent to active operators; a made-up code gets the same 401 as a wrong one.
    code = codes[0] if codes else "000000"
    return await client.post(f"/api/events/{event_id}/desk/login", json={"mobile": mobile, "code": code})


async def provision_organizer(client: AsyncClient, name: str) -> dict[str, str]:
    response = await client.post(
        "/api/organizers", json={"name": name}, headers={"X-Admin-Token": ADMIN_TOKEN}
    )
    assert response.status_code == 201, response.text
    body: dict[str, str] = response.json()
    return body


def bearer(organizer: dict[str, str]) -> dict[str, str]:
    return {"Authorization": f"Bearer {organizer['api_key']}"}


async def publish_page(client: AsyncClient, organizer: dict[str, str], event_id: str) -> dict[str, Any]:
    """Publishes the event's current page draft: the step that makes a new event public."""
    state = await client.get(f"/api/events/{event_id}/page", headers=bearer(organizer))
    assert state.status_code == 200, state.text
    published = await client.post(
        f"/api/events/{event_id}/page/publish",
        json={"revision": state.json()["draft_revision"]},
        headers=bearer(organizer),
    )
    assert published.status_code == 200, published.text
    body: dict[str, Any] = published.json()
    return body

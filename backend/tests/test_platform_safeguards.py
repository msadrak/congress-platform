"""Operational safeguards: health probes, check-in point validation at creation, and the test harness's
refusal to touch anything but its own disposable database."""

from pathlib import Path

import asyncpg
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.engine import make_url

from app.config import Settings
from app.main import create_app
from tests.conftest import (
    ADMIN_DSN,
    ADMIN_TOKEN,
    TEST_JWT_SECRET,
    assert_test_database_identity,
    disposable_target_problem,
)
from tests.helpers import bearer, provision_organizer
from tests.test_ticket_tiers import create_event, tier


async def test_health_and_readiness(client: AsyncClient) -> None:
    health = await client.get("/api/health")
    ready = await client.get("/api/ready")

    assert (health.status_code, health.json()) == (200, {"status": "ok"})
    assert (ready.status_code, ready.json()) == (200, {"status": "ready"})


async def test_readiness_reports_an_unreachable_database_without_details(tmp_path: Path) -> None:
    secret_url = "postgresql+asyncpg://dbuser:hunter2-password@127.0.0.1:1/private_db"
    app = create_app(
        Settings(
            environment="test",
            database_url=secret_url,
            platform_admin_token=ADMIN_TOKEN,
            jwt_secret=TEST_JWT_SECRET,
            media_root=tmp_path,
        )
    )
    async with app.router.lifespan_context(app):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as http:
            health = await http.get("/api/health")
            ready = await http.get("/api/ready")

    assert health.status_code == 200
    assert ready.status_code == 503
    assert ready.json() == {"status": "unavailable"}
    assert "hunter2" not in ready.text and "private_db" not in ready.text


async def test_checkin_point_creation_validates_policy_and_tiers(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    other = await provision_organizer(client, "Other Co")
    event_id = await create_event(client, organizer)
    own_tier = (
        await client.post(f"/api/events/{event_id}/ticket-tiers", json=tier(), headers=bearer(organizer))
    ).json()["id"]
    foreign_event = (
        await client.post(
            "/api/events",
            json={"name": "Other", "slug": "other-congress", "starts_at": "2027-01-01T08:00:00Z",
                  "ends_at": "2027-01-02T08:00:00Z", "location": "Elsewhere"},
            headers=bearer(other),
        )
    ).json()["id"]
    foreign_tier = (
        await client.post(f"/api/events/{foreign_event}/ticket-tiers", json=tier(), headers=bearer(other))
    ).json()["id"]
    url = f"/api/events/{event_id}/checkin-points"

    bad_policy = await client.post(url, json={"name": "Gate", "policy_type": "VIP_ONLY"}, headers=bearer(organizer))
    foreign = await client.post(
        url, json={"name": "Gate", "policy_type": "TIER_RESTRICTED", "allowed_tier_ids": [foreign_tier]},
        headers=bearer(organizer),
    )
    garbage = await client.post(
        url, json={"name": "Gate", "policy_type": "TIER_RESTRICTED", "allowed_tier_ids": ["not-a-tier"]},
        headers=bearer(organizer),
    )
    good = await client.post(
        url, json={"name": "Gate", "policy_type": " tier_restricted ", "allowed_tier_ids": [own_tier]},
        headers=bearer(organizer),
    )

    assert bad_policy.status_code == 400
    assert foreign.status_code == 400
    assert garbage.status_code == 400
    assert good.status_code == 201, good.text
    assert good.json()["policy_type"] == "TIER_RESTRICTED"
    listed = (await client.get(url, headers=bearer(organizer))).json()
    assert [p["id"] for p in listed] == [good.json()["id"]]


@pytest.mark.parametrize(
    ("test_url", "admin_dsn"),
    [
        ("postgresql+asyncpg://u:p@127.0.0.1:5433/congress", "postgresql://u:p@127.0.0.1:5433/postgres"),
        ("postgresql+asyncpg://u:p@127.0.0.1:55432/congress_demo", "postgresql://u:p@127.0.0.1:55432/postgres"),
        ("postgresql+asyncpg://u:p@127.0.0.1:5433/postgres", "postgresql://u:p@127.0.0.1:5433/postgres"),
        ("postgresql+asyncpg://u:p@127.0.0.1:5433/congress_test", "postgresql://u:p@10.0.0.9:5433/postgres"),
        ("postgresql+asyncpg://u:p@127.0.0.1:5433/congress_test", "postgresql://u:p@127.0.0.1:5433/congress"),
        ("sqlite+aiosqlite:///congress_test", "postgresql://u:p@127.0.0.1:5433/postgres"),
    ],
)
def test_harness_refuses_targets_that_are_not_a_disposable_test_database(test_url: str, admin_dsn: str) -> None:
    assert disposable_target_problem(make_url(test_url), make_url(admin_dsn)) is not None


def test_harness_accepts_a_test_database_on_the_admin_server() -> None:
    url = make_url("postgresql+asyncpg://u:p@127.0.0.1:5433/congress_test")
    assert disposable_target_problem(url, make_url("postgresql://u:p@127.0.0.1:5433/postgres")) is None


async def test_truncation_guard_refuses_an_unmarked_database() -> None:
    conn = await asyncpg.connect(ADMIN_DSN)  # the server's maintenance database
    try:
        with pytest.raises(RuntimeError, match="not the marked disposable test database"):
            await assert_test_database_identity(conn)
    finally:
        await conn.close()

"""Unit security regression tests for finding P1-SCAN-AUTH.

Tests scanner authentication and authorization controls without requiring
external database connections.
"""

import asyncio
import uuid
from datetime import timedelta, timezone
from typing import Any

from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from app.auth import hash_api_key
from app.config import Settings
from app.models import CheckInPoint, Event, Organizer, ScannerDevice
from app.routes.checkin import authorized_checkin_point
from app.security import create_access_token, create_scanner_token


class MockRequest:
    def __init__(self, jwt_secret: str) -> None:
        self.app = type(
            "App",
            (),
            {
                "state": type(
                    "State",
                    (),
                    {
                        "settings": Settings(
                            environment="development",
                            platform_admin_token="admin-token",
                            jwt_secret=jwt_secret,
                        )
                    },
                )()
            },
        )()


class MockSession:
    def __init__(
        self,
        points: dict[uuid.UUID, CheckInPoint],
        events: dict[uuid.UUID, Event],
        organizers: dict[str, Organizer],
        devices: dict[uuid.UUID, ScannerDevice] | None = None,
    ) -> None:
        self._points = points
        self._events = events
        self._organizers = organizers
        self._devices = devices or {}

    async def get(self, model: type[Any], ident: Any) -> Any:
        if model == CheckInPoint:
            return self._points.get(ident)
        if model == Event:
            return self._events.get(ident)
        if model == ScannerDevice:
            return self._devices.get(ident)
        return None

    async def scalar(self, stmt: Any) -> Any:
        compiled = str(stmt.compile(compile_kwargs={"literal_binds": True}))
        for key_hash, org in self._organizers.items():
            if key_hash in compiled:
                return org
        return None


async def test_all_scanner_security_controls() -> None:
    jwt_secret = "test-secret-key-32-chars-long-minimum-size"
    req: Any = MockRequest(jwt_secret)

    org_id = uuid.uuid4()
    foreign_org_id = uuid.uuid4()
    event_id = uuid.uuid4()
    point1_id = uuid.uuid4()
    point2_id = uuid.uuid4()
    foreign_event_id = uuid.uuid4()
    foreign_point_id = uuid.uuid4()

    event = Event(id=event_id, organizer_id=org_id, name="Event 1", slug="evt-1")
    foreign_event = Event(
        id=foreign_event_id, organizer_id=foreign_org_id, name="Event 2", slug="evt-2"
    )

    point1 = CheckInPoint(id=point1_id, event_id=event_id, name="Gate 1")
    point2 = CheckInPoint(id=point2_id, event_id=event_id, name="Gate 2")
    foreign_point = CheckInPoint(
        id=foreign_point_id, event_id=foreign_event_id, name="Foreign Gate"
    )

    org_key = "organizer-api-key-secret-123"
    org = Organizer(id=org_id, name="Org 1", api_key_hash=hash_api_key(org_key))

    foreign_org_key = "foreign-organizer-api-key-456"
    foreign_org = Organizer(
        id=foreign_org_id, name="Org 2", api_key_hash=hash_api_key(foreign_org_key)
    )

    points_map = {point1_id: point1, point2_id: point2, foreign_point_id: foreign_point}
    events_map = {event_id: event, foreign_event_id: foreign_event}
    orgs_map = {hash_api_key(org_key): org, hash_api_key(foreign_org_key): foreign_org}

    active_device_id = uuid.uuid4()
    revoked_device_id = uuid.uuid4()
    active_device = ScannerDevice(
        id=active_device_id,
        checkin_point_id=point1_id,
        event_id=event_id,
        device_name="Tablet 1",
        is_revoked=False,
    )
    revoked_device = ScannerDevice(
        id=revoked_device_id,
        checkin_point_id=point1_id,
        event_id=event_id,
        device_name="Tablet Revoked",
        is_revoked=True,
    )
    devices_map = {active_device_id: active_device, revoked_device_id: revoked_device}

    session: Any = MockSession(points_map, events_map, orgs_map, devices_map)

    # 1. Unauthenticated request (missing credentials) MUST return 401
    try:
        await authorized_checkin_point(point1_id, req, session, None)
        assert False, "Should have failed with 401"
    except HTTPException as e:
        assert e.status_code == 401, f"Expected 401, got {e.status_code}"

    # 2. Invalid / malformed credentials MUST return 401
    try:
        await authorized_checkin_point(
            point1_id,
            req,
            session,
            HTTPAuthorizationCredentials(scheme="Bearer", credentials="invalid-token"),
        )
        assert False, "Should have failed with 401"
    except HTTPException as e:
        assert e.status_code == 401, f"Expected 401, got {e.status_code}"

    # 3. Expired scanner token MUST return 401
    expired_token = create_scanner_token(
        point1_id, event_id, jwt_secret, expires_delta=timedelta(seconds=-10)
    )
    try:
        await authorized_checkin_point(
            point1_id,
            req,
            session,
            HTTPAuthorizationCredentials(scheme="Bearer", credentials=expired_token),
        )
        assert False, "Should have failed with 401"
    except HTTPException as e:
        assert e.status_code == 401, f"Expected 401, got {e.status_code}"

    # 4. Standard attendee token (non-scanner role) MUST return 403
    attendee_token = create_access_token(uuid.uuid4(), jwt_secret)
    try:
        await authorized_checkin_point(
            point1_id,
            req,
            session,
            HTTPAuthorizationCredentials(scheme="Bearer", credentials=attendee_token),
        )
        assert False, "Should have failed with 403"
    except HTTPException as e:
        assert e.status_code == 403, f"Expected 403, got {e.status_code}"

    # 5. Cross-point token abuse (Scanner token for Point 1 used on Point 2) MUST return 403
    point1_token = create_scanner_token(point1_id, event_id, jwt_secret)
    try:
        await authorized_checkin_point(
            point2_id,
            req,
            session,
            HTTPAuthorizationCredentials(scheme="Bearer", credentials=point1_token),
        )
        assert False, "Should have failed with 403"
    except HTTPException as e:
        assert e.status_code == 403, f"Expected 403, got {e.status_code}"

    # 6. Cross-event token abuse (Scanner token for Event 1 used on Point of Event 2) MUST return 403
    try:
        await authorized_checkin_point(
            foreign_point_id,
            req,
            session,
            HTTPAuthorizationCredentials(scheme="Bearer", credentials=point1_token),
        )
        assert False, "Should have failed with 403"
    except HTTPException as e:
        assert e.status_code == 403, f"Expected 403, got {e.status_code}"

    # 7. Foreign Organizer API key MUST return 404 (tenant isolation preserved)
    try:
        await authorized_checkin_point(
            point1_id,
            req,
            session,
            HTTPAuthorizationCredentials(scheme="Bearer", credentials=foreign_org_key),
        )
        assert False, "Should have failed with 404"
    except HTTPException as e:
        assert e.status_code == 404, f"Expected 404, got {e.status_code}"

    # 8. Legitimate point scanner token MUST be authorized (returns point)
    res_point = await authorized_checkin_point(
        point1_id,
        req,
        session,
        HTTPAuthorizationCredentials(scheme="Bearer", credentials=point1_token),
    )
    assert res_point.id == point1_id

    # 9. Legitimate owning organizer API key MUST be authorized (returns point)
    res_org = await authorized_checkin_point(
        point1_id,
        req,
        session,
        HTTPAuthorizationCredentials(scheme="Bearer", credentials=org_key),
    )
    assert res_org.id == point1_id

    # 10. Non-existent CheckInPoint MUST return 404
    try:
        await authorized_checkin_point(
            uuid.uuid4(),
            req,
            session,
            HTTPAuthorizationCredentials(scheme="Bearer", credentials=point1_token),
        )
        assert False, "Should have failed with 404"
    except HTTPException as e:
        assert e.status_code == 404, f"Expected 404, got {e.status_code}"

    # 11. Revoked device token MUST return 401 Unauthorized
    revoked_token = create_scanner_token(
        point1_id, event_id, jwt_secret, device_id=revoked_device_id
    )
    try:
        await authorized_checkin_point(
            point1_id,
            req,
            session,
            HTTPAuthorizationCredentials(scheme="Bearer", credentials=revoked_token),
        )
        assert False, "Should have failed with 401"
    except HTTPException as e:
        assert e.status_code == 401, f"Expected 401, got {e.status_code}"
        assert "revoked" in e.detail.lower()

    # 12. Active registered device token MUST succeed (200)
    active_token = create_scanner_token(
        point1_id, event_id, jwt_secret, device_id=active_device_id
    )
    res_active = await authorized_checkin_point(
        point1_id,
        req,
        session,
        HTTPAuthorizationCredentials(scheme="Bearer", credentials=active_token),
    )
    assert res_active.id == point1_id

    print("ALL 12 SCANNER SECURITY CONTROLS VERIFIED SUCCESSFULLY.")

if __name__ == "__main__":
    asyncio.run(test_all_scanner_security_controls())

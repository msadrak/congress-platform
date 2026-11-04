import base64
import secrets
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

import jwt


def create_access_token(
    user_id: uuid.UUID, secret: str, session_version: int = 0, expires_delta: timedelta | None = None
) -> str:
    """An attendee session. `sv` is the account's session version: signing out or deleting the account
    increments it, which ends every token issued before (`user_token_session_ok`)."""
    now = datetime.now(timezone.utc)
    exp = now + (expires_delta or timedelta(days=7))
    payload = {
        "sub": str(user_id),
        "type": "user",
        "sv": session_version,
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
    }
    return jwt.encode(payload, secret, algorithm="HS256")


# User access tokens carried no "type" until late 2026. Untyped tokens are honoured only when issued before this
# instant, so sessions from before the change keep working until they expire (7 days) while no other kind of
# token, now or later, can pass for a user by leaving its type out. Delete the allowance after 2026-12-08.
LEGACY_UNTYPED_USER_TOKENS_UNTIL = int(datetime(2026, 12, 1, tzinfo=timezone.utc).timestamp())

# User access tokens carried no session version (`sv`) before migration 0030. A token without one is honoured
# only when issued before this instant AND while the account is still at version 0, i.e. has never signed out
# since: sessions from before the release keep working until they expire (7 days), and signing out ends them
# like any other. If the release ships after this date, move it to (release date + 1 day) so those sessions are
# not cut short; delete the allowance 8 days after it (planned: after 2027-01-08).
LEGACY_UNVERSIONED_USER_TOKENS_UNTIL = int(datetime(2027, 1, 1, tzinfo=timezone.utc).timestamp())


def is_user_token(payload: dict[str, Any]) -> bool:
    """True for a user access token: `type` is "user", or absent on a token issued before the cutoff above."""
    if "type" not in payload:
        issued_at = payload.get("iat")
        return type(issued_at) is int and issued_at < LEGACY_UNTYPED_USER_TOKENS_UNTIL
    token_type: object = payload["type"]
    return token_type == "user"


def user_token_session_ok(payload: dict[str, Any], session_version: int) -> bool:
    """True when a user token belongs to the account's current session version (see the cutoff above)."""
    if "sv" not in payload:
        issued_at = payload.get("iat")
        return (
            session_version == 0 and type(issued_at) is int and issued_at < LEGACY_UNVERSIONED_USER_TOKENS_UNTIL
        )
    token_version: object = payload["sv"]
    return type(token_version) is int and token_version == session_version


SIGNUP_TOKEN_MINUTES = 15


def create_signup_token(mobile: str, secret: str) -> str:
    """Proof that a mobile number was verified by SMS code, exchanged for a new account within 15 minutes.

    Its `type` keeps it from ever authenticating as a user, scanner or desk operator.
    """
    now = datetime.now(timezone.utc)
    payload = {
        "sub": f"signup:{mobile}",
        "type": "signup",
        "mobile": mobile,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=SIGNUP_TOKEN_MINUTES)).timestamp()),
    }
    return jwt.encode(payload, secret, algorithm="HS256")


def decode_access_token(token: str, secret: str) -> dict[str, Any] | None:
    try:
        data = jwt.decode(token, secret, algorithms=["HS256"])
        return data if isinstance(data, dict) else None
    except Exception:
        return None


# What a bearer credential is: "valid" (one of our tokens, usable now), "expired" (ours, past its `exp`), "unusable"
# (ours, refused for another reason, e.g. issued in the future by a skewed clock) or "foreign" (not signed by us: an
# organizer API key, or a guess).
TokenState = Literal["valid", "expired", "unusable", "foreign"]


def inspect_token(token: str, secret: str) -> tuple[TokenState, dict[str, Any] | None]:
    """Classify a bearer credential and return its claims (None for a foreign one).

    Only a foreign credential can be a guess: nobody can forge our signature, so a validly signed token that is
    merely expired or refused must never count toward a per-IP failure budget (a venue NAT would lock itself
    out with its own stale sessions)."""
    try:
        claims = jwt.decode(
            token, secret, algorithms=["HS256"], options={"verify_exp": False, "verify_iat": False, "verify_nbf": False}
        )
    except Exception:
        return "foreign", None
    if not isinstance(claims, dict):
        return "foreign", None
    payload = decode_access_token(token, secret)
    if payload is not None:
        return "valid", payload
    exp = claims.get("exp")
    if isinstance(exp, (int, float)) and exp <= time.time():
        return "expired", claims
    return "unusable", claims


def create_scanner_token(
    point_id: uuid.UUID,
    event_id: uuid.UUID,
    secret: str,
    device_id: uuid.UUID | None = None,
    expires_delta: timedelta | None = None,
) -> str:
    now = datetime.now(timezone.utc)
    exp = now + (expires_delta or timedelta(days=7))
    token_jti = str(device_id) if device_id else str(uuid.uuid4())
    payload = {
        "sub": f"scanner:{point_id}",
        "jti": token_jti,
        "type": "scanner",
        "point_id": str(point_id),
        "event_id": str(event_id),
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
    }
    return jwt.encode(payload, secret, algorithm="HS256")
def create_desk_operator_token(
    operator_id: uuid.UUID,
    event_id: uuid.UUID,
    user_id: uuid.UUID,
    session_version: int,
    secret: str,
    operator_name: str = "",
    expires_delta: timedelta | None = None,
) -> str:
    now = datetime.now(timezone.utc)
    exp = now + (expires_delta or timedelta(days=7))
    payload = {
        "sub": f"desk:{operator_id}",
        "type": "desk_operator",
        "operator_id": str(operator_id),
        "event_id": str(event_id),
        "user_id": str(user_id),
        "operator_name": operator_name,
        "session_version": session_version,
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
    }
    return jwt.encode(payload, secret, algorithm="HS256")
def generate_entity_qr_secret() -> str:
    """128-bit CSPRNG secret encoded as lower-case base32 string without padding."""
    random_bytes = secrets.token_bytes(16)  # 128 bits
    return base64.b32encode(random_bytes).decode("ascii").rstrip("=").lower()


def sanitize_csv_cell(value: Any) -> str:
    """Sanitize CSV cell against CSV Formula Injection (CWE-1236) and preserve Unicode."""
    if value is None:
        return ""
    val_str = str(value)
    if val_str and val_str[0] in ("=", "+", "-", "@", "\t", "\r"):
        return f"'{val_str}"
    return val_str


ORGANIZER_MEMBER_TOKEN_HOURS = 12
ORGANIZER_SELECT_TOKEN_MINUTES = 10


def create_organizer_member_token(
    member_id: uuid.UUID, organizer_id: uuid.UUID, session_version: int, secret: str
) -> str:
    """A console session of one organizer member (ADR 0016). Short-lived: it carries the member's role."""
    now = datetime.now(timezone.utc)
    payload = {
        "sub": f"member:{member_id}",
        "type": "organizer_member",
        "member_id": str(member_id),
        "organizer_id": str(organizer_id),
        "session_version": session_version,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=ORGANIZER_MEMBER_TOKEN_HOURS)).timestamp()),
    }
    return jwt.encode(payload, secret, algorithm="HS256")


def create_organizer_select_token(user_id: uuid.UUID, secret: str) -> str:
    """Proof of a verified SMS code for a person who belongs to several organizers, exchanged for a session
    with the organizer they pick, once. Its `type` keeps it from authenticating anywhere else."""
    now = datetime.now(timezone.utc)
    payload = {
        "sub": f"organizer-select:{user_id}",
        "type": "organizer_select",
        "user_id": str(user_id),
        "jti": uuid.uuid4().hex,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=ORGANIZER_SELECT_TOKEN_MINUTES)).timestamp()),
    }
    return jwt.encode(payload, secret, algorithm="HS256")

import base64
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt


def create_access_token(
    user_id: uuid.UUID, secret: str, expires_delta: timedelta | None = None
) -> str:
    now = datetime.now(timezone.utc)
    exp = now + (expires_delta or timedelta(days=7))
    payload = {
        "sub": str(user_id),
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
    }
    return jwt.encode(payload, secret, algorithm="HS256")


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

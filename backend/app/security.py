import base64
import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    iterations = 100_000
    derived = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    salt_b64 = base64.b64encode(salt).decode("ascii")
    derived_b64 = base64.b64encode(derived).decode("ascii")
    return f"pbkdf2_sha256${iterations}${salt_b64}${derived_b64}"


def verify_password(plain: str, hashed: str) -> bool:
    try:
        scheme, iterations_str, salt_b64, derived_b64 = hashed.split("$")
        if scheme != "pbkdf2_sha256":
            return False
        iterations = int(iterations_str)
        salt = base64.b64decode(salt_b64.encode("ascii"))
        expected_derived = base64.b64decode(derived_b64.encode("ascii"))
        actual_derived = hashlib.pbkdf2_hmac(
            "sha256", plain.encode("utf-8"), salt, iterations
        )
        return secrets.compare_digest(expected_derived, actual_derived)
    except Exception:
        return False


def create_access_token(
    user_id: uuid.UUID, email: str, secret: str, expires_delta: timedelta | None = None
) -> str:
    now = datetime.now(timezone.utc)
    exp = now + (expires_delta or timedelta(days=7))
    payload = {
        "sub": str(user_id),
        "email": email,
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
    }
    return jwt.encode(payload, secret, algorithm="HS256")


def decode_access_token(token: str, secret: str) -> dict[str, Any] | None:
    try:
        data = jwt.decode(token, secret, algorithms=["HS256"])
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def generate_entity_qr_secret() -> str:
    """128-bit CSPRNG secret encoded as lower-case base32 string without padding."""
    random_bytes = secrets.token_bytes(16)  # 128 bits
    return base64.b32encode(random_bytes).decode("ascii").rstrip("=").lower()

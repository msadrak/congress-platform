"""Encryption at rest for third-party credentials kept in the database (the sms.ir API key).

AES-256-GCM, so a database dump or an off-host backup alone does not reveal the credential. The key is derived
from CONGRESS_SECRET_BOX_KEY when it is set, otherwise from the JWT secret. Values sealed with the JWT secret
before the dedicated key was set still open (and are sealed again with the dedicated key on the next save), so
setting it needs no migration; once nothing depends on the old derivation, rotating CONGRESS_JWT_SECRET no
longer touches stored credentials. Losing the key that sealed a value makes it unreadable; the platform console
then reports it as unreadable and asks for it again.
"""

import base64
import hashlib
import os

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.config import Settings

_CONTEXT = b"congress-platform-settings/v1"


def _key(secret: str) -> bytes:
    return hashlib.sha256(_CONTEXT + secret.encode()).digest()


def sealing_secret(settings: Settings) -> str:
    """The secret new values are sealed with."""
    return settings.secret_box_key or settings.jwt_secret


def opening_secrets(settings: Settings) -> tuple[str, ...]:
    """Secrets a stored value may have been sealed with, the current one first."""
    return (settings.secret_box_key, settings.jwt_secret) if settings.secret_box_key else (settings.jwt_secret,)


def seal(secret: str, plaintext: str) -> str:
    nonce = os.urandom(12)
    sealed = AESGCM(_key(secret)).encrypt(nonce, plaintext.encode(), _CONTEXT)
    return base64.urlsafe_b64encode(nonce + sealed).decode("ascii")


def open_sealed(token: str, *secrets: str) -> str | None:
    """The plaintext, using the first of `secrets` that opens it; None when the token is damaged or was sealed
    with none of them."""
    try:
        raw = base64.urlsafe_b64decode(token.encode("ascii"))
    except ValueError:
        return None
    for secret in secrets:
        try:
            return AESGCM(_key(secret)).decrypt(raw[:12], raw[12:], _CONTEXT).decode()
        except (InvalidTag, ValueError):
            continue
    return None

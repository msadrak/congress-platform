"""Encryption at rest for third-party credentials kept in the database (the sms.ir API key).

AES-256-GCM with a key derived from the JWT secret, so a database dump or an off-host backup alone does not
reveal the credential. Rotating CONGRESS_JWT_SECRET makes stored credentials unreadable; the platform console
then reports them as unreadable and asks for them again.
"""

import base64
import hashlib
import os

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

_CONTEXT = b"congress-platform-settings/v1"


def _key(secret: str) -> bytes:
    return hashlib.sha256(_CONTEXT + secret.encode()).digest()


def seal(secret: str, plaintext: str) -> str:
    nonce = os.urandom(12)
    sealed = AESGCM(_key(secret)).encrypt(nonce, plaintext.encode(), _CONTEXT)
    return base64.urlsafe_b64encode(nonce + sealed).decode("ascii")


def open_sealed(secret: str, token: str) -> str | None:
    """The plaintext, or None when the token is damaged or was sealed with another secret."""
    try:
        raw = base64.urlsafe_b64decode(token.encode("ascii"))
        return AESGCM(_key(secret)).decrypt(raw[:12], raw[12:], _CONTEXT).decode()
    except (InvalidTag, ValueError):
        return None

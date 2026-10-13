from pathlib import Path
from typing import Any, Literal

from pydantic import Field, ValidationError, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

Environment = Literal["development", "test", "staging", "production"]

# Deployed environments: every secret, the database and the media volume must be given explicitly.
STRICT_ENVIRONMENTS: frozenset[str] = frozenset({"staging", "production"})

# Only local development and the test suite may fall back to these.
DEV_DATABASE_URL = "postgresql+asyncpg://congress:congress@127.0.0.1:5433/congress"
DEV_MEDIA_ROOT = Path(__file__).resolve().parent.parent / "var" / "media"

MIN_ADMIN_TOKEN_LENGTH = 32

DISALLOWED_JWT_SECRETS = {
    "congress-dev-secret-jwt-key-minimum-32-bytes-length-required-for-sha256",
    "change-me-in-production",
    "change-me-to-a-secure-secret-minimum-32-bytes-in-production",
    "provide-a-secure-random-secret-key-at-least-32-chars-long",
    "secret",
    "your-secret-key-here",
    "01234567890123456789012345678901",
}
# Fragments that only appear in documentation placeholders, never in generated secrets.
PLACEHOLDER_MARKERS = ("<generate", "change-me", "changeme", "replace-me", "provide-a-", "your-secret", "placeholder")


def _is_placeholder(value: str) -> bool:
    lowered = value.strip().lower()
    return lowered in DISALLOWED_JWT_SECRETS or any(m in lowered for m in PLACEHOLDER_MARKERS)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="CONGRESS_", env_file=".env")

    # Unset means production: a deployment that forgets to say what it is gets the strict checks.
    environment: Environment = "production"
    database_url: str
    # Credential for provisioning Organizers. Deliberately has no default.
    platform_admin_token: str
    # Secure signing secret for HS256 JWTs. Deliberately has no default.
    jwt_secret: str
    cors_origins: list[str] = ["http://localhost:5173"]
    # Uploaded Page Studio images. Must be a durable volume (or mount) outside the application image.
    media_root: Path
    # Absolute origin visitors use (e.g. https://congress.example.org); used for canonical/og URLs.
    public_origin: str | None = None
    media_max_bytes: int = Field(default=5 * 1024 * 1024, gt=0, le=20 * 1024 * 1024)

    @model_validator(mode="before")
    @classmethod
    def _environment_defaults(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        environment = str(data.get("environment") or "production").strip().lower()
        if environment in STRICT_ENVIRONMENTS:
            missing = [
                f"CONGRESS_{name.upper()}"
                for name in ("database_url", "media_root")
                if not str(data.get(name) or "").strip()
            ]
            if missing:
                raise ValueError(
                    f"{', '.join(missing)} must be set explicitly when CONGRESS_ENVIRONMENT={environment}; "
                    "development defaults are refused outside development and test."
                )
            return data
        data = dict(data)
        if not str(data.get("database_url") or "").strip():
            data["database_url"] = DEV_DATABASE_URL
        if not str(data.get("media_root") or "").strip():
            data["media_root"] = DEV_MEDIA_ROOT
        return data

    @field_validator("jwt_secret")
    @classmethod
    def validate_jwt_secret(cls, v: str) -> str:
        trimmed = v.strip()
        if _is_placeholder(trimmed):
            raise ValueError(
                "CONGRESS_JWT_SECRET cannot use an insecure default or development placeholder value."
            )
        if len(trimmed) < 32:
            raise ValueError(
                "CONGRESS_JWT_SECRET must be at least 32 characters (256 bits) for secure HS256 signing."
            )
        return trimmed

    @field_validator("platform_admin_token")
    @classmethod
    def validate_admin_token_present(cls, v: str) -> str:
        trimmed = v.strip()
        if not trimmed:
            raise ValueError("CONGRESS_PLATFORM_ADMIN_TOKEN must not be empty.")
        return trimmed

    @model_validator(mode="after")
    def _strict_secrets(self) -> "Settings":
        if self.environment not in STRICT_ENVIRONMENTS:
            return self
        token = self.platform_admin_token
        if len(token) < MIN_ADMIN_TOKEN_LENGTH or _is_placeholder(token):
            raise ValueError(
                f"CONGRESS_PLATFORM_ADMIN_TOKEN must be a generated secret of at least "
                f"{MIN_ADMIN_TOKEN_LENGTH} characters when CONGRESS_ENVIRONMENT={self.environment} "
                "(for example: python -c \"import secrets; print(secrets.token_urlsafe(32))\")."
            )
        if not self.media_root.is_absolute():
            raise ValueError(
                "CONGRESS_MEDIA_ROOT must be an absolute path to a durable volume when "
                f"CONGRESS_ENVIRONMENT={self.environment}."
            )
        return self


def describe_settings_error(error: ValidationError) -> str:
    """Operator-facing summary naming the environment variables; never echoes submitted values."""
    lines = []
    for item in error.errors(include_input=False, include_url=False):
        field = ".".join(str(part) for part in item["loc"])
        name = f"CONGRESS_{field.upper()}" if field else "configuration"
        message = item["msg"].removeprefix("Value error, ")
        lines.append(f"  - {name}: {message}" if field else f"  - {message}")
    return "Invalid Congress Platform configuration:\n" + "\n".join(lines)

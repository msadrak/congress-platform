from pathlib import Path
from typing import Any, Literal
from urllib.parse import urlsplit

from pydantic import Field, ValidationError, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

Environment = Literal["development", "test", "staging", "production"]
# smsir: real delivery through sms.ir. console: nothing is sent, messages are kept in memory (development,
# automated staging checks, tests); refused in production.
SmsProviderName = Literal["smsir", "console"]

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
    # Encrypts credentials stored in the database (app/secret_box.py). Optional: without it they are sealed with
    # a key derived from the JWT secret, which values sealed that way keep opening with.
    secret_box_key: str = ""
    cors_origins: list[str] = ["http://localhost:5173"]
    # Uploaded Page Studio images. Must be a durable volume (or mount) outside the application image.
    media_root: Path
    # Throttle repeated failed sign-ins / admin-token / API-key attempts (see app/rate_limit.py).
    auth_rate_limits_enabled: bool = True
    # Absolute origin visitors use (e.g. https://congress.example.org); used for canonical/og URLs.
    public_origin: str | None = None
    # Origin of the short pass links in SMS (`{origin}/t/{code}`, ADR 0015), e.g. a shorter domain served by this
    # deployment; unset means public_origin. An https origin without a path in staging/production.
    short_link_origin: str | None = None
    media_max_bytes: int = Field(default=5 * 1024 * 1024, gt=0, le=20 * 1024 * 1024)

    # Database connections, per API process (app/db.py). Up to pool_size + max_overflow connections are open at
    # once; a request waits at most pool_timeout seconds for one, then fails instead of queueing forever. Keep
    # (pool_size + max_overflow) x API processes below PostgreSQL's max_connections.
    db_pool_size: int = Field(default=10, ge=1, le=100)
    db_max_overflow: int = Field(default=10, ge=0, le=100)
    db_pool_timeout_seconds: float = Field(default=10.0, gt=0, le=120)
    # Test each pooled connection before use, so a restarted database does not fail the next requests.
    db_pool_pre_ping: bool = True
    # PostgreSQL cancels any statement of the API running longer than this (statement_timeout); 0 = no limit.
    db_statement_timeout_ms: int = Field(default=15_000, ge=0, le=600_000)

    # SMS (sign-in codes and ticket confirmations). Defaults to smsir in staging/production, console elsewhere.
    sms_provider: SmsProviderName = "console"
    smsir_api_key: str = ""
    # The sms.ir service line (خط خدماتی) messages are sent from. The wording is the app's own templates.
    smsir_line_number: int | None = Field(default=None, gt=0)
    smsir_timeout_seconds: float = Field(default=10.0, gt=0, le=60)
    otp_length: int = Field(default=6, ge=4, le=8)
    otp_ttl_seconds: int = Field(default=120, ge=60, le=600)
    # SMS send limits: codes cost money and reach a real phone. A congress venue puts many people behind one IP.
    otp_resend_cooldown_seconds: int = Field(default=60, ge=0, le=600)
    otp_sends_per_mobile_per_hour: int = Field(default=5, ge=1)
    otp_sends_per_ip_per_hour: int = Field(default=100, ge=1)
    # Background delivery of queued SMS (ticket confirmations); the test suite drives it explicitly.
    sms_outbox_enabled: bool = True
    sms_outbox_poll_seconds: float = Field(default=5.0, gt=0, le=300)
    # Data retention (app/retention.py): used/expired sign-in codes and the text of sent SMS are removed.
    retention_enabled: bool = True
    retention_interval_seconds: float = Field(default=3600.0, gt=0, le=86_400)
    otp_retention_hours: int = Field(default=24, ge=1)
    sms_body_retention_days: int = Field(default=30, ge=1)

    # ── Operations: logs, metrics, error reporting (app/logging_setup.py, app/observability.py) ──
    # json = one object per line (log shippers), text = human-readable. Unset: json in staging/production.
    log_format: Literal["json", "text"] | None = None
    # Bearer token a Prometheus scraper presents to /api/metrics. Unset: the endpoint answers 404.
    metrics_token: str = ""
    # Sentry or GlitchTip DSN. Unset: no error reporting. Events carry no personal data (see observability.py).
    sentry_dsn: str = ""

    @property
    def effective_log_format(self) -> Literal["json", "text"]:
        if self.log_format is not None:
            return self.log_format
        return "json" if self.environment in STRICT_ENVIRONMENTS else "text"

    @field_validator("log_format", mode="before")
    @classmethod
    def _blank_log_format_is_unset(cls, v: Any) -> Any:
        return None if isinstance(v, str) and not v.strip() else v

    @model_validator(mode="after")
    def _operations_secrets(self) -> "Settings":
        token = self.metrics_token.strip()
        if token and self.environment in STRICT_ENVIRONMENTS and (
            len(token) < MIN_ADMIN_TOKEN_LENGTH or _is_placeholder(token)
        ):
            raise ValueError(
                f"CONGRESS_METRICS_TOKEN must be a generated secret of at least {MIN_ADMIN_TOKEN_LENGTH} "
                f"characters when CONGRESS_ENVIRONMENT={self.environment}, or empty to disable /api/metrics."
            )
        return self

    @model_validator(mode="before")
    @classmethod
    def _environment_defaults(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        environment = str(data.get("environment") or "production").strip().lower()
        if not str(data.get("sms_provider") or "").strip():
            data = dict(data)
            data["sms_provider"] = "smsir" if environment in STRICT_ENVIRONMENTS else "console"
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

    @field_validator("smsir_line_number", mode="before")
    @classmethod
    def _blank_line_is_unset(cls, v: Any) -> Any:
        # Compose passes an unset optional variable as an empty string.
        return None if isinstance(v, str) and not v.strip() else v

    @field_validator("short_link_origin", mode="before")
    @classmethod
    def _short_link_origin_shape(cls, v: Any) -> Any:
        if v is None or (isinstance(v, str) and not v.strip()):
            return None  # Compose passes an unset optional variable as an empty string.
        if not isinstance(v, str):
            return v
        origin = v.strip().rstrip("/")
        parts = urlsplit(origin)
        if parts.scheme not in ("http", "https") or not parts.netloc or parts.path or parts.query or parts.fragment:
            raise ValueError(
                "CONGRESS_SHORT_LINK_ORIGIN must be an origin such as https://cngr.example (no path or query)."
            )
        return origin

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

    @field_validator("secret_box_key")
    @classmethod
    def validate_secret_box_key(cls, v: str) -> str:
        trimmed = v.strip()
        if trimmed and (_is_placeholder(trimmed) or len(trimmed) < 32):
            raise ValueError(
                "CONGRESS_SECRET_BOX_KEY, when set, must be a generated secret of at least 32 characters "
                "(for example: python -c \"import secrets; print(secrets.token_hex(32))\")."
            )
        return trimmed

    @model_validator(mode="after")
    def _distinct_secret_box_key(self) -> "Settings":
        if self.secret_box_key and self.secret_box_key == self.jwt_secret:
            raise ValueError("CONGRESS_SECRET_BOX_KEY must differ from CONGRESS_JWT_SECRET.")
        return self

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
        if self.short_link_origin and not self.short_link_origin.startswith("https://"):
            raise ValueError(
                f"CONGRESS_SHORT_LINK_ORIGIN must use https when CONGRESS_ENVIRONMENT={self.environment}."
            )
        if not self.media_root.is_absolute():
            raise ValueError(
                "CONGRESS_MEDIA_ROOT must be an absolute path to a durable volume when "
                f"CONGRESS_ENVIRONMENT={self.environment}."
            )
        return self

    @model_validator(mode="after")
    def _sms_configuration(self) -> "Settings":
        # The sms.ir key and line may also be set later in the platform console; a key given here must be real.
        key = self.smsir_api_key.strip()
        if key and _is_placeholder(key):
            raise ValueError("CONGRESS_SMSIR_API_KEY must be the API key from the sms.ir panel, not a placeholder.")
        if self.environment == "production":
            if self.sms_provider != "smsir":
                raise ValueError(
                    "CONGRESS_SMS_PROVIDER must be smsir in production; the console provider sends nothing."
                )
            if not (self.public_origin or "").strip():
                raise ValueError(
                    "CONGRESS_PUBLIC_ORIGIN must be set in production: SMS messages link attendees to their pass."
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

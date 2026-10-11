from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DISALLOWED_JWT_SECRETS = {
    "congress-dev-secret-jwt-key-minimum-32-bytes-length-required-for-sha256",
    "change-me-in-production",
    "change-me-to-a-secure-secret-minimum-32-bytes-in-production",
    "secret",
    "your-secret-key-here",
    "01234567890123456789012345678901",
}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="CONGRESS_", env_file=".env")

    database_url: str = "postgresql+asyncpg://congress:congress@127.0.0.1:5433/congress"
    # Credential for provisioning Organizers. Deliberately has no default.
    platform_admin_token: str
    # Secure signing secret for HS256 JWTs. Deliberately has no default.
    jwt_secret: str
    cors_origins: list[str] = ["http://localhost:5173"]

    @field_validator("jwt_secret")
    @classmethod
    def validate_jwt_secret(cls, v: str) -> str:
        trimmed = v.strip()
        if trimmed.lower() in DISALLOWED_JWT_SECRETS or "change-me" in trimmed.lower():
            raise ValueError(
                "CONGRESS_JWT_SECRET cannot use an insecure default or development placeholder value."
            )
        if len(trimmed) < 32:
            raise ValueError(
                "CONGRESS_JWT_SECRET must be at least 32 characters (256 bits) for secure HS256 signing."
            )
        return trimmed

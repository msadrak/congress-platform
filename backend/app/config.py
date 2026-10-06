from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="CONGRESS_", env_file=".env")

    database_url: str = "postgresql+asyncpg://congress:congress@localhost:5433/congress"
    # Credential for provisioning Organizers. Deliberately has no default.
    platform_admin_token: str
    jwt_secret: str = "congress-dev-secret-jwt-key-minimum-32-bytes-length-required-for-sha256"
    cors_origins: list[str] = ["http://localhost:5173"]

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="CONGRESS_", env_file=".env")

    database_url: str = "postgresql+asyncpg://congress:congress@localhost:5433/congress"
    # Credential for provisioning Organizers. Deliberately has no default.
    platform_admin_token: str
    cors_origins: list[str] = ["http://localhost:5173"]

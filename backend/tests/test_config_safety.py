"""Deployed environments refuse weak or implicit configuration; local development keeps working."""

from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError

from app.config import DEV_DATABASE_URL, Settings, describe_settings_error
from app.main import create_app, create_app_from_env

STRONG_TOKEN = "q8F3vKz1Lr9XwT2bN5mY7pC0dH4jS6aG"
STRONG_JWT = "9b1f0e8c7d6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c"
DB_URL = "postgresql+asyncpg://congress:s3cret@db:5432/congress"
SMSIR_KEY = "Zx9Lr2Kq7Wm4Pv1Tn8Hb3Gd6Fs5Ja0Ce"


@pytest.fixture(autouse=True)
def no_ambient_configuration(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in (
        "CONGRESS_ENVIRONMENT", "CONGRESS_DATABASE_URL", "CONGRESS_MEDIA_ROOT",
        "CONGRESS_PLATFORM_ADMIN_TOKEN", "CONGRESS_JWT_SECRET", "CONGRESS_PUBLIC_ORIGIN",
        "CONGRESS_SMS_PROVIDER", "CONGRESS_SMSIR_API_KEY", "CONGRESS_SMSIR_LINE_NUMBER", "CONGRESS_SECRET_BOX_KEY",
    ):
        monkeypatch.delenv(name, raising=False)


def production(**overrides: object) -> Settings:
    values: dict[str, object] = {
        "environment": "production",
        "database_url": DB_URL,
        "platform_admin_token": STRONG_TOKEN,
        "jwt_secret": STRONG_JWT,
        "media_root": Path("/srv/congress/media").resolve(),
        "public_origin": "https://congress.example.org",
        "smsir_api_key": SMSIR_KEY,
        "smsir_line_number": 30001234,
    }
    values.update(overrides)
    return Settings(**values)  # type: ignore[arg-type]


def test_production_accepts_explicit_strong_configuration() -> None:
    settings = production()
    assert settings.database_url == DB_URL
    assert settings.platform_admin_token == STRONG_TOKEN


@pytest.mark.parametrize("environment", ["staging", "production"])
def test_deployed_environments_require_an_explicit_database_url(environment: str) -> None:
    with pytest.raises(ValidationError) as exc:
        production(environment=environment, database_url=None)
    assert "CONGRESS_DATABASE_URL must be set explicitly" in str(exc.value)


def test_production_requires_an_explicit_media_root() -> None:
    with pytest.raises(ValidationError) as exc:
        production(media_root=None)
    assert "CONGRESS_MEDIA_ROOT" in str(exc.value)


@pytest.mark.parametrize(
    "token", ["change-me-in-production", "dev", "x" * 31, "please-change-me-before-going-live-000000"]
)
def test_production_rejects_placeholder_or_short_admin_tokens(token: str) -> None:
    with pytest.raises(ValidationError) as exc:
        production(platform_admin_token=token)
    assert "CONGRESS_PLATFORM_ADMIN_TOKEN must be a generated secret" in str(exc.value)


def test_the_documented_example_jwt_secret_is_refused_everywhere() -> None:
    example = "provide-a-secure-random-secret-key-at-least-32-chars-long"
    for environment in ("development", "production"):
        with pytest.raises(ValidationError):
            production(environment=environment, jwt_secret=example)


@pytest.mark.parametrize("environment", ["development", "staging", "production"])
async def test_interactive_api_docs_and_schema_are_not_served_in_production(environment: str) -> None:
    app = create_app(production(environment=environment))
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        statuses = {path: (await client.get(path)).status_code for path in ("/docs", "/redoc", "/openapi.json")}
    expected = 404 if environment == "production" else 200
    assert statuses == dict.fromkeys(("/docs", "/redoc", "/openapi.json"), expected)
    assert app.openapi()["paths"]  # the schema export (scripts/gen-api.mjs) still reads it in-process


def test_unset_environment_is_treated_as_production() -> None:
    with pytest.raises(ValidationError) as exc:
        Settings(platform_admin_token="dev", jwt_secret=STRONG_JWT)
    assert "CONGRESS_DATABASE_URL" in str(exc.value)


def test_development_keeps_local_defaults() -> None:
    settings = Settings(environment="development", platform_admin_token="dev", jwt_secret=STRONG_JWT)
    assert settings.database_url == DEV_DATABASE_URL
    assert settings.media_root.name == "media"


def test_startup_error_names_variables_without_echoing_secrets(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CONGRESS_ENVIRONMENT", "production")
    monkeypatch.setenv("CONGRESS_DATABASE_URL", DB_URL)
    monkeypatch.setenv("CONGRESS_MEDIA_ROOT", str(Path("/srv/media").resolve()))
    monkeypatch.setenv("CONGRESS_PLATFORM_ADMIN_TOKEN", "change-me-in-production")
    monkeypatch.setenv("CONGRESS_JWT_SECRET", STRONG_JWT)
    monkeypatch.setenv("CONGRESS_SMSIR_API_KEY", SMSIR_KEY)
    with pytest.raises(SystemExit) as exc:
        create_app_from_env()
    message = str(exc.value)
    assert "Invalid Congress Platform configuration" in message
    assert "CONGRESS_PLATFORM_ADMIN_TOKEN" in message
    assert STRONG_JWT not in message
    assert SMSIR_KEY not in message


def test_error_summary_does_not_include_submitted_values() -> None:
    with pytest.raises(ValidationError) as exc:
        production(jwt_secret="short-but-secret-value")
    summary = describe_settings_error(exc.value)
    assert "CONGRESS_JWT_SECRET" in summary
    assert "short-but-secret-value" not in summary


def test_production_sends_real_sms_through_smsir() -> None:
    settings = production()
    assert settings.sms_provider == "smsir"
    with pytest.raises(ValidationError) as exc:
        production(sms_provider="console")
    assert "CONGRESS_SMS_PROVIDER must be smsir in production" in str(exc.value)


SECRET_BOX_KEY = "7c2e9a4f1b8d3e6a0c5f2b9e4d7a1c8f3e6b0d5a"


def test_the_secret_box_key_is_optional_but_must_be_a_distinct_generated_secret() -> None:
    assert production().secret_box_key == ""
    assert production(secret_box_key=f"  {SECRET_BOX_KEY} ").secret_box_key == SECRET_BOX_KEY
    for weak in ("too-short-secret", "<generate: python -c ...>" + "x" * 32, STRONG_JWT):
        with pytest.raises(ValidationError) as exc:
            production(secret_box_key=weak)
        summary = describe_settings_error(exc.value)
        assert "CONGRESS_SECRET_BOX_KEY" in summary and weak not in summary


@pytest.mark.parametrize("key", ["<generate in the sms.ir panel>", "replace-me"])
def test_a_placeholder_smsir_api_key_is_refused(key: str) -> None:
    with pytest.raises(ValidationError) as exc:
        production(smsir_api_key=key)
    assert "CONGRESS_SMSIR_API_KEY" in str(exc.value)
    assert SMSIR_KEY not in describe_settings_error(exc.value)


def test_production_may_start_before_sms_is_configured_in_the_platform_console() -> None:
    settings = production(smsir_api_key="", smsir_line_number=None)
    assert settings.sms_provider == "smsir" and settings.smsir_line_number is None


def test_production_requires_the_public_origin_for_pass_links() -> None:
    with pytest.raises(ValidationError) as exc:
        production(public_origin=None)
    assert "CONGRESS_PUBLIC_ORIGIN" in str(exc.value)


def test_staging_defaults_to_smsir_but_may_opt_into_the_console_provider() -> None:
    assert production(environment="staging").sms_provider == "smsir"
    settings = production(environment="staging", sms_provider="console", smsir_api_key="")
    assert settings.sms_provider == "console"


def test_development_sends_nothing_by_default() -> None:
    settings = Settings(environment="development", platform_admin_token="dev", jwt_secret=STRONG_JWT)
    assert settings.sms_provider == "console"


def test_a_blank_line_number_from_compose_counts_as_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CONGRESS_SMSIR_LINE_NUMBER", " ")
    settings = Settings(environment="staging", database_url=DB_URL, platform_admin_token=STRONG_TOKEN,
                        jwt_secret=STRONG_JWT, media_root=Path("/srv/media").resolve(), sms_provider="console")
    assert settings.smsir_line_number is None

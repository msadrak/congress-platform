# AGENTS.md

## Project layout & entry points

- **`backend/`**: FastAPI (Python 3.11+) asynchronous ASGI backend with SQLAlchemy 2.0 (asyncpg), Alembic migrations, and PostgreSQL.
  - Run dev server: `CONGRESS_PLATFORM_ADMIN_TOKEN=dev uv run uvicorn app.main:create_app_from_env --factory --port 8000`
  - Run tests: `uv run pytest`
  - Run typecheck: `uv run mypy`
- **`web/`**: React 19 + TypeScript + Vite SPA & PWA frontend with Tailwind CSS.
  - Run dev server: `npm run dev`
  - Run unit tests: `npm test`
  - Run typecheck & build: `npm run build`
- **`mobile/`**: Native Flutter / Dart mobile scanner application (iOS/Android) with local SQLite and Google ML Kit camera detection.
  - Run tests: `dart test`
  - Run static analysis: `dart analyze`
  - *(Dart binary on Windows is located at `%LOCALAPPDATA%\Microsoft\WinGet\Packages\Google.DartSDK_...\dart-sdk\bin\dart.exe`)*

## Verification guardrail

Before marking any task complete, run the unified full-stack verification script:
- Linux / macOS / Git Bash: `./scripts/check.sh`
- Windows CMD / PowerShell: `scripts\check.bat`

## Coding standards

Enforced standards for TypeScript, Python, and Dart live in `docs/CODING_STANDARDS.md`.

## Agent skills

### Issue tracker

Issues and specs for this repo live as GitHub issues. Use the `gh` CLI for all operations. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical five-role triage labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context repo layout (`GLOSSARY.md` and `docs/adr/` at the repo root). See `docs/agents/domain.md`.

# AGENTS.md

## Project layout & entry points

- **`backend/`**: FastAPI (Python 3.11+) asynchronous ASGI backend with SQLAlchemy 2.0 (asyncpg), Alembic migrations, and PostgreSQL.
  - Run dev server: `CONGRESS_ENVIRONMENT=development CONGRESS_PLATFORM_ADMIN_TOKEN=dev CONGRESS_JWT_SECRET=<32+ random chars> uv run uvicorn app.main:create_app_from_env --factory --port 8000` (an unset `CONGRESS_ENVIRONMENT` means `production`, which requires explicit `CONGRESS_DATABASE_URL`, `CONGRESS_MEDIA_ROOT` and a generated 32+ character admin token)
  - Run tests: `uv run pytest` (only ever targets a marked `*_test` database), or on disposable Docker infrastructure: `node scripts/integration/backend-tests.mjs`
  - Run typecheck: `uv run mypy`
  - After changing a route or a request/response model: `cd web && npm run gen:api` (CI fails when `web/src/api/schema.d.ts` is stale)
- **`web/`**: React 19 + TypeScript + Vite SPA & PWA frontend with Tailwind CSS.
  - Run dev server: `npm run dev`
  - Run unit tests: `npm test`
  - Run lint: `npm run lint` (warnings fail)
  - Run typecheck & build: `npm run build`
- **`mobile/`**: Native Flutter / Dart mobile scanner application (iOS/Android) with local SQLite and Google ML Kit camera detection.
  - Run tests: `dart test`
  - Run static analysis: `dart analyze`
  - *(Dart binary on Windows is located at `%LOCALAPPDATA%\Microsoft\WinGet\Packages\Google.DartSDK_...\dart-sdk\bin\dart.exe`)*

## Web routes

Defined in `web/src/App.tsx`; the portal-by-URL table is in `docs/deployment/STAGING_OPERATIONS.md` (Portals). Public pages (`/e/:slug…`) return 404 until the event's Page Studio page is first published.

## Verification guardrail

Before marking any task complete, run the unified full-stack verification script:
- Linux / macOS / Git Bash: `./scripts/check.sh`
- Windows CMD / PowerShell: `scripts\check.bat`

To install as a git pre-commit hook:
```bash
cp scripts/check.sh .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit
```

## Coding standards

Enforced standards for TypeScript, Python, and Dart live in `docs/CODING_STANDARDS.md`.

## Agent skills

### Issue tracker

Issues and specs for this repo live as GitHub issues. Use the `gh` CLI for all operations. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical five-role triage labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context repo layout (`GLOSSARY.md` and `docs/adr/` at the repo root). See `docs/agents/domain.md`.

# AGENTS.md

## Project layout & entry points

- **`backend/`**: FastAPI (Python 3.11+) asynchronous ASGI backend with SQLAlchemy 2.0 (asyncpg), Alembic migrations, and PostgreSQL.
  - Run dev server: `CONGRESS_ENVIRONMENT=development CONGRESS_PLATFORM_ADMIN_TOKEN=dev CONGRESS_JWT_SECRET=<32+ random chars> uv run uvicorn app.main:create_app_from_env --factory --port 8000` (an unset `CONGRESS_ENVIRONMENT` means `production`, which requires explicit `CONGRESS_DATABASE_URL`, `CONGRESS_MEDIA_ROOT` and a generated 32+ character admin token)
  - Run tests: `uv run pytest` (only ever targets a marked `*_test` database), or on disposable Docker infrastructure: `node scripts/integration/backend-tests.mjs` (needs only Docker: it builds its own test image on first use; see `docs/CODING_STANDARDS.md` §4)
  - Run typecheck: `uv run mypy`
  - After changing a route or a request/response model: `cd web && npm run gen:api` (CI fails when `web/src/api/schema.d.ts` is stale)
  - Errors a client reacts to are coded: `ApiError(status, "UPPER_SNAKE_CODE", "English message")` with `error_responses(...)` on the route, and a fa/en entry in `web/src/lib/errorMessages.ts` (`docs/CODING_STANDARDS.md` §2.F)
  - SMS (sign-in codes, ticket confirmations; ADR 0012): `development`/`test` use the `console` provider, so nothing is sent and codes are printed in the API log; staging/production default to `smsir`; the sms.ir key and service line come from `CONGRESS_SMSIR_API_KEY`/`CONGRESS_SMSIR_LINE_NUMBER` or the platform console (`/platform`, ADR 0013), which overrides the environment at run time. The confirmation SMS carries a short link (`/t/{code}`, ADR 0015) that opens the ticket's pass read-only without a sign-in code
- **`web/`**: React 19 + TypeScript + Vite SPA & PWA frontend with Tailwind CSS.
  - Run dev server: `npm run dev`
  - Run unit tests: `npm test`
  - Run lint: `npm run lint` (warnings fail)
  - Run typecheck & build: `npm run build`
  - Run browser specs (`web/e2e`, Playwright): `npx playwright test` against a server on `127.0.0.1:4174`; `CONGRESS_E2E_PREVIEW=1` serves the production build itself (run `npm run build` first). The browser is Edge unless `CONGRESS_BROWSER_CHANNEL=chromium` (Playwright's own, as in CI; `npx playwright install chromium`) or `chrome`; the same variable applies to `scripts/integration/*.mjs`
  - The gate scanner is this PWA at `/scan/:pointId`
- **`mobile/`**: **Parked** (see `mobile/README.md`). A pure-Dart package holding the scanner's offline policy engine, sync client and in-memory storage, with tests. It is not a Flutter app: no Flutter SDK, camera, ML Kit, SQLite or platform projects, and `lib/main.dart` / `lib/screens/` do not compile.
  - Run tests: `dart test`
  - Run static analysis: `dart analyze lib/models lib/services test`
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

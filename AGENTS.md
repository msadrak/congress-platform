# AGENTS.md

## Project layout & entry points

- **`backend/`**: FastAPI (Python 3.11+) asynchronous ASGI backend with SQLAlchemy 2.0 (asyncpg), Alembic migrations, and PostgreSQL.
  - Run dev server: `CONGRESS_ENVIRONMENT=development CONGRESS_PLATFORM_ADMIN_TOKEN=dev CONGRESS_JWT_SECRET=<32+ random chars> uv run uvicorn app.main:create_app_from_env --factory --port 8000` (an unset `CONGRESS_ENVIRONMENT` means `production`, which requires explicit `CONGRESS_DATABASE_URL`, `CONGRESS_MEDIA_ROOT` and a generated 32+ character admin token)
  - Run tests: `uv run pytest` (only ever targets a marked `*_test` database), or on disposable Docker infrastructure: `node scripts/integration/backend-tests.mjs`
  - Run typecheck: `uv run mypy`
- **`web/`**: React 19 + TypeScript + Vite SPA & PWA frontend with Tailwind CSS.
  - Run dev server: `npm run dev`
  - Run unit tests: `npm test`
  - Run typecheck & build: `npm run build`
- **`mobile/`**: Native Flutter / Dart mobile scanner application (iOS/Android) with local SQLite and Google ML Kit camera detection.
  - Run tests: `dart test`
  - Run static analysis: `dart analyze`
  - *(Dart binary on Windows is located at `%LOCALAPPDATA%\Microsoft\WinGet\Packages\Google.DartSDK_...\dart-sdk\bin\dart.exe`)*

## Web Route Map (`web/src/main.tsx`)

| Route | Role & Capabilities |
| :--- | :--- |
| `/` | Platform landing page |
| `/e/:slug` | Public event page (published Page Studio document) with free ticket reservation modal; 404 until first publish |
| `/e/:slug/booths/:boothId` | Public company booth profile, digital brochure download, and bookmarking |
| `/my-tickets` | Attendee pass portal: high-contrast QR pass, offline cache, saved booths |
| `/my-network` | Attendee networking hub: peer badge scanner, private notes, `.vcf` vCard download |
| `/scan/:pointId` | Gate scanner PWA: camera BarcodeDetector, USB HID gun listener, offline buffer |
| `/booth/:boothId` | Exhibitor lead portal: badge scanner, lead qualification drawer, CRM CSV export |
| `/organizer` | Organizer console: API key gate, events list, and event creation |
| `/organizer/events/:id` | Event settings: ticket tiers, check-in points, exhibition booths, standee QRs |
| `/organizer/events/:id/page` | Page Studio: private draft, live preview, publish/unpublish of the public congress page; sections, branding, bilingual content, images |
| `/organizer/events/:id/page/preview` | Bare preview frame used inside Page Studio (organizer key from the tab session) |
| `/organizer/events/:id/desk` | Front-desk station: rapid walk-in pass minting and live attendee search |
| `/organizer/events/:id/analytics` | Real-time analytics: attendance KPIs, gate throughput bars, catering widget, CSV |

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

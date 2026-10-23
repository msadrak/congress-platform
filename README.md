# AITeb Congress

A multi-tenant platform for running congresses (built for Iranian medical congresses, usable for any conference):
free registration, SMS sign-in, passes with QR codes, gate scanning that keeps working offline, a front desk,
exhibitor lead capture and attendee networking, the program and venue, and an organizer console. Persian (RTL) first,
with English.

**Who uses it:** the platform admin (console, SMS gateway), organizers and their members (roles owner, manager,
staff, viewer), front-desk operators, gate scanner devices, exhibitors and booth staff, attendees, and public visitors.

## Repository layout

| Path | What |
|---|---|
| `backend/` | FastAPI (Python 3.11+, async SQLAlchemy 2.0 + asyncpg) API, Alembic migrations, PostgreSQL 16 |
| `web/` | React 19 + TypeScript + Vite PWA: every portal, including the gate scanner at `/scan/:pointId` ([`web/README.md`](web/README.md)) |
| `mobile/` | **Parked** pure-Dart copy of the old scanner engine; not an app ([`mobile/README.md`](mobile/README.md)) |
| `deploy/` | Docker Compose stack (PostgreSQL, migrate, API, Caddy), hosted and systemd templates, proxy helpers |
| `scripts/` | `check.sh`/`check.bat` (all checks), `staging/stack.mjs` (the operator tool), integration and load tests |
| `docs/` | ADRs, operations, release and pilot documents (see below) |
| `GLOSSARY.md` | Domain language, including the Persian UI terms |
| `AGENTS.md` | Commands and conventions for contributors and coding agents |

## Quick start (development)

Requirements: Docker, Python 3.11+ with [`uv`](https://docs.astral.sh/uv/), Node.js 22+.

```bash
# 1. PostgreSQL on 127.0.0.1:5433 (data under ~/congress-persistent-data)
docker compose up -d postgres

# 2. API on :8000 (development: SMS codes are printed in the API log, nothing is sent)
cd backend
uv sync
uv run alembic upgrade head        # alembic.ini points at 127.0.0.1:5433; CONGRESS_DATABASE_URL overrides it
CONGRESS_ENVIRONMENT=development CONGRESS_PLATFORM_ADMIN_TOKEN=dev \
  CONGRESS_JWT_SECRET=<32+ random characters> \
  uv run uvicorn app.main:create_app_from_env --factory --port 8000

# 3. Web app on :5173 (proxies /api to :8000)
cd web
npm ci
npm run dev
```

Create an organizer with the admin token (`POST /api/organizers` with header `X-Admin-Token: dev`) or in the platform
console at `/platform`; the API documentation is at `http://127.0.0.1:8000/docs` outside production.

**Checks before you commit:** `./scripts/check.sh` (or `scripts\check.bat`) runs backend mypy and pytest (on a
disposable PostgreSQL in Docker), web unit tests, lint, type check and build, and the Dart checks. Details and the
individual commands are in [`AGENTS.md`](AGENTS.md) and [`docs/CODING_STANDARDS.md`](docs/CODING_STANDARDS.md).

## Running it for real

One Docker Compose stack, operated with `node scripts/staging/stack.mjs` (`init`, `up`, `check`, backups, restore
drills, releases and rollback):

- [`docs/deployment/STAGING_OPERATIONS.md`](docs/deployment/STAGING_OPERATIONS.md): services, portals, backups, PITR,
  monitoring, releases and rollback, upgrades;
- [`docs/deployment/HOSTED_STAGING_READINESS.md`](docs/deployment/HOSTED_STAGING_READINESS.md): hosted deployment,
  sizing, DNS and firewall; [`CDN.md`](docs/deployment/CDN.md) and
  [`PROXY-QUICK-START.md`](docs/deployment/PROXY-QUICK-START.md) for a CDN or a server without direct internet;
- [`docs/release/07-CONGRESS-DAY-RUNBOOK.md`](docs/release/07-CONGRESS-DAY-RUNBOOK.md): checklists and playbooks for the
  congress itself;
- [`docs/pilot/08-BACKUP-RECOVERY.md`](docs/pilot/08-BACKUP-RECOVERY.md): recovery objectives and drills.

## Where the documentation lives

- **Current state of the work:** [`docs/handover/UPGRADE_HANDOVER.md`](docs/handover/UPGRADE_HANDOVER.md) (what is
  merged, in flight and open) and [`docs/handover/WORKBOARD.md`](docs/handover/WORKBOARD.md) (who is doing what).
- **Decisions:** [`docs/adr/`](docs/adr/), each with its status notes where the code differs from the original decision.
- **Standards:** [`docs/CODING_STANDARDS.md`](docs/CODING_STANDARDS.md); manual test guide in
  [`docs/MANUAL-TESTING.md`](docs/MANUAL-TESTING.md).
- **History:** `REPORT.md`, `SPEC.md`, `SPEC_V2.md`, `docs/pilot/*`, `docs/release/0[1-6,8]*`, `docs/audits/`,
  `docs/design/` and `docs/research/` are dated records; their banners say what is outdated.

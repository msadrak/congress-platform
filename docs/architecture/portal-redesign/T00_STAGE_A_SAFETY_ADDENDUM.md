# T00 Stage A — Safety Addendum

## 1. Verdict and authority

**Stage A verdict: BLOCKED for Stage B execution.** The frozen two-commit manifest is provisionally accepted, not authorization to stage or commit. Docker CLI is installed but its daemon is unavailable; an independent PostgreSQL cluster is not established. No destructive operation is permitted until an independent disposable server and all effective connections are proven. This addendum supersedes unsafe database, directory-staging, and automatic-cleanup instructions in T00_PRECOMMIT_MANIFEST.md; that historical document is preserved unchanged.

The existing server on port 5433 is shared development infrastructure. `congress`, `congress_e2e`, `congress_test`, and `congress_05h` MUST NOT be used. A database name or nondefault port does not prove isolation. Previous claims of proved isolation and complete verification are withdrawn. No suite was executed in this correction.

## 2. Confirmed connection behavior

| Consumer | Source | Effective behavior |
|---|---|---|
| Application | backend/app/config.py:14–22; backend/app/main.py:28 | Settings accepts database_url; CONGRESS_DATABASE_URL supplies environment configuration; .env is also configured. Default targets shared port 5433/congress. Explicit fixture Settings arguments override application environment settings. |
| Alembic CLI | backend/alembic.ini:89; backend/migrations/env.py:19–20 | Default targets localhost:5433/congress. Nonempty CONGRESS_DATABASE_URL overrides sqlalchemy.url. Does not itself load Settings/.env. |
| Pytest administrative operations | backend/tests/conftest.py:19–38 | CONGRESS_TEST_HOST/PORT default to 127.0.0.1/5433. CONGRESS_TEST_ADMIN_DSN overrides derived administrative URL. Drops and recreates hardcoded congress_test with FORCE. |
| Pytest truncation/application | conftest.py:26–29,41–57,73–77 | CONGRESS_TEST_DATABASE_URL overrides TEST_URL. Truncates public tables in the actual URL database, not necessarily congress_test. Session termination targets congress_test. |
| Pytest migration fixture | conftest.py:60–66; migrations/env.py:19–20 | Fixture sets Alembic URL to TEST_URL, but CONGRESS_DATABASE_URL can override it again. Setting this variable to the migration database during pytest is unsafe. |

The host and port are configurable, not irreducibly hardcoded. Set every override explicitly before Python imports conftest. Never rely on changing only DATABASE_URL (wrong name), only CONGRESS_TEST_PORT, or only the fixture URL. No application modification is needed for two databases. Pytest's database name remains congress_test.

Read-only search of backend/app and backend/tests located connection construction in config.py/main.py/conftest.py, without an additional direct database target. Future clean-checkout inspection must repeat this search to detect changed configuration.

## 3. Disposable environment design and tool evidence

Read-only `docker info` returned exit 1: Docker client 29.7.2 exists; dockerDesktopLinuxEngine pipe was unavailable. No Docker server is currently proven available. `where.exe initdb` and `where.exe pg_ctl` returned exit 1 (not on Windows PATH). A bounded WSL probe timed out; standalone Linux binaries/cluster feasibility are **UNVERIFIED**, not absent by proof. No service was started or replaced.

Preferred future design, after authorization and Docker readiness: a uniquely named PostgreSQL container using a human-reviewed image digest, new tmpfs data storage, a unique internal Docker network, no mounts of existing database directories, no host networking, no privileged mode, no published PostgreSQL port, and a unique generated disposable credential. Use PostgreSQL 16 or another explicitly reviewed compatible major; digest must be recorded before creation. Do not substitute an unreviewed moving tag silently.

Run backend verification in a separate reviewed Python 3.11/3.12 + uv runner container on that internal network. Its only project mount is the detached clean worktree, never the main checkout. PostgreSQL hostname is the unique database container name and port is 5432. Block external network access during migrations/tests; do not mount Docker socket or add host-gateway mappings. This network namespace makes localhost refer to the runner rather than the shared host. Default 5433 fallback would fail, not reach shared PostgreSQL. Runtime preflight must also demonstrate host/shared-server access is blocked; network topology alone is not sufficient evidence on every Docker installation.

Dependency installation is a separate prior controlled step: approved runner/image and locked packages may be acquired with network access, without inherited host database settings and without executing tests. Then disconnect acquisition networks and run database operations on the internal network only. Cache/image availability is currently unverified. Runner and PostgreSQL images, names, network, credentials and worktree path must be approved before provisioning.

Proposed commands (future only; placeholders must be bound to reviewed immutable values):

```text
docker network create --internal <unique-network>
docker run --name <unique-pg> --network <unique-network> --tmpfs /var/lib/postgresql/data:rw -e POSTGRES_USER=<disposable-user> -e POSTGRES_PASSWORD_FILE=/run/secrets/pg-password --mount type=bind,src=<outside-repo-password-file>,dst=/run/secrets/pg-password,readonly <postgres-image@sha256:digest>
```

No `-p`, existing PGDATA mount, or `--network host` is allowed. Password file must have restrictive permissions and never enter Git or reports. Startup creates a fresh server; provision verification databases only after instance proof below. Record container ID, image digest, network ID and storage mounts with sensitive environment fields omitted.

Fallback: a temporary standalone cluster is admissible only after locating initdb/pg_ctl, reviewing versions, creating a new empty external data directory, binding a unique loopback endpoint with authentication and distinct credentials, and establishing process/data-directory identity. Never start/stop the user's existing service. Since these prerequisites are unproven, **do not execute this fallback**. Host-side tests additionally require a validated fail-closed connection guard before every destructive phase; no guessed port qualifies.

## 4. Mandatory pre-destruction proof

Before creating verification databases, migrating, or starting pytest:

1. Inspect exact approved container IDs, image digests, internal network membership and tmpfs PGDATA mount. Prove no host/shared data mount and no database published port.
2. In runner, inspect sanitized process environment and resolve the unique PG hostname. Parse every DSN; require identical disposable host, port 5432, disposable username and correct phase-specific database. Reject localhost/127.0.0.1 host URLs, host.docker.internal, port 5433 and any inherited host connection configuration.
3. Establish read-only connections to postgres; record `SELECT current_database(), current_user, inet_server_addr(), inet_server_port(), version();`, `SHOW data_directory;`, and `SELECT system_identifier FROM pg_control_system();`. Match network address to inspected container and data directory to disposable storage. Inspect pg_database/pg_tables; require only fresh initialization databases and no user-owned tables before provisioning.
4. Prove runner cannot establish a TCP connection to the shared server's host address/5433, localhost/5433, or host gateway/5433. If any route exists or addresses cannot be resolved confidently, stop and impose a reviewed network restriction. Do not probe with destructive SQL.
5. Derive effective Alembic Config and Settings in a non-migrating inspection; compare sanitized endpoint/db fields to the intended phase. Read conftest constants without invoking pytest fixtures (AST extraction or controlled import only). Verify ADMIN_DSN, TEST_URL, and Alembic override all match disposable instance. Reject unexplained differences.
6. Record proof in the future integration report before destructive commands. Configuration can change between phases: rerun checks after every phase environment switch. Use a dedicated process/runner for each phase; never leave migration URL inherited into pytest.

Any failed condition blocks Stage B database execution. Do not run pytest to discover its connection target.

## 5. Migration database isolation

Provision only on the proven disposable instance:

```text
docker exec <unique-pg> createdb -U <disposable-user> congress_migration_verify
```

Set process configuration in the migration runner:

```text
CONGRESS_DATABASE_URL=postgresql+asyncpg://<encoded-disposable-user>:<encoded-disposable-password>@<unique-pg>:5432/congress_migration_verify
```

Do not provide production .env or inherited environment. Credentials must be injected securely, not printed. Administrative psql inside the approved PG container uses `-U <disposable-user> -d congress_migration_verify` explicitly.

Backend working directory is `<worktree>/backend` (container-mounted equivalent). Execute, in order:

```text
uv sync --locked
uv run --locked alembic heads
uv run --locked alembic history
uv run --locked alembic upgrade head
uv run --locked alembic current
```

Expected repository head is 0011, parent 0010, file backend/migrations/versions/0011_desk_operators_and_attribution.py. Revalidate actual graph before execution; multiple/new heads require renewed review. Read-only SQL after upgrade:

```sql
SELECT version_num FROM alembic_version;
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns WHERE table_schema='public'
AND table_name IN ('desk_operators','tickets') ORDER BY table_name, ordinal_position;
SELECT conrelid::regclass, conname, pg_get_constraintdef(oid)
FROM pg_constraint WHERE conrelid IN ('desk_operators'::regclass,'tickets'::regclass);
SELECT tablename,indexname,indexdef FROM pg_indexes
WHERE schemaname='public' AND tablename IN ('desk_operators','tickets');
```

Require version 0011, desk operator table/unique event-user constraint/FKs/indexes and nullable tickets.issued_by_operator_id FK/index matching migration source. Record full exit codes and sanitized schema evidence. Empty-database upgrade is not an existing-data preservation proof; if testing old-schema seeded upgrade, use another explicitly disposable database and retain seed/verification evidence. Any downgrade test uses a third disposable database only. 0011 downgrade drops attribution and operator records; it is structurally reversible, **not data-preserving**.

## 6. Pytest database isolation and effective configuration

Use a separate runner process with all five settings fixed:

```text
CONGRESS_TEST_HOST=<unique-pg>
CONGRESS_TEST_PORT=5432
CONGRESS_TEST_ADMIN_DSN=postgresql://<encoded-disposable-user>:<encoded-disposable-password>@<unique-pg>:5432/postgres
CONGRESS_TEST_DATABASE_URL=postgresql+asyncpg://<encoded-disposable-user>:<encoded-disposable-password>@<unique-pg>:5432/congress_test
CONGRESS_DATABASE_URL=postgresql+asyncpg://<encoded-disposable-user>:<encoded-disposable-password>@<unique-pg>:5432/congress_test
```

Fixture creates congress_test itself; each pytest process may FORCE-drop it. Do not run test processes concurrently. Migration verification database is never TEST_URL or CONGRESS_DATABASE_URL for pytest. Snapshot its version/schema before pytest, compare after both pytest sessions. Require congress_migration_verify still present, version 0011 and identical schema signature. Recreating congress_test must not affect it. The isolated disposable role requires CREATEDB and termination rights for this fixture, never credentials for another server.

## 7. Complete future verification sequence

All commands below are **NOT RUN** in Stage A. `--locked` is the reproducibility guard for the requested uv commands; no dependency updates are authorized. Run from exact detached worktree paths, recording cwd, sanitized environment, exit status, counts and logs.

1. Revalidate Git baseline and frozen content, obtain explicit approval, then exact reviewed staging/commits as Section 9. Record both full SHAs.
2. Create detached external worktree at exact Commit 2 SHA. Verify files, lockfiles, Git status and HEAD. No inherited .env files; no symlinks/junctions to main dependencies or shared database data.
3. Establish disposable network/server/runner and prove Section 4. Install backend using `uv sync --locked` and frontend using `npm ci` in worktree. Failure or lock changes stop verification; do not update locks. Record Python/uv/Node/npm versions.
4. Migration phase: Section 5 including schema proof on congress_migration_verify.
5. Backend runner: switch to Section 6 configuration and recheck connections. Run:

```text
uv run --locked mypy
uv run --locked pytest tests/test_desk_operator_auth.py tests/test_management_lifecycle.py -q
uv run --locked pytest -q
```

These are the locked equivalents of `uv run mypy`, focused Desk tests and `uv run pytest -q`. Full suite is mandatory, not replaced by focused tests. Compare migration database afterward. No application edits to make failures disappear.

6. Frontend, `<worktree>/web`:

```text
npm test
npm run typecheck
npm run lint
npm run build
```

All four scripts exist in web/package.json:7–12. Lint is not optional merely because canonical scripts omit it. Existing canonical scripts must be inspected: scripts/check.bat:24 starts/checks shared WSL PostgreSQL and hardcodes original backend directory. **Do not execute check.bat**. scripts/check.sh can be used only after proving its runner path/environment and isolated target; report canonical wrapper NOT RUN when unsafe, and report each equivalent check individually. Do not claim unified verification passed if mobile portions were not executed.

7. Browser prerequisites: web/playwright.config.ts targets msedge, base URL PLAYWRIGHT_BASE_URL (default4174), no automatic webServer. web/e2e/scanner-real-api.spec.ts requires CONGRESS_PLATFORM_ADMIN_TOKEN and CONGRESS_API_BASE_URL, creates organizers/events/points, and skips without admin token. Existing scanner-offline.spec.ts also requires review of its intercepted/external requests before execution. Do not count a skipped real API test as PASS.

For E2E, only after pytest finishes, migrate congress_test through head if necessary using its URL, launch backend in isolated runner with disposable admin token, independent signing secret and explicit CORS origin; command:

```text
uv run --locked uvicorn app.main:create_app_from_env --factory --host 0.0.0.0 --port 8000
npm run preview -- --host 127.0.0.1 --port 4174 --strictPort
npx --no-install playwright test
```

Backend port may be published loopback-only for browser access (PostgreSQL remains unpublished); prove published endpoint maps to approved backend, whose Settings URL points to isolated congress_test. Set browser process PLAYWRIGHT_BASE_URL=http://127.0.0.1:4174, CONGRESS_API_BASE_URL to that isolated backend's explicit loopback port, and CONGRESS_PLATFORM_ADMIN_TOKEN to the disposable value. Build frontend must not use shared API configuration. No production secrets or reused browser storage. Edge installation and Playwright compatibility are not verified; if missing, require separately authorized provisioning or report NOT RUN with exact reason. Disable traces containing QR token URLs unless securely protected and redacted; real scanner test navigates with a token query parameter.

8. Compatibility evidence must identify actual executed cases, not just command completion. Full backend suite includes focused Desk auth/login/walk-in issuance and cross-event revocation tests; management lifecycle covers organizer ownership/date/quota/policy behavior; test_public_event covers public content/tenant-internals exclusion. Audit QR payload and ticket generation assertions in the full suite; document uncovered contracts separately. Browser scanner tests must protect `/scan/:pointId`, sync/revocation and offline behavior. Public `/e/:slug/booths/:boothId` URLs, ticket QR payloads and legacy reception entry require route/source comparison at starting HEAD versus committed baseline plus applicable browser/API smoke evidence. Source comparison is not runtime proof; missing journeys remain NOT RUN/UNVERIFIED. No native Flutter production-readiness claim.
9. Preserve logs and worktree on any failure. Record final main working tree status and verify unrelated contents preserved. Do not reset/rewrite commits or automatically clean environments. A created commit alone does not establish T0 completion.

## 8. Exact frozen commit manifests

Commit 1 — **17 implementation files**, message:
`feat(organizer): event lifecycle settings, tier quotas, and front-desk operator station (0011)`

```text
backend/app/models.py
backend/app/routes/checkin.py
backend/app/routes/desk.py
backend/app/routes/events.py
backend/app/routes/public.py
backend/app/routes/ticket_tiers.py
backend/app/security.py
backend/tests/test_public_event.py
web/src/api/client.ts
web/src/api/schema.d.ts
web/src/lib/i18n.ts
web/src/pages/OrganizerDesk.tsx
web/src/pages/OrganizerEventDetail.tsx
web/src/pages/OrganizerLayout.tsx
backend/migrations/versions/0011_desk_operators_and_attribution.py
backend/tests/test_desk_operator_auth.py
backend/tests/test_management_lifecycle.py
```

Commit 2 — **26 documents**, message:
`docs(architecture): portal redesign specification, backlog and audit baseline (phases 00-04)`

```text
docs/architecture/portal-redesign/00_BASELINE_AUDIT.md
docs/architecture/portal-redesign/00_ROUTE_AND_FEATURE_MATRIX.md
docs/architecture/portal-redesign/01_ARCHITECTURE_DECISIONS.md
docs/architecture/portal-redesign/01_AUTHENTICATION_ARCHITECTURE.md
docs/architecture/portal-redesign/01_AUTHORIZATION_MATRIX.md
docs/architecture/portal-redesign/01_DOMAIN_MODEL.md
docs/architecture/portal-redesign/01_MIGRATION_IMPACT.md
docs/architecture/portal-redesign/01_REQUIREMENT_TRACEABILITY.md
docs/architecture/portal-redesign/02_ACCEPTANCE_AND_HANDOFF.md
docs/architecture/portal-redesign/02_FRONTEND_ARCHITECTURE.md
docs/architecture/portal-redesign/02_INFORMATION_ARCHITECTURE.md
docs/architecture/portal-redesign/02_ROUTE_AND_COMPONENT_MIGRATION.md
docs/architecture/portal-redesign/02_UX_BLUEPRINT.md
docs/architecture/portal-redesign/03_AGENT_EXECUTION_PROTOCOL.md
docs/architecture/portal-redesign/03_API_AND_DATA_MIGRATION.md
docs/architecture/portal-redesign/03_ARCHITECTURE_RECONCILIATION.md
docs/architecture/portal-redesign/03_IMPLEMENTATION_ROADMAP.md
docs/architecture/portal-redesign/03_TASK_BACKLOG.md
docs/architecture/portal-redesign/03_TEST_AND_RELEASE_PLAN.md
docs/architecture/portal-redesign/04_BACKLOG_AUDIT.md
docs/architecture/portal-redesign/04_CORRECTION_AND_APPROVAL_REGISTER.md
docs/architecture/portal-redesign/04_DEPENDENCY_AND_TEST_AUDIT.md
docs/architecture/portal-redesign/04_INDEPENDENT_ARCHITECTURE_AUDIT.md
docs/architecture/portal-redesign/04_MVP_SCOPE_AND_PRIORITIES.md
docs/architecture/portal-redesign/04_SECURITY_AND_DATA_REVIEW.md
docs/architecture/portal-redesign/T00_PRECOMMIT_MANIFEST.md
```

This addendum is **not silently added** to the frozen 26-document commit. Before creation there were 43 pending files; this authorized report makes 44. It remains an explicitly acknowledged untracked report unless human approval changes the manifest. Its corrective authority must accompany future execution even though not part of baseline SHA. Any subsequent integration report likewise is not in verified SHA unless separately authorized and committed/verified.

## 9. Git staging safety and worktree preservation

Observed branch integration/task-05h; HEAD 284feaffa976171bfc4fdf5d6945d6936c507425; index empty; 14 tracked modifications +29 untracked =43 before addendum. `git diff --check` returned exit2, trailing whitespace backend/tests/test_public_event.py:26. No fix is made. Require explicit reviewed waiver or separately authorized correction; never report this check PASS.

Before future staging: run status --porcelain=v1 -uall, branch --show-current, rev-parse HEAD, diff --name-status, diff --cached --name-status, diff --check. Compare exact paths AND content fingerprints/complete diffs to the approved snapshot. Obtain fresh approval if unexpected edits occur; the only expected extra file is this addendum. Empty initial index is required unless existing staged content is individually authorized. Record approved SHA256 for every candidate and index identity before operations. A path match alone is insufficient.

Stage only the exact 17 paths above with `git add -- <explicit paths>`; inspect complete `git diff --cached`, --name-status and --check. Recheck staged contents for secrets using an available reviewed scanner plus manual assessment; keyword grep alone is not proof. Redact findings, stop on suspected secrets, do not automatically unstage other work. No complete fresh secret audit was run in this correction; prior blanket zero-secrets assertion is not renewed. Create Commit 1 only after explicit human authorization; repeat exact 26-path staging/diff/secret review for Commit 2. Never directory-stage or use git add . / -A.

Record Commit 1 and Commit 2 full SHAs. Use `git worktree add --detach <new-absolute-external-path> <exact-commit-2-sha>` only after approval; reject existing/owned destination. Confirm worktree HEAD, clean tracked/index state, all 43 intended files and lockfiles. Do not use moving branch as verification target. Dependency/build outputs are allowed only in verification workspace. Keep failed worktree, logs, and disposable environment for diagnosis; no automatic removal, forced cleanup, reset, history rewriting or shared PostgreSQL service changes. Cleanup requires ownership validation and explicit approval.

## 10. Remaining blockers and security debt

- Docker daemon unavailable; standalone cluster availability unverified. No disposable instance proof exists. Stage B migrations/tests are BLOCKED.
- Immutable images, runner feasibility, isolated network deny checks, locked dependency availability, and browser prerequisites require resolution and recorded proof before execution.
- Exact content/secret review must be renewed immediately before staging; no staging approval presumed. Frozen grouping is accepted provisionally only.
- Whitespace check currently fails; explicit disposition required without unauthorized application edits.
- Desk JWT token resurrection is known security debt: revocation/reactivation may revive old unexpired JWTs. Preserve implementation here; require P03-T02 lifecycle correction and negative tests before production release. T0 baseline is not production-ready.
- E2E and native scanner readiness are unverified; failure/NOT RUN must remain visible. Full backend/frontend success cannot substitute for missing required compatibility evidence.

## 11. Stage A outcome

**BLOCKED**, not READY FOR APPROVAL for full Stage B. Alembic and pytest configuration supports separate databases on a genuinely separate server without source changes, but safe infrastructure is not currently available/proven. Next action: explicit human decision to make an independent Docker daemon/runner available or approve a demonstrated standalone-cluster environment, followed by renewed non-destructive isolation proof and exact Stage B approval.

No commits, staging, worktrees, migrations, dependency installs, application changes, or destructive tests were executed in this correction. Only this addendum was created. Historical documentation was not rewritten.

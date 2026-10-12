# P03-T02 — Prevent desk-session resurrection with generations

## Verdict and scope

**P03-T02 backend implementation and assigned isolated verification: PASS.** This is not a full-stack release approval. Only P03-T02 was authorized; no commit, staging, push, deployment, frontend/API-client regeneration, dependency change or P03-T03 work occurred.

Initial branch: `integration/task-05h`. Actual HEAD: `7ddd030d6981db3d8639f2c014ca60eff2061db7`. Fresh initial `git status --porcelain=v1 --untracked-files=all` was empty. Initial isolated `uv run --locked alembic heads` reported **0011 (head)**. Final source and disposable migration-database head: **0012**, one linear chain from 0001, with exactly one new revision. Existing 0011 was not edited; normalized source equals its HEAD Git blob, SHA-256 `2b8983fb450b63e70a82d65a30d6716405e1c40a0813cb692da57353805650fc`.

Prerequisite P03-T01 is present in current source and `T01_IMPLEMENTATION_RESULT.md`: token-family guards and protected Bearer challenges remain intact. Read repository instructions, coding standards, glossary, the full P03-T02 backlog entry, execution protocol, API/data generation and rollback contracts, relevant architecture reconciliation, Phase 04 security review, correction/approval register and backlog audit, T01 report, QA regression matrix, actual models/security/desk routes/tests/configuration/fixture/migration environment and existing revisions. Current source and the latest explicit user authorization govern this implementation, not historical planning-only status or guessed revision numbers.

### Explicit newer-policy amendment: no unversioned Desk compatibility

The latest user-approved **fail-closed** policy supersedes the versionless-at-row0 exception in `03_TASK_BACKLOG.md` P03-T02 (including its original acceptance/definition-of-done), `03_API_AND_DATA_MIGRATION.md` §4.1, AR-03, the QA generation scenario and FINDING-01's illustrative legacy exception. Those historical planning documents are intentionally not silently rewritten.

**Every unversioned Desk JWT is rejected, including for an active row at version0.** The migration/hardened-application rollout therefore invalidates all pre-T02 Desk sessions and requires a fresh event-specific desk login. DDL alone does not invalidate a JWT while old application code remains deployed; the hardened authorizer enforces the cutover. Ordinary typeless legacy **User** tokens remain supported, and scanner token format/authentication is unchanged. Wrong-event Desk status ordering remains403, not a newly generalized401.

## Changed files

Existing:

- `backend/app/models.py`: non-null integer `DeskOperator.session_version`, Python default0, database default0 and matching nonnegative check constraint.
- `backend/app/security.py`: mandatory generation argument and signed integer claim; existing Desk type/subject/event/operator/User/name/iat/exp and seven-day expiry are preserved. No default generation argument can silently manufacture a version0 session.
- `backend/app/routes/desk.py`: login passes the persisted operator row's generation; the common authorizer checks strict integer/nonnegative/current-row equality; both authorized lifecycle paths lock the operator row before mutation and commit the generation with the state.
- `backend/tests/test_desk_operator_auth.py`: retained HTTP resurrection regression, strict claims/legacy rejection, repeated lifecycle, concurrency and authority negatives.

New:

- `backend/migrations/versions/0012_desk_session_version.py`: additive `0011 -> 0012` expansion only; existing rows become0, server default0 stays installed, nonnegative check is named `ck_desk_operators_session_version`. No new index/uniqueness/FK or attribution change.
- `backend/tests/test_desk_session_migration.py`: populated 0011 expansion and single-head/linear-chain regression proof.
- This report.

No unrelated file was intentionally changed. No frontend, printed URL, EntityQR generation, pending scanner record, dependency manifest or 0011 source change was made. Runtime proof/migration harnesses are session artifacts outside the repository, not shipping scaffolds.

## Delivered authorization/lifecycle contract

For an existing event and assigned Desk operator, missing/null/boolean/string/float/list/object/negative or unequal `session_version` returns exactly **401 with `WWW-Authenticate: Bearer`**. Booleans are excluded explicitly with `type(value) is int`, rather than Python's integer-compatible boolean comparison. The database operator is checked on every protected HTTP request. A valid version0 token works for an active version0 row; a missing-version token does not.

Existing precedence/status semantics remain: wrong-event Desk403; revoked/nonmember fresh login403 without a Bearer challenge; revoked protected token401 with challenge; foreign Organizer/resource ownership404; owning Organizer operational access independently authenticated; Desk/User/scanner tokens do not grant Organizer management authority. Existing resource lookup ordering and response bodies/schemas remain, except the additive JWT claim. No session_version field was added to the API response schema, so frontend schema regeneration was unnecessary and not performed.

Every successful revocation, including repeated revocation and the existing `DELETE /api/events/{event_id}/desk/operators/{operator_id}` alias, increments once. A successful reactivation increments once, retains the same operator ID and clears revoked state/time; an already-active duplicate remains409 and does not increment. Both functions execute `SELECT ... FOR UPDATE` on the same scoped operator row before reading/mutating state, and retain the lock through commit. Thus serialized readers see the prior committed generation, not a stale unlocked copy; generation read/modify/write cannot lose a concurrent increment. No version reset, identity replacement or new lifecycle permission was introduced.

### Login race and in-flight semantics

Authorization is **point-in-time**, not retroactive cancellation. Login signs the persisted row version it actually reads. If a concurrent revocation commits after that read, the login response may still arrive200 containing the now-superseded token; its next protected authorization returns401. Login does not re-read and falsely label the token as the newer generation. A login that observes revoked state remains403. Concurrent completed reactivation makes a subsequent login issue the current generation.

Likewise, a request whose authorizer already observed an active matching generation may finish after a later revocation commits, including ticket issuance already authorized/in flight. No claim is made that revocation cancels such requests or undoes committed tickets. A later authorization reading the committed revoked/new-generation state rejects the old token. Lifecycle writes serialize with one another; login and ordinary authorization are deliberately not long-held lifecycle locks.

## Isolated environment and destructive-phase proof

Docker context `desktop-linux`; task-owned runner **`congress-p03-t02-39a14b25a5`**, cwd **`/app`**, locked dependency image `congress-t0-backend:2c0085137f`, Python **3.11.14**, uv **0.9.30**. All tracked current backend files, including T01, plus the new revision/tests were copied into the runner's independent `/app`. There is no original checkout/worktree bind mount, no detached T0 worktree edit, no published runner port and no dependency installation.

Runner is connected only to **`congress-t0env-net-4e5808cb90`**, inspected `Internal=true`. PostgreSQL container **`congress-t0env-pg-4e5808cb90`**, full ID **`95d3e25a4ef8a2c7030dc775c1582468abf0a87bbf349f8401b6fff5d943cccd`**, was inspected for no published5432 port and tmpfs `/var/lib/postgresql/data` without a non-tmpfs data mount. SQL reproved system identifier **7695674229552807975** and admin `current_database() = postgres`. Password was retrieved privately from Docker inspection and supplied only in container environment; no credential/JWT/password value is present in these logs or repository files.

Before baseline/focused/full pytest and before each separate migration database recreation/upgrade phase, the safety harness asserted imported fixture variables and runtime Settings, not merely intended environment. Pytest phases:

```text
CONGRESS_TEST_HOST = congress-t0env-pg-4e5808cb90
CONGRESS_TEST_PORT = 5432
Settings.database_url = CONGRESS_DATABASE_URL = fixture TEST_URL
  postgresql+asyncpg://t0verify:<REDACTED>@congress-t0env-pg-4e5808cb90:5432/congress_test
fixture ADMIN_DSN
  postgresql://t0verify:<REDACTED>@congress-t0env-pg-4e5808cb90:5432/postgres
```

Separate migration harness changes only its process Settings/CONGRESS_DATABASE_URL to the same server's **congress_migration_verify**, explicitly checks that override and retains fixture TEST_URL at **congress_test**, with the same admin/postgres connection. Both `127.0.0.1:5433` and `host.docker.internal:5433` were actively proved unreachable from the isolated runner before destructive phases. No shared host5433 database was targeted or mutated. Only the designated disposable databases on the task-owned server were recreated/truncated/migrated; no unrelated resources were cleaned up.

## Regression and migration evidence

### Red-capable retained baseline regression

Before implementation, copied the new lifecycle HTTP regression into the isolated **unchanged** backend and ran it against migrated congress_test. It failed on the exact reported defect: after revoke/reactivate, old-token desk/me returned **200 instead of401**. Exit1, **1 failed**, 1.82s. This was not inferred from source. The same regression is retained, subsequently strengthened with signed version assertions, an unversioned retained token and issuance denial while revoked as well as after reactivation.

### HTTP coverage (real PostgreSQL, no API mocks)

- Primary regression uses HTTP provisioning/login/issuance and exercises two complete revoke/reactivate cycles: first DELETE alias, then POST revoke. Old current/earlier-generation and signed unversioned tokens return401 + challenge for **me, tiers, attendee search, attendee detail and ticket issuance**, both while revoked and after reactivation. Fresh login generations2 and4 operate all five surfaces. Same operator identity and password preservation are asserted.
- Ten signed-claim cases reject absent, null, true, false, -1, mismatched1, string0, float0, list and object across all five protected surfaces at row0. Valid version0 issuance still works; denied writes do not create extra attendees. Issued type, `desk:` subject and seven-day exp/iat interval are asserted.
- Three rounds launch **six concurrent revocations** (both aliases) then **six concurrent reactivations** over AsyncClient: all six revokes200; exactly one activation201 and five409; fresh JWT versions **7,14,21** prove no lost increments. A further opposite-operation race permits either valid serialization order, accounts for every successful lifecycle write, rejects the retained token and ensures a fresh final login after any required reactivation. This tests real PostgreSQL row locks through HTTP; it does not claim every possible scheduler interleaving was exhaustively explored.
- Desk JWT cannot list/create/revoke/delete operators (exact401 + challenge). Wrong-event Desk403, foreign Organizer management404, mismatched operator/event ownership404 and owning Organizer operational200 remain exact. Ordinary User login/profile still works for the same operator User.
- Focused/full existing T01 User/scanner/token-family, revoked/nonmember login, tenant, ticket and scanner matrices remain passing; they include typeless legacy User compatibility and real issued scanner capability. No scanner-format/lifecycle cutover occurred.

Backend parts of R11/R12/R16/R20 are exercised, with existing backend R13/R14/R17-related scanner regressions preserved. Browser/offline/native portions of these regression IDs are not implied by backend pytest.

### Populated and clean migration

The dedicated congress_migration_verify database was inspected **before** first destruction: applied revision0011, **zero operator rows**. It was not misrepresented as populated. The harness then proved clean empty upgrade0001 through0012 and a single linear head, recreated only this task-owned database, explicitly upgraded to0011 and inserted synthetic active/revoked operators and attributed tickets/QRs before applying0012.

Populated proof: **two historical operators (one revoked), two attributed tickets and two EntityQRs** survive with version0. Complete before/after row snapshots across **all15 historical tables** preserve IDs, names, timestamps, revoked status/time, ticket attribution, QR identities/secrets and tier counts; tables outside the seeded fixture are empty, not falsely claimed populated. Non-null integer metadata, retained server default0 and a raw SQL insert omitting the generation are asserted. Explicit NULL rejects with PostgreSQL NotNullViolation; -1 rejects with CheckViolation; a positive generation write succeeds. Snapshots/secrets remain in memory and are not printed.

The retained pytest migration regression independently truncates only congress_test, moves its **empty disposable schema** to0011, seeds the same fixture, upgrades tohead and verifies the additive invariants. Its temporary downgrade does not test or recommend erasing real generation history. Full pytest fixture setup independently reproves fresh clean upgrade through head. Graph test proves exact linear0001–0012, a single0012 head and exactly one0012 file. 0011 remains untouched.

## Exact commands, exits and raw logs

All runner checks below use the host prefix:

```text
docker --context desktop-linux exec congress-p03-t02-39a14b25a5 sh -c '<command below>'
```

Container cwd `/app`; host checkout `H:/Freelancing_Project/KalaniProject/DR.MaHDi/Congere Managment Platform`. `PYTHONPATH=/app` lets the artifact harness import the current copied app/fixtures.

| Command | Exit | Observed result |
|---|---:|---|
| `uv run --locked alembic heads && uv run --locked python --version && uv --version` (before changes) | 0 | 0011 head; Python3.11.14; uv0.9.30 |
| `PYTHONPATH=/app uv run --locked python /tmp/t02_safety.py` | 0 | Settings/fixture/admin/server identity and unreachable shared5433 proof |
| `PYTHONPATH=/app uv run --locked python /tmp/t02_safety.py && uv run --locked pytest tests/test_desk_operator_auth.py::test_old_desk_session_never_revives_after_reactivation -q` (pre-fix) | 1 | 1 failed, 1.82s; resurrected old token200 instead of401 |
| `uv run --locked mypy` (complete final implementation) | 0 | No issues in46 source files |
| `PYTHONPATH=/app uv run --locked python /tmp/t02_safety.py && uv run --locked pytest tests/test_desk_operator_auth.py tests/test_desk_registration.py tests/test_desk_session_migration.py tests/test_auth.py tests/test_scanner_security.py tests/test_scanner_revocation_matrix.py tests/test_tickets.py tests/test_events.py tests/test_organizers.py -q` | 0 | **112 passed**, 27.15s |
| `PYTHONPATH=/app uv run --locked python /tmp/t02_safety.py && uv run --locked pytest -q` | 0 | **172 passed**, 51.17s |
| `PYTHONPATH=/app uv run --locked python /tmp/t02_migration.py` | 0 | Empty-through-head and populated0011→0012; constraints/defaults/history PASS |

Migration harness invokes `python -m alembic upgrade head`, `current`, `heads`, `history`, then after its separately proved recreation `upgrade 0011`, the populated helper's `upgrade head`, and `current`; **every command exit0**. The subprocess environment targets congress_migration_verify, never an implicit alembic.ini database.

Complete sanitized raw outputs, including initial scope/head, retained regression failure, all earlier and completed check outputs, exact command strings, server/runner metadata and final counts: **`local://p03-t02-complete-verification.json`**. Safety source: `local://p03-t02-safety-proof.py`; migration harness source: `local://p03-t02-migration-verification.py`. These session artifacts are the raw-log references; secrets are not embedded.

For transparency, an earlier candidate gate also passed mypy46, focused112 (32.97s), full172 (45.12s) and migration proof. Afterwards the primary test was strengthened to explicitly check issuance while revoked, retain an unversioned token across both cycles and assert versions2/4. The complete final mypy/focused/full/migration commands above were rerun against that finished source. No failed final gate was hidden; the only application test failure was the intentional pre-fix reproduction.

## Diff summary

Four tracked backend files changed: **316 insertions, 2 deletions**. Two new backend files add the 33-line migration and 131-line migration regression suite. Total backend source/test change: **480 insertions, 2 deletions across six files**, plus this new report. Final `git diff --check` exited0; index remains empty and HEAD remains the approved P03-T01 checkpoint. No additional pending paths were observed.

## Rollout, rollback and limitations

1. Back up the real database and review its actual linear head before any separately authorized deployment. Apply the additive expansion first under the appropriate DDL-lock/write-fencing window; representative production-size lock timing was **not** measured by these small synthetic fixtures.
2. Fence/drain pre-T02 Desk application instances before enabling the hardened writer/authorizer. Old code can issue unversioned JWTs or ignore generation increments; mixed-version service is not a safe security rollout. Preserve existing operator/ticket attribution and monotonic generation values.
3. Announce mandatory Desk re-login: all pre-T02 unversioned Desk sessions fail closed, even at historical version0. Fresh HTTP desk login obtains the row's current generation. Existing ordinary User/scanner sessions need no format migration.
4. Keep expansion and generation history on application rollback. A rollback artifact must retain strict generation validation and both lifecycle increments. If unavailable, disable/contain Desk operations, assignment/reactivation and login until a compatible forward restoration; **never** restore pre-hardening authorization, reset versions or drop the column to recover old sessions.
5. The Alembic downgrade exists but drops security history and is **lossy** after lifecycle writes. Reverting0011 also destroys operator/attribution data. A production schema downgrade is not a safe operational rollback. Only explicitly approved isolated pre-write/exported fixtures may use it.

Canonical `scripts/check.sh` / `scripts/check.bat` **NOT RUN**: assignment explicitly required isolated locked backend-only verification; the inspected scripts include unscoped backend and frontend/mobile gates (Windows also contains a host5433/WSL path). They were not substituted into the task-owned safety environment. Frontend/mobile/browser/viewport/RTL/accessibility/printed-route/offline/device checks were not run or counted passing. HTTP tests use real FastAPI authorizers through HTTPX ASGITransport and actual PostgreSQL, not a separately reachable browser/Uvicorn server. No production migration, release sign-off or concurrency/performance benchmark is claimed.

The diagnostic task-owned runner remains available; no unrelated runner/network/PostgreSQL resource was removed. Docker administrators can inspect container credentials, as before. External artifact references are session evidence, while this report and permanent regressions preserve the implementation contract in the repository.

**Definition of done:** permanent generation column/default/check; one additive linear migration; persisted-row issuance and strict fail-closed validation; authorized locked increments on both lifecycle paths/DELETE alias; retained pre-fix HTTP defect proof; old-session401/fresh-session success across all required surfaces; strict/legacy/authority/concurrency negatives; clean/populated migration proof; completed locked typecheck/focused/full pytest; explicit newer legacy amendment and safe rollout/rollback limitations documented. **STOP: P03-T02 concluded; no subsequent task started and no commit made.**

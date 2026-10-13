# P03-T01 — Human token family and authorization status contract

## Verdict and boundary

**P03-T01 backend contract: PASS.** Fresh isolated locked mypy, focused regressions and full pytest passed. This is not a full-stack release approval. No P03-T02, migration-source change, frontend change, commit, push or deployment was performed.

Initial checkout: branch `integration/task-05h`, SHA `2c0085137fbbf2ec363ec34c9b85661605c88118`. Initial `git status --short` contained only the pre-existing untracked `docs/architecture/portal-redesign/T00_INTEGRATION_RESULT.md`; it remains untouched. T00's incomplete live-browser evidence remains a limitation, not silently promoted to PASS by this backend task.

Read the complete P03-T01 backlog entry (69–117), authentication architecture, authorization matrix, security/data review, correction register, execution protocol, T00 integration result, repository instructions and coding standards. Current authorizers and token issuers were inspected. The user-authorized contract intentionally tightens FINDING-04's illustrative `payload.get` guard: **absent** type is accepted; **present null** is not.

## Delivered contract

- `backend/app/routes/auth.py`: after signature/payload validation, before UUID parsing or User lookup, reject every present `type` except exact string `user`. Typeless legacy sessions and current typeless register/login issuance remain unchanged.
- User-protected failures (missing credential, invalid/expired token, malformed subject, missing/deleted User and wrong family) return exact 401 with `WWW-Authenticate: Bearer`.
- `backend/app/auth.py`: missing/invalid Organizer Bearer keys now carry the same challenge. Platform `X-Admin-Token` authentication is unchanged and does not receive a Bearer challenge.
- `backend/app/routes/desk.py`: malformed protected operator identity now includes the challenge.
- `backend/app/routes/checkin.py`: malformed scanner self-revocation device identity now includes the challenge.
- No status, error body, permission, resource lookup order, issuer payload, dependency library or schema contract was widened. Public User/desk login bad-password 401 remains without a Bearer challenge; desk revoked/nonmember login 403, wrong-event desk 403, authenticated foreign organizer 404, known unauthorized Booth 403 and missing Booth 404 remain exact.

**Defense in depth only:** actual issued desk/scanner subjects already use non-UUID `desk:`/`scanner:` prefixes and were denied by User authentication before this change. These changes do not establish a demonstrated prior issued-token escalation, add User revocation, infer Organizer identity from User, or repair desk token resurrection. Desk revoke/reactivate resurrection remains P03-T02 security debt and a production release blocker.

Client status semantics for later tasks: 401 affects only the credential actually sent; 403/404 preserve credentials. Never substitute an alternate credential or automatically retry under stronger authority. No frontend transport changes were made here.

## Automated coverage

Existing suites updated: `backend/tests/test_auth.py`, `backend/tests/test_desk_operator_auth.py`, `backend/tests/test_scanner_revocation_matrix.py`.

- Typed `user` and typeless legacy success preserve the original `/api/auth/me` response and succeed through ticket, network/privacy, assigned-Booth, bookmark, authorized Booth portal and Booth lead reads.
- Signed desk/scanner/unknown/null/empty/case-mismatched/numeric/boolean/list/object types with an existing User UUID subject return exact 401 + Bearer challenge and the explicit invalid-type detail across User-only identity/ticket/network/Booth/lead consumers.
- Missing/empty/non-Bearer credentials, malformed JWT, invalid signature, expiry, missing/malformed subject, nonexistent and actually deleted User return exact 401 + challenge across shared User consumers.
- Real HTTP-issued desk and scanner credentials and real Organizer keys fail across User-only consumers; issued desk/scanner credentials still succeed at their intended authorizers. User/desk/scanner credentials fail Organizer authentication with exact 401 + challenge.
- Preserve exact public bad-password status/header behavior, platform admin semantics, desk revoked login 403 versus old-token protected 401, desk wrong-event 403, nonmember login 403, foreign Organizer event/desk/scanner 404 and anonymous-before-resource versus invalid-credential-after-resource lookup ordering.
- Replace scanner self-revoke ambiguous 403-or-404 assertions with exact 403: point scope is checked before missing-resource lookup. No scanner authorizer semantics were changed.

The full backend suite exercises backend portions of R01, R11, R12 (revoked state, not the deferred reactivation generation fix), R16, R17 and R20. Browser/offline/native portions are not claimed exercised by pytest.

## Isolated destination proof

Docker context explicitly `desktop-linux`; task-owned runner `congress-p03-t01-6ceb5d4c4a`, working directory `/app`, prepared locked-dependency image `congress-t0-backend:2c0085137f`.

Only the seven modified backend source/test files were copied into the runner. The detached baseline worktree was not edited or mounted; the runner has no mounts or published ports and is connected **only** to internal network `congress-t0env-net-4e5808cb90` (`Internal=true`). No unrestricted dependency network was attached and no dependency installation or shared test runner was used.

PostgreSQL inspect assertions: container `congress-t0env-pg-4e5808cb90`, full ID `95d3e25a4ef8a2c7030dc775c1582468abf0a87bbf349f8401b6fff5d943cccd`, no published host ports, `/var/lib/postgresql/data` tmpfs `rw`, no non-tmpfs data mounts. Read-only SQL verified system identifier **7695674229552807975**.

Before focused and full pytest, runtime Settings and imported fixture variables were asserted, not merely inferred from environment:

```text
CONGRESS_TEST_HOST=congress-t0env-pg-4e5808cb90
CONGRESS_TEST_PORT=5432
Settings.database_url = CONGRESS_DATABASE_URL = fixture TEST_URL
  postgresql+asyncpg://t0verify:<REDACTED>@congress-t0env-pg-4e5808cb90:5432/congress_test
fixture ADMIN_DSN
  postgresql://t0verify:<REDACTED>@congress-t0env-pg-4e5808cb90:5432/postgres
```

The password was retrieved privately from Docker inspection and passed only to the task-owned container environment; never printed or written into repository files. No command targeted host port5433. Existing pytest fixtures recreate/migrate **only disposable congress_test** on that server; no migration CLI run, new migration, schema enhancement or shared database mutation was performed.

## Exact final commands and results

Each command was launched as `docker --context desktop-linux exec congress-p03-t01-6ceb5d4c4a <command>` with container cwd `/app`:

| Command | Exit | Fresh result |
|---|---:|---|
| `uv run --locked mypy` | 0 | No issues in 45 source files |
| `uv run --locked pytest tests/test_auth.py tests/test_desk_operator_auth.py tests/test_scanner_security.py tests/test_scanner_revocation_matrix.py tests/test_tickets.py tests/test_networking.py tests/test_booths.py tests/test_booth_bookmarks.py tests/test_leads.py tests/test_events.py tests/test_organizers.py -q` | 0 | **114 passed**, 23.01s, no warnings reported |
| `uv run --locked pytest -q` | 0 | **157 passed**, 36.69s, no warnings reported |

Raw final command output, runtime proof script, sanitized destination metadata and prior attempt summaries: session artifact `local://p03-t01-final-verification.json`. The proof output was also displayed in the verification transcript. Initial isolated verification caught incorrect use of the existing Organizer-only bearer test helper: mypy exit1 (14 errors), focused pytest exit1 (**26 failed, 88 passed**, 22.76s). Corrected the test-only credential helper usage; subsequent focused run passed114 with one short synthetic HMAC-key warning, then extended that test key to32+ characters and reran final locked mypy/focused/full checks above. Initial logs: `artifact://706`. No failures were hidden and no status assertions were weakened.

Final diff/inventory reviewed with `git diff -- <seven task-owned backend paths>`, `git status --porcelain=v1 --untracked-files=all` and `git diff --cached --name-only` (exit0; artifact `artifact://710`). Only seven intended backend modifications plus this new task report and the preserved T00 report are deliverables/pending paths; index remained empty. No commit or push.

## Limitations and stop

- Canonical `scripts/check.sh` / `scripts/check.bat` full-stack gate **NOT RUN**: assignment required isolated backend verification and forbade shared tests; scripts are not the isolated locked runner gate. Frontend/mobile/browser checks were not executed or claimed passing. The inspected POSIX script includes backend, frontend and mobile checks.
- HTTP tests execute against actual PostgreSQL through ASGITransport, not a separately reachable browser/Uvicorn endpoint; they exercise the specified real server authorizers without synthetic API responses.
- Printed URLs, frontend routes, QR issuance, offline queues, existing migrations and dependency manifests are unchanged. Source non-change is not fresh browser/print/offline evidence.
- Diagnostic task-owned runner remains available; PostgreSQL credentials are inspectable by Docker administrators. No unrelated resources were cleaned up.
- Application rollback is the narrow guard/header edit reversal; no data/schema rollback is necessary.

**STOP: P03-T01 concluded. No P03-T02 or subsequent task started.**

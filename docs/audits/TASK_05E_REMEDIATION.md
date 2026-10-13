# Task 05E — Scanner Revocation Integrity & Repository Stabilization

**Assessment date:** 2026-10-10  
**Repository:** `master`, HEAD `3046cfe6b6365e6476f7bf7ab7b4f3f176d3e5ce`  
**Mode:** implementation and verification; no commit, push, deploy, reset, clean, rebase, merge, or issue mutation performed.

## 1. Executive assessment

Task 05E closes the scanner lifecycle defects documented in the prior Task 05D audit in the **current working tree**. A scanner can now revoke only the server-side device bound to its own validated scanner JWT. The web scanner shuts down admissions locally before attempting revocation; it reports success only after an authoritative successful response; failed/offline revocation remains visibly pending and retains the credential and records needed for recovery. Confirmed revocation removes the credential and hides cached attendee data from the scanner view while retaining operational scan history for authorized recovery.

**Verification is mixed, not release-ready.** The complete PostgreSQL backend suite, web tests/typecheck/build, scanner Edge browser suite, live browser-to-API/PostgreSQL revocation journey, mobile unit tests, and scoped mobile analyzer passed. However, the repository's required Windows unified script stops at a strict-mypy error in `backend/tests/test_csv_security.py`; a separate full mobile analysis reports 301 Flutter-related issues because the repository's Dart-only environment cannot resolve Flutter libraries. The worktree is also heavily modified and uncommitted, so these results are not reproducible from HEAD alone.

**Release assessment: NOT READY.** This is a working-tree implementation, not a clean, reviewed release candidate. The server cannot remotely revoke a scanner while it is disconnected; the browser's offline clock/freshness rules are a local policy boundary, not a server-enforceable guarantee during a partition.

## 2. Preserving repository state

- HEAD remained `3046cfe6b6365e6476f7bf7ab7b4f3f176d3e5ce` on `master`; nothing was staged or committed.
- Final Git status reported **44 modified tracked paths and 30 untracked path groups**. The pre-existing untracked work includes migrations `0008`–`0010`, scanner/concurrency/security tests, many design/evidence files, earlier audit reports, `.obsidian/`, `nul`, and other project work. These were not discarded or blanket-added.
- The Task 05E worktree was archived outside the repository at `C:\Users\sadra\AppData\Local\Temp\task05e-recovery-3046cf6b636e-a2a19a2af784.zip`; the archive was checked to exist and have non-zero size. The repository copy remains the working source of truth.
- The branch is still not a reproducible integration point: a fresh checkout at HEAD does not contain these uncommitted and untracked changes. Do not close prior work or claim a clean release based only on this report.

## 3. Findings and implementation evidence

### F1 — Scanner self-revocation was unavailable

**Prior confirmed behavior:** the preceding live ASGI/PostgreSQL probe showed a scanner's self-revoke request returning 401 while the same token still fetched its manifest; organizer revocation worked and then invalidated the token. The original route required organizer credentials, so the scanner UI could not safely revoke its own device.

**Current implementation:** `backend/app/routes/checkin.py:319-387` adds `POST /api/checkin-points/{point_id}/devices/self/revoke`. It validates the bearer JWT, scanner token type, point and event scope, parses the token `jti` as the device ID, locks the device row, verifies device/point/event ownership and non-revoked state, then commits revocation. No arbitrary device ID is accepted. Existing request authorization checks the device revocation state at `backend/app/routes/checkin.py:153-218`; the batch endpoint also depends on this authorization.

**Regression coverage:** `backend/tests/test_scanner_security.py:303-377` checks missing and organizer credentials, wrong-point scope, successful self-revocation, immediate manifest and batch rejection, and that organizer emergency revocation remains available.

**Live reproduction:** `web/e2e/scanner-real-api.spec.ts:7-75` provisions a real organizer, unique event and gate, issues a scanner token, opens the built scanner UI, performs unpair against the live API, verifies the device is listed as revoked, and verifies the old token's manifest request returns 401. This scenario passed in the final Edge suite and in a separate `--repeat-each=3` run (3/3).

### F2 — UI claimed an unpair without authoritative revocation

`web/src/pages/GateScanner.tsx:526-599` now locally disables scanning first and durably marks the credential `deactivation_pending`. When online, it attempts to reconcile pending scans before revoking. It verifies both HTTP success and `is_revoked: true`; non-success, malformed responses, network failure, pending scans, or offline state do not clear the credential or history and instead leave a visible recovery/retry state. Only a confirmed revoke removes the session and IndexedDB credential and clears attendee-bearing manifest state. The server response is not represented as success before confirmation.

`web/src/lib/scannerTokenStore.ts:42-95` persists credential metadata and the pending-deactivation flag. `web/src/pages/GateScanner.tsx:75-109,205-234,682-735` restores that flag across reload and hides cached attendee data while presenting the supervisor recovery/re-pair UI.

**Browser coverage:** `web/e2e/scanner-offline.spec.ts:597-673,791-885` covers online unpair, offline pending state, rejected/revoked credentials, record preservation, cleanup boundaries, reload/restart, and cached-manifest privacy. These API mocks verify client state handling; the separate R01 test covers the live server path.

### F3 — Offline authorization relied on unbounded cached state

`web/src/lib/scannerAuthPolicy.ts:18-95` defines the 24-hour maximum interval from the fresher of last successful server contact or cached manifest, and refuses authorization for missing/invalid/expired credentials or absent/stale baselines. `GateScanner.tsx:181-190,404-429` recomputes and enforces the verdict before new admissions. Definitive authorization failure blocks new scans; historical queued scans are not rewritten.

`web/tests/scannerAuthPolicy.test.ts:20-113` exercises missing/expired credentials, freshness boundaries, baseline selection, online-state non-bypass, and display formatting. Browser cases U04–U08 exercise expired, wrong-scope, stale-manifest and reconnection behavior.

**Residual limitation:** `getJwtExpiryIso` decodes the JWT `exp` claim without verifying its signature (`scannerAuthPolicy.ts:97-112`), and the browser uses its mutable wall clock and mutable local IndexedDB timestamps. The server validates signatures when contacted, but offline enforcement is not cryptographically trustworthy against a user who controls the scanner browser/profile or clock. Treat 24 hours as a local operational guard, not a remote revocation guarantee.

### F4 — Device revocation and pending-record recovery are separate states

The UI deliberately distinguishes local shutdown from server revocation. Offline unpair only disables the current browser and leaves server revocation pending; the notice explicitly says the server may still accept that token. Records remain stored for supervisor recovery. Server revocation is withheld while scans remain unsynced so their IDs and conflicts are not silently lost. This behavior is visible in `GateScanner.tsx:541-565,682-735,1139-1190` and covered by U02/U12.

**Residual operational limitation:** while the device is disconnected, server revocation cannot occur; a stolen device can continue local admissions until its offline window expires or it reconnects and receives a definitive rejection. If an unsynced queue cannot be reconciled, revocation remains pending and supervisor intervention is required. This is a network-partition limitation, not a successful remote revoke.

### F5 — Recovered PII is retained intentionally

Confirmed unpair removes the local scanner credential and removes the manifest/ticket map from the UI, but keeps scan records in IndexedDB for recovery (`GateScanner.tsx:579-590`; U01/U09/U10). This preserves audit and recovery data, but attendee names/QR-related records remain on the physical browser profile. The UI gates ordinary access behind a valid credential; that is not secure erasure from device storage. Device custody, browser-profile protection, and a controlled retention/deletion process remain operational requirements.

## 4. Verification evidence

| Gate | Command / setup actually exercised | Result |
|---|---|---|
| PostgreSQL backend suite | WSL: `/root/backend_venv/bin/pytest -q` from `backend/`; test fixture recreated its dedicated test DB and ran Alembic to head | **100 passed in 50.17s** |
| Strict mypy — project script | `cmd.exe /d /c "scripts\check.bat"` | **FAILED before pytest:** `tests/test_csv_security.py:5` imports `bearer` from `tests.test_analytics`, which mypy reports is not explicitly exported (`attr-defined`). This file is outside Task 05E scope and was not changed. |
| Standalone mypy command discrepancy | A Bash invocation of `uv run mypy` earlier reported no issues in 40 files; direct CMD invocation later reported the above error while checking 42 files | **Inconsistent across invocation environments.** Use the canonical Windows-script/CMD failure as the blocker; do not report mypy green. |
| Web unit tests | `npm test` | **25 passed, 0 failed** |
| Web TypeScript | `npm run typecheck` | **Passed** (`tsc -b`) |
| Production web build | `npm run build` | **Passed.** Vite emitted a non-blocking advisory for the 562.95 KiB JS chunk; PWA generated 12 precache entries (621.81 KiB). |
| Edge browser suite | `npx playwright test --project msedge`, production preview plus real API environment; final run | **25 passed.** T01–T12 and U01–U12 exercise browser/offline states, mostly with mocked API routes; R01 uses live PostgreSQL API requests and routes the UI's API calls to that API. |
| Live API repetition | `npx playwright test e2e/scanner-real-api.spec.ts --project msedge --repeat-each=3` after restarting the API process on the migrated test DB | **3 passed.** R01 verifies token issuance, real UI manifest access, self-revoke, organizer device state, and old-token rejection. |
| Mobile unit tests | Dart SDK: `dart test` | **8 passed** |
| Mobile scoped analysis | Dart SDK: `dart analyze lib/models lib/services test` (the scope in `scripts/check.bat`) | **Passed; no issues found** |
| Mobile full analysis | Dart SDK: `dart analyze` | **FAILED: 301 issues.** The first errors are unresolved `package:flutter/material.dart` in `lib/main.dart` and screen files; `mobile/pubspec.yaml` does not declare Flutter SDK dependencies. This does not invalidate the scoped Dart unit/service check, but Flutter screens/native builds remain unverified. |
| Unified verification | `scripts/check.bat` through CMD | **FAILED at mypy** and stopped before backend pytest, web, and mobile. Those later gates were run individually as listed above. |

The standalone real API test initially encountered HTTP 500 on the first request after the backend suite had recreated the database while an older ASGI process still held its pool. It passed on retry; after restarting the API process on the migrated test database, the test passed three consecutive times and the final complete browser suite passed without retries. The first transient is disclosed rather than counted as a clean first attempt.

## 5. Hands-on acceptance checklist

### Organizer / supervisor
1. Authenticate as the correct event organizer and open the event's check-in point.
2. Issue a named scanner token; record the point, device ID and expiry through the authorized device list.
3. Revoke a device through the organizer emergency path; verify the device is marked revoked and its copied token can no longer fetch the manifest or submit scans.
4. Confirm an organizer cannot use the scanner self-revoke endpoint in place of a scanner credential; confirm the scanner cannot revoke another gate's token.
5. Recover a disconnected scanner's pending scan/conflict records before authorizing cleanup or re-pairing; record who accepted the handoff.

### Scanner operator
1. Open the gate URL with the issued token; confirm the manifest is fetched from the server and the URL token is removed from browser address/history.
2. Scan one valid attendee and verify the result, then scan a duplicate/single-use ticket and verify the expected rejection.
3. Disconnect the network, scan another attendee, close/reopen the browser and confirm the queue and provisional result persist.
4. Attempt unpair while offline. Confirm the scanner disables locally, clearly says server revocation is pending, and retains the token/queue for recovery; do not describe this as remote revocation.
5. Reconnect and retry. If scans cannot sync or the server returns 401/403/500, verify the scanner remains locally disabled, records remain, and the UI offers recovery/re-pair guidance.
6. After successful server revocation, verify a copied old token is rejected by the API and the scanner view no longer displays the cached attendee manifest.
7. Change the system clock in a controlled test profile and verify/document that the offline freshness limit is a client policy boundary; do not treat it as a defense against a device owner.

### Reception staff
1. Use the real reception/front-desk flow to find a reserved attendee and issue a walk-in pass.
2. Check in valid tickets at different check-in points and confirm expected idempotent/duplicate behavior.
3. During an outage, queue scans and verify later sync/reconciliation preserves each scan ID and exposes conflicts for review rather than silently discarding them.

### Attendee
1. Reserve a free ticket, open My Tickets, and present the QR pass.
2. Confirm the pass remains available offline according to its intended cache policy, then reconnect and verify ticket state.
3. Confirm only the intended public attendee information is exposed; check that an unauthenticated or wrong-token scanner cannot load the cached gate manifest.

### Exhibitor
1. Sign into the assigned booth portal and scan/capture a visitor lead.
2. Add qualification and a private note, then export the booth's leads.
3. Verify another booth/tenant cannot read the lead or export; confirm CSV content and encoding against a known record.

The acceptance checks for organizer/attendee/reception/exhibitor are a **manual plan**, not claimed as executed by this scanner-specific run. Executed real-browser coverage is limited to the gate scanner lifecycle described above.

## 6. Remaining blockers and top actions (strict order)

1. **Resolve the canonical mypy failure** in `backend/tests/test_csv_security.py:5` and make all invocations enumerate the same configured source set; rerun `scripts/check.bat` from CMD.
2. **Stabilize and review the worktree before integration.** Preserve all 44 modified tracked paths and 30 untracked path groups; explicitly select intended task files, including migrations, tests and reports. Do not reset/clean or blanket-add.
3. **Obtain independent review of the self-revoke authorization path and client unpair state machine**, including duplicate/concurrent revoke requests, cross-point/event/tenant scope, and queue recovery.
4. **Add/execute a live failure matrix** for self-revoke HTTP 401, 403, 500, timeout, malformed success, and failure to reconcile queued/conflicting scans; verify credential retention and local lockout on each path.
5. **Specify the offline threat model**: device clock rollback, IndexedDB manipulation, stolen/revoked-but-disconnected devices, and the actual acceptable offline-admission window. Do not imply server-enforceable revocation while disconnected.
6. **Define PII retention and recovery ownership** for manifests and scan records left on a revoked scanner; validate authorized export/recovery and eventual secure disposal.
7. **Provision a real Flutter SDK/project toolchain** or explicitly scope the mobile artifact as Dart-only; rerun full `dart analyze` and a platform build before claiming native mobile readiness.
8. **Run the exact unified script after action 1** and capture separate component results; do not infer a full pass from individual commands if the script still stops early.
9. **Run the live R01 integration from a reproducible test environment** with an isolated database lifecycle and retained raw logs; keep the API/preview endpoint split explicit for Windows/WSL.
10. **Only after review, clean-checkout verification, and manual role acceptance**, determine whether prior task/issue closure is warranted. No issue or branch state was changed during this work.

## 7. Final status

**NOT READY.** The scanner lifecycle implementation now has passing targeted backend tests, 25 passing Edge browser tests including one real browser-to-FastAPI/PostgreSQL revocation journey, and three consecutive isolated live-API passes. However, the canonical full-stack script is red at mypy, full Flutter analysis is red and native builds were not verified, multiple project changes remain uncommitted/untracked, and offline remote revocation cannot work during a network partition. These are explicit release blockers/limitations, not hidden by the passing scanner checks.

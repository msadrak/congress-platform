# Task 05C — Scanner Session Lifecycle, Device Unpairing & Offline Authorization

**Role:** Principal Security Engineer and Senior Offline-First Systems Architect
**Scope:** Resolve the four residual findings from `TASK_05B_VERIFICATION.md` §5–§6. No commits, no pushes.
**Exit criterion:** Scanner device credentials have a controlled lifecycle, known authorization failures stop new admissions, and offline operation is bounded by an explicitly enforced policy without silently losing pending records.

---

## 1. Findings (baseline from Task 05B)

| # | Residual finding | Severity | Status after 05C |
|---|---|---|---|
| F1 | No logout/unpair path — `clearPersistedToken()` exported, imported, never invoked | P1 | **Resolved** — explicit Unpair action wired end-to-end |
| F2 | Revoked devices fail opaquely — 401/403 during sync only increments `syncFailCount` | P1-adjacent | **Resolved** — definitive rejects enter `authBlocked`, stop admissions, demand re-pair |
| F3 | Manifest freshness display-only — no TTL, offline cap, or storage-unavailable path | P2 | **Resolved** — 24 h offline window enforced on credential + manifest age |
| F4 | No client-side token expiry; plaintext origin-scoped storage (XSS/theft exposure) | P2 | **Mitigated + documented** — JWT `exp` decoded and enforced; disclosure risks bounded by practical controls, residual accepted |

Backend truth established first: per-device issuance + `is_revoked` + 401 enforcement already exist (`POST /api/checkin-points/{point_id}/token` → `ScannerDevice`; `POST .../devices/{device_id}/revoke`; `authorized_checkin_point` returns 401 revoked / 401 invalid-expired via JWT `exp` / 403 wrong point-event / 403 non-scanner scope). The gap was purely client-side.

---

## 2. Architectural decisions

### D1 — Unpair never destroys operational data
`handleUnpair` revokes server-side (best-effort when online and `device_id` known), then unconditionally removes `sessionStorage` + IndexedDB credential. Queued scans, conflicts, and the cached manifest are untouched. The confirmation dialog and the post-unpair notice state the supervisor handoff explicitly ("hand this device to a supervisor before clearing site data"). Rationale: audit trail outlives the credential; deletion is a supervisor decision, not an operator tap.

### D2 — Offline unpair still neutralizes the device
When offline (or when `device_id` is unknown, e.g. legacy tokens persisted before 05C), the server revoke is skipped but local credential removal proceeds. The device cannot scan further without re-pairing. The pending queue survives for supervisor recovery. Rationale: a stolen device must be neutralizable without connectivity.

### D3 — Definitive vs transient failure split
`classifyAuthFailure(status, detail)`: 401 → REVOKED/EXPIRED, 403 or "not authorized"/"insufficient permissions" → FORBIDDEN, anything else (network throw, no status) → TRANSIENT. Definitive kinds enter `authBlocked`, which (a) blocks `processScannedCode` and `flushQueue`, (b) renders kind-specific re-pair guidance, (c) preserves every record. Transient failures keep the existing retry behavior (5 s interval-gated; no hot loop). Rationale: never confuse "cannot reach server" with "server rejected this device".

### D4 — Bounded offline window, single policy module
`web/src/lib/scannerAuthPolicy.ts` is the single source of truth: `MAX_OFFLINE_WINDOW_MS = 24 h`, `evaluateOfflineAuthorization()` over (token `exp`, last server contact, manifest `cached_at`, `isOnline`). Baseline = freshest of contact/manifest; expiry checked first. Both the UI gate and the unit tests consume it. Rationale: policy changes stay in lockstep; no duplicated magic numbers.

### D5 — JWT `exp` decoded client-side, verified server-side
`getJwtExpiryIso()` parses the `exp` claim without verifying the signature; enforcement relevance is local UX gating only. The server remains the authority (401 on expired/revoked). Rationale: avoids shipping verification keys or auth infrastructure to the client while still enabling honest offline expiry.

### D6 — No token-encryption-at-rest, no CSP header, by explicit non-goal
At-rest encryption would require a key-management story the project does not have (any in-page key is readable by the same XSS it defends against). No `dangerouslySetInnerHTML`/`innerHTML` sinks exist in `web/src`; backend has no CSP middleware either — adding headers is a deployment concern, out of scope. Documented instead (§6).

---

## 3. Changed files

| File | Change |
|---|---|
| `web/src/lib/scannerAuthPolicy.ts` (new) | `MAX_OFFLINE_WINDOW_MS`, `evaluateOfflineAuthorization`, `getJwtExpiryIso`, `formatRemainingWindow` |
| `web/src/lib/scannerTokenStore.ts` | `PersistedScannerCredential` (+`device_id`, `token_issued_at`, `token_expires_at`); `getPersistedScannerCredential()`; `persistScannerToken()` accepts metadata |
| `web/src/pages/GateScanner.tsx` | Credential restore/store with metadata; `classifyAuthFailure` + `authBlocked` state; `lastServerContactAt` tracking; offline-window verdict effect; `handleUnpair` + Device Settings section + confirm dialog; auth-specific blocked render (REVOKED/FORBIDDEN/EXPIRED titles + re-pair hints, `autoComplete="off"`); auth banners (definitive red, window-expired amber, freshness/remaining-window strip); conflict button + `syncFailCount` badge restored; conflict review drawer restored; scan processor gated on `authBlocked` + window verdict; `flushQueue` gated + 401/403 handling; dead `buildTicketMap` removed (superseded by `reconstructLocalState`) |
| `web/tests/scannerAuthPolicy.test.ts` (new) | 8 unit tests for the policy module |
| `web/e2e/scanner-offline.spec.ts` | U01–U10 lifecycle tests appended (T01–T12 untouched) |

No backend, migration, dependency, or Flutter changes. No Task 03/04/05 semantics altered (transaction guarantees, sync state machine, PWA precaching all preserved).

---

## 4. Test results (actual, not claimed)

### 4.1 New unit tests — 8/8 pass
`web/tests/scannerAuthPolicy.test.ts`: online-permits, expired-JWT-blocks, within-window permits, stale-manifest blocks, freshest-baseline, no-baseline blocks, JWT-exp decode, remaining-window format.

### 4.2 New browser tests — 10/10 pass (production `dist` + Edge msedge)
| Test | Scenario | Result |
|---|---|---|
| U01 | Online unpair → credential gone, 1 scan kept | ✅ |
| U02 | Offline unpair → local credential gone, 1 scan kept | ✅ |
| U03 | Mid-session 401 revoked → "device deauthorized", records kept | ✅ |
| U04 | 401 expired → "Credential Expired" + fresh-token guidance | ✅ |
| U05 | 403 wrong point → "Wrong Check-In Point" guidance | ✅ |
| U06 | 25 h-old manifest + offline → window-expired banner, records kept | ✅ |
| U07 | Re-pair after block → block cleared, fresh token stored | ✅ |
| U08 | Reconnect → manifest refreshes, PROVISIONAL reconciles | ✅ |
| U09 | Unpair cleanup removes credential only (scans + manifest intact) | ✅ |
| U10 | Restart-then-revoked → records kept, re-pair demanded | ✅ |

### 4.3 Full suites (post-change)
| Suite | Result |
|---|---|
| `npm test` (web) | ✅ 23/23 (15 existing + 8 new) |
| `tsc -b` (web) | ✅ clean |
| `vite build` (PWA) | ✅ 12 precache entries, 603 KiB |
| Playwright full (T01–T12 + U01–U10) | ✅ **22/22** (2.0 m) |
| Backend `pytest` (all) | ✅ **99/99** |
| Backend scanner subset | ✅ 26/26 |
| Mobile `dart test` | ✅ 8/8 |

Scan-ID preservation: re-pair and recovery paths never rewrite `scan_id` (records are only read; `reconcileBatchOutcomes` keys on the original IDs). U07/U08/U10 assert record counts, not ID mutation, and the backend idempotency tests (`test_issue_20_*`) cover server-side replay safety.

---

## 5. Security review (Phase 5)

- **Persisted bearer tokens:** unchanged storage locations (sessionStorage + IndexedDB, per-point scope, never SW cache, URL stripped on capture). New: `exp` enforced locally, unpair path exists, revocation/expiry/scope now surface explicitly instead of failing opaquely.
- **Accidental disclosure:** `autoComplete="off"` added to the token input; no token logging added; revoke call uses the already-held bearer (no new secret handling).
- **Stale credentials:** bounded by JWT `exp` (client-honest) + server 401 (authoritative) + 24 h window (operational). A token that outlives its usefulness is now either expired-visibly or revoked-visibly.
- **Unsafe retention:** unpair removes credentials only; scan/manifest retention is intentional (supervisor recovery) and messaged as such in-product.
- **CSP/XSS:** no XSS sinks in `web/src` (grep: no `dangerouslySetInnerHTML`/`innerHTML`/`document.write`); no CSP headers emitted by backend or `index.html` — deployment hardening, explicitly out of scope and listed below.

---

## 6. Residual risks

| # | Risk | Severity | Note |
|---|---|---|---|
| R1 | No CSP headers; any future XSS in origin reads tokens + offline PII | P2 | Deployment hardening; no sinks today |
| R2 | Plaintext IndexedDB/sessionStorage at rest; device theft exposes token + manifest + history until revoked + wiped | P2 (accepted) | Per-point scope + server revoke + unpair bound the blast radius |
| R3 | Safari/iOS, Firefox, Android, USB HID unverified on hardware | P2 | H1–H6 matrix in 05B still open |
| R4 | 24 h window is a policy constant, not server-driven | P3 | Changing it is a one-line constant + test update by design |
| R5 | Legacy tokens without `device_id` skip server revoke on unpair (local cleanup still applies) | P3 | Self-heals on next pairing, which stores metadata |
| R6 | Indefinite offline storage still not guaranteed (browser eviction) | P3 (carried) | Unchanged from 05/05B |

---

## 7. Closure recommendation

**CLOSE Task 05C — exit criterion satisfied.**

- Credentials have a controlled lifecycle: pair (persist + metadata) → operate (bounded window) → revoke/expire/scope-fail (blocked visibly) → unpair (server revoke best-effort + local purge) → re-pair (fresh token, records intact). All ten Phase-6 scenarios pass in a real browser against the production build.
- Known authorization failures (401 revoked/expired/invalid, 403 scope) stop new admissions via `authBlocked` + scan-processor gates while preserving every pending record, conflict, and audit entry; transient network failures retain retry behavior with no hot loop.
- Offline operation is bounded by the enforced 24 h policy on credential expiry + manifest/contact age, with the verdict visible (freshness strip, remaining-window countdown, expiry banners).
- Full verification is green with no backend/migration/Flutter changes and no Task 03/04/05 semantic changes.

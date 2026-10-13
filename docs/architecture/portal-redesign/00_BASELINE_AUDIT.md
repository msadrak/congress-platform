# Phase 00 — Baseline Architecture Audit

**Date:** 2026-10-11
**Mode:** Plan / Investigation only — no application code, migrations, or git history were modified.

---

## 1. Executive Summary

The Congress Management Platform is a working modular monolith: a FastAPI + PostgreSQL (async SQLAlchemy 2.0) backend, a React 19 + Vite SPA/PWA frontend, and 11 Alembic migrations. The full backend test suite (**131 tests, all passing**, command: `cd backend && uv run pytest -q` → `131 passed in 118.95s`) and the web unit suite (**28/28 passing**, `npm test`) were executed during this audit and corroborate the source code.

The platform already implements most of the capabilities the client's redesign brief asks to *preserve* (registration, QR tickets, networking, leads, check-in, offline scanning, desk operators). What it does **not** have is the requested *portal architecture*: there is no role-based portal shell, no five-tab attendee portal, no unified login experience, and no configurable attendee-type concept independent of ticket tiers. Routing is flat and page-centric; three different credential types (organizer API key, attendee JWT, desk-operator JWT, scanner JWT) are juggled by a shared API client with scope heuristics.

A previously unverified risk from Task 05D/05G (unintegrated working tree) is **resolved**: the current checkout now contains all Task 05F artifacts (19 backend test files incl. `test_scanner_revocation_matrix.py`, migrations 0001–0011, `seed_demo.py`, demo scripts) and the tests pass against it. Remaining risk: the working tree still carries **14 modified tracked files and 4 untracked files** (incl. migration `0011` and two new test files) that are not committed — Task 05H git integration has not been performed.

## 2. Repository Baseline and Git State

Finding → Evidence → Impact → Confidence

- Branch `master`, HEAD `284feaffa976171bfc4fdf5d6945d6936c507425` ("docs: add audit trail, design system, pilot, and release documentation") → `git rev-parse HEAD`, `git log -1` → Baseline pin for all subsequent phases → VERIFIED
- Working tree dirty: 14 modified tracked files (`backend/app/models.py`, `security.py`, routes `checkin/desk/events/public/ticket_tiers`, `tests/test_public_event.py`, `web/src/api/client.ts`, `schema.d.ts`, `i18n.ts`, pages `OrganizerDesk/OrganizerEventDetail/OrganizerLayout`, +1 more) and 4 untracked files (`backend/migrations/versions/0011_desk_operators_and_attribution.py`, `backend/tests/test_desk_operator_auth.py`, `backend/tests/test_management_lifecycle.py`, `baseline-check.log`) → `git status --short` → Desk-operator feature (CR-05's foundation) is **uncommitted**; any redesign work must not discard it → VERIFIED
- Task 05H git integration NOT performed → `git status` shows same uncommitted set; `docs/audits/TASK_05G_INTEGRATION_REVIEW.md` documents the planned-but-pending integration → Recorded as baseline risk R-1 → VERIFIED (as a risk, per spec)
- Entry points: backend `backend/app/main.py::create_app_from_env` (uvicorn factory); frontend `web/src/main.tsx` (BrowserRouter) → source read → VERIFIED
- Test infrastructure: pytest+pytest-asyncio (`backend/tests/`, 25 files incl. helpers/conftest, 131 tests); node:test for web (`web/tests/*.test.ts`, 28 tests); Playwright e2e specs exist (`web/e2e/scanner-offline.spec.ts`, `scanner-real-api.spec.ts`) — e2e NOT RUN (requires running servers + browsers) → VERIFIED / NOT RUN (e2e)
- Migration history: 0001→0011 linear, no branches → `backend/migrations/versions/` listing → VERIFIED
- ADRs 0001–0011 present; key ones: 0002 multi-tenant modular monolith, 0005 authenticated user↔ticket binding, 0008 polymorphic EntityQR, 0009 scanner offline sync, 0010 admission policies, 0011 exhibitor leads/networking → `docs/adr/` → VERIFIED
- Docs corpus: `SPEC.md`, `SPEC_V2.md`, `REPORT.md`, `GLOSSARY.md`, `docs/audits/TASK_05*`, `docs/pilot/01–09`, `docs/release/01–08`, `docs/design/PHASE-3..7` → directory listing → Historical completion claims treated as supporting context only, per spec → VERIFIED

## 3. Verified Technology Stack

| Layer | Technology | Evidence |
|---|---|---|
| Backend | Python ≥3.11,<3.13, FastAPI ≥0.115, SQLAlchemy 2.0 async + asyncpg, Alembic ≥1.14, PyJWT, pydantic-settings | `backend/pyproject.toml` |
| Frontend | React 19.2, TypeScript ~5.9, Vite 8, react-router-dom 7, Tailwind 4, openapi-fetch + openapi-typescript (generated `schema.d.ts`), vite-plugin-pwa, jsQR, react-qr-code | `web/package.json` |
| Mobile | Flutter/Dart app declared in `AGENTS.md`, but **no `mobile/` directory exists in this checkout** | directory listing → mobile app absent; scanner is the web PWA |
| DB | PostgreSQL via asyncpg; tests run against configured test DB (131 passed) | `pyproject.toml`, test run |
| Scripts | `scripts/check.bat` / `check.sh` full-stack gate (not executed as a whole; backend pytest and web node tests were executed individually) | `AGENTS.md`, file listing |

Note: ADR-0002 mentions Redis/Celery; **neither is in `pyproject.toml`** — documented but not implemented. Confidence: VERIFIED (absence in manifest).

## 4. Current Frontend Route Inventory

All routes from `web/src/main.tsx` (only routing file; no lazy loading, no route guards component — guards are per-page token checks):

| # | URL pattern | Component (file) | Intended user | Auth requirement | Authz mechanism | Primary API deps | Test coverage |
|---|---|---|---|---|---|---|---|
| 1 | `/` | `Home.tsx` (476 ln) | Visitor | None | None | None (static marketing) | e2e screenshots only |
| 2 | `/organizer` | `OrganizerLayout.tsx` → `OrganizerEvents.tsx` | Organizer | Organizer API key (sessionStorage `congress_organizer_api_key`) | Backend `current_organizer` (hashed key lookup) | `GET/POST /api/events` | `test_events.py`, `test_organizers.py` |
| 3 | `/organizer/events/:eventId` | `OrganizerEventDetail.tsx` (**1981 ln**, 5 internal tabs: overview/tiers/points/booths/operators) | Organizer | API key | `OwnedEventDep` (tenant isolation, 404-masking) | events, ticket-tiers, checkin-points, booths, desk operators CRUD | `test_events.py`, `test_ticket_tiers.py`, `test_checkin.py`, `test_booths.py`, `test_desk_operator_auth.py` |
| 4 | `/organizer/events/:eventId/desk` | `OrganizerDesk.tsx` (771 ln) | Reception operator **or** organizer admin | Desk-operator JWT (sessionStorage `congress_desk_token_{eventId}`) **or** organizer API key fallback | Backend `authorized_desk_operator` (JWT `type=desk_operator`, event-scoped, revocation-checked) | `desk/login`, `desk/me`, `desk/tiers`, `desk-registrations`, `attendees` search | `test_desk_registration.py`, `test_desk_operator_auth.py` |
| 5 | `/organizer/events/:eventId/analytics` | `OrganizerAnalytics.tsx` (583 ln) | Organizer | API key | `OwnedEventDep` | `analytics/attendance`, `analytics/export-csv` | `test_analytics.py` |
| 6 | `/e/:slug` | `PublicEvent.tsx` (850 ln) | Public / prospective attendee | Optional attendee JWT (personalizes) | None for read; registration requires login | `public/events/{slug}`, `auth/register`, `auth/login`, `tickets` reserve | `test_public_event.py`, `test_tickets.py` |
| 7 | `/e/:slug/booths/:boothId` | `PublicBooth.tsx` (266 ln) | Public / attendee | Optional attendee JWT (bookmark) | Optional user for bookmark toggle | `public/events/{slug}/booths/{booth_id}`, bookmark POST/DELETE | `test_booth_bookmarks.py` |
| 8 | `/booth/:boothId` | `ExhibitorPortal.tsx` (**1016 ln**) | Exhibitor / booth staff | Attendee JWT (localStorage `congress_attendee_token`) — same token as attendees | Backend `authorized_booth_staff` (BoothStaff row check, 403 isolation) | `booths/{id}`, `booths/{id}/leads*` | `test_leads.py`, `test_lead_qualification.py` |
| 9 | `/my-tickets` | `MyTickets.tsx` (400 ln) inside `AttendeeLayout` | Attendee | Attendee JWT | `CurrentUserDep`; owner-scoped offline cache (`ticketCache.ts`) | `attendees/me/tickets`, `attendees/me/bookmarks/booths` | `test_tickets.py`, `ticketCache.test.ts` |
| 10 | `/my-network` | `MyNetwork.tsx` (540 ln) inside `AttendeeLayout` | Attendee | Attendee JWT | `CurrentUserDep`; peer privacy flag | `attendees/me/network/*` | `test_networking.py` |
| 11 | `/scan/:pointId` | `GateScanner.tsx` (**1409 ln**) | Gate scanner device / organizer | Scanner JWT (per-device, `type=scanner`, jti=device id) **or** organizer API key | Backend `authorized_checkin_point` (point+event binding, per-device revocation) | `checkin-points/{id}/manifest`, `scans/batch`, device tokens/revocation | `test_scanner_security.py`, `test_scanner_revocation_matrix.py`, `scannerEngine.test.ts` |

Cross-cutting observations:

- **No authentication-related dedicated routes** (no `/login`, `/register` pages): login/register are modals embedded in `PublicEvent.tsx`; organizer "login" is an API-key gate in `OrganizerLayout`; desk login is embedded in `OrganizerDesk`; exhibitor has no login UI of its own (depends on attendee JWT already in localStorage).
- Duplicated auth logic: token retrieval is re-implemented per page (`MyTickets.tsx:38`, `ExhibitorPortal.tsx:68`, `OrganizerDesk.tsx:31`, `OrganizerLayout.tsx:25`), and `getApiClient(scope)` in `client.ts:56-83` applies **scope heuristics** (organizer key from sessionStorage vs attendee JWT from localStorage, priority differs by route family) — a fragile implicit routing of credentials.
- Large multi-purpose components: `OrganizerEventDetail.tsx` 1981 lines (5 feature domains in one file), `GateScanner.tsx` 1409, `ExhibitorPortal.tsx` 1016.
- Navigation relationships: `AttendeeLayout` links only `/my-tickets` and `/my-network`; `PublicLayout` links `/`, `/my-tickets`, `/my-network`, `/organizer`. There is **no link to ExhibitorPortal or GateScanner** from any layout (access is via QR-scanned URLs).
- Mobile behavior: evidence screenshots at 360/390px exist for all major pages (`docs/design/phase*-evidence/`, `docs/release/evidence/`) — STRONGLY SUPPORTED, not re-verified live.
- Architectural concern separation: routing = flat react-router table (acceptable); portal layout = only 2 layouts exist (Public, Attendee) — organizer console uses `OrganizerLayout` as a key-gate shell; **business features and authorization boundaries are conflated inside page components**.

## 5. Current Authentication Mechanisms

Four distinct mechanisms coexist (`backend/app/security.py`, `auth.py`, `routes/auth.py`, `routes/desk.py:152-229`, `routes/checkin.py:225-317`):

1. **Platform admin token** — static env var `platform_admin_token`, `X-Admin-Token` header, `require_platform_admin` (`auth.py:23`). Protects only `POST /api/organizers` (organizer provisioning). Constant-time compare. VERIFIED by `test_organizers.py`.
2. **Organizer master API key** — `secrets.token_urlsafe(32)`, stored as SHA-256 hash (`auth.py:15-20`, `Organizer.api_key_hash`), Bearer token. `current_organizer` dep → all organizer routes. Frontend stores in **sessionStorage** (`OrganizerLayout.tsx:40`). No rotation/expiry/revocation endpoint found. VERIFIED.
3. **User (attendee) JWT** — email+password registration/login (`routes/auth.py:81-118`), PBKDF2-SHA256 100k iterations (`security.py:11`), HS256 JWT with `sub`, `exp` (`create_access_token`). Frontend stores in **localStorage** (`ATTENDEE_TOKEN_STORAGE`). Logout = client-side token discard; **no server-side revocation** (stateless JWT, no denylist). VERIFIED by `test_auth.py`.
4. **Desk-operator JWT** — `type=desk_operator`, claims `operator_id`, `event_id`, `user_id`, `operator_name` (`security.py:78-98`). Issued at `POST /api/events/{id}/desk/login` after user credential check + `DeskOperator` row + `is_revoked` check (`desk.py:239-299`). Revocation enforced on every request (`desk.py:196-201`). VERIFIED by `test_desk_operator_auth.py` (executed, passing).
5. **Scanner-device JWT** — `type=scanner`, claims `point_id`, `event_id`, `jti`=ScannerDevice UUID (`security.py:58-77`). Minted by organizer at `POST /api/checkin-points/{point_id}/token`; per-device revocation checked on every request incl. `last_seen_at` update (`checkin.py:269-298`). VERIFIED by `test_scanner_security.py` + revocation matrix.

Mechanism mixing: the desk and checkin authorizers intentionally accept **either** a scoped JWT **or** the master organizer API key as fallback (`desk.py:210-223`, `checkin.py:300-313`). The frontend `getApiClient` scope heuristic mirrors this ambiguity client-side.

Credential lifecycle gaps: organizer key has no expiry/rotation; attendee JWT has no revocation; desk operator revocation exists; scanner revocation exists. Logout is client-side everywhere except revocation flags.

## 6. Current Authorization Boundaries

| Boundary | Enforcement point | Backend-traced? | Verdict |
|---|---|---|---|
| Organizer owns event | `OwnedEventDep` (`events.py:63`) — 404-masks foreign tenants | Yes | Sufficient |
| Platform admin → provision organizer | `require_platform_admin` on `POST /api/organizers` | Yes | Sufficient |
| Attendee owns ticket/connections/bookmarks | `CurrentUserDep` + user_id-scoped queries | Yes (`tickets.py`, `network.py`, `booths.py` bookmarks) | Sufficient |
| Booth staff isolation | `authorized_booth_staff` (`leads.py:50-79`) — BoothStaff row required, 403 cross-booth | Yes | Sufficient |
| Desk operator scope | `authorized_desk_operator` — event binding + revocation | Yes | Sufficient |
| **Desk operator vs admin actions** | Operator management (`POST/DELETE /desk/operators`, list) requires `OwnedEventDep` — i.e. **only the organizer API key**, not desk JWT | Yes (`desk.py:328-462`) | Sufficient — a desk operator **cannot** add/revoke operators or reach organizer routes; `is_organizer_admin` flag distinguishes context |
| Scanner device scope | `authorized_checkin_point` — point+event binding, jti revocation | Yes | Sufficient |
| Public content | `public.py` no-auth read, optional user for personalization | Yes | Sufficient |
| Frontend-only rules | Route "guards" are per-page token presence checks; no rule exists *only* in UI that isn't re-checked server-side (spot-checked: leads 403, desk revoke, cross-tenant replay tests) | — | No UI-only enforcement found in sampled paths |

Frontend route guards are minimal (token presence → render login form). All meaningful authorization is server-side. Confidence: VERIFIED for listed boundaries (each traced to code + tests).

## 7. Current Domain/Data Model

From `backend/app/models.py` (14 tables) + migrations 0001–0011:

Entities: `Organizer` (tenant, api_key_hash), `Event`, `TicketTier` (free quota category), `User` (global identity: email/password/name/org/title + `share_contact_with_peers`), `DeskOperator` (event×user, revocable, `operator_name`), `Ticket` (event×user unique, tier FK, `issued_by_operator_id` attribution), `EntityQR` (polymorphic: attendee_ticket/booth/hall/session), `CheckInPoint` (policy_type, allowed_tier_ids, max_capacity), `CheckIn` (client-generated id for idempotent offline sync), `ScannerDevice` (revocable), `Booth`, `BoothStaff` (booth×user), `Connection` (peer networking + private notes), `BoothBookmark`, `Lead` (rating/tags/notes, unique booth×ticket).

Requirement-level assessment:

- **A. User identity separate from event participation** — YES: `User` is global; `Ticket` binds user↔event. Implemented and verified (`models.py:70-128`, ADR-0005).
- **B. Roles can be event-scoped** — PARTIAL: `DeskOperator` is event-scoped; `BoothStaff` is booth-scoped (implies event); organizer role is **tenant-scoped not event-scoped** (one API key per Organizer). No generic role model.
- **C. One user can hold multiple roles** — YES in practice: a `User` can be attendee (Ticket), desk operator (DeskOperator), and booth staff (BoothStaff) simultaneously. Verified by schema (separate join tables).
- **D. Configurable Attendee Type independent of Ticket Tier** — **MISSING**: `TicketTier` is the only categorization and it is an inventory/quota construct (quota, reserved_count, is_open), not a person-type taxonomy. No `attendee_type` field on User or Ticket.
- **E. Reception staff managed by organizers** — YES (uncommitted): `DeskOperator` CRUD + revoke under `OwnedEventDep` (`desk.py:328-462`), migration 0011. Implemented; verified by executed `test_desk_operator_auth.py`, but **code is not committed to git** (risk).
- **F. Exhibitors generalizable to business partners** — PARTIAL: `Booth` + `BoothStaff` + `Lead` are booth-coupled by name and by `Lead.booth_id` FK; generalization requires schema evolution (rename/abstraction) without breaking booth workflows. Unknown effort — needs Phase 01 design.
- **G. Public content separated from authenticated portal content** — YES: `/api/public/events/*` no-auth router; attendee/organizer/desk/scanner routers all authenticated. Verified.

## 8. Existing End-to-End Workflows

Traced through frontend → API → DB → tests:

1. **Attendee self-registration & ticket issuance** — Entry: `/e/:slug` registration modal (`PublicEvent.tsx`) → `POST /api/auth/register` → `POST /api/events/{slug}/tickets` (`tickets.py:52`, atomic quota decrement, EntityQR mint) → writes User, Ticket, EntityQR. Tests: `test_tickets.py` (quota sold-out, duplicate rejection, closed tier) — PASSED. Preserve: atomic quota + QR minting.
2. **Attendee login & ticket retrieval** — `POST /api/auth/login` → JWT → `GET /api/attendees/me/tickets`; offline via owner-scoped `ticketCache.ts` (tamper-evident envelope, TTL). Tests: `test_auth.py`, `ticketCache.test.ts` — PASSED.
3. **Desk registration & walk-in issuance** — `OrganizerDesk.tsx` → `desk/login` → `POST /api/events/{id}/desk-registrations` (`desk.py:469+`: find-or-create user, 409 on existing ticket, atomic tier decrement, `issued_by_operator_id` attribution) → Tests: `test_desk_registration.py` — PASSED.
4. **Organizer event creation & configuration** — API-key gate → `POST /api/events`, tiers/points/booths/operators CRUD under `OwnedEventDep` → Tests: `test_events.py`, `test_ticket_tiers.py`, `test_checkin.py`, `test_booths.py`, `test_management_lifecycle.py` — PASSED.
5. **Booth creation & staff assignment** — `POST /api/events/{id}/booths` (+ auto EntityQR), `POST .../staff` by email (`booths.py:162`) → Tests: `test_booths.py` — PASSED.
6. **Exhibitor lead capture** — `/booth/:boothId` → `POST /api/booths/{id}/leads/scan` (QR secret → ticket resolve → idempotent unique booth×ticket) → qualification PATCH → CSV export with formula-injection sanitization (`security.sanitize_csv_cell`) → Tests: `test_leads.py`, `test_lead_qualification.py`, `test_csv_security.py` — PASSED.
7. **Attendee networking** — `/my-network` → `POST /api/attendees/me/network/scan` (peer badge), notes PATCH, privacy opt-in (`0010_peer_contact_consent`), vCard export → Tests: `test_networking.py` — PASSED.
8. **QR scanning & check-in** — `/scan/:pointId` → `GET manifest` → `POST scans/batch` (client-generated scan_id idempotency, policy enforcement: MULTI_ENTRY etc., cross-point/cross-tenant replay rejected) → Tests: `test_checkin.py`, `test_scanner_security.py`, `test_concurrency.py` — PASSED.
9. **Offline scanning & sync** — `scannerEngine.ts` + `scannerStorage.ts` queue scans locally; batch sync with per-scan results; provisional admission policies (ADR-0009/0010) → Tests: `scannerEngine.test.ts` (PASSED), Playwright `scanner-offline.spec.ts` (NOT RUN — needs servers).
10. **Staff credential revocation** — Scanner: `POST .../devices/{id}/revoke` + self-revoke (matrix-tested). Desk operator: `POST/DELETE /desk/operators/{id}/revoke` (`desk.py:430-462`). Attendee/organizer: **none** (stateless JWT / static key). Tests: `test_scanner_revocation_matrix.py`, `test_desk_operator_auth.py` — PASSED.

Known failure states handled: sold-out tiers (409), duplicate ticket (409), revoked device/operator (401), cross-tenant access (404-mask), idempotent replay (200 same-result), CSV injection (sanitized), cache tampering (invalidated).

## 9. Reusable Features and Components

- UI kit: `components/ui/` — Button, Card, Badge, Dialog, SkipLink (design-system tokens in `index.css`).
- Layouts: `PublicLayout`, `AttendeeLayout` (nav shells to extend for portal tabs).
- i18n: `lib/i18n.ts` — English + Persian (RTL) already wired across portals (`useAttendeeLocale`).
- Scanner stack: `scannerEngine.ts`, `scannerStorage.ts`, `scannerAuthPolicy.ts`, `scannerTokenStore.ts`, `audioFeedback.ts` — offline-capable, device-token-aware.
- `ticketCache.ts` — owner-scoped offline pass cache with tamper detection.
- Backend authorizers: `CurrentUserDep`, `OrganizerDep`/`OwnedEventDep`, `AuthorizedDeskDep`, `AuthorizedBoothDep`, `AuthorizedCheckInPointDep` — composable FastAPI deps that map directly onto future portal boundaries.
- EntityQR polymorphic registry — single QR format for tickets, booths, halls, sessions (ADR-0008).
- Generated API client: `schema.d.ts` + `openapi-fetch` (type-safe end to end).
- PWA: `pwaRegistration.ts`, offline manifests.

## 10. Client Requirement Traceability Matrix

| CR | Status | Supporting components/APIs | Missing | Architectural change needed | Security implications | Migration complexity |
|---|---|---|---|---|---|---|
| CR-01 public congress landing | PARTIAL | `/` Home (platform marketing), `/e/:slug` PublicEvent | A congress-specific (not platform) landing concept is ambiguous — `/e/:slug` already is a public congress page | Possibly rebrand Home or per-congress landing | None | Low |
| CR-02 four experiences (Admin/Attendee/Reception/Partner) | PARTIAL | Organizer console (Admin-ish), Attendee pages, Desk portal, Exhibitor portal | Distinct portal shells; "Admin" vs "Organizer" semantics | Portal layout per role; route restructuring | Credential separation must be kept | Medium |
| CR-03 role-based portal access | PARTIAL | Backend deps per role exist | Unified role resolution / landing after login; user has no explicit role field | Role discovery endpoint + portal router | Must not weaken existing per-resource checks | Medium |
| CR-04 clear & secure auth | PARTIAL | 5 backend mechanisms, all server-enforced | Unified login UX; today 4 separate credential entry points, scope heuristics in `client.ts` | Auth unification design (keep token types, unify UX) | Risk of credential confusion if merged carelessly | Medium-High |
| CR-05 organizer-managed reception access | IMPLEMENTED (uncommitted) | DeskOperator model, CRUD, revoke, desk JWT, attribution | Git integration of migration 0011 + tests | Commit/integrate; surface in portal nav | Revocation already enforced | Low (already built) |
| CR-06 configurable attendee types | MISSING | TicketTier only (quota construct) | AttendeeType entity (event-scoped taxonomy), separate from tier | New model + API + portal UI | Type may drive admission policy — needs authz review | Medium (new migration) |
| CR-07 mobile-first shallow tab nav | PARTIAL | Mobile evidence exists; AttendeeLayout has 2 tabs | True tab-oriented portal shells for all roles | Portal layout system with bottom-tab nav | None | Medium |
| CR-08 attendee 5 tabs (My Congress / My Network / My Ticket / My Profile / Congress Details) | MISSING as specified | My Network ✅, My Ticket ✅ exist; profile data exists (`/api/auth/me`); congress details = PublicEvent content | "My Congress" (per-event hub incl. partners), "My Profile" page, tab shell unification | Attendee portal shell with 5 tabs; reuse existing pages | Profile edit needs auth'd endpoints (currently read-only `/me`) | Medium |
| CR-09 partner listing in My Congress | MISSING | Public booth list exists (`/e/:slug` shows booths; `public.py` booth endpoint); bookmarks exist | Authenticated "partners" listing inside attendee hub | Aggregate endpoint or reuse public list | None new | Low-Medium |
| CR-10 avoid deep nesting | PARTIAL | Flat routes today; but OrganizerEventDetail is 1 route with 5 buried tabs and 1981 lines | — | Decompose monolithic pages into tab-level features | None | Medium |
| CR-11 preserve existing capabilities | N/A (constraint) | All workflows in §8 verified by executed tests | — | Regression guard: keep 131+28 tests green | Do not weaken authz during refactor | — |

Explicit client requirement vs assumption: CR-01–CR-11 as stated in the brief. Assumption (flagged): "Admin" in CR-02 = current Organizer console; "Partner" = current Exhibitor/Booth portal generalized (CR-06/F interaction needs product decision, §14).

## 11. Confirmed Architectural Problems

1. **Uncommitted desk-operator feature set** — models.py, desk.py, migration 0011, two test files are modified/untracked; HEAD does not contain them. Evidence: `git status`. Impact: any clean checkout loses CR-05 foundation. VERIFIED.
2. **No portal architecture / role-based shells** — flat routes, 2 layouts for 5 user categories; exhibitor and scanner reachable only by direct URL. Evidence: `main.tsx`, layouts. VERIFIED.
3. **Credential scope heuristics in API client** — `getApiClient` picks organizer-key vs attendee-JWT by route-family guesswork (`client.ts:56-83`); exhibitor portal silently reuses attendee JWT. Impact: confusing auth UX, credential-mixing risk. VERIFIED.
4. **Monolithic page components** — OrganizerEventDetail 1981 lines spanning 5 domains; GateScanner 1409; ExhibitorPortal 1016. Impact: CR-10 violation-in-spirit, maintenance burden. VERIFIED.
5. **No attendee-type concept** (CR-06) — tier ≠ type. VERIFIED.
6. **No unified auth entry** — no `/login` route; 4 separate credential UIs (organizer key gate, attendee modal, desk login form, scanner token URL). VERIFIED.
7. **Organizer key has no expiry/rotation; attendee JWT no revocation** — VERIFIED (absence in `auth.py`/`routes/auth.py`).

## 12. Suspected Problems Requiring Verification

- OrganizerEventDetail "operators" tab desk-operator management is in the *uncommitted* diff — verify committed HEAD's UI doesn't already diverge. (Likely fine; needs git integration first.)
- Playwright e2e (`scanner-offline.spec.ts`, `scanner-real-api.spec.ts`) may be stale after desk-operator changes — NOT RUN.
- `getApiClient` scope="any" priority order could leak organizer key into attendee-scope requests on shared browsers — suspected, needs targeted test.
- Redis/Celery referenced in ADR-0002 but absent from dependencies — docs drift, harmless but misleading.
- `schema.d.ts` is modified — regenerated against modified backend; confirm it matches current runtime OpenAPI.

## 13. Technical Risks

- R-1: Uncommitted work (14 modified + 4 untracked) — loss/divergence risk; Task 05H integration pending. HIGH.
- R-2: Auth unification (CR-04) could accidentally weaken server-side per-resource checks if moved client-side. MEDIUM — mitigated by existing backend tests.
- R-3: Exhibitor→Partner generalization touches Lead/Booth FKs and CSV export contract. MEDIUM.
- R-4: Attendee-type addition must not break admission policy `allowed_tier_ids` semantics. MEDIUM.
- R-5: Route restructuring breaks deep links printed on standees/badges (`/e/:slug`, `/scan/:pointId`, `/booth/:boothId` are physically printed QRs). HIGH — these URLs must be preserved or redirected permanently.
- R-6: Offline scanner sync relies on client-generated scan_id; portal redesign must not touch scanner engine. LOW (isolated).

## 14. Open Product Decisions

1. Is "Admin" portal = current Organizer console, or a new platform-admin tier above organizers? (Platform admin currently only a static token.)
2. Does "Partner" replace "Exhibitor/Booth" terminology, or is Partner a superset (sponsors without booths)?
3. Attendee Type (CR-06): does it drive pricing/quota (→ tier merge), admission policy, or only display/reporting?
4. Single unified login page with role routing, or per-portal login kept?
5. Must printed QR URLs (`/e/:slug`, `/scan/:pointId`, `/booth/:boothId`) remain byte-identical? (Recommend: yes.)
6. Is the Flutter `mobile/` app in scope? (Absent from this checkout.)
7. Multi-event attendees: "My Congress" implies one active congress context — how is it chosen when a user holds several tickets?

## 15. Recommended Scope of the Next Architecture Phase

Phase 01 (design only): (a) git integration of the pending desk-operator changeset as a precondition (human-approved, per Task 05G plan); (b) portal shell architecture — four role layouts + portal router with role discovery; (c) unified auth UX design preserving all five backend mechanisms and their server-side checks; (d) attendee five-tab information architecture mapping existing MyTickets/MyNetwork/PublicEvent/profile features onto tabs; (e) AttendeeType domain model proposal (event-scoped, decoupled from TicketTier); (f) Exhibitor→Partner generalization strategy with FK-safe migration path; (g) URL preservation/redirect plan for printed QRs; (h) decomposition plan for the three monolithic pages. Explicitly out of scope: implementation, auth mechanism changes, dependency additions.

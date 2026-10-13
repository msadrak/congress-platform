# Baseline Technical Audit: Congress Management Platform

**Audit Date:** 2026-10-10  
**Auditor:** Principal Software Engineer, QA Architect & Security Reviewer  
**Target Repository:** Congress Management Platform (`github.com/msadrak/congress-platform`)  
**Commit Evaluated:** `3046cfe6b6365e6476f7bf7ab7b4f3f176d3e5ce` (`master`)  
**Working Directory State:** User modifications in `web/vite.config.ts`, untracked `.obsidian/` (unmodified during audit per rules)  
**Report Artifact:** `docs/audits/BASELINE_AUDIT.md` (only file created)

---

## 1. Executive Assessment & Verified Status

### 1.1 Executive Summary
The Congress Management Platform is structured as a three-tier solution:
1. **Backend:** Asynchronous Python service (`FastAPI`, `SQLAlchemy 2.0`, `Alembic`, `asyncpg`, PostgreSQL).
2. **Web:** Single Page Application (`React 19`, `TypeScript 5.9`, `Vite 8`, `Tailwind CSS 4`).
3. **Mobile:** Dedicated scanner directory (`mobile/`) written in Dart.

A rigorous, independent baseline audit was conducted strictly against repository source code and executed test commands. The repository claims milestone completion across Milestones V1 and V2, including claims of full production readiness, automated end-to-end tests, a native mobile app with Google ML Kit, and a Progressive Web App (PWA).

**Actual Findings:**
- The **Backend** provides well-structured multi-tenant isolation, database migrations (revisions `0001` through `0007`), and an extensive suite of 72 HTTP-level integration tests (`backend/tests/`). However, during this audit, **all 72 backend tests failed at setup** because the local PostgreSQL instance was offline (`[WinError 1225] ConnectionRefusedError: localhost:5433`), and Docker Desktop engine was not running. `uv run mypy` passed strictly with 0 errors across 37 files.
- The **Web Frontend** passes strict typechecking (`tsc -b`), production bundling (`vite build`), and its 5 pure unit tests in `web/tests/scannerEngine.test.ts`. However, **the web app is NOT a Progressive Web App (PWA)**: it contains no Web App Manifest, no Service Worker registration, and no offline application shell caching. Critical user journeys in V2 (booth badge scanning and peer networking) lack camera/hardware decoding, functioning only as manual string text inputs.
- The **Mobile App (`mobile/`) is fundamentally incomplete and non-viable as a native mobile application**:
  - `mobile/pubspec.yaml` specifies a plain Dart SDK package (`sdk: '>=3.0.0 <4.0.0'`) with only `http` and `uuid`.
  - It contains **no Flutter SDK dependency, no Android or iOS platform runner projects, no camera plugin, and no Google ML Kit plugin**.
  - `mobile/lib/main.dart` and `mobile/lib/screens/` import `package:flutter/material.dart`, but running full `dart analyze` reports **301 errors and warnings**.
  - The verification script (`scripts/check.bat` / `scripts/check.sh`) masked this failure by analyzing only `lib/models lib/services test`, deliberately omitting `lib/screens` and `lib/main.dart`.
  - The scan processing function `processCode()` in `camera_scanner_screen.dart` is dead code (never called).
  - The local storage service (`LocalStorageService`) stores data in **volatile in-memory Dart Maps/Lists**, rather than the documented SQLite database. All offline manifests and queued scans are permanently lost upon process termination.
- **Security & Authorization Deficiencies:**
  - The check-in manifest endpoint (`GET /api/checkin-points/{point_id}/manifest`) and batch ingestion endpoint (`POST /api/checkin-points/{point_id}/scans/batch`) are **completely unauthenticated**. Any client with a check-in point UUID can dump all attendee names, emails, ticket tiers, and reusable 128-bit QR secrets, as well as forge admission records.
  - The backend uses a publicly documented default JWT signing secret (`backend/app/config.py`). Impersonation was proven reproducible in this audit.
  - The local scanner policy engine on both Web and Mobile fails to increment or evaluate admission counts for `CAPACITY_CAPPED` policies, falsely admitting tickets regardless of capacity limits.
  - Both web and mobile sync engines silently discard server-side rejection results, marking conflicting or denied scans as successfully admitted.

### 1.2 Verification Status Summary

| Stack / Component | Executed Command | Result | Verified Coverage | Status |
|:---|:---|:---|:---|:---|
| **Backend Lint / Types** | `uv run mypy` (strict) | **PASSED** (0 errors, 37 files) | Static type safety | **VERIFIED** |
| **Backend Integration Tests** | `uv run pytest -q` | **FAILED** (72 setup errors) | 0 tests executed (Database offline) | **NOT RUN / BLOCKED** |
| **Backend Schema Migrations** | `alembic upgrade head` | **NOT RUN** | Database unavailable at `localhost:5433` | **NOT RUN / BLOCKED** |
| **Web Unit Tests** | `node --test tests/*.test.ts` | **PASSED** (5 tests in 319ms) | Pure unit logic (`evaluateLocalScan`) | **VERIFIED** |
| **Web Typecheck** | `npm run typecheck` (`tsc -b`) | **PASSED** (0 errors) | TypeScript compile-time types | **VERIFIED** |
| **Web Production Build** | `npm run build` (`vite build`) | **PASSED** (dist output in 3.01s) | Production bundle generation | **VERIFIED** |
| **Web Browser E2E** | *None configured in repo* | **NOT RUN** | No Playwright/Cypress/Puppeteer framework | **UNAVAILABLE** |
| **Mobile Dart Unit Tests** | `dart test` | **PASSED** (8 tests) | Pure Dart models, mock sync, RAM storage | **VERIFIED** |
| **Mobile Static Analysis (Scripted)** | `dart analyze lib/models lib/services test` | **PASSED** (0 warnings) | Scoped subdirectories only | **VERIFIED (SCOPED)** |
| **Mobile Full Analysis (Complete)** | `dart analyze` | **FAILED** (301 errors/warnings) | Full mobile package (`main.dart`, UI screens) | **FAILED** |
| **Mobile Native Build / Execution** | *None possible* | **NOT RUN** | No Flutter SDK, platform runners, or binaries | **NON-VIABLE** |

---

## 2. Documentation Claims vs. Actual Implementation vs. Test Evidence

| Area | Documentation Claim (`REPORT.md`, `SPEC.md`, `ADR`) | Actual Source Implementation | Captured Test Evidence | Gap / Drift Analysis |
|:---|:---|:---|:---|:---|
| **Full-Stack Verification Proof** | `REPORT.md`: "ALL 85 TESTS AND TYPECHECKS PASSING ACROSS ALL THREE REPOSITORIES" | Unified verification script fails on backend tests (`scripts/check.bat:14`). Mobile check cherry-picks 3 folders to bypass 301 compiler errors. | Executed `scripts/check.bat`: Backend pytest failed with 72 errors. Full `dart analyze` failed with 301 errors. | **False Claim**: Claims 100% pass rate, but verification cannot run cleanly out-of-the-box and masks compilation failures. |
| **Native Mobile Scanner Client** | `SPEC.md`, `ADR-0009`, `REPORT.md`: "High-performance native Android/iOS mobile scanner using Google ML Kit and local SQLite" | `mobile/pubspec.yaml` has no Flutter SDK, no ML Kit, no SQLite (`sqflite`). `LocalStorageService` uses `Map` and `List` in RAM. `CameraScannerScreen` has no camera feed; `processCode` is uncalled dead code. | `dart test` passed 8 tests on RAM storage. `dart analyze` on package root failed with 301 errors. | **Complete Architecture Fiction**: No native app exists. It is an uncompilable Dart sketch with in-memory mock storage. |
| **Progressive Web App (PWA)** | `SPEC.md`, `ADR-0009`: "React Web / PWA gate scanner with offline sync, installable, continuous operation during Wi-Fi drops" | `web/index.html` has no `<link rel="manifest">` and no Service Worker registration. `web/package.json` has no PWA dependencies. `public/` contains only `favicon.svg`. | Production build succeeds, but cold load offline is impossible once tab is closed. | **Missing PWA**: Scanner operates offline *only* if the browser tab remains open. There is no installability or offline shell caching. |
| **Offline Scan Persistence (Mobile)** | `SPEC.md`: "All offline scans are buffered in local persistent storage (SQLite on Flutter)" | `mobile/lib/services/storage_service.dart:12-14`: `final Map _manifests = {}; final List _scans = [];`. Enqueue only does `_scans.add(scan)`. | `dart test` tests in-memory lists. Terminating the process discards all buffered scans. | **Data Loss Defect**: Zero persistent storage on mobile. Process termination destroys all offline admission records. |
| **Gate Scanner Hardware (USB HID & Camera)** | `SPEC.md`: "USB HID laser barcode gun listener (<10ms), BarcodeDetector camera decode" | `web/src/pages/GateScanner.tsx`: Real HID window listener and `BarcodeDetector` loop implemented. | Web unit tests do not test DOM, HID, or video streams. Tested manually via source tracing. | **Partially Implemented**: Present in Web Gate Scanner, but completely absent in V2 Booth Portal and Networking views. |
| **V2 Lead Retrieval Badge Scanning** | `SPEC_V2.md`: "Exhibitor scans visitor attendee badges via device camera or USB barcode scanner in under 1 second" | `web/src/pages/ExhibitorPortal.tsx:318-375`: Rendered as an HTML text `<input type="text">` and submit button. No camera, no HID listener. | No automated or manual camera test. Manual string typing required. | **Severe UX Failure**: Exhibitor staff cannot scan badges with a camera or barcode gun; they must manually type 26-character Base32 secrets. |
| **V2 Peer Networking Badge Scanning** | `SPEC_V2.md`: "Attendees scan fellow delegates' personal QR badges to create mutual peer connections" | `web/src/pages/MyNetwork.tsx:327-381`: Rendered as an HTML text `<input type="text">` and submit button. No camera, no HID listener. | No automated or manual camera test. Manual string typing required. | **Severe UX Failure**: Delegates must manually type Base32 secrets into an input field to connect. |
| **V2 Networking Privacy Opt-In** | `SPEC_V2.md:31,56`: "Privacy-guarded: Public badge scan reveals Name, Org, Title; direct email/phone disclosure is opt-in" | `backend/app/models.py:70-83`: `User` has no phone number or privacy preference fields. `backend/app/routes/network.py:218`: Peer email is unconditionally returned and embedded in `.vcf`. | Inspected `backend/tests/test_networking.py:152-183`: Email is always present. | **Specification Violation & Privacy Breach**: Zero privacy toggles exist; email is disclosed to all peers unconditionally. |
| **V2 Mutual Networking Connections** | `SPEC_V2.md:28`: "create mutual peer connections" | `backend/app/routes/network.py:94-104`: Creates a single directional record `(user_id -> connected_user_id)`. Peer does not see connection unless they scan back. | Inspected `backend/tests/test_networking.py`. Directional assertion only. | **Asymmetric Implementation**: Connection is one-way only; Bob's list does not show Alice when Alice connects with Bob. |
| **Admission Policy: Capacity Limits** | `SPEC.md:107`: "`CAPACITY_CAPPED`: Tracks net occupancy and rejects when threshold is met" | `web/src/pages/GateScanner.tsx:196-200` omits `current_admitted_count`. `backend/app/routes/analytics.py:149-158` tracks gross scans, not net occupancy. | Evaluated via throwaway node script: Policy with capacity 1 admitted ticket A and ticket B consecutively. | **Critical Logic Bug**: Scanner engine defaults current count to 0; positive capacities never reject locally. Backend counts gross scans with no exit concept. |
| **Scanner Authentication & Security** | `SPEC.md`, `ADR-0004`: Secure checkpoint and gate operations | `backend/app/routes/checkin.py:113, 176`: Manifest download and scan ingestion have no authentication dependencies. | Direct curl/HTTP request to endpoints succeeds without any `Authorization` header. | **High Security Vulnerability**: Unauthenticated public endpoints leak full attendee PII, emails, and admission secrets. |
| **Production Redis Caching / Workers** | `SPEC.md:68`: "Redis for atomic operations, fast rate-limiting, and background worker queues" | Zero Redis dependencies in `pyproject.toml`, no Redis connection code in `app/`, zero Redis containers in `docker-compose.yml`. | Not present in codebase. | **Architectural Phantom**: Redis was never introduced; all operations run on PostgreSQL. |
| **Automated End-to-End Browser Tests** | `SPEC.md:133-138`: "React scanner view tests for camera fallback, HID input buffer capture, and sync state transitions" | `web/package.json` contains no browser testing tools (no Playwright, Cypress, or jsdom). Web suite consists solely of 5 pure unit tests for `scannerEngine.ts`. | Inspected `web/tests/scannerEngine.test.ts`. | **Missing Test Seam**: Zero browser integration, UI rendering, routing, or storage tests exist for the web frontend. |

---

## 3. Component & Capability Coverage Matrix

| Area | Capability / Journey | UI Route (`web/src/pages/`) | Backend API (`backend/app/routes/`) | Authorization Enforcement | Persistence & Models | Executed Test Status | Audit Finding |
|:---|:---|:---|:---|:---|:---|:---|:---|
| **Admin** | Provision Organizer & API Key | *None (CLI / API)* | `POST /api/organizers` | `X-Admin-Token` constant-time match | `organizers` table, SHA-256 key hash | Inspected (`test_organizers.py`) | Implemented cleanly |
| **Auth** | Self-Registration | `/e/:slug` modal | `POST /api/auth/register` | Public | `users` table, PBKDF2 hash | Inspected (`test_auth.py`) | Implemented cleanly |
| **Auth** | Login & JWT Issuance | `/e/:slug` modal | `POST /api/auth/login` | Public | HS256 JWT, 7-day expiry | Inspected (`test_auth.py`) | **P1-JWT-DEFAULT** |
| **Events** | Organizer Event Setup & Slug | `/organizer`, `/organizer/events/:id` | `POST /api/events`, `GET /api/events` | Organizer API Key | `events` table, unique slug | Inspected (`test_events.py`) | Implemented cleanly |
| **Tiers** | Ticket Tier Quotas & Flags | `/organizer/events/:id` | `POST/GET /api/events/:id/ticket-tiers` | Organizer API Key (`OwnedEventDep`) | `ticket_tiers` table | Inspected (`test_ticket_tiers.py`) | Implemented cleanly |
| **Tickets** | Free Reservation & QR Minting | `/e/:slug` | `POST /api/events/:id/tickets/reserve` | Attendee JWT | Atomic UPDATE `reserved_count < quota`, `entity_qrs` | Inspected (`test_tickets.py`) | Implemented cleanly |
| **Tickets** | Attendee My Tickets & Pass Portal | `/my-tickets` | `GET /api/attendees/me/tickets` | Attendee JWT | `tickets`, `entity_qrs`, `localStorage` cache | Pure build test passed; E2E unverified | **P2-PII-CACHE** |
| **Desk** | Walk-in Registration (<1s minting) | `/organizer/events/:id/desk` | `POST /api/events/:id/desk-registrations` | Organizer API Key (`OwnedEventDep`) | Creates User & Ticket, auto-generates email | Inspected (`test_desk_registration.py`) | **P2-UNCLAIMABLE-ACCOUNTS** |
| **Desk** | Attendee Search & Scan History | `/organizer/events/:id/desk` | `GET /api/events/:id/attendees`, `.../:ticket_id` | Organizer API Key (`OwnedEventDep`) | ILIKE search, joins `checkins` | Inspected (`test_desk_registration.py`) | Implemented cleanly |
| **Check-In** | Check-In Point Configuration | `/organizer/events/:id` | `POST/GET /api/events/:id/checkin-points` | Organizer API Key (`OwnedEventDep`) | `checkin_points` table | Inspected (`test_checkin.py`) | **P2-POLICY-PERMISSIVE** |
| **Check-In** | Manifest Snapshot Generation | `/scan/:pointId` | `GET /api/checkin-points/:id/manifest` | **None (Public)** | Joins active tickets, tiers, users, QRs | Inspected (`test_checkin.py`) | **P1-SCAN-AUTH** |
| **Check-In** | Web Gate Scanner Engine | `/scan/:pointId` | *Local evaluation* | None | Evaluates `scannerEngine.ts`, queues to IndexedDB | **PASSED** (5 unit tests) | **P1-LOCAL-CAPACITY**, **P1-PWA-MISSING** |
| **Check-In** | Scan Batch Ingestion & Idempotency | `/scan/:pointId` (sync) | `POST /api/checkin-points/:id/scans/batch` | **None (Public)** | `checkins` table (PK `scan_id`), inserts/replays | Inspected (`test_checkin.py`) | **P1-SCAN-AUTH**, **P1-SYNC-SILENT-FAIL**, **P1-CONCURRENCY-ADMISSION** |
| **Analytics** | KPIs, Gate Throughput & Catering | `/organizer/events/:id/analytics` | `GET /api/events/:id/analytics/attendance` | Organizer API Key (`OwnedEventDep`) | Dynamic SQL aggregations on `checkins` | Inspected (`test_analytics.py`) | **P3-HOURLY-METRICS-COLLAPSE** |
| **Analytics** | Compliance CSV Export | `/organizer/events/:id/analytics` | `GET /api/events/:id/analytics/export-csv` | Organizer API Key (`OwnedEventDep`) | Streams CSV with attendee name/email | Inspected (`test_analytics.py`) | **P2-CSV-FORMULA** |
| **Booths** | Booth Setup & Standee EntityQR | `/organizer/events/:id` | `POST/GET /api/events/:id/booths` | Organizer API Key (`OwnedEventDep`) | `booths`, `entity_qrs` (`entity_type='booth'`) | Inspected (`test_booths.py`) | **P2-BOOTH-ENTITY-QR-UNRESOLVED** |
| **Booths** | Booth Staff Delegation | `/organizer/events/:id` | `POST /api/events/:id/booths/:id/staff` | Organizer API Key (`OwnedEventDep`) | `booth_staff` table (unique booth/user) | Inspected (`test_booths.py`) | **P2-UNCLAIMABLE-ACCOUNTS** |
| **Booths** | Public Booth Profile & Brochure | `/e/:slug/booths/:id` | `GET /api/public/events/:slug/booths/:id` | Public | Reads booth details & brochure URL | Inspected (`test_booth_bookmarks.py`) | Implemented cleanly |
| **Booths** | Attendee Booth Bookmarks | `/e/:slug/booths/:id`, `/my-tickets` | `POST/DELETE/GET /api/attendees/me/bookmarks/booths` | Attendee JWT | `booth_bookmarks` table (unique user/booth) | Inspected (`test_booth_bookmarks.py`) | Implemented cleanly |
| **Leads** | Exhibitor Portal Access | `/booth/:boothId` | `GET /api/booths/:id` | Attendee JWT + `BoothStaff` check (403 guard) | Verifies staff membership | Inspected (`test_booths.py`) | **P2-BOOTH-STAFF-LOGIN-DEADEND** |
| **Leads** | Lead Badge Capture | `/booth/:boothId` | `POST /api/booths/:id/leads/scan` | Attendee JWT + `BoothStaff` check | Upserts `leads` table (unique booth/ticket) | Inspected (`test_leads.py`) | **P2-V2-SCAN-MANUAL**, **P2-INACTIVE-TICKET-BYPASS** |
| **Leads** | Lead Qualification (Rating/Tags) | `/booth/:boothId` | `PATCH /api/booths/:id/leads/:lead_id` | Attendee JWT + `BoothStaff` check | Updates rating, JSON tags, notes | Inspected (`test_lead_qualification.py`) | Implemented cleanly |
| **Leads** | CRM CSV Export | `/booth/:boothId` | `GET /api/booths/:id/leads/export-csv` | Attendee JWT + `BoothStaff` check | Streams CSV with lead notes/tags | Inspected (`test_lead_qualification.py`) | **P2-CSV-FORMULA** |
| **Networking** | Attendee Peer Badge Scan | `/my-network` | `POST /api/attendees/me/network/scan` | Attendee JWT | Upserts `connections` table | Inspected (`test_networking.py`) | **P2-V2-SCAN-MANUAL**, **P2-V2-PRIVACY-OPTIN** |
| **Networking** | Peer Notes & List | `/my-network` | `GET/PATCH /api/attendees/me/network` | Attendee JWT | Directional connection read & note edit | Inspected (`test_networking.py`) | Implemented cleanly |
| **Networking** | Native vCard (.vcf) Export | `/my-network` | `GET /api/attendees/me/network/:id/vcard` | Attendee JWT | Generates `text/vcard` RFC 6350 payload | Inspected (`test_networking.py`) | **P3-VCARD-INJECTION** |
| **Mobile** | Flutter Scanner Client | *Native Screens* | Calls manifest & batch endpoints | **None** | RAM storage in `LocalStorageService` | **FAILED** (301 compile errors) | **P1-MOBILE-TOOLCHAIN**, **P1-MOBILE-DURABILITY** |

---

## 4. Findings Ranked P0 / P1 / P2 / P3

- **P0 (Catastrophic Blocker):** 0 findings.
- **P1 (High Security / Operational Blocker):** 8 findings.
- **P2 (Major Feature Defect / Spec Breach / UX Failure):** 10 findings.
- **P3 (Minor Vulnerability / Logic Inconsistency):** 3 findings.

---

## 5. Detailed Findings & Technical Evidence

### [P1-SCAN-AUTH] Check-In Manifest & Batch Ingestion Endpoints Lack Authentication
- **Category:** Authentication & Authorization / PII Exposure (`CWE-306`, `CWE-200`)
- **Severity:** P1 (High Security Vulnerability)
- **Confidence:** High (Direct source confirmation)
- **Evidence:**
  - `backend/app/routes/checkin.py:113-116`:
    ```python
    @router.get("/api/checkin-points/{point_id}/manifest")
    async def get_checkin_manifest(
        point_id: uuid.UUID, session: SessionDep
    ) -> CheckInManifest:
    ```
  - `backend/app/routes/checkin.py:176-179`:
    ```python
    @router.post("/api/checkin-points/{point_id}/scans/batch")
    async def ingest_scans_batch(
        point_id: uuid.UUID, body: BatchScanRequest, session: SessionDep
    ) -> BatchScanResponse:
    ```
  - `backend/app/routes/checkin.py:154-166`: Manifest serializes `qr_secret`, `attendee_name`, and `attendee_email` for every active ticket.
  - `web/src/pages/OrganizerEventDetail.tsx:837-850`: Directly publishes public links to this manifest JSON.
  - `mobile/lib/services/api_service.dart:14-47`: Makes requests with no `Authorization` header.
- **Reproduction Steps:**
  1. Obtain any check-in point UUID (e.g. from a public/shared scanner URL or organizer page).
  2. Execute an unauthenticated HTTP GET request: `curl http://localhost:8000/api/checkin-points/{point_id}/manifest`.
  3. Observe that the server returns HTTP 200 with the full list of attendees, their names, email addresses, and their 128-bit secret QR tokens.
  4. Execute an unauthenticated HTTP POST with a forged UUID and copied secret to `/api/checkin-points/{point_id}/scans/batch`. Observe that the admission record is committed.
- **Impact:** Complete compromise of attendee privacy (PII leak) and event gate integrity. Reusable QR secrets can be harvested en masse and cloned to breach venue security. Competitors or malicious actors can falsify check-in numbers and corrupt compliance reports.
- **Acceptance Criteria:**
  1. `GET /manifest` and `POST /scans/batch` MUST require an authorized scanner credential (e.g., event staff JWT or point-scoped scanner token).
  2. Unauthenticated requests MUST return `401 Unauthorized`. Requests for check-in points belonging to another organizer MUST return `404 Not Found` or `403 Forbidden`.
  3. Manifest payload MUST be data-minimized (omit attendee email unless strictly necessary for gate identity resolution).

---

### [P1-MOBILE-TOOLCHAIN] Mobile Scanner Package Is Non-Compilable and Lacks Native SDKs
- **Category:** Build & Toolchain Integrity / Architecture Breach
- **Severity:** P1 (Critical Delivery Defect)
- **Confidence:** High (Direct execution evidence)
- **Evidence:**
  - `mobile/pubspec.yaml:1-14`: Declares environment `sdk: '>=3.0.0 <4.0.0'` and dependencies `http: ^1.2.0`, `uuid: ^4.3.3`. Does **not** declare `sdk: flutter`, `camera`, `google_mlkit_barcode_scanning`, or `sqflite`.
  - Directory check: Repository contains no `mobile/android`, `mobile/ios`, or platform runner projects.
  - `scripts/check.bat:38`: Executes `dart analyze lib/models lib/services test`, deliberately omitting `lib/main.dart` and `lib/screens/`.
  - Executed tool command: `dart analyze` in `mobile/` yielded:
    ```
    error - lib\main.dart:1:8 - Target of URI doesn't exist: 'package:flutter/material.dart'
    error - lib\main.dart:8:3 - The function 'runApp' isn't defined
    ...
    301 issues found. [Exit code 3]
    ```
  - `mobile/lib/screens/camera_scanner_screen.dart:75`: `Future<void> processCode(String rawCode)` is defined, but a global search confirms it has zero callsites across the codebase.
- **Reproduction Steps:**
  1. Change directory to `mobile/`.
  2. Run `dart analyze` on the entire package (without cherry-picking subfolders).
  3. Observe 301 compiler errors due to missing Flutter framework and unresolvable classes.
  4. Attempt to build an APK or iOS bundle: command fails immediately due to absence of Flutter project structure.
- **Impact:** The "Native Flutter Mobile Scanner Client with Google ML Kit" claimed in Milestone V1 deliverable reports does not exist in an executable or compilable state. No field operations can be conducted using this mobile package.
- **Acceptance Criteria:**
  1. `mobile/` MUST be initialized as a genuine Flutter application with valid platform runners (`android/`, `ios/`).
  2. Dependencies MUST include official camera and barcode recognition libraries (`google_mlkit_barcode_scanning` or equivalent).
  3. `flutter analyze` MUST complete with 0 errors across the entire codebase.
  4. CI MUST run `flutter build apk --debug` to prove buildability.
  5. The camera viewfinder MUST feed decoded barcode strings directly into `processCode()`.

---

### [P1-MOBILE-DURABILITY] Mobile Scanner Uses Volatile In-Memory Storage Instead of SQLite
- **Category:** Data Durability & Offline Synchronization (`CWE-459`)
- **Severity:** P1 (High Data Loss Risk)
- **Confidence:** High (Direct source confirmation)
- **Evidence:**
  - `mobile/lib/services/storage_service.dart:12-14`:
    ```dart
    class LocalStorageService implements IStorageService {
      final Map<String, Map<String, dynamic>> _manifests = {};
      final List<ScanRecord> _scans = [];
    ```
  - `mobile/lib/services/storage_service.dart:27-29`:
    ```dart
    @override
    Future<void> enqueueScan(ScanRecord scan) async {
      _scans.add(scan);
    }
    ```
  - `mobile/lib/main.dart:6`: Instantiates `LocalStorageService()` directly in memory.
- **Reproduction Steps:**
  1. Download a manifest and record offline admissions in the mobile scanner.
  2. Simulate an application restart or OS process reclamation (close and re-open the app).
  3. Inspect storage: `_manifests` and `_scans` are re-instantiated as empty collections. All unsynced scans are permanently gone.
- **Impact:** Catastrophic data loss during venue Wi-Fi outages. If mobile scanner devices run out of battery or the OS terminates background processes, attendee admission records are irrecoverably lost, invalidating attendance figures.
- **Acceptance Criteria:**
  1. `LocalStorageService` MUST be implemented using an embedded persistent database (`sqflite` or `drift`).
  2. Manifests and scan queues MUST survive process termination and device reboots.
  3. Integration tests MUST verify that queued scans remain present and syncable after re-opening the database.

---

### [P1-PWA-MISSING] Web App Contains No Service Worker or Web App Manifest (Not a PWA)
- **Category:** Architecture & Offline Availability
- **Severity:** P1 (Operational Reliability)
- **Confidence:** High (Direct filesystem and source evidence)
- **Evidence:**
  - `web/index.html:1-12`: Contains only standard viewport meta tags and an icon link. There is no `<link rel="manifest" href="...">`.
  - `web/public/`: Contains only `favicon.svg`. No `manifest.json` or `sw.js` exists.
  - `web/src/main.tsx` & `web/src/`: Zero Service Worker registration logic (`navigator.serviceWorker.register`).
  - `web/package.json`: No PWA build plugins (such as `vite-plugin-pwa`).
- **Reproduction Steps:**
  1. Open `/scan/:pointId` in a browser and load a manifest.
  2. Disconnect the network (turn off Wi-Fi or toggle DevTools Offline mode).
  3. Close the browser tab and attempt to navigate back to `http://localhost:5173/scan/:pointId`.
  4. The browser displays `ERR_INTERNET_DISCONNECTED`.
- **Impact:** The web gate scanner cannot operate as an offline PWA. If volunteer staff accidentally close their browser or refresh before loading, the application fails entirely until internet connectivity is restored.
- **Acceptance Criteria:**
  1. Web app MUST configure a valid Web App Manifest (`manifest.webmanifest`) declaring standalone display mode.
  2. A production Service Worker MUST cache the application shell, routing assets, and static bundles using a Cache-First strategy.
  3. Disconnected cold starts to `/scan/:pointId` and `/my-tickets` MUST successfully render cached views offline.

---

### [P1-JWT-DEFAULT] Hardcoded Default JWT Secret Enables Impersonation
- **Category:** Cryptographic Vulnerability (`CWE-798`, `CWE-347`)
- **Severity:** P1 (High Security Vulnerability)
- **Confidence:** High (Demonstrated via Python reproduction script)
- **Evidence:**
  - `backend/app/config.py:10`:
    ```python
    jwt_secret: str = "congress-dev-secret-jwt-key-minimum-32-bytes-length-required-for-sha256"
    ```
  - `backend/.env.example:1-3`: Omitted `CONGRESS_JWT_SECRET`.
  - Executed reproduction command in backend environment:
    ```python
    Default signing keys identical: True
    Forged token accepted by decoder: True
    ```
- **Reproduction Steps:**
  1. Start the backend with only `CONGRESS_PLATFORM_ADMIN_TOKEN` set (per `.env.example`).
  2. Craft an arbitrary JWT payload with `"sub": "<target-user-uuid>"` signed with the hardcoded string `"congress-dev-secret-jwt-key-minimum-32-bytes-length-required-for-sha256"` using HS256.
  3. Send an authenticated request to `GET /api/attendees/me/tickets` or `POST /api/booths/{booth_id}/leads/scan`.
  4. The backend accepts the forged token and authenticates the attacker as the target user.
- **Impact:** Any user or attacker reading the public repository can forge authentication tokens for any attendee or exhibitor booth representative, accessing private tickets, attendee contacts, and competitor lead databases.
- **Acceptance Criteria:**
  1. `CONGRESS_JWT_SECRET` MUST have no insecure default in production configuration, or backend MUST refuse to start in production if the default secret is present.
  2. `.env.example` MUST document `CONGRESS_JWT_SECRET`.

---

### [P1-LOCAL-CAPACITY] Scanner Engine Ignores Capacity Limits During Local Evaluation
- **Category:** Admission Control Bypass (`CWE-841`)
- **Severity:** P1 (Operational Failure)
- **Confidence:** High (Demonstrated via Node.js script execution)
- **Evidence:**
  - `web/src/pages/GateScanner.tsx:196-200`:
    ```typescript
    const policy: LocalPolicyConfig = {
      policy_type: manifest.checkin_point.policy_type as LocalPolicyConfig["policy_type"],
      allowed_tier_ids: manifest.checkin_point.allowed_tier_ids,
      max_capacity: manifest.checkin_point.max_capacity,
      // Note: current_admitted_count is NOT passed!
    };
    ```
  - `web/src/lib/scannerEngine.ts:76`:
    ```typescript
    const current = policy.current_admitted_count ?? 0;
    if (current >= policy.max_capacity) { ... }
    ```
  - Executed test script:
    ```javascript
    evaluateLocalScan(tickets, { policy_type: 'CAPACITY_CAPPED', max_capacity: 1 }, 'a') -> ADMITTED
    evaluateLocalScan(tickets, { policy_type: 'CAPACITY_CAPPED', max_capacity: 1 }, 'b') -> ADMITTED
    ```
- **Reproduction Steps:**
  1. Configure a Check-In Point with `policy_type = "CAPACITY_CAPPED"` and `max_capacity = 1`.
  2. Load the scanner at `/scan/:pointId`.
  3. Scan a valid badge for Attendee A: Scanner flashes GREEN (Admitted).
  4. Immediately scan a valid badge for Attendee B: Scanner flashes GREEN (Admitted).
- **Impact:** Complete failure of venue capacity safety controls. Overcrowded halls or VIP rooms will continue admitting attendees locally, creating safety hazards and fire code violations.
- **Acceptance Criteria:**
  1. `GateScanner` MUST maintain and update a local `current_admitted_count` combining manifest admissions with newly queued offline admissions.
  2. When `current_admitted_count >= max_capacity`, `evaluateLocalScan()` MUST return `REJECTED` with reason `CAPACITY_REACHED`.

---

### [P1-SYNC-SILENT-FAIL] Sync Engine Silently Marks Server-Rejected Scans as Synced
- **Category:** State Synchronization & Conflict Masking (`CWE-841`)
- **Severity:** P1 (Data Integrity)
- **Confidence:** High (Direct source confirmation)
- **Evidence:**
  - `web/src/pages/GateScanner.tsx:168-180`:
    ```typescript
    const { data } = await client.POST("/api/checkin-points/{point_id}/scans/batch", ...);
    if (data) {
      const syncedIds = unsynced.map((s) => s.scan_id);
      await markScansSyncedInDb(syncedIds);
      updatePendingCount();
    }
    ```
  - `mobile/lib/services/sync_service.dart:28-38`: Replaces all unsynced scans with `isSynced = true` solely if HTTP status code is 200.
- **Reproduction Steps:**
  1. Have two offline scanners load the same manifest containing an unadmitted `SINGLE_USE` ticket.
  2. Both scanners scan the ticket offline. Both evaluate locally and display GREEN (Admitted).
  3. Both scanners reconnect to the network and trigger background sync.
  4. The server receives the first batch and marks the ticket ADMITTED. The server receives the second batch and marks it REJECTED (`ALREADY_ADMITTED`).
  5. The second scanner inspects `data` (which is non-null) and marks the rejected scan as `synced = true` without ever notifying the operator or updating the local ticket record.
- **Impact:** Physical double-entry has occurred, but neither the scanner operator nor local records reflect the discrepancy. The system falsely masks admission conflicts as successful synchronizations.
- **Acceptance Criteria:**
  1. Scanner sync engines MUST iterate over the server's `results` array by `scan_id`.
  2. If the server returned `REJECTED` for a scan that was locally marked `ADMITTED`, the UI MUST trigger an audit warning / conflict indicator.
  3. Discrepancies MUST be highlighted in the recent scans log.

---

### [P1-CONCURRENCY-ADMISSION] Server-Side Admission Policies Lack Concurrency Locks
- **Category:** Concurrency / Race Condition (`CWE-362`, `CWE-367`)
- **Severity:** P1 (Data Integrity)
- **Confidence:** High (Source logic analysis)
- **Evidence:**
  - `backend/app/routes/checkin.py:304-332`:
    ```python
    if point.policy_type == "SINGLE_USE":
        already_admitted = await session.scalar(
            select(CheckIn.id).where(...)
        )
        if already_admitted is not None:
            scan_status = "REJECTED"
    ...
    session.add(checkin)
    ```
  - `backend/migrations/versions/0003_checkin_points_and_checkins.py:38-52`: The table has a primary key on `scan_id`, but **no unique constraint** on `(checkin_point_id, ticket_id)` where `status = 'ADMITTED'`.
- **Reproduction Steps:**
  1. Submit two simultaneous HTTP POST requests to `/api/checkin-points/{point_id}/scans/batch` with different client `scan_id` values for the same `SINGLE_USE` ticket.
  2. Due to read-then-write execution without row-level locking (`SELECT ... FOR UPDATE`) or a partial unique index, both transactions observe `already_admitted is None`.
  3. Both transactions insert `CheckIn` records with `status = "ADMITTED"` and commit.
- **Impact:** Simultaneous arrivals at different gates allow duplicate ticket usage, allowing unauthorized meals or multiple attendees entering on one ticket.
- **Acceptance Criteria:**
  1. Add a conditional unique constraint or database locking mechanism ensuring that at most one `ADMITTED` check-in record can exist for a `(checkin_point_id, ticket_id)` tuple under `SINGLE_USE`.
  2. Concurrent requests for the same ticket MUST result in exactly one `ADMITTED` and one `REJECTED` record.

---

### [P2-V2-SCAN-MANUAL] Exhibitor & Networking Scan Portals Lack Camera / Scanner Integration
- **Category:** User Experience & Specification Gap
- **Severity:** P2 (Major Functional Defect)
- **Confidence:** High (Direct UI source confirmation)
- **Evidence:**
  - `web/src/pages/ExhibitorPortal.tsx:318-375`:
    ```tsx
    <form onSubmit={handleScanSubmit} className="space-y-4">
      <input
        type="text"
        value={scanInput}
        onChange={(e) => setScanInput(e.target.value)}
        placeholder="Enter 26-character badge QR secret..."
      />
    ```
  - `web/src/pages/MyNetwork.tsx:327-381`: Contains an identical text input form.
  - Zero imports of `BarcodeDetector`, camera video elements, or USB HID listeners in either file.
- **Reproduction Steps:**
  1. Navigate to `/booth/:boothId` or `/my-network` on a smartphone or tablet.
  2. Click "Scan Attendee Badge" or "Scan Badge to Connect".
  3. A modal appears with a keyboard text input requesting a 26-character Base32 string. No camera stream is started.
- **Impact:** Milestone V2's core value proposition ("sub-second badge lead retrieval" and "instant peer networking") is unusable in a physical event environment.
- **Acceptance Criteria:**
  1. Integrate the `BarcodeDetector` / camera stream component and USB HID scanner listener into both `ExhibitorPortal.tsx` and `MyNetwork.tsx`.
  2. Scanning a badge must automatically capture the lead or establish a connection without manual string typing.

---

### [P2-V2-PRIVACY-OPTIN] Networking Exposes Email Without Consent and Has No Phone Support
- **Category:** Privacy & Specification Non-Compliance
- **Severity:** P2 (Privacy Defect)
- **Confidence:** High (Direct backend source confirmation)
- **Evidence:**
  - `SPEC_V2.md:31,56`: Requires that attendee badge scanning keeps direct email and phone disclosure opt-in.
  - `backend/app/models.py:70-83`: `User` table schema defines `full_name`, `email`, `organization`, `title`. There is **no phone column** and **no privacy consent columns**.
  - `backend/app/routes/network.py:218`:
    ```python
    f"EMAIL;TYPE=INTERNET:{peer.email}",
    ```
- **Reproduction Steps:**
  1. Register Attendee A and Attendee B.
  2. Have Attendee A connect with Attendee B via `/my-network`.
  3. Attendee A immediately receives Attendee B's personal email, and downloading the `.vcf` file includes Attendee B's email.
- **Impact:** Violates privacy commitments made in the product specification and exposes attendee email addresses without explicit consent.
- **Acceptance Criteria:**
  1. Add `phone_number`, `share_email_publicly`, and `share_phone_publicly` fields to `User` model.
  2. `GET /api/attendees/me/network` and `.vcf` generation MUST omit email and phone unless the peer explicitly opted in.

---

### [P2-UNCLAIMABLE-ACCOUNTS] Auto-Provisioned Desk Walk-Ins & Booth Staff Cannot Claim Accounts
- **Category:** Identity & Access Management
- **Severity:** P2 (Functional Defect)
- **Confidence:** High (Direct source confirmation)
- **Evidence:**
  - `backend/app/routes/desk.py:95-103`:
    ```python
    user = User(
        email=actual_email,
        password_hash=hash_password(secrets.token_urlsafe(16)),
        ...
    )
    ```
  - `backend/app/routes/booths.py:180-188`: Auto-assigning staff creates users with `secrets.token_urlsafe(16)`.
  - The repository contains no password reset, magic link, or account claim endpoints.
- **Reproduction Steps:**
  1. An organizer creates a walk-in attendee at the desk with email `john@example.com`, or assigns a booth representative `staff@booth.com`.
  2. The system generates an unrecoverable random password and stores its hash.
  3. The user attempts to register at `/e/:slug` -> Rejected with `409 Conflict` (Email already taken).
  4. The user attempts to log in -> Fails (Password unknown).
- **Impact:** Users created on-site or invited as booth staff can never access the platform online, access their ticket history, or log in to manage leads.
- **Acceptance Criteria:**
  1. Implement an account invitation / claim workflow, or provide an administrative password reset / magic link mechanism.

---

### [P2-SNAPSHOT-RESET] Manifest Reload Resets Local Offline Single-Use State
- **Category:** State Management & Offline Integrity
- **Severity:** P2 (Operational Integrity)
- **Confidence:** High (Direct source confirmation)
- **Evidence:**
  - `web/src/pages/GateScanner.tsx:104-118`: `buildTicketMap` builds state strictly from the raw `manifest` object in storage.
  - Newly evaluated scans are appended to the queue, but `manifest.tickets` is not updated.
  - Re-mounting or refreshing the page reconstructs `ticketMap` from the unmodified manifest.
- **Reproduction Steps:**
  1. Disconnect network while on `/scan/:pointId`.
  2. Scan a `SINGLE_USE` ticket: Evaluated as `ADMITTED`, queued to IndexedDB.
  3. Refresh the browser tab while still offline.
  4. Scan the exact same ticket again: The scanner evaluates against the original snapshot and flashes `ADMITTED` a second time.
- **Impact:** Page refreshes or scanner restarts during offline periods reset single-use policy enforcement, allowing attendees to reuse passes.
- **Acceptance Criteria:**
  1. `buildTicketMap()` MUST merge the cached manifest tickets with any un-synced admitted scans currently in the local IndexedDB queue.

---

### [P2-POLICY-PERMISSIVE] Unvalidated Check-In Point Admission Policies Fail Open
- **Category:** Input Validation (`CWE-20`, `CWE-636`)
- **Severity:** P2 (Logic Flaw)
- **Confidence:** High (Direct source confirmation)
- **Evidence:**
  - `backend/app/routes/checkin.py:20-25`: `policy_type: str = Field(default="MULTI_ENTRY")`. No Enum or validation.
  - `backend/app/routes/checkin.py:303-333`: Only checks `if point.policy_type == "SINGLE_USE"`, `elif ... == "TIER_RESTRICTED"`, `elif ... == "CAPACITY_CAPPED"`. Any other string falls through to default `ADMITTED`.
- **Reproduction Steps:**
  1. POST a new check-in point with `policy_type = "INVALID_TYPO"`.
  2. Submit scans: all scans are permanently admitted.
- **Impact:** Typos or misconfigurations silently fail open to unconstrained entry.
- **Acceptance Criteria:**
  1. Restrict `policy_type` to a strict Enum (`SINGLE_USE`, `MULTI_ENTRY`, `TIER_RESTRICTED`, `CAPACITY_CAPPED`) in Pydantic schema and database constraints.

---

### [P2-CSV-FORMULA] Lead and Analytics CSV Downloads Permit Formula Injection
- **Category:** Export Injection (`CWE-1236`)
- **Severity:** P2 (Security Vulnerability)
- **Confidence:** High (Direct source confirmation)
- **Evidence:**
  - `backend/app/routes/leads.py:335-349` & `backend/app/routes/analytics.py:229-245`: Attendee names, organizations, titles, and lead notes are written directly into CSV rows without formula prefix sanitization.
- **Reproduction Steps:**
  1. Register an attendee with full name `=cmd|' /C calc'!A0` or `=SUM(1+1)`.
  2. Download the lead CSV or analytics CSV.
  3. Open in Microsoft Excel or LibreOffice Calc. The formula executes or displays an evaluation error.
- **Impact:** Malicious attendee inputs can execute commands or exfiltrate data from machines opening exported CSVs.
- **Acceptance Criteria:**
  1. Prefix any field beginning with `=`, `+`, `-`, `@`, `\t`, or `\r` with a single quote (`'`) during CSV serialization.

---

### [P2-PII-CACHE] Shared Ticket Cache Bypasses Signed-Out Boundary
- **Category:** Privacy & Session Isolation (`CWE-200`, `CWE-525`)
- **Severity:** P2 (Privacy Leak)
- **Confidence:** High (Direct source confirmation)
- **Evidence:**
  - `web/src/pages/MyTickets.tsx:40-59`: Reads `localStorage.getItem("congress_cached_tickets")` and renders tickets before checking authentication token.
  - `web/src/pages/ExhibitorPortal.tsx:288` and `web/src/pages/MyNetwork.tsx:54`: Sign-out actions remove only `congress_attendee_token`, leaving cached ticket PII in `localStorage`.
- **Reproduction Steps:**
  1. User A logs in on a shared device and views their tickets.
  2. User A clicks sign out in My Network or clears token.
  3. User B visits `/my-tickets`. User A's cached QR code, full name, and email remain visible on screen.
- **Impact:** Attendee credential and PII disclosure on shared or kiosk devices.
- **Acceptance Criteria:**
  1. Scope cached tickets by user ID, and purge all cached ticket data on sign out.

---

### [P2-INACTIVE-TICKET-BYPASS] Inactive Tickets Can Still Be Admitted, Scanned, and Networked
- **Category:** Entitlement Enforcement
- **Severity:** P2 (Access Control)
- **Confidence:** High (Direct source confirmation)
- **Evidence:**
  - `backend/app/routes/checkin.py:245-271`: Batch scan resolution joins `Ticket` on `qr.entity_id`, but does **not** check `Ticket.status == "active"`.
  - `backend/app/routes/leads.py:91-111` & `backend/app/routes/network.py:48-68`: Both resolve tickets without filtering for active status.
- **Reproduction Steps:**
  1. Revoke or deactivate a ticket by setting `status = 'cancelled'`.
  2. Submit the ticket's QR secret to `/api/checkin-points/:id/scans/batch`.
  3. The server admits the ticket and records an admission.
- **Impact:** Cancelled tickets can still be used for physical venue admission and commercial lead capture.
- **Acceptance Criteria:**
  1. Batch ingestion, lead capture, and networking endpoints MUST explicitly require `Ticket.status == "active"`.

---

### [P2-BOOTH-STAFF-LOGIN-DEADEND] Exhibitor Portal Unauthenticated Redirect Has No Login Surface
- **Category:** Navigation & User Flow
- **Severity:** P2 (UX Failure)
- **Confidence:** High (Direct UI source confirmation)
- **Evidence:**
  - `web/src/pages/ExhibitorPortal.tsx:220-227`: Unauthenticated users see a button linking to `/` ("Platform Sign In").
  - `web/src/pages/Home.tsx:1-57`: Contains only links to `/organizer`. Zero attendee or booth staff sign-in forms exist.
- **Reproduction Steps:**
  1. Open an incognito browser tab and navigate directly to `/booth/:boothId`.
  2. Click "Go to Platform Sign In".
  3. You are redirected to `/`, which contains only links to the Organizer Console. There is no way to sign in.
- **Impact:** Assigned booth staff cannot log in to their portals unless they navigate to a public event reservation page.
- **Acceptance Criteria:**
  1. Add a dedicated, accessible sign-in page (`/login`) allowing attendees and booth staff to authenticate directly.

---

### [P2-BOOTH-ENTITY-QR-UNRESOLVED] Standee QR Codes Cannot Be Resolved by Public Attendees
- **Category:** Architecture & Routing Gap
- **Severity:** P2 (Specification Inconsistency)
- **Confidence:** High (Direct source confirmation)
- **Evidence:**
  - `web/src/pages/OrganizerEventDetail.tsx:559`: Renders booth standee QR with `value={selectedBoothQr.qr_secret}` (a 26-character Base32 token).
  - `backend/app/routes/public.py:79-117`: Public booth profile route is `GET /api/public/events/{slug}/booths/{booth_id}` (requires UUID).
  - The backend provides no public endpoint resolving a booth's `qr_secret` to its public profile.
- **Reproduction Steps:**
  1. Print the booth standee QR code from the organizer console.
  2. An attendee scans the QR code with their mobile camera app.
  3. The camera reads a raw Base32 string (e.g. `jbswy3dpehpk3pxp...`), not a URL. The attendee's phone does not open the booth profile.
- **Impact:** Attendees scanning physical booth banners on-site cannot access digital brochures or booth bookmarks.
- **Acceptance Criteria:**
  1. Standee QR codes MUST either encode a full public URL (e.g., `https://domain.com/qr/{secret}`) or the backend MUST provide a public QR resolver redirecting to `/e/:slug/booths/:boothId`.

---

### [P3-VCARD-INJECTION] vCard Export Does Not Escape Control Characters
- **Category:** Export Sanitization (`CWE-93`)
- **Severity:** P3 (Low Vulnerability)
- **Confidence:** High (Direct source confirmation)
- **Evidence:**
  - `backend/app/routes/network.py:211-225`: Formats vCard lines using raw string interpolation (`f"ORG:{peer.organization}"`, `f"NOTE:{conn.private_notes}"`) without escaping `\r`, `\n`, `,`, `;`, or `\`.
- **Reproduction Steps:**
  1. Register with organization name containing `\r\nEMAIL:attacker@evil.com`.
  2. Download the `.vcf` file. The output contains an injected `EMAIL` line.
- **Impact:** Allows property injection in contacts applications that import the resulting `.vcf` file.
- **Acceptance Criteria:**
  1. Sanitize all vCard text fields per RFC 6350 (escape backslashes, commas, semicolons, and CRLF).

---

### [P3-IDEMPOTENCY-UNSCOPED] Scan Replay Does Not Verify Point or Secret Matching
- **Category:** Idempotency Scoping (`CWE-639`)
- **Severity:** P3 (Logic Flaw)
- **Confidence:** High (Direct source confirmation)
- **Evidence:**
  - `backend/app/routes/checkin.py:188-214`: On matching `scan_id`, immediately replays the existing `CheckIn` record without checking if `checkin_point_id` matches the path parameter.
- **Reproduction Steps:**
  1. Submit a scan to Check-In Point A with UUID `U`.
  2. Submit a scan to Check-In Point B with the identical UUID `U`.
  3. Point B returns the outcome and attendee data from Point A.
- **Impact:** Conflicting or cross-point client UUID generation can cause cross-point reporting errors.
- **Acceptance Criteria:**
  1. Scope scan replay to verify `checkin_point_id == point.id`. Mismatched payloads MUST return `409 Conflict`.

---

### [P3-HOURLY-METRICS-COLLAPSE] Hourly Analytics Collapses Multi-Day Scans
- **Category:** Analytics Accuracy
- **Severity:** P3 (Reporting Flaw)
- **Confidence:** High (Direct source confirmation)
- **Evidence:**
  - `backend/app/routes/analytics.py:134-148`:
    ```python
    hour_key = c.scanned_at.strftime("%H:00")
    hourly_distribution[hour_key] = ...
    ```
- **Reproduction Steps:**
  1. Conduct scans at 10:00 AM on Day 1 (100 scans) and 10:00 AM on Day 2 (150 scans).
  2. View analytics dashboard.
  3. The `10:00` bucket shows 250 scans, collapsing both days together.
- **Impact:** Misleading throughput data for multi-day conventions.
- **Acceptance Criteria:**
  1. Bucket hourly distribution by date and hour (e.g. `YYYY-MM-DD HH:00`).

---

## 6. Unverified Areas & Environmental Blockers

The following areas could not be verified through direct execution due to local environment constraints:
1. **PostgreSQL Database Engine (Port 5433):**
   - **Blocker:** Local connection refused (`[WinError 1225]`). Docker Desktop engine is not running (`open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified`).
   - **Consequence:** Alembic migration application, schema rollback, and all 72 backend integration tests are marked **NOT RUN**.
2. **Flutter Native Runtime & Device Emulation:**
   - **Blocker:** The repository lacks the Flutter SDK and native platform runner scaffolding (`android/`, `ios/`).
   - **Consequence:** Native camera performance (<35ms claim), device haptics, and SQLite durability cannot be executed. Marked **NON-VIABLE**.
3. **Real-Browser End-to-End Suite:**
   - **Blocker:** No browser testing framework (Playwright, Cypress, or Puppeteer) is installed or configured in `web/`.
   - **Consequence:** Visual feedback, Web Audio chimes, and IndexedDB reconnect behavior across real browser tabs are marked **UNAVAILABLE**.

---

## 7. Top 10 Recommended Next Actions (Strict Priority Order)

1. **[P1-SCAN-AUTH] Authenticate Scanner Endpoints & Restrict PII:** Add token-based authentication to `GET /manifest` and `POST /scans/batch`. Restrict manifest ticket payloads to necessary identification data.
2. **[P1-JWT-DEFAULT] Enforce Mandatory Production JWT Secret:** Eliminate the default hardcoded signing key in `backend/app/config.py`. Require `CONGRESS_JWT_SECRET` in environment variables and fail fast at startup if missing.
3. **[P1-LOCAL-CAPACITY] Repair Gate Scanner Capacity Tracking:** Update `web/src/pages/GateScanner.tsx` to pass and maintain an accurate `current_admitted_count` to `evaluateLocalScan()`, preventing local admission over room capacity.
4. **[P1-SYNC-SILENT-FAIL] Reconcile Server Rejection Outcomes in Scanners:** Update sync loops in web and mobile to inspect the server's per-scan response array, alerting the operator when an offline admission is rejected by the server.
5. **[P1-CONCURRENCY-ADMISSION] Add Database Locks on Check-In Ingestion:** Implement database-level serialization (e.g. `SELECT ... FOR UPDATE` or partial unique indices on admitted tickets) to prevent simultaneous duplicate admissions.
6. **[P1-PWA-MISSING] Configure Real PWA Offline Support:** Add a Web App Manifest and Service Worker (via `vite-plugin-pwa`) to ensure the scanner and pass portals load reliably offline after browser tab closure.
7. **[P1-MOBILE-TOOLCHAIN] Initialize True Flutter App or Re-Scope Mobile:** Either bootstrap a complete Flutter mobile project with camera/ML Kit dependencies and SQLite persistence, or formally deprecate the `mobile/` directory and focus exclusively on the Web PWA scanner.
8. **[P2-V2-SCAN-MANUAL] Wire Camera & HID Scanners to V2 Portals:** Replace manual text inputs in `ExhibitorPortal.tsx` and `MyNetwork.tsx` with working camera decoding and USB HID listeners.
9. **[P2-V2-PRIVACY-OPTIN] Implement Networking Privacy Controls:** Add phone number and explicit opt-in sharing toggles to the `User` model, omitting unconsented contact details from peer responses and `.vcf` files.
10. **[P2-UNCLAIMABLE-ACCOUNTS] Provide Account Claim / Password Setup Flow:** Implement an invitation or password creation endpoint allowing desk walk-ins and auto-assigned booth representatives to claim their accounts.

---

## 8. Hands-On Acceptance Test Plan

This test plan provides step-by-step verification instructions for human QA across the five key system roles once blockers are addressed:

### 8.1 Organizer Journey
- **Setup:** Log in to `/organizer` using a valid Organizer API key.
- **Action:** Create an event ("Medical Congress 2026", unique slug `med-2026`). Configure two ticket tiers: "General Admission" (quota 500) and "VIP" (quota 50). Configure two Check-In Points: "Main Entrance" (`MULTI_ENTRY`) and "Lunch Hall" (`SINGLE_USE`). Create an Exhibition Booth ("PharmaCorp", location "Booth A-1").
- **Verification:**
  - Verify that the public page `/e/med-2026` displays both tiers.
  - Verify that the booth profile `/e/med-2026/booths/:id` displays company details and brochure links.
  - Export attendance analytics CSV from `/organizer/events/:id/analytics` and verify columns format cleanly without formula injection.

### 8.2 Attendee Journey
- **Setup:** Open `/e/med-2026` in a mobile browser.
- **Action:** Register a new account (`attendee@test.com`), log in, and reserve a "General Admission" ticket. Navigate to `/my-tickets`. Bookmark the "PharmaCorp" booth.
- **Verification:**
  - Verify high-contrast QR pass renders on `/my-tickets`.
  - Disconnect device Wi-Fi, reload the tab, and confirm the digital pass remains visible.
  - Verify that "PharmaCorp" appears in the "My Visited Booths" tab.

### 8.3 Reception Staff Journey (Desk Registration)
- **Setup:** Log in to `/organizer/events/:id/desk`.
- **Action:** Register a walk-in attendee named "Dr. Jane Doe" with no email address.
- **Verification:**
  - Verify pass is minted in <1 second with an auto-generated placeholder email (`walkin-...@event.local`).
  - Verify attendee appears immediately in the live desk search box.
  - Confirm instant print / preview modal renders the QR pass.

### 8.4 Scanner Operator Journey (Gate & Meal Check-In)
- **Setup:** Open `/scan/:pointId` for the "Lunch Hall" (`SINGLE_USE`) checkpoint. Allow manifest download.
- **Action:**
  - Disconnect network.
  - Scan Attendee A's QR code: Verify immediate green flash, chime, and admission status.
  - Immediately re-scan Attendee A's QR code: Verify immediate red flash, error buzzer, and rejection reason `ALREADY_ADMITTED`.
  - Reconnect network: Verify background sync uploads the queue, and pending count decrements to 0.

### 8.5 Exhibitor Representative Journey (Lead Capture & Qualification)
- **Setup:** Assign `staff@pharmacorp.com` to PharmaCorp booth. Log in and navigate to `/booth/:boothId`.
- **Action:**
  - Scan Attendee A's badge using the device camera.
  - Verify Attendee A's name, organization, and title appear in the qualification drawer.
  - Select interest rating `HOT`, add tag "Send Quote", type a conversation note, and save.
  - Click "Export Leads (CSV)".
- **Verification:**
  - Verify exported CSV contains Attendee A's details, rating `HOT`, tag, and private note.
  - Attempt to access a competitor booth `/booth/:competitorId`: Confirm immediate `403 Forbidden` response.

---

## 9. Release-Readiness Assessment

### Final Verdict: **NOT READY**

#### Technical Justification & Limitations:
1. **Critical Architecture Drift in Mobile:** The mobile package cannot be built or executed as a Flutter mobile scanner. Claiming native Google ML Kit scanning and offline SQLite sync is demonstrably false based on repository source code.
2. **Security Vulnerability at Checkpoints:** The unauthenticated state of `/manifest` and `/scans/batch` exposes event-wide attendee PII and creates an unprotected entry vector for forged attendance records.
3. **Flawed Local Admission Logic:** Positive capacity restrictions fail locally on all scanner engines due to missing admission count state, leading to unsafe false-positive entries.
4. **Offline Synchronization Conflict Masking:** Scanner sync engines discard server-side rejections, masking multi-device entry conflicts from operators.
5. **Absence of PWA Shell Caching:** The web scanner does not satisfy PWA offline requirements and fails to survive disconnected browser restarts.
6. **Unverified Database Integration:** Due to local PostgreSQL downtime during this audit, all 72 backend integration tests failed at setup and could not be verified in execution.

The Congress Management Platform demonstrates strong conceptual architecture, clean Alembic migrations, and disciplined tenant isolation in its organizer APIs. However, resolving the P1 and P2 findings identified in this baseline audit is strictly required before any staging deployment or live event operations can be sanctioned.
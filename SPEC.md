# Specification: V1 Core Registration and Attendance Tracking System

> **Historical specification (October 2026, V1). Not maintained; parts are outdated.**
>
> **Current sources of truth:** `docs/handover/UPGRADE_HANDOVER.md` (what is merged, in flight and open), the ADRs in
> `docs/adr/` (with their "Status / Implementation notes" sections), `GLOSSARY.md`, `AGENTS.md`, and the operations
> documents `docs/deployment/STAGING_OPERATIONS.md`, `docs/deployment/HOSTED_STAGING_READINESS.md` and
> `docs/release/07-CONGRESS-DAY-RUNBOOK.md`. `docs/pilot/MASTER-PILOT-READINESS.md` (2026-10-11) is historical.
>
> Outdated here:
> - **Password sign-in** (user story 3 and related): sign-in is a mobile number plus an SMS code; passwords and e-mail
>   were removed (ADR 0012).
> - **Redis** for caching, rate limiting and queues: not used. Inventory is a PostgreSQL conditional update; throttling
>   is counted in PostgreSQL (ADR 0019) and the SMS outbox is a PostgreSQL table polled by the API (ADR 0002 and 0006 status).
> - **Native Flutter scanner** with ML Kit and SQLite: never built and now parked (`mobile/README.md`). The web PWA at
>   `/scan/:pointId` is the only scanner.
> - Admission policies are narrower than described: no single-use time windows, no entry/exit, capacity counts total
>   admissions (ADR 0010 status). There is no check-in point hierarchy (ADR 0004 status).

## Problem Statement

At large congresses and conventions, registration and entry gate operations are often the most stressful and vulnerable touchpoints for both organizers and attendees. 

Attendees experience frustrating friction and long waiting lines during arrival, especially when arriving as walk-ins or trying to retrieve badges. Front-desk staff frequently struggle with cumbersome administrative tools to sign up attendees on-site quickly.

Most critically, conventional web-based check-in systems fail under real-world event conditions: convention center Wi-Fi drops, network congestion peaks during morning arrival rushes, and gates freeze, stalling entire queues. Organizers lack automated enforcement for checkpoint admission rules (such as preventing attendees from redeeming lunch more than once), and have zero real-time visibility into hall occupancy or entry gate throughput.

## Solution

An independent, scalable, mobile-first congress management platform built on **FastAPI**, with a **React** web application and a **Dual-Client Scanner System (React PWA + Native Flutter App)**, prioritizing the two core operational pillars:

1. **Dual-Flow Registration System:**
   - **Self-Registration:** A streamlined, mobile-optimized online flow where attendees provide standard profile information, create an account, and instantly receive their unique personal digital QR ticket.
   - **Desk Registration:** An ultra-fast, front-desk staff interface designed for rapid on-site attendee creation, immediate QR pass issuance, and badge assignment for walk-in arrivals.

2. **Resilient, Low-Latency Attendance Tracking (Check-In) System:**
   - **Universal Entity QR Foundation:** A polymorphic QR identifier system capable of representing Attendees now, and expanding to Booths, Halls, and Sessions in later phases.
   - **Dual-Client Scanner Architecture:** Two distinct scanner frontends consuming a single unified FastAPI sync contract:
     1. *React Web / PWA:* Zero-install browser scanner for volunteers and laptops with USB barcode guns.
     2. *Flutter Mobile App:* High-performance native Android/iOS mobile scanner using Google ML Kit and local SQLite for dedicated handheld operations.
   - **Offline-Resilient Scanner Engine:** Both scanner clients download an event manifest snapshot and operate with complete autonomy offline. All scans are verified locally in <50ms, stored in an append-only local buffer, and flushed idempotently to the server whenever connectivity is available.
   - **Configurable Admission Policies:** Rule enforcement per checkpoint, including strict single-scan limits for dining/catering areas, tiered access for VIP areas, and capacity limits for conference halls.
   - **Live Attendance Metrics:** Real-time dashboards displaying entry gate throughput, current hall occupancy, and catering redemption stats.

---

## User Stories

1. As a prospective attendee, I want to self-register for an event from my mobile phone, so that I can secure my free ticket in advance.
2. As a prospective attendee, I want to register with my mobile number (verified by an SMS code) plus my name, organization, and professional title, so that my credential details are accurately recorded.
3. As a prospective attendee, I want to set a password during registration, so that I have a secure personal account to access my tickets at any time.
4. As a registered attendee, I want to view my unique digital QR ticket on my mobile device, so that I can easily present it for scanning at the event venue.
5. As a registered attendee, I want to download or save an offline copy of my QR ticket, so that I can present it even if my phone has no mobile reception at the venue.
6. As a front-desk staff member, I want an on-site desk registration interface, so that I can quickly sign up walk-in attendees who did not register online.
7. As a front-desk staff member, I want desk registration to require minimal fields and complete in seconds, so that entry lines move rapidly.
8. As a front-desk staff member, I want to immediately issue and preview an attendee's QR code upon completing desk registration, so that they can proceed into the venue without delay.
9. As a front-desk staff member, I want to search existing registrations by name or mobile number, so that I can help attendees who lost their confirmation or need assistance.
10. As an event organizer, I want to configure multiple Check-In Points across the venue (e.g., Main Entrance, Hall A, Exhibition Booth Area, Dining Hall), so that attendance is tracked across distinct physical locations.
11. As an event organizer, I want to assign specific Admission Policies to each Check-In Point, so that rules like single-use catering or unlimited hall re-entry are automatically enforced.
12. As an event organizer, I want the Dining/Catering Check-In Point to strictly reject any attendee who has already scanned during that meal window, so that duplicate meal redemptions are prevented.
13. As a volunteer gate scanner operator, I want to open the scanner interface on any mobile browser without installing an app, so that I can start scanning immediately on my own phone.
14. As a dedicated staff scanner operator, I want to use a native Flutter mobile app with Google ML Kit, so that the camera locks onto QR codes instantly with minimum battery drain and zero lag.
15. As a reception desk operator, I want to connect a USB handheld barcode scanner in keyboard emulation mode to a laptop running the React web app, so that I can process attendees in under 20 milliseconds per scan.
16. As a gate scanner operator (on either Flutter or React PWA), I want instant, high-contrast visual and audible feedback (Green for Admitted, Red for Rejected) on every scan, so that I can direct attendees immediately.
17. As a gate scanner operator, I want clear rejection reasons displayed (e.g., "Already Admitted to Lunch", "Invalid Ticket", "Wrong Hall"), so that I can resolve attendee disputes calmly.
18. As a gate scanner operator, I want the scanner to continue operating seamlessly when the venue Wi-Fi drops, so that entry lines never freeze or stop moving.
19. As a gate scanner operator, I want all offline scans to be buffered in local persistent storage (IndexedDB on PWA, SQLite on Flutter), so that no admission records are lost during network outages.
20. As a gate scanner operator, I want to see an on-screen sync indicator showing the number of queued offline scans and connection health, so that I have confidence in the system state.
21. As a gate scanner operator, I want queued scans to automatically flush to the server in the background as soon as network connectivity is restored, so that I do not have to perform manual export steps.
22. As an event organizer, I want the backend to process batched scan uploads idempotently, so that duplicate uploads from intermittent networks never result in duplicated admission counts.
23. As an event organizer, I want a real-time analytics dashboard, so that I can monitor live attendance counts across all venue gates.
24. As an event organizer, I want to view hourly throughput metrics per Check-In Point, so that I can identify bottlenecks and reassign staff to busy entrances.
25. As an event organizer, I want to view catering redemption statistics, so that I know exactly how many meals were served versus total attendees present.
26. As an event organizer, I want to export attendance logs with timestamps and gate identifiers to CSV, so that I can generate official post-event compliance reports.
27. As a system administrator, I want each generated QR code to map to a universal Entity QR model, so that future phases can assign QR codes to booths, halls, and sessions without schema changes.

---

## Implementation Decisions

### 1. Technology Foundation & Architecture
- **Backend Framework:** FastAPI (Python 3.11+) running as an asynchronous ASGI application on Uvicorn.
- **ORM & Migrations:** SQLAlchemy 2.0 (asyncio engine with `asyncpg`) and Alembic for automated, reversible database migrations.
- **Database:** PostgreSQL for ACID relational data integrity and robust indexing.
- **Cache & Queue:** Redis for atomic operations, fast rate-limiting, and background worker queues.
- **Web Frontend:** React (TypeScript) SPA with Vite and Tailwind CSS, built strictly **mobile-first** with responsive layouts for mobile screens, tablets, and desktop workstations.
- **Native Scanner App:** Flutter (Dart) mobile application targeting Android and iOS, compiled to native ARM machine code.

### 2. Dual-Client Scanner System
We implement two scanner clients that consume the exact same backend API contracts:
1. **React Web / PWA Scanner:**
   - Zero-installation web client accessible via any mobile or desktop browser.
   - Manifest stored in browser `IndexedDB`; camera decode via native `BarcodeDetector` API.
   - Captures keystrokes from USB/Bluetooth handheld barcode scanners (HID mode) for ultra-fast desk operations (<10ms).
2. **Native Flutter Scanner:**
   - Dedicated handheld mobile app using Google ML Kit for native camera decoding (<35ms).
   - Manifest stored in local `SQLite` database.
   - Direct integration with device haptics and audio feedback.

### 3. Polymorphic Entity QR Architecture
- A unified `EntityQR` entity decouples QR generation from specific business entities:
  - Attributes: `id` (UUID), `secret` (128-bit CSPRNG token, Base32 encoded), `entity_type` (Enum: `attendee_ticket`, `booth`, `hall`, `session`), `entity_id` (UUID foreign reference), `created_at`, `is_active`.
  - Attendees receive an `EntityQR` tied to their `Ticket`.
  - Future booths, halls, or sessions will receive `EntityQR` records with zero architectural changes.

### 4. Offline Synchronization & Idempotency Protocol
- **Manifest Snapshot (`GET /api/checkin-points/{point_id}/manifest`):**
  - Downloaded by both React PWA and Flutter clients.
  - Contains valid ticket secrets, attendee names, tiers, and existing admission statuses.
  - Stored in IndexedDB (React) or SQLite (Flutter).
- **Local Evaluation Pipeline:**
  - Scanner reads QR secret → resolves against local manifest → evaluates Admission Policy (e.g. checks if already marked admitted) in <50ms.
  - Displays instant Green/Red screen, plays audio chime, and triggers haptic feedback.
  - Appends admission event to local persistent queue with client-generated `scan_id` (UUIDv4) and `scanned_at` timestamp.
- **Batch Ingestion (`POST /api/checkin-points/{point_id}/scans/batch`):**
  - Background sync loop pushes pending batches to the server whenever online.
  - The server uses `scan_id` as a database unique constraint. If a network retry re-sends an existing `scan_id`, the server treats it as an idempotent no-op and returns success, guaranteeing zero duplicate entries.

### 5. Admission Policy Engine
- Check-In Points have a configurable `policy_type`:
  - `MULTI_ENTRY`: Records every scan as an admission timestamp; always admits valid tickets.
  - `SINGLE_USE`: Admits on first scan; immediately marks ticket as consumed for this point; subsequent scans return `ALREADY_ADMITTED` rejection with original admission timestamp.
  - `TIER_RESTRICTED`: Validates that attendee's ticket tier is present in allowed tiers list.
  - `CAPACITY_CAPPED`: Tracks net occupancy and rejects when threshold is met.

### 6. API Contracts (REST / JSON)
- `POST /api/auth/otp/request`, `/verify`, `/complete`: Passwordless sign-in and self-registration by mobile number and SMS code (ADR 0012).
- `POST /api/auth/login`: Issue JWT access token for authenticated users.
- `POST /api/events/{event_id}/desk-registrations`: Staff endpoint for rapid walk-in registration.
- `GET /api/attendees/me/ticket`: Attendee endpoint to retrieve digital QR ticket.
- `GET /api/checkin-points/{point_id}/manifest`: Manifest download for offline caching (used by both Flutter and React PWA).
- `POST /api/checkin-points/{point_id}/scans/batch`: Idempotent batch upload of buffered scans (used by both Flutter and React PWA).
- `GET /api/events/{event_id}/analytics/attendance`: Live metrics and throughput reports.

---

## Testing Decisions

### What Makes a Good Test
Tests must verify **observable system behavior from the outside**, never internal wiring, class mocks, or private function mechanics. Tests must demonstrate that real HTTP requests produce correct responses, accurate database state transitions, and expected business rule enforcements.

### Primary Testing Seams
1. **The Public REST API Seam (`httpx.AsyncClient`):**
   - Exercises the entire ASGI stack from HTTP entry to PostgreSQL database.
   - Tests self-registration, desk registration, ticket issuance, manifest generation, and batch scan upload.
2. **Admission Policy Invariant Tests:**
   - Verify that `SINGLE_USE` points admit ticket $T$ on scan 1 and reject ticket $T$ with `ALREADY_ADMITTED` on scan 2.
   - Verify that batch uploads containing duplicate `scan_id` records are processed idempotently without incrementing scan counts.
3. **Offline Queue Sync Simulation Tests:**
   - Simulate an offline client buffering 100 scans, then submitting them in a single batch, verifying that all records persist accurately with original timestamps.
4. **Client Seams:**
   - React scanner view tests for camera fallback, HID input buffer capture, and sync state transitions.
   - Flutter integration tests verifying local SQLite manifest queries and batch sync HTTP client calls.

---

## Out of Scope

- **Payment Gateways & Billing:** All event registration and tickets are 100% free; no payment providers, carts, or invoicing logic are included.
- **Attendee-to-Attendee Networking:** Peer contact exchange via personal QR scanning is reserved for Phase 2.
- **Exhibitor Lead Retrieval:** Booth exhibitor badge scanning and visitor lead forms are reserved for Phase 2.
- **Speaker Abstract Submission & Peer Review:** Academic abstract management and reviewer portals are deferred to subsequent versions.

---

## Further Notes

- **Hardware Recommendations for High-Throughput Desks:** For front-desk stations processing large morning crowds, use a laptop running Chrome connected to a rugged 2D USB barcode scanner (e.g., Zebra DS2208 or Honeywell 1400g) configured in USB HID mode. This eliminates camera positioning delay, achieving scan-and-admit cycles in under 20 milliseconds.
- **Mobile Camera Optimization:** For mobile phone scanning, QR codes should be rendered with high contrast (black on white background, error correction level M, minimum 250x250 pixels on screen) to ensure immediate detection even in dim convention hall lighting.

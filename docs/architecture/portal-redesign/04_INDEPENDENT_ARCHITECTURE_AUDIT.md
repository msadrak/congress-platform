# 04 — Independent Architecture Audit & Readiness Review

**Review Mode:** STRICTLY INDEPENDENT — READ-ONLY REVIEW  
**Reviewer Role:** Independent Principal Software Architect & Application Security Auditor  
**Scope:** Evaluation of Phase 00–03 Architectural Artifacts, Database Schemas, API Contracts, and Current Repository Implementation  
**Final Architectural Verdict:** **CONDITIONAL GO**

---

## 1. Executive Summary & Review Verdict

The Congress Management Platform proposed multi-portal redesign has been subjected to an independent, adversarial architectural audit. This audit evaluates whether the architecture is coherent, secure, backward-compatible, implementable by coding agents, and ready for controlled execution.

### Overall Architecture Verdict: **CONDITIONAL GO**

The architectural foundation proposed in Phase 01–03 is **fundamentally sound and well-engineered**:
- The decoupling of tenants (`Organizer`), global identities (`User`), event-scoped credentials (`DeskOperator`), and physical scanning devices (`ScannerDevice`) respects strict privilege boundaries.
- The 5-portal model (`PublicShell`, `AttendeeShell`, `OrganizerShell`, `ReceptionShell`, `PartnerShell`) maps accurately to genuine physical congress workflows.
- The attendee experience strictly satisfies the client's constraint of **exactly five primary tabs** by embedding the Partner Directory inside *My Congress*.
- The additive schema design preserves all existing ticket identifiers, Entity QR payloads, check-in policies, and lead records without reminting or data migration loss.

However, **CONDITIONAL GO** is issued because implementation MUST NOT proceed until specific architectural preconditions and release-engineering safeguards are resolved:
1. **P03-T00 Release Engineering Precision:** The current T0 task lacks explicit file-by-file staging lists, two-commit isolation (separating uncommitted desk features from architecture docs), and clean worktree creation instructions needed to prevent weak coding agents from destroying dirty working trees.
2. **Desk Token Resurrection Hardening:** The existing `DeskOperator` model flips `is_revoked = False` upon operator re-assignment, which allows a previously revoked JWT (valid for 7 days) to resurrect and regain access. The proposed `session_version` counter in P03-T02 is mandatory and must increment on *both* revocation and reactivation.
3. **Glossary & Domain Reconciliation:** The repository `GLOSSARY.md` explicitly forbids the term "Partner" (directing developers to use "Exhibitor"). A formal architectural amendment must introduce `Partner` as the overarching commercial entity (encompassing Exhibitors, Sponsors, Institutional, and Scientific partners) while preserving `Booth` and `Exhibitor` definitions.
4. **Conditional Scope Fencing:** Four unapproved product features (P03-T56 Event Branding, P03-T57 Profile Editing, P03-T58 Partner Profile Editing, P03-T59 Scientific Program CMS) and P03-T66 Native Scanner Scope must remain strictly fenced as blocked/deferred until explicit client authorization.

---

## 2. Evidence Methodology & Classification

Every factual claim and evaluation in this report is classified under strict evidentiary rules:
- **[VERIFIED IN SOURCE]:** Grounded directly in inspected source code, configuration files, test fixtures, or Git status.
- **[VERIFIED IN DOCUMENTATION]:** Grounded in written Phase 00–03 documentation.
- **[INFERRED]:** Deductions based on domain models and architectural invariants where direct runtime evidence is absent.
- **[UNVERIFIED]:** Claims, performance benchmarks, or responsive behaviors that have not been proven by fresh runtime execution.
- **[CONTRADICTED]:** Claims in previous phase documents that conflict with actual repository implementation or other decisions.

---

## 3. Review of Architectural Reconciliations (AR-01 through AR-06)

Phase 03 proposed six core architectural reconciliations (`03_ARCHITECTURE_RECONCILIATION.md`). Below is the independent adversarial verdict for each:

### AR-01 — Partner Without a Booth: **APPROVE WITH CORRECTIONS**
- **Proposal:** Introduce `Partner` (`id`, `event_id`, `name`, `partner_type`, `description`, `website_url`, `logo_url`, `brochure_url`) and `PartnerStaff`. A Partner belongs to an Event and owns 0 to N Booths. Canonical route is `/partner/:partnerId`. Existing `/booth/:boothId` remains as a direct alias for booth staff.
- **Adversarial Assessment [VERIFIED IN SOURCE & DOCUMENTATION]:**
  - In the database today, there is no `exhibitors` table; only `booths` exists (`backend/app/models.py:168`). Creating `partners` does not duplicate an existing entity.
  - Sponsoring companies without physical booths (e.g., Diamond Sponsor, Scientific Partner) can now log into `/partner/:partnerId`, manage their corporate profile, and view digital materials.
  - **Crucial Security Invariant:** `PartnerStaff` membership grants access *only* to the partner profile and workspace overview. It does **NOT** grant lead capture or lead viewing access. Lead operations (`/api/booths/{booth_id}/leads`) strictly enforce `AuthorizedBoothDep`, which requires a row in `booth_staff`.
  - **Correction Required (ARCH-CORR-01):** The foreign key constraint must be composite: `ForeignKeyConstraint(["partner_id", "event_id"], ["partners.id", "partners.event_id"])` to prevent linking a Booth in Event A to a Partner in Event B at the schema level. Furthermore, `GLOSSARY.md` must be updated to define `Partner` and remove the blanket prohibition on the term.

### AR-02 — Organizer Identity vs. Tenant Key: **APPROVE**
- **Proposal:** Retain the Organizer API key as a tenant credential (`OrganizerDep`). Do not attempt universal human Single Sign-On (SSO) or merge `Organizer` into `User`.
- **Adversarial Assessment [VERIFIED IN SOURCE]:**
  - In `backend/app/auth.py:31`, `Organizer` authentication verifies `Organizer.api_key_hash == hash_api_key(credentials.credentials)`. There is no email, password, or JWT for an Organizer; it is a service/tenant API key.
  - `User` accounts (`backend/app/models.py:27`) represent individual humans with emails, PBKDF2 password hashes, and JWT tokens.
  - Inventing a unified "SSO" without a dedicated database membership model would require insecure heuristic switching or spoofed identity. Phase 03 correctly preserves this boundary: switching from Attendee to Organizer requires providing the Organizer API key.
  - No required workflow is broken by keeping this distinction.

### AR-03 — Independent Reception Portal: **APPROVE WITH CORRECTIONS**
- **Proposal:** Canonical `/reception/:eventId` with an independent `ReceptionShell`. Desk operators authenticate via `POST /api/events/{event_id}/desk/login` and receive an event-bound JWT without needing an Organizer API key. Legacy `/organizer/events/:id/desk` remains compatible.
- **Adversarial Assessment [VERIFIED IN SOURCE]:**
  - `backend/app/routes/desk.py:152` already implements `authorized_desk_operator`, which accepts a desk JWT or an Organizer API key.
  - In `web/src/main.tsx`, the desk page was nested under `<Route element={<OrganizerLayout />}>`. This incorrectly forced front desk operators through the Organizer layout and key prompt.
  - Moving to an independent `/reception/:eventId` allows dedicated station operation, tablet kiosk mode, and isolation from administrative event settings.
  - **Correction Required (ARCH-CORR-02):** The legacy path `/organizer/events/:id/desk` must be extracted from the OrganizerLayout shell or provide a route guard bypass so that accessing the legacy URL does not fail if an organizer key is absent.

### AR-04 — Classification of Unverified UX Claims: **APPROVE**
- **Proposal:** Formally classify previous unverified claims ("under 5 seconds registration", "320px mobile ready", "scientific program CMS", "native scanner operational") as targets or proposed features rather than verified achievements.
- **Adversarial Assessment [VERIFIED IN SOURCE]:**
  - Walk-in issuance speed has never been measured under automated load or stopwatch testing.
  - Responsive layout at 320px for wide tables (7+ columns in organizer detail) has not been verified in browser tests.
  - Native Flutter scanner has an in-memory storage service (`mobile/lib/services/storage_service.dart`) and unauthenticated pairing screens; it is a prototype, not an operational scanner.
  - Classifying these as design targets prevents deceptive verification reports.

### AR-05 — Explicit Credential Authority: **APPROVE**
- **Proposal:** Pure explicit-authority client factory in `web/src/api/client.ts`. Eliminate pathname-based token guessing and cross-credential fallbacks. Public requests must send NO `Authorization` header.
- **Adversarial Assessment [VERIFIED IN SOURCE]:**
  - Existing `client.ts:56-83` inspects `window.location.pathname.startsWith('/organizer')` to choose between `organizerKey` and `userToken`. This causes credential leakage when an organizer visits public pages, and causes subtle 401/403 bugs during multi-tab workflows.
  - Removing heuristic token attachment is a critical security improvement.

### AR-06 — Attendee Type on Ticket vs. User: **APPROVE**
- **Proposal:** Store `attendee_type_id` on `Ticket`, along with an immutable `attendee_type_name_at_issue` snapshot (varchar 100). Do not place attendee type on `User` or `TicketTier`.
- **Adversarial Assessment [VERIFIED IN SOURCE & DOMAIN]:**
  - A `User` is a platform-wide identity across multiple congresses. A person may be a "VIP Speaker" at Congress 2026 and a "General Attendee" at Congress 2027. Placing attendee type on `User` would corrupt multi-event participation.
  - `TicketTier` manages pricing, quotas, and admission capacity. Placing attendee type on `TicketTier` conflates commercial inventory with attendee taxonomy.
  - Storing `attendee_type_name_at_issue` ensures that if an organizer renames or deactivates an attendee type after registration, historical badges and tickets retain the exact label printed at issuance.
  - Composite foreign key `ForeignKeyConstraint(["attendee_type_id", "event_id"], ["attendee_types.id", "attendee_types.event_id"])` enforces cross-event referential integrity.

---

## 4. Domain Model & Database Schema Audit

### 4.1 Table Inventory & Proposed Expansions
The current database contains 15 tables across migrations `0001` through `0011`. Phase 03 proposes three serialized migrations:

1. **Migration 0012 (P03-T02):** Add `desk_operators.session_version` (Integer, NOT NULL, server_default=0).
2. **Migration 0013 (P03-T11):**
   - Create `partners` table (`id` UUID PK, `event_id` UUID FK, `name` VARCHAR(200), `partner_type` VARCHAR(50), `description` TEXT, `website_url` VARCHAR(500), `logo_url` VARCHAR(500), `brochure_url` VARCHAR(500), `created_at` TIMESTAMPTZ).
   - Create `partner_staff` table (`id` UUID PK, `partner_id` UUID FK, `user_id` UUID FK, `created_at` TIMESTAMPTZ, UniqueConstraint(`partner_id`, `user_id`)).
   - Alter `booths`: Add `partner_id` UUID nullable, indexed.
   - Composite FK: `(partner_id, event_id) REFERENCES partners(id, event_id)` with `unique(id, event_id)` on `partners`.
   - Deterministic Backfill: Insert into `partners` with `id = booth.id`, `partner_id = booth.id`.
3. **Migration 0014 (P03-T17):**
   - Create `attendee_types` table (`id` UUID PK, `event_id` UUID FK, `name` VARCHAR(100), `description` TEXT, `display_order` INT, `is_active` BOOLEAN, `created_at` TIMESTAMPTZ, UniqueConstraint(`event_id`, `name`), UniqueConstraint(`id`, `event_id`)).
   - Alter `tickets`: Add `attendee_type_id` UUID nullable, indexed; Add `attendee_type_name_at_issue` VARCHAR(100) nullable.
   - Composite FK: `(attendee_type_id, event_id) REFERENCES attendee_types(id, event_id)`.

### 4.2 Migration Safety Analysis
- **Additive Nature:** All new columns are nullable or have safe defaults (`session_version = 0`). No existing columns or tables are dropped or renamed.
- **Rollback Safety:** Application rollback retains the additive columns without data loss. Reverting migrations down is lossy (drops partners and attendee types) and must be restricted to isolated staging environments.
- **Referential Consistency:** Both new relationships (`booths -> partners` and `tickets -> attendee_types`) enforce composite foreign keys including `event_id`. This prevents cross-tenant or cross-event linkage at the database engine level.

---

## 5. Authentication & Authorization Security Review

### 5.1 Token Resurrection Analysis
- **Vulnerability Identified [VERIFIED IN SOURCE]:** In `backend/app/routes/desk.py:385-405`, when an organizer re-adds a previously revoked operator, `existing_op.is_revoked` is set to `False`. The desk JWT issued *prior* to revocation has a 7-day expiration and contains only `operator_id` and `event_id`. When presented, `authorized_desk_operator` checks `operator.is_revoked`, which is now `False`. The old token is immediately resurrected and accepted.
- **Architectural Solution [VERIFIED IN DESIGN]:** P03-T02 introduces `session_version` on `DeskOperator`. Both revocation and reactivation increment `session_version`. Token validation asserts `payload.get("session_version") == operator.session_version`. Legacy versionless tokens are accepted only when `operator.session_version == 0`. Old tokens are permanently invalidated.

### 5.2 Token Family Segregation
- `create_access_token` (User): `sub` is user UUID string. No `type` claim.
- `create_desk_operator_token`: `sub = "desk:{id}"`, `type = "desk_operator"`.
- `create_scanner_token`: `sub = "scanner:{id}"`, `type = "scanner"`.
- **Finding:** In `backend/app/routes/auth.py:56` (`current_user`), the token subject is parsed as `uuid.UUID(payload["sub"])`. Scanner and desk tokens raise a `ValueError` because of the prefix, returning 401. However, defense-in-depth requires explicitly validating that `payload.get("type") in (None, "user")` to prevent any future JWT ambiguity. This is correctly scheduled in P03-T01.

---

## 6. Frontend & UX Architecture Review

### 6.1 Attendee 5-Tab Navigation Constraint
The client requires **exactly five primary tabs** in the Attendee portal:
1. `My Congress` (`/c/:slug/my-congress`)
2. `My Network` (`/c/:slug/my-network`)
3. `My Ticket` (`/c/:slug/my-ticket`)
4. `My Profile` (`/c/:slug/my-profile`)
5. `Congress Details` (`/c/:slug/details`)

**Audit Findings:**
- The Partner Directory is embedded as a sub-section inside `My Congress`, satisfying CR-08 and CR-09 without introducing a 6th primary tab.
- High-contrast QR ticket presentation is retained in `My Ticket` with local offline caching (`ticketCache.ts`).
- `My Profile` combines global identity (`/api/auth/me`) with the event ticket's immutable category snapshot and peer networking privacy toggle (`share_contact_with_peers`).

### 6.2 Responsive Design & Viewport Strategy
- Target viewports: **320px, 375px, 390px, 430px, 768px, 1024px, 1440px** in both EN/LTR and FA/RTL.
- **Risk Identified:** At 320px width, 5 text labels in a bottom navigation bar risk horizontal clipping in Persian. The implementation must enforce compact icon-first presentation with accessible screen-reader labels and minimum 48×48px touch targets.
- **Readiness Classification:** Marked **UNVERIFIED** pending live Playwright viewport execution under P03-T62.

---

## 7. Architectural Corrections Register (Summary)

| Correction ID | Severity | Component | Finding & Required Correction |
|---|---|---|---|
| ARCH-CORR-01 | HIGH | Domain / Schema | Composite FK `(partner_id, event_id)` and `(attendee_type_id, event_id)` must be strictly enforced in migrations 0013 and 0014. Update `GLOSSARY.md` to define Partner. |
| ARCH-CORR-02 | HIGH | Routing / Reception | Legacy route `/organizer/events/:id/desk` must not be blocked by OrganizerLayout API key gate. |
| ARCH-CORR-03 | CRITICAL | Security / Desk | `session_version` must increment on *both* revocation and reactivation. Reject old tokens permanently. |
| ARCH-CORR-04 | HIGH | Security / Auth | `CurrentUserDep` must explicitly reject tokens where `type` is present and not `"user"`. |
| ARCH-CORR-05 | MEDIUM | Release Engineering | P03-T00 must provide a precise 17-file manifest, separate code from docs commits, and use `git worktree` for clean verification. |
| ARCH-CORR-06 | HIGH | Partner / Leads | PartnerStaff membership must never imply or grant Booth lead access. Lead APIs remain strictly tied to `BoothStaff`. |
| ARCH-CORR-07 | MEDIUM | Analytics / CSV | Analytics attendance GET supports filters; export CSV exports all event rows. Do not promise filtered CSV export. |
| ARCH-CORR-08 | HIGH | UX / Navigation | Bottom navigation at 320px must prevent text clipping in Persian; responsive acceptance is UNVERIFIED until tested. |
| ARCH-CORR-09 | HIGH | Scope Fencing | T56–T59 and T66 must remain strictly fenced as blocked/conditional. No speculative CMS code. |

---

## 8. Final Readiness Verdict

- **Architecture Coherence:** **GO**
- **Security & Authorization Design:** **GO**
- **Data & Migration Safety:** **GO**
- **Task Backlog Specification:** **CONDITIONAL GO** (Subject to T0 release engineering corrections)
- **T0 Execution Readiness:** **READY AFTER INCORPORATING T0 STEP-BY-STEP SPECIFICATION**
- **Feature Implementation Readiness:** **BLOCKED PENDING T0 COMPLETION AND HUMAN APPROVAL**
- **Production Release Readiness:** **NOT ASSESSED / BLOCKED** (Production release requires completing all implementation waves, regression gates, and staging rehearsals)

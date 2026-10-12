# 04 — Backlog Audit & Task Specification Review

**Review Mode:** STRICTLY INDEPENDENT — READ-ONLY REVIEW  
**Reviewer Role:** Technical Delivery Reviewer, Senior QA Architect & Principal Systems Auditor  
**Scope:** Exhaustive Audit of All 67 Tasks (P03-T00 through P03-T66) in `03_TASK_BACKLOG.md`  
**Verdict:** **CONDITIONAL GO** (58 Tasks Ready / Ready with Minor Corrections; 5 Tasks Blocked/Conditional; 4 Tasks Needing Concrete Step Hardening)

---

## 1. Backlog Evaluation Overview

Every single implementation task from **P03-T00 through P03-T66** was evaluated against 18 rigor criteria:
1. Unique task ID and descriptive title.
2. Concrete, verifiable product/engineering outcome.
3. Accurate baseline grounded in repository source.
4. Explicit, acyclic prerequisites.
5. Narrowly bounded scope (anti-sprawl).
6. Clear out-of-scope exclusions.
7. Correct source file references (confirmed existing vs. proposed).
8. Accurate backend contracts (HTTP methods, paths, status codes, schemas).
9. Strict server-side authorization boundaries.
10. Explicit database/migration impacts.
11. Step-by-step implementation instructions implementable by weak coding agents.
12. Observable Given/When/Then acceptance criteria.
13. Negative security and boundary tests.
14. Regression guards (R01–R20 mapping).
15. Concrete manual verification steps.
16. Safe rollback and containment strategy.
17. Measurable Definition of Done.
18. Explicit stop condition.

---

## 2. Exhaustive Task Classification Matrix (P03-T00 … P03-T66)

| Task ID | Title | Priority | Prerequisites | Status Classification | Weak-Agent Readiness | Audit Notes & Required Corrections |
|---|---|---|---|---|---|---|
| **P03-T00** | Authorize & establish local baseline | P0 | Human approval | **READY WITH MINOR CORRECTIONS** | MEDIUM | Needs explicit 17-file manifest, 2-commit separation, and `git worktree` instructions to prevent accidental tree wipe. |
| **P03-T01** | Stabilize token family & status contracts | P0 | T00 | **READY** | HIGH | Explicitly asserts `type` claim in `CurrentUserDep`. Rejects non-UUID and non-user tokens. |
| **P03-T02** | Prevent desk-session resurrection | P0 | T01 | **READY WITH MINOR CORRECTIONS** | HIGH | Migration for `session_version`. Must increment on *both* revoke and reactivate. |
| **P03-T03** | Pure explicit-authority API boundary | P0 | T01 | **READY** | HIGH | Factory in `web/src/api/client.ts`. Passing `null` guarantees no `Authorization` header. |
| **P03-T04** | Cut public/entry requests to anonymous | P1 | T03 | **READY** | HIGH | Disjoint callsite migration for `PublicEvent` and login/registration forms. |
| **P03-T05** | Bind organizer requests to tenant key | P1 | T03 | **READY** | HIGH | Restricts `Organizer` callsites exclusively to `organizerKey`. |
| **P03-T06** | Bind attendee/booth requests to User JWT | P1 | T03 | **READY** | HIGH | Scopes attendee and booth portal callsites to `userToken`. |
| **P03-T07** | Select reception credentials per event | P1 | T02, T03 | **READY** | HIGH | Scopes desk callsites to event desk JWT or explicit organizer admin mode. |
| **P03-T08** | Preserve scanner transport under device auth | P1 | T03 | **READY** | HIGH | Scopes GateScanner to device token; leaves engine and offline queue byte-intact. |
| **P03-T09** | Remove heuristic client after migration | P1 | T04–T08 | **READY** | HIGH | Deletes deprecated heuristic `getApiClient` after all callers migrate. |
| **P03-T10** | Descriptive current-row access discovery | P1 | T01 | **READY** | HIGH | Read-only `GET /api/me/access`. Returns active event roles. No organizer key returned. |
| **P03-T11** | Partner schema expansion & 1:1 backfill | P1 | T02 | **READY WITH MINOR CORRECTIONS** | HIGH | Migration 0013. Creates `partners`, `partner_staff`. Enforce composite FK `(partner_id, event_id)`. |
| **P03-T12** | Organizer Partner management endpoints | P1 | T11 | **READY** | HIGH | POST/GET/PATCH `/api/events/{id}/partners`. No hard DELETE (preserves history). |
| **P03-T13** | Organizer Partner staff assignment | P1 | T12 | **READY** | HIGH | POST/GET/DELETE `/api/events/{id}/partners/{id}/staff`. Existing user required (409 if absent). |
| **P03-T14** | Booth-to-Partner linking & reconciliation | P1 | T13 | **READY** | HIGH | PATCH `/api/events/{id}/booths/{id}` with `partner_id`. Preserves booth QR and lead history. |
| **P03-T15** | Read-only Partner endpoints | P1 | T14 | **READY** | HIGH | GET `/api/partners/{id}` and public `/api/public/events/{slug}/partners`. |
| **P03-T16** | Enrich access discovery with partners | P1 | T15, T10 | **READY** | HIGH | Adds `partner_ids` to `GET /api/me/access`. Deduplicates multi-booth representations. |
| **P03-T17** | AttendeeType schema & Ticket snapshot | P1 | T11 | **READY WITH MINOR CORRECTIONS** | HIGH | Migration 0014. Enforce composite FK `(attendee_type_id, event_id)` on `tickets`. |
| **P03-T18** | Organizer AttendeeType CRUD & public list | P1 | T17 | **READY** | HIGH | POST/GET/PATCH `/attendee-types`. Public `active_attendee_types` array on event payload. |
| **P03-T19** | Category selection at issuance & snapshot | P1 | T18 | **READY** | HIGH | Reserves optional category; captures immutable `attendee_type_name_at_issue`. |
| **P03-T20** | Organizer AttendeeType UI | P1 | T18 | **READY** | HIGH | React manager in organizer event settings. Separate from ticket tier inventory. |
| **P03-T21** | Shared navigation & error primitives | P1 | T09 | **READY** | HIGH | Reusable AuthContext, error boundary, RTL container, safe layout primitives. |
| **P03-T22** | Portal chooser screen for multi-role users | P1 | T21, T16 | **READY** | HIGH | Routes user to Attendee, Reception, or Partner portal based on verified eligibility. |
| **P03-T23** | AttendeeShell with exactly 5 primary tabs | P1 | T21 | **READY** | HIGH | Enforces 5 primary tabs: My Congress, My Network, My Ticket, My Profile, Details. |
| **P03-T24** | My Ticket reuses QR & offline cache | P1 | T23, T19 | **READY** | HIGH | Reuses high-contrast QR pass, offline `ticketCache.ts`, renders historical category. |
| **P03-T25** | My Network scoped to active event | P1 | T23 | **READY** | HIGH | Filters connections by event; preserves private notes and RFC-compliant vCard download. |
| **P03-T26** | My Congress status & saved booths | P1 | T24 | **READY** | HIGH | Event overview, registration status, bookmarked exhibition booths. |
| **P03-T27** | Partner directory inside My Congress | P1 | T26, T15 | **READY** | HIGH | Embedded directory of exhibitors and sponsors. Does NOT create a 6th primary tab. |
| **P03-T28** | Read-only My Profile & privacy toggle | P1 | T23, T19 | **READY** | HIGH | Displays User identity + event ticket category snapshot + peer contact sharing toggle. |
| **P03-T29** | Congress Details informational view | P1 | T23 | **READY** | HIGH | Displays verified event metadata, venue, dates, description from `PublicEvent`. |
| **P03-T30** | Active congress picker & legacy aliases | P1 | T24–T26, T28, T29 | **READY** | HIGH | Multi-event picker. Preserves `/my-tickets` and `/my-network` as direct aliases. |
| **P03-T31** | OrganizerShell preserves event management | P1 | T21, T05 | **READY** | HIGH | Preserves organizer key gate, event creation, settings navigation, and tenant mask. |
| **P03-T32** | Ticket tier management decomposition | P2 | T31 | **READY (DEFERRABLE)** | HIGH | Decomposes tier manager from `OrganizerEventDetail.tsx`. Non-breaking refactoring. |
| **P03-T33** | Check-in point policy decomposition | P2 | T31 | **READY (DEFERRABLE)** | HIGH | Decomposes check-in point manager from `OrganizerEventDetail.tsx`. Non-breaking. |
| **P03-T34** | Desk operator manager & generation bump | P1 | T31, T02 | **READY** | HIGH | Operator list, create, revoke. Triggers `session_version` increments. |
| **P03-T35** | Organizer Partner & staff management UI | P1 | T31, T14 | **READY** | HIGH | Organizer interface to create partners, link booths, and assign staff emails. |
| **P03-T36** | Analytics dashboard & event-wide CSV | P2 | T31 | **READY (DEFERRABLE)** | HIGH | Preserves 10s throughput polling and event-wide CSV export. Explicitly labels CSV as event-wide. |
| **P03-T37** | Independent ReceptionShell & canonical route | P1 | T21, T07 | **READY** | HIGH | Registers `/reception/:eventId` outside OrganizerLayout. Independent operator session. |
| **P03-T38** | Reception login form extraction | P1 | T37 | **READY** | HIGH | Event-bound login form (`POST /desk/login`). Retains reusable temp password flow. |
| **P03-T39** | Attendee search & detail extraction | P1 | T37 | **READY** | HIGH | Rapid attendee search by name, email, organization. Retrieval of existing QR. |
| **P03-T40** | Walk-in issuance with category & tier | P1 | T39, T19 | **READY** | HIGH | Rapid issuance form with tier selector and optional attendee category selector. |
| **P03-T41** | Badge/pass display & browser print | P1 | T39 | **READY** | HIGH | High-contrast printable badge view. Uses CSS `@media print`. No hardware dependencies. |
| **P03-T42** | Duplicate email conflict drawer | P1 | T40 | **READY** | HIGH | Handles 409 Conflict. Displays existing ticket and allows instant reprint without duplicate mint. |
| **P03-T43** | Reception session expiry & safe drafts | P1 | T38 | **READY** | HIGH | Interrupted submission preserves form draft for same operator/event; requires re-auth. |
| **P03-T44** | Legacy desk route alias cutover | P1 | T37–T43 | **READY WITH MINOR CORRECTIONS** | HIGH | Bypasses OrganizerLayout key prompt when accessing `/organizer/events/:id/desk`. |
| **P03-T45** | Independent PartnerShell & canonical route | P1 | T21, T16 | **READY** | HIGH | Registers `/partner/:partnerId`. Authenticated via User JWT + PartnerStaff row. |
| **P03-T46** | Partner context & multi-booth selector | P1 | T45 | **READY** | HIGH | Renders partner profile and booth selector if partner has multiple booths. |
| **P03-T47** | Sponsor without booth view | P1 | T46 | **READY** | HIGH | Sponsor profile presentation. Truthfully displays zero booths and no lead tools. |
| **P03-T48** | Manual lead capture via QR secret entry | P1 | T46 | **READY** | HIGH | Standalone form to input badge QR secret and record lead. Requires `BoothStaff`. |
| **P03-T49** | Lead qualification feed, ratings & notes | P1 | T48 | **READY** | HIGH | Updates lead rating (HOT/WARM/COLD), tags, and private booth sales notes. |
| **P03-T50** | Sanitized CRM CSV export for booth | P1 | T49 | **READY** | HIGH | Downloads CSV with formula injection defense (`'`) and UTF-8 BOM. |
| **P03-T51** | Camera barcode scanner integration | P1 | T48 | **READY** | HIGH | Adds WebRTC / BarcodeDetector video scan. Falls back seamlessly to manual form. |
| **P03-T52** | Legacy `/booth/:boothId` route alias | P1 | T48–T51 | **READY** | HIGH | Preserves existing booth URL as direct entry into booth lead workspace. |
| **P03-T53** | PublicShell & preserved platform landing | P1 | T21, T04 | **READY** | HIGH | Preserves `/` and `/e/:slug`. Strictly anonymous API requests. |
| **P03-T54** | Public partner/sponsor section | P1 | T53, T15 | **READY** | HIGH | Renders sponsor logos, exhibitor links, and brochures from real public partner API. |
| **P03-T55** | Public reservation & login integration | P1 | T53, T19, T22, T30 | **READY** | HIGH | Registration modal with optional category selection. Seamless redirect to My Ticket. |
| **P03-T56** | [CONDITIONAL] Event branding (logo/cover) | P3 | T53, T17 | **BLOCKED (CONDITIONAL)** | MEDIUM | Blocked pending explicit product approval of branding schema and asset storage policy. |
| **P03-T57** | [CONDITIONAL] Profile organization editing | P3 | T28 | **BLOCKED (CONDITIONAL)** | MEDIUM | Blocked pending explicit product approval of mutable profile vs. ticket snapshot rules. |
| **P03-T58** | [CONDITIONAL] Partner profile self-editing | P3 | T47 | **BLOCKED (CONDITIONAL)** | MEDIUM | Blocked pending explicit product approval of partner representative self-editing bounds. |
| **P03-T59** | [CONDITIONAL] Scientific program CMS gate | P3 | T00 | **BLOCKED (CONDITIONAL)** | MEDIUM | Decision gate only. Blocked pending complete data model addendum. No code allowed. |
| **P03-T60** | Security regression gate (Cartesian S01-S18) | P0 | T09, T16, T19, T43, T52 | **READY** | HIGH | Automated Cartesian negative test suite verifying all 18 security invariants. |
| **P03-T61** | Real-browser E2E portal journeys | P1 | 13 feature tasks | **READY** | HIGH | Live Playwright suite covering all 5 portals, navigation, reload, history, and aliases. |
| **P03-T62** | 7-viewport responsive & accessibility gate | P1 | T61 | **READY** | HIGH | Viewport checks at 320, 375, 390, 430, 768, 1024, 1440px in EN/LTR and FA/RTL. |
| **P03-T63** | Scanner PWA offline, restart & device gate | P1 | T08, T61 | **READY** | HIGH | Validates IndexedDB offline queue, camera/HID, SW caching, device unpair. |
| **P03-T64** | Populated migration & rollback rehearsal | P0 | T14, T19, T60 | **READY** | HIGH | Rehearses 0011 -> 0012 -> 0013 -> 0014 on realistic populated database. |
| **P03-T65** | Clean-checkout staging & pilot Go/No-Go | P0 | T60–T64, T66 | **READY** | HIGH | Verifies entire system from fresh clone without dirty worktree dependencies. |
| **P03-T66** | Native scanner scope decision gate | P1 | T00 | **READY (DECISION GATE)** | HIGH | Documents native Flutter limitations; formally excludes native from web MVP release. |

---

## 3. Analysis of Task Count, Minimization & Deferrable Work

The total count of 67 tasks was challenged to determine whether it represents over-decomposition or unnecessary ceremony:
1. **Granularity Rationale:** The tasks are intentionally atomic (average expected diff: 100–250 lines per task). This narrow sizing is specifically tailored for automated coding agents, which frequently fail, hallucinate, or drop pre-existing code when assigned monolithic 1,000-line tasks.
2. **True MVP Minimization:**
   - **P0 Tasks (Mandatory Foundation & Gates):** Exactly 7 tasks (`T00`, `T01`, `T02`, `T03`, `T60`, `T64`, `T65`).
   - **P1 Tasks (Essential Client MVP):** Exactly 53 tasks. These directly deliver the five portals, five attendee tabs, partner directory, reception station, and regression suites required by the client.
   - **P2 Tasks (Deferrable Internal Refactoring):** Exactly 3 tasks (`T32` Tier decomposition, `T33` Check-in point decomposition, `T36` Analytics decomposition). In the current code, `OrganizerEventDetail.tsx` already has working tier, gate, and analytics management. These 3 tasks can be safely deferred to a post-MVP wave if the delivery timeline requires immediate feature delivery.
   - **P3 Tasks (Conditional / Blocked Scope):** Exactly 4 tasks (`T56`, `T57`, `T58`, `T59`). These must remain blocked and excluded from the MVP build.

---

## 4. Hardened Specification for P03-T00 (Release Engineering Baseline)

To ensure that a weak coding agent can execute P03-T00 safely without destroying the repository, the following concrete instructions are mandated:

### Step 1: Inventory the Exactly 17 Uncommitted Application & Test Files
The dirty working tree contains exactly 14 modified tracked files and 3 untracked backend files:
- **Tracked Modifications (14 files):**
  1. `backend/app/models.py`
  2. `backend/app/routes/checkin.py`
  3. `backend/app/routes/desk.py`
  4. `backend/app/routes/events.py`
  5. `backend/app/routes/public.py`
  6. `backend/app/routes/ticket_tiers.py`
  7. `backend/app/security.py`
  8. `backend/tests/test_public_event.py`
  9. `web/src/api/client.ts`
  10. `web/src/api/schema.d.ts`
  11. `web/src/lib/i18n.ts`
  12. `web/src/pages/OrganizerDesk.tsx`
  13. `web/src/pages/OrganizerEventDetail.tsx`
  14. `web/src/pages/OrganizerLayout.tsx`
- **Untracked Code & Tests (3 files):**
  15. `backend/migrations/versions/0011_desk_operators_and_attribution.py`
  16. `backend/tests/test_desk_operator_auth.py`
  17. `backend/tests/test_management_lifecycle.py`

### Step 2: Secret & Credential Pre-Commit Audit
Execute read-only checks to guarantee that no `.env`, JWT secrets, or administrative tokens are present in the staged diff:
```bash
git diff --staged | grep -iE "secret|token|password|api_key"
```
Ensure all detected occurrences are environment variable references, test fixtures, or documentation, not production secrets.

### Step 3: Two-Commit Separation (Upon Human Approval)
Commit 1 must contain ONLY the 17 desk feature and test files:
```bash
git add backend/app/models.py backend/app/security.py backend/app/routes/desk.py \
        backend/app/routes/checkin.py backend/app/routes/events.py backend/app/routes/public.py \
        backend/app/routes/ticket_tiers.py backend/tests/test_public_event.py \
        backend/migrations/versions/0011_desk_operators_and_attribution.py \
        backend/tests/test_desk_operator_auth.py backend/tests/test_management_lifecycle.py \
        web/src/api/client.ts web/src/api/schema.d.ts web/src/lib/i18n.ts \
        web/src/pages/OrganizerDesk.tsx web/src/pages/OrganizerEventDetail.tsx web/src/pages/OrganizerLayout.tsx
git commit -m "feat(desk): desk operator management, walk-in registration and attribution (0011)"
```
Commit 2 must contain ONLY the architecture documentation under `docs/architecture/portal-redesign/`:
```bash
git add docs/architecture/portal-redesign/
git commit -m "docs(architecture): portal redesign specification and audit baseline (phases 00-04)"
```

### Step 4: Verification in an Isolated Worktree (Never in Place)
To prevent `git checkout` from destroying uncommitted files or altering local developer configurations:
```bash
git worktree add ../clean-verification HEAD
cd ../clean-verification/backend
uv run alembic upgrade head
uv run pytest tests/test_desk_operator_auth.py tests/test_management_lifecycle.py -q
cd ../web
npm run typecheck
cd ..
git worktree remove ../clean-verification
```

---

## 5. Weak-Agent Safety Directives

Every coding agent assigned to any task P03-T01 through P03-T66 must obey these non-negotiable execution constraints:
1. **One Task at a Time:** An agent must complete only their assigned task, verify its acceptance criteria, and stop. Never proceed to the next task in the DAG.
2. **No Unilateral Schema Changes:** Schema migrations are strictly owned by T02 (0012), T11 (0013), and T17 (0014). No other task is permitted to author an Alembic migration.
3. **No Fallback to Storage Heuristics:** In frontend tasks, never re-introduce `localStorage` fallbacks into `getApiClient`. Use the explicit authority parameter passed down from the portal shell's AuthContext.
4. **Preserve Legacy URLs as Direct Aliases:** Never use `Navigate replace` or HTTP redirects to reroute legacy URLs (`/my-tickets`, `/my-network`, `/booth/:boothId`, `/organizer/events/:id/desk`). Render the target portal content directly at the requested URL.

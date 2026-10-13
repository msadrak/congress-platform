# 01 — Architecture Decision Records (D01–D10)

Phase 01 planning decisions. Status values: RECOMMENDED / PROVISIONAL / BLOCKED.

---

## D01 — Human Identity Model

**Problem:** Who is the authenticated principal, and does "Admin" mean Organizer or Platform Admin?
**Current:** `User` (global human, email+password) for attendees/booth staff/desk operators; `Organizer` is a *tenant* identified by an API key, not a person; Platform Admin is a static env token protecting only organizer provisioning.
**Options:** (a) Personify organizers into User + role; (b) keep tenant-key organizer, User for humans; (c) introduce full platform-admin user tier.
**Recommended:** (b) — keep `User` as the single human identity; "Admin portal" = current Organizer console (tenant-key). **[ASSUME]** flagged: client's "Admin" most plausibly maps to Organizer per the route map and glossary.
**Rationale:** Zero migration of organizer automation; tenant key is an integration credential, not a session; client requirements name organizer-managed reception, which already assumes organizer-level administration.
**Trade-offs:** Organizer key has no per-person attribution; rotation tooling absent (optional hardening later).
**Required changes:** None to identity tables. Label the portal "Admin/Organizer".
**Regression risks:** None.
**Verification:** `test_organizers.py`, `test_events.py` remain green.
**Status:** RECOMMENDED (pending product confirmation of Admin semantics — **[OPEN]**).

## D02 — Event-Scoped Roles and Memberships

**Problem:** How are roles represented for multi-role, multi-event users?
**Current:** Role = presence of a row: `Ticket` (attendee), `DeskOperator` (reception, event-scoped, revocable), `BoothStaff` (partner, booth-scoped). No role flags on User.
**Options:** (a) generic `Role`/`Membership` tables (RBAC); (b) keep row-presence roles, add read-only resolution endpoint.
**Recommended:** (b). Row-presence is already enforced by three tested authorizers; a generic RBAC layer adds indirection without a requirement.
**Rationale:** The brief forbids an abstract infinitely-configurable RBAC; existing invariants (unique constraints, revocation columns) are load-bearing and tested.
**Trade-offs:** Role logic is distributed across three tables — mitigated by single `GET /api/me/access` resolver.
**Required changes:** New read-only resolver endpoint; no schema change.
**Regression risks:** Resolver must exclude revoked operators and treat booth staff correctly; covered by new tests against existing fixtures.
**Verification:** Unit tests per scenario S1–S9 in `01_DOMAIN_MODEL.md`.
**Status:** RECOMMENDED.

## D03 — Authentication Strategy

**Problem:** Five coexisting credential mechanisms with heuristic client selection.
**Current:** §1 of `01_AUTHENTICATION_ARCHITECTURE.md` (all five verified).
**Options:** A preserve + explicit context; B unified human session; C hybrid.
**Recommended:** **C — Hybrid**: immediate explicit-context contract (A), converge human tokens (attendee + desk are already user-bound HS256), permanently retain organizer API key (tenant credential) and scanner JWT (device credential).
**Rationale:** Lowest migration risk; 100% authorizer reuse; no OAuth/OTP/cookie infrastructure justified by requirements.
**Trade-offs:** Organizer key and attendee JWT remain non-revocable (attendee) / non-rotatable (organizer) — documented as optional future hardening, not blockers.
**Required changes:** `GET /api/me/access`; frontend AuthContext; removal of heuristic fallback.
**Regression risks:** Desk/scanner flows must remain byte-compatible; guarded by `test_desk_operator_auth.py`, `test_scanner_revocation_matrix.py`.
**Verification:** 14 negative scenarios (`01_AUTHORIZATION_MATRIX.md` §3) as executable backend tests.
**Status:** RECOMMENDED.

## D04 — Explicit Frontend Credential Resolution

**Problem:** `client.ts:56-83` guesses credentials by pathname with cross-fallback; organizer key can leak to attendee/public endpoints; exhibitor portal depends on implicit localStorage state.
**Current:** Verified heuristic (lines 56-83), plus a third ad-hoc path in `OrganizerDesk.tsx:31-37`.
**Options:** (a) fix heuristic priorities; (b) explicit AuthContext where `credential = f(activePortal, activeEventId)` with no fallbacks; (c) server sessions.
**Recommended:** (b) — the contract in `01_AUTHENTICATION_ARCHITECTURE.md` §5. Delete `scope="any"`; each API call site declares its portal context.
**Rationale:** Deterministic; directly answers "which principal and event context does each request represent"; fail-closed (null credential → portal login UI, never substitution).
**Trade-offs:** Every call site must be migrated; enforced by lint rule + grep gate on residual `getApiClient(` without explicit context.
**Required changes:** New context module; refactor `getApiClient`; migrate ~12 page call sites.
**Regression risks:** Mis-mapped portal context → 401 loops; caught by per-portal smoke tests.
**Verification:** Scenario 11 in negative matrix; unit test that credential selection never crosses portals.
**Status:** RECOMMENDED.

## D05 — Reception Operator Authorization

**Problem:** Organizer-provisioned reception access without exposing the master key (CR-05).
**Current:** Uncommitted but complete: `DeskOperator` model, migration 0011, desk JWT (`type=desk_operator`, event-locked, 7-day), per-request revocation, operator management restricted to `OwnedEventDep`, ticket attribution (`issued_by_operator_id`).
**Options:** (a) adopt as-is; (b) rebuild on unified sessions.
**Recommended:** (a) — adopt the existing implementation unchanged; lifecycle: organizer adds operator (email + display name, `OwnedEventDep`) → operator logs in at desk endpoint with personal credentials → event-locked JWT → per-request revocation enforcement → organizer revokes (`POST/DELETE .../revoke`) → 401 thereafter.
**Rationale:** Already satisfies every requirement of §9 including attribution and the never-expose-master-key rule; tested (`test_desk_operator_auth.py` passed in Phase 00 run).
**Trade-offs:** 7-day desk token with no refresh — acceptable for event-timeframe operations; re-login on expiry.
**Required changes:** **Git integration of the uncommitted changeset is a precondition** (Task 05H; human-approved, outside this phase). Frontend: Reception portal uses this auth path exclusively.
**Regression risks:** None if integrated as-is.
**Verification:** `test_desk_operator_auth.py`, `test_desk_registration.py`, `test_management_lifecycle.py`.
**Status:** RECOMMENDED (integration BLOCKED on pending git integration — flagged, not performed here).

## D06 — Partner vs Exhibitor Domain Model

**Problem:** Client says "Partner"; codebase says Booth/Exhibitor with all lead logic booth-keyed.
**Current:** See `01_DOMAIN_MODEL.md` §4 evidence.
**Options:** A label-only rename; B full Partner entity superset; C minimal extension (Partner entity + nullable `Booth.partner_id`, staff/leads stay booth-keyed).
**Recommended:** **C**.
**Rationale:** Preserves lead isolation, CSV export, bookmarks, public booth pages (all tested); supports boothless partners for CR-09 listing; escalation to B is purely additive later.
**Trade-offs:** Two-level hierarchy (partner→booths) adds one join in partner listings; partner-level staff deferred.
**Required changes:** `Partner` table, nullable `Booth.partner_id` + 1:1 backfill, partner list endpoint for My Congress, public partner listing.
**Regression risks:** Backfill correctness — verified by migration test comparing booth/partner counts.
**Verification:** New model tests + existing booth/lead/bookmark suites unchanged-green.
**Status:** RECOMMENDED.

## D07 — Configurable Attendee Types

**Problem:** CR-06; currently absent (verified).
**Current:** TicketTier is quota/inventory only.
**Options:** (a) overload TicketTier; (b) new `AttendeeType` entity, nullable FK on Ticket.
**Recommended:** (b) — schema and rules in `01_DOMAIN_MODEL.md` §5.
**Rationale:** Tier drives quota and admission policy; type is a taxonomy label; overloading tier would corrupt inventory semantics and admission policies (`allowed_tier_ids`).
**Trade-offs:** One more admin CRUD surface; nullable FK keeps all existing tickets valid.
**Required changes:** 1 migration (AttendeeType + Ticket column), organizer CRUD routes under `OwnedEventDep`, registration/desk assignment support, profile display.
**Regression risks:** Assignment validation must only accept active types of the same event — covered by the six integrity tests in `01_DOMAIN_MODEL.md` §5.
**Verification:** Those six tests + unchanged ticket/checkin suites.
**Status:** RECOMMENDED.

## D08 — Active Congress Context

**Problem:** S7 — user with tickets in 3 congresses opens My Congress.
**Current:** MyTickets aggregates all tickets with an index selector; no event context concept.
**Options:** (a) global aggregate views; (b) explicit active-event context chosen via congress picker; (c) per-tab event selectors.
**Recommended:** (b) — congress picker after login when memberships > 1; `activeEventId` in AuthContext; all five tabs render within that event; switching events is a top-level control, never buried.
**Rationale:** Matches CR-07 shallow navigation; keeps backend calls naturally event-scoped; avoids cross-event data aggregation leaks.
**Trade-offs:** One extra tap for multi-event users; single-event users auto-select (no friction).
**Required changes:** AuthContext field + picker UI contract; attendee endpoints already event-safe via ticket scoping.
**Regression risks:** None server-side.
**Verification:** S7 test — picker appears iff memberships > 1.
**Status:** RECOMMENDED.

## D09 — Multi-Role Portal Selection

**Problem:** S3/S4 — users with multiple portals.
**Current:** No portal concept; direct URLs.
**Options:** (a) always explicit chooser; (b) auto-enter when exactly one eligible portal, chooser otherwise.
**Recommended:** (b). No valid portal → explicit "no access" state (never a silent fallback to public pages with a dead session). Portal switch is allowed anytime but only swaps the credential context — never server rights.
**Rationale:** Minimal friction for the common single-role case; deterministic for multi-role.
**Trade-offs:** Chooser needs role labels (i18n keys exist for EN/FA).
**Required changes:** Resolution endpoint consumption + chooser UI contract.
**Regression risks:** None server-side; backend authorizers unchanged.
**Verification:** S3 scenario test.
**Status:** RECOMMENDED.

## D10 — Compatibility and Migration Strategy

**Problem:** Evolve without breaking printed QRs, offline clients, existing data.
**Current contracts to preserve:** `/e/:slug`, `/scan/:pointId`, `/booth/:boothId` URLs; EntityQR secrets; offline ticket cache; scanner manifests; client-generated scan_id idempotency; all 15 tables' data.
**Options:** (a) big-bang portal rewrite; (b) additive-first, dependency-ordered transitions (see `01_MIGRATION_IMPACT.md`).
**Recommended:** (b). Preserve the three printed URLs byte-identical (no redirects for scanner; redirect only if a human URL must move — none planned). QR regeneration is prohibited as a side effect.
**Rationale:** Physical print and cached offline clients cannot be recalled.
**Trade-offs:** Temporary coexistence of old pages and new portal shells.
**Required changes:** Sequenced in `01_MIGRATION_IMPACT.md` §Sequence.
**Regression risks:** Managed per-transition with test strategy + rollback per step.
**Verification:** Full `scripts/check` + Playwright scanner specs after each transition.
**Status:** RECOMMENDED.

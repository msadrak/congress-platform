# 01 — Migration Impact & Implementation Sequence

**Status:** RECOMMENDED plan. No code, migrations, or git operations performed.

## 1. Existing Components to Reuse (unchanged)

| Asset | Reuse |
|---|---|
| All 7 backend authorizers (`auth.py`, `events.py:63`, `routes/auth.py:56`, `desk.py:152`, `leads.py:50`, `checkin.py:225`) | Portal boundary enforcement as-is |
| Desk-operator feature set (uncommitted) | Reception portal backend, **after git integration** |
| Scanner stack (`scannerEngine/Storage/AuthPolicy/TokenStore`, GateScanner) | Untouched; `/scan/:pointId` preserved byte-identical |
| `ticketCache.ts`, `pwaRegistration.ts` | "My Ticket" tab offline behavior |
| `i18n.ts` (EN/FA, RTL) | All portal shells |
| UI kit (`components/ui/*`), `PublicLayout`, `AttendeeLayout` | Basis of portal layouts |
| EntityQR registry, Lead/Connection/Bookmark services | Partner portal + My Network unchanged |
| Generated `schema.d.ts` + openapi-fetch | Regenerate after API additions |

## 2. Required API Modifications (additive)

| Endpoint | Type | Purpose |
|---|---|---|
| `GET /api/me/access` | NEW (read-only) | Identity + memberships + roles + partner assignments (D02/D08/D09) |
| `POST/GET/PATCH /api/events/{id}/attendee-types[/{type_id}]` | NEW | CR-06 CRUD, `OwnedEventDep` |
| Ticket reserve + desk-registration accept optional `attendee_type_id` | MODIFY (additive, validated) | CR-06 assignment |
| `GET /api/public/events/{slug}/partners` | NEW | CR-09 partner listing (from Partner entity) |
| `GET /api/attendees/me/events/{id}/overview` | OPTIONAL new aggregate | "My Congress" tab payload (ticket + partners + bookmarks); composition of existing endpoints acceptable for MVP |
| `PATCH /api/auth/me` | OPTIONAL | "My Profile" editing (currently read-only `/me`) |

No existing endpoint contract is broken.

## 3. Required Data Model Changes

| Change | Migration | Risk |
|---|---|---|
| `attendee_types` table | 1 new (after 0011) | Low — additive |
| `tickets.attendee_type_id` nullable FK | same | Low — NULL default preserves all rows |
| `partners` table + `booths.partner_id` nullable FK + 1:1 backfill | 1 new | Medium — backfill verified by count-comparison test |

## 4. Compatibility Requirements

- Printed URLs `/e/:slug`, `/scan/:pointId`, `/booth/:boothId` remain functional byte-identical (R-5 from Phase 00). No redirects for scanner workflow (cached offline clients).
- No QR/EntityQR regeneration.
- All existing credentials keep working: organizer key, attendee JWT, desk JWT, scanner JWT.
- Offline: ticket cache TTL/tamper behavior unchanged; scanner manifest + batch sync idempotency unchanged.
- Desk-operator uncommitted changeset preserved exactly; **git integration (Task 05H) is a human-approved precondition** — not performed by this program.

## 5. Suggested Implementation Sequence (dependency-ordered)

| Step | Change | Kind | Regression risk | Test strategy | Rollback |
|---|---|---|---|---|---|
| T0 | Git integration of desk-operator changeset (human-approved) | Mandatory precondition | — | 131 backend tests stay green | Recovery archive from Task 05F/G |
| T1 | `GET /api/me/access` + tests (S1–S9) | Mandatory backend | None (additive) | Resolver unit tests per scenario | Drop endpoint |
| T2 | AttendeeType + Partner migrations + CRUD APIs | Mandatory backend | Low | Six integrity tests (domain doc §5) + backfill test | Migrations reversible (additive tables/columns) |
| T3 | Frontend `AuthContext` + explicit `credentialFor` + migrate call sites; delete `scope="any"` heuristic | Mandatory frontend | Medium | Negative scenario 11; per-portal smoke; grep gate on residual heuristic | Feature-flag: keep old helper one release |
| T4 | Portal shells (Organizer/Reception/Partner) wrapping existing pages | Mandatory frontend | Low | Existing e2e screenshots re-run | Route fallback to legacy pages |
| T5 | Attendee 5-tab shell reusing MyTickets/MyNetwork/PublicEvent + new My Congress/Profile | Mandatory frontend | Low | S7 picker test; offline pass regression | Keep `/my-tickets`, `/my-network` as aliases |
| T6 | Partner listing in My Congress (CR-09) | Mandatory | Low | Public partners endpoint test | — |
| T7 | Optional hardening: organizer key rotation, attendee token revocation, `PATCH /api/auth/me` | Optional future | Medium | dedicated suites | n/a |

## 6. Risks

- R-1 (HIGH): uncommitted changeset until T0 completes.
- R-5 (HIGH): printed URL breakage — mitigated by preservation rule.
- R-8 (MEDIUM): AuthContext cutover credential mis-mapping — mitigated by fail-closed contract + feature flag.
- R-9 (LOW): partner backfill data quality — count/name comparison test.

## 7. Blockers for Phase 02 / Phase 03

1. **T0 git integration requires explicit human authorization** (Phase 01 must not commit).
2. Product confirmations: Admin semantics (D01), Partner breadth (D06), profile editing scope (My Profile), multi-partner-per-event staffing model (S6 sufficiency).
3. Phase 02 (visual/UX) depends only on D08/D09 contracts — not blocked by T2.

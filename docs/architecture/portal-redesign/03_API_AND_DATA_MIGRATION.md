# Phase 03 — API and data migration contracts

Status: **planning only; no implementation or execution authorized**. Read with [fixed roadmap](03_IMPLEMENTATION_ROADMAP.md), [backlog](03_TASK_BACKLOG.md), [execution protocol](03_AGENT_EXECUTION_PROTOCOL.md), and [QA/release gates](03_TEST_AND_RELEASE_PLAN.md). Task IDs and hard dependencies come exclusively from the roadmap. Tnn means P03-Tnn throughout this document. Current source outranks Phase 00–02 claims. AR-06 is AttendeeType ownership, not Partner authorization.

## 1. Evidence and authority baseline

Read-only evidence: `backend/app/routes/{auth,events,tickets,ticket_tiers,desk,booths,leads,network,public,checkin,analytics,organizers}.py`, `backend/app/{models,security,auth,config}.py`, migration `0011_desk_operators_and_attribution.py`, `backend/tests/conftest.py`, `web/src/main.tsx`, and the IdentityEvidence, DomainEvidence and FrontendEvidence reports. No API call, migration, database fixture, test, package installation, build or Git mutation was performed. Historical 131/28/8 passes are not current evidence.

Existing: Organizer is a tenant whose API key is not a User identity; User is global; Ticket is unique `(event_id,user_id)`; DeskOperator is unique `(event_id,user_id)`; BoothStaff is unique `(booth_id,user_id)`. There is no Order, Partner, AttendeeType, access-discovery API or profile-write endpoint today. PublicEvent currently returns metadata and tiers, not an agenda, speakers or a Booth collection. The current model contains 15 tables. The source migration chain is linear through 0011; runtime migration state has not been inspected.

Authority notation used below:

- **A**: anonymous, no Authorization header, even when other credentials are stored.
- **U**: User bearer JWT. Keep legacy typeless User tokens. Explicitly reject a present non-`user` type in T01. Issued desk/scanner tokens already fail User authentication because their subjects are non-UUID; the type check is defense in depth, not proof of current escalation.
- **O**: explicit Organizer bearer API key. OwnedEventDep authenticates the tenant and masks foreign events/resources with 404.
- **D**: explicit event-bound desk JWT, or **deliberately selected** O operational mode. Never `organizerKey || deskToken`, auto-fallback, or retry with another stored authority.
- **S**: existing point/event/device scanner JWT, or explicit O administrative mode where the current scanner endpoint supports it. No scanner token or scan queue format changes.
- **P/B**: U plus exact PartnerStaff/BoothStaff row respectively. PartnerStaff allows profile/workspace read; BoothStaff alone permits a Booth's leads.

Protected missing/invalid/expired authentication is 401; protected Bearer authorizers should include `WWW-Authenticate: Bearer` after T01, unlike several current branches. Existing desk JWT revoked or generation-mismatched: **401**. Fresh desk login for revoked/nonmember User, or desk JWT against wrong event: **403**. Authenticated foreign Organizer: **404**. Known Partner/Booth without membership: **403**; missing resource: **404**. 422 is request validation. Keep existing FastAPI `{"detail": ...}` errors; do not invent a parallel error-envelope API. Preserve resource lookup ordering where current desk/scanner routes return 404 for a nonexistent resource before validating a supplied token. Platform provisioning uses its custom admin header, not a Bearer challenge convention.

Client response policy (T03–T09,T43): 401 invalidates only the exact human credential used; 403/404/409/422/5xx/network failure do not clear unrelated credentials. A draft remains local on desk interruption only for the same principal/event; switching identity or event discards the previous PII draft and aborts/ignores stale loads. Re-authentication never automatically repeats issuance. Portal logout clears its selected credential; explicit global sign-out clears browser User/desk/Organizer credentials and owner ticket cache. Scanner follows its separate durable credential/queue and confirmed unpair policy, never generic sign-out deletion. Decoded claims and `/me/access` are descriptive UX, never authorization evidence.

## 2. Complete current endpoint/consumer/cutover matrix

All paths are literal API paths; `{id}` is a UUID unless named slug. Methods grouped on one row retain their separate existing statuses. Existing test paths below are under `backend/tests/`; R IDs are defined in the QA plan. No row claims a test was executed.

| Current endpoint(s) | Current consumer | Proposed disposition / tasks | Authority and resource scope | Compatibility / behavior guard | Source tests and regression IDs |
|---|---|---|---|---|---|
| POST `/api/organizers` | provisioning scripts/live scanner setup | preserve; no platform portal or Organizer↔User merge, T00,T01 | X-Admin-Token, deployment authority | returns raw key once, hash stored; 201; missing/wrong token401 | test_organizers.py; R10,R16,R20 |
| POST `/api/auth/register`, POST `/api/auth/login` | PublicEvent; future explicit User entry | guaranteed anonymous transport T04,T22,T55 | A body credentials; global User | existing registration201, duplicate email409, login200/bad credentials401; no hidden Partner password provisioning | test_auth.py; R01,R20 |
| GET `/api/auth/me` | attendee/profile context | read-only default T06,T28; T57 blocked | U current User | global identity, not event category or Organizer; no default PATCH | test_auth.py; R01,R20 |
| POST/GET `/api/events`; GET/PATCH `/api/events/{event_id}` | OrganizerEvents, OrganizerEventDetail | preserve T05,T31 | O; own tenant/events | foreign organizer404; unique global slugs and dates unchanged | test_events.py, test_management_lifecycle.py; R10,R16,R20 |
| POST/GET `/api/events/{event_id}/ticket-tiers`; PATCH `/api/events/{event_id}/ticket-tiers/{tier_id}` | organizer tier manager | extract T32, transport T05 | O; tier in owned event | quotas/open flags remain inventory; category never replaces tier | test_ticket_tiers.py, test_management_lifecycle.py; R02,R10,R16 |
| POST `/api/events/{event_id}/tickets/reserve` | PublicEvent authenticated reservation | additive category T19,T55; U transport T06 | U; event and same-event tier/type | optional new field;201; duplicate409, closed400, sold-out410, missing/wrong-event tier404 | test_tickets.py; R01,R02,R03,R16,R20 |
| GET `/api/attendees/me/tickets` | MyTickets, owner cache | additive historical label T19,T24,T30 | U; current user's tickets across events | existing IDs/QRs; event filter and offline selection in UI, no `/me/access` prerequisite | test_tickets.py; ticketCache.test.ts; R03,R04 |
| POST `/api/events/{event_id}/desk/login` | OrganizerDesk; future Reception entry | A transport T04,T38, generation T02 | A body email/password, event DeskOperator | valid User alone insufficient;401 bad password,403 nonmember/revoked; no Organizer key required | test_desk_operator_auth.py; R11,R12,R20 |
| GET `/api/events/{event_id}/desk/me`, GET `/api/events/{event_id}/desk/tiers` | OrganizerDesk | explicit D/O mode T07,T37–T39 | D bound event, or owning O chosen explicitly | current me event/operator fields retained; 401 expired/revoked,403 wrong event | test_desk_operator_auth.py; R11,R12,R16,R20 |
| GET/POST `/api/events/{event_id}/desk/operators` | OrganizerEventDetail | preserve management T34 | O owned event, never D self-management | reusable global temporary password returned once only for new User; not one-use; existing User password unchanged | test_desk_operator_auth.py; R10,R11,R12,R16 |
| POST `/api/events/{event_id}/desk/operators/{operator_id}/revoke`; DELETE `/api/events/{event_id}/desk/operators/{operator_id}` | organizer operator manager | generation increment T02,T34 | O; operator in owned event | DELETE has no `/revoke` suffix; old token remains401 after reactivation | test_desk_operator_auth.py; R12,R16 |
| POST `/api/events/{event_id}/desk-registrations` | OrganizerDesk rapid registration | additive category T19,T40,T42,T43 | D/O chosen mode, current event |201; duplicate409 recovery explicit selection; quota400/410/404 preserved; attribution, no remint on recovery | test_desk_registration.py, test_desk_operator_auth.py; R02,R03,R11,R12 |
| GET `/api/events/{event_id}/attendees`; GET `/api/events/{event_id}/attendees/{ticket_id}` | desk search/pass/history | extract T39,T41; additive snapshot T19 | D/O; ticket in current event | q name/email/organization, limit1–100 default50; foreign detail404; existing QR reused | test_desk_registration.py; R03,R11,R16 |
| POST/GET `/api/events/{event_id}/booths` | organizer Booth manager | additive Partner link T14,T35 | O owned event | same slug uniqueness; QR minted only for new Booth; old body auto-creates1:1 Partner | test_booths.py; R07,R10,R16,R18 |
| POST/GET `/api/events/{event_id}/booths/{booth_id}/staff` | organizer staff manager | synchronize PartnerStaff T14 | O; exact Booth in event | retain legacy existing/absent User provisioning behavior; add profile membership, not other Booth grants | test_booths.py; R07,R08,R16 |
| GET `/api/booths/me` | legacy assignment discovery | retain U compatibility T06,T16; chooser uses `/me/access` | U; exact assigned Booths across events | no new `/partners/me`; no removal of old consumer contract | test_booths.py; R07,R20 |
| GET `/api/booths/{booth_id}` | ExhibitorPortal direct route | retain direct alias T52 | B exact BoothStaff | known nonstaff403, missing404; no Organizer fallback | test_booths.py; R07,R08,R16,R18 |
| POST `/api/booths/{booth_id}/leads/scan` | ExhibitorPortal manual secret; new camera input | unchanged API T48,T51 | B, ticket in same event | new201/duplicate200; same `(booth,ticket)` lead; cross-event400; camera feeds same request | test_leads.py; R08,R16 |
| GET `/api/booths/{booth_id}/leads`; PATCH `/api/booths/{booth_id}/leads/{lead_id}`; GET `/api/booths/{booth_id}/leads/export-csv` | feed/filter/qualification/export | extract T49,T50 | B; lead must belong to selected Booth | q/rating filters; invalid PATCH rating422; foreign lead404; BOM/sanitization retained; no invented pagination | test_lead_qualification.py, test_csv_security.py; R09,R16 |
| POST/DELETE `/api/attendees/me/bookmarks/booths/{booth_id}`; GET `/api/attendees/me/bookmarks/booths` | PublicBooth, MyTickets | protected action separate T06,T26,T27 | U own bookmarks; all-event collection filtered to active event | create201/idempotent200; delete200; sponsor without Booth has no bookmark substitute | test_booth_bookmarks.py; R07,R20 |
| POST `/api/attendees/me/network/scan`; GET `/api/attendees/me/network`; PATCH `/api/attendees/me/network/{connection_id}` | MyNetwork | T25 uses current all-event API, filters Connection.event_id | U participants/owner; visible current-event connection for mutation | no aggregate API; peer scan/notes ownership intact; switch event cannot reuse stale connection selection | test_networking.py; R05,R16,R20 |
| GET/PATCH `/api/attendees/me/network/privacy`; GET `/api/attendees/me/network/{connection_id}/vcard` | MyNetwork; future Profile | preserve T25,T28 | U; privacy global, vCard participant-owned | current consent governs API/vCard disclosure; no event category on User | test_networking.py; R05,R06,R16 |
| GET `/api/public/events/{slug}` | PublicEvent | A T04,T53; additive active types T18 | A; public event slug | existing metadata/tier fields retained, no fabricated program; event missing404 | test_public_event.py; R01,R10,R20 |
| GET `/api/public/events/{slug}/booths/{booth_id}` | physical standee/PublicBooth | A detail read T04,T53; protected bookmark lookup separate | A; Booth must match slug event | current optional bearer bookmark bit becomes unused by new clients; retain existing field/default for compatibility; no header on public request | test_booth_bookmarks.py; R07,R18,R20 |
| POST/GET `/api/events/{event_id}/checkin-points`; PATCH `/api/events/{event_id}/checkin-points/{point_id}` | organizer gate/policy manager | extract T33, no scanner state rewrite | O owned event and point | MULTI_ENTRY/SINGLE_USE/TIER_RESTRICTED/CAPACITY_CAPPED unchanged | test_checkin.py, test_management_lifecycle.py; R10,R15,R16 |
| POST `/api/checkin-points/{point_id}/token`; GET `/api/checkin-points/{point_id}/devices`; POST `/api/checkin-points/{point_id}/devices/{device_id}/revoke` | organizer API tooling/scanner pairing | preserve T08,T63 | O owning point event | existing device JWT expiry/jti/scope and tenant404; current organizer page does not already expose these controls | test_scanner_security.py, test_scanner_revocation_matrix.py; R13,R17,R20 |
| POST `/api/checkin-points/{point_id}/devices/self/revoke` | GateScanner unpair | preserve T08,T63 | S exact device | durable pending deactivation before remote acknowledgement; credential/queue not prematurely deleted | test_scanner_revocation_matrix.py; scanner-real-api.spec.ts; R13,R14,R17 |
| GET `/api/checkin-points/{point_id}/manifest`; POST `/api/checkin-points/{point_id}/scans/batch` | GateScanner; native service prototype | preserve T08,T63,T66 | S/O current authorized point and event | scan_id idempotency/conflict, policy locking, unknown secret outcomes, provisional queue unchanged | test_checkin.py, test_concurrency.py, test_scanner_security.py; scannerEngine.test.ts; R13,R14,R15,R16,R17 |
| GET `/api/events/{event_id}/analytics/attendance`; GET `/api/events/{event_id}/analytics/export-csv` | OrganizerAnalytics | preserve T36 | O owning event | attendance point_id/ticket_tier_id/from_time/to_time filters and 10-second polling retained; CSV has no filter parameters and remains safe current-event-wide export | test_analytics.py, test_csv_security.py; R09,R10,R16 |

## 3. New and additive contracts (proposed, not current)

All UUIDs serialize as strings; timestamps are timezone-aware ISO8601. No caller supplies organizer_id/user ownership to override authorizers. Requests must validate field limits and enum values. Every route's event-scoped resource is looked up using that event, not loaded globally and trusted from the URL. Future modules are responsibility descriptions (access discovery, Partner management, taxonomy), not invented existing file paths. Generated `web/src/api/schema.d.ts` must be regenerated from delivered OpenAPI at each API task before UI tasks consume it.

### 3.1 Staged access discovery — T10 then T16

`GET /api/me/access`, U only,200:

```json
{
  "user_id": "UUID",
  "events": [{
    "event_id": "UUID", "event_slug": "congress-slug", "event_name": "Congress",
    "roles": ["ATTENDEE", "RECEPTION", "PARTNER"],
    "ticket_ids": ["UUID"], "desk_operator_ids": ["UUID"],
    "booth_ids": ["UUID"], "partner_ids": ["UUID"]
  }]
}
```

Arrays are deduplicated and stably ordered by ID; events by event_slug then event_id; roles fixed ATTENDEE,RECEPTION,PARTNER order. Empty membership gives `events: []`. T10 derives active Tickets, nonrevoked DeskOperator rows, and BoothStaff joined to event; returns `partner_ids: []` until T16. PARTNER at this interim stage describes legacy Booth eligibility, not an invented Partner ID. T16 derives Partner eligibility from PartnerStaff including boothless sponsors and exact BoothStaff IDs; `booth_ids` never means all Booths of a Partner. Inactive Tickets and revoked operators do not create eligibility; a User with another active role retains that event. No ORGANIZER role or key is returned. 401 for missing/invalid User token or other credential family, even a signed nonuser type with UUID subject. Target endpoints reauthorize current rows; a stale discovery response never grants permission. No `/api/partners/me` duplicate is introduced. Offline My Ticket selects event from cached owner tickets without this API.

### 3.2 Partner organization — T11–T16

Partner is event-owned, zero/many Booths; name is not an ownership key. Proposed record/output:

| Field | Contract |
|---|---|
| id,event_id | server UUID, immutable event ownership |
| name | trimmed string1–200, required |
| partner_type | EXHIBITOR / SPONSOR / INSTITUTIONAL / SCIENTIFIC, required; legacy backfill EXHIBITOR |
| description | text, default empty; organizer-managed; new create/PATCH values max2000 characters; preserve longer legacy backfill/read values |
| website_url,logo_url,brochure_url | strings max500, default empty, same optional-link behavior as existing Booth fields; no executable link rendering |
| created_at | server aware timestamp |

Create accepts name,partner_type and optional profile fields. PATCH accepts only supplied name,type/profile fields, not id,event_id,staff or arbitrary capability fields. No destructive Partner DELETE or archive model is authorized. “CRUD” here means supported create/read/update, plus explicit staff deletion; do not invent hard deletion to satisfy a shorthand. Profile is read-only for representatives by default.

| New endpoint | Body / full result | Auth / success / failures | Owner tasks and consumer |
|---|---|---|---|
| POST `/api/events/{event_id}/partners` | Partner create fields → Partner record | O201; invalid422; own event404 mask | T12,T35; organizer manager |
| GET `/api/events/{event_id}/partners` | array of Partner records plus `booths: BoothSummary[]` | O200, empty[]; foreign event404 | T12,T35 |
| PATCH `/api/events/{event_id}/partners/{partner_id}` | supplied mutable fields → updated Partner record | O200; partner outside event/missing404; invalid422 | T12,T35 |
| POST `/api/events/{event_id}/partners/{partner_id}/staff` | `{email: EmailStr, booth_ids: UUID[] = []}` → `PartnerStaffOut` | O201 new membership/200 existing; absent User409 instruct registration; outside-event/Partner Booth404; invalid422 | T13,T35 |
| GET `/api/events/{event_id}/partners/{partner_id}/staff` | `PartnerStaffOut[]` | O200; event/Partner404 | T13,T35 |
| DELETE `/api/events/{event_id}/partners/{partner_id}/staff/{user_id}` | no body;204 | O; idempotent absent assignment204 after valid resource lookup; unknown/foreign Partner404 | T13,T35 |
| DELETE `/api/events/{event_id}/booths/{booth_id}/staff/{user_id}` | no body;204 | O; idempotent absent grant204; wrong-event Booth404 | T14,T35 |
| PATCH `/api/events/{event_id}/booths/{booth_id}` | `{partner_id: UUID}` → existing BoothOut plus `partner_id` | O200; source/destination outside event404; invalid/null422 | T14,T35; explicit organizer linking |
| GET `/api/partners/{partner_id}` | Partner record, `booths: BoothSummary[]`, `capabilities: {lead_booth_ids: UUID[]}` | P200; U without membership403; missing404; bad credential401 | T15,T45–T47 |
| GET `/api/public/events/{slug}/partners` | `PublicPartnerOut[]` with Partner profile + `booths: BoothSummary[]` | A200; unknown event404; empty[] | T15,T27,T54 |

`PartnerStaffOut = {id,partner_id,user_id,email,full_name,created_at,booth_ids: UUID[]}`. `booth_ids` is that user's exact BoothStaff grants under this Partner. `BoothSummary = {id,event_id,partner_id,name,slug,location,description,website_url,brochure_url}`: no QR secret, staff list or leads. PublicPartnerOut has the Partner record and summaries, never membership/capability data or private user details. Sponsor-only output has `booths: []`; authorized representative has `lead_booth_ids: []`; do not create fake Booths, fake QR codes or lead routes. Organizer may create sponsor profiles without Users/staff.

Staff transaction rules:

1. Normalize email by strip/lowercase and bind existing User only for **new Partner assignments**. Absent User409, no User/password/hash created; tell organizer the User must first register through existing public registration. Existing identity/password/profile never changes. Existing legacy Booth/desk provisioning remains as-is until separately approved lifecycle work.
2. Validate every selected Booth belongs to this Partner and event **before** any membership/grant write; a mixed valid/invalid array fails atomically. Deduplicate IDs. POST adds selected exact Booth grants and never removes omitted grants; repeat is idempotent. Empty list grants profile only, never all Booths.
3. Partner membership DELETE atomically removes PartnerStaff plus all this User's BoothStaff whose Booth is currently linked to that Partner; other Partner/Booth grants remain. User JWT remains valid but removed resources return403 next request. Single-Booth DELETE removes only that BoothStaff; PartnerStaff remains.
4. Legacy Booth staff POST also creates/ensures PartnerStaff for the linked Partner. Existing Booth create body gains optional `partner_id`; explicit same-event UUID links to that Partner; omitted/null creates a new1:1 EXHIBITOR Partner atomically. Wrong-event Partner404, slug conflict409, invalid422; never mint a replacement QR when linking.
5. Explicit Booth relink preserves Booth UUID, QR, leads, bookmarks and exact BoothStaff. Ensure every existing BoothStaff receives PartnerStaff on destination; retain source PartnerStaff (it may be legitimate profile-only authority). Do not grant any other destination Booth. Organizer confirms this ownership/membership effect; source/profile memberships can be separately revoked. This is intentional reconciliation, not company-name inference.

Contract tests T12–T16: sponsor0 Booth; second Booth on same Partner; same-event P(A,B)/Q(C) and User with only A; P read200,A leads200,B/Q leads403; absent User409/no provisioning; repeated assignment200/no duplicates; partial invalid assignment no writes; deletion current JWT immediately403 on removed resources; other assignments retained; relink exact grants retained/profile synchronized; foreign tenant404; public output anonymous/no PII. Preserve existing Booth and lead suites.

### 3.3 AttendeeType and immutable Ticket label — AR-06, T17–T20

Proposed type fields: `{id,event_id,name,description,display_order,is_active,created_at}`. Name trimmed1–100, unique `(event_id,name)`; description text default empty; display_order integer>=0 default0; is_active boolean defaulttrue; immutable id/event_id/created_at. No case-folded uniqueness rule is invented beyond this trimmed-name constraint. Order list by display_order,name,id.

- POST `/api/events/{event_id}/attendee-types`: O,201 type record. Duplicate name409, invalid422, foreign event404.
- GET same collection: O,200 all active/inactive records.
- PATCH `/api/events/{event_id}/attendee-types/{type_id}`: O,200 updated record; supplied name,description,display_order,is_active only. Duplicate409; invalid422; missing/wrong-event404. Deactivate instead of deleting history; no DELETE. Rename/deactivation and selected-type issuance must serialize on the same AttendeeType row using SELECT FOR UPDATE or an equivalent transactional lock; validate active state before inventory mutation and capture the locked name atomically.
- Existing PublicEvent `GET /api/public/events/{slug}` gains `active_attendee_types: AttendeeTypeOut[] = []`, A active same-event only, sorted above. This single additive public path populates self-registration; no separate public type collection endpoint.
- GET `/api/events/{event_id}/desk/attendee-types`: D/explicit O,200 active same-event types only; exact desk401/403/organizer404 rules retained.
- Existing self-reserve and desk-registration bodies gain `attendee_type_id: UUID | null = null`. Omission/null accepted. Missing/wrong-event type404; inactive same-event type409 with `detail: "Attendee type is inactive"`; malformed UUID422. Validate/lock current active type before tier inventory mutation so rename/deactivation races cannot produce an unvalidated label or consume quota on rejected category.
- Ticket gains nullable FK `attendee_type_id` and nullable `attendee_type_name_at_issue` (varchar100). Issuance with type captures its current name in the same transaction; no category means both NULL. No type reassignment API. All old Tickets stay NULL; no inference from tier, title, organization or User.
- Add the two identically named fields to TicketOut, AttendeeTicketDetail, DeskRegistrationOut, AttendeeSearchItem, AttendeeDetailCard; render snapshot, not current type.name. Existing cache entries missing fields still parse/display as uncategorized. Do not alter scanner manifests, EntityQRs or `/api/auth/me` category fields.
- T24 and T28 require T19's additive ticket outputs/generated schema. My Profile combines read-only global `/api/auth/me` identity with the selected event Ticket's `attendee_type_name_at_issue`; it does not read or write a User category. My Ticket shows the same historical label; missing/null legacy category is explicitly uncategorized.

Tests: same User can have different types per event; null/self/desk issuance works; cross-event FK rejected by DB; inactive/missing type rejection leaves reserved_count unchanged and no Ticket/QR; type rename/deactivation leaves previously issued snapshot unchanged; duplicate event name409 but same name in another event201; old Ticket NULL unchanged; no reassignment; all tier quota/admission/concurrency outcomes identical with/without category. T20 UI shows distinct category and inventory controls; T40/T55 cannot consume category until T19.

### 3.4 Approval-blocked contracts

T56 event logo/cover/accent, T57 global organization/title editing, T58 representative profile editing and T59 program/speakers are not current APIs and are not unconditional cutover work. Read-only profiles and real event metadata are the default; hide unavailable editing/program controls. If approved, task contract must enumerate allowed fields, lengths, authority, validation, public exposure and tests before schema/UI changes. T57 never exposes email/password/name/ownership/category updates under an organization/title shortcut. T58 never allows name/type/event/staff/Booth/lead capability mutation; exact PartnerStaff still required. No speculative API types are generated now. T59 is an approval/schema gate only and requires a separately reviewed finite task addendum, not an invented content model. T66 decides native release scope, not native remediation implementation.

## 4. Three serialized expand migrations after 0011

Implementation inspects the actual Alembic head and chooses next available identifiers then; **no future numeric revision is asserted**. Chain: current head containing0011 → **desk session-version expansion (T02)** → **Partner expansion/backfill (T11)** → **AttendeeType/Ticket expansion (T17)**. One integration owner; no concurrent heads or edits/renumbering to0011. T11 depends on T02; T17 depends on T11 even if Type API work can later proceed independently.

### 4.1 Desk generation expansion

Add `desk_operators.session_version` integer NOT NULL server default0, nonnegative constraint. Existing rows0. New desk JWT adds integer `session_version`; compare with current DB row on every request. Legacy missing version accepted **only when DB version=0**, while ordinary expiry/revoked checks remain. Invalid type/value or unequal version401. Increment transactionally on revoke and on reactivation; do not reset0 or use revoke boolean as sole invalidation. Versionless token and tokenA at0 must remain401 after revoke/reactivate; tokenB issued at new generation works. Keep token subject/event/operator claims, User typeless compatibility and scanner format.

Security-sensitive application rollback must retain generation validation: rolling back to pre-hardening desk code would resurrect old tokens despite retained schema. If such rollback is unavoidable, contain by disabling desk operations/assignment/reactivation until forward restoration; do not pretend database expansion alone preserves revocation security.

### 4.2 Partner expansion and deterministic backfill

Create event-owned partners with above fields, FK events.id, unique `(id,event_id)` for composite ownership; no name uniqueness/company grouping. Create partner_staff with UUID PK, FK partner/user, unique `(partner_id,user_id)`, created_at. Add nullable indexed `booths.partner_id`; composite FK `(partner_id,event_id) → partners(id,event_id)`. Do not make partner_id unique; several Booths may share a Partner. FK must reject cross-event linkage. Preserve nullable expansion because old application writers may still create unlinked Booths.

For every preexisting Booth create exactly one Partner with **Partner.id=Booth.id**, same event/name/description/website/brochure/created_at, EXHIBITOR and empty logo. Link Booth.partner_id=Booth.id. Distinct `(linked partner,user)` BoothStaff rows become PartnerStaff; initial1:1 can reuse BoothStaff.id deterministically. Do not infer merges from equal names, URLs, domains or slugs; do not mint Partner QR. Snapshot and compare Booth/User/Ticket/Lead/Bookmark/EntityQR IDs, secrets and counts before/after.

Writer reconciliation is required, not a postscript: deploy nullable schema → new Booth/staff writers auto-link/synchronize → drain old writers and fence affected writes for reconciliation → process each remaining NULL Booth with the **same deterministic1:1 rule**, respecting already-created deterministic records rather than duplicating → synchronize any missing PartnerStaff from BoothStaff → verify zero unresolved NULLs and no cross-event pairs → enable full consumers. The reconciliation must be transactional/restart-safe and account for concurrent staff changes; rerun after old-writer drainage before declaring complete. Keep nullable column in this expansion; a NOT NULL contract migration would be separately reviewed, not a fourth silently scheduled task. While NULL rows exist, legacy direct Booth behavior continues, but do not display fabricated Partner capabilities.

### 4.3 AttendeeType expansion

Create attendee_types with above fields and FK events.id; unique `(event_id,name)` and `(id,event_id)`. Add nullable indexed tickets.attendee_type_id and nullable tickets.attendee_type_name_at_issue, no historical default label. Composite FK `(attendee_type_id,event_id) → attendee_types(id,event_id)`; referenced type deletion restricted. Pair constraint requires both NULL or both populated. No User category, Order table, TicketTier repurpose, historical assignment or scanner change. Old writers continue issuing both NULL; new writers set FK+snapshot atomically. Do not make category required during expansion or after this cutover.

### 4.4 Approval-only branding expansion — not an unconditional fourth migration

Only if T56's exact field/asset/contrast contract receives client approval, serialize a next-available revision after the actual head containing T17. Add `events.logo_url` and `events.cover_url` nullable varchar(500), and `events.accent_color` nullable varchar(7), each default NULL. No FK, uniqueness or new indexes; no guessed backfill or required historical branding. Empty submitted values normalize to NULL; URLs are HTTPS-only and accent is six-digit `#RRGGBB`, with invalid writes422. Old Event bodies and records remain valid. Rehearse populated upgrade/defaults and application fallback; rollback disables rendering/editor while retaining written fields. No destructive downgrade after new writes. T57 uses existing User fields and T58 uses existing Partner fields, so neither authorizes another migration. T58 description request max2000, output unrestricted for preserved legacy text; exact four-field/HTTPS contract must be approved, not chosen by the implementation agent.

### Constraint/index inventory for the future migration owner

| Expansion | Dependencies and indexes | Null/default and referential behavior | Required populated fixture |
|---|---|---|---|
| Desk session version T02 | Existing desk_operators PK lookup; no new version index or uniqueness | NOT NULL/default0/nonnegative; no changed FK | active legacy token0, revoked/reactivated row, old token permanently rejected |
| Partner T11 | events/users/booths/booth_staff; partners event_id index; partner_staff user_id index; unique(partner_id,user_id) supports Partner membership; booths partner_id index; unique Partner(id,event_id) supports composite FK | New Partner/Staff required fields; Booth link nullable during expansion. New Partner/event, PartnerStaff/Partner/User and composite Booth/Partner FKs use RESTRICT, not an implicit cascading business deletion. Explicit staff revocation is transactional application work | independent same-name Booths, repeated user staff, zero/many Booths, cross-event SQL rejected, old writers reconciled without QR/data drift |
| Type T17 | events/tickets; unique(event_id,name) supports event collection lookup; unique(id,event_id) supports composite FK; tickets attendee_type_id index | Ticket FK and immutable label both NULL or both populated; new type/event and Ticket/type FKs RESTRICT; no category defaults or admission indexes | null historical tickets; different same-user/event categories; rename/deactivate; rejection before quota mutation |
| Branding T56, approval-only | existing events; no new FK/unique/index | three nullable columns/defaultNULL; empty input normalizedNULL; no inferred assets | populated unbranded events, legacy create/PATCH, approved values retained on application fallback |

Use existing UUID/timestamp generation conventions; do not add an extension or infer alternate keys. All FK and index names follow repository Alembic conventions. Snapshot before/after data for each expansion and keep new tables/columns on application rollback; lossy downgrade requires separate approval and isolated testing.



## 5. Deployment, rollback and evidence (future T64,T65 only)

1. Review approved source baseline including0011, record actual head, backup/restore capability and separate disposable DB. Estimate locks on realistic populated copies; additive DDL can still block traffic. Coordinate maintenance/write fencing where needed.
2. Rehearse each revision from populated0011, not merely fresh `upgrade head`. Seed multiple tenants/events, equal-named unrelated Booths, sponsor0 Booth, repeated staff, leads/bookmarks/QRs, tickets and revoked desk operators. Preserve the before-data manifest without secrets in ordinary logs.
3. Apply serialized expansion first; deploy compatible application/dual writers; fence/drain/reconcile legacy writers; verify ownership constraints and counts; regenerate delivered schema; enable consumers only after their task gates pass.
4. Application rollback retains additive tables/columns and restores compatible routes/client code without dropping new data. Existing printed/scanner URLs, credential keys, owner cache and pending scan records remain. New sponsor/group/type data must remain exportable/readable for forward recovery. Never roll back security-critical authorizers to a version that bypasses generation/current membership checks; use operational containment rather than accepting escalation.
5. Schema downgrade is **lossy after writes**: Partner grouping/sponsor profiles/memberships disappear; category FK and immutable labels disappear; session generations disappear. Reverting0011 additionally destroys operator/attribution data. A syntactically available downgrade is not a safe business rollback. Only rehearse on an isolated pre-new-write fixture or after explicit approved data export/loss acceptance; never recommend production downgrade as default.
6. T64 proves deterministic1:1 backfill, DB-level cross-event rejection, multi-Booth linkage, NULL compatibility/reconciliation, unchanged QR/lead/bookmark/tier values, legacy versionless0 behavior, application rollback preservation and security containment. Failed invariant is No-Go; retain expansion and roll forward, not heuristic repair or QR regeneration.

No migration/SQL/API/check commands were executed for Phase03. Future implementation must run task-specific populated fixtures plus exact canonical checks recorded in the [QA plan](03_TEST_AND_RELEASE_PLAN.md#7-future-commands-and-environment). The current pytest fixture drops/recreates `congress_test` and truncates tables, so even a seemingly harmless full-stack verification is prohibited during this planning-only phase.

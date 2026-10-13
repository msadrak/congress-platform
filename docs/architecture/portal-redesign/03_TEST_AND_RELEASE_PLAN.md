# Phase 03 — Test, UI compatibility and release plan

Status: **planning only; NOT tested, rendered, implementation-ready approval or deployment authorization**. Source was read; no tests/builds/linters/formatters/database commands/browser journeys/installations/Git mutations were executed. Historic 131 backend /28 web /8 Dart pass reports remain historical. Use [roadmap](03_IMPLEMENTATION_ROADMAP.md), [task backlog](03_TASK_BACKLOG.md), [API/data contracts](03_API_AND_DATA_MIGRATION.md), and [execution protocol](03_AGENT_EXECUTION_PROTOCOL.md). P03-Tnn is shortened Tnn below; hard prerequisites are the roadmap's, not alternative QA tasks.

## 1. Evidence method and execution boundaries

Current source evidence: `web/src/main.tsx` supplies all11 existing route entries; `backend/app/routes` supplies resource authorizers and endpoint contracts; `backend/migrations/versions/0011_desk_operators_and_attribution.py` is the current source head; `backend/tests/conftest.py:32–66` **drops/recreates congress_test, truncates tables and runs Alembic upgrade**. Therefore even canonical full-stack checks mutate a database and are forbidden in Phase03. No historical count or source assertion below is a present pass result.

Future implementations run task-specific positive/negative behavior checks and the canonical gate after changes integrate, under the approved baseline. Use disposable synthetic accounts and unique event slugs per event/test; never production data. Every evidence record contains task ID, approved SHA, environment/DB identity, working directory, exact command, exit status, supplied collected/passed/failed/skipped counts, raw log path, fixture setup, browser/device/locale/viewport and expected vs observed outcome. Skipped real tests, mocked responses and source-only reading are not PASS for live behavior. Separate failure evidence from inference; do not weaken401/403/404 assertions or lose queues to make tests pass.

## 2. Fixed R01–R20 existing-behavior regressions

These are the user's fixed identifiers, not scout labels or the unrelated existing Playwright test named R01. Source tests are anchors to preserve/extend; new tests listed later are planned and do not exist yet. Test paths are exact current source files. Tasks in each row own feature migration and its gates; final T65 reviews evidence from **all unconditional tasks**, not only the longest dependency chain.

| ID / invariant | Exact existing source tests / browser assets | Mandatory expected behavior | Owner task IDs |
|---|---|---|---|
| R01 Existing Attendee registration | `backend/tests/test_auth.py` (`test_attendee_can_register_and_receives_access_token`, duplicate email/login tests); `test_tickets.py`; `test_public_event.py`; `web/src/pages/PublicEvent.tsx` | public auth carries no header; register201, duplicate email409, wrong password401; existing global User and reserve201 preserved | T01,T04,T06,T19,T22,T53,T55,T60,T61,T65 |
| R02 TicketTier quota enforcement | `backend/tests/test_tickets.py` (`test_reserving_beyond_quota_is_rejected_as_sold_out`, closed/duplicate tests); `test_ticket_tiers.py`; `test_desk_registration.py` atomic quota; `test_management_lifecycle.py` | no oversell; closed400,sold-out410,duplicate409; rejected category no inventory mutation; tier remains inventory not taxonomy | T17–T20,T32,T40,T42,T55,T60,T64,T65 |
| R03 digital QR ticket | `backend/tests/test_tickets.py` reserve/retrieve; `test_desk_registration.py` issuance/detail; `test_desk_operator_auth.py` attribution; `web/src/pages/MyTickets.tsx` | same Ticket/EntityQR on retrieval/reprint; no remint during route/schema migration; category snapshot nullable | T19,T24,T26,T28,T39–T42,T55,T61,T64,T65 |
| R04 offline ticket access | `web/tests/ticketCache.test.ts`; `web/src/lib/ticketCache.ts`; `web/src/pages/MyTickets.tsx` | owner/shape/TTL checked plaintext cache; offline direct alias resolves event without access discovery; logout clears owner cache, other owner never exposed | T06,T21,T24,T30,T60,T61,T62,T65 |
| R05 attendee networking | `backend/tests/test_networking.py` scan/duplicate/notes/privacy/isolation; `web/src/pages/MyNetwork.tsx` | active-event display/mutation; notes remain private, stale event selection never mutated; self-scan rejected, consent respected | T06,T25,T28,T30,T60,T61,T65 |
| R06 vCard export | `backend/tests/test_networking.py` (`test_vcard_download_returns_rfc_compliant_vcf_file`, consent disclosure); MyNetwork download | real .vcf, participant authorization, contact absent when consent off; only selected-event visible connection chosen | T25,T28,T60,T61,T65 |
| R07 Booth profile/brochures | `backend/tests/test_booths.py`; `test_booth_bookmarks.py`; `web/src/pages/PublicBooth.tsx` | public same-event profile/brochure retained; exact BoothStaff private access; bookmarks protected separate; sponsor0 Booth valid | T04,T06,T11–T15,T26,T27,T35,T46,T47,T52–T54,T60,T64,T65 |
| R08 partner lead capture | `backend/tests/test_leads.py` (`test_booth_staff_scans_attendee_badge_and_captures_lead`, duplicate/isolation/event mismatch); ExhibitorPortal | exact BoothStaff only; new201/duplicate200 same lead; cross-event ticket400; manual input remains when camera unavailable | T13,T14,T45,T46,T48,T51,T52,T60,T61,T65 |
| R09 qualification/export | `backend/tests/test_lead_qualification.py`; `test_csv_security.py`; `test_analytics.py` CSV | HOT/WARM/COLD,notes,tags,search persist; invalid rating422; correct Booth download; BOM/formula protection stays server-side | T36,T49,T50,T52,T60,T61,T65 |
| R10 Organizer event management | `backend/tests/test_events.py`; `test_ticket_tiers.py`; `test_checkin.py`; `test_booths.py`; `test_management_lifecycle.py`; `test_analytics.py` | own tenant event/tier/gate/Booth/operator management and filters/polling/export retained; no new User Organizer role | T05,T20,T31–T36,T60,T61,T65 |
| R11 DeskOperator issuance | `backend/tests/test_desk_operator_auth.py` create/login/attribution; `test_desk_registration.py` search/detail/no-email | Organizer grants event row; desk email/password entry independent; wrong membership403;201 ticket/operator attribution; reusable global password accurately labeled | T02,T07,T19,T34,T37–T42,T44,T60,T61,T65 |
| R12 DeskOperator revocation | `backend/tests/test_desk_operator_auth.py` (`test_cross_event_operator_isolation_and_revocation_enforcement`) | exact old-token401; fresh revoked login403; old token still401 after reactivation; no broad clearing/draft resubmit | T02,T07,T34,T43,T44,T60,T64,T65 |
| R13 scannerPWA | `web/tests/scannerEngine.test.ts`; `scannerAuthPolicy.test.ts`; `scannerReliability.test.ts`; `web/e2e/scanner-offline.spec.ts`; `web/src/lib/pwaRegistration.ts`; `web/vite.config.ts` | preserved camera/HID/point UI and production app-shell recovery; SW never caches private API/credentials; update prompt no mid-shift swap | T08,T21,T63,T65,T66 |
| R14 scan synchronization | `backend/tests/test_checkin.py`; `test_concurrency.py`; `test_scanner_revocation_matrix.py`; `web/tests/scannerReliability.test.ts`; `web/e2e/scanner-offline.spec.ts`; `mobile/test` service tests | durable client scan_id, provisional→confirmed/conflict; pending retained across errors/restart/unpair; no false acknowledgement or cross-point replay | T08,T63,T65,T66 |
| R15 admission policies | `backend/tests/test_checkin.py`; `test_concurrency.py` single-use/capacity races; `web/tests/scannerEngine.test.ts`; `mobile/test` policy tests | MULTI_ENTRY/SINGLE_USE/TIER_RESTRICTED/CAPACITY_CAPPED unchanged; type labels never change admission; authoritative lock prevents races | T17,T19,T33,T60,T63,T64,T65,T66 |
| R16 tenant isolation | `backend/tests/test_events.py`; `test_booths.py`; `test_leads.py`; `test_desk_registration.py`; `test_networking.py`; `test_analytics.py`; `test_scanner_security.py` | foreign Organizer404; User exact resource403; desk wrong-event403; no cross-event FK/link/connection exposure | T01,T10–T19,T25,T31,T35,T39,T45,T46,T60,T64,T65 |
| R17 device revocation | `backend/tests/test_scanner_security.py`; `test_scanner_revocation_matrix.py`; `web/e2e/scanner-real-api.spec.ts`; `web/tests/scannerAuthPolicy.test.ts` | revoked JWT401; confirmed self-unpair before deletion, pending-state survives offline restart;24h/expiry window enforced; remote offline revoke limitation stated | T08,T60,T63,T65,T66 |
| R18 printedQR URLs | `web/src/main.tsx`; `backend/tests/test_booth_bookmarks.py`; `web/e2e/scanner-offline.spec.ts`; live route journeys planned | `/e/:slug/booths/:boothId`, `/booth/:boothId`, `/scan/:pointId` work by direct entry/reload without redirect or QR regeneration | T11,T14,T24,T30,T44,T52,T53,T61,T63,T64,T65 |
| R19 localizationRTL | `web/src/lib/i18n.ts`; `web/src/layouts/AttendeeLayout.tsx`; locale logic in current pages; new browser coverage required | EN/LTR and FA/RTL all7 widths; readable mixed email/UUID/URL; tab order/focus/errors/touch targets work | T20–T59 UI tasks when authorized,T61,T62,T65 |
| R20 API credential isolation | `backend/tests/test_auth.py`; `test_scanner_security.py`; `test_scanner_revocation_matrix.py`; `test_desk_operator_auth.py`; `web/src/api/client.ts` heuristic targeted for removal | A sends no Authorization; explicit U/O/D/S never substitute; only exact used human session cleared401; no user inference of Organizer | T01–T10,T16,T21,T22,T38,T43,T45,T53,T55,T60,T61,T65 |

A future gate must add coverage for currently missing invariants, rather than pretend these source suites already cover generation reactivation, explicit transport, sponsor/multi-Booth or populated migrations. `backend/tests/unit_scanner_security.py` is not a default `test_*.py` collected filename; do not claim it ran through ordinary pytest without collection evidence.

## 3. New acceptance scenarios and exact outcomes

No generic “component exists” tests. Deliver task-specific behavior tests at the task's implementation, plus security T60, browser T61, viewport T62, device T63, migration T64, release T65 gates. All APIs and fields must match [API contracts](03_API_AND_DATA_MIGRATION.md#3-new-and-additive-contracts-proposed-not-current).

| Scenario | Tasks | Setup → action → exact expected result |
|---|---|---|
| Human family boundary | T01,T60 | legacy typeless User JWT → User endpoint200; issued desk/scanner JWT →401; valid signed nonuser type with actual User UUID subject →401. Organizer key never resolves User identity |
| Anonymous public traffic | T03,T04,T09,T53,T60 | store all credential families → event/Booth/Partner public reads and login/register → zero Authorization headers; bookmarks separate U request only |
| Deterministic mode/response | T03–T09,T43,T60 | organizer+User+desk credentials coexist → each chosen authority only;401 clears exact credential,403/404/409/422/5xx/offline retain it and others; no retry/fallback |
| Desk generation | T02,T34,T43,T60,T64 | versionless/version0 token works at row0; revoke401; reactivate old token still401; new token works; repeated revoke cannot revive anything; versionless fails at nonzero |
| Credential/switch isolation | T21,T22,T30,T38,T43,T46,T60,T61 | switch principal/event with in-flight loads/draft → cancel or ignore old response, clear selected stale resource and old-principal/event PII draft. User-to-Organizer/desk switch requests destination credential if absent; never issue desk JWT from generic login |
| Access discovery stages | T10,T16,T22,T60 | no-role User→200 events[]; active/revoked/inactive rows across events→exact deduplicated roles and IDs; T10 partner_ids[]; T16 sponsor included; no ORGANIZER; removed rows not authoritative through cached resolver |
| Partner sponsor/multi-Booth | T11–T16,T35,T45–T47,T60,T64 | sponsor with0 Booths→public/profile200,capability[] and no fake lead UI/QR; P(A,B),Q(C),User profile+onlyA→P200,A200,B/C/Q403; two exact grants→A+B200,neverC |
| Existing-user assignments | T13,T35,T60 | normalized existing email→201/duplicate200,no password/profile change; absent→409 with register instruction,no User creation; invalid Booth array→404 and no partial writes; omitted Booth IDs profile-only |
| Membership removal | T13,T14,T35,T60 | delete P staff→204,Partner and P Booth endpoints immediately403 for same JWT; Q unchanged. Delete one Booth staff→204,other Booth/profile authority unchanged |
| Legacy Booth and relink | T14,T35,T52,T64 | old Booth create body→same Booth/QR plus1:1 Partner; explicit same-event partner_id→second Booth; wrong-event404. Relink preserves exact staff/leads/QR/bookmarks and adds destination profile membership; source PartnerStaff retained pending explicit revoke; confirmation explains impact |
| Type CRUD/discovery | T17,T18,T20,T60 | same-event duplicate trimmed name409; same name other event201; organizer sees inactive,public active_attendee_types/desk active-only; display_order<0→422; foreign resource404; deactivation and issuance serialize on type row |
| Category issuance/history | T19,T24,T28,T40,T55,T60,T64 | omitted/null→201,both category fieldsNULL; active same-event→201/FK+name snapshot; missing/wrong-event404,inactive409,invalidUUID422/no quota/ticket/QR writes; rename/deactivate leaves old snapshot unchanged; no reassignment; profile uses selected Ticket not User category |
| Five attendee destinations | T23–T30,T61,T62 | My Congress /My Network /My Ticket /My Profile /Congress Details exactly5 primary tabs; directory in My Congress,not sixth tab; event picker changes URL/data atomically; empty/failed data actionable,not invented totals |
| Offline active event | T24,T30,T60,T61 | cache a live own ticket, disconnect and reload canonical/legacy alias while access API is unavailable: cached owner QR and event choice work; expired TTL or invalid owner/shape exposes no QR; unknown online context does not wipe another owner's cache |
| Event network/vCard | T25,T28,T30,T60,T61 | User connections in A/B → A route displays onlyA; scan result from B not silently added toA; stale B selected connection cannot be mutated/exported fromA; consent-off removes contact from API/.vcf |
| Organizer extractions | T20,T31–T36,T61 | edit event, tier quota/open, point policy, operator revoke, Partner grants and type: real API persists correct event; analytics point/tier/time filters and 10-second refresh survive; CSV remains current-event-wide, not falsely filtered; no scanner-device controls called extracted |
| Reception independent entry | T37–T39,T44,T61 | no organizer key,canonical/legacy station direct entry→event desk login; owning token unlocks only that event,wrong-event403; no OrganizerLayout dashboard/key gate; search/detail retrieves same ticket/scan history |
| Walk-in/duplicate/print | T40–T42,T61 | select separate tier/category→201,QR/attribution; same email→409,no new Ticket/QR,explicit choose existing result→detail/print same QR; decline selection leaves draft/no print; browser print only,no hardware claim |
| Reception expiry/revoke recovery | T43,T60,T61 | draft + next401→block write,exact event token invalidated,draft retained only same principal/event; reauthenticate→draft present,operator must explicitly submit;403/5xx do not clear/relabel valid token; no automatic duplicate resubmit |
| Partner lead workspace | T48–T52,T61 | manually enter badge→201,repeat200 same lead; HOT/tags/notes persist; q/rating filters and selected Booth CSV correct; camera permission denial/failure offers same manual contract; no Partner membership implies all lead access |
| Public integration | T53–T55,T61 | anonymous visitor views actual event/Partner/Booth metadata,registers/logs in/reserves optionalcategory then opens canonical selected-event pass; stale credential fails explicitly,no cross-family fallback; unavailable scientific content absent |
| Logout/cache/security | T21,T22,T24,T43,T60,T61 | portal logout clears selected credential only; explicit global sign-out clears browser User/desk/Organizer credentials and owner ticket cache; scanner device requires existing confirmed revoke/unpair path with queue preservation,never silent deletion |
| Conditional content | T56–T59 if approved | without approval read-only/no fake edit/program controls; approved T56–T58 field/security contract tested; T59 only approved schema/content decision and finite reviewed addendum,no application code under decision gate |
| Populated expansion/rollback | T64 | start populated0011→three serial expansions→exact1:1 profile/staff backfill,composite cross-event DB rejection,NULL writer compatibility/reconciliation,unchanged IDs/secrets/quotas; retain schema on application rollback,security hardening preserved/operations contained |
| Native scope | T66,T65 | written web-only/native-required decision; web-only accurately labels prototype limitations; native-required→No-Go until separately authorized remediation and real device gates,not Dart-only pass |

### Security gate T60

Exercise the credential Cartesian negatives (U/O/D/S/missing/invalid/expired) against public/User/Organizer/desk/Partner/Booth/scanner resources, not only UI hiding. For actual resources enforce401/403/404 exactly, with foreign Organizer masked404. Same-event competing Partners and Booths are essential, not merely different tenants. Partner grant removal and desk generation must invalidate capability for an unchanged valid User/old desk JWT. Test stale access response and forged local context against backend. Test direct nested foreign resource IDs, category composite FK, assigned User-only onboarding, network participant isolation, export consent/sanitization and anonymous request headers. Existing issued scanner/desk User rejection is due to non-UUID sub; do not assert a demonstrated escalation. No silent fallback, no organizer inference, no scanner queue loss. Fail closed on absent or malformed capabilities; preserve denied-vs-missing UX without disclosing tenant records.

## 4. Full11-route migration and compatibility matrix

History/direct reload is tested in a new tab and after Back/Forward for **every row**, including preserved query/URL semantics; server must serve app shell for BrowserRouter deep links. “Alias” means same content directly at old URL, not a redirect. New canonical attendee paths are `/c/:slug/my-congress`, `/c/:slug/my-network`, `/c/:slug/my-ticket`, `/c/:slug/my-profile`, `/c/:slug/details`; new operational paths `/reception/:eventId` and `/partner/:partnerId`. Conceptual register/search/cards are screen states,not invented nested route contracts. No `/my-congress` or `/my-profile` alias is promised by this matrix. URL path depth is not UX depth: primary destination plus at most one contextual interaction; Back restores actual prior destination/modal state rather than redirect loops.

| Existing route / page | Migration / tasks | History and direct reload | Offline behavior | Authority / event resolution | APIs and regressions |
|---|---|---|---|---|---|
| `/` Home | keep public platform home T53 | same URL; Back from event/entry returns home; direct reload no credential gate | installed shell may render; no invented offline live data | A,no inferred active event/Organizer | no current API; public navigation; R19,R20 |
| `/organizer` OrganizerEvents | retain OrganizerShell T31 | index/key gate survives reload; Back from event restores listing/context | network error shown; no offline mutations/stale authority | explicit O tenant session,never U fallback | events list/create; R10,R16,R20 |
| `/organizer/events/:eventId` OrganizerEventDetail | retain decomposed management T20,T31–T35 | direct ID reload asks O if absent; section changes remain shallow; Back to own events | offline disables server writes,keeps explicitly local same-context drafts | O owned event;foreign404; stale old event loads ignored | event/tiers/points/Booths/operators + new Partner/type; R02,R07,R10,R11,R12,R16,R19,R20 |
| `/organizer/events/:eventId/desk` OrganizerDesk | direct alias to independent ReceptionShell T44 | no redirect/OrganizerLayout dependency; same station reload; Back respects station history | no offline issuance/search authority; interrupted draft retained for same principal/event | D of URL event,or explicitly chosen O operational mode; no fallback | desk login/me/tiers/types,registrations,attendees/detail; R03,R11,R12,R16,R18,R20 |
| `/organizer/events/:eventId/analytics` OrganizerAnalytics | keep organizer route T36 | filters/context survive expected navigation; reload same owned event; polling cleaned on leave | error/stale label; no fabricated live KPI/export | explicit O owned event | attendance/export-csv + filters/tiers/points; R09,R10,R16,R20 |
| `/e/:slug` PublicEvent | keep public landing T53–T55 | direct reload anonymous; registration then selected pass; Back no repeat POST | app shell/error state; do not promise offline public API | A slug→event UUID; reserve separate U | public event+active types,Partner directory,register/login,reserve; R01,R02,R03,R19,R20 |
| `/e/:slug/booths/:boothId` PublicBooth | unchanged printed standee T53 | exact URL no redirect; direct camera navigation/reload; Back to prior event/context | public network failure clear; no invented cached profile | A slug and Booth same event;bookmark separate U | public Booth,protected bookmarks; R07,R16,R18,R20 |
| `/booth/:boothId` ExhibitorPortal | direct exact-Booth compatibility entry T52 | no redirect to guessed Partner; direct reload exact authorization; Back restores selection | lead mutation blocked offline; never claim queue for this portal | U+exact BoothStaff; derive linked Partner after verified Booth; no Partner-only lead grant | Booth/lead scan,list,PATCH,CSV; R07,R08,R09,R16,R18,R20 |
| `/my-tickets` MyTickets | direct My Ticket alias T24,T30 | stays accessible at old URL,no redirect; explicit event picker if several; Back doesn't loop | owner cached tickets supply event/QR without online/me/access; expiry/session presentation distinguished | U locally identifies owner; event from cached owner ticket or live own tickets; never another owner | own tickets/cache; optional protected savedBooth read separated; R03,R04,R18,R19,R20 |
| `/my-network` MyNetwork | direct My Network alias T25,T30 | resolves/picks selected event; Back returns selected prior screen,no redirect | display only genuinely retained state/explicit unavailable; no fabricated offline network or scan | U; event selected from owner context;filter Connection.event_id | all-event network/scan/notes/privacy/vcard; R05,R06,R16,R19,R20 |
| `/scan/:pointId` GateScanner | keep route and state engine byte-compatible T08,T63 | direct input query token removed after storage; reload/restart restores scoped device,Back never loses queue | IndexedDB manifest+pending scans;24h/expiry window; provisional vs authoritative confirmed explicit | S point/event/device; O only deliberately chosen supported administration;no User substitution | manifest/batch/self-revoke + token store; R13–R18,R20 |

## 5. Component reuse, state/security and safe extraction order

Older line counts (about 1981 OrganizerEventDetail, 1409 GateScanner, 1016 ExhibitorPortal) indicate scale, not remeasured/current budgets. Proposed modules are **responsibilities**, not invented source paths. Reuse current UI/style/i18n patterns; do not establish another state/client convention. One owner integrates shared router/auth/schema/translations, and one owns organizer detail extractions. Move proven behavior first; add new domain controls only after delivered APIs/schema.

| Existing asset | Reuse vs genuine addition | Owned state / security boundary | Extraction order and task IDs | Required regression checks |
|---|---|---|---|---|
| `web/src/api/client.ts` / `web/src/api/schema.d.ts` | replace storage/path heuristic with pure authority factory; regenerate API types from real contracts | storage in context/hooks, not factory; null guarantees anonymous; record exact used credential | T03 after T01; T02 before desk T07; disjoint T04–T08 callsites; T09 removes old helper after all | R01,R11–R17,R20; coexistence, no public header/fallback, exact response handling |
| `web/src/main.tsx` / existing layouts | shared navigation/loading/error/context primitives, then distinct shells | explicit principal/event; cancel/ignore stale loads; UI never proves authorization | T21 then T23 attendee, T31 organizer, T37 reception, T45 Partner, T53 public; aliases T30,T44,T52 | all 11 routes; R16,R18–R20 |
| `web/src/pages/OrganizerEventDetail.tsx` | existing event/tier/point/Booth/operator managers; genuine Type/Partner additions; no existing scanner-device UI assumed | each manager owns query/form/pending/error/nested selection under O/event; avoid giant parent mutable state | T31 context; T32 tiers; T33 gates; T34 operators; T35 Partner/Booth staff after APIs; T20 new types after T18; serialized edits | R02,R07,R10–R12,R15,R16,R19,R20; persisted edits, masking, retry, password truth |
| `web/src/pages/OrganizerDesk.tsx` | login/event identity, tiers, lookup/detail, walk-in, pass/print; new category/duplicate/re-auth behavior | explicit event credential; same-principal/event draft survives 401, not identity/event change; explicit selected QR | T37 shell; T38 entry; T39 lookup; T41 QR; T40 issuance after T19; T42 duplicate; T43 session; T44 alias | R02,R03,R11,R12,R16,R18–R20; no remint/automatic POST/Organizer priority |
| `web/src/pages/ExhibitorPortal.tsx` | manual capture, qualification/feed/filter and server CSV; new Partner/sponsor context and camera input; no existing camera/pagination assumed | User, verified Partner, exact selected Booth; reset stale lead selection; no profile-to-lead escalation | T45/T46 context; T47 sponsor; T48 manual; T49 qualification; T50 export; T51 camera same contract; T52 direct Booth | R07–R09,R16,R18–R20; same-Partner A/B isolation, duplicate 200, manual fallback |
| `web/src/pages/GateScanner.tsx` and scanner libraries | retain engine/direct route; no state-machine redesign or nonexistent useScannerEngine hook assumed | device token/manifest/queue/window/deactivation_pending; per-row acknowledgement before removal | T08 transport adaptation only; T63 production/device gate; outside human shells | R13–R18,R20; camera/HID, restart/update, conflict/timeout/unpair/privacy |
| `web/src/pages/MyTickets.tsx` / `web/src/lib/ticketCache.ts` | QR/ticket switch/cache; new event-aware pass and category snapshot | plaintext owner/shape/TTL cache; retained User identifies owner, not authority; legacy missing category tolerated | T23 shell → T24 after T19 → T26 My Congress status/saved Booths → T30 aliases/picker | R03,R04,R18–R20; offline, TTL, logout, two owners, no access-API prerequisite |
| `web/src/pages/MyNetwork.tsx` / network APIs | peer scan/notes/privacy/vCard; new active-event filter over all-event list | own connections; event filter before mutation/export; privacy global | T25 after shell; T28 profile/privacy and selected Ticket after T19; T30 picker | R05,R06,R16,R19,R20; consent, stale load, nonowner and multiple events |
| `web/src/pages/PublicEvent.tsx` / `PublicBooth.tsx` | actual metadata/tiers/auth/reservation/profile/brochures/bookmarks | public requests anonymous; User reservation/bookmark separate; register/login remain anonymous | T53 public layout; T54 directory after T15; T55 reservation after T19 and entry/picker | R01–R03,R07,R18–R20; no fabricated content or public Authorization |
| bookmark APIs / saved-Booth UI | exact BoothBookmark, not invented PartnerBookmark | own aggregate list filtered by event; zero-Booth sponsor has no fake save action | T26 then T27 embedded directory, not sixth tab | R07,R16,R19,R20; idempotency, login/error/empty |
| `web/src/pages/OrganizerAnalytics.tsx` | filters, 10-second polling and event-wide CSV | O/event state; ignore stale loads; clear interval on leave | T36 under organizer shell | R09,R10,R16,R19,R20; filtered dashboard refresh and correct current-event CSV (export API has no filter parameters) |
| `web/src/components/ui` / `web/src/lib/i18n.ts` | Button/Card/Badge/Dialog/SkipLink, tokens and locale; new chooser/five-tab/context primitives | semantic focus/dialog/navigation, independent of authorization proof | T21 primitives first; T62 complete-workflow audit | R19; keyboard, FA/LTR, mixed strings, safe areas, live errors |

## 6. Browser, UI and offline acceptance

### 6.1 Real versus mocked evidence

Existing `web/e2e/scanner-offline.spec.ts` mocks API routes for recovery/failure states, not PostgreSQL policy/revocation/migration proof. `web/e2e/scanner-real-api.spec.ts` uses live API/PostgreSQL setup and browser forwarding (`route.fetch`, not fabricated results): pairing, manifest, self-revoke and old-token 401. It skips without CONGRESS_PLATFORM_ADMIN_TOKEN. T61 adds real API browser journeys for all four human portals and public integration. Unit tests or mocked screenshots are not live E2E proof.

T61 real journeys: anonymous registration/reservation → pass; multi-event User picker → network → vCard → privacy-off → redownload; My Congress directory → Booth bookmark → saved item; Organizer event/tier/gate/type edits → desk grant → Partner grant/link → analytics/export; independent desk login → lookup/print → walk-in → explicit duplicate selection → revoke/reactivate/re-auth; zero-Booth sponsor profile without lead tools; multi-Booth manual capture → qualification/filter/export → authorized Booth switch and denied deep link. Each survives reload and verifies backend persistence via actual UI/follow-up live API. Check download contents and exact QR identity, not headings alone. Include Back/Forward, drawer dismissal, refresh, wrong-event links and a second account sharing browser storage.

Mock-only additions: deterministic timeout/500, malformed response, network failure, delayed load and camera denial, preserving drafts/credentials/queues as appropriate. Label each as mocked. Separate live gates exercise actual 401/403/404/409/410, current membership/revocation and scanner idempotency. Forwarding to another API host is acceptable only with live responses. A skipped real test does not count toward T65.

### 6.2 Seven widths, both languages — T62

Exercise every delivered screen and significant state/action at **320,375,390,430,768,1024,1440px**, in **EN/LTR and FA/RTL**: 14 viewport/locale combinations. Record height, pixel ratio, browser and screenshots. These are acceptance targets, not verified outcomes. Cover login/chooser/picker, all five attendee tabs, Organizer managers/analytics, Reception lookup/issuance/print/re-auth/duplicate, Partner sponsor/manual/camera/qualification/export, and public registration/directory/standee. Add conditional screens only after approval.

| Width | Navigation/layout acceptance | Dialog/touch/focus acceptance |
|---|---|---|
| 320 | all five tabs usable with concise accessible labels; no clipped last tab or horizontal page overflow; one column | fullscreen overlay fits keyboard; 48×48 mobile actions; close/submit/errors reachable |
| 375 | one column; concise labels; public/manager cards readable | bottom sheet; 48×48; content scroll does not trap focus |
| 390 | one column and safe area; QR contrast/quiet zone not covered by tabs | bottom sheet; 48×48; keyboard-open form and focus after errors usable |
| 430 | one column; long Persian person/company names wrap | bottom sheet/safe area; 48×48; print excludes operational chrome |
| 768 | two columns only where useful; no duplicate hidden-focus navigation | centered dialog; 44×44; keyboard dismissal and focus return |
| 1024 | two columns/rail; deliberate RTL direction, not mirrored text | centered dialog; 44×44; logical reading/focus order |
| 1440 | up to three appropriate columns and full sidebar; QR not distorted | dialog/side drawer; 44×44; return focus to initiating action |

Each combination requires semantic landmarks, one visible page heading, accessible active-tab indication, visible keyboard focus, skip link, named icons/buttons, dialog focus trap/Escape/return, associated labels/errors and announced async results. Require WCAG AA contrast, no color-only outcomes, usable 200% zoom, readable QR fallback details, isolated email/UUID/URL direction and correct Persian shaping/numbers/dates/time zone. Contained table scrolling is permitted with usable headers/actions; whole-page/tab overflow is not. Loading/empty/403/404/409/5xx/offline/re-auth states have meaningful actions; retries retain explicit authority. Derive Gregorian/Solar Hijri dates from real timestamps without inventing content. `<1s` QR recognition and `<5s` desk issuance remain prior UX targets, not measured readiness: record actual fixture/network/device and timing; do not claim universal speed or hardware badge-printer support.

### 6.3 Scanner/PWA/device gate — T63

Use a production build over HTTPS or a trusted local development origin. Exercise real camera and USB/HID keyboard scanners on intended hardware; camera permission denial; foreground/background; reload and full browser restart; installation and prompted updates with a pending queue. Pair a real device, download a manifest, disconnect, scan known/unknown secrets, observe provisional decisions, close/reopen, reconnect, and confirm durable scan_ids and per-row confirmed/conflict outcomes. Inject duplicate batches, reordered responses, timeout/500 and actual expired/revoked/wrong-scope credentials: no false confirmation or deletion. Offline authorization expires at JWT expiry or 24 hours from latest server contact/manifest, whichever is earlier. Local claim decoding is not signature verification. Remote revocation cannot instantly reach an offline device: reconnect/window expiry contains it; the pilot explicitly accepts device custody and the offline window.

Unpair online/offline: deactivation_pending is durable before the request, blocks scanning and preserves records; delete the token only after server-confirmed revocation. A shared computer must not display a cached manifest before credential restoration. The service worker caches shell/fonts, not API/PII/JWT responses. Operational IndexedDB contains sensitive data and is not encrypted authority. Do not unpair by generic human sign-out or clearing storage. T63 proves web device behavior, not native parity.

## 7. Future commands and environment

**Recorded only, not executed in Phase03.** Commands are for later authorized implementation gates on isolated data. Confirm currently checked-in scripts before running; source may change. Never run pytest in parallel with other tests using the same recreating/truncating DB.

Canonical repository-root commands:

```text
Windows: scripts\check.bat
POSIX/Git Bash: ./scripts/check.sh
Alternative POSIX invocation: bash scripts/check.sh
```

Current internal command matrix:

| Working directory | Exact command invoked / purpose | Boundary |
|---|---|---|
| backend | `uv run mypy` | strict backend typing |
| backend | `uv run pytest -q` | real PostgreSQL tests; destructive disposable DB fixture |
| web | `npm test` | Node unit scripts |
| web | `npm run typecheck` | tsc -b |
| web | `npm run build` | tsc/Vite production and PWA |
| mobile | `dart test` | Dart logic tests, not Flutter device proof |
| mobile | `dart analyze lib/models lib/services test` | scoped analysis; excludes Flutter main/screens |

Windows wrapper's actual WSL branch is workstation-specific, not portable evidence for another checkout:

```text
wsl -d Ubuntu-24.04 -u root -e bash -lc "pg_isready -h localhost -p 5433 >nul 2>&1 || service postgresql start >nul 2>&1; cd '/mnt/h/Freelancing_Project/KalaniProject/DR.MaHDi/Congere Managment Platform/backend' && /root/backend_venv/bin/pytest -q --tb=short"
```

The wrapper prefers WSL if found, otherwise local pytest. Its Dart fallback is `C:\Users\sadra\AppData\Local\Microsoft\WinGet\Packages\Google.DartSDK_Microsoft.Winget.Source_8wekyb3d8bbwe\dart-sdk\bin\dart.exe`; the POSIX wrapper also appends a WinGet path. T00 records whether the canonical script actually verifies the approved checkout or silently tests the original workstation path. If not, canonical reproducibility is BLOCKED until separately authorized portable configuration/correction. Do not label a substitute command PASS for the script.

Additional exact future commands (cwd shown; these do not replace canonical):

```text
backend: uv run pytest -q tests/test_auth.py tests/test_desk_operator_auth.py tests/test_scanner_security.py tests/test_scanner_revocation_matrix.py
backend: uv run pytest -q tests/test_tickets.py tests/test_desk_registration.py tests/test_booths.py tests/test_leads.py tests/test_lead_qualification.py tests/test_networking.py
backend: uv run alembic current
backend: uv run alembic heads
backend: uv run alembic upgrade head
web: npm run lint
web: npx playwright test e2e/scanner-offline.spec.ts --project msedge
web: npx playwright test e2e/scanner-real-api.spec.ts --project msedge
web: npx playwright test --project msedge
web: npx openapi-typescript http://127.0.0.1:8000/openapi.json -o src/api/schema.d.ts
web: npm run preview -- --host 0.0.0.0 --port 4174
backend: uv run uvicorn app.main:create_app_from_env --factory --host 0.0.0.0 --port 8000
```

New behavior/migration/browser test filenames are chosen during implementation according to existing conventions; then record the actual task-specific command. Do not pretend guessed paths already exist. OpenAPI generation intentionally updates generated source during future API implementation, not planning. Review schema drift and regenerate before dependent UI. Canonical checks currently omit lint, Playwright, OpenAPI drift, populated upgrades/rollback and native analysis/build; these additional gates are mandatory where affected.

Prerequisites: supported Python/uv, Node/npm, Dart, PostgreSQL and permissions **only for disposable congress_test**. Configure CONGRESS_TEST_HOST, CONGRESS_TEST_PORT, CONGRESS_TEST_ADMIN_DSN and CONGRESS_TEST_DATABASE_URL as applicable. The fixture's literal TEST_DB=`congress_test` remains even with URL overrides: its admin connection and test URL must both point only to the same disposable instance, never staging/production. Application configuration requires CONGRESS_DATABASE_URL, CONGRESS_PLATFORM_ADMIN_TOKEN, a nonplaceholder CONGRESS_JWT_SECRET of at least 32 characters, and appropriate CONGRESS_CORS_ORIGINS. Browser configuration uses PLAYWRIGHT_BASE_URL, default `http://127.0.0.1:4174`; the live scanner spec uses CONGRESS_API_BASE_URL (otherwise browser base) and CONGRESS_PLATFORM_ADMIN_TOKEN. Missing admin token causes a skip, hence No-Go for the live gate. Provision Edge/browser availability before an authorized run; install nothing now. Confirm the application/migration/browser endpoints refer to the intended fixture, with unique event UUIDs/slugs. Redact secrets, JWTs, QR secrets and attendee PII from ordinary logs/artifacts.

## 8. Clean-checkout, native and staging/pilot gates

### T00 baseline / T65 repeatable release

Human approval precedes integration/commits. Uncommitted work, including 0011/tests/generated types/planning docs, does not prove what a clean checkout contains. The future owner reviews the manifest, excludes secrets, records an approved SHA and recovery archive, and creates a separate approved checkout without disturbing the original worktree. Provision locked dependencies and a disposable DB; confirm 0011, ordered new migrations, schema and tests are present; run exact canonical and affected task/browser/migration gates there. Record path-specific wrapper limitations. No reset/clean/stash or destructive Git shortcut. Repeat at release SHA; never copy historical 05F/G results. A clean checkout unable to reproduce the environment/schema/routes is No-Go, regardless of working-tree results.

### T66 native scope gate (no native implementation here)

Current native source blockers: `mobile/lib/screens/login_point_select_screen.dart` constructs an unauthenticated protected manifest client; User login does not provide scanner JWT authority. `mobile/lib/services/storage_service.dart` is in-memory, not restart-durable. Camera processCode lacks real camera input, and the capacity call omits the current count. Expiry/offline-window, device unpair/deactivation and provisional/conflict parity are missing. `mobile/pubspec.yaml` lacks the Flutter SDK dependency while main/screens import Flutter. Scoped Dart analysis excludes those screens. T66 documents preserved-client compatibility and decides web-only versus native-required scope with human approval.

A web-only release explicitly excludes native operational scanner claims, retains prototype/source and existing Dart logic checks, and does not advertise parity. If native is mandatory, T65 is blocked pending a separately approved finite remediation backlog, a valid Flutter project, protected pairing, durable DB, camera, policy/session/unpair handling and actual Android/iOS device evidence. Future native-required commands include full `flutter analyze`, `flutter test` and an appropriate platform build, e.g. `flutter build apk`, rather than the canonical Dart subset. Successful Dart tests cannot override auth/storage/camera blockers.

### T65 staging/pilot Go/No-Go

Required unconditional tasks: T00–T55 and T60–T66, with reviewed evidence. T56–T59 remain blocked/excluded unless explicitly approved release scope includes their output; then add their acceptance/addendum gates. In particular, T20,T27,T32,T33,T34,T35,T51,T54 remain mandatory even when not on the longest critical path. T61's actual hard prerequisites are P03-T20,P03-T27,P03-T30,P03-T32,P03-T33,P03-T34,P03-T35,P03-T36,P03-T44,P03-T51,P03-T52,P03-T54,P03-T55, so comprehensive browser journeys do not run before their UI exists. No staging deployment is authorized by this plan.

| Gate | Go evidence | No-Go / operational containment |
|---|---|---|
| Baseline/source | reviewed approved SHA; clean-checkout canonical result; generated contracts; all unconditional feature evidence | missing approval, uncommitted dependency or nonportable wrapper: no deployment; preserve worktree/archive |
| Security | exact T60 credential/tenant/Partner/event/generation/PII negatives; browser request-header evidence | exposure, substitution or token resurrection: stop affected portal; preserve hardening; fix forward |
| Data | T64 populated upgrade; writer drainage/reconciliation; composite FKs; unchanged QR/quota; backup restore and application rollback rehearsal | count/ownership/QR drift or old writers: hold consumers; retain expansion; no heuristic merge/downgrade |
| Browser/UI | T61 live journeys and all 11 direct/history routes; T62 all 14 viewport/locale combinations and accessibility | missing real gate, redirect loop, 320px inoperability or RTL error: hold cutover/use coherent prior UI |
| Scanner | T63 production PWA offline/restart/update/camera/HID/sync/revoke and retained queue evidence | queue loss, false confirmation or window bypass: stop device use; preserve queue; approved reconciliation |
| Native | T66 approved web-only exclusion, or native full real-device evidence | native-required without remediation: No-Go; no Dart-prototype parity claim |
| Pilot operations | Organizer/desk/attendee/multi-Booth/sponsor cohort; approved staging data; trained staff/support; explicit credentials; browser print on intended setup | inability to issue/retrieve/recover/revoke/export: stop pilot; contain operational portal without fallback |
| Sign-off | product, technical/security and operations owners review scope/evidence/residual risks/rollback | unsigned mandatory gate or conditional feature without approval: No-Go |

The pilot exercises public registration, existing printed standee/Booth/scanner links, attendee offline pass, multi-event picker, desk duplicate and expiry/re-auth, organizer revoke/reactivate, Partner profile-only and Booth capture/export, and actual offline gate reconnection. Record deliberate interruptions and remaining PII/device-custody/offline-window limitations. Rollback keeps additive schema, data and queues; restore a compatible application as a cohesive approved change, never piecemeal fallback. Desk/Partner rollback cannot bypass generation/current rows: disable affected operations until secure forward restoration if the old version cannot honor security. Schema downgrade after new writes requires separate explicit loss acceptance/export; it is not the pilot rollback default.

## 9. Risk register — all 17 user risks plus specific release risks

Severity: Critical = data/credential/permission loss; High = core-flow or release blocker; Medium = contained usability/operations. Likelihood is a qualitative assessment from source gaps, not measured frequency. Each risk has named task owners, observable tests and containment; no generic unnamed mitigation tasks.

| Risk | Severity / likelihood | Task IDs | Mitigation and test | Containment / rollback |
|---|---|---|---|---|
| Loss of uncommitted work | High / High | T00,T65 | approved manifest/archive/clean-checkout SHA includes 0011/tests/schema/docs; compare intended artifacts | preserve original worktree; no destructive Git or unapproved integration |
| Auth regression | Critical / Medium | T01–T09,T60 | issued/typeless/expired token-family matrix; real portal entries with exact 401/403/404 | hold cutover; restore coherent compatible transport, never fallback |
| Credential leakage | Critical / High | T03,T04,T09,T53,T60 | all tokens stored: public/auth requests have zero Authorization; redact logs | stop public cutover; never transmit Organizer key to User/anonymous APIs |
| Privilege escalation | Critical / Medium | T01,T10,T13,T16,T60 | explicit types and current-row resource checks; forged context/stale resolver denied | retain server authorizers; disable vulnerable operation; no UI-only guard |
| Organizer identity mismatch | High / High | T01,T10,T22,T31 | no User ORGANIZER role; switching needs separate key; foreign tenant 404 | retain independent credential gates; no implicit identity merge |
| Reception failures | High / High | T02,T07,T34,T37–T44,T61 | independent entry; wrong event 403; duplicate 409 with same QR; 401 draft/re-auth without automatic POST | stop writes; preserve same-context draft; authorized lookup/print, never Organizer fallback |
| Partner ownership confusion | High / High | T11–T15,T35,T64 | event ownership; deterministic 1:1 backfill; multi-Booth and relink impact confirmation | hold linking consumer; no company-name merge; preserve identifiers |
| Cross-Partner exposure | Critical / High | T13,T14,T45–T52,T60 | same-event P(A,B)/Q(C) exact grants; atomic profile/lead revocation; CSV negatives | disable Partner operations; retain exact BoothStaff checks; no all-Booth grant |
| Multi-event errors | High / High | T10,T16,T24,T25,T28,T30,T38,T46,T60 | picker/stale async A→B; context-bound drafts; Connection.event_id filter; exact desk event | clear suspect selection/ignore stale load; do not wipe another owner's cache |
| AttendeeType historical corruption | High / Medium | T17–T20,T24,T28,T40,T55,T64 | nullable Ticket FK and immutable label; rename/deactivate row locking; no User category | stop new category writes; preserve history/schema; no inferred backfill/reassignment |
| Broken printed URLs | High / Medium | T11,T14,T30,T44,T52,T53,T61,T63 | all 11 direct/history routes and three physical QR entry routes without redirects/secret drift | restore compatible UI retaining URLs; never regenerate QR |
| Offline scanners | Critical / Medium | T08,T63,T66 | production restart/queue/window/reconciliation; real camera/HID devices; native gaps separate | stop admissions on invalid authority; preserve pending/conflict rows; authorized reconciliation |
| Alembic order | High / Medium | T02,T11,T17,T64 | inspect actual head; one serialized chain; three ordered populated expansions | hold DB/consumers on branch/order error; retain expansion and roll forward |
| Redirect loops | Medium / Medium | T21,T22,T30,T44,T52,T61 | direct aliases, not redirects; Back/Forward/reload with empty roles and multiple events | preserve original entry URLs; revert broken navigation coherently |
| Mobile tab overflow | High / High | T23,T30,T61,T62 | exactly five tabs; all seven widths EN/FA; 320px last-tab touch/focus/zoom | hold attendee-shell cutover until usable; no hidden sixth tab |
| Unavailable content API | Medium / High | T29,T53,T56–T59 | actual metadata from source; no fake agenda/editor; approved schema addendum | exclude unapproved content; read-only real metadata |
| Extraction regression | High / High | T21,T31–T36,T37–T44,T48–T52,T61 | one owner and shared state contract; move behavior before additions; real persisted mutations/downloads | revert cohesive extraction while retaining secure APIs/schema |
| Desk token resurrection | Critical / High | T02,T34,T43,T60,T64 | versionless only at zero; revoke/reactivate increments; old JWT remains 401 | security-aware rollback; disable operations if generation cannot be honored |
| Lossy DB rollback / old writers | High / Medium | T11,T14,T17,T64,T65 | nullable expansion; drain writers; deterministic reconciliation; data-safe app rollback | retain new tables/columns; no automatic downgrade after writes |
| Synthetic/temporary account usability | High / High | T13,T34,T35,T38,T65 | new Partner absent User 409; desk temporary password truthfully reusable/global; existing password unchanged | no hidden password/claim/recovery flow; existing public registration for new Partner Users |
| Cache/PII/device custody | High / Medium | T21,T24,T43,T60,T63 | owner/TTL/logout/two accounts; plaintext label; credential restoration before cached manifest | clear human owner cache on logout; confirmed scanner unpair without queue loss; restrict custody |
| Mock/history mistaken for readiness | High / High | T00,T60–T66 | separate mock/live/source labels; skipped live gate blocks release; fresh SHA/logs | No-Go until mandatory evidence exists |
| Native parity misstatement | High / High | T66,T65 | explicit scope approval; auth/persistence/camera/full Flutter real-device proof when required | clear web-only exclusion, or native-required No-Go |
| Race after principal/event switch | High / Medium | T21,T25,T30,T38,T43,T46,T61 | delayed old load/draft A→identity/event B; response ignored and no PII carry-over | cancel/ignore old requests; reset selection/draft on context change |

Phase03 concludes with these documents for independent review only. None of the commands, gates, screenshots, rendered views, test pass counts, populated migration rehearsals or pilot outcomes is asserted as exercised.

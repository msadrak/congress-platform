# Phase 03 — Architecture reconciliation

Date: 2026-10-11. Mode: PLANNING ONLY. Verdict: **PARTIAL — ready for independent Phase 04 review, not approved for implementation or release**. Required core architecture has concrete recommendations; T0 commit authorization and conditional product/release decisions remain blocked. No Phase 01/02 document is rewritten; amendments below explicitly supersede conflicting recommendations only after review/approval.

## 1. Evidence, precedence and repository safety

Authority order: current source and Git evidence → this explicit reconciliation proposal → prior planning/historical reports. “VERIFIED EXISTING FUNCTIONALITY” below means traced in source/tests, not newly exercised runtime behavior. No pytest, build, browser journey, migration, package installation or release check was executed in Phase 03. Historical results 131 backend/28 web/8 Dart are historical only; literal test declarations are not collected pass counts.

Read corpus (full assigned files inspected across three read-only investigation slices): all 13 `00_*`, `01_*`, `02_*` files under this directory; GLOSSARY; relevant ADRs 0002/0003/0005/0007/0008/0009/0010/0011; coding standards; router, API client, identity/auth/desk/checkin/tickets/booth/lead/network/public models/routes/migrations and relevant tests; native service/screens; check scripts; 05F/05G integration artifacts. AGENTS instructions were provided in context. Evidence handoffs: `agent://IdentityEvidence/report`, `agent://DomainEvidence/report`, `agent://FrontendEvidence/report`; source citations below are durable repository pointers, not a requirement to retain those agent artifacts.

### Newly observed Git baseline (read-only commands)

- `git status --short --branch && git rev-parse HEAD`: branch **integration/task-05h**, HEAD **284feaffa976171bfc4fdf5d6945d6936c507425**.
- Modified tracked files, exactly 14: `backend/app/models.py`; `backend/app/routes/checkin.py`; `backend/app/routes/desk.py`; `backend/app/routes/events.py`; `backend/app/routes/public.py`; `backend/app/routes/ticket_tiers.py`; `backend/app/security.py`; `backend/tests/test_public_event.py`; `web/src/api/client.ts`; `web/src/api/schema.d.ts`; `web/src/lib/i18n.ts`; `web/src/pages/OrganizerDesk.tsx`; `web/src/pages/OrganizerEventDetail.tsx`; `web/src/pages/OrganizerLayout.tsx`.
- Initial short-status untracked entries: migration `backend/migrations/versions/0011_desk_operators_and_attribution.py`, tests `backend/tests/test_desk_operator_auth.py`, `backend/tests/test_management_lifecycle.py`, and directory `docs/architecture/`. This is **four status entries, not four individual files**. Expanded `git ls-files --others --exclude-standard` confirms three backend files plus all thirteen Phase 00–02 documents: **16 pre-existing untracked files**. Phase 03 adds six documents, giving 22 untracked files if no concurrent work appears. `baseline-check.log` reported previously is not in current untracked inventory.
- Existing integration evidence: `docs/audits/TASK_05F_INTEGRATION_PLAN.md`, `TASK_05F_RELEASE_BASELINE.md`, `TASK_05G_INTEGRATION_REVIEW.md`. No named Task 05H report located. Being on an integration branch is not proof of integration. 05G refers to older master SHA `3046...` and archived work; its archived secret-scan/reproducibility claims do not prove this worktree safe.
- Revision files inspected: linear **0001→0002→0003→0004→0005→0006→0007→0008→0009→0010→0011**. `0011:14-17` declares down_revision=0010. This is repository head-by-file evidence, not the revision applied to a running database. No `alembic upgrade`/database inspection executed.
- Read-only SHA-256 snapshots taken of 385 existing protected files and all 13 prior architecture documents. Final comparison must prove zero differences outside the six new planning files. No reset/clean/stash/rebase/commit/push/merge/deploy was performed.

### Prior-document factual corrections

| Previous claim | Current correction / evidence | Consequence |
|---|---|---|
| Phase00 branch master and four untracked files | Current branch/inventory above | T0 records fresh complete manifest rather than reusing counts |
| 14 ORM tables | `models.py` defines 15, including DeskOperator | Base migrations/types against actual models |
| Native mobile absent | `mobile/lib/screens` and services exist but scanner integration is incomplete | Native release gate remains blocked, not absent and not complete |
| Public Booth list exists | `public.py:17-25,57-76` returns Event/tiers; only single-Booth public endpoint at 79 | Partner directory needs an additive read contract |
| Reservation uses slug path | `tickets.py:52-60`: POST `/api/events/{event_id}/tickets/reserve` | Keep actual UUID path |
| Current booth lead camera/pagination | Existing `ExhibitorPortal.tsx` is manual-secret input; no camera/pagination | Camera input is P03-T51, not an extraction; no pagination promise |
| Organizer UI manages device pairing | APIs exist; OrganizerEventDetail does not invoke device token/list/revoke APIs | Preserve working gate manager, do not invent extraction of absent UI |
| Cache signature/HMAC/tamper evidence | `ticketCache.ts:40-67,95-149` decodes subject, checks owner/shape/TTL only | Plaintext presentation cache, no cryptographic integrity or admission authority |
| Desk adopt unchanged/no risks | Revocation/reactivation can reuse same operator ID with no generation (`desk.py:382-401`, `security.py:78-98`) | Preserve feature but harden generations in separate additive task |
| All 401 include Bearer challenge | `routes/auth.py:61-74`, `app/auth.py` omit some challenges | Explicit contract stabilization, custom admin header stays separate |
| Shell switch provides unified Organizer human session | Organizer has no User FK (`models.py:22-32`) | Separate destination credential entry, no implied human attribution |
| SINGLE_ENTRY policy | Real policy is SINGLE_USE, plus MULTI_ENTRY/TIER_RESTRICTED/CAPACITY_CAPPED | Tests/labels use actual enum; no policy rename |

## 2. AR-01 — Partner without a Booth

**Existing decision:** D06/01_DOMAIN_MODEL §4 Option C adds Partner and nullable Booth FK but defers PartnerStaff; Phase02 still makes `/booth/:boothId` the Partner portal and promises boothless corporate editing.

**Contradiction:** a sponsor has no Booth ID or BoothStaff row. Public listing can work without staff, but authenticated sponsor workspace cannot. Singular `booth_id == null` also contradicts required zero/many Booths.

**Source evidence:** `models.py:205-239` Booth(event)/BoothStaff(booth,user); Lead unique(booth,ticket) at 283-305; `leads.py:50-79` exact BoothStaff authorizer; `booths.py:247-330` assigned-booth list/detail; no Partner or PartnerStaff table/API. GLOSSARY explicitly currently avoids “partner,” so introduce Partner Organization terminology by an approved future documentation amendment; do not rename existing Exhibitor/Booth meanings now.

**Options:** (A) label-only booth route (fails sponsor requirement); (B) move all staff/leads to Partner (unnecessary privilege broadening/data migration); (C+) event-owned Partner plus PartnerStaff for profile and existing exact BoothStaff for leads.

**Recommendation:** C+. Canonical **`/partner/:partnerId`**. Event→Partner owns organization; Partner→Booth is zero/many, Booth remains event-bound. Human authentication uses existing User login; PartnerStaff row is required for Partner profile/workspace. Sponsor-only Partner has `booths=[]`, `lead_booth_ids=[]`, read-only profile default. Multiple Partners/events use discovery/picker, not inferred company names. New staff grant binds an existing registered User; absent normalized email returns 409, organizer directs the person to self-register. Do not create another inaccessible random-password account.

**Legacy compatibility:** `/booth/:boothId` directly renders existing authorized Booth workspace under PartnerShell compatibility mode, preserving URL/query/hash and BoothStaff authorizer, not redirecting or requiring a fake sponsor Booth. Mapped Partner metadata may be enriched when profile authority exists; an old BoothStaff user must still reach their authorized booth even during backfill synchronization. Public `/e/:slug/booths/:boothId` is unchanged. No Partner lead aggregate or Partner QR is introduced.

**Backend impact:** Partner create/list/update (organizer), staff exact grants/removal, existing Booth writes synchronize links/profile memberships, authorized Partner read, public event Partner directory, staged `/api/me/access` enrichment. No `/api/partners/me` duplicate. Membership removal transaction removes that user's BoothStaff for Partner's booths; direct booth unassignment only removes selected booth lead grant. Both profile and lead authorizers run server-side.

**Frontend impact:** PartnerShell/selection/context, sponsor read-only state, explicit authorized Booth picker; lead tabs exist only for returned `lead_booth_ids`. Physical presence/type label alone never enables lead capture.

**Data impact:** additive partners/partner_staff, nullable Booth.partner_id with composite (partner_id,event_id) FK; deterministic Partner.id=legacy Booth.id backfill, distinct staff union; no heuristically merged organizations, no changed IDs/secrets/lead/bookmark ownership. Nullable transition and post-old-writer reconciliation; no immediate NOT NULL cutover.

**Security implications:** PartnerStaff does not grant every child Booth; same-event competitor isolation matters as much as cross-event isolation. Missing Partner404; existing unauthorized403; malformed/expired User401; foreign organizer management404. Sponsor request to any foreign Booth lead API403 despite hiding controls.

**Acceptance tests:** zero-Booth sponsor logs in with User session, GET Partner200 and no lead capabilities; one Partner with A/B Booths, A-only user gets A200/B403; dual grant A+B200; PartnerA user PartnerB403; revocation old JWT403 and all associated Booth grants denied; populated migration preserves every EntityQR/Lead/Bookmark ID and secret; existing booth entry still works after reload.

**Approval status:** recommended amendment to D02/D06/D09, required to meet Phase03 sponsor acceptance. Pending Phase04 architecture review; T11–T16/T35/T45–T52 implementation gated by T0. Partner editing separately BLOCKED T58; profile reading is conservative default.

## 3. AR-02 — Organizer tenant key versus human identity

**Existing decision:** D01 retains Organizer key; D09/Phase02 J15 promise seamless Organizer/Attendee switching. **Uncertainty:** possession of two browser credentials is not proof that they belong to the same person.

**Source evidence:** Organizer only id/name/key_hash (`models.py:22-32`); global User email/password (`70-85`); `app/auth.py:31-47` hashed tenant lookup; `routes/auth.py:81-123` User login/profile. No Organizer↔User association, role exchange, refresh or membership administration.

**Options:** (A) silently reuse User JWT/attach organizer key (unsafe/nonfunctional); (B) separate credentials with truthful switch UX now; (C) later explicit OrganizerUser membership and server authority with audited migration.

**Recommendation:** B now, C only after separate approval. “Admin” defaults to existing Organizer workspace, not super-platform administration. Existing Organizer automation/API keys remain valid. Human User can be attendee/Partner representative and may be a receptionist, but desk action requires the dedicated event token. No JWT/React shell confers tenant ownership.

### Present-state flow

1. `/organizer` asks for tenant key and verifies via existing event list/owned-event APIs. It cannot identify the human operator.
2. `/e/:slug` email/password login issues User token; attendee/Booth operations use that token and row authorizers.
3. Desk URL independently prompts event email/password, obtains desk token; a stored organizer key currently wins through `apiKey || deskToken`, a UX/transport ambiguity to remove.
4. No central multi-role switch currently exists.

### First-migration target flow

1. Human login→User JWT→GET `/api/me/access` describes eligible events/attendee/Partner/reception memberships. One event auto-selects; several prompt picker; no membership shows no-access with registration/public link. It never reports Organizer from User token.
2. User chooses Attendee/Partner: same valid User credential, but target server verifies Ticket/PartnerStaff/BoothStaff as appropriate. Reception eligibility opens selected event's desk login if its valid desk token is absent; it does not exchange the User JWT automatically.
3. Organizer entry is labelled “Organizer tenant-key access,” verified separately. If an organizer key is already present, explicit switch can retain it; absent/invalid key prompts key gate. No claim of a unified human Organizer account or per-human attribution.
4. Switching retains independent credentials until explicit per-authority logout. A401 clears only the credential that made that request; 403/404/5xx do not substitute credentials. An explicit global sign-out clears all human/tenant browser credentials and owner ticket cache, but does not silently unpair a scanner device or delete its unsynced queue.
5. Device scanner remains outside human chooser/context. Role discovery stale data never authorizes requests.

### Later convergence milestone (not executable in this backlog)

Define approved OrganizerUser association and per-person role/ownership, audited provision/revoke, a tested human session authorization path, key automation compatibility and session revocation model. Only then promise Organizer↔Attendee switching under one human login. Desk token exchange would likewise need an explicit membership-checked issuance API; keep dedicated login until it exists.

**Impacts:** no immediate Organizer schema/auth replacement. Frontend chooser distinguishes eligible role from available credential. Data association is later. Security negatives: User→Organizer APIs401, organizer key→User APIs401, User access response never includes Organizer role; choices cannot broaden rights. **Approval:** B recommended; convergence BLOCKED on business/security approval, not hidden inside T22.

## 4. AR-03 — Independent Reception

**Existing decision:** `/organizer/events/:eventId/desk` nested in OrganizerLayout with operator gate bypass. **Contradiction:** bypassing key gate is not independent shell ownership, and current desk client prioritizes organizer key.

**Evidence:** `main.tsx:25-30`; OrganizerLayout `isDesk` gate exception; OrganizerDesk per-event session storage and `activeAuthToken = apiKey || deskToken`; `desk.py:152-229,239-326,469-711` actual authorizers/login/me/tiers/issuance/lookup.

**Options:** redirect only (does not fix credential/shell ownership); duplicate desk backend/UI (unnecessary); independent shell reusing operational features and direct legacy alias (recommended).

**Resolution:** canonical **`/reception/:eventId`**; ReceptionShell owns login, operator/event header, walk-in form, lookup/detail, minted QR/print and logout. Route is outside OrganizerLayout. Event resolved from URL then verified by desk/me/token-bound authorization; user cannot select another event by changing React state. No required organizer credential. Deliberate organizer operational mode remains available only as explicit choice; default independent entry is operator mode, not key fallback.

**Workflow:** anonymous desk/login(email,password,event URL)→event desk token→desk/me and desk/tiers→authorized search/registration→same QR retrieval/print→next attendee. Duplicate409 displays lookup, never creates second ticket or guesses a match.401 expired/revoked/mismatched generation stops protected actions, clears only event desk token and hides fetched attendee PII while retaining unsent draft in component memory for same identity/event re-login; no persistence of draft PII or auto-resubmission.403 wrong event/role stops action and offers appropriate entry; revoked fresh login is403, retained stale token is401. Network/5xx preserves token/draft and offers explicit retry.

**Compatibility:** legacy URL renders the SAME ReceptionShell directly with same event ID; browser Back has no redirect loop, deep reload works. No nested `/desk/register` or `/desk/card` routes needed: they are station views/dialogs. Organizer staff management remains under organizer authority.

**Backend/data impact:** preserve desk routes/model/0011; add session_version separately (T02). Current revoke/reactivate issue: reactivation sets same row active with old token still unexpired. Add version0 field/token claim; versionless token valid only at row0; increment revoke/reactivate; old token permanently401. Existing temporary password is global reusable password returned once for new User; no expiry/one-use/forced change exists. Preserve truthfully, do not advertise one-time invitation. Password lifecycle later approval.

**Tests:** independent entry no organizer key; both keys present still operator token used; wrong-event desk403; foreign organizer404; revoke old token401; reactivation tokenA401/tokenB200; unsent draft retained but no automatic issuance after login; API failure500 does not erase credentials; alias reload/back same station; issued_by retained.

**Approval:** independent route/shell recommended amendment to D05/Phase02. D05 “unchanged” amended to preserve core feature plus scoped generation hardening. T0 mandatory.

## 5. AR-04 — UX claim classification

| Claim | Classification | Evidence / correction | Required work or gate |
|---|---|---|---|
| Reception issuance under five seconds/sub-second | UX TARGET REQUIRING MEASUREMENT | No timing study; API/database/network and operator typing dominate | T40/T61 measure from valid submit to visible usable QR separately from total operator time; record environment/p50/p95, no invented threshold PASS |
| Email plus temporary-password desk login | VERIFIED EXISTING FUNCTIONALITY, source only | desk/login uses User.password_hash; create returns temporary_password only for NEW User, null for existing | T34/T38 label reusable initial password honestly; no one-use/expiry claim |
| HTTP401 revocation | VERIFIED for protected old-token request; false if universal | desk authorizer196–201 is401; login267–271 revoked403; test accepts either for reuse | T01/T02 exact assertions; T43 handles statuses by authority |
| Editable organization/title in My Profile | PROPOSED NEW FUNCTIONALITY + CLIENT APPROVAL REQUIRED | User registration fields exist; GET auth/me only | Read-only T28; optional T57 PATCH allowed fields after approval |
| Scientific program/speakers | UNSUPPORTED ASSUMPTION as existing; CLIENT APPROVAL REQUIRED new feature | No Session/Track/speaker schedule API; polymorphic QR types alone are not program data | T29/T53 show metadata only; T59 decision/schema addendum blocked |
| Partner profile editing | PROPOSED NEW FUNCTIONALITY + CLIENT APPROVAL REQUIRED | Partner model/API absent; Booth profile read only | T47 read-only; T58 optional restricted PATCH |
| Ticket printing | VERIFIED EXISTING FUNCTIONALITY for browser print only | OrganizerDesk window.print path; MyTickets also print UI | T41 preserve print same secret; real print preview/hardware readability QA, no badge-printer promise |
| Attendee category selection | PROPOSED NEW FUNCTIONALITY | Existing body has tier only, no category | T17–T20 additive optional active-event taxonomy; public/desk selectors; no requirement/payments inference |
| 320px layout | UX TARGET REQUIRING MEASUREMENT | Seven-width matrix is proposal, not current rendered proof | T62 test actual 320/375/390/430/768/1024/1440 EN+FA interactions, not screenshot-only |
| Offline ticket caching | VERIFIED EXISTING FUNCTIONALITY with limited guarantees | ticketCache plaintext subject-keyed envelope, seven-day TTL, no signature/exp validation | T24/T30 preserve local presentation/owner isolation; no guaranteed offline server validity or cryptographic tamper evidence |
| Partner capability visibility | PROPOSED NEW FUNCTIONALITY | Current BoothStaff exact lead gate; no Partner/capability API | T15/T16/T46 server IDs/capabilities; hide actions unless explicit grants; test direct API denial |
| Seamless all-role login switch | UNSUPPORTED ASSUMPTION for Organizer/reception credentials | Distinct principals/tokens | T22 truthful destination-login contract; future convergence blocked |
| Camera lead capture in existing Exhibitor | UNSUPPORTED ASSUMPTION as baseline | manual code entry only | T51 new camera input, existing jsqr/manual fallback, real permission tests |
| Signed offline ticket/security envelope | UNSUPPORTED ASSUMPTION | cache owner/shape/TTL; no HMAC/signature | Correct wording; do not add cryptography under portal refactor |
| Cached brochure/agenda/venue-map/admission-state widgets | UNSUPPORTED ASSUMPTION if shown as data-backed | Public payload lacks program/maps; bookmarks are Booths; no attendee admission dashboard endpoint | Use actual URL download and event metadata; no fake charts/next session/admitted indicator |
| Automatic resubmit after expired desk session | PROPOSED interaction rejected for safety | Issuance may have committed before response lost | T43 re-login preserves unsent draft, user confirms/rechecks duplicate before submit |

No placeholder UI controls for unimplemented capabilities. Unavailable features are absent/read-only with truthful explanatory content, not no-op buttons.

## 6. AR-05 — Explicit credential selection

**Existing decision:** D04 proposes credential=f(portal,event). **Source defect:** `client.ts:56-83` reads storage for any falsy token including explicit null, with pathname-based cross-fallback; `getApiClient(null)` on public/login requests is not anonymous. **Additional caution:** an arbitrary client portal name is not authority; current issued desk/scanner tokens already fail User auth by non-UUID subject (`security.py:68-74,88-95`, `routes/auth.py:64-75`). Explicit type rejection is hardening, not evidence of current issued-token escalation.

**Options:** reorder heuristic (retains ambiguity); pure authority factory with scoped contexts (recommended); full new session framework (unnecessary).

**Contract:** factory accepts discriminated authority: anonymous; User credential with verified online identity metadata; Organizer tenant credential; desk credential plus intended event; scanner credential plus intended event/point from existing device store. Client metadata prevents accidental dispatch, but signatures/subjects/type/rows/resource ownership are validated by backend on every request. Missing expected credential/context causes a login/context state without a network mutation; no fallback and no automatic stronger retry. Public and login/register/desk-login always use anonymous client; personalized bookmarks use separate protected bookmark API.

**Incremental cutover:** T03 introduces factory alongside old helper; T04 migrates public/auth; T05 organizer; T06 User/Booth; T07 desk; T08 scanner transport adapter without touching engine/storage/protocol; T09 removes old helper/AuthScope/storage/pathname access after all callers migrated. Temporary coexistence is task-bounded; final no deprecated fallback. Preserve current storage keys/tokens; do not serialize scanner secrets into human AuthContext. An optional decoded exp check only aids UX, not cryptographic authorization.

**Status handling:** response.status plus used-authority identity retained;401 invalidates only used credential (and same-owner protected state),403 permission state retains credential,404 missing/masked state retains,5xx/network retry retains. Stale responses after event/identity switch ignored or aborted; no cross-event state reuse. User logout purges owner cache; offline presentation independent of live resolver. Drafts never auto-replay non-idempotent mutations.

**Backend impact:** T01 explicit human type absent or user accepted, other typed tokens401; retain legacy typeless User sessions. Exact error negatives without widening accepted codes. Preserve existing authorizers and tenant404 masks. Access discovery cannot grant permissions. No auth library change.

**Data impact:** none for transport; desk generation migration is AR03/T02. **Security tests:** null+both stored credentials still public no Authorization; User request with absent User never uses organizer key; organizer request never User fallback; eventA desk cannot use eventB stored token; invalid arbitrary portal selection cannot access target APIs; actual issued desk/scanner and signed typed UUID-sub fixture fail User401; old typeless User token still200; queue survives scanner credential failure.

**Approval:** recommended amendment D04 public personalization rule (public no bearer), explicit authority rather than portal inference. Cutover complete only after T09/T60, not when AuthContext compiles.

## 7. AR-06 — AttendeeType ownership

**Existing decision:** D07 Ticket.attendee_type_id. **Question:** is Ticket the actual participation record or only an entitlement beneath an Order/registration?

**Evidence:** `models.py:108-128` unique Ticket(event,user); `tickets.py:66-76` rejects second event ticket409, creates directly without Order; desk same invariant. User can hold tickets across many events, not multiple tickets for one event. ADR0003's conceptual Order decoupling is not an implemented Order table and is superseded operationally by authenticated free-ticket flow/ADR0005/0007.

**Options:** global User type (wrong event semantics); new EventRegistration/Order solely for category (unnecessary migration); current Ticket optional type plus historical label snapshot (recommended).

**Resolution:** retain **Ticket** as least disruptive participation owner under current unique rule. Add nullable FK to event-scoped AttendeeType plus nullable immutable `attendee_type_name_at_issue`. At successful initial issuance copy active type's name within same transaction; existing Ticket NULL/NULL. Rename/deactivate type does not rewrite ticket historical label. No category reassignment, self-editing or organizer correction after issuance is included. A later business requirement for multiple entitlements or category corrections must revisit explicit EventRegistration/historical audit design, not silently remove unique rule.

**Rules:** category is optional; active and same-event only; missing/wrong-event type404, inactive409. Validate/lock type before quota mutation, so concurrent deactivation and issuance serialize: a committed issuance retains its snapshot; once deactivation commits no new assignment succeeds. Unique(event_id,name), unique(id,event_id) for composite Ticket FK. No deletion endpoint/cascade historical loss. `attendee_type_id`+snapshot both nullable for legacy untyped rows. Sort by display_order then name/id deterministic. TicketTier quota/reserved_count/is_open and point.allowed_tier_ids remain the sole inventory/admission rules. No pricing/payment or permission derived from category.

**Backend impact:** organizer POST/GET/PATCH type CRUD, public active types additive to existing PublicEvent payload, desk active-type read for operator, optional reserve/desk field and additive outputs. Display label uses immutable snapshot, not mutable global profile. No new aggregate overview or Order API.

**Frontend impact:** separate type/tier controls on registration and reception; organizer type manager; per-ticket category badge on My Ticket/My Profile after contract ready. No selection when no types configured; omit field and preserve old registration. Deactivated historical labels still show.

**Data/backfill:** serialize revision after Partner expansion; NULL historical assignment with no inferred physician/student categories. Composite event FK and immutable snapshot write contract; no QR/Ticket ID regeneration. Application rollback leaves schema/data; schema downgrade after writes is lossy and forbidden without explicit export/data-loss approval.

**Security/tests:** cross-event/tenant assignment rejected, inactive blocked without inventory decrement, categoryNULL old requests201, concurrent deactivation/issuance deterministic transaction behavior, historical label unchanged after rename/deactivation, same User eventA/typeA and eventB/typeB independent, quotas and all four admission policies unchanged. **Approval:** ownership recommendation is decision-ready for Phase04; optional assignment taxonomy default consistent D07. Any required/verified category, quota, correction, access privilege or paid flow is a separate product approval and blocks that extension.

## 8. Amendment and blocking registry

| Amendment | Old decision/doc | Recommended Phase03 correction | Task / status |
|---|---|---|---|
| A01 | D06 staff deferred and booth-only Partner route | PartnerStaff + canonical Partner route + exact Booth lead grants | T11–T16,T35,T45–T52; architecture review pending |
| A02 | D09/J15 unified switching | Independent credentials, destination login where needed | T22; no OrganizerUser convergence authorization |
| A03 | D05 unchanged/legacy canonical desk | Independent reception alias + token generation | T02,T37–T44 |
| A04 | Phase02 claims table | Source/proposal/target/approval classification above | Conditional T56–T59 blocked |
| A05 | D04 public credential=userToken | Public/auth anonymous; protected bookmarks separate | T03–T09 |
| A06 | D07 mutable label via FK only | Ticket nullable type + immutable issuance snapshot | T17–T20 |
| A07 | “Additive migration reversible” | Retain expand schema; application rollback, no lossy downgrade after writes | T64 |
| A08 | Offline requires online role resolver | Cached owner tickets independently resolve My Ticket | T24,T30 |
| A09 | GLOSSARY avoids Partner | Add broader Partner Organization definition while preserving Exhibitor/Booth | Future T12 docs amendment, no current glossary change |

Product approvals remaining: optional event branding fields T56; editable global organization/title T57; Partner profile editing T58; scientific content/data model T59; native release scope T66; any account invitation/recovery/session convergence scope. Conservative defaults deliver metadata, read-only profiles, optional taxonomy and existing separate credentials; blocked enhancements are not silently promised.

## 9. Handoff and completeness verdict

Six Phase03 documents are the review package. Roadmap owns stable IDs/dependency graph; backlog owns executable scope and stop conditions; API/data document owns future exact contracts/migrations; test/release document owns route/reuse/UI/risk/regression gates; agent protocol owns future reporting/safety. T0 is a planned prerequisite, NOT performed. All requested AR issues are addressed or explicitly blocked. A source-read planning package can be review-ready while implementation/release is PARTIAL. Phase04 should independently scrutinize Partner/Booth authority, desk generation compatibility, historical category snapshot, credential cutover and native release scope before approving execution.

## 10. Executed Phase03 document-integrity self-audit

The following checks were actually executed with an in-memory, read-only Python analysis of the planning files, not application tests:

- All six required documents exist; relative document-file links resolve.
- Exactly 67 unique contiguous IDs P03-T00–P03-T66; every task contains all 21 mandatory template headings, Given/When/Then acceptance, regression guards and stop condition.
- Roadmap/backlog hard prerequisites agree. Mermaid contains the same 124 task-to-task edges; the 67-node graph is acyclic. T65's ancestry covers every other unconditional task, including all 56 T00–T55 entries; approval-blocked T56–T59 remain explicit.
- AR-01–AR-06, R01–R20, all11 existing URLs, component reuse/UI contracts and all seven viewport widths are covered. Business approvals, native scope and implementation/release evidence are not asserted complete.
- SHA256 comparison of 385 protected existing repository/source files and all13 Phase00–02 documents against the captured pre-writing snapshot found **zero changes**. Only the six requested Phase03 planning files were written; no prior architecture document was overwritten.
- No T0, application edit, new migration, migration execution, dependency installation, database operation, commit/stage/stash/reset/rebase/merge/push/deploy, GitHub issue or application/browser verification command was performed.

Document-integrity gates: PASS. Architectural/product/execution approval and runtime gates: PARTIAL/PENDING as specified above. Historical test counts remain historical; no fresh backend/web/native pass count is claimed. Recommendation: proceed to Phase04 independent review, not implementation or release.


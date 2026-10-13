# P03-T06 — Bind attendee and existing Booth requests to User authority

## Verdicts

- **Implementation correctness: PASS (local, frontend-only).** All 14 protected User HTTP operations and both direct downloads use the explicit `user` authority from P03-T03; absent token means no dispatch; a stale rendered token is never used for a new request; 401 invalidates only the exact token that was sent; late responses cannot change a newer session's view.
- **Integration / release readiness: PARTIAL.** Browser tests use intercepted `/api/` responses. Canonical `scripts/check.*`, backend pytest/mypy, Alembic and real-API browser E2E were **not run**. Production readiness is **not established**.

Only P03-T06 was authorized. No P03-T07 or later work, commit, staging, push, deployment, database or backend change was performed.

## Starting state

Branch `integration/task-05h`, HEAD `92bbfa89d5206a0081aa94a45b91a962e936b191` (T05 committed), clean tree, empty index, no untracked files. The T0 worktree (port 4174) was not touched. T01 and T02 backend protections are untouched (no backend change).

## Authoritative contract (backlog lines 315-362)

- **Title:** Bind attendee and existing Booth requests to User authority. **Prerequisite:** P03-T03 (present).
- **In scope:** current protected User call sites, including self-reservation and Booth lead/export requests. **Out of scope:** Partner model/UI, five-tab shell, category integration, global profile editing.
- **Backend contract (reused, unchanged):** User Bearer for `/api/attendees/me/tickets`, `POST /api/events/{event_id}/tickets/reserve`, network and bookmark families, `/api/booths/{booth_id}` and leads scan/list/PATCH/export. 401 invalid User, 403 for a known non-staff Booth, 404 missing or owned-nested resource. Reserve 409 duplicate, 400 closed, 410 sold out stay distinct.
- **Frontend contract:** absent User blocks dispatch and offers sign-in; no organizer/desk substitution; 401 clears only the sent User credential and renders re-login while preserving the owner cache by its TTL (explicit logout clears it); 403/404 preserve the session.
- **Acceptance:** (1) organizer/desk sessions and no User token: no protected call borrows them; (2) User without BoothStaff gets 403 without logout; (3) ticket-list 401 with a valid cache keeps the pass labelled non-authoritative and unrelated sessions survive.
- No Phase 04 correction blocks T06 or changes its scope; explicit authority and no-fallback rules (AR-05) apply. `/api/auth/me` and `/api/booths/me` are listed in the backlog's backend contract but no frontend code calls them, so nothing was migrated for them.

## Authentication contract (evidence from the backend)

- **Attendee, network, bookmarks, tickets, reservation:** `CurrentUserDep` (User JWT, T01 token-family checks). Ownership is enforced server-side (for example the vCard route selects `Connection.user_id == current_user.id`).
- **Exhibitor / BoothStaff:** there is no `exhibitor` credential. `authorized_booth_staff` in `backend/app/routes/leads.py` takes `CurrentUserDep` and then checks a `BoothStaff` row for that exact Booth; a non-staff User gets 403 "You are not authorized to access this booth portal". A User JWT alone therefore never proves access to a booth.
- **Authentication versus authorization.** The frontend only chooses who is calling (`{ kind: "user", token }`); the server alone decides whether that User may act on a ticket, connection or Booth. Role labels, the stored profile or route parameters are never used to select a credential or to grant access, and there is no organizer fallback.

## Caller inventory (verified against source)

| Term | Count |
|---|---:|
| Imports of `getApiClient` in T06 pages | 4 (PublicEvent, MyTickets, MyNetwork, ExhibitorPortal) |
| Client factory invocations migrated | **11** (PublicEvent 1, MyTickets 2, MyNetwork 4, ExhibitorPortal 4) |
| Distinct HTTP call sites migrated | **14** (1 + 3 + 5 + 5) |
| Direct credential-bearing `fetch` migrated | **2** (vCard, CSV) |
| **Total migrated request sites** | **16** |

Matches the expected 14 + 2. Runtime dispatch counts are higher (effects re-run, StrictMode repeats effects in development).

### Migrated operations

| File and function | Method and endpoint | Authority and scope |
|---|---|---|
| PublicEvent `executeReservation` | POST `/api/events/{event_id}/tickets/reserve` | User; event from the loaded page |
| MyTickets effect | GET `/api/attendees/me/tickets`, GET `/api/attendees/me/bookmarks/booths` | User |
| MyTickets `handleRemoveBookmark` | DELETE `/api/attendees/me/bookmarks/booths/{booth_id}` | User |
| MyNetwork `loadData` | GET `/api/attendees/me/network`, GET `.../network/privacy` | User |
| MyNetwork `handleTogglePrivacyConsent` | PATCH `/api/attendees/me/network/privacy` | User |
| MyNetwork `handleConnectPeer` | POST `/api/attendees/me/network/scan` | User |
| MyNetwork `handleSaveNotes` | PATCH `/api/attendees/me/network/{connection_id}` | User |
| **MyNetwork `handleDownloadVcard`** | GET `/api/attendees/me/network/{connection_id}/vcard` (was `fetch`) | User, `parseAs: "blob"` |
| ExhibitorPortal effect | GET `/api/booths/{booth_id}`, GET `/api/booths/{booth_id}/leads` | User; Booth from route |
| ExhibitorPortal `refreshLeads` | GET `/api/booths/{booth_id}/leads` | User |
| ExhibitorPortal `handleCaptureLead` | POST `/api/booths/{booth_id}/leads/scan` | User |
| ExhibitorPortal `handleSaveQualification` | PATCH `/api/booths/{booth_id}/leads/{lead_id}` | User |
| **ExhibitorPortal `handleExportCsv`** | GET `/api/booths/{booth_id}/leads/export-csv` (was `fetch`) | User, `parseAs: "blob"` |

Public event reads, register and login in PublicEvent stay anonymous (T04). PublicBooth (T04), AttendeeLayout, `ticketCache.ts` and `client.ts` were reviewed and needed no change.

## Changes

- **New `web/src/lib/attendeeSession.ts`:** `isStoredAttendeeToken(token)`, `rejectAttendeeToken(token)` (removes the stored token only if it still equals the token that failed; never touches the owner cache or other credential families) and the shared "session changed" message. It reads storage only for this exact-credential check; the API factory still never reads storage.
- **MyTickets:** explicit User client; on a token change the page now resets tickets, bookmarks, active index and errors before loading the new owner's cache, so one owner's passes cannot stay on screen for another; stale responses ignored; click-time guard on bookmark removal; ticket-list 401 handled by status (below).
- **MyNetwork:** explicit User client for 5 operations; reset of connections, privacy and note state on token change; stale-response and click-time guards; vCard download through the client with `parseAs: "blob"`, same file name rule and no download if the session changed; failed downloads now show an error (previously silent).
- **ExhibitorPortal:** explicit User client for 4 operations plus the CSV export via `parseAs: "blob"`; keyed remount per Booth (a late Booth A response cannot write into Booth B); reset of booth and leads when another account is now signed in; stale-response and click-time guards on capture, qualification and export.
- **PublicEvent:** only `executeReservation` migrated; 401 is now detected by HTTP status (it was matched from message text) and removes only the sent token; a stale token is never used and a response for a changed session shows neither success nor error.

### Status handling

| Status | Behavior |
|---|---|
| 401 | removes exactly the token that was sent (only if still stored), then the page shows its existing sign-in view; other sessions and the owner cache survive |
| 403 / 404 / 5xx / network | session kept; existing denial or error presentation; no retry with another credential |
| Reserve 409 / 400 / 410 | existing message-based handling unchanged |

**Decision recorded (ticket-list 401 with a valid owner cache).** The token is **kept** and the cached pass stays visible with the existing "offline / authorized cache" label plus a new "session is no longer valid, sign in again" notice with a sign-in link. Without a cache, the exact token is cleared and the sign-in view is shown. Rationale: the owner cache is addressed through the JWT subject, so clearing the token would make the labelled cached pass unreachable, contradicting acceptance criterion 3; an invalid token that stays stored is cleared as soon as any other User page receives its own 401. This is a deliberate reading of "clears only the sent credential ... according to the existing TTL/logout distinction" and is flagged for review.

## Session and resource race handling (R1-R6)

| Scenario | Handling | Test |
|---|---|---|
| R1 stale token at click | `isStoredAttendeeToken` before every dispatch (bookmark removal, privacy, connect, notes, vCard, capture, qualify, export, reserve); the blocked action shows the "session changed" message and the page reloads for the current session | bookmark removal; vCard; export |
| R2 delayed 200 after switch | response ignored when the stored token differs or the effect is stale; the following re-render reloads data for the current token | tickets, network, reservation |
| R3 delayed 401 after switch | ignored first; independently `rejectAttendeeToken` only removes an exactly matching token | tickets |
| R4 resource changed in flight | Booth page remounts per Booth id; MyTickets/MyNetwork have no per-resource view state | Booth A to B |
| R5 non-staff booth access | the server returns 403; the page shows denial, keeps the session and never retries with another credential; leads of another account are not shown | 403 test; two account-switch tests |
| R6 download after session change | pre-dispatch guard, and no file or completion feedback if the session changed in flight | vCard x2, CSV |

Limits: a request already dispatched cannot be recalled; the frontend only discards its response. The token is read from `localStorage` when the page renders, and no storage-event listener or polling was added, so a swap by another tab is noticed at the next interaction or response, as in T04.

## Behavior preserved

Sign-in views for missing tokens, ticket list and QR rendering, offline ticket cache and its owner scoping and TTL (`ticketCache.ts` unchanged; explicit logout still clears it), bookmark list, connections, notes, privacy, lead capture/qualification/search, CRM CSV and vCard file names and bytes, reservation form, success dialog and `/my-tickets` handoff, all URLs and QR formats.

## Tests

New `web/e2e/attendee-authority.spec.ts`: **25 tests**, shipping pages and `client.ts`, **backend responses intercepted by `page.route` for `/api/` and synthetic**, not FastAPI/PostgreSQL. Coverage: no User token (organizer, desk and scanner stored) sends nothing on tickets, network and Booth pages; only the User bearer on tickets, bookmarks, network, vCard, lead workflow, CSV and reservation; ticket-list 401 with and without cache; 500; vCard bytes and file name and CSV UTF-8 bytes; vCard 404; network 401; Booth 403 and 401; R1 to R6 scenarios; owner isolation; account switch with a 403 and with a failing leads request; reservation 401 and late reservation. A MutationObserver records transient rendering of stale data.

**Sensitivity check** (application code temporarily mutated and restored byte-identical): removing a click-time guard, the stale-response guards, the owner reset, the Booth remount, the account reset, the vCard stale guard, the export guard and the reservation stale guard each failed the matching test. Two mutations initially survived and led to strengthening the tests: removing only the exact-match check in `rejectAttendeeToken` (the earlier stale guard also protects, so the mutation is detected only with both removed) and removing the Booth account reset (needed a test where B's leads request fails). Both are now caught.

## Commands and results (all independently run, cwd `web/`)

| Command | Exit | Result |
|---|:---:|---|
| `npm test` | 0 | 43 passed, 0 failed, 0 skipped |
| `npm run typecheck` | 0 | clean |
| `npm run lint` | 0 | 14 baseline warnings, 0 errors, no new warning |
| `npm run build` | 0 | 61 modules; existing >500 kB chunk warning |
| `npx --no-install tsc -p tsconfig.e2e.json --types node,vite/client` | 0 | clean |
| Playwright `e2e/attendee-authority.spec.ts` (`PLAYWRIGHT_BASE_URL=http://127.0.0.1:5198`) | 0 | **25 passed**, 0 failed, 0 skipped, no retry label |
| Playwright `e2e/organizer-authority.spec.ts` (T05 regression) | 0 | **13 passed** |
| Playwright `e2e/public-anonymous.spec.ts` (T04 regression) | 0 | **16 passed** |

The Vite server on 5198 was started from this checkout and served the new `attendeeSession` module before the runs; port 4174 was not used. Two assertions were adjusted during authoring because a blocked click re-renders the page and reloads data for the current session; no application defect was involved.

## Not run

Canonical `scripts/check.*`, backend pytest/mypy, Alembic, native checks, `scanner-real-api.spec.ts`, any real-API browser E2E (no proven disposable backend and database), manual inspection against a real backend, responsive/RTL/accessibility checks. The T0 real-API limitation remains open.

## Remaining legacy callers (actual, after T06)

| Page | Instantiations | Legacy HTTP operations | Later owner |
|---|---:|---:|---|
| OrganizerDesk | 4 | 5 (a sixth call is the anonymous login from T04) | T07 |
| GateScanner | 2 | 2 | T08 |
| **Total** | **6** (was 17) | **7** (was 21) | |

Remaining direct credential-bearing `fetch`: **1** (GateScanner scanner self-revoke). `getApiClient` is removed only in T09.

## Risks and gaps

- Frontend-only; server authorization (CurrentUserDep, BoothStaff) was not re-verified against a live backend.
- Intercepted responses can hide contract drift (for example error bodies).
- PublicBooth (T04) keeps its own inline checks instead of the new helper; behavior is equivalent and it was deliberately left unchanged.
- A cross-tab session change is noticed lazily (no storage listener).
- Open decision for review: ticket-list 401 with a valid cache keeps the token (see Status handling).

## Diff summary

Tracked: 4 files, 232 insertions, 59 deletions (`MyTickets.tsx`, `MyNetwork.tsx`, `ExhibitorPortal.tsx`, `PublicEvent.tsx`). New: `web/src/lib/attendeeSession.ts`, `web/e2e/attendee-authority.spec.ts`, this report. `git diff --check` exit 0; no trailing whitespace in new files. Backend, database, API schema, lockfiles, `client.ts` and the legacy helper: no change.

**STOP: P03-T06 concluded. Nothing is staged or committed.**

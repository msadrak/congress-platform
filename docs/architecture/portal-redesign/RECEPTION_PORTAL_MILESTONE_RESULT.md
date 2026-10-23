# Reception Portal — visible product milestone 04

> **Historical milestone result, kept as evidence. Superseded in parts.**
>
> Since then, **e-mail and passwords were removed**: attendees, booth staff and desk operators sign in with an Iranian
> mobile number and a one-time SMS code (ADR 0012, migration `0015`); organizers keep their API key and scanners their
> device tokens. Read e-mail fields, password checks, "wrong password" errors and operator password lifecycles below as
> the state of that date. Current sources of truth: `docs/adr/` (with their status sections), `GLOSSARY.md` and
> `docs/pilot/MASTER-PILOT-READINESS.md`.

Branch `integration/task-05h`, base `177d4dcdf76abd40a4fe271fc8c8d725c22b3a6c`. Frontend-only: no backend, schema or authorization change. Follows backlog P03-T37 (shell/route), T38 (login), T39 (search/detail), T41 (existing-pass print), T42 (duplicate recovery), T43 (expiry/revocation recovery). T40 (event categories) was not in scope.

## Working routes

| Route | Purpose |
|---|---|
| `/reception` | Direct entry. The operator enters the congress code or pastes its public page link; it is resolved with the existing anonymous `GET /api/public/events/{slug}`. No privileged event discovery exists, none was invented. |
| `/reception/e/:slug` | Same, from a printable/bookmarkable URL; redirects to the workspace. |
| `/reception/:eventId` | The event workspace (outside `OrganizerLayout`, no Organizer navigation, no Organizer outlet). Non-UUID ids show a "not valid" state without any request. |
| `/organizer/events/:id/desk` | Unchanged compatible entry; now mounts the same station and keeps the deliberate "Operator session / Organizer mode" switch. |

## Supported operational flow

`Sign in → search → select attendee → review pass → (print) → Next attendee`, and `Walk-in registration → backend-confirmed pass → Next attendee`, all on one screen (search first, walk-in beside/below it).

- **Sign in**: existing `POST /api/events/{id}/desk/login` (anonymous), session stored as `congress_desk_token_<eventId>` in `sessionStorage` (unchanged convention). Distinct messages for wrong credentials (401), revoked/unassigned (403), unknown congress (404), server and network failure. Password is cleared and never stored.
- **Context**: congress name, public slug and operator name from `/desk/me`.
- **Search**: event-scoped, debounced, `/` jumps to the search box, results show name, tier, email, organization, ticket status and check-in count; failure shows a banner with Retry; no match offers an explicit "Register “…” as walk-in" prefill.
- **Review**: explicit selection only; shows status, tier, QR (from the existing detail endpoint), issuer and scan history; focus moves to the heading; 404/403/network errors are shown without any attendee data.
- **Print**: browser print of the selected pass only (print CSS), no request, no new ticket.
- **Walk-in**: existing `POST /desk-registrations`; success is shown only after the backend returns the ticket (pass dialog, QR, print, Next attendee). Double submits send one request. A dropped connection keeps the entry and warns that issuance is unknown, so search before retrying.
- **Duplicate (409)**: the existing ticket is offered only for an exact normalized email match, never auto-selected, nothing is resubmitted.
- **Session loss**: 401 clears only that event's desk token, hides retrieved attendees/QR, keeps the typed walk-in draft in memory, and after a fresh sign-in restores it with a notice; nothing is submitted until the operator presses the button. Sign out clears draft and results. 403/404/5xx/network never clear a session.

## Check-in: what is and is not supported

The backend has **no Desk check-in endpoint**: admission is recorded only by Scanner devices (`/api/checkin/...`). Reception therefore shows check-in count and scan history read-only and says so ("Admission is still recorded by the gate scanner"); no check-in or fake-success button exists. Adding a desk check-in would be a backend contract change outside this milestone.

## Reused

`/desk/login`, `/desk/me`, `/desk/tiers`, `GET /attendees`, `GET /attendees/{ticket_id}`, `/desk-registrations`; `createDeskApiClient` (explicit `desk`/`organizer` authority, event-bound); T07 stale-session guards (signature check, exact-token 401 handling); T02 generation-aware revocation (enforced by the backend); the station that used to live in `OrganizerDesk.tsx`, moved to `components/reception/ReceptionStation.tsx` and shared by both routes; Dialog, Button, Card, Badge, i18n keys.

## Unavailable / limitations

- No desk check-in, no ticket category (T40), no offline Reception, no hardware/silent printing (browser print only).
- No event picker for operators (needs a new backend contract); the congress code is the public slug.
- Operators keep their reusable global password; no reset/rotation UI (out of scope).
- Event name is known only after sign-in (the pre-login screen is generic).

## Tests (cwd `web/`, exit codes)

| Command | Exit | Result |
|---|:---:|---|
| `npm test` | 0 | 50 passed |
| `npm run typecheck` / `npm run build` | 0 / 0 | clean; 73 modules |
| `npm run lint` | 0 | 14 warnings, 0 errors (same baseline; the one in the moved desk code is the pre-existing `set-state-in-effect`) |
| `tsc -p tsconfig.e2e.json --types node,vite/client` | 0 | clean |
| Playwright, **intercepted API (not real-backend)**: `reception-portal` (16, new) | 0 | 16 passed |
| Playwright full suite, same intercepted setup, built app on `127.0.0.1:4175` | 1 → 0 | 120 passed, 1 failed (`public-anonymous` desk-entry expected the server text "Invalid email or password"; fixed by using that wording) — re-run of `public-anonymous`, `reception-portal`, `desk-authority`: 44 passed |
| `desk-authority` (12 existing tests, **unmodified**) against the moved station | 0 | 12 passed |

New browser tests: congress-code entry (unknown/invalid/URL/slug route), no Organizer navigation/mode/key use with an organizer key stored, login success/failure/revoked/network with nothing stored, event isolation, search scope, review + print (print spy, zero POSTs), keyboard `/` and Enter, 404 detail, no-result walk-in prefill, failed search banner, double submit = one POST, duplicate exact-match recovery, dropped connection, revocation with draft kept and no auto-resubmit, sign out, 768/390 px overflow with search-first order, Persian RTL at 320 px. Backend suite not rerun (no backend change); `scanner-real-api` and `scripts/check.*` were not run.

## Real-backend verification

21/21 checks passed in a real browser against real FastAPI + PostgreSQL (throwaway script, not in the repo), with an **organizer key deliberately stored in the browser**:

1. `/reception` opens with no Organizer navigation; unknown code explained; public link resolves to the event workspace; nothing protected requested before sign-in.
2. Wrong password rejected (no session); valid operator (Operator Reza, assigned to event A only) enters event A and sees congress and operator.
3. Search finds the controlled attendee; review shows status, QR and history; reviewing sends no mutation.
4. An attendee of the second congress is not found in this scope.
5. Walk-in issued and confirmed by the backend with exactly one registration request (double-click); the new attendee is then searchable; Next attendee clears and refocuses search.
6. Duplicate registration (same email, different case) → backend 409; the exact existing pass is offered, not auto-selected, no extra POST.
7. Event B: the event A desk token gets **403** from the backend for `/desk/me`, `/attendees`, `/desk/tiers` and registration; the browser never sends it to B; Reza's event B login is denied (403) without touching the event A session.
8. Organizer revokes Reza → next search gets 401: gate shown, attendee data hidden, draft kept; Reza cannot sign in (403); the old token stays 401 after **reactivation**; a fresh sign-in works, the draft is restored and zero registrations were sent automatically.
9. Persian RTL mobile: right-to-left, 0 px overflow.
10. Every protected request carried a Desk token; the stored organizer key was never sent; login carried no credential.

Environment: Alembic `0012` on new database `congress_ms04` in the disposable internal-network PostgreSQL (no published port); API container bound to `127.0.0.1:8000` only; data from the repo's `seed_demo.py` plus a second congress, two operators and two controlled attendees created through the API. The shared development database and `demo_credentials.json` were not touched. This is not production readiness (demo data, one browser, one device class).

## Screenshots (`reception-portal/`) — all from the **real backend**, controlled data

No intercepted-API screenshots.

- `01-desktop-reception-login-real.png` — login
- `02-desktop-reception-search-real.png` — attendee search
- `03-desktop-reception-review-real.png` — attendee/ticket review (QR, status, history)
- `04-desktop-reception-confirmation-real.png` — backend-confirmed walk-in pass
- `05-tablet-reception-workspace-real.png` — tablet (1024 px) workspace
- `06-mobile-fa-rtl-reception-real.png` — Persian RTL mobile (390 px)

## Run it locally

```
cd backend && CONGRESS_PLATFORM_ADMIN_TOKEN=dev uv run uvicorn app.main:create_app_from_env --factory --port 8000
cd web && npm run dev
```

Seed with `uv run python seed_demo.py` (backend), create an operator from the Organizer event's "Desk Staff" tab (it shows the one-time password), then open `/reception`, enter the congress code (`ai-health-2026` for the seed) and sign in with the operator account.

## Release blockers / follow-ups

Desk check-in contract (if reception must admit people); operator password lifecycle (reusable global password); no audit log of reception actions in the UI; no accessibility audit with assistive technology or device matrix; browser-print only.

## Commits

- `73b59782ff8dce16b15bee5b386f12e6a8fe823b` — feat(web): independent reception portal with search, review, duplicate and session recovery
- the docs commit that adds this report and `reception-portal/` (top of `git log`)

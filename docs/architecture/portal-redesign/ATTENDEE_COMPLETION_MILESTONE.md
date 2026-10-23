# Attendee completion — visible product milestone 02

> **Historical milestone result, kept as evidence. Superseded in parts.**
>
> Since then, **e-mail and passwords were removed**: attendees, booth staff and desk operators sign in with an Iranian
> mobile number and a one-time SMS code (ADR 0012, migration `0015`); organizers keep their API key and scanners their
> device tokens. Read e-mail fields, password checks, "wrong password" errors and operator password lifecycles below as
> the state of that date. Current sources of truth: `docs/adr/` (with their status sections), `GLOSSARY.md` and
> `docs/pilot/MASTER-PILOT-READINESS.md`.

Branch `integration/task-05h`, base `695f4bf1e632cfd94fdb1dfa568b2ee33d7fdd89`. The five-destination portal is unchanged; no sixth tab.

## What visibly changed

| Area | Change |
|---|---|
| Direct sign-in | New `/sign-in` and `/c/:slug/sign-in?next=…`. Reuses `POST /api/auth/login` with anonymous authority. Mobile-first form, EN/FA (RTL), field-level validation, distinct wrong-credentials / server / network errors, loading state. Returns to the intended destination via a strict allow-list (`lib/safeRedirect.ts`: only the five portal destinations of a congress, `/e/:slug`, `/e/:slug/booths/:id`, `/my-tickets`, `/my-network`; external, protocol-relative, backslash, traversal and unknown paths fall back to the congress's My Congress). A still-valid session is kept (shows "signed in as … / Continue / Use a different account"); a rejected stored token is removed and the form is shown. Entry points: "Attendee Sign In" in the public header (on `/e/:slug` it targets that congress) and every signed-out portal/legacy page. Registration and the reserve dialog are untouched. |
| Booth discovery | My Congress now has an **Exhibition booths** directory (replacing the saved-only list). Read anonymously from a new `GET /api/public/events/{slug}/booths`; links to the existing booth page; search box above 6 booths; loading, empty, error+retry states. Signed-in attendees get a Save/Saved toggle (User authority, `aria-pressed`); saved state is loaded separately and never gates the list. Signed-out users see the directory and a sign-in hint. |
| My Profile | Name, email, organization, title are shown from `/api/auth/me` and labelled **Read-only**. The one attendee-controlled setting, peer contact sharing, is now a real switch (`PATCH /api/attendees/me/network/privacy`): the displayed value is the one the server returns, failure keeps the previous value and says so. |
| Cross-congress scan | `POST /api/attendees/me/network/scan` accepts an optional `event_id`. If the badge belongs to another congress the server answers 409 **before any write** (also before the notes-overwrite path). My Network (portal) always sends its congress id and shows "belongs to another congress and was not saved". Omitting `event_id` keeps the legacy all-congress behaviour and the badge/QR formats are unchanged. |

## Decisions and blockers

- **Profile editing of name/email/organization/title is NOT implemented.** T28 lists it out of scope; P03-T57 (global organization/title editing) is BLOCKED pending product approval (04_BACKLOG_AUDIT, 04_MVP_SCOPE_AND_PRIORITIES: editing could desynchronise printed badges; 04_CORRECTION_AND_APPROVAL_REGISTER: no code without client sign-off). Delivered the approved subset only (contact-sharing switch). Unblocking needs a product decision on whether profile changes may differ from already-issued badges.
- **Sponsors/Partners are not represented in the schema** (no Partner table, only `Booth`; `partner_ids` in `/api/me/access` is still `[]`; T11–T16 not started). No sponsor records were invented; the directory is a genuine booth directory. A sponsor/partner view needs the Partner domain (T11–T15).
- **Cross-congress connections are not intentionally supported by the contract**: `Connection.event_id` scopes every row, and the congress portal is event-scoped, so the previous "write first, tell the user afterwards" behaviour was a defect for that surface. The legacy `/my-network` (all congresses) deliberately still works without `event_id`.
- Only additive backend changes: one public GET, one optional request field. No migration (Alembic head still `0012`).

## Works with real backend data

All of the below were run in a real browser against the real FastAPI + PostgreSQL stack (controlled data: congresses "Iranian Cardiology Congress 2027" and "National Oncology Summit 2027", 4 + 2 booths, users Dr. Sara Ahmadi and Dr. Reza Karimi, one connection, one saved booth). **26/26 checks passed.**

Event page → "Attendee Sign In" → empty/invalid/wrong-password errors → login → lands in `/c/cardiology-2027/my-congress` → directory lists exactly the 4 cardiology booths (no oncology booth) → pre-saved booth shown as saved → booth page → bookmark persists, directory reflects it after reload, removing it from the directory works → profile shows real values, switch change persists across reload → own pass with QR → network shows only the cardiology connection → scanning Reza's **oncology** badge in the cardiology portal is refused with the message; PostgreSQL still holds exactly 1 connection → switching to the oncology congress shows its own booths and no cardiology connection → Persian RTL has 0 px horizontal overflow at 390 px → logout removes the session → signed-out and garbage-token profile ask for sign-in and the bad token is removed → `?next=https://evil.example` is ignored on the real login. Public reads and login carried no `Authorization` header; every personal request carried the User credential.

Environment: Alembic `0012` on a new database `congress_ms02` in the disposable internal-network PostgreSQL (`congress-t0env-pg-…`, no published port; the host has nothing on 5433; effective DB verified with `select current_database()`); API container bound to `127.0.0.1:8000` only; the shared development database was not touched. The journey script was throwaway and is not in the repo.

## Tests (exit codes)

| Command | Exit | Result |
|---|:---:|---|
| backend `pytest -q` (disposable PostgreSQL, container `congress-ms02-runner`) | 0 | 182 passed (176 + 3 directory + 3 networking regression) |
| backend `mypy` | 0 | no issues, 49 files |
| `npm test` (web) | 0 | 50 passed (5 new: redirect allow-list) |
| `npm run typecheck` / `npm run build` | 0 / 0 | clean; 69 modules |
| `npm run lint` | 0 | 14 warnings, 0 errors (same count as the previous milestone; none in new files) |
| `tsc -p tsconfig.e2e.json --types node,vite/client` | 0 | clean |
| Playwright (intercepted API, **not** real-backend): `attendee-signin-discovery` (13, new), `attendee-portal` (9), `attendee-authority`, `public-anonymous`, `organizer-authority`, `scanner-authority`, `desk-authority` | 0 | 92 passed, 0 retries, against the built app at `127.0.0.1:4175` |

Regression tests that matter: an event-scoped scan of another congress's badge returns 409 and leaves the connection list empty; the same attempt does not overwrite existing notes; a same-congress scan with `event_id` still connects; the directory returns only its congress's booths in name order, exposes exactly 7 public fields (no QR secret/staff), `[]` for an empty congress, 404 for an unknown slug. `scanner-offline` and `scanner-real-api` were not rerun (scanner code untouched). Canonical `scripts/check.*` was not run.

## Screenshots (`attendee-completion/`) — all from the **real backend**

Intercepted-API screenshots: none. (The intercepted Playwright specs assert behaviour only.)

- `01-mobile-sign-in-real.png`, `02-mobile-sign-in-error-real.png` — mobile sign-in, wrong-password error
- `03-mobile-my-congress-booth-directory-real.png` — real booth directory with saved state
- `04-mobile-my-profile-view-real.png`, `05-mobile-my-profile-edit-real.png` — profile view; after changing the one editable setting (identity fields have no edit mode)
- `06-mobile-my-ticket-real.png`, `07-mobile-my-network-cross-congress-refused-real.png`
- `08-desktop-my-congress-real.png` — desktop overview
- `09-mobile-fa-rtl-my-congress-real.png`, `10-mobile-fa-rtl-my-profile-real.png`, `11-mobile-fa-rtl-sign-in-real.png` — Persian RTL, 390 px

## Run it locally

```
# backend (needs a PostgreSQL you are allowed to use; `uv run python seed_demo.py` seeds a demo congress with booths)
cd backend && CONGRESS_PLATFORM_ADMIN_TOKEN=dev uv run uvicorn app.main:create_app_from_env --factory --port 8000
# frontend (proxies /api to :8000)
cd web && npm run dev
```

Open `/e/<slug>` and use **Attendee Sign In**, or go straight to `/c/<slug>/sign-in` (signed-out portal pages link there). Attendee accounts come from the registration/reserve dialog or the seed.

## Remaining limitations

- No sponsor/partner information (no Partner model); booths only.
- Name/email/organization/title cannot be edited (T57 blocked on product approval); no password change/reset, no avatar.
- No password-reset or "forgot password" link on the sign-in page (no such backend).
- The legacy `/my-network` still lets a scan of any congress's badge succeed (by design, all-congress view).
- Not covered: canonical `scripts/check.*`, viewport matrix beyond 320/390/1280, accessibility audit with assistive technology, real devices. Redirect allow-list is covered by unit and browser tests only; no external security review.
- Production: the public directory is unauthenticated and unpaginated (fine for the booth counts the model implies; add pagination if an event can have hundreds of booths).

## Commits

- `1e4b5bdd533d1542f8553ff7f9f69be6ed6ec9b7` — feat(api): public booth directory and event-scoped badge scan guard
- `d07d620fd8cccf21fd953bf3771bab727ea5ccbb` — feat(web): direct attendee sign-in, booth directory and working profile privacy
- the docs commit that adds this report and `attendee-completion/` (top of `git log`)

# Organizer Portal — visible product milestone 03

Branch `integration/task-05h`, base `447e5cdc6446c9931f9be46f5cef12ec2827d014`. Frontend-only: no backend, schema or authorization change.

## What visibly changed

One workspace instead of loosely linked pages (`/organizer/events/:id/*`, same routes plus four section URLs):

- **Active-event context bar** (new, in `OrganizerLayout`): `← Events List / <event name> / status / dates / Public page`. The name is shown only when the page reports an event whose id equals the route id, so another event's name can never appear.
- **One workspace navigation** (`nav` "Event workspace"): Overview · Ticket Tiers · Check-In Gates · Exhibition Booths · Desk Staff | Analytics | Front Desk. Every section is URL-addressable (`/tiers`, `/check-in`, `/booths`, `/operators` are new routes rendering the existing `OrganizerEventDetail`); switching sections does not refetch the event. This replaces the old breadcrumb, quick links and the in-page tab strip (no duplicate navigation).
- **Events overview**: the fabricated "Active Congress" badge is replaced by a status derived only from each event's own start/end (Upcoming / In progress / Ended); create/edit now announce success.
- **Event overview section**: real counts (tiers, gates, booths, active operators) that link to their sections, and a real "Ticket capacity & reservations" block computed from the tiers' `quota`/`reserved_count` (total plus per-tier bars; an explicit empty state when no tier exists). No revenue or invented metrics.
- **Event management**: success/failure notices after every save/create (event, tier, check-in point, booth, operator revoke); **confirmation** before revoking a desk operator and before closing a ticket tier. A silent failure on operator revoke was fixed (it used to ignore errors). Confirmations render last so they always stack above an open form dialog (found and fixed during browser testing).
- **Analytics**: compact header, duplicate "Event Settings" link removed (navigation lives in the workspace), explicit note that filters change the view only and the CSV always covers the whole event (verified against `analytics.py`: export takes no filters), localized export errors. KPIs, filters, polling, CSV and gate/catering sections are unchanged.
- **Reception relationship**: Reception stays a separate-authority page, reachable from the workspace nav; with both credentials present it now states `Acting as: reception operator` / `Acting as: organizer`. Default behaviour (operator mode when a desk session exists) is unchanged. The header shows an `Organizer ••••1234` chip.

## Existing functionality reused (untouched logic)

`createApiClient({ kind: "organizer", token })` for every call, the credential gate, `onKeyRejected` (exact-key 401 handling), per-event remount (`key={eventId}`) for stale-response safety, all event/tier/check-in-point/booth/staff/operator APIs and forms, analytics endpoints and CSV export, Desk page and its mode switch. The Organizer backend remains Bearer-key based; `X-Admin-Token` is not used by the UI.

## Missing / not done

- No event lifecycle actions (publish/archive/delete) exist in the backend, so none are shown. Booths cannot be edited or deleted (no PATCH/DELETE endpoint); only create, staff assignment and standee QR exist.
- No cross-event dashboard figures (counts per event on the events list would need N requests or a new endpoint; deliberately not added).
- Reception is not a standalone portal (later milestone). The Desk page itself was only touched for the mode label.
- Persian copy for a few existing long labels remains as before; no full i18n audit.

## Tests (cwd `web/`, exit codes)

| Command | Exit | Result |
|---|:---:|---|
| `npm test` | 0 | 50 passed |
| `npm run typecheck` / `npm run build` | 0 / 0 | clean; 71 modules |
| `npm run lint` | 0 | 14 warnings, 0 errors (same baseline; none in changed files) |
| `tsc -p tsconfig.e2e.json --types node,vite/client` | 0 | clean |
| Playwright, **intercepted API (not real-backend)**: `organizer-workspace` (13, new), `organizer-authority`, `desk-authority`, `attendee-signin-discovery`, `attendee-portal`, `attendee-authority`, `public-anonymous`, `scanner-authority` | 0 | 105 passed, 0 retries |

New browser tests cover: derived status badges, URL-addressable sections with `aria-current` and no refetch on section change, real capacity numbers, empty-tier message, event switching with a slow previous event (no previous data/name ever shown), event edit (organizer Bearer only, workspace context updates), tier-close confirmation (cancel sends nothing), operator revoke confirm and failure notice, CSV note/export, acting-mode label with both credentials, no horizontal overflow at 390/768 px, Persian RTL at 320 px. One existing test was updated because the in-page `tab` became workspace navigation links (`organizer-authority`: tier creation). No backend change, so the backend suite was **not** rerun; `scanner-offline`/`scanner-real-api` and `scripts/check.*` were not run.

## Real-backend integration result

22/22 checks passed in a real browser against real FastAPI + PostgreSQL (throwaway script, not in the repo): credential gate, wrong key rejected and removed, real key, events list, active-event context, overview capacity equal to the tiers returned by the API, event location edit persisted (re-read through the API), tier created and persisted, tier close shows a confirmation and the backend stays open until confirmed, then closed, booths section shows the real booths, new booth appears in the public directory API, analytics values equal `/analytics/attendance`, CSV downloaded with one row per scan (`rows == total_scans`), switch to the second event shows none of the first event's tiers/booths, Reception shows `Acting as: organizer`, sign out, **a different organizer sees no events and gets "Failed to Load Event" for the first event's URL**, no overflow on mobile and Persian RTL mobile, and every `/api/events*` request carried an `Authorization: Bearer` key.

Data: `seed_demo.py` (the repo's synthetic demo seed: 1 congress, 250 tickets, 238 scans, 3 gates, 2 booths) plus a second small congress and a second organizer created through the API. Environment: Alembic `0012` on new database `congress_ms03` inside the disposable internal-network PostgreSQL (no published port; verified before use), API container bound to `127.0.0.1:8000` only; the shared development database and the developer's `demo_credentials.json` were not touched. Not production readiness: the journey used demo data, one browser (Edge) and one viewport set.

## Screenshots (`organizer-portal/`) — all from the **real backend**

No intercepted-API screenshots.

- `01-desktop-events-overview-real.png` — events overview
- `02-desktop-event-management-real.png` — event workspace overview (context bar, nav, capacity)
- `03-desktop-ticket-tiers-real.png`, `03b-desktop-ticket-tier-form-real.png`, `04-desktop-close-tier-confirmation-real.png` — ticket tier configuration, create form, close confirmation
- `05-desktop-analytics-real.png` — analytics
- `06-mobile-event-management-real.png`, `07-mobile-events-overview-real.png` — mobile (390 px)
- `08-mobile-fa-rtl-event-management-real.png`, `09-desktop-fa-rtl-analytics-real.png` — Persian RTL

## Run it locally

```
# backend (needs a PostgreSQL you are allowed to use); `uv run python seed_demo.py` seeds a demo congress
cd backend && CONGRESS_PLATFORM_ADMIN_TOKEN=dev uv run uvicorn app.main:create_app_from_env --factory --port 8000
# frontend (proxies /api to :8000)
cd web && npm run dev
```

Open `/organizer` and enter an organizer API key (the seed prints one: `demo-organizer-secret-api-key-2026`; new organizers come from `POST /api/organizers` with `X-Admin-Token`). Then open an event; Reception is `/organizer/events/:id/desk`.

## Remaining production limitations

Organizer keys live in `sessionStorage` (existing design); no key rotation UI; no pagination on events/booths/attendees lists; analytics polls every 10 s; no accessibility audit with assistive technology or real-device matrix; organizer/desk/booth tooling has no audit log.

## Commits

- `2b6afa0474b812ae58e70cfda57319e60e063d75` — feat(web): cohesive organizer workspace with event context, section routes and confirmations
- Docs commit: this report and `organizer-portal/` (top of `git log`)

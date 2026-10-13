# Attendee Portal — visible product milestone 01

**Result:** a working five-destination Attendee Portal at `/c/:slug/*`, exercised end to end against a real FastAPI/PostgreSQL backend with controlled data. Not production-ready: canonical full-stack gate, real devices and the full responsive matrix are not covered.

## What works

| Destination | Route | Content (all real data) |
|---|---|---|
| My Congress | `/c/:slug/my-congress` (`/c/:slug` redirects here) | Congress name/dates/venue; your pass for this congress (or a reserve link); connection count at this congress; booths you saved here (the "partners" area, see limits); links to the other destinations; your other congresses from `GET /api/me/access` (event switch) |
| My Network | `/c/:slug/my-network` | Existing network feature, filtered to this congress by each connection's `event_id`; notes and vCard only act on visible connections; scanning a badge from another congress says so; privacy control labelled global |
| My Ticket | `/c/:slug/my-ticket` | Existing pass with QR and offline owner-scoped cache, filtered to this congress |
| My Profile | `/c/:slug/my-profile` | Read-only name, email, organization, title (`/api/auth/me`) and contact-sharing status; no edit controls, editing is stated as unavailable |
| Congress Details | `/c/:slug/details` | Public metadata and pass types with availability, read anonymously; works without signing in |

Navigation: exactly five destinations; fixed bottom bar on mobile (56 px targets, safe-area padding), top tabs from 768 px; EN/FA with RTL. Each page has loading, not-found, error, signed-out and empty states. Legacy `/my-tickets` and `/my-network` still work (all congresses) and `/my-tickets` links into the portal; the "already holds a pass" link on the public congress page now opens `/c/:slug/my-ticket`.

## Backlog tasks

- **P03-T10 done:** `GET /api/me/access` (User only), exact event-grouped schema, active tickets / non-revoked desk rows / BoothStaff, `partner_ids: []`, no ORGANIZER; regenerated `schema.d.ts` (additions only).
- **P03-T21 (minimal):** `lib/congressContext.ts` (approved destination list, congress path builder, anonymous shared congress loader with stale-result isolation) and `components/ui/PortalState.tsx` (`CongressRoute` per-slug remount, status/loading panels). No AuthContext or state library; credentials stay with their owners.
- **P03-T23:** shell built into `AttendeeLayout` (`eventSlug`/`destination` props) and the five routes.
- **P03-T25:** event-scoped My Network (client filter, visible-ID guards, cross-congress scan notice, global privacy label).
- **Deliberate deviation:** T23's contract keeps the five-destination workspace unreleased until T30 (after T24–T29). On your instruction the portal is active now. My Profile and Congress Details are real but minimal versions of T28/T29 using existing APIs; T24 (ticket categories) and the Partner domain (T11–T16) were not started.

## Security

Public congress reads and login stay anonymous; every personal request uses explicit `user` authority (verified on the real journey: 0 public requests with credentials, 0 protected requests without). Stale or rejected sessions: existing T06 guards are unchanged, and the new pages remove only the exact rejected token on 401 and ignore responses after a session change. No fallback between credential families. The access endpoint describes eligibility only; tests confirm the same User still gets 401 on desk and organizer routes.

## Evidence

Screenshots (all from the running app against the **real backend** with controlled data: congresses "Iranian Cardiology Congress 2027" / "National Oncology Summit 2027", users Sara and Reza, one connection and one saved booth):

- `attendee-portal/mobile-my-congress.png` — mobile My Congress
- `attendee-portal/mobile-my-network.png` — mobile My Network
- `attendee-portal/mobile-my-ticket.png` — mobile My Ticket with QR
- `attendee-portal/desktop-my-congress.png` — desktop overview
- `attendee-portal/mobile-fa-my-congress.png` — Persian RTL

Real-API journey (throwaway script, not in the repo): sign in through the existing public form, open the pass, visit all five destinations, switch to the second congress via My Congress, confirm the first congress's connection is not shown there, switch to Persian (0 px horizontal overflow at 390 px). Environment: Alembic `0012` on a new database `congress_ms01_smoke` in the disposable internal-network PostgreSQL used since T01/T02 (system id 7695674229552807975, no published port); API container bound to `127.0.0.1:8000` only. The shared development database was not touched.

## Tests (cwd `web/` unless noted)

| Command | Exit | Result |
|---|:---:|---|
| backend `pytest tests/test_access_discovery.py` (isolated runner) | 0 | 4 passed |
| backend `pytest -q` | 0 | 176 passed |
| backend `mypy` | 0 | no issues, 48 files |
| `npm test` | 0 | 45 passed |
| `npm run typecheck` / `lint` / `build` | 0 | lint 14 baseline warnings, 0 errors; build 66 modules |
| `tsc -p tsconfig.e2e.json --types node,vite/client` | 0 | clean |
| Playwright `attendee-portal` (new, intercepted API) | 0 | 9 passed; 27/27 over 3 repeats |
| Playwright `attendee-authority`, `public-anonymous`, `organizer-authority`, `scanner-authority` | 0 | 25, 16, 13, 4 passed |
| Playwright `desk-authority` | 0 | 12 passed; 48/48 over 4 repeats after fixing two debounce races in the test |

New portal tests cover: five destinations and `aria-current`, 48 px targets, ticket/network isolation by congress, slow earlier congress not overwriting the current one, signed-out states sending no protected request, not-found and 500 states, Persian at 320 px without overflow, desktop top navigation, legacy deep links. A mutation removing the network event filter fails the isolation test. `scanner-offline` was not rerun (scanner code untouched; it needs the built preview).

## Limitations

- No public partner/booth directory endpoint exists, so My Congress shows only booths the attendee saved, with an honest explanation; a real directory needs T15.
- Network scan cannot know the badge's congress before sending; the backend stores the connection in the badge's congress and the page then tells the user.
- Signing in is still through the public congress page's reserve dialog (an existing pass gives the "already holds a pass" link into the portal). There is no standalone attendee login page.
- No profile editing; ticket categories (T19/T24) not shown.
- Not covered: canonical `scripts/check.*`, viewport matrix beyond 320/390/1280, accessibility audit, real devices.

## Commits

- `1b83e04eed233751231ee4fede1f5feefeed0464` — feat(api): add read-only access discovery endpoint (T10)
- `25cb863abdb0f628e42ca26262fcd8740d488671` — feat(web): add five-destination attendee portal with event-scoped network (T21/T23/T25)
- this report and screenshots — separate docs commit

## Run it locally

```
# backend (needs a PostgreSQL you are allowed to use)
cd backend && CONGRESS_PLATFORM_ADMIN_TOKEN=dev uv run uvicorn app.main:create_app_from_env --factory --port 8000
# frontend (proxies /api to :8000)
cd web && npm run dev
```

Open `/e/<congress-slug>`, sign in with an attendee account, then `/c/<congress-slug>` (or use "View My Pass", or "Open Congress Portal" on `/my-tickets`).

## Next visible milestone (recommendation)

**Attendee sign-in and partner discovery:** a standalone attendee sign-in that lands in the portal (instead of the reserve dialog), plus a real public partner/booth directory inside My Congress (T15 public directory part) and profile editing (T28 scope). These are the three gaps a first-time attendee hits immediately.

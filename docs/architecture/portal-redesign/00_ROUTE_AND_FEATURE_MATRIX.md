# Phase 00 — Route & Feature Matrix

Route → Component → API mapping, verified against `web/src/main.tsx`, `web/src/api/client.ts`, and `backend/app/routes/*.py`. Backend suite executed: `cd backend && uv run pytest -q` → **131 passed**. Web unit suite: `npm test` → **28 passed**.

## Frontend Routes

| Route | Component (lines) | User | Credential | Storage | Backend authorizer | APIs consumed | Tests |
|---|---|---|---|---|---|---|---|
| `/` | `pages/Home.tsx` (476) | Visitor | — | — | — | none (static) | release screenshots |
| `/organizer` | `pages/OrganizerLayout.tsx` (318) → `OrganizerEvents.tsx` (616) | Organizer | Master API key | sessionStorage `congress_organizer_api_key` | `current_organizer` (`auth.py:31`) | `GET/POST /api/events` | `test_events.py`, `test_organizers.py` |
| `/organizer/events/:eventId` | `OrganizerEventDetail.tsx` (1981; tabs: overview/tiers/points/booths/operators) | Organizer | API key | sessionStorage | `OwnedEventDep` (`events.py:63`) | `/api/events/{id}` PATCH; `/ticket-tiers` CRUD; `/checkin-points` CRUD + scanner tokens + device revoke; `/booths` CRUD + staff assign; `/desk/operators` list/add/revoke | `test_ticket_tiers.py`, `test_checkin.py`, `test_booths.py`, `test_desk_operator_auth.py`, `test_management_lifecycle.py` |
| `/organizer/events/:eventId/desk` | `OrganizerDesk.tsx` (771) | Reception operator / Organizer admin | Desk JWT **or** API key | sessionStorage `congress_desk_token_{eventId}` | `authorized_desk_operator` (`desk.py:152-229`) | `POST desk/login`, `GET desk/me`, `GET desk/tiers`, `POST desk-registrations`, `GET attendees` search, `GET attendees/{ticket_id}` | `test_desk_registration.py`, `test_desk_operator_auth.py` |
| `/organizer/events/:eventId/analytics` | `OrganizerAnalytics.tsx` (583) | Organizer | API key | sessionStorage | `OwnedEventDep` | `GET analytics/attendance`, `GET analytics/export-csv` | `test_analytics.py` |
| `/e/:slug` | `PublicEvent.tsx` (850; includes register/login modals) | Public / Attendee | Optional attendee JWT | localStorage `congress_attendee_token` | none (read) / `CurrentUserDep` (reserve) | `GET /api/public/events/{slug}`, `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/events/{slug}/tickets` | `test_public_event.py`, `test_tickets.py`, `test_auth.py` |
| `/e/:slug/booths/:boothId` | `PublicBooth.tsx` (266) | Public / Attendee | Optional attendee JWT | localStorage | `optional_user_id` (`public.py:41`) | `GET /api/public/events/{slug}/booths/{booth_id}`, `POST/DELETE /api/attendees/me/bookmarks/booths/{booth_id}` | `test_booth_bookmarks.py` |
| `/booth/:boothId` | `ExhibitorPortal.tsx` (1016) | Booth staff (partner) | Attendee JWT (shared) | localStorage | `authorized_booth_staff` (`leads.py:50-79`) | `GET /api/booths/{id}`, `POST /api/booths/{id}/leads/scan`, `GET/PATCH leads`, `GET leads/export-csv` | `test_leads.py`, `test_lead_qualification.py`, `test_csv_security.py` |
| `/my-tickets` | `MyTickets.tsx` (400) in `AttendeeLayout` | Attendee | Attendee JWT | localStorage + owner-scoped offline cache | `CurrentUserDep` (`routes/auth.py:56`) | `GET /api/attendees/me/tickets`, `GET/DELETE bookmarks/booths` | `test_tickets.py`, `tests/ticketCache.test.ts` |
| `/my-network` | `MyNetwork.tsx` (540) in `AttendeeLayout` | Attendee | Attendee JWT | localStorage | `CurrentUserDep` | `POST network/scan`, `GET network`, `PATCH network/{id}/notes`, `GET/PATCH network/privacy`, vCard export | `test_networking.py` |
| `/scan/:pointId` | `GateScanner.tsx` (1409) | Scanner device / Organizer | Scanner JWT (per-device) **or** API key | `scannerTokenStore.ts` | `authorized_checkin_point` (`checkin.py:225-317`) | `GET checkin-points/{id}/manifest`, `POST scans/batch`, `POST .../token` (organizer), device revoke | `test_scanner_security.py`, `test_scanner_revocation_matrix.py`, `test_concurrency.py`, `tests/scannerEngine.test.ts` |

## Backend API Surface (by router → auth dependency)

| Router file | Prefix | Endpoints | Authorizer |
|---|---|---|---|
| `routes/organizers.py` | `/api/organizers` | `POST /` (provision) | `require_platform_admin` (env token) |
| `routes/auth.py` | `/api/auth` | `POST /register`, `POST /login`, `GET /me` | public / `CurrentUserDep` |
| `routes/events.py` | `/api/events` | `POST ""`, `GET ""`, `GET/PATCH /{event_id}` | `OrganizerDep` / `OwnedEventDep` |
| `routes/ticket_tiers.py` | `/api/events/{event_id}/ticket-tiers` | `POST ""`, `GET ""`, `PATCH /{tier_id}` | `OwnedEventDep` |
| `routes/tickets.py` | mixed | `POST /api/events/{slug}/tickets` (reserve), `GET /api/attendees/me/tickets` | `CurrentUserDep` |
| `routes/desk.py` | `/api/events/{event_id}` | `POST /desk/login`, `GET /desk/me`, `GET /desk/tiers`, `GET/POST /desk/operators`, `POST+DELETE /desk/operators/{id}/revoke`, `POST /desk-registrations`, `GET /attendees`, `GET /attendees/{ticket_id}` | `AuthorizedDeskDep` (desk JWT or organizer key); operator management = `OwnedEventDep` only |
| `routes/checkin.py` | mixed | `/api/events/{id}/checkin-points` CRUD (`OwnedEventDep`); `POST /api/checkin-points/{id}/token`, `GET .../devices`, device revoke (`OwnedEventDep`); `GET /manifest`, `POST /scans/batch`, self-revoke (`AuthorizedCheckInPointDep`) | per endpoint |
| `routes/analytics.py` | `/api/events/{event_id}/analytics` | `GET /attendance`, `GET /export-csv` | `OwnedEventDep` |
| `routes/booths.py` | mixed | `POST/GET /api/events/{id}/booths`, staff assign/list (`OwnedEventDep`); `GET /api/booths/{booth_id}` (staff); `POST/GET/DELETE /api/attendees/me/bookmarks/booths[/{id}]` (`CurrentUserDep`) | per endpoint |
| `routes/leads.py` | `/api/booths/{booth_id}/leads` | `POST /scan`, `PATCH /{lead_id}`, `GET ""`, `GET /export-csv` | `AuthorizedBoothDep` |
| `routes/network.py` | `/api/attendees/me/network` | `POST /scan`, `GET ""`, `GET/PATCH /privacy`, `PATCH /{id}/notes`, `GET /{id}/vcard` | `CurrentUserDep` |
| `routes/public.py` | `/api/public/events` | `GET /{slug}`, `GET /{slug}/booths/{booth_id}` | none (optional user) |

## Token Types

| Token | Claims | Issued at | Revocation |
|---|---|---|---|
| User JWT (HS256) | `sub`, `email`, `exp` | `auth/register`, `auth/login` | none (stateless) |
| Desk-operator JWT | `type=desk_operator`, `operator_id`, `event_id`, `user_id` | `desk/login` | `DeskOperator.is_revoked` checked per request |
| Scanner JWT | `type=scanner`, `point_id`, `event_id`, `jti`=device UUID | `checkin-points/{id}/token` (organizer) | `ScannerDevice.is_revoked` checked per request |
| Organizer API key | n/a (opaque, SHA-256 hashed) | `POST /api/organizers` (platform admin) | none found |
| Platform admin token | n/a (env var, `X-Admin-Token`) | deployment config | env change |

## Feature Inventory → Reuse Map

| Feature | Frontend | Backend | Reuse target in redesign |
|---|---|---|---|
| Ticket reservation + QR | PublicEvent modal, MyTickets QR | `tickets.py` | Attendee "My Ticket" tab |
| Offline pass cache | `ticketCache.ts` | — | "My Ticket" tab |
| Networking + privacy + vCard | MyNetwork | `network.py` | "My Network" tab (unchanged) |
| Booth bookmarks | PublicBooth, MyTickets | `booths.py` bookmark routes | "My Congress" partners listing |
| Public event/booth content | PublicEvent, PublicBooth | `public.py` | "Congress Details" tab + CR-09 |
| Profile data | — (read-only `/me`) | `auth.py` | "My Profile" tab (needs edit endpoints) |
| Desk registration + attribution | OrganizerDesk | `desk.py` | Reception portal |
| Lead capture/qualify/export | ExhibitorPortal | `leads.py` | Partner portal |
| Gate scanning + offline sync | GateScanner + scanner lib | `checkin.py` | Preserve as-is (R-6) |
| Event config (tiers/points/booths/operators) | OrganizerEventDetail | events/ticket_tiers/checkin/booths/desk routers | Admin portal |
| Analytics + CSV | OrganizerAnalytics | `analytics.py` | Admin portal |

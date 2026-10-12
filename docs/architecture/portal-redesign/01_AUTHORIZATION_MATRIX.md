# 01 — Authorization Matrix & Negative Security Specification

**Status:** RECOMMENDED design. "Backend enforcement" entries cite verified current code unless marked **[NEW]**.

## 1. Permission Matrix

Roles: ORG = Organizer (tenant API key) · PADM = Platform Admin (env token) · ATT = Attendee (user JWT) · REC = Reception operator (desk JWT, event-scoped) · PAR = Partner representative (user JWT + staff row) · PUB = unauthenticated.

| # | Permission | ORG | PADM | ATT | REC | PAR | PUB | Backend enforcement (evidence) |
|---|---|---|---|---|---|---|---|---|
| 1 | View public event | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW | `public.py:57` no auth |
| 2 | Edit event details | ALLOW (own) | DENY | DENY | DENY | DENY | DENY | `OwnedEventDep` (`events.py:63`), 404 tenant mask |
| 3 | Manage attendees (list/search/detail) | ALLOW (own event) | DENY | DENY | ALLOW (own event) | DENY | DENY | `desk.py:584,652` via `AuthorizedDeskDep` |
| 4 | Create attendee types | ALLOW (own event) | DENY | DENY | DENY | DENY | DENY | **[NEW]** `OwnedEventDep` |
| 5 | Assign attendee types | ALLOW | DENY | CONDITIONAL (self at registration, active types only) | ALLOW (desk registration) | DENY | DENY | **[NEW]** ticket write paths |
| 6 | Manage ticket tiers | ALLOW (own event) | DENY | DENY | DENY | DENY | DENY | `ticket_tiers.py` `OwnedEventDep` |
| 7 | Register self | ALLOW (n/a) | DENY | ALLOW | n/a | n/a | CONDITIONAL (register+reserve in one flow) | `tickets.py:52` `CurrentUserDep` |
| 8 | Register another attendee | ALLOW | DENY | DENY | ALLOW (own event) | DENY | DENY | `desk.py:469` `AuthorizedDeskDep` |
| 9 | Search attendee records | ALLOW (own event) | DENY | DENY | ALLOW (own event) | DENY | DENY | `desk.py:584` `AuthorizedDeskDep` |
| 10 | Issue tickets | ALLOW | DENY | CONDITIONAL (self-reserve) | ALLOW (own event, attributed) | DENY | DENY | `desk.py:469`, `tickets.py:52` |
| 11 | View another user's ticket | ALLOW (own event, via desk detail) | DENY | DENY (own only) | ALLOW (own event) | CONDITIONAL (badge-scan resolves contact card only, `leads.py:82`) | DENY | `desk.py:652`; `tickets.py:146` user-scoped |
| 12 | Manage reception operators | ALLOW (own event) | DENY | DENY | **DENY** | DENY | DENY | `desk.py:328-427` `OwnedEventDep` — desk JWT cannot manage operators |
| 13 | Revoke reception operators | ALLOW (own event) | DENY | DENY | DENY | DENY | DENY | `desk.py:430-462` `OwnedEventDep` |
| 14 | Manage partner organizations | ALLOW (own event) | DENY | DENY | DENY | CONDITIONAL (own profile only **[NEW]**) | DENY | `booths.py:78-128` `OwnedEventDep` |
| 15 | Assign partner representatives | ALLOW (own event) | DENY | DENY | DENY | DENY | DENY | `booths.py:162` `OwnedEventDep` |
| 16 | View partner leads | DENY (tenant isolation by design) | DENY | DENY | DENY | ALLOW (own booth only) | DENY | `leads.py:50-79` booth-staff row + 403 |
| 17 | Modify partner leads | DENY | DENY | DENY | DENY | ALLOW (own booth) | DENY | `leads.py:194` `AuthorizedBoothDep` |
| 18 | Export partner leads CSV | DENY | DENY | DENY | DENY | ALLOW (own booth, sanitized) | DENY | `leads.py:299` + `sanitize_csv_cell` |
| 19 | Configure admission policies | ALLOW (own event) | DENY | DENY | DENY | DENY | DENY | `checkin.py:165` `OwnedEventDep` |
| 20 | Operate check-in | ALLOW (key fallback) | DENY | DENY | CONDITIONAL (only if also scanner device — no) | DENY | DENY (device JWT only) | `authorized_checkin_point` `checkin.py:225-317` |
| 21 | View event analytics | ALLOW (own event) | DENY | DENY | DENY | DENY | DENY | `analytics.py:58,197` `OwnedEventDep` |
| 22 | Access cross-event resources | DENY | DENY | DENY | DENY | DENY | DENY | per-resource event binding in every dep |
| 23 | Manage role assignments (general) | ALLOW (booth staff, desk ops, own event) | DENY | DENY | DENY | DENY | DENY | `booths.py:162`, `desk.py:356` |
| 24 | Provision organizers | DENY | ALLOW | DENY | DENY | DENY | DENY | `organizers.py:26` `require_platform_admin` |
| 25 | Mint/revoke scanner devices | ALLOW (own points) | DENY | DENY | DENY | DENY | DENY | `checkin.py:319-487` `OwnedEventDep`; self-revoke by device |

No ambiguous grants. CONDITIONAL entries carry their condition in-cell.

## 2. Ownership Check Inventory (verified)

| Guard | File | Guarantee |
|---|---|---|
| `require_platform_admin` | `auth.py:23` | constant-time admin token for organizer provisioning |
| `current_organizer` / `OrganizerDep` | `auth.py:31` | tenant identity by hashed API key |
| `OwnedEventDep` | `events.py:63` | event belongs to tenant; 404-masks foreign tenants |
| `CurrentUserDep` | `routes/auth.py:56` | valid user JWT → User row |
| `AuthorizedDeskDep` | `desk.py:152-229` | desk JWT: event-bound, operator row, revocation per request; organizer-key fallback flagged `is_organizer_admin` |
| `AuthorizedBoothDep` | `leads.py:50-79` | BoothStaff row for booth; 403 cross-booth |
| `AuthorizedCheckInPointDep` | `checkin.py:225-317` | scanner JWT point+event bound, jti device revocation, `last_seen_at`; organizer-key fallback with tenant check |

Disposition: **remain unchanged** — all seven. **Reused** — `OwnedEventDep` for new AttendeeType and Partner admin routes; `CurrentUserDep` + booth-staff pattern for partner portal. **Generalized carefully** — booth-staff authorizer may later accept partner-level staff (D06 Option C keeps booth-level). **Deprecated** — none.

## 3. Negative Security Scenarios (Given/When/Then — backend-targeted)

1. **Attendee invokes Organizer API** — Given attendee JWT, When `PATCH /api/events/{id}`, Then 401 (key lookup fails → `auth.py:42`).
2. **Reception edits event settings** — Given desk JWT, When `PATCH /api/events/{id}`, Then 401 (not an organizer key; desk type not accepted by `current_organizer`).
3. **Reception self-grants permissions** — Given desk JWT, When `POST /api/events/{id}/desk/operators`, Then 401 (`OwnedEventDep` requires organizer key; desk JWT fails key hash lookup).
4. **Revoked operator reuses old credential** — Given revoked DeskOperator, When any desk endpoint, Then 401 "access has been revoked" (`desk.py:196-201`; tested in `test_desk_operator_auth.py`).
5. **Organizer A → Organizer B's event** — Given A's key, When `GET /api/events/{B's id}`, Then 404 (tenant masking, `events.py:63`; tested in `test_events.py`/`test_ticket_tiers.py`).
6. **Partner A → Partner B's leads** — Given A-staff JWT, When `GET /api/booths/{B}/leads`, Then 403 (`leads.py:50-79`; tested in `test_leads.py`).
7. **Partner rep swaps resource ID in request** — Given valid JWT, When `PATCH /api/booths/{other_booth}/leads/{lead_id}`, Then 403 before any data access (authorizer runs on path booth_id first).
8. **Attendee accesses another's ticket** — Given user JWT, When `GET /api/attendees/me/tickets`, Then only own rows (user-scoped query `tickets.py:146`); desk detail endpoint rejects attendee JWT with 401.
9. **Event switch without membership** — Given user with roles only in Event A, When desk login for Event B, Then 403 "not registered as a front desk operator" (`desk.py:261-265`).
10. **Multi-role user loses one role** — Given ATT+REC, When organizer revokes REC, Then desk endpoints 401 while attendee endpoints keep working (S8; tested by revocation tests + ticket tests).
11. **Browser attaches unrelated credential** — Given stale organizer key attached to attendee endpoint (current heuristic bug), When `GET /api/attendees/me/tickets`, Then 401 (key is not a user JWT) — fail-closed today; **[NEW]** explicit-context contract prevents the misattachment itself.
12. **Scanner credential at human portal** — Given scanner JWT, When `GET /api/attendees/me/tickets`, Then 401 (`sub` = `scanner:{point}`, no user row); when desk endpoints, 401 (type ≠ desk_operator).
13. **Logged-out user hits protected deep link** — Given no token, When any protected endpoint, Then 401 with `WWW-Authenticate`; frontend routes to portal login (no data rendered).
14. **Expired session keeps calling APIs** — Given expired JWT, When any endpoint, Then 401 (`decode_access_token` returns None); frontend drops that portal credential only.

All fourteen resolve server-side; none depend on hidden UI controls.

# 0016: Organizer Members, Roles and the Audit Log

## Context
An organizer reached its console with one shared API key. Everyone who helped run a congress (the organizer's
own staff, an agency, reception leads) used the same key, so there was no way to give someone less than full
access, to take access away from one person without rotating the key for everyone, or to tell afterwards who
changed a tier, cancelled a ticket or downloaded the participant list. Key rotation also left every scanner
and desk session handed out with the old key working, so it did not fully recover a leaked key.

## Decision
1. **Organizer members** (`organizer_members`, migration `0029`): a User (by mobile number) who belongs to one
   organizer with a role. The platform admin adds the first member, normally the owner
   (`POST /api/organizers/{id}/members` with the platform admin token; listed by the matching GET). Owners then
   invite the rest in the console (`/organizer/members`). An invitation queues an SMS with the console address
   through the outbox, worded by the platform template `member_invite` (`{link}` required; editable in `/platform`). A person may belong to several organizers.
2. **Sign-in by SMS code**, like everyone else on the platform (ADR 0012), with OTP purpose `organizer`. Codes go only to
   numbers of active members of active organizers. `POST /api/organizer/login` answers with a session, or,
   for a member of several organizers, a ten-minute selection token for `POST /api/organizer/session`, which
   works once (like the signup token). Codes have their own per-number budget (separate from sign-in and desk codes).
   The session is a 12-hour JWT (`type: organizer_member`) carrying the member's `session_version`. Signing
   out, a role change, removal and account deletion increment it, so every copy of the session stops working at once.
   The console stores the session in the same tab-scoped slot as an API key, so every organizer page works
   with either credential unchanged.
3. **Four roles, one table** (`backend/app/roles.py`): viewer < staff < manager < owner.
   - viewer: reads the setup and the aggregate analytics; no personal data.
   - staff: reception (desk), scanner pairing and scanning, participant lookup.
   - manager: changes the setup, manages participants and desk operators, downloads exports, reads the activity log.
   - owner: everything, including members.
   Every route that accepts an organizer credential is listed by method and route template. `app.auth`
   checks the table in the shared dependency (`organizer_principal`, and the organizer branch of the desk
   and check-in dependencies), so no route can forget its check. A refusal is `403 ROLE_FORBIDDEN`, documented
   in the OpenAPI schema. A route missing from the table needs the owner role, and `tests/test_roles.py`
   fails until every organizer route is listed and no entry is stale. The API key acts as the owner.
   Desk operators and scanner devices keep their own, narrower sessions and are not governed by the table.
4. **The last owner** cannot be removed or demoted (`409 LAST_OWNER`); add another owner first.
5. **Key rotation ends every session issued before it**: scanner, desk and member tokens whose `iat` is before
   `key_rotated_at` are refused. Tokens carry whole seconds, so one issued in the rotation's own second is kept.
   Revocation already refused them while the organizer was revoked; now they also stay refused after the
   rotation that reinstates it. Scanners pair again, operators and members sign in again.
6. **Audit log** (`audit_events`, migration `0028`): `at`, actor (type, id, label), organizer, event, action,
   entity, `summary` (JSON), client address and request id (the `X-Request-ID` of the request).
   - Routes write explicit rows for actions they understand best, in the same transaction as the change:
     `organizer.provisioned`, `organizer.key_rotated`, `organizer.revoked`, `member.invited`,
     `member.role_changed`, `member.renamed`, `member.revoked`, `member.signed_in`, `member.signed_out`.
   - `AuditMiddleware` writes one row for every other successful (2xx) POST/PUT/PATCH/DELETE made with an
     organizer key, a member session, a desk session or the platform admin token (`http.<method>`), and for
     every export download (`export.download`). It records the route template and status only, never the path,
     query or body. Scanner scans are not recorded there: they are their own log (`checkins`); neither is the
     replay of an idempotent request (`Idempotent-Replayed: true`, e.g. a retried desk walk-in).
   - A booth representative's lead export (`GET /api/booths/{booth_id}/leads/export-csv`) is written by the route
     itself (`export.download`, actor `booth_staff`, with `include_deleted` and the row count), into the
     congress organizer's log: it carries attendees' data out of the platform. Capturing and editing leads is
     the exhibitor's own work and is not recorded.
   - Append-only: no route updates or deletes a row, and a trigger refuses UPDATE and DELETE. There are no foreign keys,
     so a row outlives what it names. Mobile numbers in summaries are masked (`0912***4567`), and keys, codes and
     tokens never reach it.
   - Managers and owners read it as **Activity** (`GET /api/organizer/activity`, `/organizer/activity` in the
     console), newest first, filterable by congress, paged with an `(at, id)` cursor so rows of one
     transaction are never skipped. What the platform admin did to the organizer is part of it.

## Consequences
- Existing organizers keep working with their API key exactly as before; members are opt-in.
- The console hides only what a role could never use (members and activity below manager); the server stays
  the authority, and other refusals are shown in the reader's language from `ROLE_FORBIDDEN`.
- A new organizer route must be added to `ROUTE_ROLES`, or the test suite fails.
- Rotating the key now interrupts paired scanners and signed-in desk operators: rotate before the gates open, or
  re-pair afterwards.
- The audit log grows with every change; it has no retention policy yet (rows are small, and changes, not
  scans, are recorded). TRUNCATE by a database operator is outside what the trigger prevents. Since FIX-2 an
  operator can purge entries older than `CONGRESS_AUDIT_RETENTION_DAYS` with `python -m app.retention
  purge-audit` (unset by default: nothing is purged; see `docs/deployment/STAGING_OPERATIONS.md`, Data
  retention). Entries keep the actor's name (`actor_label`) even after that person deletes their account,
  until such a purge removes them.
- Persian copy of the console for members, roles and activity is in `web/src/lib/organizerConsole.ts`; error codes
  are in `web/src/lib/errorMessages.ts`.

# 0017: Ticket Lifecycle and the Participant's Registration Snapshot

**Status:** Accepted (2026-10-23). Implemented by the participants workstream (B3, migration `0023`).

## Context
A ticket was created `active` and stayed so: nothing could cancel, reissue or transfer it, and an organizer who
wanted to correct a participant's name had to edit the person's User account, which every congress on the platform
shares (ADR 0012: one account per mobile number). A spelling fix for one congress would silently change the name on
another congress's badges and exports. Client issue 2 asked for participant details that the organizer can edit and
delete. Short links (ADR 0015) and pass QRs also needed a single, reliable way to stop working when a ticket does.

## Decision
1. **Registration snapshot on the ticket.** Each ticket keeps its own copy of the attendee's name, organization and
   title (`tickets.attendee_full_name`, `attendee_organization`, `attendee_title`), taken from the account when the
   ticket is created (`attendee_snapshot`) and backfilled for existing tickets. That copy is what the congress shows,
   prints and exports, and what its organizer edits (`PATCH /api/events/{event_id}/participants/{ticket_id}`); the
   account is never changed by it. The mobile number stays on the account.
2. **Two states, constrained:** `tickets.status IN ('active', 'cancelled')` (`ck_tickets_status`) with
   `cancelled_at`, `cancelled_reason`, `cancelled_by` (`organizer`, `attendee`, `account_deleted`) and `reissued_at`.
   One person holds at most one ticket row per congress (`uq_tickets_event_user`); registering again after a
   cancellation reactivates that row with a new pass.
3. **One module owns the lifecycle** (`backend/app/ticket_lifecycle.py`):
   - `cancel_ticket`: a conditional `UPDATE … WHERE status = 'active'`, so two concurrent cancellations release the
     tier's place once; the place returns to the tier in the same transaction.
   - `reissue_ticket`: a lost or leaked pass gets a new QR secret and a new short link; the old ones stop working.
   - `transfer_ticket`: the original ticket is **cancelled** (reason `transferred`) rather than rebound, so its
     check-ins and leads keep pointing at the person who attended; the place moves to the new holder in the same
     transaction without passing through the open quota.
   - `reactivate_ticket`: a cancelled ticket becomes active again in a tier with a new pass.
   - Every change that makes a pass stop working goes through `ticket_invalidated`, which deactivates the QR and
     revokes the ticket's short links (ADR 0015). Scanners refuse the old QR from the next online scan, offline
     scanners after their next manifest delta (ADR 0009).
   - Holders are told by SMS through the outbox (`ticket_cancelled`, `ticket_reissued`, `ticket_confirmation` for a
     transfer's new holder), each optional per action (`notify`).
4. **Organizer Participants page** (`/organizer/events/:eventId/participants`, `backend/app/routes/participants.py`):
   list and search, edit the snapshot, cancel, reissue, transfer (to a mobile number; a new number needs the name),
   CSV export, and delete. Delete is for registrations made by mistake only: a ticket with check-ins or leads is part
   of the congress's history and answers `409 PARTICIPANT_HAS_HISTORY` (cancel it instead). Viewing needs the staff
   role, every change and the export need manager (ADR 0016).
5. **Attendee self-service** (`backend/app/routes/tickets.py`, `auth.py`, `app/account.py`): cancel one's own ticket
   until the congress starts (`POST /api/attendees/me/tickets/{ticket_id}/cancel`), edit the profile, export one's data
   (`GET /api/auth/me/export`) and delete the account (`DELETE /api/auth/me`). Deletion anonymises the User row rather
   than removing it (check-in statistics must still add up): name replaced, organization, title and mobile cleared on
   the account and on every snapshot, tickets of congresses that have not ended cancelled, own connections and bookmarks
   deleted, leads about the person kept without identifying fields, staff and operator access revoked, pending SMS not
   sent.
6. **Exhibitor contact consent** lives on the account (`users.share_contact_with_exhibitors`, default off; ADR 0011).

## Consequences
- A correction for one congress never leaks into another; the price is that a person who changes their profile does
  not automatically update registrations already made (the organizer edits the snapshot when it matters).
- Migration `0023` is a contract step (backfill then NOT NULL, a new CHECK): an image from before it cannot run on the
  new schema, so it is not rollback-compatible (`docs/deployment/STAGING_OPERATIONS.md` → *Releases and rollback*).
- `sms_messages` allows one automatic confirmation per ticket; lifecycle notices are written without `ticket_id`
  because a ticket can be reissued or reactivated several times.
- A transfer leaves two rows (the cancelled original and the new holder's ticket), which is what attendance history
  needs.
- Desk-side editing, cancel, reissue and transfer (client issue 2 at the desk) are in the unmerged `ws/c2-desk` branch;
  until it lands, the desk prints or resends the existing pass and a manager reissues from the Participants page.

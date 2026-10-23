# 0018: Database Integrity Rules Enforced by PostgreSQL

**Status:** Accepted (2026-10-23). Implemented by the integrity workstream (B2, migration `0021`).

## Context
Most invariants lived only in route code: a tier's `reserved_count` between 0 and its quota, a ticket whose tier
belongs to the same event, a lead whose booth and ticket belong to the same congress, valid policy and status values.
Foreign keys used the default NO ACTION, so deleting an event failed or succeeded depending on what happened to exist.
Concurrent requests could race past "does it exist?" checks (two inserts of the same booth staff, lead or operator), a
desk walk-in retried after a network error could register the same person twice, and one slow statement could hold a
pooled connection for ever. These are the failures a busy congress morning produces.

## Decision
1. **What code already enforced, PostgreSQL enforces too** (migration `0021`, `backend/app/models.py` declares the same):
   - CHECK constraints: `0 <= reserved_count <= quota` on tiers; check-in point and check-in `policy_type`; check-in
     `status` (ADMITTED/REJECTED); `max_capacity > 0` or NULL; lead `rating` (HOT/WARM/COLD). `tickets.status` is
     constrained by migration `0023` (ADR 0017); session `ends_at >= starts_at` by the program tables.
   - **Same-event composite foreign keys:** tiers, booths and tickets get a unique `(id, event_id)`; tickets reference
     `(ticket_tier_id, event_id)` and leads (with a new, backfilled, NOT NULL `leads.event_id`) reference the booth and
     the ticket by `(id, event_id)`. A ticket can no longer point at another event's tier, nor a lead mix congresses.
   - **Explicit delete rules:** attendance and registration data is RESTRICT (tickets, the tier a ticket holds, a lead's
     booth and ticket, connections); pure configuration CASCADEs with its event (tiers, check-in points and their scanner
     devices, booths with staff and bookmarks, desk operators). An event can be deleted only while it has no tickets.
     Polymorphic `entity_qrs` rows have no foreign key and are removed by the code that deletes their owner.
   - **Indexes** for the hot paths: `checkins (checkin_point_id, status)`, `entity_qrs (entity_type, entity_id)`,
     `tickets (event_id, status)`.
2. **No silent repair.** Before adding a rule, the migration looks for existing rows that break it; if any exist it
   stops with a message naming the table and up to five offending ids, and the data is corrected by hand (the right fix
   depends on what the organizer meant). The upgrade runs in one transaction, so a stop leaves the schema unchanged.
3. **Race-safe inserts:** `add_or_existing` (`backend/app/db.py`) inserts in a savepoint and, when a unique constraint
   says a concurrent request won, returns that row instead of failing; used for the "add if absent" writes of booth
   staff and desk operators (and the accounts created for them), leads and booth bookmarks.
4. **Idempotent walk-ins:** a desk registration may carry an `Idempotency-Key` header (1–128 characters). The key is
   claimed in `desk_idempotency_keys`, scoped to the event and the desk actor, for 24 hours. A retry with the same key
   and body returns the ticket the first attempt created (`Idempotent-Replayed: true`); the same key with a different
   body answers `409 IDEMPOTENCY_KEY_REUSED`, and a key whose first request is still running `409
   IDEMPOTENCY_KEY_IN_PROGRESS` (`backend/app/routes/desk.py`).
5. **Bounded database use per API process** (`backend/app/config.py`, `db.py`): a pool of `CONGRESS_DB_POOL_SIZE`
   (10) plus `CONGRESS_DB_MAX_OVERFLOW` (10) connections, a request waits at most `CONGRESS_DB_POOL_TIMEOUT_SECONDS`
   (10) for one instead of queueing for ever, connections are pinged before use, and PostgreSQL cancels any API statement
   running longer than `CONGRESS_DB_STATEMENT_TIMEOUT_MS` (15,000).
6. **Models and migrations cannot drift:** `backend/tests/test_migrations.py` compares the models with the migrated
   schema (alembic autogenerate) and runs the migrations down and up again (`docs/CODING_STANDARDS.md` §4.A).

## Consequences
- A bug or a hand-written SQL fix can no longer create cross-congress rows or negative inventory; it fails loudly with
  an integrity error instead.
- Migration `0021` is a contract step (`leads.event_id` NOT NULL is written by the new code only), so it is not
  rollback-compatible, and it can stop an upgrade on old bad data. Rehearse upgrades on a copy of production first
  (`docs/deployment/STAGING_OPERATIONS.md` → *Upgrade dry run*).
- Deleting an event with registrations is refused by the database, not only by the route; archiving (migration `0024`)
  is the way to retire such an event.
- `(pool size + overflow) × API processes` must stay below PostgreSQL's `max_connections` if processes are ever added.
- Long reports must stream or aggregate in SQL (ADR 0020) rather than run statements longer than the timeout.

# 0021: Encrypted Backups, Point-in-Time Recovery and Schema-Guard Rollback

**Status:** Accepted (2026-10-23). Implemented by the operations workstream (A3): `scripts/staging/stack.mjs`,
`backend/app/schema_guard.py`, `deploy/db/Dockerfile`, `deploy/staging/compose.wal.yaml`, `deploy/hosted/systemd/*`.

## Context
A congress produces its most valuable data in a few hours (registrations, desk walk-ins, every gate scan), on one
server run by a small team, in a country where cloud services and Telegram may be blocked. Nightly `pg_dump` copies were
uploaded to an S3-compatible bucket as plain files, so whoever held the bucket held every attendee's mobile number; a
day of data could be lost; nothing told an operator when a backup failed; and a bad release could only be undone with a
lossy `alembic downgrade` or a restore. The team needs recovery it can rehearse, alerts it will see, and a way back from
a bad deploy that never touches data.

## Decision
1. **One operator tool, one Compose stack.** `node scripts/staging/stack.mjs` drives everything (`up`, `check`,
   `backup`, `scheduled-backup`, `restore-verify`, `base-backup`, `pitr-restore`, `releases`, `rollback`,
   `install-timers`, `event-mode`); operators do not hand-run `pg_dump` or migrations
   (`docs/deployment/STAGING_OPERATIONS.md`).
2. **Logical backups, encrypted before they leave the host.** `scheduled-backup` takes `pg_dump -Fc`, the media
   directory and a manifest (Alembic revision, row counts, published slugs, SHA-256 of every file and image; a backup
   missing a referenced image fails). The off-host copy goes through an rclone `crypt` remote keyed by
   `BACKUP_ENCRYPTION_KEY` (at least 32 characters; there is no unencrypted mode) and is proven with
   `rclone cryptcheck`. Retention keeps 7 newest, the newest of each of the last 7 days, 4 weekly and 6 monthly, remotely
   then locally. A timer runs it nightly at 02:30, hourly in **event mode**.
3. **Point-in-time recovery (optional, `BACKUP_WAL=on`).** The `db` image adds pgBackRest; every WAL segment is archived,
   encrypted (aes-256-cbc, same key), to the same bucket at least every 60 s (`archive_timeout`), with full base backups
   weekly and differentials daily. Database RPO is about one minute (8.6 s observed); media come from the newest
   logical backup. When the bucket is unreachable, at most 1 GiB of WAL is queued before segments are dropped (reported)
   rather than filling the disk.
4. **Recovery is rehearsed, never assumed.** `restore-verify <backup> [--from-offsite]` restores into a disposable
   project with no published ports, runs the normal migrate → API path and compares every count, image checksum and
   published page; `pitr-restore --to <time|latest>` does the same for WAL. Real restores are manual, documented
   procedures that move the old data aside instead of deleting it.
5. **Health and alerts.** `check` (every 5 min by timer; exit 0/1/2) looks at containers, `/api/ready`, 5xx and API error
   lines, disk, backup age (26 h, 2 h in event mode), WAL archiving and base-backup age, and sends deduplicated Telegram
   messages itself, with reminders and a recovery message; `ALERT_TELEGRAM_API` can point at a relay.
6. **Releases and image rollback, never a downgrade.** Every `up` tags the API and web images with the commit and keeps
   the last 5 releases. `rollback [<sha>]` re-points the services at older images and restarts `api` and `web` without
   migrating. The older API starts only if the **schema guard** accepts the database: the migrate service
   (`python -m app.schema_guard migrate`) records every revision with its parent and `backward_compatible` flag in
   `schema_compatibility`, and at startup an API whose own head is older walks that chain and accepts only revisions
   marked `backward_compatible = True`; otherwise it refuses, and `rollback` restarts the images that ran before.
7. **Migrations follow expand/contract** (`docs/CODING_STANDARDS.md` §2.D): additions are marked
   `backward_compatible = True`; drops, renames, NOT NULL tightening and type changes come in a later, unmarked migration.
   An unmarked migration means the way back is a restore or PITR, and the release notes say so.
8. **Observability for the incident itself:** JSON logs with `X-Request-ID` on every response, Prometheus `/api/metrics`
   behind a bearer token and an edge allow-list, optional Sentry with personal data scrubbed.

## Consequences
- Losing `BACKUP_ENCRYPTION_KEY` makes every off-host copy and the WAL archive unreadable; it must be kept off the
  server. Changing it needs a new `BACKUP_S3_PREFIX`.
- A bad release whose migrations are all marked is undone in about a minute without data loss; one with unmarked
  migrations (`0019`, `0020`, `0023`, `0021` and `0022` on this line) needs the pre-upgrade backup or PITR, so upgrades
  are rehearsed on a copy of production first (`STAGING_OPERATIONS.md` → *Upgrade dry run*).
- Every upgrade runs all pending migrations in one transaction, so a failed upgrade leaves the schema unchanged.
- Systemd timers, a real S3 provider, ACME, Sentry and Telegram delivery from Iran were drilled only locally or with
  stand-ins; they must be proven on the real server before a congress.
- Event mode, `check` and the timers assume a Linux host with systemd; Docker Desktop staging runs the commands by hand.

# 08 — Database Backup, Restoration Drill & Disaster Recovery

**Last updated:** 2026-10-23 (operations hardening `ws/a3-ops`; upgrade rehearsal and table list for head `0029`)  
**Scope:** PostgreSQL 16 database and the media directory of one deployment  
**Operator reference:** [`docs/deployment/STAGING_OPERATIONS.md`](../deployment/STAGING_OPERATIONS.md) (*Backup and restore*, *Point-in-time recovery*, *Before congress day*)

---

## 1. Summary

Two independent layers protect the data:

| Layer | Command / unit | What it captures | Where it goes |
|---|---|---|---|
| Logical backup | `stack.mjs scheduled-backup` (`congress-backup.timer`: nightly 02:30, hourly in event mode) | `pg_dump -Fc` of the whole database, the media directory, a manifest with row counts and SHA-256 of every file | `.staging/backups/` and, encrypted (rclone `crypt`), the S3-compatible bucket |
| Continuous WAL archive (optional, `BACKUP_WAL=on`) | pgBackRest in the `db` container; `stack.mjs base-backup` (`congress-basebackup.timer`: daily 03:15) | Every WAL segment plus base backups (full weekly, differential otherwise) | The same bucket under `<prefix>/pgbackrest`, encrypted (aes-256-cbc) |

Both use one key, `BACKUP_ENCRYPTION_KEY`, which must also be kept off the server: without it no off-host copy can be restored.

The database has **31 tables** in the `public` schema (head `0029`): the 29 application tables in `backend/app/models.py` (`organizers`, `events`, `event_pages`, `media_assets`, `ticket_tiers`, `users`, `desk_operators`, `tickets`, `desk_idempotency_keys`, `short_links`, `entity_qrs`, `checkin_points`, `checkins`, `scanner_devices`, `booths`, `booth_staff`, `connections`, `booth_bookmarks`, `leads`, `venue_places`, `event_sessions`, `program_files`, `otp_challenges`, `sms_messages`, `sms_templates`, `platform_settings`, `rate_limit_counters`, `audit_events`, `organizer_members`), plus `alembic_version` and `schema_compatibility` (the revision chain the schema guard reads for rollback). `pg_dump` and pgBackRest capture all of them; there is no per-table selection. `rate_limit_counters` holds only short-lived throttling counts; restoring an older copy of it is harmless. Program files (PDF/image) live in the media directory like Page Studio images, so they are in `media.tar.gz`, not in WAL.

---

## 2. Recovery objectives

| Objective | Nightly dumps only | Event mode (hourly dumps) | With `BACKUP_WAL=on` |
|---|---|---|---|
| **RPO, database** | up to ~24 h | up to ~1 h | **≈ 1 min worst case** (`archive_timeout` 60 s + upload); **8.6 s observed** |
| **RPO, media files** | last scheduled backup | last scheduled backup | last scheduled backup (media are not in WAL) |
| **Recovery window** | 7 daily, 4 weekly, 6 monthly backups | same | any moment since the oldest of the `BACKUP_WAL_RETENTION_FULL` (2) full base backups |

- **RTO:** not measured at production size. A real recovery is: provision (if the host is lost) + build or load images + fetch and decrypt the backup + `pg_restore` / pgBackRest replay + start. Time a `restore-verify --from-offsite` of a real-size backup before the congress and record it here.
- **Offline scanner safety margin:** during a database outage, scanner stations keep recording scans in their local queue (ADR 0009) and upload them when the server is back. Scans taken after the restore point but already uploaded before the outage are lost with the database, unless the station still holds them.
- If the bucket is unreachable for long, pgBackRest keeps up to `BACKUP_WAL_QUEUE_MAX` (1 GiB) of WAL locally, then drops segments rather than filling the disk. `check` reports archiving failure or backlog, so a gap does not go unnoticed.

---

## 3. Drills performed

| Date | Drill | Result |
|---|---|---|
| 2026-10-11 | Manual `pg_dump -Fc` → `pg_restore` into an empty database (§6) | passed, 15/15 tables of that schema |
| Milestone 10 | `restore-verify` of a scheduled backup (counts, image checksums, published pages through the restored API) | 16/16 checks |
| 2026-10-22/23 (ws/a3-ops) | `restore-verify <name> --from-offsite`: download, decrypt, restore, compare | passed |
| 2026-10-22/23 (ws/a3-ops) | WAL archiving latency (commit → segment in the bucket) | 8.6 s |
| 2026-10-22/23 (ws/a3-ops) | `pitr-restore --to <time>`: nothing newer than the target in `organizers`, `events`, `users`, `tickets`, `checkins`, `sms_messages`; migrate + API accepted the recovered schema | passed |
| 2026-10-22/23 (ws/a3-ops) | `rollback` after an unmarked migration / after a `backward_compatible` one | refused (previous images restarted) / worked |

All off-host drills used a local S3 stand-in. **Still to do against the real provider:** `restore-verify --from-offsite` and `pitr-restore`.

---

## 4. Procedures

**Verify a backup (non-destructive; monthly and after every migration):**

```bash
node scripts/staging/stack.mjs backups                                   # local
node scripts/staging/stack.mjs backups --offsite                         # encrypted copies in the bucket
node scripts/staging/stack.mjs restore-verify staging-<timestamp> --from-offsite
```

It restores into a disposable `congress-restore-*` project with no published ports, runs the normal `migrate` → `api` path, compares every row count and image checksum with the manifest, fetches every published page and image through the restored API, and removes the project.

**Point-in-time drill (monthly with WAL, and before a congress):**

```bash
node scripts/staging/stack.mjs pitr-restore --to 2026-10-22T09:41:00Z    # UTC unless an offset is given
node scripts/staging/stack.mjs pitr-restore --to latest
```

It restores into a disposable `congress-pitr-*` project with archiving off, so it never writes to the bucket.

**Real recovery** (after the drill of the same backup or target passed):
- From a logical backup: `STAGING_OPERATIONS.md` → *Restoring for real* (move the old data aside, `pg_restore` into a fresh database, restore media, `start`, `check`). The off-host files are encrypted; fetch them through the `crypt` remote (*Fetching an off-host backup by hand*).
- To a point in time: `STAGING_OPERATIONS.md` → *Recovering the live database to a point in time* (`pitr-restore --keep`, dump the kept project, restore that dump).
- With `BACKUP_WAL=on`, a dump restored into a fresh cluster needs a new `BACKUP_S3_PREFIX` and `stack.mjs up` (new pgBackRest stanza and first full base backup).
- Never delete the old data before the restored stack passes `check`. Neither real-recovery path is automated, and neither has been drilled end to end on a live stack.

**A bad release is not a restore.** If the new code misbehaves but the data is fine, `stack.mjs rollback` returns to the previous images without touching the database, provided every newer migration is `backward_compatible = True` (`docs/CODING_STANDARDS.md` §2.D).

**Upgrades and the rollback table.** Before every upgrade, take a backup, and rehearse the migrations on a copy of
production data first (`STAGING_OPERATIONS.md` → *Upgrade dry run*: new images on a separate machine, then
`restore-verify <latest> --from-offsite --keep`, or with a local copy of a `main`-era backup). Whether a bad upgrade
can be undone by `rollback` or needs a restore depends on the migrations it ran:

| Order | Rev | Purpose | Image rollback OK |
|---|---|---|---|
| 1 | 0019 | SMS short links (backfilled) | no |
| 2 | 0020 | scanner device verdicts, clock skew | no |
| 3 | 0023 | ticket registration snapshot (backfilled, NOT NULL), cancellation, consent, account deletion | no |
| 4 | 0024 | event lifecycle, tier sales windows, program files | yes |
| 5 | 0021 | integrity constraints, same-event foreign keys, `leads.event_id` (backfilled), desk idempotency keys; stops on rows that break a rule | no |
| 6 | 0022 | shared rate-limit counters, outbox lease | no |
| 7 | 0027 | lead soft delete | yes |
| 8 | 0028 | audit log | yes |
| 9 | 0029 | organizer members | yes |

The first upgrade from `main` (`0018`) crosses five unmarked migrations, so the way back to `main` is the pre-upgrade
backup or PITR, never `rollback`. The whole upgrade runs in one transaction: if `0021` (or any step) fails, the
database stays at `0018`. Details: `STAGING_OPERATIONS.md` → *First upgrade from `main`*.

---

## 5. Congress-day schedule

1. **Day before:** `sudo node scripts/staging/stack.mjs event-mode on` (backups hourly at :05; `check` alerts when the newest is older than 2 h), then one `scheduled-backup` by hand, `backups --offsite`, `restore-verify <newest> --from-offsite`.
2. **With WAL:** `base-backup full`, then `pitr-restore --to latest`.
3. **During the congress:** hourly backups and continuous WAL run by themselves; Telegram alerts come from `check` every 5 min. No deploys while gates scan.
4. **After the congress:** one final `scheduled-backup`, confirm it off-host, then `event-mode off`.

---

## 6. Historical drill (2026-10-11)

The first drill, before the operations tooling existed, ran by hand over TCP loopback on port 5433 against the 15 tables the schema had then:

```bash
export PGPASSWORD=congress
pg_dump -h 127.0.0.1 -p 5433 -U congress -Fc congress_test > /tmp/congress_backup_drill.dump
dropdb -h 127.0.0.1 -p 5433 -U congress --if-exists congress_restore_drill
createdb -h 127.0.0.1 -p 5433 -U congress congress_restore_drill
pg_restore -h 127.0.0.1 -p 5433 -U congress -d congress_restore_drill /tmp/congress_backup_drill.dump
psql -h 127.0.0.1 -p 5433 -U congress -d congress_restore_drill -c \
  "SELECT count(*) FROM pg_tables WHERE schemaname = 'public';"   # 15
```

It showed that `pg_dump -Fc` captures schema, keys, constraints and data. It covered neither media nor off-host copies; use the procedures in §4 instead.

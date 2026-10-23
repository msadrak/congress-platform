# 0013: Platform Console and Platform Settings in the Database

## Context
Platform-wide operations (organizer accounts, the SMS wording shared by every congress) were only available from
the terminal (`scripts/staging/stack.mjs`), and the SMS gateway (sms.ir key, service line, live or test mode) and
the sign-in rules could only be changed in the environment file followed by a restart. The people who run the
platform need to do this from a browser, and these settings are not bound to any organizer, so they cannot live in
the organizer console.

## Decision
1. **Platform console at `/platform`**, unlocked with the platform admin token (`X-Admin-Token`, kept in
   `sessionStorage` for the tab only, never sent as a Bearer credential). Sections:
   - **SMS**: gateway mode (live through sms.ir, or test mode outside production), sms.ir API key, service line,
     a connection check (credit and the account's lines, nothing is sent), and the platform wording of the
     sign-in code and the default ticket confirmation (same editor as the organizer's SMS page).
   - **Sign-in**: code length, validity, resend wait, codes per number and per network address per hour.
   - **Organizers**: create, rotate a key, revoke; keys are shown once.
2. **Platform settings in `platform_settings`** (migration `0017`): a key/value table where an absent key means the
   environment value applies, so a deployment behaves exactly as before until something is saved. The effective
   configuration is cached per process and reloaded after every change (`app/platform_config.py`), so changes apply
   without a restart (one API process per deployment). If the database is unreachable at startup, the API starts on
   the environment values and applies the saved settings once it can read them.
3. **The SMS gateway follows the settings at run time** (`app/sms/gateway.py`): live, test mode, or *not configured*
   (no key/line yet: sign-in answers 503 "SMS delivery is not configured yet" and confirmations stay queued and are
   retried). Production may now start before SMS is configured; it still refuses test mode.
4. **The sms.ir API key is write-only and encrypted at rest** (AES-256-GCM, key derived from the JWT secret,
   `app/secret_box.py`), so database dumps and off-host backups do not reveal it. The console shows only its last four
   characters. Rotating the JWT secret makes it unreadable; the console then asks for it again.
5. **What stays in the environment**: database URL, JWT secret, platform admin token, media root, public origin and
   CORS. They are needed before the database can be read, or they protect the console itself.

## Consequences
- The terminal commands remain (automation, servers without a browser), backed by the same API.
- The edge keeps admin routes (`/api/organizers`, `/api/platform/*`) off the public internet: the console works from
  networks allowed by `CONGRESS_ADMIN_ALLOW` (local staging: private ranges; hosted: `127.0.0.1/32` unless widened,
  e.g. to an office or VPN range). The console explains when the edge refuses it.
- Settings are per deployment and cached in process memory; a multi-process deployment would need a change
  notification (or a short cache lifetime).

## Status / Implementation notes (2026-10-23)

The decision above stands, with one change to point 4.

- **SMS key sealing:** the sms.ir API key is sealed with a key derived from `CONGRESS_SECRET_BOX_KEY` when that is set
  (a generated secret of at least 32 characters, different from the JWT secret), otherwise from the JWT secret as
  first described. Values sealed with the JWT secret still open and are sealed again with the dedicated key on the
  next save, so setting it needs no migration; from then on, rotating `CONGRESS_JWT_SECRET` no longer makes the stored
  key unreadable (`app/secret_box.py`). Losing the sealing key still does, and the console then asks for the key.
- The platform console, the settings table and the run-time gateway switch are implemented as described.
- **Several processes (points 2 and the last consequence):** each API process compares a fingerprint of
  `platform_settings` every `CONGRESS_PLATFORM_SETTINGS_REFRESH_SECONDS` (3 s) and reloads when another process saved a
  change (`keep_platform_fresh`, `app/platform_config.py`), so the cache no longer assumes one process. Sign-in code
  throttling and the platform SMS caps are counted in PostgreSQL and shared by every process (ADR 0019).
- **More settings in the console (ADR 0019):** the Sign-in section also edits the venue networks
  (`otp_trusted_networks`) and their per-address budget; the SMS section edits the platform hourly and daily SMS caps
  and shows the outbox health (queued, failed, unknown, oldest pending, sent in the last hour and day against the caps).
  In staging and production a code length below 6 is refused, and in production a resend wait below 30 s.

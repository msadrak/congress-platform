# 0019: SMS Caps, Shared Rate Limits in PostgreSQL and Venue Networks

**Status:** Accepted (2026-10-23). Implemented by the SMS/OTP workstream (B1, migration `0022`). Extends ADR 0012
(point 3 and the outbox) and ADR 0013.

**Status note (2026-10-23, PERF-1):** the API can now run several uvicorn workers (`CONGRESS_API_WORKERS`, default 1,
`backend/app/serve.py`). The shared counters of this ADR are what makes that safe for rate limits and SMS caps; the
retention job takes an advisory lock per pass, the outbox already claims with `FOR UPDATE SKIP LOCKED`, and metrics
are summed over workers. Still per worker: the in-process shortcuts and memory fallback of point 1, the
concurrent-send limit of point 4 (so `8 × workers` provider calls at most), the settings refresh of point 6 and the
database pool (`docs/deployment/STAGING_OPERATIONS.md` → Scaling).

## Context
Every sign-in is an SMS code, and every SMS costs money and reaches a real phone. The limits of ADR 0012 were counted
in process memory: a restart or deploy reset them, a second API process doubled every budget, and nothing bounded the
platform's total spend if an attacker rotated numbers and addresses. At the same time the per-address budget (100 codes
per hour) is too small for a venue, where hundreds of attendees share one public address behind the Wi-Fi's NAT. Codes
were also sent while a database transaction was open, so a slow sms.ir held connections that check-in needed.

## Decision
1. **Shared counters in PostgreSQL** (`rate_limit_counters`, `backend/app/rate_limit.py`): one row per key and time
   bucket (1/60 of the window, at least 5 s); a check counts every bucket overlapping the window, so a budget is never
   looser than stated. `consume` adds to every key and reads the totals in one transaction, so concurrent requests
   cannot overshoot, and a refused attempt is rolled back. Expired rows are deleted about once a minute. Budgets survive
   restarts and deploys and are not multiplied by API processes. Two in-process shortcuts can only tighten: a key found
   over budget is refused locally until its Retry-After passes, and if the database is unreachable the limiter falls
   back to process memory rather than failing requests.
2. **What is limited** (429 with Retry-After and a stable code, ADR 0022):
   - sign-in codes, per purpose (`signin`, `desk`, `organizer`): one per number per resend wait (60 s), 5 per number per
     hour, 100 per address per hour (IPv6 per /64), or the venue budget below;
   - wrong codes: 10 per number (per purpose and network) and 100 per address per 15 min, on top of the 5 guesses each
     code allows;
   - failures with the admin token (10) and organizer API keys (50) per address per 15 min;
   - SMS pass links (600 opens, 20 failures per address per 15 min, ADR 0015), desk pass resends (1 per ticket per
     minute, 5 per ticket per hour, 300 per event per hour), network scans, booth QR failures;
   - organizer test SMS: 10 per event per hour and `CONGRESS_SMS_TEST_SENDS_PER_ORGANIZER_PER_DAY` (20) per organizer.
3. **Venue networks:** a list of CIDRs (`otp_trusted_networks`, platform console → Sign-in, or
   `CONGRESS_OTP_TRUSTED_NETWORKS`) whose addresses get their own per-address budget for sign-in codes,
   `otp_sends_per_trusted_ip_per_hour` (2,000), counted under a separate key. Only code **sends** get this exception;
   the per-number limits still apply to everyone.
4. **Platform-wide SMS caps** (`app/sms/gateway.py`): every send, of any kind, first counts against a rolling hourly and
   daily cap (`CONGRESS_SMS_HOURLY_CAP` 2,000, `CONGRESS_SMS_DAILY_CAP` 20,000; 0 = none; overridden in the platform
   console). Above a cap nothing reaches sms.ir: sign-in answers `503 SMS_HOURLY_CAP_REACHED` /
   `SMS_DAILY_CAP_REACHED`, queued messages wait without using an attempt. Crossing 80 % logs a warning and reaching a
   cap an error on `congress.sms.alerts` (which `stack.mjs check` turns into an alert). At most
   `CONGRESS_SMS_MAX_CONCURRENT_SENDS` (8) provider calls run at once per process; a send that cannot start within the
   provider timeout answers BUSY.
5. **No provider call inside a transaction:** a sign-in code is committed and the connection released before sms.ir is
   called; the outbox claims messages (`status = 'sending'`, `lease_until`) in a short transaction, sends outside it,
   and marks a message whose lease ran out `unknown` (never resent). Single-use signup tokens are claimed in the same
   counter table.
6. **Run-time settings:** the caps, venue networks and sign-in rules are platform settings (ADR 0013), reloaded by every
   process within `CONGRESS_PLATFORM_SETTINGS_REFRESH_SECONDS` (3 s). `/platform` shows the outbox health (counts per
   status, oldest pending message, SMS sent in the last hour and day against the caps).

## Consequences
- The platform's SMS spend is bounded per hour and per day whatever an attacker does; the price is that a genuine
  surge above the caps blocks sign-ins until the cap is raised. Operators size the caps before a congress
  (`docs/release/07-CONGRESS-DAY-RUNBOOK.md`).
- Venue networks must be the addresses **the server sees** (normally the venue's public NAT address, or what the CDN
  passes on), entered before doors open. Attendees on mobile data are not covered. Wrong-code and pass-link limits have
  no venue exception.
- Each limiter check is a database round trip; the table is small (expired rows are deleted) and indexed by
  `expires_at`.
- The deployment runs one API process by default; rate limits no longer require it, and `CONGRESS_API_WORKERS` adds
  more (`docs/deployment/STAGING_OPERATIONS.md` → Scaling lists what is still per process).
- The staging/hosted Compose file passes none of the `CONGRESS_OTP_*` / `CONGRESS_SMS_*_CAP` variables to the API, so
  on that deployment these settings are made in the platform console.
- Migration `0022` is not marked `backward_compatible` (it only adds a table and a nullable column, so it could be
  marked after review); as it stands, rolling back past it needs a restore.
- Still open: a backup SMS provider with failover only on definite non-delivery, delivery-report polling, and a
  low-credit alert.

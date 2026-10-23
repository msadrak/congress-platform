# Load tests (k6)

k6 scenarios for the congress-day hot paths, run in the `grafana/k6:2.3.0` Docker image (no local k6 needed;
`K6_IMAGE` overrides it). Every scenario creates or uses only synthetic data and holds **zero 5xx** as a
threshold; k6 exits non-zero when any threshold is crossed.

| Scenario | What it does | Target (k6 `thresholds`) |
| --- | --- | --- |
| `otp-burst.js` | distinct mobiles request a sign-in code, `POST /api/auth/otp/request` | 1000 requests in 15 min, `server_errors count==0`, ≥99 % answered 202, p95 < 1 s |
| `reservation-burst.js` | signed-in attendees reserve the free tier, `POST /api/events/{id}/tickets/reserve` | 50 reservations/s for 10 s, every one 201, no dropped iterations, p95 < 1 s |
| `gate-scanning.js` | N gates upload small scan batches and refresh their full manifest, `POST /api/checkin-points/{id}/scans/batch`, `GET …/manifest` | 10 gates × 20 scans/min, scan p95 < 300 ms, all admitted, manifest p95 < 1 s |
| `scanner-online.js` | N online gates: one server-decided scan per badge and delta manifest refreshes, `POST /api/checkin-points/{id}/scan`, `GET …/manifest?since=<cursor>` | 10 gates × 30 scans/min, scan p95 < 300 ms, all admitted; deltas every 30 s, p95 < 500 ms |
| `sync-backlog.js` | one device uploads an offline backlog in chunks | 2000 scans synced in < 30 s |

Files: `setup.mjs` creates the fixture (organizer, event with an open registration window and a published Page
Studio page, tiers, check-in points with scanner tokens, gate tickets, signed-in attendees) through the API;
`k6.mjs` runs a scenario in Docker; `local-stack.mjs` starts a disposable API + PostgreSQL; `lib.js` holds shared k6 helpers. Fixture and summaries go to `.fixture/`
(ignored by git: it holds synthetic credentials).

## 1. A stack to test

**Disposable local stack** (recommended for repeatable numbers; nothing persistent, separate names):

```bash
node scripts/load/local-stack.mjs up          # or: up --build (image from this checkout's backend/)
# prints: host URL http://127.0.0.1:<port>, k6 URL http://congress-load-api-<id>:8000,
#         K6_NETWORK=congress-load-net-<id>, and the admin token
node scripts/load/local-stack.mjs workers 4   # re-create the API with 4 uvicorn workers (CONGRESS_API_WORKERS)
node scripts/load/local-stack.mjs down        # when finished: removes containers, network and data
```

`up --workers N` starts with N workers directly. The `console` provider keeps "sent" codes in the memory of the
worker that sent them, so run `setup.mjs` with **one** worker (otherwise the outbox lookup may reach another
worker and find no code), then `workers N` for k6: the data, port, secrets and fixture tokens are kept.

It runs the API with `CONGRESS_ENVIRONMENT=development` and the `console` SMS provider, so no SMS is sent
and the SMS outbox is available. k6 joins the stack's Docker network and talks to uvicorn directly.

**Local staging stack** (`node scripts/staging/stack.mjs up`, see `docs/deployment/STAGING_OPERATIONS.md`):
Load-test data stays in the staging database: prefer the disposable stack, or restore a backup afterwards.
`setup.mjs` runs on this computer against `http://localhost:18080` (Caddy lets `/api/organizers` and
`/api/platform/*` through from `CONGRESS_ADMIN_ALLOW`, private ranges by default). The admin token is
`CONGRESS_PLATFORM_ADMIN_TOKEN` in `.staging/staging.env`; signing attendees in needs
`CONGRESS_SMS_PROVIDER=console` (below). k6 runs in a container, where `localhost` is the container itself and
`http://host.docker.internal:18080` does **not** work: Caddy serves plain HTTP only for the `localhost` site and
answers every other host with 308 to HTTPS. Two working ways (project `congress-staging`; another
`CONGRESS_STACK_PROJECT` changes the prefix):

```bash
# a) Straight to uvicorn on the stack's internal network (like the disposable stack; no Caddy in the path):
export K6_NETWORK=congress-staging_backend BASE_URL=http://api:8000
# b) Through Caddy as browsers reach it, with the Host header of the plain-HTTP site:
export K6_NETWORK=congress-staging_edge BASE_URL=http://web HOST_HEADER=localhost
```

Through Caddy the API sees Caddy's address, not k6's, so `SPREAD_IPS=1` has no effect there (use
`--relax-otp-limits`). Option b) was checked with gate-scanning through the web image (2026-10-23); HTTPS from
a container (`https://web`) fails the TLS handshake (the certificate is for `localhost`), so stay on HTTP.

Never point these scripts at production: they create organizers and accounts, and production has no SMS
outbox (real codes would be sent).

## 2. Fixture

```bash
node scripts/load/setup.mjs --base-url http://127.0.0.1:<port> --admin-token <token> \
  --gates 10 --tickets 300 --attendees 500 [--relax-otp-limits]
```

- `--gates` check-in points (MULTI_ENTRY), each with its own scanner device token
  (`POST /api/checkin-points/{id}/token`, organizer key), plus one extra point for the backlog device.
- `--tickets` gate tickets issued at the front desk with the organizer key
  (`POST /api/events/{id}/desk-registrations`): no SMS, no sign-in.
- `--attendees` attendees signed in by SMS code, one fresh account each, for `reservation-burst.js`
  (needs at least `RATE × SECONDS`, default 500).
- The event gets an open registration window (from an hour ago until it starts) and its Page Studio page is
  published, as an organizer does before announcing it: attendees cannot reserve on an unpublished event
  (404 `EVENT_NOT_FOUND`) or outside the window (409 `REGISTRATION_NOT_OPEN`/`REGISTRATION_CLOSED`). Setup
  checks `GET /api/public/events/{slug}` reports `registration_open` before it signs anyone in.
- Before signing attendees in, setup checks the budgets and stops with the fix instead of failing half-way:
  SMS must be in test mode (`effective: console`, otherwise real SMS would go out), the attendee count must fit
  the per-IP code budget, and `2 × attendees` (codes now, one confirmation per reservation later) must fit
  under the platform SMS caps. `--relax-otp-limits` handles the last two.

**How attendee tokens are obtained.** Sign-in is by SMS code only. Outside production, while the SMS gateway
is in test mode (`console` provider: the default in `development`/`test`, or `CONGRESS_SMS_PROVIDER=console`),
the API keeps what it "sent" in memory and exposes it to the platform admin at
`GET /api/platform/sms-outbox?mobile=<number>` (`X-Admin-Token`). `setup.mjs` requests a code, reads it there,
verifies it and completes the profile (`/api/auth/otp/request` → outbox → `/otp/verify` → `/otp/complete`),
the same path the backend tests use. Tokens are acquired before the run, so sign-in is not measured as part
of the reservation burst. Synthetic numbers are in the unassigned `0900` range.

Every setup creates a fresh organizer and event, so re-run it before each reservation burst (an attendee
can hold one ticket per event; a reused fixture answers 409 `ALREADY_REGISTERED`).

## 3. Run

```bash
export K6_NETWORK=congress-load-net-<id> BASE_URL=http://congress-load-api-<id>:8000   # disposable stack
# export K6_NETWORK=congress-staging_backend BASE_URL=http://api:8000              # staging stack (section 1)

node scripts/load/k6.mjs otp-burst                     # 1000 in 15 min
node scripts/load/k6.mjs otp-burst -e TOTAL=60 -e DURATION=1m      # smoke
node scripts/load/k6.mjs reservation-burst             # 50/s for 10 s (-e RATE= -e SECONDS=)
node scripts/load/k6.mjs gate-scanning -e DURATION=5m  # -e GATES= -e SCANS_PER_MIN= -e BATCH= -e MANIFEST_SECONDS=
node scripts/load/k6.mjs scanner-online -e DURATION=5m # -e GATES= -e SCANS_PER_MIN=30 -e DELTA_SECONDS=30
node scripts/load/k6.mjs sync-backlog                  # -e SCANS=2000 -e CHUNK=100
node scripts/load/k6.mjs inspect                       # validate every script (no stack needed)
```

Extra arguments go to `k6 run`. The end-of-test summary is also saved as `.fixture/<scenario>-summary.json`.

### OTP limits

`POST /api/auth/otp/request` is throttled per mobile (resend cooldown, 5 sends/hour) and per client IP
(100 sends/hour by default; `app/routes/auth.py`, `app/rate_limit.py`). Each iteration uses a new number,
so only the per-IP budget matters, and a single load generator is one IP. Throttled requests get 429 (not a
server error), but the `otp_accepted` threshold then fails, so choose one:

- `setup.mjs --relax-otp-limits` raises the per-IP budget to 100000/hour (`PUT /api/platform/sign-in`) and lifts
  the platform SMS caps (`PUT /api/platform/sms {"hourly_cap": 0, "daily_cap": 0}`, 0 = no cap) through the
  platform console; undo both with `node scripts/load/setup.mjs --restore-otp-limits …`, which resets them to the
  environment defaults (a value set in the console before the run is not brought back; setup warns about it).
- `-e SPREAD_IPS=1` sends a synthetic venue address per 64 requests in `X-Forwarded-For`. The API image runs
  uvicorn with `--proxy-headers`, so this works **only** when k6 reaches uvicorn directly (disposable stack);
  Caddy replaces the header.
- `-e ACCEPTED_RATE=0` to measure throttled behaviour only (5xx still fail the run).

The budgets are counted in PostgreSQL (`rate_limit_counters`), so they hold across API workers and restarts.
Every SMS the platform sends, test mode included, also counts against the platform-wide caps (default 2000 per
hour and 20000 per day; above a cap sign-in codes answer 503 `SMS_HOURLY_CAP_REACHED` and queued confirmations
wait). A full run is exactly at the default hourly cap: 500 setup codes + 500 reservation confirmations + the
1000-request burst = 2000 SMS, so run it with `--relax-otp-limits` (setup refuses to start without it when the
caps cannot hold the run). Venue networks (`CONGRESS_OTP_TRUSTED_NETWORKS` or the console) get their own
per-IP budget (`otp_sends_per_trusted_ip_per_hour`).

With the `console` provider nothing is sent; codes appear in the API log and the outbox.

## Results (2026-10-23, disposable stack, image built from `integration/upgrade` @ 0bb5c38)

`local-stack.mjs up --build` (one uvicorn worker, PostgreSQL 16) on a MacBook / Docker Desktop, k6 2.3.0 on the
stack network; fixture `--gates 10 --tickets 300 --attendees 500 --relax-otp-limits`. **The host was heavily
shared** (other agents' test suites: load average 50-80 on 12 cores), so treat latencies as an upper bound and
re-run on staging before an event (workboard LOAD-1).

| Scenario | Result |
| --- | --- |
| reservation-burst, 50/s × 10 s, 500 attendees | 500/500 × 201, 0 5xx, **p95 2.3 s / 1.03 s** (two runs; threshold p95 < 1 s **missed**), 1 / 0 dropped |
| reservation-burst, 25/s × 10 s, 250 attendees | 250/250 × 201, p95 36 ms, p99 200 ms, 0 dropped, 0 5xx |
| gate-scanning, 10 gates × 20 scans/min (batches of 2), full manifests every 30 s, 5 min | 300 batches all admitted, scan p95 262 ms, manifest p95 482 ms, 0 5xx |
| scanner-online, 10 gates × 30 scans/min via `POST …/scan`, deltas every 30 s, 5 min | 1500/1500 admitted, scan p95 149 ms (p99 666 ms); 100 deltas, p95 361 ms, ~107 tickets each; 0 5xx |
| sync-backlog, 2000 scans in 20 chunks of 100 | 14.5 s total (target < 30 s), every chunk accepted, 0 5xx |
| otp-burst, full target: 1000 in 15 min (relaxed limits) | 1000/1000 × 202, p95 228 ms, p99 541 ms, 0 dropped, 0 5xx |
| gate-scanning through Caddy (web image, `HOST_HEADER=localhost`), 30 s smoke | all admitted, scan p95 226 ms, manifest p95 305 ms |

**Reservation bursts are rate-bound.** At 25/s the median is 13 ms; at 50/s requests queue (median 0.1-1.3 s).
Every reservation updates the same `ticket_tiers` row (`reserved_count + 1`) at the start of its transaction
and holds that row lock through the ticket, QR, short-link and SMS-outbox inserts until commit, so one tier
serialises; the API also runs a single uvicorn worker. The 2026-10-22 numbers (p95 207 ms at 50/s) came from an
older image (`congress-platform/api:staging`, before the publish/registration-window checks and the writes merged
since) on a quieter host, so they are not directly comparable; with the current code and the old setup.mjs every
reservation answered 404 `EVENT_NOT_FOUND`. Candidates for the backend owners: take the tier increment last
(just before commit) to shorten the lock, and/or run more uvicorn workers; then re-run this scenario.
*Done in PERF-1, re-measured below: on a quieter host the old code met 50/s easily; the miss above was host load.*

## Results PERF-1 (2026-10-23, reservations taken last, `CONGRESS_API_WORKERS`)

Same machine and method (`local-stack.mjs`, PostgreSQL 16, k6 2.3.0 on the stack network), host load average
4-14 on 12 cores (other agents were running; noticeably quieter than the run above). "Before" is
`integration/upgrade` @ b980385 (tier increment first, one worker); "after" is `ws/perf1-reservations` (tier
place taken last, just before commit). Each reservation run uses a fresh event and `RATE × 10 s` attendees signed
in with one worker (`setup.mjs --gates 1 --tickets 0 --relax-otp-limits`); the API is then switched to N workers.
p95 / p99 of `POST …/tickets/reserve` in ms; every run answered 201 to all, 0 5xx, unless noted.

| Reservations/s × 10 s | before, 1 worker | after, 1 worker | after, 4 workers |
| --- | --- | --- | --- |
| 25 | 14 / 19 | 36 / 74 | 18 / 40 |
| 50 | 13 / 100 | 11 / 20; 11 / 34 | 14 / 62; 50 / 177 |
| 100 | 9 / 52 | 11 / 37 | 11 / 116 |
| 200 | 294 / 427 | 165 / 242; 154 / 205 | 290 / 554; 153 / 273 |
| 250 | — | 299 / 339 | 1329 / 1629 (p95 > 1 s) |
| 300 | **3043 / 3760**, 238 dropped | **2473 / 4444**, 128 dropped; 810 / 1465 | 313 / 435; 1428 / 1845; 190 / 294 |
| 400 | — | — | 7085 / 7907, 583 dropped, **1 × 500** (pool timeout, overload) |

- The target (50/s, p95 < 1 s) is met by every configuration with a wide margin (p95 11-50 ms). Below about
  200/s latency is noise-dominated (the same configuration varies 2-4× between runs on this shared host).
- One worker saturates at about 250-300/s, before and after: the process's CPU, not the tier lock, is the
  limit there. The shorter lock helps around saturation (200/s: p95 ~160 ms instead of 294 ms) and is proven
  directly by `backend/tests/test_reservation_throughput.py` (a reservation stalled mid-write no longer holds
  up the tier). Four workers keep 300/s under 1 s in two of three runs; beyond that PostgreSQL in Docker Desktop
  and the shared host are the limit, and at 400/s a request waited past the 10 s pool timeout (500).
- Overload behaviour to know: past capacity, requests queue in the pool and the first failures are 500s from the
  pool timeout (`CONGRESS_DB_POOL_TIMEOUT_SECONDS`), not 503s.

Other scenarios, 1 minute each (fixture `--gates 10 --tickets 300`), p95 in ms, all checks passed, 0 5xx:

| Scenario | 1 worker | 4 workers |
| --- | --- | --- |
| gate-scanning, 10 gates × 20 scans/min, full manifests every 30 s | batch 25, manifest 113 | batch 61, manifest 172 |
| scanner-online, 10 gates × 30 scans/min, deltas every 30 s | scan 18, delta 76 | scan 18, delta 94 |
| sync-backlog, 2000 scans in 20 chunks | 2.4 s total, chunk 174 | 1.9 s total, chunk 131 |
| otp-burst, 300 in 1 min (`SPREAD_IPS=1`, relaxed limits) | 20 | 23 |

At these rates more workers change nothing measurable; they add headroom for CPU-bound bursts. Keep
`workers × (DB_POOL_SIZE + DB_MAX_OVERFLOW)` under PostgreSQL's `max_connections` (the stack above ran 4 × (10 + 10)
= 80 of 100).

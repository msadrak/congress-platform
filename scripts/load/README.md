# Load tests (k6)

k6 scenarios for the congress-day hot paths, run in the `grafana/k6` Docker image (no local k6 needed;
tested with k6 v2.3.0). Every scenario creates or uses only synthetic data and holds **zero 5xx** as a
threshold; k6 exits non-zero when any threshold is crossed.

| Scenario | What it does | Target (k6 `thresholds`) |
| --- | --- | --- |
| `otp-burst.js` | distinct mobiles request a sign-in code, `POST /api/auth/otp/request` | 1000 requests in 15 min, `server_errors count==0`, ≥99 % answered 202, p95 < 1 s |
| `reservation-burst.js` | signed-in attendees reserve the free tier, `POST /api/events/{id}/tickets/reserve` | 50 reservations/s for 10 s, every one 201, no dropped iterations, p95 < 1 s |
| `gate-scanning.js` | N gates upload small scan batches and refresh their manifest, `POST /api/checkin-points/{id}/scans/batch`, `GET …/manifest` | 10 gates × 20 scans/min, scan p95 < 300 ms, all admitted, manifest p95 < 1 s |
| `sync-backlog.js` | one device uploads an offline backlog in chunks | 2000 scans synced in < 30 s |

Files: `setup.mjs` creates the fixture (organizer, event, tiers, check-in points with scanner tokens, gate
tickets, signed-in attendees) through the API; `k6.mjs` runs a scenario in Docker; `local-stack.mjs` starts
a disposable API + PostgreSQL; `lib.js` holds shared k6 helpers. Fixture and summaries go to `.fixture/`
(ignored by git: it holds synthetic credentials).

## 1. A stack to test

**Disposable local stack** (recommended for repeatable numbers; nothing persistent, separate names):

```bash
node scripts/load/local-stack.mjs up          # or: up --build (image from this checkout's backend/)
# prints: host URL http://127.0.0.1:<port>, k6 URL http://congress-load-api-<id>:8000,
#         K6_NETWORK=congress-load-net-<id>, and the admin token
node scripts/load/local-stack.mjs down        # when finished: removes containers, network and data
```

It runs the API with `CONGRESS_ENVIRONMENT=development` and the `console` SMS provider, so no SMS is sent
and the SMS outbox is available. k6 joins the stack's Docker network and talks to uvicorn directly.

**Local staging stack** (`node scripts/staging/stack.mjs up`, see `docs/deployment/STAGING_OPERATIONS.md`):
traffic goes through Caddy like production. Use `http://localhost:18080` for `setup.mjs` and
`BASE_URL=http://host.docker.internal:18080` for k6 (or HTTPS on 8443 with `INSECURE_TLS=1`, Caddy's
local CA). The admin token is `CONGRESS_PLATFORM_ADMIN_TOKEN` in `.staging/staging.env`; Caddy only lets
`/api/organizers` and `/api/platform/*` through from `CONGRESS_ADMIN_ALLOW` (private ranges by default).
Signing attendees in needs `CONGRESS_SMS_PROVIDER=console` (below). Load-test data stays in the staging
database: prefer the disposable stack, or restore a backup afterwards.

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
# export BASE_URL=http://host.docker.internal:18080                                  # staging stack

node scripts/load/k6.mjs otp-burst                     # 1000 in 15 min
node scripts/load/k6.mjs otp-burst -e TOTAL=60 -e DURATION=1m      # smoke
node scripts/load/k6.mjs reservation-burst             # 50/s for 10 s (-e RATE= -e SECONDS=)
node scripts/load/k6.mjs gate-scanning -e DURATION=5m  # -e GATES= -e SCANS_PER_MIN= -e BATCH= -e MANIFEST_SECONDS=
node scripts/load/k6.mjs sync-backlog                  # -e SCANS=2000 -e CHUNK=100
node scripts/load/k6.mjs inspect                       # validate every script (no stack needed)
```

Extra arguments go to `k6 run`. The end-of-test summary is also saved as `.fixture/<scenario>-summary.json`.

### OTP limits

`POST /api/auth/otp/request` is throttled per mobile (resend cooldown, 5 sends/hour) and per client IP
(100 sends/hour by default; `app/routes/auth.py`, `app/rate_limit.py`). Each iteration uses a new number,
so only the per-IP budget matters, and a single load generator is one IP. Throttled requests get 429 (not a
server error), but the `otp_accepted` threshold then fails, so choose one:

- `setup.mjs --relax-otp-limits` raises the per-IP budget to 100000/hour through the platform console
  (`PUT /api/platform/sign-in`); undo with `node scripts/load/setup.mjs --restore-otp-limits …`, which resets
  it to the environment default.
- `-e SPREAD_IPS=1` sends a synthetic venue address per 64 requests in `X-Forwarded-For`. The API image runs
  uvicorn with `--proxy-headers`, so this works **only** when k6 reaches uvicorn directly (disposable stack);
  Caddy replaces the header.
- `-e ACCEPTED_RATE=0` to measure throttled behaviour only (5xx still fail the run).

With the `console` provider nothing is sent; codes appear in the API log and the outbox.

## Smoke results (2026-10-22, disposable stack on a MacBook / Docker Desktop, image `congress-platform/api:staging`)

| Scenario | Result |
| --- | --- |
| reservation-burst, 50/s × 10 s, 500 attendees | 500/500 × 201, p95 207 ms, p99 470 ms, 0 dropped, 0 5xx |
| gate-scanning, 10 gates × 20 scans/min (batches of 2), manifests every 30 s, 2 min, 300 tickets | 201 batches all admitted, scan p95 188 ms, manifest p95 217 ms, 0 5xx |
| sync-backlog, 2000 scans in 20 chunks of 100 | 7.6 s total (chunk p95 682 ms), 0 5xx |
| otp-burst, full target: 1000 in 15 min (`SPREAD_IPS=1`, default limits) | 1001/1001 × 202, p95 270 ms, p99 679 ms, 0 5xx (the backend test suite was running on the same machine meanwhile) |
| otp-burst, 200 in 1 min (relaxed limits) and 150 in 30 s (`SPREAD_IPS=1`, default limits) | 100 % 202, p95 43 ms / 39 ms, 0 5xx |

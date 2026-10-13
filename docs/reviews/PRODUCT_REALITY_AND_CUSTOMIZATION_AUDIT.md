# Product Reality & Customization Audit

Branch `integration/task-05h`, HEAD `4c031e510ba77aa58e1a578b89bfc652074b0042` at the start of the audit.

**Scope of changes.** No application code changed. The only additions are this report and three diagnostic scripts: `scripts/integration/reality-probe.mjs`, `scripts/diagnostics/jwtdiag.py` and `scripts/diagnostics/clockmon.py`.

**Data safety.**
- The persistent `.demo` database was not touched.
- Runtime proofs ran on a throw-away Docker stack: private `--internal` network, PostgreSQL with no published port, a named volume, and a generated admin token, JWT secret and database password. The stack is removed at the end of the run.

---

## A. Reality verdict — the platform is genuinely dynamic

`node scripts/integration/reality-probe.mjs` runs against an empty, freshly migrated database (Alembic head `0012`) with the production web build. Result: **10/10 checks passed, exit 0**.

| # | Step | How it was done | Result |
|---|---|---|---|
| 1 | Fresh database | DB query | `users=0 organizers=0 events=0 tickets=0`. The API and SPA serve normally with no seed data. |
| 2 | New organizer tenant | **Privileged API**: `POST /api/organizers` with `X-Admin-Token` | 401 without the token; 201 with it. The key is returned once and only its SHA-256 is stored. |
| 3 | Organizer signs in with the key, creates a congress and a tier | **UI** | Rows exist in `events` and `ticket_tiers` (quota 10, open). |
| 4 | New congress publicly reachable at `/e/<slug>` | **UI**, anonymous | Works with no code change. |
| 5 | New User registers and reserves through the public dialog | **UI** | `users` row (PBKDF2 hash), `tickets` row, `entity_qrs` row (26-character secret), `reserved_count = 1`. |
| 6 | Rendered pass QR decoded in the browser (jsQR) | UI + DB | The QR payload equals `entity_qrs.secret` exactly. |
| 7 | Log out, then sign in again on the sign-in page | **UI** | The pass is shown again. |
| 8 | API container restarted; PostgreSQL container **deleted and recreated** on the same volume | infra | User, ticket and QR survive; sign-in and QR work. A token issued before the restart is still accepted (stateless JWT, same secret). |
| 9 | Second User's access to the first User's data | UI + API | Ticket list `[]`; attendee record, attendee search and event endpoints 401; another tenant's organizer key 404. The UI shows no pass and no name of User 1. |
| 10 | Public payload | API | Event: `id, name, slug, starts_at, ends_at, location, description, ticket_tiers`. Tier: `id, name, description, quota, reserved_count, is_open`. |

The broader journey (`scripts/integration/congress-e2e.mjs`, 45/45 on this build) additionally covers reception, scanner sync and offline queue, exhibitor leads, CSV export and cross-tenant isolation.

**Demo-only dependencies: none at runtime.**
- `backend/seed_demo.py` creates everything through the public HTTP APIs, with no direct DB writes.
- Generated demo credentials live only in the git-ignored `.demo/` folder.
- App startup reads only `Settings` and needs no seeded record (`backend/app/main.py:27-60`).
- No demo password, organizer key, admin token, JWT secret or scanner token exists in `web/src`, `web/public`, `index.html` or the Vite production config. Bundle-visible demo material is limited to the example slug placeholder `ai-health-2026` in the reception entry (`web/src/pages/ReceptionPortal.tsx`).

**Things that are real, but limited.**
- **Organizer onboarding has no product UI.** The only path is the platform-admin endpoint (`backend/app/routes/organizers.py:10-35`). There is no rotation or revocation of organizer keys, and the key is the organizer's only identity: no organizer user accounts.
- **Booth representatives must already be registered Users.** Reception operators are created in the Organizer UI, which shows a one-time password.
- **Scanner devices are API-only.** Issue, list and revoke exist in `checkin.py:319-489`, but the Organizer UI has no controls for them.
- **No orders or payments.** Tickets are free reservations (`Ticket` + `EntityQR`); there is no `Order` or payment table.
- **User logout is client-side only.** JWTs are valid for 7 days and the server cannot revoke them. Desk tokens are the exception: they are revocable through `session_version`.

**Configuration hazards found.** These are not runtime demo dependencies; they matter for staging.
- `.env.example` ships a JWT secret that passes the validator, because it is not deny-listed and is longer than 32 characters (`backend/.env.example:3`, `app/config.py:4-35`).
- `CONGRESS_PLATFORM_ADMIN_TOKEN=change-me-in-production` is accepted: the admin token has no validation at all.
- `CONGRESS_DATABASE_URL` silently defaults to `congress:congress@127.0.0.1:5433/congress` (`app/config.py:17`).

---

## B. Organizer customization verdict

The Organizer controls **operational records**: event fields, tiers, check-in points, booths, operators. They do **not** control the **public page**. That page is a fixed template with four sections — About, What your pass includes, Passes, Exhibition (`web/src/pages/PublicEvent.tsx:357-518`). Its headings, CTA text, benefit list, order, colours (derived from the slug in `lib/eventAccent.ts`) and artwork (derived from the slug in `CongressSignature`) are code.

| Capability | UI | API | DB | Status / missing work |
|---|---|---|---|---|
| Event title, description, dates, venue | ✅ | ✅ | ✅ | Fully editable. Slug is create-only; no time-zone field. |
| Hero title & subtitle | ◐ | ✗ | ✗ | Hero shows `event.name`; the eyebrow is fixed copy. No subtitle field. |
| Cover / banner / background | ✗ | ✗ | ✗ | Generative artwork seeded from the slug. **Not implemented.** |
| Event logo & accent colours | ✗ | ✗ | ✗ | Accent is picked from a 5-colour palette by slug hash. **Code only.** |
| Registration & CTA labels | ✗ | ✗ | ✗ | Fixed fa/en copy in `components/public/copy.ts`. **Code only.** |
| Ticket-tier presentation | ✅ basic | ✅ | ✅ | Name, description, quota, open/closed. No ordering, hiding, delete, sales window or benefits. Exact quota and reserved count are public. |
| Booth / exhibitor section | ✅ create + staff | ✅ create/list/staff | ✅ | **No booth edit, delete, hide or ordering; no staff removal.** All booths are listed publicly. |
| Speakers & schedule | ✗ | ✗ | ✗ | **Not implemented** (no models). |
| Custom content sections | ✗ | ✗ | ✗ | **Not implemented.** |
| Section show/hide | ✗ | ✗ | ✗ | All four sections render unconditionally. **Code only.** |
| Section reordering | ✗ | ✗ | ✗ | Hardcoded `01`–`04`. **Code only.** |
| Image / media management | ✗ | ✗ | ✗ | No upload endpoint, storage or asset model. Booths only take external URLs. |
| Live preview & publishing | ◐ | ✗ | ✗ | "Public page" link only. **No draft or published state: every event is live the moment it is created.** |
| SEO / social metadata | ✗ | ✗ | ✗ | One static `<title>` and description in `web/index.html`. |
| Persian / English content | ◐ | ✗ | ✗ | UI chrome is bilingual. Organizer content is a single string per field; the page language is inferred from the script. |

Legend: ✅ fully editable in the Organizer UI · ◐ partial · ✗ not available.

**Isolation.**
- Every organizer mutation resolves `OwnedEventDep`, which matches `Event.id == event_id AND Event.organizer_id == organizer.id` (`routes/events.py:63-78`). Child rows (tiers, check-in points, operators, booth staff) are additionally bound to that event.
- Editing one event cannot affect another; there is a cross-tenant test (`tests/test_management_lifecycle.py:69-80`).

**Public exposure.** The public endpoints never return organizer IDs or keys, staff e-mails, operators, QR secrets, leads or scanner data. They do return every tier (including closed ones) with exact `quota` and `reserved_count`, and every booth. With no draft concept, nothing can be prepared privately.

### Organizer controls beyond the public page (UI vs server)

- **Tiers.**
  - Create and edit work in the UI.
  - The server enforces the open flag, the quota, and "quota cannot drop below reservations".
  - The confirmation before closing a tier is UI-only.
- **Check-in points.**
  - Four admission policies, enforced server-side at scan time.
  - **Gap:** `POST` does not validate `policy_type` or `allowed_tier_ids`; only `PATCH` does (`routes/checkin.py:137-147` vs `180-212`).
  - **Gap:** `PATCH` cannot clear `max_capacity` (`checkin.py:219`).
- **Reception operators.**
  - Create, revoke and reactivate are enforced server-side via `session_version`.
  - Reactivation has no dedicated button: you re-add the same e-mail.
- **Scanner devices.** API-only (see section A).
- **Feature toggles.** None exist at event level: no registration on/off, networking, exhibition, reception or visibility switch. `TicketTier.is_open` is the only availability switch.

### 10 highest-value missing controls (ranked)

1. Draft / preview / publish / unpublish for an event.
2. Event branding: logo, cover image, accent colour selected from accessible presets.
3. Public-page sections with show/hide and ordering, plus a custom text/image block.
4. Editable hero subtitle, registration headline and CTA label.
5. Booth edit, hide, delete and ordering; booth-staff list and removal.
6. Tier ordering and hide/archive; option to hide exact remaining capacity.
7. Per-event SEO / social metadata: title, description, share image.
8. Bilingual organizer content (fa/en values per field), or an explicit event language.
9. Scanner-device issue, list and revoke in the Organizer UI. The API already exists.
10. Speakers and agenda as a structured section.

---

## C. Minimum viable CMS recommendation

**Not a page builder:** a curated set of section types designed in the AIteb style, stored per event.

1. **One table for page configuration**, `event_page`, one row per event:
   - `status` (`draft` | `published`);
   - `hero_subtitle`, `registration_headline`, `cta_label` (fa/en pairs);
   - `accent` (one of the existing 5 accessible accents, or "auto");
   - `logo_asset_id`, `cover_asset_id`;
   - `seo_title`, `seo_description`, `share_image_asset_id`;
   - `sections` as JSONB: an ordered list of `{type, visible, …}`.
2. **Section types, from a fixed whitelist:** `about`, `pass_benefits` (editable bullet list), `passes`, `exhibition`, `text_block` (title + Markdown-lite body + optional image), `faq`, `speakers`.
   - `speakers` is optional; it can be a `text_block` until agenda models exist.
   - The renderer keeps the current components and simply iterates the configured order.
   - The AIteb attribution stays in the layout, not in a section, so it cannot be removed.
3. **Media.** An `assets` table plus one upload endpoint:
   - type and size limits (PNG/JPEG/WebP, e.g. ≤ 3 MB), server-side re-encoding, alt-text field;
   - stored on a Docker volume first (an S3-compatible store can come later);
   - served from `/media/…` by the static server.
4. **API.**
   - `GET/PUT /api/events/{id}/page` — organizer, `OwnedEventDep`.
   - `POST /api/events/{id}/page/publish` and `/unpublish`.
   - `GET /api/events/{id}/page/preview` — organizer key; renders the draft.
   - Public `GET /api/public/events/{slug}` returns 404 until published (with a migration default of `published` for existing events) and includes only the published page configuration.
5. **Organizer UI: one new "Public page" tab.** It contains:
   - section list with an eye toggle and up/down ordering (no drag-and-drop engine needed);
   - text fields with fa/en sub-tabs;
   - logo and cover upload;
   - accent picker limited to the presets;
   - a preview pane that renders the same components with the draft;
   - Publish / Unpublish buttons.
6. **Security.** Content is plain text plus a minimal Markdown subset rendered without raw HTML. No custom CSS or JS. Section configuration cannot affect authorization or registration rules; `is_open` and quotas stay where they are.

Rough size: one Alembic migration, about 3 endpoints plus upload, one Organizer tab, and a data-driven `PublicEvent` renderer.

---

## D. Authentication / test stability — the intermittent 401s

**Root cause: the WSL test runner's system clock oscillates by about ±232 s. It is a test-environment defect, not an application defect.**

**Evidence** (4 instrumented full runs in WSL, `pytest -p jwtdiag` beside `clockmon.py`):
- `clockmon` logged a wall-clock step of **−232.5 s followed by +232.7 s roughly every 30 s** for the whole session.
- Every failing test (5 different tests across 4 runs) coincides with an **`ImmatureSignatureError: The token is not yet valid (iat)`** entry. The token's `iat` was about 232 s ahead of the time of decoding: it was issued in the "forward" phase and validated in the "back" phase. Affected token types: user, desk_operator and scanner. The 440 other logged decode failures are the suites' intentional negative cases (garbage, wrong signature, expired).
- **Why the clock oscillates:**
  - The Windows host clock is about **232 s slow**: host `12:22:53 UTC` vs `Date: 12:26:45 GMT` from cloudflare.com.
  - The Windows Time service is stopped (`w32tm`: "The service has not been started").
  - Inside WSL, `systemd-timesyncd` corrects the clock forward to NTP time, and the Hyper-V host time sync pulls it back to the host clock (`timedatectl`: RTC 233 s behind system time).
- PyJWT 2.15 rejects `iat > now` with zero leeway (`api_jwt._validate_iat`). The application issues and validates with the same clock, so a backward clock step between issuing and validating produces a 401.

**Harness facts.**
- The fixtures recreate only `congress_test` and truncate per test.
- There is no shared token state and no ordering dependence. The failures move between tests because they depend on wall-clock timing, not on test content.

**Impact on correctness.** None on a server with a single, NTP-disciplined clock. In production the same mechanism would only appear as a brief 401 window after a backward clock step, or across instances with clock skew; a few seconds of `leeway` would mitigate this.

**Fix (environment, not code):**
1. Start Windows Time and resync the host (`w32tm /resync`).
2. Or disable `systemd-timesyncd` inside WSL, so only one source disciplines the clock.

No security change was made.

**Separate harness hazards** (real defects; the test runner is not fail-closed):
- `CONGRESS_TEST_DATABASE_URL` can point the per-test `TRUNCATE … CASCADE` at **any** database (`tests/conftest.py:41-58`).
- An ambient `CONGRESS_DATABASE_URL` overrides the Alembic URL during tests (`migrations/env.py:19-20`). CI sets exactly that.

`scripts/check.bat` itself is safe by default:
- On Windows it runs pytest inside WSL against the WSL-local cluster `127.0.0.1:5433`, dropping and recreating only `congress_test`.
- Windows environment variables do not cross into WSL, because `WSLENV` is not set.
- That cluster also hosts `congress`, `congress_e2e` and `congress_05h`, which are not touched by default.
- It never reaches the demo database (Docker on `55432`).

**Recommended:** assert `current_database() == 'congress_test'` before the drop or truncate, and ignore `CONGRESS_DATABASE_URL` in test migrations.

---

## E. Dockerization readiness

| Need | Exists | Missing |
|---|---|---|
| PostgreSQL + volume | Development `docker-compose.yml` (pg16, named volume, healthcheck) | Fixed `congress/congress` credentials and port `5433` published on all interfaces. Not usable for staging as is. |
| API image | none | **Dockerfile** (uv + Python 3.11, non-root, `uvicorn app.main:create_app_from_env --factory`). Today's integration image `congress-t0-backend:*` is built outside the repo. |
| Migrations | Alembic, manual | A one-shot `migrate` service (`alembic upgrade head`) that the API depends on. |
| Health | none (`/openapi.json` is used as a probe) | `GET /api/health` (process) and a readiness check that does `SELECT 1`. |
| Web serving | `vite build`; same-origin `/api` client; PWA precache with SPA fallback | Static server (Caddy or nginx) serving `dist/`, `try_files` → `/index.html`, `/api` reverse-proxied to the API. Cache headers: `index.html` and `sw.js` no-cache, hashed `/assets/*` immutable. |
| HTTPS / reverse proxy | none | Caddy (automatic TLS) or nginx at the boundary. Camera access in the scanner needs HTTPS. |
| Secrets | Env vars; JWT length validator | `.env` outside git; strong admin token (add validation); remove or deny-list the sample JWT secret; require `CONGRESS_DATABASE_URL` (no silent default). |
| Restart / logs | none | `restart: unless-stopped`; JSON-file log rotation; Uvicorn access logs. |
| Backup / restore | none | Nightly `pg_dump -Fc` to a mounted backup volume, plus a documented `pg_restore` drill. |
| Organizer bootstrap | Admin API | A documented one-time `curl` with the admin token, or a small CLI. |

**Shortest safe path.** Use one `compose.staging.yml` with five services:
- `db` — no `ports:`, internal network only;
- `migrate` — one-shot;
- `api` — `expose 8000`, healthcheck;
- `web` — Caddy with `dist/` and reverse proxy, the only published service on 80/443;
- `backup` — cron `pg_dump`.

Plus `.env.staging.example` with placeholders that are rejected at startup.

---

## F. Recommended execution sequence

| Step | Mandatory | Optional |
|---|---|---|
| **1. Fix genuine blockers** | Reject placeholder or weak admin token and sample JWT secret; require `CONGRESS_DATABASE_URL`; add `/api/health` and readiness check; validate `policy_type` and `allowed_tier_ids` on check-in **create**; make the test DB fail-closed (`current_database()` assert, no Alembic URL override); fix the WSL/host clock. | Allow clearing `max_capacity`; replace the `ai-health-2026` placeholder with a neutral example. |
| **2. Essential public-page customization** | Draft/publish; hero subtitle and CTA label; logo and cover upload; section visibility and order; booth edit/hide; SEO title, description and share image. | Text/FAQ blocks; bilingual organizer fields; speakers and agenda; tier ordering/hide; scanner-device UI. |
| **3. Verification** | Backend pytest (with stable clock); Playwright suite; `congress-e2e.mjs`; `reality-probe.mjs`; add cases for draft-404, publish and section order. | Lighthouse / CWV pass on the published page. |
| **4. Dockerize** | API Dockerfile, migrate service, Caddy web, internal-only `db` volume, healthchecks, `restart`, `.env` outside git, backup job. | Log shipping, image scanning. |
| **5. Staging smoke test** | Fresh volume → migrate → bootstrap organizer → create congress in UI → register/reserve → scanner over HTTPS → `pg_dump` / restore drill. | Load test of scan batch and reservations. |
| **6. Hosted deployment prep** | Domain + TLS, off-host backups, secret rotation procedure, organizer-key revoke/rotate API. | Organizer user accounts instead of raw keys; monitoring and alerting. |

---

### Reproduce
- `node scripts/integration/reality-probe.mjs` — disposable stack; needs Docker, local backend image, `web/dist`, Edge.
- `cd backend && PYTHONPATH=../scripts/diagnostics pytest -q -p jwtdiag` together with `python ../scripts/diagnostics/clockmon.py 900`. Logs go to `/tmp/jwtdiag.log` and `/tmp/clockmon.log`.

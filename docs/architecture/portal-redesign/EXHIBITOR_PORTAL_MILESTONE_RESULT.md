# Exhibitor Booth Portal — visible product milestone 05

> **Historical milestone result, kept as evidence. Superseded in parts.**
>
> Since then, **e-mail and passwords were removed**: attendees, booth staff and desk operators sign in with an Iranian
> mobile number and a one-time SMS code (ADR 0012, migration `0015`); organizers keep their API key and scanners their
> device tokens. Read e-mail fields, password checks, "wrong password" errors and operator password lifecycles below as
> the state of that date. Current sources of truth: `docs/adr/` (with their status sections), `GLOSSARY.md` and
> `docs/pilot/MASTER-PILOT-READINESS.md`.

Branch `integration/task-05h`, base `0eca7bb1201f64368527097b3d184cd895f705fc`. Follows backlog P03-T48 (manual capture), T51 (new camera input) and the `/booth/:boothId` compatibility rule (no redirect, ids and QR unchanged). The Partner domain (T11–T15) was not touched.

## What a booth representative can do now

| Flow | Behaviour |
|---|---|
| Direct entry | `/booth/:boothId` (unchanged URL). Signed out → "Exhibitor Staff Sign In" → **`/booth/:boothId/sign-in?next=…`** (existing User login, reusing the sign-in page in a booth variant) → back to the same booth. `next` goes through the validated allow-list; only `/booth/<id>` was added (external, `//`, traversal and unknown paths fall back to the booth). Existing valid session is kept (Continue / Use a different account). |
| Access | Backend BoothStaff stays authoritative. A signed-in User without staff rights gets the "Commercial Access Restricted (403)" state, keeps the session and is offered "Sign in with a different account". 5xx/network on the booth shows a retry card, not an access error. Lead-list failure alone shows a banner with Retry and no stale leads. |
| Context | Header shows booth, hall and **congress name** (from `GET /api/me/access`, existing) and a link to the public booth profile. Per-booth remount: another booth never inherits state. |
| Capture | Capture dialog: opt-in **camera** (new, `jsqr` + native `BarcodeDetector`) or typed/keyboard-wedge code (field focused on open, Enter submits). Decoding only fills the field; the operator presses Save. Result panel confirms **who** was captured, 201 "new" vs 200 "already a lead", then **Qualify** or **Next attendee**. Mobile: sticky one-tap capture button. |
| Duplicates | Only qualification the operator actually chose is sent. Backend change (below): re-scanning an existing lead no longer resets rating/tags. Double submits send one request. After a dropped connection the UI claims no success, keeps the code, never retries by itself, and says a repeat scan is safe. |
| Qualify | HOT/WARM/COLD, follow-up tags (preset + custom), private notes; failure keeps the form. |
| List | Search (name, email, organization, title, notes, tags) and rating filter are client-side over the booth's full list; the counts always describe the whole booth, with "Showing x of y". |
| CSV | Existing booth-scoped export (UTF-8 BOM, sanitized cells); success notice says the download started for all leads of this booth. |
| Sign out | Clears the User session and returns to the booth sign-in. |

## Backend change (additive, one function)

`POST /api/booths/{id}/leads/scan` on an **existing** lead now updates only the fields present in the request (`model_fields_set`); before, a re-scan with only the badge reset rating to WARM and tags to `[]`. Clients that send all fields behave exactly as before. Tests added: re-scan with only the badge keeps HOT/tags/notes; a re-scan changes only what it sends. No schema, route or QR change.

## Reused

User JWT + `createApiClient({kind:"user"})`, all `/api/booths/{id}`, `/leads`, `/leads/scan`, `PATCH /leads/{id}`, `/leads/export-csv`, `/api/me/access`, the sign-in page and redirect allow-list, existing i18n/labels, Dialog/Button/Card/Badge, `jsqr` (already a dependency; GateScanner untouched).

## Not available / limitations

- No lead delete or booth-level team management (no endpoints). A wrongly captured lead stays (no preview-by-QR endpoint exists, so confirmation happens right after capture).
- No Partner/sponsor features, no offline lead queue, no follow-up reminders/CRM sync.
- **Physical camera and USB/HID scanner were not tested**: the browser camera path was exercised with Chromium's fake video device (permission, preview, release) and mocked decoders in tests; QR decoding on a real camera and a real keyboard-wedge reader are unverified.
- Search runs over the already loaded list (fine for booth-sized lists, not for tens of thousands).
- Attendee contact details shown to staff are those the existing lead contract already returns (ADR 0011); nothing was added.

## Tests (cwd `web/` unless noted, exit codes)

| Command | Exit | Result |
|---|:---:|---|
| backend `pytest -q` (disposable PostgreSQL, container `congress-ms05-runner`) | 0 | 184 passed (182 + 2 new) |
| backend `mypy` | 0 | no issues, 49 files |
| `npm test` | 0 | 51 passed |
| `npm run typecheck` / `npm run build` | 0 / 0 | clean; 74 modules |
| `npm run lint` | 0 | 14 warnings, 0 errors (baseline) |
| `tsc -p tsconfig.e2e.json --types node,vite/client` | 0 | clean |
| Playwright **full suite on the final build**, intercepted API (not real-backend), `127.0.0.1:4175` | 0 | 162 passed, 1 skipped (`scanner-real-api` needs its own real environment), 0 failed — includes `exhibitor-portal` (17, new), `reception-portal`, `public-anonymous`, `desk-authority`, `attendee-*`, `organizer-*`, `scanner-*` |

Two existing tests in `attendee-authority` were updated because the capture dialog now stays open on a result panel (instead of auto-closing after 1.2 s): they click Qualify/Done inside the result, and the PATCH goes to the lead just captured.

New browser tests: sign-in path and return to booth, unsafe `next`, no Organizer-key use, non-staff 403 with session kept, booth/congress context, booth B unreachable for booth A staff, delayed 401 for an old token not removing a newer session, capture/re-scan request bodies, invalid and other-congress badges, double submit, dropped connection, qualification success and failure, client filters without extra requests, booth-scoped CSV, lead-list failure, camera opt-in/decode/denial/late stream release, phone sticky button and Persian RTL at 320 px.

## Real-backend verification

24/24 checks in a real browser against real FastAPI + PostgreSQL (throwaway script, not in the repo; an organizer key deliberately stored in the browser). Data: 2 congresses; booths A1 and A2 (same congress, different staff) and B1 (other congress); reps for each; an ordinary User; controlled attendee tickets.

Signed-out entry → sign-in → return to the booth; ordinary User denied (403, session kept); staff sees booth + congress; fake-device camera opens only after opt-in and releases; new lead captured (201, request carried only the badge); **re-scan of a HOT lead stays HOT with its tag (200), still 2 leads**; unknown badge (404) and other-congress badge (400) refused with the code kept; qualification (COLD, tag, note) persisted in the backend; search; **CSV: BOM, one row per lead, only this booth, correct filename**; A1 staff get 403 on read/scan/update/export for A2 and B1 (API) and access-restricted pages in the browser; sign out → another rep sees nothing of A1 and an honest empty state in her own booth; invalid session removed; external `next=` ignored; Persian RTL mobile 0 px overflow; no request carried the organizer key.

Environment: Alembic `0012` on new database `congress_ms05` in the disposable internal-network PostgreSQL; API bound to `127.0.0.1:8000` only; shared development database not touched.

## Screenshots (`exhibitor-portal/`) — all from the **real backend**

No intercepted-API screenshots.

`01-mobile-booth-sign-in-real` · `02-mobile-booth-access-denied-real` · `03-mobile-booth-workspace-real` · `04-mobile-lead-scanner-real` (capture dialog with camera and manual entry) · `05-mobile-lead-captured-real` · `06-mobile-lead-qualification-real` · `07-desktop-lead-list-csv-real` (desktop, lead list after CSV download) · `08-mobile-empty-booth-real` · `09-mobile-fa-rtl-lead-list-real`.

## Run it locally

```
cd backend && CONGRESS_PLATFORM_ADMIN_TOKEN=dev uv run uvicorn app.main:create_app_from_env --factory --port 8000
cd web && npm run dev
```

Seed with `uv run python seed_demo.py` (it creates booths and staff in `demo_credentials.json`) or assign a registered User to a booth from the Organizer event's Booths tab. Open `/booth/<boothId>` (the Booths tab shows each booth; the printed standee QR points to the public profile, not this portal), sign in with the staff account and capture a badge code (the code printed under an attendee pass QR, or the camera).

## Release blockers / follow-ups

Real camera and HID scanner verification on target devices; lead deletion/merge policy; an organizer-visible audit of who captured which lead; server-side pagination for very large lead lists; accessibility audit with assistive technology.

## Commits

- `e8df59c02839228174d0cd08793140b9ada2917d` — fix(api): keep existing lead qualification when an attendee badge is re-scanned
- `9dab5068ab6aa7998882bfbfbf43476268663f69` — feat(web): exhibitor booth workspace with direct sign-in, camera capture and safe duplicate handling
- the docs commit that adds this report and `exhibitor-portal/` (top of `git log`)

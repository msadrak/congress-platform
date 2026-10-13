# Milestone 08 — Page Studio & Essential Platform Safeguards

Branch `integration/task-05h`, started at `cc7319ec2b9022128ce2014f31b8b8c05865223a`. No push, no deployment, the persistent `.demo` database was never touched.

| Commit | Content |
|---|---|
| `afa455734c14aa441ae3b7bc44811ed20d9aeec5` | Backend: Page Studio API, migration 0013, media, config/test-harness safeguards, health, check-in validation, Docker pytest runner |
| `350edc4974d6cc539a6f0934a458eb64a30b074f` | Web: Page Studio editor, preview frame, data-driven public page |
| *(this report's commit)* | Fixtures adapted to the publish step, lifecycle e2e, demo/CI/check scripts, docs, evidence |

**Result.** A new organizer can create a congress, design its public page, keep it private as a draft, preview it in Persian and English on desktop and mobile, publish it, keep editing without exposing changes, publish again, and the result survives restarts. Proven against real FastAPI + PostgreSQL by `scripts/integration/page-studio-e2e.mjs`: **15/15**.

---

## 1. Safety blockers closed

| Audit finding | Now |
|---|---|
| `change-me-in-production` admin token accepted | `CONGRESS_ENVIRONMENT` (`development` / `test` / `staging` / `production`; **unset = production**). Staging/production require a generated admin token of ≥ 32 characters with no placeholder text. |
| Sample JWT secret from `.env.example` passed validation | The example value and placeholder fragments (`change-me`, `replace-me`, `provide-a-`…) are refused in every environment. |
| `CONGRESS_DATABASE_URL` silently defaulted | Only development/test fall back; staging/production refuse to start without it. Same for `CONGRESS_MEDIA_ROOT` (must be absolute). |
| Startup errors | `create_app_from_env` exits with a list of the variables to fix; submitted values are never echoed. |
| Test harness could TRUNCATE any DB (`CONGRESS_TEST_DATABASE_URL`) | Target must be `*_test`, on the same server as the admin DSN, and carry a harness marker (`COMMENT ON DATABASE`) checked with `current_database()` before every TRUNCATE; an unmarked existing DB is never dropped (except the legacy default `congress_test`). |
| `CONGRESS_DATABASE_URL` redirected test migrations | Alembic now prefers `config.attributes["database_url"]` (set by the harness) over the env var; CI no longer sets it (it pointed at the `postgres` maintenance DB). |
| No health probes | `GET /api/health` (process) and `GET /api/ready` (`SELECT 1`, 5 s bound, 503 `{"status":"unavailable"}` without details). |
| Check-in `POST` skipped validation | `policy_type` and `allowed_tier_ids` are validated on create exactly as on update. |

Regression tests: `tests/test_config_safety.py`, `tests/test_platform_safeguards.py` (health, readiness without leaking the DSN, check-in create validation, harness refusal matrix, truncation guard).

### Intermittent 401s

- Host clock measured at the end of the milestone: **232.5 s slow**, Windows Time service **stopped** — unchanged, not modified by this work.
- New runner `node scripts/integration/backend-tests.mjs`: mypy + pytest in a container on a private Docker network with a throw-away PostgreSQL, with `clockmon` and `jwtdiag` attached. Docker Desktop's VM follows the host clock steadily (no `timesyncd` fighting Hyper-V).
- Final run: **234 passed**, **0 clock steps**, **0 `ImmatureSignatureError`** (110 decode failures, all from intentional negative tests).
- Verdict: **not reproduced** in the stable environment; the WSL defect is environmental and remains as documented in the audit. JWT validation was not relaxed. `scripts/check.bat` now uses the Docker runner when Docker is available (WSL path kept as fallback, with Pillow installed).

---

## 2. What an organizer controls (Page Studio, `/organizer/events/:id/page`)

**Brand & hero.**
- Accent: automatic or one of five curated AIteb accents — all AA-legible on white.
- Event logo, shown on a white tile in the header, hero and footer.
- Hero layout: *Signature* (generative artwork), *Cover photo* (full-bleed under a legibility scrim), or *Split* (framed image).
- Hero image, eyebrow, title (empty = event name), subtitle, registration-button label.
- Default page language (auto / fa / en).

**Search & sharing.** SEO title, description and share image, with a live share-card preview.

**Sections.** Each one is typed and exposes only its own fields; layout variants where useful.

| Type | Kind | Notes |
|---|---|---|
| About | core | Empty body → event description (live data) |
| Passes & registration | core | Live tiers + reservation dock |
| Exhibitors | core | Live booth directory |
| Highlights | addable | Ruled list / cards, curated icon set |
| Text | addable | Split / centered; Markdown-lite |
| Image & text | addable | Image first / last, alt text |
| FAQ | addable | Accessible `<details>` accordion |
| Call to action | addable | Ink band / accent panel, targets passes or exhibitors |
| Speakers | addable | Editorial: name, role, affiliation, photo |
| Agenda | addable | Editorial: free-text time, title, detail |

**Rules.**
- Core sections can be hidden, never removed (the API enforces exactly one of each).
- Add-able blocks can be added, edited, hidden, reordered (↑/↓) and removed (with confirmation).
- Hiding changes presentation only: a hidden *Passes* section still leaves reservations, tiers and quotas exactly as they are.
- No HTML, CSS or JS anywhere. Prose is a Markdown-lite subset parsed to data and rendered as React text: `<script>` stays visible text, and only http(s) links survive.
- The **AIteb attribution is part of `PublicLayout`'s footer, not a section**, so a document cannot remove it.

**Operational vs. presentation.**
- The studio states it explicitly: name, dates, venue, description, tiers and booths are live data and change immediately.
- Everything in the studio waits for **Publish**.

---

## 3. Draft, preview, publish

- **Draft.**
  - Save sends `{revision, document}`. A stale revision gets **409**; the studio then offers *Reload latest* and never overwrites newer work.
  - Unsaved edits are flagged, `beforeunload` guards them, and Ctrl/Cmd+S saves.
- **Preview.**
  - An iframe loads `/organizer/events/:id/page/preview`, which renders the **same public components** at real device widths: 1280 px desktop, 390 px phone, scaled to fit.
  - It receives the unsaved document by same-origin `postMessage`, with origin and source checks.
  - Its data comes from `GET /api/events/:id/page/preview`, which requires the organizer key.
  - Draft images load as object URLs fetched with that key.
  - The language switch in the studio and the one inside the frame stay in sync.
  - Links and registration are inert in the preview.
- **Publish.**
  - One transaction copies the draft at the stated revision into `published`, together with `published_revision`, `published_at` and the list of images visitors may load.
  - *Unpublish* takes the public page and the public booth pages offline; tickets, reception and check-in keep working.
  - *Discard draft* returns the draft to the published version.
- **Anonymous access.**
  - `GET /api/public/events/{slug}` returns the event plus `page` = the **published** document and its images only.
  - Unpublished events answer exactly like unknown slugs (404) on the event, the booth directory and the booth profile.

---

## 4. Schema and API changes

**Migration `0013_page_studio`** (additive):
- `event_pages`:
  - `event_id` PK/FK, `draft` JSONB, `draft_revision` (≥ 1), `draft_updated_at`;
  - `published` JSONB, `published_revision`, `published_at` (null together, enforced by a check constraint);
  - `published_asset_ids` JSONB.
- `media_assets`:
  - `id`, `event_id` FK (indexed), `content_type`, `width`, `height`, `byte_size`, `sha256`;
  - `storage_key` (unique), `created_at`.

**Compatibility policy.**
- Every event that exists at migration time gets `draft = published =` the pre-Studio layout and stays public, at the same URL. This is proven by `tests/test_page_migration.py`, which seeds a 0012 database and upgrades it.
- New events start with an unpublished draft.

**Endpoints** (all organizer routes use `OwnedEventDep`: another tenant gets 404):

| Method & path | Purpose |
|---|---|
| `GET /api/events/{id}/page` | Page state (draft, revisions, published flags) |
| `PUT /api/events/{id}/page` | `{revision, document}` — save draft, 409 when stale |
| `POST /api/events/{id}/page/publish` | `{revision}` — atomic publish |
| `POST /api/events/{id}/page/unpublish` | Take the page offline |
| `POST /api/events/{id}/page/discard` | `{revision}` — draft returns to published |
| `GET /api/events/{id}/page/preview` | Public payload shape with the draft, plus booths |
| `GET /api/events/{id}/media` | Image library |
| `POST /api/events/{id}/media` | Raw image body |
| `GET /api/events/{id}/media/{asset}/content` | Organizer-only bytes |
| `DELETE /api/events/{id}/media/{asset}` | 409 while the draft or published page uses it |
| `GET /api/public/media/{asset}` | Anonymous; only images of the published page |
| `GET /api/health`, `GET /api/ready` | Probes |
| `GET /api/public/events/{slug}` | Gains `page`; 404 until published |

**Document validation.**
- Pydantic, `extra="forbid"`; discriminated section union; enum layouts, accents and icons.
- Length limits on every text, limits on item counts, at most 24 sections, unique section ids.
- Control characters are stripped.
- Every referenced image must belong to the same event, otherwise 400.

---

## 5. Media persistence

**Intake.**
- Declared type must be PNG, JPEG or WebP; the size limit is streamed (5 MB by default, 413 above it).
- The file is decoded with Pillow, with a decompression-bomb guard and the format re-detected; SVG, GIF, HTML and truncated files get 415.
- The image is **re-encoded** as the same format: EXIF/GPS and comments are dropped, orientation is applied, the first frame of an animation is kept, and the image is scaled to ≤ 2400 px.

**Storage.**
- Files live at `CONGRESS_MEDIA_ROOT/<event_id>/<asset_id>.<ext>`, with generated names only.
- `resolve_storage_path` refuses any key outside the root. Writes are atomic (temp file + fsync + rename).
- Bytes are never stored in the database.
- **Production refuses to start without an absolute media root, which should be a Docker volume.**
- The two storage functions are the seam for object storage later.

**Serving.**
- Headers: `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, `Content-Disposition: inline`.
- Public images: `Cache-Control: public, max-age=3600`. Organizer images: `private, max-age=300`.
- Intrinsic width and height are sent with every page asset, so space is reserved on the page (no layout shift).

**Lifecycle evidence.** In the run, the media volume and the PostgreSQL volume both survived a PostgreSQL container re-creation and an API restart, and the images were served again afterwards.

---

## 6. Persian and English

- Every text slot stores `{fa, en}`.
- The studio edits one *content language* at a time. A badge shows which variants exist, and each empty field says what visitors will see instead.
- Fallback order: visitor's language → the other language (isolated with `<bdi>` / `dir`, so direction and punctuation stay correct) → the platform's own localized wording (or the event's live data for title/description).
- Page language: visitor choice (shared `congress_attendee_locale`) → document `primary_locale` → script of the event name.
- Dates and numerals come from the existing Jalali/Persian and Gregorian formatters.
- One component tree renders both languages; there is no duplicated layout.

---

## 7. Tenant security

- Backend tests:
  - `test_page_studio.py`: cross-tenant read, preview, save, publish, unpublish and discard are all 404, and the draft text never appears in the response; stale-revision conflicts; invalid documents; draft never in the public payload.
  - `test_page_media.py`: cross-tenant upload, list, content and delete are 404; foreign-event image references give 400; SVG/HTML/polyglot uploads are refused; EXIF is stripped; files in use cannot be deleted; path traversal.
- The real lifecycle run confirms organizer B gets 404 on all eight page and media endpoints, and the studio and preview UI refuse B.
- No new authentication: Page Studio uses the existing organizer key and `OwnedEventDep`.

---

## 8. Evidence (`docs/product/page-studio-evidence/`, real API run)

| File | Shows |
|---|---|
| `01-studio-initial-default-page.png` | New event: studio, *Not published*, default layout in preview (**before customization**) |
| `02-studio-brand-and-hero-fa.png` | Brand & hero editing in Persian; cover layout, logo and magenta accent in the live preview |
| `03-studio-sections-reordered-hidden.png` | Custom text block moved up, Passes moved, Highlights hidden, FAQ added |
| `04-anonymous-draft-not-public.png` | Anonymous visitor gets “Event Not Found” for the saved draft |
| `05-studio-preview-{fa,en}-{desktop,mobile}.png` | Authenticated preview in both languages and both devices |
| `06-public-en-desktop.png`, `07-public-fa-desktop.png` | Published page, full length (**after**) |
| `08-public-fa-mobile.png`, `09-public-en-mobile.png` | Published page on a phone |
| `10-studio-draft-ahead-of-live.png` | Edited again: *Draft ahead of live*, public unchanged |
| `11-public-en-after-restart.png`, `13-studio-live-after-restart.png` | After PostgreSQL re-creation and API restart |
| `12-organizer-b-preview-refused.png` | Organizer B refused in the preview |

**Before:** `docs/design/aiteb-redesign/public-event-en-desktop-full.webp`, the fixed template with no organizer control.

---

## 9. Tests run (all on this branch's final code)

| Suite | Result |
|---|---|
| Backend mypy (strict) + pytest, disposable Docker stack (`backend-tests.mjs`) | mypy clean (60 files); **234 passed**; 0 clock steps, 0 `ImmatureSignatureError` |
| Web unit tests (`npm test`) | **63/63** (8 new: fallback, normalisation, add/remove/move rules, anchors, image refs, Markdown-lite safety) |
| TypeScript + production build (`tsc -b`, `vite build`) | Pass |
| Lint (`oxlint`) | 0 errors; 15 warnings, all in pre-existing files (none in new code) |
| Playwright full suite (intercepted APIs, 170 tests) | Run 1: 168 passed, 1 skipped (real-API scanner spec without token), **1 failed**: the organizer-nav contract test still expected 7 items, so it was updated for the new *Public page* item (spec then 13/13). Run 2: 168 passed, 1 skipped, **1 failed**: `attendee-authority.spec.ts` › *owner isolation…* timed out waiting for “Remove Bookmark”. That attendee path has no functional change in this milestone. It is intermittent: whole spec ×3 → 74/75, whole spec ×4 → **100/100**, the test ×10 → 10/10; the base commit `cc7319e` gave 75/75 (×3) and 10/10. Recorded as a timing flake that is **not proven pre-existing**. |
| Focused Page Studio spec (`e2e/page-studio.spec.ts`) | **4/4** |
| Real-API Page Studio lifecycle (`page-studio-e2e.mjs`, production config) | **15/15** |
| Established congress journey (`congress-e2e.mjs`) | **46/46** (new A9 publishes both congresses through the studio UI) + `scanner-real-api.spec.ts` **1 passed** |
| Reality probe (`reality-probe.mjs`, production config) | **10/10** |
| Mobile (`dart test`, `dart analyze`) | 8 passed, no issues (unchanged code) |

---

## 10. Remaining limitations / before Dockerization

- **Social crawlers:** SEO tags are applied client-side. Link previews in apps that do not run JavaScript need server-side `<meta>` injection at the web server (Caddy/nginx or a small SSR shim).
- **One image rendition** (≤ 2400 px), no `srcset`/AVIF variants; no CDN.
- **Unpublished events** also disable the public slug lookup used by `/reception` (operators can use `/reception/<event-id>`) and the attendee portal context `/c/:slug`. Tickets and check-in are unaffected.
- **No section drag-and-drop** (↑/↓ buttons) and no undo history. No scheduled publishing, no version history beyond *discard to published*.
- **Speakers and agenda** are editorial content, not a schedule model.
- **Booth and tier presentation** controls (hide/order an individual booth or tier) are not part of this milestone; the sections show the live lists.
- **Orphaned files:** media deletes remove the row then the file; a crash between the two leaves an orphan file, never a dangling row. There is no garbage collector yet.
- **Before Docker:**
  - API Dockerfile including Pillow (the local test image is synced from `uv.lock` at run time);
  - media volume mount for `CONGRESS_MEDIA_ROOT`;
  - `migrate` one-shot service;
  - web server with `/api` proxy, cache headers and the SEO meta injection above;
  - `.env` with `CONGRESS_ENVIRONMENT=production` and generated secrets;
  - backup of **both** the database and the media volume.

---

## 11. Trying it in the local demo (data kept)

1. Run `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\demo\start.ps1`. It applies migration 0013 **additively** to the existing demo volume: the existing demo congresses become published pages identical to before. It also sets `CONGRESS_ENVIRONMENT=development` and stores uploads in `.demo\media`.
2. Get the organizer key with `scripts\demo\credentials.ps1`, then open `/organizer`. In a congress, open **Public page**.
3. Edit, then *Save draft*. The public page stays unchanged until you click **Publish**. *Discard draft* returns the draft to the published version; *Unpublish* takes the page offline.

Do **not** run `reset.ps1` unless you intend to delete the demo data.

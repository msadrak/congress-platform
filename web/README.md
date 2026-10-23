# Web app (`web/`)

React 19 + TypeScript + Vite single-page app, installable as a PWA, with Tailwind CSS. One build serves every portal:
the B2B home page, the platform console (`/platform`), the organizer console (`/organizer`), public congress pages
(`/e/:slug`), the attendee panel (`/me`, `/c/:slug/*`, SMS pass links `/t/:code`), the front desk (`/reception`), the
exhibitor portal (`/booth/:boothId`) and the **gate scanner** (`/scan/:pointId`). Routes are in `src/App.tsx`; the
portal-by-URL table is in `docs/deployment/STAGING_OPERATIONS.md` (Portals).

Persian (RTL) is the primary language, English the second. Persian UI wording follows the terms in `GLOSSARY.md`
(Persian UI terms); `tests/glossary.test.ts` rejects the misspellings it can detect.

## Commands

```bash
npm ci
npm run dev          # http://localhost:5173, proxies /api to CONGRESS_API_ORIGIN (default http://127.0.0.1:8000)
npm test             # unit tests (node --test, tests/*.test.ts)
npm run lint         # oxlint; warnings fail
npm run build        # tsc -b, then vite build (dist/)
npm run gen:api      # regenerate src/api/schema.d.ts from the backend; CI fails when it is stale
npx playwright test  # browser specs in e2e/ against 127.0.0.1:4174 (see AGENTS.md for the preview and browser options)
```

## Layout

| Path | What |
|---|---|
| `src/pages/` | One component per route; `pages/organizer/` holds the organizer console sections |
| `src/components/` | UI building blocks per area (`scanner/`, `reception/`, `attendee/`, `organizer/`, `public/`, `booth/`, `ui/`) |
| `src/lib/` | Logic without UI: scanner engine and storage (`scanner*.ts`), sessions, i18n, error messages, CSV parsing, dates |
| `src/api/` | `openapi-fetch` client (`client.ts`) and the generated types (`schema.d.ts`, never edited by hand) |
| `tests/` | Unit tests; `e2e/` Playwright specs (mock-backed) |

## Conventions

- **API errors:** decide with `apiErrorCode(error)` and show `localizedApiError(error, locale)`; add every new error code
  to the fa and en maps in `src/lib/errorMessages.ts`. Never branch on the English `detail` (ADR 0022).
- **Scanner:** the manifest holds hashed codes only (`qr_hash`); online scans are decided by the server; offline scans
  are queued in IndexedDB and carry the device's verdict (ADR 0009 status notes). A backend upgrade needs every gate
  device on the new build (`docs/release/07-CONGRESS-DAY-RUNBOOK.md` §3).
- **PWA updates** use `registerType: 'prompt'`: a new version is offered by a banner and applied only when the user taps
  it, so an operator is never switched to new code mid-shift. The service worker caches the app shell, never API
  responses or tokens.
- Coding standards: `docs/CODING_STANDARDS.md` §1.

# Coding Standards & Guardrails

This document records the engineering standards and patterns enforced across the repository.

Mechanical rules live in checks, not here: no `any` (oxlint `typescript/no-explicit-any`), static routes before parameterized siblings (`backend/tests/test_route_order.py`), strict mypy, clean `dart analyze`, oxlint warnings, and API types matching the backend (`scripts/gen-api.mjs --check`). `scripts/check.*` and CI run them all.

---

## 1. TypeScript & React Standards (`web/`)

### A. Prefer `Promise.withResolvers()` over `new Promise((resolve, reject) => ...)`
- **Rule:** When creating deferred promises or wrapping callback APIs (such as IndexedDB requests), use `const { promise, resolve, reject } = Promise.withResolvers<T>()`.
- **Why:** Avoids nested callback closures and keeps asynchronous control flow flat and linear.

### B. String-Keyed Lookups: `Record<string, V>` vs `Map`
- **Rule:** Use `Record<string, V>` for string-keyed object lookup tables (e.g., in-memory ticket caches, dictionary lookups).
- **Why:** Faster serialization, native JSON compatibility, and predictable object property access without `Map.get()` indirection. Use `Set` / `Map` only when non-string keys or `.size` / `.clear()` iterator APIs are strictly necessary.

### C. No Trivial One-Line Wrappers (`ts-no-tiny-functions`)
- **Rule:** Do not write single-line wrapper functions that merely call a standard library method (e.g. `const getStoredKey = () => sessionStorage.getItem(KEY)`).
- **Why:** Adds call indirection without providing an abstraction contract. Call `sessionStorage.getItem(STORAGE_KEY)` directly or encapsulate within a stateful hook.

### D. No Inline Cast Access (`ts-no-inline-cast-access`)
- **Rule:** Avoid inline-casting an object type for property access: `(value as { foo: string }).foo`.
- **Why:** Fabricates an unchecked shape and suppresses compiler errors. Check with `"foo" in value` first, then access. Without `any`, narrow with custom type guards or extended interfaces for globals (e.g. `interface WindowWithAudio extends Window`).

---

## 2. Python & FastAPI Standards (`backend/`)

### A. Single Primary Testing Seam: The HTTP Boundary
- **Rule:** Automated tests must verify external system behavior through the FastAPI HTTP boundary (`httpx.AsyncClient`) against a real PostgreSQL test database migrated with Alembic.
- **Why:** Tests what real clients experience without coupling test suites to internal class wiring or fragile private mocks.

### B. Environment-First Configuration
- **Rule:** Configuration values (database DSN, admin tokens, CORS origins) must be defined in `app/config.py` using `pydantic-settings` with `CONGRESS_` prefixes. Hardcoded secrets in production code are prohibited.

### C. Unique Slugs in Multi-Event Test Fixtures
- **Rule:** When writing tests that provision more than one event, every secondary event must randomize or parameterize its slug (e.g. `f"event-b-{uuid.uuid4().hex[:6]}"`).
- **Why:** Global unique constraints on `events.slug` reject duplicate slugs with `409 Conflict`. Reusing static dictionary fixtures across multiple events causes unforced test failures.

### F. Stable Error Codes (`app/errors.py`)
- **Rule:** An error a client must react to or show to a person is raised as `ApiError(status, "UPPER_SNAKE_CODE", "English message")`, and the route declares it with `responses=error_responses(...)` so the OpenAPI document and `web/src/api/schema.d.ts` describe the body. The response is `{"detail": "<English message>", "code": "<CODE>"}`; `detail` stays a string, plain `HTTPException`s keep answering `{"detail": ...}`, and 422 validation bodies are unchanged.
- **Naming:** `SUBJECT_STATE` in upper snake case, describing what happened rather than the status (`TIER_SOLD_OUT`, `TIER_CLOSED`, `ALREADY_REGISTERED`, `EVENT_NOT_FOUND`). A code is a contract: never rename or reuse one; keep its status and `detail` stable when converting an existing error.
- **Web:** decide with `apiErrorCode(error)` and show `localizedApiError(error, locale)` (both in `web/src/api/client.ts`); add every new code to the fa and en maps in `web/src/lib/errorMessages.ts`. Never match or branch on the English `detail` text.
- **Why:** Persian readers must not see raw English, and UI behaviour must not break when a message is reworded.

---

## 3. Flutter & Dart Standards (`mobile/`)

### A. Pure Business Logic Separation
- **Rule:** Core domain logic (e.g., `PolicyEngine`) must remain pure Dart with zero Flutter widget or DOM dependencies so it can be verified in milliseconds via `dart test`.

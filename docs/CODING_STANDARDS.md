# Coding Standards & Guardrails

This document records the engineering standards and patterns enforced across the repository.

---

## 1. TypeScript & React Standards (`web/`)

### A. Prefer `Promise.withResolvers()` over `new Promise((resolve, reject) => ...)`
- **Rule:** When creating deferred promises or wrapping callback APIs (such as IndexedDB requests), use `const { promise, resolve, reject } = Promise.withResolvers<T>()`.
- **Why:** Avoids nested callback closures and keeps asynchronous control flow flat and linear.

### B. String-Keyed Lookups: `Record<string, V>` vs `Map`
- **Rule:** Use `Record<string, V>` for string-keyed object lookup tables (e.g., in-memory ticket caches, dictionary lookups).
- **Why:** Faster serialization, native JSON compatibility, and predictable object property access without `Map.get()` indirection. Use `Set` / `Map` only when non-string keys or `.size` / `.clear()` iterator APIs are strictly necessary.

### C. Zero `any` or `as any`
- **Rule:** Never use `: any` or `as any`.
- **Why:** Bypasses compile-time type safety. Use:
  - Custom type guards (e.g., `function isPolicyType(val: string): val is PolicyType`).
  - Schema narrowing (`typeof val === "object" && val !== null && "field" in val`).
  - Extended interfaces for global objects (e.g., `interface WindowWithAudio extends Window`).

### D. No Trivial One-Line Wrappers (`ts-no-tiny-functions`)
- **Rule:** Do not write single-line wrapper functions that merely call a standard library method (e.g. `const getStoredKey = () => sessionStorage.getItem(KEY)`).
- **Why:** Adds call indirection without providing an abstraction contract. Call `sessionStorage.getItem(STORAGE_KEY)` directly or encapsulate within a stateful hook.

### E. No Inline Cast Access (`ts-no-inline-cast-access`)
- **Rule:** Avoid inline-casting an object type for property access: `(value as { foo: string }).foo`.
- **Why:** Fabricates an unchecked shape and suppresses compiler errors. Check with `"foo" in value` first, then access.

---

## 2. Python & FastAPI Standards (`backend/`)

### A. Strict Type Annotations
- **Rule:** All backend modules, dependencies, and test helpers must pass `uv run mypy` in strict mode with zero errors.
- **Why:** Guarantees runtime stability and automatic OpenAPI schema accuracy.

### B. Single Primary Testing Seam: The HTTP Boundary
- **Rule:** Automated tests must verify external system behavior through the FastAPI HTTP boundary (`httpx.AsyncClient`) against a real PostgreSQL test database migrated with Alembic.
- **Why:** Tests what real clients experience without coupling test suites to internal class wiring or fragile private mocks.

### C. Environment-First Configuration
- **Rule:** Configuration values (database DSN, admin tokens, CORS origins) must be defined in `app/config.py` using `pydantic-settings` with `CONGRESS_` prefixes. Hardcoded secrets in production code are prohibited.

---

## 3. Flutter & Dart Standards (`mobile/`)

### A. Zero Unused Imports & Clean Analysis
- **Rule:** All Dart code in `mobile/` must pass `dart analyze` with zero warnings or hints.

### B. Pure Business Logic Separation
- **Rule:** Core domain logic (e.g., `PolicyEngine`) must remain pure Dart with zero Flutter widget or DOM dependencies so it can be verified in milliseconds via `dart test`.

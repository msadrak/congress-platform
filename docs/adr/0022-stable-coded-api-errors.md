# 0022: Stable, Coded API Errors

**Status:** Accepted (2026-10-23). Implemented by the foundations workstream (W0): `backend/app/errors.py`,
`web/src/api/client.ts`, `web/src/lib/errorMessages.ts`; rule in `docs/CODING_STANDARDS.md` §2.F.

## Context
The API answered errors as `{"detail": "<English sentence>"}`, and the web app decided what to do by matching those
sentences ("sold out", "not found") and showed them as they were. Persian readers saw raw English, and rewording a
message on the server silently broke behaviour in the client (for example, whether to reload tier availability after a
failed reservation). Clients need something machine-readable that never changes, while existing clients that read
`detail` must keep working.

## Decision
1. **`ApiError(status, "UPPER_SNAKE_CODE", "English message")`** is answered as
   `{"detail": "<English message>", "code": "<CODE>"}`. `detail` stays a plain string, so older clients are unaffected.
   A plain `HTTPException` still answers `{"detail": …}`, and 422 validation bodies are unchanged.
2. **Routes declare what they can answer** with `responses=error_responses(...)`, so the OpenAPI document and the
   generated `web/src/api/schema.d.ts` describe the error body (`ErrorResponse`).
3. **Naming:** `SUBJECT_STATE`, describing what happened rather than the HTTP status (`TIER_SOLD_OUT`,
   `REGISTRATION_CLOSED`, `OTP_RATE_LIMITED`, `LINK_REVOKED`, `ROLE_FORBIDDEN`, `PARTICIPANT_HAS_HISTORY`). **A code is a
   contract:** never renamed or reused, and when an existing error is converted its status and `detail` stay the same.
4. **The web decides by code and shows text by code:** `apiErrorCode(error)` reads the code, `localizedApiError(error,
   locale)` shows the Persian or English message from `errorMessages` and falls back to the server's text for an unknown
   code; network failures map to `NETWORK_UNREACHABLE`. Nothing branches on the English `detail`.
5. **Guards:** `web/tests/apiErrorCodes.test.ts` checks that every listed code has both a Persian and an English message
   and that unknown codes fall back safely; CI fails when `schema.d.ts` is stale (`gen-api --check`).

## Consequences
- Server wording can change freely; behaviour and translations follow the code.
- A new error a client must react to needs three things in one change: the `ApiError` with its code, the route's
  `error_responses`, and fa/en entries in `errorMessages.ts` (AGENTS.md repeats the rule).
- Errors still raised as plain `HTTPException` show the English `detail` until they are converted; conversion is done
  route by route as they are touched.
- Rate-limit refusals (ADR 0019), lifecycle conflicts (ADR 0017), short-link refusals (ADR 0015) and role refusals
  (ADR 0016) all use this format, so the attendee, desk and organizer UIs can explain them in the reader's language.

/**
 * Scanner session authorization policy.
 *
 * Single source of truth for the bounded offline operating window required by
 * Task 05C Phase 4. Both the offline admission gate (GateScanner) and the
 * automated tests consume these helpers, so policy changes stay in lockstep.
 *
 * Policy:
 * - Maximum offline operating window: 24 hours since the last successful
 *   manifest fetch (full or delta). A batch sync proves the server is reachable
 *   but says nothing about new or cancelled tickets, so it does not extend it.
 * - Validation inputs: persisted credential metadata (token issued/expiry)
 *   and manifest freshness (time of the last successful manifest fetch).
 * - Enforcement: `evaluateOfflineAuthorization` returns a verdict the UI
 *   consumes — `ok: true` admits locally, `ok: false` blocks new admissions
 *   while preserving every outstanding record for controlled recovery.
 */

export const MAX_OFFLINE_WINDOW_MS = 24 * 60 * 60 * 1000;

export type OfflineAuthReason =
  | "ONLINE"
  | "WITHIN_WINDOW"
  | "TOKEN_INVALID"
  | "TOKEN_EXPIRED"
  | "MANIFEST_STALE"
  | "NO_BASELINE";

export interface OfflineAuthVerdict {
  ok: boolean;
  reason: OfflineAuthReason;
  /** Milliseconds since the last manifest fetch, or null when no baseline exists. */
  offlineForMs: number | null;
  /** Remaining window in ms before expiry (0 when expired). */
  remainingMs: number;
}

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Evaluate whether local admissions are permitted right now.
 *
 * @param nowMs - current time in epoch ms (injectable for tests).
 * @param opts - token expiry and the time of the last manifest fetch.
 */
export function evaluateOfflineAuthorization(
  nowMs: number,
  opts: {
    /** ISO timestamp of scanner JWT `exp` claim, if known. */
    tokenExpiresAt?: string | null;
    /** ISO timestamp of the last successful manifest fetch, if known. */
    manifestFetchedAt?: string | null;
    /** Whether the browser currently reports online (never an authorization bypass). */
    isOnline?: boolean;
  } = {}
): OfflineAuthVerdict {
  // A missing or expired credential is never authorized, even when online.
  const expMs = parseTime(opts.tokenExpiresAt);
  if (expMs === null) {
    return { ok: false, reason: "TOKEN_INVALID", offlineForMs: null, remainingMs: 0 };
  }
  if (nowMs >= expMs) {
    return { ok: false, reason: "TOKEN_EXPIRED", offlineForMs: null, remainingMs: 0 };
  }
  // Browser online state is only a display hint. Authorization always requires
  // a manifest fetched within the window.
  const baselineMs = parseTime(opts.manifestFetchedAt);
  if (baselineMs === null) {
    return { ok: false, reason: "NO_BASELINE", offlineForMs: null, remainingMs: 0 };
  }

  const offlineForMs = Math.max(0, nowMs - baselineMs);
  if (offlineForMs >= MAX_OFFLINE_WINDOW_MS) {
    return { ok: false, reason: "MANIFEST_STALE", offlineForMs, remainingMs: 0 };
  }
  return {
    ok: true,
    reason: opts.isOnline ? "ONLINE" : "WITHIN_WINDOW",
    offlineForMs,
    remainingMs: MAX_OFFLINE_WINDOW_MS - offlineForMs,
  };
}

/** How recently a request must have succeeded for the scanner to ask the server first. */
export const SERVER_CONTACT_FRESH_MS = 45_000;

/**
 * Whether scans go to the server (online) or are decided locally (offline). `navigator.onLine` alone
 * says nothing about a captive portal or a dead backend: the scanner is online only when its latest
 * request succeeded, recently (the 30 s manifest poll keeps that fresh).
 */
export function isServerReachable(
  nowMs: number,
  opts: { browserOnline: boolean; lastSuccessAt: number | null; lastFailureAt: number | null }
): boolean {
  if (!opts.browserOnline || opts.lastSuccessAt === null) return false;
  if (opts.lastFailureAt !== null && opts.lastFailureAt >= opts.lastSuccessAt) return false;
  return nowMs - opts.lastSuccessAt < SERVER_CONTACT_FRESH_MS;
}

/**
 * Decode the `exp` claim (seconds) of a JWT without verifying its signature.
 * Signature verification stays server-side; this is display/enforcement input only.
 */
export function getJwtExpiryIso(token: string | null | undefined): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payloadJson = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(payloadJson) as { exp?: unknown };
    if (typeof payload.exp !== "number") return null;
    return new Date(payload.exp * 1000).toISOString();
  } catch {
    return null;
  }
}

/** Human-readable remaining-window label, e.g. "23h 12m" or "expired". */
export function formatRemainingWindow(remainingMs: number): string {
  if (remainingMs <= 0) return "expired";
  const totalMinutes = Math.floor(remainingMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

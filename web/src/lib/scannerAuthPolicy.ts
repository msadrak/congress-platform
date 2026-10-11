/**
 * Scanner session authorization policy.
 *
 * Single source of truth for the bounded offline operating window required by
 * Task 05C Phase 4. Both the offline admission gate (GateScanner) and the
 * automated tests consume these helpers, so policy changes stay in lockstep.
 *
 * Policy:
 * - Maximum offline operating window: 24 hours since the last successful
 *   server contact (manifest refresh OR batch sync), whichever is later.
 * - Validation inputs: persisted credential metadata (token issued/expiry)
 *   and manifest freshness (`cached_at` from IndexedDB).
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
  /** Milliseconds since last server contact, or null when no baseline exists. */
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
 * @param opts - token expiry, last server contact, and manifest age.
 */
export function evaluateOfflineAuthorization(
  nowMs: number,
  opts: {
    /** ISO timestamp of scanner JWT `exp` claim, if known. */
    tokenExpiresAt?: string | null;
    /** ISO timestamp of last successful server contact (manifest or sync). */
    lastServerContactAt?: string | null;
    /** ISO timestamp of cached manifest (`cached_at`), if known. */
    manifestCachedAt?: string | null;
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
  // a recent successful server contact or a fresh cached manifest.

  // The window baseline is the freshest proof of server contact.
  const contactMs = parseTime(opts.lastServerContactAt);
  const manifestMs = parseTime(opts.manifestCachedAt);
  const baselineMs =
    contactMs !== null && manifestMs !== null
      ? Math.max(contactMs, manifestMs)
      : contactMs ?? manifestMs;

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

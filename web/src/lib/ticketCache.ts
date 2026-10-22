/**
 * Owner-Scoped Offline Ticket Cache (Issue #16)
 *
 * Threat Model & Security Posture:
 * 1. Web Storage (localStorage) is plaintext client-side storage. It provides NO encryption at rest.
 * 2. On shared devices (e.g. library, internet cafe, borrowed phone), unscoped cache keys permit
 *    subsequent users to inspect prior attendees' full names, mobile numbers, and reusable QR secrets.
 * 3. This module implements owner-scoping: cached ticket envelopes are strictly partitioned by the
 *    authenticated attendee's stable User UUID (extracted from the JWT `sub` claim).
 * 4. Failing Closed: Unauthenticated callers (token missing or invalid) CANNOT access any cached tickets.
 * 5. Account Transitions: Switching accounts or logging out prevents cross-user credential disclosure.
 * 6. Offline Presentation: Legitimate offline badge presentation is preserved because the local JWT
 *    persists the owner's identity, allowing offline verification against the owner's scoped cache key.
 */

import type { AttendeeTicketDetail } from "../api/client";

export const CACHED_TICKETS_KEY_PREFIX = "congress_cached_tickets_";
export const LEGACY_CACHED_TICKETS_KEY = "congress_cached_tickets";
/** The owner of the last saved cache, so a sign-out still finds it after the token was removed. */
export const CACHED_TICKETS_OWNER_KEY = "congress_ticket_cache_owner";

// Default TTL: 7 days
export const DEFAULT_TICKET_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface OfflineTicketEnvelope {
  userId: string;
  cachedAt: number; // Unix epoch ms
  expiresAt: number; // Unix epoch ms
  tickets: AttendeeTicketDetail[];
}

export type CacheLoadResult =
  | { status: "valid"; userId: string; tickets: AttendeeTicketDetail[]; cachedAt: number }
  | { status: "unauthorized"; reason: string; tickets: [] }
  | { status: "expired"; userId: string; reason: string; tickets: [] }
  | { status: "empty"; userId: string; tickets: [] };

/**
 * Safely parse a JWT payload to extract user claims without external dependencies.
 */
export function extractJwtClaims(token: string | null | undefined): { sub?: string; exp?: number } | null {
  if (!token || typeof token !== "string") return null;
  try {
    const parts = token.trim().split(".");
    if (parts.length < 2) return null;
    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
    const jsonStr = atob(padded);
    const payload = JSON.parse(jsonStr);
    if (typeof payload === "object" && payload !== null) {
      return payload as { sub?: string; exp?: number };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Extract the stable user UUID from an access token.
 */
export function getAuthenticatedUserId(token: string | null | undefined): string | null {
  const claims = extractJwtClaims(token);
  if (!claims?.sub || typeof claims.sub !== "string" || claims.sub.trim().length === 0) {
    return null;
  }
  return claims.sub.trim();
}

function resolveStorage(customStorage?: Storage | null): Storage | null {
  if (customStorage !== undefined) return customStorage;
  if (typeof window !== "undefined" && window.localStorage) {
    return window.localStorage;
  }
  return null;
}

/**
 * Purge legacy unscoped cache keys to prevent data leakage from older versions.
 */
export function purgeLegacyUnscopedCache(customStorage?: Storage | null): void {
  const storage = resolveStorage(customStorage);
  if (!storage) return;
  try {
    storage.removeItem(LEGACY_CACHED_TICKETS_KEY);
  } catch {
    // ignore
  }
}

/**
 * Load cached tickets strictly scoped to the authenticated user ID.
 * FAILS CLOSED: Returns status="unauthorized" if no valid token or user ID is present.
 */
export function loadOwnerScopedTickets(
  token: string | null | undefined,
  now: number = Date.now(),
  customStorage?: Storage | null
): CacheLoadResult {
  const storage = resolveStorage(customStorage);
  purgeLegacyUnscopedCache(storage);

  if (!storage) {
    return { status: "unauthorized", reason: "Storage unavailable", tickets: [] };
  }

  const userId = getAuthenticatedUserId(token);
  if (!userId) {
    return {
      status: "unauthorized",
      reason: "No authenticated session. Unauthenticated access to cached credentials is prohibited.",
      tickets: [],
    };
  }

  const cacheKey = `${CACHED_TICKETS_KEY_PREFIX}${userId}`;
  let raw: string | null = null;
  try {
    raw = storage.getItem(cacheKey);
  } catch {
    return { status: "empty", userId, tickets: [] };
  }

  if (!raw) {
    return { status: "empty", userId, tickets: [] };
  }

  try {
    const envelope: OfflineTicketEnvelope = JSON.parse(raw);

    // Verify envelope integrity and ownership
    if (!envelope || typeof envelope !== "object" || envelope.userId !== userId || !Array.isArray(envelope.tickets)) {
      // Invalidate malformed or mismatched cache
      storage.removeItem(cacheKey);
      return { status: "unauthorized", reason: "Mismatched or invalid cache ownership envelope.", tickets: [] };
    }

    // Check expiration
    if (typeof envelope.expiresAt === "number" && now > envelope.expiresAt) {
      storage.removeItem(cacheKey);
      return { status: "expired", userId, reason: "Cached ticket passes have expired.", tickets: [] };
    }

    return {
      status: "valid",
      userId,
      tickets: envelope.tickets,
      cachedAt: envelope.cachedAt || now,
    };
  } catch {
    storage.removeItem(cacheKey);
    return { status: "empty", userId, tickets: [] };
  }
}

/**
 * Persist tickets under an owner-scoped envelope.
 */
export function saveOwnerScopedTickets(
  token: string | null | undefined,
  tickets: AttendeeTicketDetail[],
  now: number = Date.now(),
  ttlMs: number = DEFAULT_TICKET_CACHE_TTL_MS,
  customStorage?: Storage | null
): boolean {
  const storage = resolveStorage(customStorage);
  purgeLegacyUnscopedCache(storage);

  if (!storage) return false;

  const userId = getAuthenticatedUserId(token);
  if (!userId) return false;

  const cacheKey = `${CACHED_TICKETS_KEY_PREFIX}${userId}`;
  const envelope: OfflineTicketEnvelope = {
    userId,
    cachedAt: now,
    expiresAt: now + ttlMs,
    tickets,
  };

  try {
    storage.setItem(cacheKey, JSON.stringify(envelope));
    storage.setItem(CACHED_TICKETS_OWNER_KEY, userId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Clear the ticket cache upon logout or session rejection: the owner named by `userIdOrToken` and the
 * remembered owner of the last saved cache. With no (or an unreadable) token, the remembered owner is
 * still cleared, so passes never outlive a token that was removed first.
 */
export function clearOwnerScopedTickets(
  userIdOrToken: string | null | undefined,
  customStorage?: Storage | null
): void {
  const storage = resolveStorage(customStorage);
  purgeLegacyUnscopedCache(storage);

  if (!storage) return;

  // Determine if passed argument is a JWT token or a raw userId
  const userId = !userIdOrToken
    ? null
    : userIdOrToken.includes(".") ? getAuthenticatedUserId(userIdOrToken) : userIdOrToken;

  try {
    const remembered = storage.getItem(CACHED_TICKETS_OWNER_KEY);
    for (const owner of [userId, remembered]) {
      if (owner) storage.removeItem(`${CACHED_TICKETS_KEY_PREFIX}${owner}`);
    }
    storage.removeItem(CACHED_TICKETS_OWNER_KEY);
  } catch {
    // ignore
  }
}

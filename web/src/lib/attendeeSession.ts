/**
 * The attendee session: one stored token (localStorage, shared by every tab) and the owner-scoped
 * offline passes cached for it (lib/ticketCache.ts).
 *
 * Policy (the only place it is decided):
 * 1. A 401 for the token that is still stored removes the token AND that owner's cached passes. The
 *    API client does this for every `user` request (`registerUnauthorizedHandler` below), so pages
 *    only render the outcome (`attendeeResponseState`).
 * 2. A 401 for a token that is no longer stored (another tab signed in, out or switched accounts) is
 *    ignored: a newer session is never deleted by a late response.
 * 3. Signing out removes the token and the cached passes, even when the token was removed first.
 * 4. The one exception: My Tickets, given a 401 while it already shows the owner's cached pass, keeps
 *    the token so the pass stays on screen labelled "session expired" (and "Log out" stays offered)
 *    until the attendee signs out or another page meets the same 401 (`keepPassOnExpiredSession`).
 *    The kept token authorizes nothing more: My Tickets stops sending it.
 */
import { ATTENDEE_TOKEN_STORAGE, registerUnauthorizedHandler } from "../api/client.ts";
import { clearOwnerScopedTickets, getAuthenticatedUserId } from "./ticketCache.ts";
import type { AttendeeLocale } from "./i18n";

export function sessionChangedMessage(locale: AttendeeLocale): string {
  return locale === "fa"
    ? "نشست شما در زبانه دیگری تغییر کرد. لطفاً این صفحه را دوباره بارگذاری کنید."
    : "Your attendee session changed in another tab. Please reload this page.";
}

const listeners = new Set<() => void>();
/** Tokens this tab rejected, so a page can tell "expired" from "changed in another tab". */
const rejectedTokens: Record<string, true> = {};
/** This tab's session ended with a 401 (not a sign-out); cleared by the next sign-in or sign-out. */
let endedByRejection = false;

function notify(): void {
  for (const listener of listeners) listener();
}

/** The stored token, or null (no session, no window, or storage unavailable). */
export function readAttendeeToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(ATTENDEE_TOKEN_STORAGE);
  } catch {
    return null;
  }
}

/**
 * `useSyncExternalStore` subscription: this tab's own changes (sign-in, sign-out, rejection) and
 * another tab's, which only arrive as a `storage` event.
 */
export function subscribeAttendeeSession(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === ATTENDEE_TOKEN_STORAGE) onChange();
  };
  listeners.add(onChange);
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

/**
 * A rendered token can outlive the stored session: another tab may sign in, out or switch
 * accounts. Callers capture the token they use and ask whether it is still the stored one
 * before dispatching a request and before applying its response.
 */
export function isStoredAttendeeToken(token: string): boolean {
  return readAttendeeToken() === token;
}

/**
 * True while there is no session because a 401 ended this tab's. Pages show "session expired" from
 * this store state: the rejection re-renders them (ending their in-flight effects) before their own
 * response handling runs.
 */
export function isAttendeeSessionExpired(): boolean {
  return endedByRejection && readAttendeeToken() === null;
}

/** Stores a freshly issued token. Another owner's cached passes never survive an account switch. */
export function storeAttendeeToken(token: string): void {
  const previous = readAttendeeToken();
  if (previous !== null && previous !== token && getAuthenticatedUserId(previous) !== getAuthenticatedUserId(token)) {
    clearOwnerScopedTickets(previous);
  }
  delete rejectedTokens[token];
  endedByRejection = false;
  localStorage.setItem(ATTENDEE_TOKEN_STORAGE, token);
  notify();
}

/** Explicit sign-out on this device: the token and every cached pass go (policy 3). */
export function signOutAttendee(): void {
  clearOwnerScopedTickets(readAttendeeToken());
  endedByRejection = false;
  try {
    localStorage.removeItem(ATTENDEE_TOKEN_STORAGE);
  } catch {
    // storage unavailable: nothing was stored
  }
  notify();
}

/**
 * Invalidates the session after a 401 for `token` (policy 1 and 2). Only that exact credential and
 * its owner's cached passes are removed; a newer session stored by another tab is left alone.
 * Returns whether the token was the stored one.
 */
export function rejectAttendeeToken(token: string): boolean {
  if (!isStoredAttendeeToken(token)) return false;
  rejectedTokens[token] = true;
  endedByRejection = true;
  clearOwnerScopedTickets(token);
  localStorage.removeItem(ATTENDEE_TOKEN_STORAGE);
  notify();
  return true;
}

/**
 * Policy 4, My Tickets only: after a 401 for the ticket list, keep the session while the owner's cached
 * pass is on screen (returns true: label it "session expired"); otherwise reject it as everywhere else.
 */
export function keepPassOnExpiredSession(token: string, hasCachedPass: boolean): boolean {
  if (hasCachedPass && isStoredAttendeeToken(token)) return true;
  rejectAttendeeToken(token);
  return false;
}

/**
 * How a page should treat a response for the token it sent:
 * - "current": the token is still the stored session; apply the response.
 * - "expired": a 401 for the session this tab held (already removed by the API client); show the
 *   signed-out state, the page re-renders without a token.
 * - "changed": the stored session changed meanwhile; ignore the response.
 */
export function attendeeResponseState(token: string, status: number): "current" | "expired" | "changed" {
  const stored = isStoredAttendeeToken(token);
  if (status === 401 && (stored || Object.hasOwn(rejectedTokens, token))) return "expired";
  return stored ? "current" : "changed";
}

// Every attendee page imports this module (directly or through useAttendeeSession), so every
// `user` client's 401 reaches the policy above.
registerUnauthorizedHandler("user", rejectAttendeeToken);

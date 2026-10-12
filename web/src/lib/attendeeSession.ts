import { ATTENDEE_TOKEN_STORAGE } from "../api/client";

export const SESSION_CHANGED_MESSAGE =
  "Your attendee session changed in another tab. Please reload this page.";

/**
 * A rendered token can outlive the stored session: another tab may sign in, out or switch
 * accounts. Callers capture the token they use and ask whether it is still the stored one
 * before dispatching a request and before applying its response.
 */
export function isStoredAttendeeToken(token: string): boolean {
  return typeof window !== "undefined" && localStorage.getItem(ATTENDEE_TOKEN_STORAGE) === token;
}

/**
 * Invalidate the session after a 401 for `token`. Removes only that exact credential; a newer
 * session stored by another tab, and every other credential family, is left alone.
 * The owner-scoped ticket cache is deliberately not touched (only explicit logout clears it).
 */
export function rejectAttendeeToken(token: string): void {
  if (isStoredAttendeeToken(token)) localStorage.removeItem(ATTENDEE_TOKEN_STORAGE);
}

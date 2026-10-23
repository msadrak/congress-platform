import { useSyncExternalStore } from "react";
import { ATTENDEE_TOKEN_STORAGE } from "../api/client";
import type { AttendeeLocale } from "./i18n";

export function sessionChangedMessage(locale: AttendeeLocale): string {
  return locale === "fa"
    ? "نشست شما در زبانه دیگری تغییر کرد. لطفاً این صفحه را دوباره بارگذاری کنید."
    : "Your attendee session changed in another tab. Please reload this page.";
}

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

/** Another tab signing in or out changes the stored token; this tab only hears it as a `storage` event. */
function subscribeToStorage(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

/**
 * The stored attendee token, re-read on every render and on another tab's change, so public pages
 * never offer "my pass" to nobody or "sign in" to someone already signed in.
 */
export function useAttendeeToken(): string | null {
  return useSyncExternalStore(subscribeToStorage, () => localStorage.getItem(ATTENDEE_TOKEN_STORAGE), () => null);
}

import { apiErrorCode, formatApiError, localizedApiError } from "../api/client";
import type { AttendeeLocale } from "./i18n";

/**
 * An attendee-facing API error in the reader's language: the coded message when the error has a known code;
 * otherwise the server's text in English and `null` in Persian (the caller shows its own Persian sentence),
 * so a Persian reader never sees raw English.
 */
export function readableApiError(error: unknown, locale: AttendeeLocale): string | null {
  if (apiErrorCode(error) !== undefined) return localizedApiError(error, locale);
  return locale === "fa" ? null : formatApiError(error);
}

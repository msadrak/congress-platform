/**
 * The dates on an attendee's pass, read in the congress's own time zone (`event_timezone`, an IANA name) so a
 * congress that starts at midnight in Tehran does not read as a day earlier on a phone in Europe. A missing or
 * unknown zone (a pass saved before the server sent one) falls back to the device's own zone, as before.
 * Pure (no DOM, no React), so it is unit tested under `node --test`.
 */

import { formatDate, formatDateRange } from "./format.ts";
import type { AttendeeLocale } from "./i18n.ts";

/** Compact range ("10–12 April 2027"); Solar Hijri for Persian, matching `formatLocalizedDate`. */
export function formatPassDateRange(startsAt: string, endsAt: string, locale: AttendeeLocale, timeZone?: string | null): string {
  return formatDateRange(startsAt, endsAt, locale, timeZone);
}

/** The day a pass was issued, as it was in the congress's zone. */
export function formatPassIssuedDate(issuedAt: string, locale: AttendeeLocale, timeZone?: string | null): string {
  return formatDate(issuedAt, "day", locale, timeZone);
}

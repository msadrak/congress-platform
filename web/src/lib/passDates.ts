/**
 * The dates on an attendee's pass, read in the congress's own time zone (`event_timezone`, an IANA name) so a
 * congress that starts at midnight in Tehran does not read as a day earlier on a phone in Europe. A missing or
 * unknown zone (a pass saved before the server sent one) falls back to the device's own zone, as before.
 * Pure (no DOM, no React), so it is unit tested under `node --test`.
 */

import { safeTimeZone } from "./congressPhase.ts";
import { formatLocalizedDate, type AttendeeLocale } from "./i18n.ts";

/** Compact range ("10–12 April 2027"); Solar Hijri for Persian, matching `formatLocalizedDate`. */
export function formatPassDateRange(startsAt: string, endsAt: string, locale: AttendeeLocale, timeZone?: string | null): string {
  const starts = new Date(startsAt);
  const ends = new Date(endsAt);
  if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime())) return `${startsAt} – ${endsAt}`;
  const fmt = new Intl.DateTimeFormat(locale === "fa" ? "fa-IR-u-ca-persian" : "en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: safeTimeZone(timeZone),
  });
  try {
    return fmt.formatRange(starts, ends);
  } catch {
    return `${fmt.format(starts)} – ${fmt.format(ends)}`;
  }
}

/** The day a pass was issued, as it was in the congress's zone. */
export function formatPassIssuedDate(issuedAt: string, locale: AttendeeLocale, timeZone?: string | null): string {
  return formatLocalizedDate(issuedAt, locale, safeTimeZone(timeZone));
}

import { daysBetween } from "../../lib/congressPhase";
import { formatDate, formatDateRange as formatRange, zonedDayKey } from "../../lib/format";
import { asciiDigits } from "../../lib/mobile";
import type { PublicLocale } from "./copy";

function valid(d: Date) {
  return !Number.isNaN(d.getTime());
}

/**
 * Every helper takes the congress's IANA `timeZone`: dates and clock times are the venue's, wherever the
 * visitor is (the visitor's own zone when it is missing or unknown to the runtime). Dates and times come from
 * `lib/format.ts`.
 */

/** "12–26 October 2026" / "۱۲ تا ۱۴ آبان ۱۴۰۵" in the calendar of the page language. */
export function formatDateRange(startIso: string, endIso: string, locale: PublicLocale, timeZone?: string): string {
  if (!valid(new Date(startIso))) return startIso;
  return valid(new Date(endIso)) ? formatRange(startIso, endIso, locale, timeZone) : formatDate(startIso, "long", locale, timeZone);
}

/** "Mon 12 Oct, 15:44" / «دوشنبه ۲۰ مهر، ۱۵:۴۴» in the page language, at the venue. */
export function formatMoment(iso: string, locale: PublicLocale, timeZone?: string): string {
  return formatDate(iso, "dayTime", locale, timeZone);
}

/** Calendar days covered by the congress, counted at the venue. */
export function calendarDays(startIso: string, endIso: string, timeZone?: string): number {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (!valid(start) || !valid(end) || end < start) return 1;
  return daysBetween(zonedDayKey(start, timeZone), zonedDayKey(end, timeZone)) + 1;
}

export type CongressTiming = { kind: "live" } | { kind: "ended" } | { kind: "upcoming"; days: number };

/** Live, ended, or calendar days (at the venue) until the opening day. */
export function congressTiming(startIso: string, endIso: string, now = Date.now(), timeZone?: string): CongressTiming {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (now >= end) return { kind: "ended" };
  if (now >= start) return { kind: "live" };
  return { kind: "upcoming", days: Math.max(0, daysBetween(zonedDayKey(now, timeZone), zonedDayKey(start, timeZone))) };
}

/** Search text as typed on any keyboard: Persian/Arabic digits and Arabic yeh/kaf match their Persian forms. */
export function searchText(text: string): string {
  return asciiDigits(text).replace(/ي/g, "ی").replace(/ك/g, "ک").toLowerCase();
}

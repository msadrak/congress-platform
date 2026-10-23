import { daysBetween, safeTimeZone, zonedDayKey } from "../../lib/congressPhase";
import type { PublicLocale } from "./copy";

const DATE_LOCALE: Record<PublicLocale, string> = { en: "en-GB", fa: "fa-IR-u-ca-persian" };
const TIME_LOCALE: Record<PublicLocale, string> = { en: "en-GB", fa: "fa-IR" };

function valid(d: Date) {
  return !Number.isNaN(d.getTime());
}

/**
 * Every helper takes the congress's IANA `timeZone`: dates and clock times are the venue's, wherever the
 * visitor is (the visitor's own zone when it is missing or unknown to the runtime).
 */

/** "12–26 October 2026" / "۱۲ تا ۱۴ آبان ۱۴۰۵" in the calendar of the page language. */
export function formatDateRange(startIso: string, endIso: string, locale: PublicLocale, timeZone?: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (!valid(start)) return startIso;
  const fmt = new Intl.DateTimeFormat(DATE_LOCALE[locale], { day: "numeric", month: "long", year: "numeric", timeZone: safeTimeZone(timeZone) });
  if (!valid(end) || end <= start) return fmt.format(start);
  try {
    return fmt.formatRange(start, end);
  } catch {
    return `${fmt.format(start)} – ${fmt.format(end)}`;
  }
}

/** "Mon 12 Oct, 15:44" in the page language, at the venue. */
export function formatMoment(iso: string, locale: PublicLocale, timeZone?: string): string {
  const d = new Date(iso);
  if (!valid(d)) return iso;
  const tz = safeTimeZone(timeZone);
  const day = new Intl.DateTimeFormat(DATE_LOCALE[locale], { weekday: "short", day: "numeric", month: "short", timeZone: tz }).format(d);
  const time = new Intl.DateTimeFormat(TIME_LOCALE[locale], { hour: "2-digit", minute: "2-digit", timeZone: tz }).format(d);
  return locale === "fa" ? `${day}، ${time}` : `${day}, ${time}`;
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

/**
 * The venue zone's short name ("GMT+3:30") when it differs from this device's zone, for a "times are venue
 * time" note; null when they agree or the zone is unknown.
 */
export function venueZoneNote(timeZone: string | null | undefined, at: string): string | null {
  const tz = safeTimeZone(timeZone);
  if (!tz) return null;
  const device = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const offset = (zone: string) =>
    new Intl.DateTimeFormat("en-GB", { timeZone: zone, timeZoneName: "longOffset" }).formatToParts(new Date(at)).find((p) => p.type === "timeZoneName")?.value;
  if (tz === device || offset(tz) === offset(device)) return null;
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, timeZoneName: "short" }).formatToParts(new Date(at)).find((p) => p.type === "timeZoneName")?.value ?? tz;
}

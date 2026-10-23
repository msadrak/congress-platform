import { safeTimeZone } from "../../lib/congressPhase";
import type { AttendeeLocale } from "../../lib/i18n";

/** "09:30" / "۰۹:۳۰" at the venue (congress time zone; the visitor's when unknown). */
export function formatClock(iso: string, locale: AttendeeLocale, timeZone?: string): string {
  return new Intl.DateTimeFormat(locale === "fa" ? "fa-IR" : "en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: safeTimeZone(timeZone),
  }).format(new Date(iso));
}

/** "Monday 10 May" / «دوشنبه ۲۰ اردیبهشت» at the venue; Solar Hijri for Persian. */
export function formatDayLabel(iso: string, locale: AttendeeLocale, timeZone?: string, month: "long" | "short" = "long"): string {
  return new Intl.DateTimeFormat(locale === "fa" ? "fa-IR-u-ca-persian" : "en-GB", {
    weekday: month === "long" ? "long" : "short",
    day: "numeric",
    month,
    timeZone: safeTimeZone(timeZone),
  }).format(new Date(iso));
}

/** The congress zone's short name for the "times are venue time" note ("GMT+3:30"), or null. */
export function zoneLabel(timeZone: string | undefined, at: string): string | null {
  const tz = safeTimeZone(timeZone);
  if (!tz) return null;
  const part = new Intl.DateTimeFormat("en-GB", { timeZone: tz, timeZoneName: "short" })
    .formatToParts(new Date(at))
    .find((p) => p.type === "timeZoneName");
  return part?.value ?? tz;
}

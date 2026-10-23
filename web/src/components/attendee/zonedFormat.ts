import { formatDate } from "../../lib/format";
import type { AttendeeLocale } from "../../lib/i18n";

/** "09:30" / "۰۹:۳۰" at the venue (congress time zone; the visitor's when unknown). */
export function formatClock(iso: string, locale: AttendeeLocale, timeZone?: string): string {
  return formatDate(iso, "time", locale, timeZone);
}

/** "Monday 10 May" / «دوشنبه ۲۰ اردیبهشت» at the venue ("Mon 10 May" for `short`); Solar Hijri for Persian. */
export function formatDayLabel(iso: string, locale: AttendeeLocale, timeZone?: string, month: "long" | "short" = "long"): string {
  return formatDate(iso, month === "long" ? "heading" : "weekday", locale, timeZone);
}

import { boothCopy } from "../../copy/booth";
import { formatDate, type Instant, type Locale } from "../../lib/format";

/**
 * The congress clock the booth panel reads times on: the zone `BoothOut` names (`event_timezone`), else Tehran,
 * where every congress so far runs (the event default), rather than the device's zone.
 */
export function boothTimeZone(booth: { event_timezone?: string | null } | null | undefined): string {
  return booth?.event_timezone || "Asia/Tehran";
}

/** «امروز ۱۰:۴۲» for today on the congress clock, otherwise «سه‌شنبه ۱۹ آبان، ۰۸:۳۰». */
export function leadWhen(value: Instant, locale: Locale, timeZone: string, now: Instant = Date.now()): string {
  const sameDay = formatDate(value, "long", locale, timeZone) === formatDate(now, "long", locale, timeZone);
  return sameDay ? boothCopy[locale].today(formatDate(value, "time", locale, timeZone)) : formatDate(value, "dayTime", locale, timeZone);
}

/** «۰۹:۴۲» on the congress clock. */
export function leadClock(value: Instant, locale: Locale, timeZone: string): string {
  return formatDate(value, "time", locale, timeZone);
}

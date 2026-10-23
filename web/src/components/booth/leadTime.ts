import { boothCopy } from "../../copy/booth";
import { formatDate, type Instant, type Locale } from "../../lib/format";

/**
 * The congress clock the booth panel reads times on. `BoothOut` does not carry the event's time zone, and every
 * congress so far runs on Tehran time (the event default), so the booth uses it rather than the device's zone.
 */
export const BOOTH_TIME_ZONE = "Asia/Tehran";

/** «امروز ۱۰:۴۲» for today on the congress clock, otherwise «سه‌شنبه ۱۹ آبان، ۰۸:۳۰». */
export function leadWhen(value: Instant, locale: Locale, now: Instant = Date.now()): string {
  const sameDay = formatDate(value, "long", locale, BOOTH_TIME_ZONE) === formatDate(now, "long", locale, BOOTH_TIME_ZONE);
  return sameDay ? boothCopy[locale].today(formatDate(value, "time", locale, BOOTH_TIME_ZONE)) : formatDate(value, "dayTime", locale, BOOTH_TIME_ZONE);
}

/** «۰۹:۴۲» on the congress clock. */
export function leadClock(value: Instant, locale: Locale): string {
  return formatDate(value, "time", locale, BOOTH_TIME_ZONE);
}

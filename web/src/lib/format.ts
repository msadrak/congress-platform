/**
 * The one module that formats dates, times and numbers for people (ds §4 Formatting, org §4.6–4.8).
 *
 * - Every date and time is read on the congress's clock: pass its IANA `timeZone`. A missing or unknown zone
 *   falls back to the reader's own, as the older helpers did.
 * - Persian uses the Solar Hijri calendar, Persian digits, 24-hour times and never a Latin comma: weekday, day,
 *   month and year are assembled in natural order («سه‌شنبه ۱۹ آبان ۱۴۰۵»), because ICU's Persian pattern with a
 *   weekday puts the year first and the weekday last behind a «,».
 * - Machine codes (QR secrets, slugs, keys, URLs) are not formatted here: they stay Latin inside `dir="ltr"`.
 *
 * Pure (no DOM, no React), so it is unit tested under `node --test`.
 */

import { isValidJalali, gregorianToJalali, jalaliToGregorian } from "./jalali.ts";
import { formatMobile } from "./mobile.ts";

/** `formatMobile`: «۰۹۱۲ ۳۴۵ ۶۷۸۹», always inside an LTR island. */
export { formatMobile };

export type Locale = "fa" | "en";
export type Instant = string | number | Date;

/**
 * | style     | fa                         | en                   |
 * |-----------|----------------------------|----------------------|
 * | `day`     | سه‌شنبه ۱۹ آبان ۱۴۰۵         | Tue 10 Nov 2026      |
 * | `weekday` | سه‌شنبه ۱۹ آبان              | Tue 10 Nov           |
 * | `heading` | سه‌شنبه ۱۹ آبان              | Tuesday 10 November  |
 * | `short`   | ۱۹ آبان                    | 10 Nov               |
 * | `long`    | ۱۹ آبان ۱۴۰۵               | 10 November 2026     |
 * | `dayTime` | سه‌شنبه ۱۹ آبان، ۰۸:۳۰        | Tue 10 Nov, 08:30    |
 * | `time`    | ۰۸:۳۰                      | 08:30                |
 * | `clock`   | ۰۸:۳۰:۰۵                   | 08:30:05             |
 *
 * English is day-month (en-GB) everywhere, without the comma ICU puts after a weekday before a year.
 */
export type DateStyle = "day" | "weekday" | "heading" | "short" | "long" | "dayTime" | "time" | "clock";

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

/** Latin digits as Persian digits in the Persian interface; unchanged in English. */
export function localeDigits(text: string, locale: Locale): string {
  return locale === "fa" ? text.replace(/[0-9]/g, (digit) => PERSIAN_DIGITS[Number(digit)]) : text;
}

/** Persian prose takes the Persian comma «،», never «,». */
const persianPunctuation = (text: string) => text.replace(/,/g, "،");

/* ------------------------------------------------------------------ numbers */

/** CLDR's Persian number symbols, spelled out so no engine's `fa-IR` data can bring back a Latin comma. */
const PERSIAN_GROUP = "٬"; // ٬ thousands separator
const PERSIAN_DECIMAL = "٫"; // ٫ decimal separator
const PERSIAN_MINUS = "‎−"; // minus sign, kept left-to-right so it stays on the number's left
const PERSIAN_PERCENT = "٪"; // ٪

function persianNumberPart({ type, value }: Intl.NumberFormatPart): string {
  switch (type) {
    case "integer":
    case "fraction":
      return localeDigits(value, "fa");
    case "group":
      return PERSIAN_GROUP;
    case "decimal":
      return PERSIAN_DECIMAL;
    case "minusSign":
      return PERSIAN_MINUS;
    case "percentSign":
      return PERSIAN_PERCENT;
    default:
      return value;
  }
}

/**
 * «۵٬۰۰۰», «۰٫۵» in Persian, "5,000" in English. Persian is assembled from the en-US parts rather than taken
 * from `fa-IR`, so the separators do not depend on which Persian data the reader's browser ships.
 */
export function formatNumber(value: number, locale: Locale, options?: Intl.NumberFormatOptions): string {
  try {
    if (locale === "fa") {
      if (!Number.isFinite(value)) return new Intl.NumberFormat("fa-IR", options).format(value);
      return new Intl.NumberFormat("en-US", options).formatToParts(value).map(persianNumberPart).join("");
    }
    return new Intl.NumberFormat("en-US", options).format(value);
  } catch {
    return String(value);
  }
}

/** A ratio (0.43) as «۴۳٪» / "43%". */
export function formatPercent(ratio: number, locale: Locale, maximumFractionDigits = 0): string {
  return formatNumber(ratio, locale, { style: "percent", maximumFractionDigits });
}

/**
 * Class for a short code or number shown inline: IBM Plex Mono only covers Latin, so Persian text
 * (Persian digits included) keeps the normal font with tabular numerals.
 */
export function codeFontClass(text: string): string {
  return /^[\x20-\x7E]*$/.test(text) ? "font-mono" : "tabular";
}

/* ------------------------------------------------------------ dates & times */

const formatters = new Map<string, Intl.DateTimeFormat>();
function dateTimeFormat(tag: string, options: Intl.DateTimeFormatOptions, timeZone: string | undefined): Intl.DateTimeFormat {
  const key = `${tag}|${timeZone ?? ""}|${JSON.stringify(options)}`;
  let cached = formatters.get(key);
  if (!cached) {
    cached = new Intl.DateTimeFormat(tag, { ...options, timeZone });
    formatters.set(key, cached);
  }
  return cached;
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");
const toEpoch = (value: Instant): number => (value instanceof Date ? value.getTime() : new Date(value).getTime());

/** "08:30" or "08:30:05" on the clocks of `timeZone`, in Latin digits. */
function wallClockText(at: number, timeZone: string | undefined, seconds: boolean): string {
  const parts = dateTimeFormat(
    "en-US",
    { hour: "2-digit", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}), hourCycle: "h23" },
    timeZone,
  ).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "00";
  const hour = String(Number(part("hour")) % 24).padStart(2, "0");
  return seconds ? `${hour}:${part("minute")}:${part("second")}` : `${hour}:${part("minute")}`;
}

/** Solar Hijri weekday/day/month/year in natural Persian order. */
function persianDate(at: number, timeZone: string | undefined, weekday: boolean, year: boolean): string {
  const parts = dateTimeFormat(
    "fa-IR-u-ca-persian",
    { ...(weekday ? { weekday: "long" } : {}), day: "numeric", month: "long", ...(year ? { year: "numeric" } : {}) },
    timeZone,
  ).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return [weekday ? part("weekday") : "", part("day"), part("month"), year ? part("year") : ""].filter(Boolean).join(" ");
}

const ENGLISH: Record<Exclude<DateStyle, "time" | "clock" | "dayTime">, [string, Intl.DateTimeFormatOptions]> = {
  day: ["en-GB", { weekday: "short", year: "numeric", month: "short", day: "numeric" }],
  weekday: ["en-GB", { weekday: "short", month: "short", day: "numeric" }],
  heading: ["en-GB", { weekday: "long", day: "numeric", month: "long" }],
  short: ["en-GB", { day: "numeric", month: "short" }],
  long: ["en-GB", { day: "numeric", month: "long", year: "numeric" }],
};

function formatAt(at: number, style: DateStyle, locale: Locale, timeZone: string | undefined): string {
  if (style === "time" || style === "clock") return localeDigits(wallClockText(at, timeZone, style === "clock"), locale);
  if (style === "dayTime") {
    const time = localeDigits(wallClockText(at, timeZone, false), locale);
    if (locale === "fa") return `${persianDate(at, timeZone, true, false)}، ${time}`;
    return `${dateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" }, timeZone).format(at)}, ${time}`;
  }
  if (locale === "fa") {
    const weekday = style === "day" || style === "weekday" || style === "heading";
    return persianPunctuation(persianDate(at, timeZone, weekday, style === "day" || style === "long"));
  }
  const [tag, options] = ENGLISH[style];
  return dateTimeFormat(tag, options, timeZone).format(at).replace(/^([A-Za-z]+),\s/, "$1 ");
}

/**
 * A date and/or time on the congress's clock (`timeZone`, IANA), in the page language. See `DateStyle` for
 * what each style looks like. An unreadable value is returned as text.
 */
export function formatDate(value: Instant, style: DateStyle, locale: Locale, timeZone?: string | null): string {
  const at = toEpoch(value);
  if (Number.isNaN(at)) return String(value);
  try {
    return formatAt(at, style, locale, safeTimeZone(timeZone));
  } catch {
    return String(value);
  }
}

/** «۰۸:۳۰» / "08:30" (24 h) on the congress's clock. */
export function formatTime(value: Instant, locale: Locale, timeZone?: string | null): string {
  return formatDate(value, "time", locale, timeZone);
}

/** «۰۸:۳۰:۰۵» / "08:30:05" (24 h, with seconds) on the congress's clock. */
export function formatClock(value: Instant, locale: Locale, timeZone?: string | null): string {
  return formatDate(value, "clock", locale, timeZone);
}

/** org §4.6 `formatEventDate(iso, locale, { timeZone, style })`: `formatDate` with the options the organizer spec names. */
export function formatEventDate(
  value: Instant,
  locale: Locale,
  { timeZone, style = "day" }: { timeZone?: string | null; style?: DateStyle } = {},
): string {
  return formatDate(value, style, locale, timeZone);
}

const RANGE: Record<Locale, { tag: string; join: string }> = {
  fa: { tag: "fa-IR-u-ca-persian", join: " تا " },
  en: { tag: "en-GB", join: " – " },
};

/**
 * The days a congress spans: «۱۹ تا ۲۱ آبان ۱۴۰۵» / "10–12 November 2026", one date when both fall on the
 * same day (or the end is not after the start). Unreadable values come back as "start – end".
 */
export function formatDateRange(start: Instant, end: Instant, locale: Locale, timeZone?: string | null): string {
  const from = toEpoch(start);
  const to = toEpoch(end);
  if (Number.isNaN(from) || Number.isNaN(to)) return `${String(start)} – ${String(end)}`;
  const format = dateTimeFormat(
    RANGE[locale].tag,
    { day: "numeric", month: "long", year: "numeric" },
    safeTimeZone(timeZone),
  );
  let text: string;
  if (to <= from) text = format.format(from);
  else {
    try {
      text = format.formatRange(from, to);
    } catch {
      text = `${format.format(from)}${RANGE[locale].join}${format.format(to)}`;
    }
  }
  return locale === "fa" ? persianPunctuation(text) : text;
}

/* ---------------------------------------------------------- time zones */
/*
 * Clock arithmetic on a congress's zone. Every `Intl.DateTimeFormat` of the app lives in this module; the parts
 * below are read with Latin digits for computation, never shown as they are.
 */

/** The IANA zone when the runtime knows it; otherwise `undefined` (the reader's own zone). */
export function safeTimeZone(timeZone: string | null | undefined): string | undefined {
  if (!timeZone) return undefined;
  try {
    dateTimeFormat("en-US", {}, timeZone);
    return timeZone;
  } catch {
    return undefined;
  }
}

/** This device's IANA zone. */
export function deviceTimeZone(): string {
  return new Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/**
 * The wall-clock reading of an instant on the clocks of `timeZone` (the reader's when omitted), 24 h. An unknown
 * zone throws a RangeError, as `Intl` does.
 */
export function wallClock(value: Instant, timeZone?: string): WallClock {
  const parts = dateTimeFormat(
    "en-US",
    { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", numberingSystem: "latn" },
    timeZone,
  ).formatToParts(toEpoch(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: part("year"), month: part("month"), day: part("day"), hour: part("hour") % 24, minute: part("minute"), second: part("second") };
}

/** The calendar day of a moment in `timeZone` (the reader's zone when omitted or unknown), as `YYYY-MM-DD`. */
export function zonedDayKey(value: Instant, timeZone?: string | null): string {
  const c = wallClock(value, safeTimeZone(timeZone));
  return `${pad(c.year, 4)}-${pad(c.month)}-${pad(c.day)}`;
}

/** Milliseconds `timeZone` is ahead of UTC at the instant `ms`. */
export function zoneOffsetMs(ms: number, timeZone: string): number {
  const c = wallClock(ms, timeZone);
  return Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute, c.second) - Math.floor(ms / 1000) * 1000;
}

/**
 * The instant at which the clocks of `timeZone` show this wall time (ISO-8601, UTC). When a daylight-saving
 * change repeats the time the earlier instant wins; when it skips the time, the offset before the change is used.
 */
export function zonedWallTimeToIso(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second = 0,
): string {
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  const DAY = 86_400_000;
  const before = zoneOffsetMs(wall - DAY, timeZone);
  const candidates = [before, zoneOffsetMs(wall + DAY, timeZone)]
    .map((offset) => wall - offset)
    .filter((ms) => ms + zoneOffsetMs(ms, timeZone) === wall);
  return new Date(candidates.length > 0 ? Math.min(...candidates) : wall - before).toISOString();
}

/** Names for the zones congresses are held in, as people say them. */
const KNOWN_ZONES: Record<string, Record<Locale, string>> = {
  "Asia/Tehran": { fa: "وقت تهران", en: "Tehran time" },
};
const INTL_TAG: Record<Locale, string> = { fa: "fa-IR", en: "en-US" };
/** When no name without Latin letters is known: Persian says "the venue's time"; English shows the IANA name. */
const VENUE_TIME: Record<Locale, string | null> = { fa: "وقت محل همایش", en: null };

function zoneName(timeZone: string, tag: string, style: Intl.DateTimeFormatOptions["timeZoneName"], at: Instant = Date.now()): string | null {
  try {
    const part = dateTimeFormat(tag, { timeZoneName: style }, timeZone)
      .formatToParts(toEpoch(at))
      .find((p) => p.type === "timeZoneName");
    return part?.value.trim() || null;
  } catch {
    return null;
  }
}

/**
 * An event's IANA time zone as a label for the reader ("Asia/Tehran" → «وقت تهران» / "Tehran time"): known zones
 * by name, others by the browser's localized zone name, then its UTC offset. A Persian reader never gets the raw
 * IANA name or other Latin text; the caller can still show it as a tooltip.
 */
export function timeZoneLabel(timeZone: string, locale: Locale): string {
  const known = KNOWN_ZONES[timeZone];
  if (known) return known[locale];
  for (const style of ["longGeneric", "shortOffset"] as const) {
    const name = zoneName(timeZone, INTL_TAG[locale], style);
    if (name && (locale === "en" || !/[A-Za-z]/.test(name))) return name;
  }
  return VENUE_TIME[locale] ?? timeZone;
}

/**
 * The congress zone for a "times are venue time" note, when its offset at `at` differs from this device's:
 * «وقت تهران» in Persian (never Latin), the short name ("GMT+3:30") in English. Null when the offsets agree or
 * the zone is unknown.
 */
export function venueZoneLabel(timeZone: string | null | undefined, at: Instant, locale: Locale): string | null {
  const zone = safeTimeZone(timeZone);
  if (!zone) return null;
  const device = deviceTimeZone();
  if (zone === device || zoneName(zone, "en-GB", "longOffset", at) === zoneName(device, "en-GB", "longOffset", at)) return null;
  if (locale === "fa") return timeZoneLabel(zone, locale);
  return zoneName(zone, "en-GB", "short", at) ?? zone;
}

/* ---------------------------------------------------------------- date entry */
/*
 * The model behind `components/ui/DateTimeField`. Values are the `datetime-local` strings the forms already use
 * ("2026-11-10T08:30", or "2026-11-10" for a date): a wall-clock reading on the congress's clock. Persian
 * readers pick a Jalali day, month and year; English readers a Gregorian one.
 */

export const JALALI_MONTHS = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"] as const;
export const GREGORIAN_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** What the reader has picked so far: `year` and `time` as typed (Latin digits), `month`/`day` 0 when unset. */
export interface DateDraft {
  year: string;
  month: number;
  day: number;
  time: string;
}

export const EMPTY_DATE_DRAFT: DateDraft = { year: "", month: 0, day: 0, time: "" };

const WALL_VALUE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/;

/** Persian and Arabic-Indic digits as Latin ones. */
export function latinDigits(text: string): string {
  return text.replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0)).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

/** Days in a month of the reader's calendar (Esfand has 30 days in a leap year, 29 otherwise). */
export function monthLength(year: number, month: number, locale: Locale): number {
  if (locale === "fa") {
    if (month <= 6) return 31;
    if (month <= 11) return 30;
    return isValidJalali(year, 12, 30) ? 30 : 29;
  }
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** "8:30", "0830", «۰۸:۳۰» → "08:30" (24 h); null when it is not a time of day. */
export function parseTimeOfDay(text: string): string | null {
  const match = /^(\d{1,2}):?(\d{2})$/.exec(latinDigits(text).trim().replace(/[٫.]/, ":"));
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour < 24 && minute < 60 ? `${pad(hour)}:${pad(minute)}` : null;
}

/** The draft for a value (in the reader's calendar); empty when the value is blank or unreadable. */
export function dateDraft(value: string, locale: Locale): DateDraft {
  const match = WALL_VALUE.exec(value.trim());
  if (!match) return EMPTY_DATE_DRAFT;
  const [gy, gm, gd] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (gm < 1 || gm > 12 || gd < 1 || gd > monthLength(gy, gm, "en")) return EMPTY_DATE_DRAFT;
  const time = match[4] ? `${match[4]}:${match[5]}` : "";
  if (locale === "en") return { year: String(gy), month: gm, day: gd, time };
  const [jy, jm, jd] = gregorianToJalali(gy, gm, gd);
  return { year: String(jy), month: jm, day: jd, time };
}

/** The value for a draft ("YYYY-MM-DDTHH:MM", or "YYYY-MM-DD" without `withTime`); "" while incomplete or invalid. */
export function draftValue(draft: DateDraft, locale: Locale, withTime: boolean): string {
  const year = latinDigits(draft.year).trim();
  if (!/^\d{4}$/.test(year) || !draft.month || !draft.day) return "";
  const y = Number(year);
  if (draft.day > monthLength(y, draft.month, locale)) return "";
  if (locale === "fa" && !isValidJalali(y, draft.month, draft.day)) return "";
  const [gy, gm, gd] = locale === "fa" ? jalaliToGregorian(y, draft.month, draft.day) : [y, draft.month, draft.day];
  const date = `${pad(gy, 4)}-${pad(gm)}-${pad(gd)}`;
  if (!withTime) return date;
  const time = parseTimeOfDay(draft.time);
  return time ? `${date}T${time}` : "";
}

/** A value as the reader would write it: «۱۹ آبان ۱۴۰۵ ۰۸:۳۰» / "10 November 2026 08:30"; "" when unreadable. */
export function formatWallValue(value: string, locale: Locale): string {
  const draft = dateDraft(value, locale);
  if (!draft.month) return "";
  const months = locale === "fa" ? JALALI_MONTHS : GREGORIAN_MONTHS;
  return localeDigits([String(draft.day), months[draft.month - 1], draft.year, draft.time].filter(Boolean).join(" "), locale);
}

/**
 * The read-out under a date field: «سه‌شنبه ۱۹ آبان ۱۴۰۵، ساعت ۰۸:۳۰ (وقت تهران)» / "Tue 10 Nov 2026, 08:30
 * (Tehran time)". The time is the instant the congress's clocks show it, so a wall time that a daylight-saving
 * change skips reads as the time it becomes. "" when the value is blank or invalid.
 */
export function describeWallValue(value: string, locale: Locale, timeZone?: string | null): string {
  const match = WALL_VALUE.exec(value.trim());
  if (!match || !dateDraft(value, "en").month) return "";
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (!match[4]) return formatDate(Date.UTC(y, m - 1, d, 12), "day", locale, "UTC");
  const zone = safeTimeZone(timeZone);
  const at = zone ? zonedWallTimeToIso(zone, y, m, d, Number(match[4]), Number(match[5])) : Date.UTC(y, m - 1, d, Number(match[4]), Number(match[5]));
  const clockZone = zone ?? "UTC";
  const day = formatDate(at, "day", locale, clockZone);
  const time = formatDate(at, "time", locale, clockZone);
  const label = zone ? ` (${timeZoneLabel(zone, locale)})` : "";
  return DAY_AT_TIME[locale](day, time, label);
}

const DAY_AT_TIME: Record<Locale, (day: string, time: string, zone: string) => string> = {
  fa: (day, time, zone) => `${day}، ساعت ${time}${zone}`,
  en: (day, time, zone) => `${day}, ${time}${zone}`,
};

/**
 * Dates and hours of the attendance dashboard, always on the event's wall clock (the API's `timezone`, e.g.
 * Asia/Tehran at +03:30), never the browser's. Digits follow the page language: Persian for `fa`, Latin for `en`.
 *
 * The API reports hourly buckets sparsely (only hours with scans), each with its local `day`, `hour` and a
 * `starts_at` instant carrying the event's UTC offset; `bucketSeries` fills the gaps for a chart.
 */

import { formatDate } from "./format.ts";

export type TimeLocale = "fa" | "en";

/** One hour of scans as the API reports it (`HourlyScanCount`). */
export interface HourBucket {
  day: string;
  hour: string;
  starts_at: string;
  count: number;
  admitted: number;
  rejected: number;
}

/** A bucket of a gap-free series; `at` is its start in epoch milliseconds (NaN if the API's time was unreadable). */
export interface SeriesPoint extends HourBucket {
  at: number;
}

const HOUR_MS = 3_600_000;
/** Longer spans are left sparse rather than drawn as thousands of empty columns. */
export const MAX_SERIES_HOURS = 24 * 14;

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(locale: string, timeZone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${timeZone}|${JSON.stringify(options)}`;
  let cached = formatters.get(key);
  if (!cached) {
    cached = new Intl.DateTimeFormat(locale, { ...options, timeZone });
    formatters.set(key, cached);
  }
  return cached;
}

const toInstant = (value: string | number | Date): number =>
  typeof value === "number" ? value : value instanceof Date ? value.getTime() : Date.parse(value);

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** The wall-clock reading of an instant in `timeZone`, with Latin digits for computation. */
function wallClock(at: number, timeZone: string): WallClock {
  const parts = formatter("en-US", timeZone, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: part("year"),
    month: part("month"),
    day: part("day"),
    hour: part("hour") % 24,
    minute: part("minute"),
    second: part("second"),
  };
}

const pad = (n: number, width = 2) => String(Math.abs(n)).padStart(width, "0");
const isoDay = (c: WallClock) => `${pad(c.year, 4)}-${pad(c.month)}-${pad(c.day)}`;

/** "+03:30": the zone's UTC offset at that instant. */
function offsetText(at: number, c: WallClock): string {
  const local = Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute, c.second);
  const minutes = Math.round((local - Math.floor(at / 1000) * 1000) / 60_000);
  return `${minutes < 0 ? "-" : "+"}${pad(Math.trunc(minutes / 60))}:${pad(minutes % 60)}`;
}

/** The event's local date ("YYYY-MM-DD") at `now`. */
export function todayIn(timeZone: string, now: Date | number = Date.now()): string {
  return isoDay(wallClock(toInstant(now), timeZone));
}

/** "08:00" (or "۰۸:۰۰") on the event's clock, from an ISO time with offset, an epoch or a Date. */
export function formatHour(value: string | number | Date, timeZone: string, locale: TimeLocale): string {
  return formatDate(value, "time", locale, timeZone);
}

/** "08:00:05" (or "۰۸:۰۰:۰۵") on the event's clock: when the dashboard last refreshed. */
export function formatClock(value: string | number | Date, timeZone: string, locale: TimeLocale): string {
  return formatDate(value, "clock", locale, timeZone);
}

/**
 * A local date of the event ("2027-04-11", already on the event's clock, so no zone is applied): the Solar
 * Hijri calendar with Persian digits for `fa` («یکشنبه ۲۲ فروردین»), Gregorian for `en` ("Sun, Apr 11").
 */
export function formatDay(day: string, locale: TimeLocale): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return day;
  return formatDate(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12), "weekday", locale, "UTC");
}

function emptyBucket(at: number, timeZone: string): SeriesPoint {
  const c = wallClock(at, timeZone);
  return {
    at,
    day: isoDay(c),
    hour: `${pad(c.hour)}:00`,
    starts_at: `${isoDay(c)}T${pad(c.hour)}:${pad(c.minute)}:00${offsetText(at, c)}`,
    count: 0,
    admitted: 0,
    rejected: 0,
  };
}

/**
 * The buckets in time order, merged per hour, with every missing hour between the first and the last filled
 * with its true value, zero (labelled on the event's clock, so a series may run across midnight into the next
 * day). Unreadable times, or a span over `MAX_SERIES_HOURS`, leave the series sparse.
 */
export function bucketSeries(buckets: readonly HourBucket[], timeZone: string): SeriesPoint[] {
  const byInstant = new Map<number, SeriesPoint>();
  for (const bucket of buckets) {
    const at = Date.parse(bucket.starts_at);
    if (Number.isNaN(at)) return buckets.map((b) => ({ ...b, at: Date.parse(b.starts_at) }));
    const known = byInstant.get(at);
    if (known) {
      known.count += bucket.count;
      known.admitted += bucket.admitted;
      known.rejected += bucket.rejected;
    } else {
      byInstant.set(at, { ...bucket, at });
    }
  }
  const sorted = [...byInstant.values()].sort((a, b) => a.at - b.at);
  if (sorted.length < 2) return sorted;
  const first = sorted[0].at;
  const hours = Math.round((sorted[sorted.length - 1].at - first) / HOUR_MS) + 1;
  if (hours > MAX_SERIES_HOURS || sorted.some((p) => (p.at - first) % HOUR_MS !== 0)) return sorted;
  return Array.from({ length: hours }, (_, i) => byInstant.get(first + i * HOUR_MS) ?? emptyBucket(first + i * HOUR_MS, timeZone));
}

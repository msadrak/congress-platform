/**
 * Where an attendee stands relative to a congress, measured in the congress's own time zone: before it
 * (countdown), during it (which day), or after it. Pure (no DOM, no React), so it is unit tested under
 * `node --test`.
 */

const DAY_MS = 86_400_000;

/** The IANA zone when the runtime knows it; otherwise `undefined` (the visitor's own zone). */
export function safeTimeZone(timeZone: string | null | undefined): string | undefined {
  if (!timeZone) return undefined;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return undefined;
  }
}

/** The calendar day of a moment in `timeZone` (visitor's zone when omitted), as `YYYY-MM-DD`. */
export function zonedDayKey(value: string | number | Date, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: safeTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** Whole calendar days from day key `from` to day key `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  const utc = (key: string) => {
    const [y, m, d] = key.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((utc(to) - utc(from)) / DAY_MS);
}

export type HomePhase =
  /** `daysLeft`: calendar days (congress zone) until the opening day; 0 on the opening day itself. */
  | { kind: "before"; msLeft: number; daysLeft: number }
  | { kind: "during"; day: number; totalDays: number }
  | { kind: "after" };

/**
 * The attendee home's state, from the congress's real start and end instants. Days are counted in the
 * congress's time zone so "day 2" and "starts tomorrow" mean the venue's calendar, wherever the reader is.
 * `null` when either timestamp is unusable.
 */
export function homePhase(startsAt: string, endsAt: string, timeZone: string | null | undefined, now: number): HomePhase | null {
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  const tz = safeTimeZone(timeZone);
  const startDay = zonedDayKey(start, tz);
  if (now < start) return { kind: "before", msLeft: start - now, daysLeft: Math.max(0, daysBetween(zonedDayKey(now, tz), startDay)) };
  if (now <= end) {
    const totalDays = Math.max(1, daysBetween(startDay, zonedDayKey(end, tz)) + 1);
    return { kind: "during", day: Math.min(totalDays, daysBetween(startDay, zonedDayKey(now, tz)) + 1), totalDays };
  }
  return { kind: "after" };
}

/** Whole days, hours and minutes left (never negative), for the countdown. */
export function countdownParts(msLeft: number): { days: number; hours: number; minutes: number } {
  const totalMinutes = Math.max(0, Math.floor(msLeft / 60_000));
  return { days: Math.floor(totalMinutes / 1440), hours: Math.floor((totalMinutes % 1440) / 60), minutes: totalMinutes % 60 };
}

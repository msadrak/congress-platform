import { attendeeCopy } from "../../copy/attendee";
import { daysBetween, homePhase, zonedDayKey } from "../../lib/congressPhase";
import { formatDateRange as formatRange, formatNumber } from "../../lib/format";
import type { AttendeeLocale } from "../../lib/i18n";

/** Where "now" sits relative to a congress's real start/end timestamps. */
export type CongressPhase =
  | { kind: "upcoming"; days: number }
  | { kind: "live"; day: number; totalDays: number }
  | { kind: "ended" };

/** Calendar days the congress spans (inclusive) in `timeZone` (the visitor's when omitted); `null` when either timestamp is unusable. */
export function congressDays(startsAt: string, endsAt: string, timeZone?: string): number | null {
  const starts = new Date(startsAt);
  const ends = new Date(endsAt);
  if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime())) return null;
  return Math.max(1, daysBetween(zonedDayKey(starts, timeZone), zonedDayKey(ends, timeZone)) + 1);
}

/**
 * Derived only from `starts_at` / `ends_at`, with days counted in the congress's `timeZone` when given;
 * `null` when either timestamp is unusable.
 */
export function congressPhase(startsAt: string, endsAt: string, now: Date = new Date(), timeZone?: string): CongressPhase | null {
  const phase = homePhase(startsAt, endsAt, timeZone, now.getTime());
  if (!phase) return null;
  if (phase.kind === "after") return { kind: "ended" };
  if (phase.kind === "during") return { kind: "live", day: phase.day, totalDays: phase.totalDays };
  return { kind: "upcoming", days: phase.daysLeft };
}

export function phaseLabel(phase: CongressPhase, locale: AttendeeLocale): string {
  const c = attendeeCopy[locale].home.phase;
  const n = (value: number) => formatNumber(value, locale);
  if (phase.kind === "ended") return c.ended;
  if (phase.kind === "live") return phase.totalDays > 1 ? c.liveDay(n(phase.day), n(phase.totalDays)) : c.live;
  if (phase.days === 0) return c.today;
  if (phase.days === 1) return c.tomorrow;
  return c.inDays(n(phase.days));
}

/**
 * Compact range ("12 – 27 October 2026"); Solar Hijri for Persian, matching `formatLocalizedDate`. Days are the
 * venue's when the congress's `timeZone` is given (the visitor's otherwise).
 */
export function formatDateRange(startsAt: string, endsAt: string, locale: AttendeeLocale, timeZone?: string): string {
  return formatRange(startsAt, endsAt, locale, timeZone);
}

import { daysBetween, homePhase, zonedDayKey } from "../../lib/congressPhase";
import { formatDateRange as formatRange, formatNumber } from "../../lib/format";
import { formatLocalizedNumber, type AttendeeLocale } from "../../lib/i18n";

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
  const n = (value: number) => formatLocalizedNumber(value, locale);
  if (locale === "fa") {
    if (phase.kind === "ended") return "به پایان رسیده";
    if (phase.kind === "live") {
      return phase.totalDays > 1 ? `در حال برگزاری · روز ${n(phase.day)} از ${n(phase.totalDays)}` : "در حال برگزاری";
    }
    if (phase.days === 0) return "امروز آغاز می‌شود";
    if (phase.days === 1) return "فردا آغاز می‌شود";
    return `${n(phase.days)} روز تا آغاز`;
  }
  if (phase.kind === "ended") return "Ended";
  if (phase.kind === "live") return phase.totalDays > 1 ? `Live now · Day ${phase.day} of ${phase.totalDays}` : "Live now";
  if (phase.days === 0) return "Starts today";
  if (phase.days === 1) return "Starts tomorrow";
  return `Starts in ${phase.days} days`;
}

/**
 * Compact range ("12 – 27 October 2026"); Solar Hijri for Persian, matching `formatLocalizedDate`. Days are the
 * venue's when the congress's `timeZone` is given (the visitor's otherwise).
 */
export function formatDateRange(startsAt: string, endsAt: string, locale: AttendeeLocale, timeZone?: string): string {
  return formatRange(startsAt, endsAt, locale, timeZone);
}

/** Two-digit section index, in Persian digits for the Persian UI ("01" / "۰۱"). */
export function sectionIndex(value: number, locale: AttendeeLocale): string {
  return formatNumber(value, locale, { minimumIntegerDigits: 2, useGrouping: false });
}

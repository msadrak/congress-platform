import { formatLocalizedNumber, type AttendeeLocale } from "../../lib/i18n";

/** Where "now" sits relative to a congress's real start/end timestamps. */
export type CongressPhase =
  | { kind: "upcoming"; days: number }
  | { kind: "live"; day: number; totalDays: number }
  | { kind: "ended" };

const DAY_MS = 86_400_000;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const spanDays = (from: Date, to: Date) => Math.round((startOfDay(to) - startOfDay(from)) / DAY_MS);

/** Calendar days the congress spans (inclusive); `null` when either timestamp is unusable. */
export function congressDays(startsAt: string, endsAt: string): number | null {
  const starts = new Date(startsAt);
  const ends = new Date(endsAt);
  if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime())) return null;
  return Math.max(1, spanDays(starts, ends) + 1);
}

/** Derived only from `starts_at` / `ends_at`; `null` when either timestamp is unusable. */
export function congressPhase(startsAt: string, endsAt: string, now: Date = new Date()): CongressPhase | null {
  const starts = new Date(startsAt);
  const ends = new Date(endsAt);
  const totalDays = congressDays(startsAt, endsAt);
  if (totalDays === null) return null;
  const t = now.getTime();
  if (t > ends.getTime()) return { kind: "ended" };
  if (t >= starts.getTime()) return { kind: "live", day: spanDays(starts, now) + 1, totalDays };
  return { kind: "upcoming", days: Math.max(0, spanDays(now, starts)) };
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

/** Compact range ("12 – 27 October 2026"); Solar Hijri for Persian, matching `formatLocalizedDate`. */
export function formatDateRange(startsAt: string, endsAt: string, locale: AttendeeLocale): string {
  const starts = new Date(startsAt);
  const ends = new Date(endsAt);
  if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime())) return `${startsAt} – ${endsAt}`;
  const fmt = new Intl.DateTimeFormat(locale === "fa" ? "fa-IR-u-ca-persian" : "en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  try {
    return fmt.formatRange(starts, ends);
  } catch {
    return `${fmt.format(starts)} – ${fmt.format(ends)}`;
  }
}

/** Two-digit section index, in Persian digits for the Persian UI ("01" / "۰۱"). */
export function sectionIndex(value: number, locale: AttendeeLocale): string {
  return new Intl.NumberFormat(locale === "fa" ? "fa-IR" : "en-US", { minimumIntegerDigits: 2, useGrouping: false }).format(value);
}

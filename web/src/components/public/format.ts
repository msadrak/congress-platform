import type { TicketTierOut } from "../../api/client";
import type { PublicLocale } from "./copy";

const DATE_LOCALE: Record<PublicLocale, string> = { en: "en-GB", fa: "fa-IR-u-ca-persian" };
const TIME_LOCALE: Record<PublicLocale, string> = { en: "en-GB", fa: "fa-IR" };
const DAY_MS = 86_400_000;

function valid(d: Date) {
  return !Number.isNaN(d.getTime());
}

/** "12–26 October 2026" / "۱۲ تا ۱۴ آبان ۱۴۰۵" in the calendar of the page language. */
export function formatDateRange(startIso: string, endIso: string, locale: PublicLocale): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (!valid(start)) return startIso;
  const fmt = new Intl.DateTimeFormat(DATE_LOCALE[locale], { day: "numeric", month: "long", year: "numeric" });
  if (!valid(end) || end <= start) return fmt.format(start);
  try {
    return fmt.formatRange(start, end);
  } catch {
    return `${fmt.format(start)} – ${fmt.format(end)}`;
  }
}

/** "Mon 12 Oct, 15:44" in the page language (local time zone). */
export function formatMoment(iso: string, locale: PublicLocale): string {
  const d = new Date(iso);
  if (!valid(d)) return iso;
  const day = new Intl.DateTimeFormat(DATE_LOCALE[locale], { weekday: "short", day: "numeric", month: "short" }).format(d);
  const time = new Intl.DateTimeFormat(TIME_LOCALE[locale], { hour: "2-digit", minute: "2-digit" }).format(d);
  return locale === "fa" ? `${day}، ${time}` : `${day}, ${time}`;
}

/** Calendar days covered by the congress, counted in the visitor's time zone. */
export function calendarDays(startIso: string, endIso: string): number {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (!valid(start) || !valid(end) || end < start) return 1;
  const s = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const e = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.round((e - s) / DAY_MS) + 1;
}

export type CongressTiming = { kind: "live" } | { kind: "ended" } | { kind: "upcoming"; days: number };

export function congressTiming(startIso: string, endIso: string, now = Date.now()): CongressTiming {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (now >= end) return { kind: "ended" };
  if (now >= start) return { kind: "live" };
  const today = new Date(now);
  const startDay = new Date(start);
  const days = Math.round(
    (Date.UTC(startDay.getFullYear(), startDay.getMonth(), startDay.getDate()) -
      Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) /
      DAY_MS
  );
  return { kind: "upcoming", days: Math.max(0, days) };
}

export type TierState = "AVAILABLE" | "SOLD_OUT" | "CLOSED";

/** Same rule the reservation flow uses: full beats closed, closed beats available. */
export function tierState(tier: Pick<TicketTierOut, "quota" | "is_open"> & { reserved_count?: number }): TierState {
  const reserved = tier.reserved_count ?? 0;
  if (reserved >= tier.quota) return "SOLD_OUT";
  if (!tier.is_open) return "CLOSED";
  return "AVAILABLE";
}

export type RegistrationStatus = "open" | "full" | "closed";

export function registrationStatus(tiers: TicketTierOut[]): RegistrationStatus {
  const states = tiers.map(tierState);
  if (states.includes("AVAILABLE")) return "open";
  if (tiers.some((t) => t.is_open) && states.length > 0) return "full";
  return "closed";
}

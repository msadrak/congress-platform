/**
 * Pure helpers for the attendee's passes: which congresses `/me` lists (grouped upcoming / live / past) and
 * which passes the pass page of one congress shows. No React, no storage: unit-tested in tests/attendeePasses.test.ts.
 */
import type { AttendeeTicketDetail } from "../api/client.ts";
import type { LinkPass } from "./linkPass.ts";

export type CongressTiming = "upcoming" | "live" | "past";

/** A ticket's status as the UI treats it: anything but "cancelled" is a working pass. */
export function isCancelledStatus(status: string): boolean {
  return status.trim().toLowerCase() === "cancelled";
}

/** Upcoming until it starts, live until it ends, past afterwards. Unusable dates count as upcoming. */
export function congressTiming(startsAt: string, endsAt: string, now: number = Date.now()): CongressTiming {
  const starts = Date.parse(startsAt);
  const ends = Date.parse(endsAt);
  if (!Number.isNaN(ends) && now > ends) return "past";
  if (!Number.isNaN(starts) && now >= starts) return "live";
  return "upcoming";
}

/** True while the attendee may still cancel their own registration (the API refuses once the congress starts). */
export function canSelfCancel(ticket: Pick<AttendeeTicketDetail, "status" | "event_starts_at">, now: number = Date.now()): boolean {
  const starts = Date.parse(ticket.event_starts_at);
  return !isCancelledStatus(ticket.status) && !Number.isNaN(starts) && now < starts;
}

export interface CongressCard {
  slug: string;
  name: string;
  location: string;
  startsAt: string;
  endsAt: string;
  /** Working passes the attendee holds for this congress. */
  passCount: number;
  /** Known only from a pass opened from an SMS link on this device (no sign-in). */
  fromLink: boolean;
}

export type CongressGroups = Record<CongressTiming, CongressCard[]>;

/**
 * The attendee's congresses, one card per congress: working account passes and link passes (deduplicated by
 * ticket id), cancelled passes left out. Upcoming and live congresses come soonest first, past ones most recent first.
 */
export function groupCongresses(
  tickets: readonly AttendeeTicketDetail[],
  linkPasses: readonly LinkPass[] = [],
  now: number = Date.now(),
): CongressGroups {
  const cards: Record<string, CongressCard> = {};
  const seen: Record<string, true> = {};
  const add = (id: string, card: Omit<CongressCard, "passCount" | "fromLink">, fromLink: boolean) => {
    if (seen[id]) return;
    seen[id] = true;
    const existing = cards[card.slug];
    if (existing) {
      existing.passCount += 1;
      existing.fromLink = existing.fromLink && fromLink;
    } else {
      cards[card.slug] = { ...card, passCount: 1, fromLink };
    }
  };
  for (const t of tickets) {
    if (isCancelledStatus(t.status)) continue;
    add(t.id, { slug: t.event_slug, name: t.event_name, location: t.event_location, startsAt: t.event_starts_at, endsAt: t.event_ends_at }, false);
  }
  for (const p of linkPasses) {
    if (isCancelledStatus(p.status)) continue;
    add(p.ticket_id, { slug: p.event.slug, name: p.event.name, location: p.event.location, startsAt: p.event.starts_at, endsAt: p.event.ends_at }, true);
  }
  const groups: CongressGroups = { upcoming: [], live: [], past: [] };
  for (const card of Object.values(cards)) groups[congressTiming(card.startsAt, card.endsAt, now)].push(card);
  const byStart = (a: CongressCard, b: CongressCard) => a.startsAt.localeCompare(b.startsAt);
  groups.upcoming.sort(byStart);
  groups.live.sort(byStart);
  groups.past.sort((a, b) => b.endsAt.localeCompare(a.endsAt));
  return groups;
}

/** One congress's passes for the pass page: working ones first (newest first), then cancelled ones. */
export function passesForCongress<T extends Pick<AttendeeTicketDetail, "event_slug" | "status" | "created_at">>(
  tickets: readonly T[],
  slug: string,
): { active: T[]; cancelled: T[] } {
  const mine = tickets.filter((t) => t.event_slug === slug).sort((a, b) => b.created_at.localeCompare(a.created_at));
  return { active: mine.filter((t) => !isCancelledStatus(t.status)), cancelled: mine.filter((t) => isCancelledStatus(t.status)) };
}

/**
 * Labels for the switcher between several passes of one congress: tier and issue date, numbered only when two
 * passes would otherwise read the same.
 */
export function passSwitchLabels(
  tickets: readonly Pick<AttendeeTicketDetail, "ticket_tier_name" | "created_at">[],
  formatDate: (iso: string) => string,
  formatNumber: (n: number) => string = String,
): string[] {
  const base = tickets.map((t) => [t.ticket_tier_name.trim(), formatDate(t.created_at)].filter(Boolean).join(" · "));
  const counts: Record<string, number> = {};
  for (const label of base) counts[label] = (counts[label] ?? 0) + 1;
  const used: Record<string, number> = {};
  return base.map((label) => {
    if (counts[label] === 1) return label;
    used[label] = (used[label] ?? 0) + 1;
    return `${label} (${formatNumber(used[label])})`;
  });
}

/** The congress name known on this device (cached account pass or link pass), for an offline header. */
export function knownCongressName(
  slug: string,
  tickets: readonly Pick<AttendeeTicketDetail, "event_slug" | "event_name">[],
  linkPasses: readonly LinkPass[] = [],
): string | null {
  return tickets.find((t) => t.event_slug === slug)?.event_name ?? linkPasses.find((p) => p.event.slug === slug)?.event.name ?? null;
}

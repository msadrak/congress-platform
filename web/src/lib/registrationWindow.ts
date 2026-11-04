/**
 * Can a visitor reserve right now? The congress's registration window (switch, opening and closing instants,
 * end of the congress) and each ticket tier's sales window, decided in the same order as the API's reserve
 * route (`registration_problem`, then `tier_sales_problem`, then the tier switch and quota). Pure (no DOM, no
 * React): unit tested in tests/registrationWindow.test.ts.
 *
 * Older payloads and fixtures carry none of the window fields: missing fields mean "no restriction".
 */

export interface RegistrationFields {
  ends_at: string;
  registration_enabled?: boolean;
  registration_opens_at?: string | null;
  registration_closes_at?: string | null;
  /** The server's verdict when the page was loaded. */
  registration_open?: boolean;
}

export interface TierFields {
  quota: number;
  reserved_count?: number;
  is_open: boolean;
  sales_starts_at?: string | null;
  sales_ends_at?: string | null;
}

/**
 * `open`: reservable now (`closesAt`: the first instant it stops, when known);
 * `opens`: not yet, opens at `at`;
 * `closed`: `ended` (the congress is over), `event` (registration closed), `tier` (the organizer closed this
 * tier), `sales` (the tier's sales window has ended);
 * `full`: the tier's quota is reached.
 */
export type Availability =
  | { kind: "open"; closesAt: string | null }
  | { kind: "opens"; at: string }
  | { kind: "closed"; reason: "ended" | "event" | "tier" | "sales" }
  | { kind: "full" };

const instant = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
};

/** The congress-level window. */
export function registrationWindow(event: RegistrationFields, now: number = Date.now()): Exclude<Availability, { kind: "full" }> {
  const ends = instant(event.ends_at);
  if (ends !== null && now >= ends) return { kind: "closed", reason: "ended" };
  if (event.registration_enabled === false) return { kind: "closed", reason: "event" };
  const opens = instant(event.registration_opens_at);
  const closes = instant(event.registration_closes_at);
  if (closes !== null && now >= closes) return { kind: "closed", reason: "event" };
  if (opens !== null && now < opens) {
    // The server already said it is open: this device's clock is behind, trust the server.
    if (event.registration_open === true) return { kind: "open", closesAt: event.registration_closes_at ?? null };
    return { kind: "opens", at: event.registration_opens_at as string };
  }
  // The server said closed for a reason the fields do not show (and not merely "not open yet" that has since
  // passed): keep it closed.
  if (event.registration_open === false && opens === null) return { kind: "closed", reason: "event" };
  return { kind: "open", closesAt: event.registration_closes_at ?? null };
}

/** One tier on its own (switch, quota, sales window). A full tier reads as full before anything else. */
export function tierWindow(tier: TierFields, now: number = Date.now()): Availability {
  if ((tier.reserved_count ?? 0) >= tier.quota) return { kind: "full" };
  if (!tier.is_open) return { kind: "closed", reason: "tier" };
  const starts = instant(tier.sales_starts_at);
  const ends = instant(tier.sales_ends_at);
  if (ends !== null && now >= ends) return { kind: "closed", reason: "sales" };
  if (starts !== null && now < starts) return { kind: "opens", at: tier.sales_starts_at as string };
  return { kind: "open", closesAt: tier.sales_ends_at ?? null };
}

const earlier = (a: string | null, b: string | null): string | null => {
  if (a === null) return b;
  if (b === null) return a;
  return (instant(a) ?? Infinity) <= (instant(b) ?? Infinity) ? a : b;
};

const later = (a: string, b: string): string => ((instant(a) ?? 0) >= (instant(b) ?? 0) ? a : b);

/**
 * A tier as a visitor can use it: a closed or not-yet-open congress decides for every tier (a full tier still
 * reads as full); otherwise the tier's own state. A tier that opens only after the congress opens reports the
 * later instant.
 */
export function tierAvailability(event: RegistrationFields, tier: TierFields, now: number = Date.now()): Availability {
  const congress = registrationWindow(event, now);
  const own = tierWindow(tier, now);
  if (own.kind === "full") return own;
  if (congress.kind === "closed") return congress;
  if (congress.kind === "opens") {
    if (own.kind === "closed") return own;
    return own.kind === "opens" ? { kind: "opens", at: later(congress.at, own.at) } : congress;
  }
  if (own.kind === "open") return { kind: "open", closesAt: earlier(congress.closesAt, own.closesAt) };
  return own;
}

export type RegistrationSummary =
  | { kind: "open" }
  | { kind: "opens"; at: string }
  | { kind: "full" }
  | { kind: "closed"; reason: "ended" | "event" | "tiers" };

/**
 * The congress at a glance (hero chip): open when any tier is reservable; otherwise "opens at" the earliest
 * instant a tier becomes reservable; otherwise full when a tier would be open but for its quota; otherwise closed.
 */
export function registrationSummary(event: RegistrationFields, tiers: readonly TierFields[], now: number = Date.now()): RegistrationSummary {
  const congress = registrationWindow(event, now);
  if (congress.kind === "closed") return { kind: "closed", reason: congress.reason === "ended" ? "ended" : "event" };
  const states = tiers.map((tier) => tierAvailability(event, tier, now));
  if (states.some((s) => s.kind === "open")) return { kind: "open" };
  const upcoming = states.flatMap((s) => (s.kind === "opens" ? [s.at] : []));
  if (upcoming.length > 0) return { kind: "opens", at: upcoming.reduce((a, b) => ((instant(a) ?? 0) <= (instant(b) ?? 0) ? a : b)) };
  // No passes yet (the organizer may still add them): the congress's own opening is the useful answer.
  if (congress.kind === "opens" && tiers.length === 0) return { kind: "opens", at: congress.at };
  if (states.some((s) => s.kind === "full") && tiers.some((t) => t.is_open)) return { kind: "full" };
  return { kind: "closed", reason: "tiers" };
}

/** The next instant at which any of these states changes on its own (for a timer), or null. */
export function nextChange(states: readonly Availability[], now: number = Date.now()): number | null {
  let next: number | null = null;
  for (const s of states) {
    const at = s.kind === "opens" ? instant(s.at) : s.kind === "open" ? instant(s.closesAt) : null;
    if (at !== null && at > now && (next === null || at < next)) next = at;
  }
  return next;
}

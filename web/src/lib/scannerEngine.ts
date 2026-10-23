/**
 * The gate scanner's local admission engine: what the device decides on its own (offline, or when the server
 * does not answer in time) from the cached manifest, and how it keeps that state in step with the server's
 * verdicts. It applies the server's rules in the server's order (backend/app/routes/checkin.py); the scenarios in
 * backend/tests/fixtures/gate_parity.json are decided alike by both (web/tests/scannerParity.test.ts).
 *
 * An entry (IN) is checked for: tier filter, required point, single use in the admission window, already inside
 * (admitted without counting again), capacity. An exit (OUT) needs a point that tracks occupancy and a ticket
 * inside.
 */

import { wallClock } from "./format.ts";

/** One manifest ticket, keyed by `qr_hash` (sha256 of "<event_id>:<secret>"); raw secrets are never cached. */
export interface LocalTicket {
  qr_hash: string;
  ticket_id: string;
  attendee_name: string;
  ticket_tier_id: string;
  ticket_tier_name: string;
  /** Admitted in the current admission window (older manifests: at this point at all). */
  is_admitted: boolean;
  admission_count: number;
  /** Window of the latest admission ('event' or a local date); absent in manifests of older servers. */
  last_admitted_window?: string | null;
  /** Occupancy points: inside in `presence_window`. */
  is_inside?: boolean;
  /** Scan time of the entry or exit that decided `is_inside`. */
  presence_at?: string | null;
  presence_window?: string;
  /** Admitted at the point this one requires (absent or true without one). */
  prerequisite_met?: boolean;
}
export type AdmissionOutcome = "ADMITTED" | "PROVISIONAL" | "REJECTED";
export type ScanDirection = "IN" | "OUT";

export interface LocalPolicyConfig {
  policy_type: "MULTI_ENTRY" | "SINGLE_USE" | "TIER_RESTRICTED" | "CAPACITY_CAPPED";
  allowed_tier_ids: string[];
  max_capacity?: number | null;
  current_admitted_count?: number;
  is_offline?: boolean;
  fail_closed_offline_capacity?: boolean;
  /** Entry and exit scans; a capped point caps the people inside (`current_occupancy`). */
  tracks_occupancy?: boolean;
  current_occupancy?: number;
  /** The point requires admission at another point first. */
  requires_point?: boolean;
  /** This scan's direction (default IN). */
  direction?: ScanDirection;
  /** This scan's admission window ('event' or its local date); absent: whatever the manifest says now. */
  admission_window?: string;
  /** This scan's time, kept as the presence time of an entry or exit. */
  scanned_at?: string;
}

export interface LocalScanResult {
  status: "ADMITTED" | "REJECTED";
  outcome: AdmissionOutcome;
  is_provisional: boolean;
  rejection_reason: string | null;
  ticket: LocalTicket | null;
  current_admitted_count: number;
  /** IN, or OUT for an exit; an accepted exit has status ADMITTED. */
  direction: ScanDirection;
  current_occupancy?: number;
}

const DEFAULT_TIME_ZONE = "Asia/Tehran";

/**
 * The admission window of a moment at a point: 'event', or its calendar date (YYYY-MM-DD) in the event's time
 * zone when the point resets daily. The server stores the same key on every scan.
 */
export function admissionWindowKey(resetWindow: string | null | undefined, timeZone: string | null | undefined, at: Date | string): string {
  if (resetWindow !== "DAY") return "event";
  const c = wallClock(at, timeZone || DEFAULT_TIME_ZONE);
  return `${String(c.year).padStart(4, "0")}-${String(c.month).padStart(2, "0")}-${String(c.day).padStart(2, "0")}`;
}

function admittedInWindow(ticket: LocalTicket, window: string | undefined): boolean {
  if (window === undefined || ticket.last_admitted_window === undefined) return ticket.is_admitted;
  return ticket.last_admitted_window === window;
}

function insideIn(ticket: LocalTicket, window: string | undefined): boolean {
  if (!ticket.is_inside) return false;
  return window === undefined || ticket.presence_window === undefined || ticket.presence_window === window;
}

function tierAllowed(policy: LocalPolicyConfig, ticket: LocalTicket): boolean {
  const allowed = policy.allowed_tier_ids || [];
  // No allowed tiers admits every tier, except at a tier-restricted point (the server refuses to save one).
  if (allowed.length === 0 && policy.policy_type !== "TIER_RESTRICTED") return true;
  return allowed.includes(ticket.ticket_tier_id);
}

function setPresence(ticket: LocalTicket, inside: boolean, window: string | undefined, at: string | undefined): void {
  ticket.is_inside = inside;
  ticket.presence_at = at ?? new Date().toISOString();
  if (window !== undefined) ticket.presence_window = window;
}

/** Evaluates one scan against the local manifest; `qrHashKey` is the scanned code's manifest hash. Mutates the ticket. */
export function evaluateLocalScan(
  tickets: Record<string, LocalTicket>,
  policy: LocalPolicyConfig,
  qrHashKey: string
): LocalScanResult {
  const ticket = tickets[qrHashKey.trim().toLowerCase()];
  const isOffline = Boolean(policy.is_offline);
  const provisionalOutcome: AdmissionOutcome = isOffline ? "PROVISIONAL" : "ADMITTED";
  const direction: ScanDirection = policy.direction ?? "IN";
  const window = policy.admission_window;
  const tracks = Boolean(policy.tracks_occupancy);

  const reject = (reason: string, found: LocalTicket | null = ticket ?? null): LocalScanResult => ({
    status: "REJECTED",
    outcome: "REJECTED",
    is_provisional: false,
    rejection_reason: reason,
    ticket: found,
    current_admitted_count: policy.current_admitted_count ?? 0,
    direction,
    current_occupancy: policy.current_occupancy,
  });
  const accept = (found: LocalTicket): LocalScanResult => ({
    status: "ADMITTED",
    outcome: provisionalOutcome,
    is_provisional: isOffline,
    rejection_reason: null,
    ticket: found,
    current_admitted_count: policy.current_admitted_count ?? 0,
    direction,
    current_occupancy: policy.current_occupancy,
  });

  if (!ticket) return reject(isOffline ? "NOT_IN_LOCAL_MANIFEST" : "INVALID_TICKET", null);

  if (direction === "OUT") {
    if (!tracks) return reject("EXIT_NOT_TRACKED");
    if (!insideIn(ticket, window)) return reject("NOT_INSIDE");
    setPresence(ticket, false, window, policy.scanned_at);
    policy.current_occupancy = Math.max(0, (policy.current_occupancy ?? 0) - 1);
    return accept(ticket);
  }

  if (!tierAllowed(policy, ticket)) return reject("TIER_NOT_ALLOWED");
  if (policy.requires_point && ticket.prerequisite_met === false) return reject("REQUIRED_POINT_NOT_VISITED");
  if (policy.policy_type === "SINGLE_USE" && admittedInWindow(ticket, window)) return reject("ALREADY_ADMITTED");

  const alreadyInside = tracks && insideIn(ticket, window);
  if (!alreadyInside && policy.policy_type === "CAPACITY_CAPPED") {
    // A disconnected device cannot know the room's count across gates: with the fail-closed option it admits
    // nobody new; without it, offline admissions are provisional until the server reconciles them.
    if (isOffline && policy.fail_closed_offline_capacity) return reject("CAPACITY_UNAVAILABLE_OFFLINE");
    const current = tracks ? (policy.current_occupancy ?? 0) : (policy.current_admitted_count ?? 0);
    if (policy.max_capacity !== null && policy.max_capacity !== undefined && current >= policy.max_capacity) {
      return reject("CAPACITY_REACHED");
    }
  }

  ticket.is_admitted = true;
  if (window !== undefined) ticket.last_admitted_window = window;
  ticket.admission_count += 1;
  policy.current_admitted_count = (policy.current_admitted_count ?? 0) + 1;
  if (tracks && !alreadyInside) {
    // Someone already inside is let through without being counted again.
    setPresence(ticket, true, window, policy.scanned_at);
    policy.current_occupancy = (policy.current_occupancy ?? 0) + 1;
  }
  return accept(ticket);
}

export interface ReplayedScan {
  qr_hash?: string;
  scanned_at?: string;
  status: "ADMITTED" | "REJECTED";
  sync_state?: string;
  rejection_reason?: string | null;
  direction?: ScanDirection;
}

/** Where the device is now: the window scans count in, and what the manifest's state refers to. */
export interface AdmissionContext {
  /** The admission window now, on this device's clock. */
  window?: string;
  /** The window the manifest's is_admitted and is_inside refer to. */
  manifestWindow?: string;
  resetWindow?: string;
  timeZone?: string;
}

const later = (a: string | null | undefined, b: string | null | undefined) => !b || (a ? Date.parse(a) > Date.parse(b) : false);

/**
 * Rebuilds the admission state scans are evaluated against: the manifest (the server's admitted state)
 * is the base, and this device's scans are replayed over it in scanned_at order. Replay only ever adds
 * admissions: a server conflict means this device's provisional admission did not count, never that the
 * server's own admission of that ticket went away (a conflict rejected as ALREADY_ADMITTED even proves
 * the server holds one). Scans without a `qr_hash` (none of this manifest's tickets) are skipped.
 *
 * Windows: only scans in the current window count, and the manifest's state counts only if it refers to the
 * current window (a manifest fetched before midnight says nothing about today's meals). Presence: an entry or exit
 * of this device changes who is inside only if it is later than the scan that decided the manifest's state
 * (`presence_at`), as on the server.
 */
export function reconstructLocalState(
  manifestTickets: LocalTicket[],
  localScans: ReplayedScan[],
  context: AdmissionContext = {}
): {
  ticketMap: Record<string, LocalTicket>;
  currentAdmittedCount: number;
  occupancy: number;
} {
  const ticketMap: Record<string, LocalTicket> = {};
  const { window, manifestWindow } = context;
  const manifestCurrent = window === undefined || manifestWindow === undefined || manifestWindow === window;
  let admittedCount = 0;

  for (const t of manifestTickets) {
    const key = t.qr_hash.trim().toLowerCase();
    const admitted =
      window !== undefined && t.last_admitted_window !== undefined
        ? t.last_admitted_window === window
        : manifestCurrent && Boolean(t.is_admitted);
    const inside = manifestCurrent && Boolean(t.is_inside);
    ticketMap[key] = {
      ...t,
      qr_hash: key,
      admission_count: t.admission_count || (t.is_admitted ? 1 : 0),
      is_admitted: admitted,
      is_inside: inside,
      presence_at: manifestCurrent ? (t.presence_at ?? null) : null,
      ...(window !== undefined ? { presence_window: window } : {}),
    };
    if (admitted) admittedCount += 1;
  }

  const ordered = [...localScans].sort((a, b) => (a.scanned_at ?? "").localeCompare(b.scanned_at ?? ""));
  for (const s of ordered) {
    const ticket = s.qr_hash ? ticketMap[s.qr_hash] : undefined;
    if (!ticket) continue;
    if (window !== undefined && s.scanned_at && admissionWindowKey(context.resetWindow, context.timeZone, s.scanned_at) !== window) {
      continue;
    }
    const direction = s.direction ?? "IN";
    const admittedHere = s.status === "ADMITTED" && s.sync_state !== "CONFLICT";
    if (admittedHere && later(s.scanned_at, ticket.presence_at)) {
      ticket.is_inside = direction === "IN";
      ticket.presence_at = s.scanned_at ?? null;
    }
    if (direction === "OUT") continue;
    const admittedElsewhere = s.status === "REJECTED" && s.rejection_reason === "ALREADY_ADMITTED";
    if (!admittedHere && !admittedElsewhere) continue;
    if (!ticket.is_admitted) {
      ticket.is_admitted = true;
      admittedCount += 1;
    }
    if (window !== undefined) ticket.last_admitted_window = window;
    if (admittedHere) ticket.admission_count += 1;
  }

  const occupancy = Object.values(ticketMap).filter((t) => t.is_inside).length;
  return { ticketMap, currentAdmittedCount: admittedCount, occupancy };
}

/** What the server answered for one scan it decided (the online path). */
export interface ServerScanVerdict {
  status: string;
  rejection_reason?: string | null;
  attendee_name?: string | null;
  ticket_tier_name?: string | null;
  direction?: string | null;
}

/**
 * Applies a scan the server decided to the live admission state, as reconstructLocalState replays it:
 * an admission marks the ticket admitted and advances the count; an ALREADY_ADMITTED rejection proves an
 * admission elsewhere; an accepted entry or exit moves the ticket in or out, and NOT_INSIDE proves it is out.
 * Mutates the ticket entry. A code missing from the manifest (e.g. a walk-in issued since the last refresh)
 * still shows the attendee the server named.
 */
export function applyServerScan(
  state: { ticketMap: Record<string, LocalTicket>; admittedCount: number; occupancy?: number },
  qrHashKey: string,
  verdict: ServerScanVerdict,
  scan: { window?: string; scannedAt?: string; tracksOccupancy?: boolean } = {}
): LocalScanResult {
  const admitted = verdict.status === "ADMITTED";
  const direction: ScanDirection = verdict.direction === "OUT" ? "OUT" : "IN";
  let ticket: LocalTicket | null = state.ticketMap[qrHashKey.trim().toLowerCase()] ?? null;
  let count = state.admittedCount;
  let occupancy = state.occupancy ?? 0;
  if (ticket) {
    const wasInside = insideIn(ticket, scan.window);
    if (admitted && direction === "IN") {
      ticket.is_admitted = true;
      if (scan.window !== undefined) ticket.last_admitted_window = scan.window;
      ticket.admission_count += 1;
    } else if (verdict.rejection_reason === "ALREADY_ADMITTED") {
      ticket.is_admitted = true;
      if (scan.window !== undefined) ticket.last_admitted_window = scan.window;
    }
    if (scan.tracksOccupancy && (admitted || verdict.rejection_reason === "NOT_INSIDE")) {
      const inside = admitted && direction === "IN";
      setPresence(ticket, inside, scan.window, scan.scannedAt);
      occupancy += Number(inside) - Number(wasInside);
    }
  } else if (verdict.attendee_name) {
    ticket = {
      qr_hash: qrHashKey,
      ticket_id: "",
      attendee_name: verdict.attendee_name,
      ticket_tier_id: "",
      ticket_tier_name: verdict.ticket_tier_name ?? "",
      is_admitted: admitted && direction === "IN",
      admission_count: admitted && direction === "IN" ? 1 : 0,
    };
    if (scan.tracksOccupancy && admitted) occupancy += direction === "IN" ? 1 : -1;
  }
  if (admitted && direction === "IN") count += 1;
  return {
    status: admitted ? "ADMITTED" : "REJECTED",
    outcome: admitted ? "ADMITTED" : "REJECTED",
    is_provisional: false,
    rejection_reason: admitted ? null : verdict.rejection_reason || "SERVER_REJECTED",
    ticket,
    current_admitted_count: count,
    direction,
    current_occupancy: Math.max(0, occupancy),
  };
}

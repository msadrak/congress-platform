/** One manifest ticket, keyed by `qr_hash` (sha256 of "<event_id>:<secret>"); raw secrets are never cached. */
export interface LocalTicket {
  qr_hash: string;
  ticket_id: string;
  attendee_name: string;
  ticket_tier_id: string;
  ticket_tier_name: string;
  is_admitted: boolean;
  admission_count: number;
}
export type AdmissionOutcome = "ADMITTED" | "PROVISIONAL" | "REJECTED";

export interface LocalPolicyConfig {
  policy_type: "MULTI_ENTRY" | "SINGLE_USE" | "TIER_RESTRICTED" | "CAPACITY_CAPPED";
  allowed_tier_ids: string[];
  max_capacity?: number | null;
  current_admitted_count?: number;
  is_offline?: boolean;
  fail_closed_offline_capacity?: boolean;
}

export interface LocalScanResult {
  status: "ADMITTED" | "REJECTED";
  outcome: AdmissionOutcome;
  is_provisional: boolean;
  rejection_reason: string | null;
  ticket: LocalTicket | null;
  current_admitted_count: number;
}

/** Evaluates one scan against the local manifest; `qrHashKey` is the scanned code's manifest hash. */
export function evaluateLocalScan(
  tickets: Record<string, LocalTicket>,
  policy: LocalPolicyConfig,
  qrHashKey: string
): LocalScanResult {
  const ticket = tickets[qrHashKey.trim().toLowerCase()];
  const isOffline = Boolean(policy.is_offline);
  const provisionalOutcome: AdmissionOutcome = isOffline ? "PROVISIONAL" : "ADMITTED";

  if (!ticket) {
    return {
      status: "REJECTED",
      outcome: "REJECTED",
      is_provisional: false,
      rejection_reason: isOffline ? "NOT_IN_LOCAL_MANIFEST" : "INVALID_TICKET",
      ticket: null,
      current_admitted_count: policy.current_admitted_count ?? 0,
    };
  }

  if (policy.policy_type === "SINGLE_USE") {
    if (ticket.is_admitted) {
      return {
        status: "REJECTED",
        outcome: "REJECTED",
        is_provisional: false,
        rejection_reason: "ALREADY_ADMITTED",
        ticket,
        current_admitted_count: policy.current_admitted_count ?? 0,
      };
    }
    ticket.is_admitted = true;
    ticket.admission_count += 1;
    policy.current_admitted_count = (policy.current_admitted_count ?? 0) + 1;
    return {
      status: "ADMITTED",
      outcome: provisionalOutcome,
      is_provisional: isOffline,
      rejection_reason: null,
      ticket,
      current_admitted_count: policy.current_admitted_count,
    };
  }

  if (policy.policy_type === "TIER_RESTRICTED") {
    // No allowed tiers admits nobody (the server refuses to save such a point and rejects these scans).
    const allowed = policy.allowed_tier_ids || [];
    if (!allowed.includes(ticket.ticket_tier_id)) {
      return {
        status: "REJECTED",
        outcome: "REJECTED",
        is_provisional: false,
        rejection_reason: "TIER_NOT_ALLOWED",
        ticket,
        current_admitted_count: policy.current_admitted_count ?? 0,
      };
    }
    ticket.admission_count += 1;
    policy.current_admitted_count = (policy.current_admitted_count ?? 0) + 1;
    return {
      status: "ADMITTED",
      outcome: provisionalOutcome,
      is_provisional: isOffline,
      rejection_reason: null,
      ticket,
      current_admitted_count: policy.current_admitted_count,
    };
  }

  if (policy.policy_type === "CAPACITY_CAPPED") {
    if (isOffline && policy.fail_closed_offline_capacity) {
      return {
        status: "REJECTED",
        outcome: "REJECTED",
        is_provisional: false,
        rejection_reason: "CAPACITY_UNAVAILABLE_OFFLINE",
        ticket,
        current_admitted_count: policy.current_admitted_count ?? 0,
      };
    }
    const current = policy.current_admitted_count ?? 0;
    if (policy.max_capacity !== null && policy.max_capacity !== undefined) {
      if (current >= policy.max_capacity) {
        return {
          status: "REJECTED",
          outcome: "REJECTED",
          is_provisional: false,
          rejection_reason: "CAPACITY_REACHED",
          ticket,
          current_admitted_count: current,
        };
      }
    }
    ticket.admission_count += 1;
    policy.current_admitted_count = current + 1;

    // Issue #15: A disconnected device cannot guarantee global room capacity
    // across multiple concurrent offline scanner gates.
    // When operating offline, capacity-capped admission is explicitly PROVISIONAL
    // pending authoritative server reconciliation.
    return {
      status: "ADMITTED",
      outcome: provisionalOutcome,
      is_provisional: isOffline,
      rejection_reason: null,
      ticket,
      current_admitted_count: policy.current_admitted_count,
    };
  }

  // MULTI_ENTRY
  ticket.admission_count += 1;
  policy.current_admitted_count = (policy.current_admitted_count ?? 0) + 1;
  return {
    status: "ADMITTED",
    outcome: provisionalOutcome,
    is_provisional: isOffline,
    rejection_reason: null,
    ticket,
    current_admitted_count: policy.current_admitted_count,
  };
}

export interface ReplayedScan {
  qr_hash?: string;
  scanned_at?: string;
  status: "ADMITTED" | "REJECTED";
  sync_state?: string;
  rejection_reason?: string | null;
}

/**
 * Rebuilds the admission state scans are evaluated against: the manifest (the server's admitted state)
 * is the base, and this device's scans are replayed over it in scanned_at order. Replay only ever adds
 * admissions: a server conflict means this device's provisional admission did not count, never that the
 * server's own admission of that ticket went away (a conflict rejected as ALREADY_ADMITTED even proves
 * the server holds one). Scans without a `qr_hash` (none of this manifest's tickets) are skipped.
 */
export function reconstructLocalState(
  manifestTickets: LocalTicket[],
  localScans: ReplayedScan[]
): {
  ticketMap: Record<string, LocalTicket>;
  currentAdmittedCount: number;
} {
  const ticketMap: Record<string, LocalTicket> = {};
  let admittedCount = 0;

  for (const t of manifestTickets) {
    const key = t.qr_hash.trim().toLowerCase();
    ticketMap[key] = {
      ...t,
      qr_hash: key,
      admission_count: t.admission_count || (t.is_admitted ? 1 : 0),
      is_admitted: t.is_admitted || false,
    };
    if (t.is_admitted) {
      admittedCount += 1;
    }
  }

  const ordered = [...localScans].sort((a, b) => (a.scanned_at ?? "").localeCompare(b.scanned_at ?? ""));
  for (const s of ordered) {
    const ticket = s.qr_hash ? ticketMap[s.qr_hash] : undefined;
    if (!ticket) continue;
    const admittedHere = s.status === "ADMITTED" && s.sync_state !== "CONFLICT";
    const admittedElsewhere = s.status === "REJECTED" && s.rejection_reason === "ALREADY_ADMITTED";
    if (!admittedHere && !admittedElsewhere) continue;
    if (!ticket.is_admitted) {
      ticket.is_admitted = true;
      admittedCount += 1;
    }
    if (admittedHere) ticket.admission_count += 1;
  }

  return { ticketMap, currentAdmittedCount: admittedCount };
}

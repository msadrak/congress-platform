export interface LocalTicket {
  qr_secret: string;
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

export function evaluateLocalScan(
  tickets: Record<string, LocalTicket>,
  policy: LocalPolicyConfig,
  rawSecret: string
): LocalScanResult {
  const secret = rawSecret.trim().toLowerCase();
  const ticket = tickets[secret];
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
    const allowed = policy.allowed_tier_ids || [];
    if (allowed.length > 0 && !allowed.includes(ticket.ticket_tier_id)) {
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

/**
 * Reconstructs local ticket state and calculates current admitted count
 * from a manifest snapshot and local historical/pending scan records.
 */
export function reconstructLocalState(
  manifestTickets: LocalTicket[],
  localScans: Array<{
    qr_secret: string;
    status: "ADMITTED" | "REJECTED";
    sync_state?: string;
  }>
): {
  ticketMap: Record<string, LocalTicket>;
  currentAdmittedCount: number;
} {
  const ticketMap: Record<string, LocalTicket> = {};
  let admittedCount = 0;

  for (const t of manifestTickets) {
    const key = t.qr_secret.trim().toLowerCase();
    ticketMap[key] = {
      ...t,
      qr_secret: key,
      admission_count: t.admission_count || (t.is_admitted ? 1 : 0),
      is_admitted: t.is_admitted || false,
    };
    if (t.is_admitted) {
      admittedCount += 1;
    }
  }

  // Replay local scan records
  for (const s of localScans) {
    const key = s.qr_secret.trim().toLowerCase();
    const ticket = ticketMap[key];
    if (!ticket) continue;

    // If locally admitted and not flagged as server conflict:
    if (s.status === "ADMITTED" && s.sync_state !== "CONFLICT") {
      if (!ticket.is_admitted) {
        ticket.is_admitted = true;
        admittedCount += 1;
      }
      ticket.admission_count += 1;
    } else if (s.status === "REJECTED" && s.sync_state === "CONFLICT") {
      // A provisional admission that was rejected by server:
      // If ticket was only admitted provisionally, revert is_admitted
      // (server authority wins)
      ticket.is_admitted = false;
    }
  }

  return { ticketMap, currentAdmittedCount: admittedCount };
}

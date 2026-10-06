export interface LocalTicket {
  qr_secret: string;
  ticket_id: string;
  attendee_name: string;
  ticket_tier_id: string;
  ticket_tier_name: string;
  is_admitted: boolean;
  admission_count: number;
}

export interface LocalPolicyConfig {
  policy_type: "MULTI_ENTRY" | "SINGLE_USE" | "TIER_RESTRICTED" | "CAPACITY_CAPPED";
  allowed_tier_ids: string[];
  max_capacity?: number | null;
  current_admitted_count?: number;
}

export interface LocalScanResult {
  status: "ADMITTED" | "REJECTED";
  rejection_reason: string | null;
  ticket: LocalTicket | null;
}

export function evaluateLocalScan(
  tickets: Record<string, LocalTicket>,
  policy: LocalPolicyConfig,
  rawSecret: string
): LocalScanResult {
  const secret = rawSecret.trim().toLowerCase();
  const ticket = tickets[secret];

  if (!ticket) {
    return {
      status: "REJECTED",
      rejection_reason: "INVALID_TICKET",
      ticket: null,
    };
  }

  if (policy.policy_type === "SINGLE_USE") {
    if (ticket.is_admitted) {
      return {
        status: "REJECTED",
        rejection_reason: "ALREADY_ADMITTED",
        ticket,
      };
    }
    ticket.is_admitted = true;
    ticket.admission_count += 1;
    return {
      status: "ADMITTED",
      rejection_reason: null,
      ticket,
    };
  }

  if (policy.policy_type === "TIER_RESTRICTED") {
    const allowed = policy.allowed_tier_ids || [];
    if (allowed.length > 0 && !allowed.includes(ticket.ticket_tier_id)) {
      return {
        status: "REJECTED",
        rejection_reason: "TIER_NOT_ALLOWED",
        ticket,
      };
    }
    ticket.admission_count += 1;
    return {
      status: "ADMITTED",
      rejection_reason: null,
      ticket,
    };
  }

  if (policy.policy_type === "CAPACITY_CAPPED") {
    if (policy.max_capacity !== null && policy.max_capacity !== undefined) {
      const current = policy.current_admitted_count ?? 0;
      if (current >= policy.max_capacity) {
        return {
          status: "REJECTED",
          rejection_reason: "CAPACITY_REACHED",
          ticket,
        };
      }
    }
    ticket.admission_count += 1;
    return {
      status: "ADMITTED",
      rejection_reason: null,
      ticket,
    };
  }

  // MULTI_ENTRY
  ticket.admission_count += 1;
  return {
    status: "ADMITTED",
    rejection_reason: null,
    ticket,
  };
}

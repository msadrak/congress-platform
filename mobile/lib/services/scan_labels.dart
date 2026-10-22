/// Operator-facing wording for scan verdict codes and gate policies.
/// Keeps raw backend enums out of the UI.
String reasonLabel(String? code) {
  switch (code) {
    case 'INVALID_TICKET':
      return 'Not a ticket for this event';
    case 'ALREADY_ADMITTED':
      return 'Already checked in — send to help desk';
    case 'TIER_NOT_ALLOWED':
      return 'Ticket type not allowed at this gate';
    case 'CAPACITY_REACHED':
      return 'Gate is full';
    case 'SERVER_REJECTED':
      return 'Refused by the event server — send to help desk';
    default:
      return 'Not admitted — send to help desk';
  }
}

String policyLabel(String policyType) {
  switch (policyType.toUpperCase()) {
    case 'SINGLE_USE':
      return 'Single entry';
    case 'MULTI_ENTRY':
      return 'Multi-entry';
    case 'TIER_RESTRICTED':
      return 'Selected ticket types';
    case 'CAPACITY_CAPPED':
      return 'Limited capacity';
    default:
      return 'Multi-entry';
  }
}

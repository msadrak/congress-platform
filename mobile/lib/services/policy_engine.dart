import '../models/checkin_point.dart';
import '../models/manifest_ticket.dart';
import '../models/scan_result.dart';

class PolicyEngine {
  static ScanResult evaluate({
    required Map<String, ManifestTicket> tickets,
    required CheckInPoint point,
    required String rawSecret,
    int currentAdmittedCount = 0,
  }) {
    final secret = rawSecret.trim().toLowerCase();
    final ticket = tickets[secret];

    if (ticket == null) {
      return ScanResult(
        status: 'REJECTED',
        rejectionReason: 'INVALID_TICKET',
      );
    }

    final policy = point.policyType.toUpperCase();

    if (policy == 'SINGLE_USE') {
      if (ticket.isAdmitted) {
        return ScanResult(
          status: 'REJECTED',
          rejectionReason: 'ALREADY_ADMITTED',
          ticket: ticket,
        );
      }
      ticket.isAdmitted = true;
      ticket.admissionCount += 1;
      return ScanResult(
        status: 'ADMITTED',
        ticket: ticket,
      );
    }

    if (policy == 'TIER_RESTRICTED') {
      if (point.allowedTierIds.isNotEmpty &&
          !point.allowedTierIds.contains(ticket.ticketTierId)) {
        return ScanResult(
          status: 'REJECTED',
          rejectionReason: 'TIER_NOT_ALLOWED',
          ticket: ticket,
        );
      }
      ticket.admissionCount += 1;
      return ScanResult(
        status: 'ADMITTED',
        ticket: ticket,
      );
    }

    if (policy == 'CAPACITY_CAPPED') {
      if (point.maxCapacity != null &&
          currentAdmittedCount >= point.maxCapacity!) {
        return ScanResult(
          status: 'REJECTED',
          rejectionReason: 'CAPACITY_REACHED',
          ticket: ticket,
        );
      }
      ticket.admissionCount += 1;
      return ScanResult(
        status: 'ADMITTED',
        ticket: ticket,
      );
    }

    // MULTI_ENTRY
    ticket.admissionCount += 1;
    return ScanResult(
      status: 'ADMITTED',
      ticket: ticket,
    );
  }
}

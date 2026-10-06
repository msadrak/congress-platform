import 'manifest_ticket.dart';

class ScanResult {
  final String status; // ADMITTED or REJECTED
  final String? rejectionReason;
  final ManifestTicket? ticket;

  ScanResult({
    required this.status,
    this.rejectionReason,
    this.ticket,
  });

  bool get isAdmitted => status == 'ADMITTED';
  bool get isRejected => status == 'REJECTED';
}

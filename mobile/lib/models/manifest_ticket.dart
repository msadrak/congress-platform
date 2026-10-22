/// One admissible ticket in a check-in point's offline manifest. Contact details (the attendee's mobile number)
/// are deliberately absent: the gate needs only the name and tier.
class ManifestTicket {
  final String qrSecret;
  final String ticketId;
  final String attendeeName;
  final String ticketTierId;
  final String ticketTierName;
  int admissionCount;
  bool isAdmitted;

  ManifestTicket({
    required this.qrSecret,
    required this.ticketId,
    required this.attendeeName,
    required this.ticketTierId,
    required this.ticketTierName,
    this.admissionCount = 0,
    this.isAdmitted = false,
  });

  factory ManifestTicket.fromJson(Map<String, dynamic> json) {
    return ManifestTicket(
      qrSecret: (json['qr_secret'] as String).toLowerCase().trim(),
      ticketId: json['ticket_id'] as String,
      attendeeName: json['attendee_name'] as String,
      ticketTierId: json['ticket_tier_id'] as String,
      ticketTierName: json['ticket_tier_name'] as String,
      admissionCount: (json['admission_count'] as int?) ?? 0,
      isAdmitted: (json['is_admitted'] as bool?) ?? false,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'qr_secret': qrSecret,
      'ticket_id': ticketId,
      'attendee_name': attendeeName,
      'ticket_tier_id': ticketTierId,
      'ticket_tier_name': ticketTierName,
      'admission_count': admissionCount,
      'is_admitted': isAdmitted,
    };
  }
}

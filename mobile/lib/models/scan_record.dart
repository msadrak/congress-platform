class ScanRecord {
  final String scanId;
  final String pointId;
  final String qrSecret;
  final DateTime scannedAt;
  final String status; // ADMITTED or REJECTED
  final String? rejectionReason;
  bool isSynced;

  ScanRecord({
    required this.scanId,
    required this.pointId,
    required this.qrSecret,
    required this.scannedAt,
    required this.status,
    this.rejectionReason,
    this.isSynced = false,
  });

  factory ScanRecord.fromJson(Map<String, dynamic> json) {
    return ScanRecord(
      scanId: json['scan_id'] as String,
      pointId: json['point_id'] as String,
      qrSecret: json['qr_secret'] as String,
      scannedAt: DateTime.parse(json['scanned_at'] as String),
      status: json['status'] as String,
      rejectionReason: json['rejection_reason'] as String?,
      isSynced: (json['is_synced'] as bool?) ?? false,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'scan_id': scanId,
      'point_id': pointId,
      'qr_secret': qrSecret,
      'scanned_at': scannedAt.toIso8601String(),
      'status': status,
      'rejection_reason': rejectionReason,
      'is_synced': isSynced,
    };
  }
}

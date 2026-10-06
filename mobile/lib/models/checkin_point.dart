class CheckInPoint {
  final String id;
  final String eventId;
  final String name;
  final String location;
  final String policyType; // MULTI_ENTRY, SINGLE_USE, TIER_RESTRICTED, CAPACITY_CAPPED
  final List<String> allowedTierIds;
  final int? maxCapacity;

  CheckInPoint({
    required this.id,
    required this.eventId,
    required this.name,
    this.location = '',
    this.policyType = 'MULTI_ENTRY',
    this.allowedTierIds = const [],
    this.maxCapacity,
  });

  factory CheckInPoint.fromJson(Map<String, dynamic> json) {
    return CheckInPoint(
      id: json['id'] as String,
      eventId: json['event_id'] as String,
      name: json['name'] as String,
      location: (json['location'] as String?) ?? '',
      policyType: (json['policy_type'] as String?) ?? 'MULTI_ENTRY',
      allowedTierIds: (json['allowed_tier_ids'] as List<dynamic>?)
              ?.map((e) => e.toString())
              .toList() ??
          const [],
      maxCapacity: json['max_capacity'] as int?,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'event_id': eventId,
      'name': name,
      'location': location,
      'policy_type': policyType,
      'allowed_tier_ids': allowedTierIds,
      'max_capacity': maxCapacity,
    };
  }
}

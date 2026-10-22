import 'dart:convert';
import 'package:http/http.dart' as http;
import '../models/scan_record.dart';

class ApiService {
  final String baseUrl;
  final http.Client _client;
  final String? authToken;

  ApiService({
    required this.baseUrl,
    http.Client? client,
    this.authToken,
  }) : _client = client ?? http.Client();

  Future<Map<String, dynamic>?> fetchManifest(String pointId) async {
    try {
      final uri = Uri.parse('$baseUrl/api/checkin-points/$pointId/manifest');
      final headers = <String, String>{
        if (authToken != null) 'Authorization': 'Bearer $authToken',
      };
      final response = await _client.get(uri, headers: headers);
      if (response.statusCode == 200) {
        return json.decode(response.body) as Map<String, dynamic>;
      }
    } catch (_) {
      // Network error / offline
    }
    return null;
  }

  Future<List<Map<String, dynamic>>?> sendBatchScans({
    required String pointId,
    required List<ScanRecord> scans,
  }) async {
    if (scans.isEmpty) return [];

    try {
      final uri = Uri.parse('$baseUrl/api/checkin-points/$pointId/scans/batch');
      final payload = {
        'scans': scans
            .map((s) => {
                  'scan_id': s.scanId,
                  'qr_secret': s.qrSecret,
                  'scanned_at': s.scannedAt.toUtc().toIso8601String(),
                })
            .toList(),
      };
      final headers = <String, String>{
        'Content-Type': 'application/json',
        if (authToken != null) 'Authorization': 'Bearer $authToken',
      };
      final response = await _client.post(
        uri,
        headers: headers,
        body: json.encode(payload),
      );

      if (response.statusCode == 200) {
        final data = json.decode(response.body) as Map<String, dynamic>;
        final results = (data['results'] as List<dynamic>?)
            ?.map((e) => e as Map<String, dynamic>)
            .toList();
        return results ?? [];
      }
    } catch (_) {
      // Offline / network failure
    }
    return null;
  }

  void dispose() {
    _client.close();
  }
}

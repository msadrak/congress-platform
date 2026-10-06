import 'dart:convert';
import 'package:http/http.dart' as http;
import '../models/scan_record.dart';

class ApiService {
  final String baseUrl;
  final http.Client _client;

  ApiService({
    required this.baseUrl,
    http.Client? client,
  }) : _client = client ?? http.Client();

  Future<Map<String, dynamic>?> fetchManifest(String pointId) async {
    try {
      final uri = Uri.parse('$baseUrl/api/checkin-points/$pointId/manifest');
      final response = await _client.get(uri);
      if (response.statusCode == 200) {
        return json.decode(response.body) as Map<String, dynamic>;
      }
    } catch (_) {
      // Network error / offline
    }
    return null;
  }

  Future<bool> sendBatchScans({
    required String pointId,
    required List<ScanRecord> scans,
  }) async {
    if (scans.isEmpty) return true;

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

      final response = await _client.post(
        uri,
        headers: {'Content-Type': 'application/json'},
        body: json.encode(payload),
      );

      return response.statusCode == 200;
    } catch (_) {
      // Offline / network failure
      return false;
    }
  }

  Future<String?> loginStaff(String email, String password) async {
    try {
      final uri = Uri.parse('$baseUrl/api/auth/login');
      final response = await _client.post(
        uri,
        headers: {'Content-Type': 'application/json'},
        body: json.encode({'email': email, 'password': password}),
      );
      if (response.statusCode == 200) {
        final data = json.decode(response.body) as Map<String, dynamic>;
        return data['access_token'] as String?;
      }
    } catch (_) {
      // Offline or network error
    }
    return null;
  }

  void dispose() {
    _client.close();
  }
}

import 'package:test/test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:congress_scanner_mobile/models/scan_record.dart';
import 'package:congress_scanner_mobile/services/api_service.dart';
import 'package:congress_scanner_mobile/services/storage_service.dart';
import 'package:congress_scanner_mobile/services/sync_service.dart';

void main() {
  group('SyncService & ApiService', () {
    test('SyncService sends pending scans and marks them synced upon 200 OK', () async {
      final mockClient = MockClient((request) async {
        if (request.url.path.endsWith('/scans/batch')) {
          return http.Response(
            '{"results": [{"scan_id": "s1", "status": "ADMITTED"}, {"scan_id": "s2", "status": "REJECTED", "rejection_reason": "ALREADY_ADMITTED"}]}',
            200,
          );
        }
        return http.Response('Not Found', 404);
      });

      final api = ApiService(baseUrl: 'http://test', client: mockClient);
      final storage = LocalStorageService();
      final sync = SyncService(api: api, storage: storage);

      // Enqueue 2 scans
      await storage.enqueueScan(
        ScanRecord(
          scanId: 's1',
          pointId: 'point_abc',
          qrSecret: 'sec_1',
          scannedAt: DateTime.now(),
          status: 'ADMITTED',
        ),
      );
      await storage.enqueueScan(
        ScanRecord(
          scanId: 's2',
          pointId: 'point_abc',
          qrSecret: 'sec_2',
          scannedAt: DateTime.now(),
          status: 'REJECTED',
          rejectionReason: 'ALREADY_ADMITTED',
        ),
      );

      // Perform sync
      final syncedCount = await sync.syncQueuedScans('point_abc');
      expect(syncedCount, 2);

      // Check that queue is now empty
      final pendingAfter = await storage.getUnsyncedScans('point_abc');
      expect(pendingAfter.isEmpty, isTrue);

      // Re-syncing should return 0
      final secondSync = await sync.syncQueuedScans('point_abc');
      expect(secondSync, 0);
    });
  });
}

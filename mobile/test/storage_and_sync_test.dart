import 'package:test/test.dart';
import 'package:congress_scanner_mobile/models/scan_record.dart';
import 'package:congress_scanner_mobile/services/storage_service.dart';

void main() {
  group('LocalStorageService & Offline Queue', () {
    late LocalStorageService storage;

    setUp(() {
      storage = LocalStorageService();
    });

    test('Manifest can be saved and loaded from local cache', () async {
      final manifestJson = {
        'checkin_point': {'id': 'p1', 'name': 'Gate 1', 'policy_type': 'MULTI_ENTRY'},
        'event_id': 'e1',
        'tickets': [
          {
            'qr_secret': 'sec1',
            'ticket_id': 't1',
            'attendee_name': 'Dr. Ali',
            'ticket_tier_id': 'tier1',
            'ticket_tier_name': 'General',
          }
        ]
      };

      await storage.saveManifest('p1', manifestJson);
      final loaded = await storage.loadCachedManifest('p1');

      expect(loaded, isNotNull);
      expect(loaded!['checkin_point']['name'], 'Gate 1');
      expect((loaded['tickets'] as List).length, 1);
      expect(await storage.manifestSavedAt('p1'), isNotNull);
      expect(await storage.manifestSavedAt('missing'), isNull);
    });

    test('Scans are buffered in queue and marked as synced', () async {
      final scan1 = ScanRecord(
        scanId: 'uuid-1',
        pointId: 'p1',
        qrSecret: 'sec1',
        scannedAt: DateTime.now(),
        status: 'ADMITTED',
      );
      final scan2 = ScanRecord(
        scanId: 'uuid-2',
        pointId: 'p1',
        qrSecret: 'sec2',
        scannedAt: DateTime.now(),
        status: 'REJECTED',
        rejectionReason: 'INVALID_TICKET',
      );

      await storage.enqueueScan(scan1);
      await storage.enqueueScan(scan2);

      // Verify unsynced queue
      final pending = await storage.getUnsyncedScans('p1');
      expect(pending.length, 2);
      expect(pending[0].scanId, 'uuid-1');
      expect(pending[1].scanId, 'uuid-2');

      // Mark first scan synced
      await storage.markScansSynced(['uuid-1']);

      final remaining = await storage.getUnsyncedScans('p1');
      expect(remaining.length, 1);
      expect(remaining[0].scanId, 'uuid-2');
    });
  });
}

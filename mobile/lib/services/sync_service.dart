import 'api_service.dart';
import 'storage_service.dart';

class SyncService {
  final ApiService api;
  final IStorageService storage;
  bool _isSyncing = false;
  bool _lastSyncFailed = false;

  SyncService({
    required this.api,
    required this.storage,
  });

  bool get isSyncing => _isSyncing;

  /// True when the most recent attempt could not reach the server; queued
  /// scans stay on the device until a later attempt succeeds.
  bool get lastSyncFailed => _lastSyncFailed;

  Future<int> syncQueuedScans(String pointId) async {
    if (_isSyncing) return 0;
    _isSyncing = true;

    try {
      final pending = await storage.getUnsyncedScans(pointId);
      if (pending.isEmpty) {
        _lastSyncFailed = false;
        return 0;
      }

      final results = await api.sendBatchScans(
        pointId: pointId,
        scans: pending,
      );

      if (results != null) {
        await storage.reconcileBatchOutcomes(pointId, results);
        _lastSyncFailed = false;
        return results.length;
      }
      _lastSyncFailed = true;
    } catch (_) {
      _lastSyncFailed = true;
      // Sync failed; will retry on next interval
    } finally {
      _isSyncing = false;
    }

    return 0;
  }
}

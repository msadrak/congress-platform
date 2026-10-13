import 'api_service.dart';
import 'storage_service.dart';

class SyncService {
  final ApiService api;
  final IStorageService storage;
  bool _isSyncing = false;

  SyncService({
    required this.api,
    required this.storage,
  });

  bool get isSyncing => _isSyncing;

  Future<int> syncQueuedScans(String pointId) async {
    if (_isSyncing) return 0;
    _isSyncing = true;

    try {
      final pending = await storage.getUnsyncedScans(pointId);
      if (pending.isEmpty) {
        return 0;
      }

      final results = await api.sendBatchScans(
        pointId: pointId,
        scans: pending,
      );

      if (results != null) {
        await storage.reconcileBatchOutcomes(pointId, results);
        return results.length;
      }
    } catch (_) {
      // Sync failed; will retry on next interval
    } finally {
      _isSyncing = false;
    }

    return 0;
  }
}

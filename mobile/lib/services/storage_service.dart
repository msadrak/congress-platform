import '../models/scan_record.dart';

abstract class IStorageService {
  Future<void> saveManifest(String pointId, Map<String, dynamic> rawJson);
  Future<Map<String, dynamic>?> loadCachedManifest(String pointId);
  Future<void> enqueueScan(ScanRecord scan);
  Future<List<ScanRecord>> getUnsyncedScans(String pointId);
  Future<void> markScansSynced(List<String> scanIds);
  Future<void> reconcileBatchOutcomes(String pointId, List<Map<String, dynamic>> results);
  Future<void> clearAll();
}

class LocalStorageService implements IStorageService {
  final Map<String, Map<String, dynamic>> _manifests = {};
  final List<ScanRecord> _scans = [];

  @override
  Future<void> saveManifest(String pointId, Map<String, dynamic> rawJson) async {
    _manifests[pointId] = Map<String, dynamic>.from(rawJson);
  }

  @override
  Future<Map<String, dynamic>?> loadCachedManifest(String pointId) async {
    return _manifests[pointId];
  }

  @override
  Future<void> enqueueScan(ScanRecord scan) async {
    _scans.add(scan);
  }

  @override
  Future<List<ScanRecord>> getUnsyncedScans(String pointId) async {
    return _scans
        .where((s) => s.pointId == pointId && !s.isSynced)
        .toList();
  }

  @override
  Future<void> markScansSynced(List<String> scanIds) async {
    final idSet = scanIds.toSet();
    for (final s in _scans) {
      if (idSet.contains(s.scanId)) {
        s.isSynced = true;
      }
    }
  }

  @override
  Future<void> reconcileBatchOutcomes(
      String pointId, List<Map<String, dynamic>> results) async {
    final resultMap = {for (var r in results) r['scan_id'] as String: r};
    for (final s in _scans) {
      if (s.pointId != pointId) continue;
      final serverRes = resultMap[s.scanId];
      if (serverRes == null) continue;

      s.isSynced = true;
      if (serverRes['status'] == 'ADMITTED') {
        s.status = 'ADMITTED';
        s.syncState = 'CONFIRMED';
      } else {
        s.status = 'REJECTED';
        s.syncState = 'CONFLICT';
        s.rejectionReason =
            serverRes['rejection_reason'] as String? ?? 'SERVER_REJECTED';
      }
    }
  }
  @override
  Future<void> clearAll() async {
    _manifests.clear();
    _scans.clear();
  }
}

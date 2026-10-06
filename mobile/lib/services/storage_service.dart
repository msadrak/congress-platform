import '../models/scan_record.dart';

abstract class IStorageService {
  Future<void> saveManifest(String pointId, Map<String, dynamic> rawJson);
  Future<Map<String, dynamic>?> loadCachedManifest(String pointId);
  Future<void> enqueueScan(ScanRecord scan);
  Future<List<ScanRecord>> getUnsyncedScans(String pointId);
  Future<void> markScansSynced(List<String> scanIds);
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
  Future<void> clearAll() async {
    _manifests.clear();
    _scans.clear();
  }
}

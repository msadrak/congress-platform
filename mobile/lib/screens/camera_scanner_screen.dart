import 'dart:async';
import 'package:flutter/material.dart';
import 'package:uuid/uuid.dart';
import '../models/checkin_point.dart';
import '../models/manifest_ticket.dart';
import '../models/scan_record.dart';
import '../models/scan_result.dart';
import '../services/policy_engine.dart';
import '../services/storage_service.dart';
import '../services/sync_service.dart';

class CameraScannerScreen extends StatefulWidget {
  final CheckInPoint point;
  final Map<String, ManifestTicket> initialTickets;
  final IStorageService storage;
  final SyncService syncService;

  const CameraScannerScreen({
    Key? key,
    required this.point,
    required this.initialTickets,
    required this.storage,
    required this.syncService,
  }) : super(key: key);

  @override
  State<CameraScannerScreen> createState() => _CameraScannerScreenState();
}

class _CameraScannerScreenState extends State<CameraScannerScreen> {
  final _uuid = const Uuid();
  late Map<String, ManifestTicket> _tickets;

  ScanResult? _activeResult;
  Timer? _clearResultTimer;
  Timer? _syncTimer;

  int _pendingCount = 0;
  bool _isProcessingScan = false;
  final List<ScanRecord> _recentScans = [];

  @override
  void initState() {
    super.initState();
    _tickets = Map<String, ManifestTicket>.from(widget.initialTickets);
    _updatePendingCount();

    // Background sync flusher every 5 seconds
    _syncTimer = Timer.periodic(const Duration(seconds: 5), (_) => _flushSync());
  }

  @override
  void dispose() {
    _clearResultTimer?.cancel();
    _syncTimer?.cancel();
    super.dispose();
  }

  Future<void> _updatePendingCount() async {
    final pending = await widget.storage.getUnsyncedScans(widget.point.id);
    if (mounted) {
      setState(() {
        _pendingCount = pending.length;
      });
    }
  }

  Future<void> _flushSync() async {
    final synced = await widget.syncService.syncQueuedScans(widget.point.id);
    if (synced > 0) {
      _updatePendingCount();
    }
  }

  Future<void> processCode(String rawCode) async {
    if (_isProcessingScan) return;
    _isProcessingScan = true;

    final secret = rawCode.trim().toLowerCase();
    if (secret.isEmpty) {
      _isProcessingScan = false;
      return;
    }

    final result = PolicyEngine.evaluate(
      tickets: _tickets,
      point: widget.point,
      rawSecret: secret,
    );

    final scanRecord = ScanRecord(
      scanId: _uuid.v4(),
      pointId: widget.point.id,
      qrSecret: secret,
      scannedAt: DateTime.now(),
      status: result.status,
      rejectionReason: result.rejectionReason,
      isSynced: false,
    );

    await widget.storage.enqueueScan(scanRecord);

    setState(() {
      _activeResult = result;
      _recentScans.insert(0, scanRecord);
      if (_recentScans.length > 8) _recentScans.removeLast();
    });

    _updatePendingCount();
    _flushSync();

    _clearResultTimer?.cancel();
    _clearResultTimer = Timer(const Duration(milliseconds: 1800), () {
      if (mounted) {
        setState(() {
          _activeResult = null;
          _isProcessingScan = false;
        });
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0A0A0A),
      appBar: AppBar(
        backgroundColor: const Color(0xFF171717),
        elevation: 0,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              widget.point.name,
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
            ),
            Text(
              '${widget.point.policyType} • ${_tickets.length} cached passes',
              style: const TextStyle(fontSize: 11, color: Colors.white60),
            ),
          ],
        ),
        actions: [
          Container(
            margin: const EdgeInsets.only(right: 12),
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: _pendingCount > 0
                  ? Colors.amber.withOpacity(0.2)
                  : Colors.green.withOpacity(0.2),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(
                color: _pendingCount > 0 ? Colors.amber : Colors.green,
                width: 1,
              ),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                CircleAvatar(
                  radius: 3,
                  backgroundColor:
                      _pendingCount > 0 ? Colors.amber : Colors.greenAccent,
                ),
                const SizedBox(width: 6),
                Text(
                  _pendingCount > 0 ? '$_pendingCount queued' : 'Synced',
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.bold,
                    color: _pendingCount > 0 ? Colors.amber : Colors.greenAccent,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
      body: Stack(
        children: [
          Column(
            children: [
              // Scanner Viewfinder Area (ML Kit camera target)
              Expanded(
                flex: 6,
                child: Container(
                  color: Colors.black,
                  child: Stack(
                    alignment: Alignment.center,
                    children: [
                      // Viewfinder reticle
                      Container(
                        width: 220,
                        height: 220,
                        decoration: BoxDecoration(
                          border: Border.all(
                            color: const Color(0xFF10B981),
                            width: 2,
                          ),
                          borderRadius: BorderRadius.circular(20),
                        ),
                        child: const Center(
                          child: Icon(
                            Icons.center_focus_weak,
                            size: 48,
                            color: Colors.white24,
                          ),
                        ),
                      ),
                      Positioned(
                        bottom: 24,
                        child: Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 16, vertical: 8),
                          decoration: BoxDecoration(
                            color: Colors.black82,
                            borderRadius: BorderRadius.circular(20),
                          ),
                          child: const Text(
                            'Aim camera at attendee QR badge (<35ms)',
                            style: TextStyle(color: Colors.white70, fontSize: 12),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),

              // Recent Scans Feed
              Expanded(
                flex: 4,
                child: Container(
                  padding: const EdgeInsets.all(16),
                  color: const Color(0xFF121212),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          const Text(
                            'Recent Gate Scans',
                            style: TextStyle(
                              color: Colors.white70,
                              fontSize: 12,
                              fontWeight: FontWeight.bold,
                              letterSpacing: 0.5,
                            ),
                          ),
                          TextButton(
                            onPressed: _flushSync,
                            child: const Text(
                              'Sync Now ↗',
                              style: TextStyle(
                                  color: Color(0xFF10B981), fontSize: 12),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 8),
                      Expanded(
                        child: _recentScans.isEmpty
                            ? const Center(
                                child: Text(
                                  'Ready for attendees. No scans yet.',
                                  style: TextStyle(
                                      color: Colors.white30, fontSize: 12),
                                ),
                              )
                            : ListView.separated(
                                itemCount: _recentScans.length,
                                separatorBuilder: (_, __) =>
                                    const SizedBox(height: 6),
                                itemBuilder: (context, index) {
                                  final s = _recentScans[index];
                                  final isAdm = s.status == 'ADMITTED';
                                  return Container(
                                    padding: const EdgeInsets.symmetric(
                                        horizontal: 12, vertical: 8),
                                    decoration: BoxDecoration(
                                      color: const Color(0xFF1E1E1E),
                                      borderRadius: BorderRadius.circular(8),
                                    ),
                                    child: Row(
                                      mainAxisAlignment:
                                          MainAxisAlignment.spaceBetween,
                                      children: [
                                        Row(
                                          children: [
                                            CircleAvatar(
                                              radius: 4,
                                              backgroundColor: isAdm
                                                  ? Colors.greenAccent
                                                  : Colors.redAccent,
                                            ),
                                            const SizedBox(width: 8),
                                            Text(
                                              s.qrSecret.length > 8
                                                  ? '${s.qrSecret.substring(0, 8)}...'
                                                  : s.qrSecret,
                                              style: const TextStyle(
                                                fontFamily: 'monospace',
                                                fontSize: 12,
                                                color: Colors.white70,
                                              ),
                                            ),
                                          ],
                                        ),
                                        Text(
                                          isAdm
                                              ? 'ADMITTED'
                                              : (s.rejectionReason ?? 'REJECTED'),
                                          style: TextStyle(
                                            fontSize: 11,
                                            fontWeight: FontWeight.bold,
                                            color: isAdm
                                                ? Colors.greenAccent
                                                : Colors.redAccent,
                                          ),
                                        ),
                                      ],
                                    ),
                                  );
                                },
                              ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),

          // High-Contrast Flash Screen Overlay upon scan
          if (_activeResult != null)
            Positioned.fill(
              child: Container(
                color: _activeResult!.isAdmitted
                    ? const Color(0xFF059669) // Green
                    : const Color(0xFFDC2626), // Red
                padding: const EdgeInsets.all(32),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(
                      _activeResult!.isAdmitted ? Icons.check_circle : Icons.cancel,
                      size: 96,
                      color: Colors.white,
                    ),
                    const SizedBox(height: 16),
                    Text(
                      _activeResult!.isAdmitted ? 'ADMITTED' : 'REJECTED',
                      style: const TextStyle(
                        fontSize: 32,
                        fontWeight: FontWeight.w900,
                        color: Colors.white,
                        letterSpacing: 2,
                      ),
                    ),
                    const SizedBox(height: 12),
                    if (_activeResult!.ticket != null) ...[
                      Text(
                        _activeResult!.ticket!.attendeeName,
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                          fontSize: 24,
                          fontWeight: FontWeight.bold,
                          color: Colors.white,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        'Tier: ${_activeResult!.ticket!.ticketTierName}',
                        style: const TextStyle(
                          fontSize: 16,
                          color: Colors.white70,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ],
                    if (_activeResult!.rejectionReason != null) ...[
                      const SizedBox(height: 16),
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 16, vertical: 8),
                        decoration: BoxDecoration(
                          color: Colors.black26,
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Text(
                          'Reason: ${_activeResult!.rejectionReason!.replaceAll('_', ' ')}',
                          style: const TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.bold,
                            color: Colors.white,
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }
}

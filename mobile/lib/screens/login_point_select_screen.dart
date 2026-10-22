import 'package:flutter/material.dart';
import '../models/checkin_point.dart';
import '../models/manifest_ticket.dart';
import '../services/api_service.dart';
import '../services/storage_service.dart';
import '../services/sync_service.dart';
import 'camera_scanner_screen.dart';

class LoginPointSelectScreen extends StatefulWidget {
  final IStorageService storage;

  const LoginPointSelectScreen({
    Key? key,
    required this.storage,
  }) : super(key: key);

  @override
  State<LoginPointSelectScreen> createState() => _LoginPointSelectScreenState();
}

class _LoginPointSelectScreenState extends State<LoginPointSelectScreen> {
  final _serverUrlController = TextEditingController(text: 'http://10.0.2.2:8000');
  final _pointIdController = TextEditingController();
  bool _isLoading = false;
  String? _errorMessage;

  @override
  void dispose() {
    _serverUrlController.dispose();
    _pointIdController.dispose();
    super.dispose();
  }

  Future<void> _loadManifestAndLaunch() async {
    final serverUrl = _serverUrlController.text.trim();
    final pointId = _pointIdController.text.trim();

    if (serverUrl.isEmpty || pointId.isEmpty) {
      setState(() {
        _errorMessage = 'Enter both the event server address and the gate ID.';
      });
      return;
    }

    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    final api = ApiService(baseUrl: serverUrl);
    final syncService = SyncService(api: api, storage: widget.storage);

    // 1. Try local cache first
    var manifestData = await widget.storage.loadCachedManifest(pointId);

    DateTime? cachedSavedAt;

    // 2. Fetch fresh manifest if available
    final liveData = await api.fetchManifest(pointId);
    if (liveData != null) {
      manifestData = liveData;
      await widget.storage.saveManifest(pointId, liveData);
    } else if (manifestData != null) {
      cachedSavedAt = await widget.storage.manifestSavedAt(pointId);
    }

    if (!mounted) return;
    setState(() {
      _isLoading = false;
    });

    if (manifestData == null) {
      setState(() {
        _errorMessage =
            'Gate not found or the event server is unreachable. Check the address and gate ID, then try again.';
      });
      return;
    }

    final point = CheckInPoint.fromJson(
        manifestData['checkin_point'] as Map<String, dynamic>);
    final ticketsList = (manifestData['tickets'] as List<dynamic>)
        .map((t) => ManifestTicket.fromJson(t as Map<String, dynamic>))
        .toList();

    final ticketMap = {for (var t in ticketsList) t.qrSecret: t};

    if (!mounted) return;

    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => CameraScannerScreen(
          point: point,
          initialTickets: ticketMap,
          storage: widget.storage,
          syncService: syncService,
          offlineManifestSavedAt: cachedSavedAt,
          usingCachedManifest: liveData == null,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF121212),
      appBar: AppBar(
        title: const Text(
          'Gate Scanner',
          style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18),
        ),
        backgroundColor: const Color(0xFF1E1E1E),
        elevation: 0,
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const SizedBox(height: 20),
              const Center(
                child: CircleAvatar(
                  radius: 36,
                  backgroundColor: Color(0xFF10B981),
                  child: Icon(Icons.qr_code_scanner, size: 40, color: Colors.white),
                ),
              ),
              const SizedBox(height: 24),
              const Text(
                'Gate Operator Setup',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.bold,
                  color: Colors.white,
                ),
              ),
              const SizedBox(height: 8),
              const Text(
                'Connect to event server and load offline check-in manifest.',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 13, color: Colors.white60),
              ),
              const SizedBox(height: 32),
              TextField(
                controller: _serverUrlController,
                style: const TextStyle(color: Colors.white, fontSize: 14),
                decoration: InputDecoration(
                  labelText: 'Event server address',
                  labelStyle: const TextStyle(color: Colors.white70),
                  hintText: 'http://10.0.2.2:8000',
                  hintStyle: const TextStyle(color: Colors.white60),
                  filled: true,
                  fillColor: const Color(0xFF262626),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                    borderSide: BorderSide.none,
                  ),
                  prefixIcon: const Icon(Icons.dns, color: Color(0xFF10B981)),
                ),
              ),
              const SizedBox(height: 16),
              TextField(
                controller: _pointIdController,
                style: const TextStyle(color: Colors.white, fontSize: 14),
                decoration: InputDecoration(
                  labelText: 'Gate ID',
                  labelStyle: const TextStyle(color: Colors.white70),
                  hintText: 'Paste the gate ID from the organizer panel',
                  hintStyle: const TextStyle(color: Colors.white60),
                  filled: true,
                  fillColor: const Color(0xFF262626),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                    borderSide: BorderSide.none,
                  ),
                  prefixIcon:
                      const Icon(Icons.meeting_room, color: Color(0xFF10B981)),
                ),
              ),
              if (_errorMessage != null) ...[
                const SizedBox(height: 16),
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: Colors.red.withOpacity(0.15),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: Colors.redAccent),
                  ),
                  child: Text(
                    _errorMessage!,
                    style: const TextStyle(color: Colors.redAccent, fontSize: 12),
                  ),
                ),
              ],
              const SizedBox(height: 32),
              ElevatedButton(
                onPressed: _isLoading ? null : _loadManifestAndLaunch,
                style: ElevatedButton.styleFrom(
                  backgroundColor: Theme.of(context).colorScheme.primary,
                  foregroundColor: Theme.of(context).colorScheme.onPrimary,
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                  elevation: 2,
                ),
                child: _isLoading
                  ? const SizedBox(
                      height: 20,
                      width: 20,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        valueColor: AlwaysStoppedAnimation<Color>(Color(0xFF0A0A0A)),
                      ),
                    )
                  : const Text(
                      'Open gate',
                      style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
                    ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

import 'package:flutter/material.dart';
import 'services/storage_service.dart';
import 'screens/login_point_select_screen.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  final storage = LocalStorageService();
  runApp(CongressScannerApp(storage: storage));
}

class CongressScannerApp extends StatelessWidget {
  final IStorageService storage;

  const CongressScannerApp({
    Key? key,
    required this.storage,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Congress Gate Scanner',
      debugShowCheckedModeBanner: false,
      theme: ThemeData.dark().copyWith(
        primaryColor: const Color(0xFF10B981),
        scaffoldBackgroundColor: const Color(0xFF0A0A0A),
        colorScheme: const ColorScheme.dark(
          primary: Color(0xFF10B981),
          onPrimary: Color(0xFF0A0A0A),
          secondary: Color(0xFF059669),
          surface: Color(0xFF1E1E1E),
        ),
      ),
      home: LoginPointSelectScreen(storage: storage),
    );
  }
}

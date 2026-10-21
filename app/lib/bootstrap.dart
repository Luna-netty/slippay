import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/config/app_config.dart';

/// Single entry that wires error capture + Riverpod, then runs the app.
/// Sentry is added here when a DSN is configured (PII scrubbed before send).
Future<void> bootstrap(Widget Function() builder) async {
  WidgetsFlutterBinding.ensureInitialized();

  FlutterError.onError = (details) {
    FlutterError.presentError(details);
    if (kReleaseMode) {
      // forward to Sentry once wired; never log PII / keys / tx in release.
    }
  };

  await runZonedGuarded(() async {
    runApp(ProviderScope(child: builder()));
  }, (error, stack) {
    debugPrint('[bootstrap] uncaught: $error');
  });

  if (AppConfig.flavor != 'prod') {
    debugPrint('Slippay app · flavor=${AppConfig.flavor} · '
        'network=${AppConfig.stellarNetwork} · rpId=${AppConfig.rpId}');
  }
}

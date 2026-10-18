import 'package:flutter/material.dart';

/// Slippay design tokens, mirrored from the web (BONE canvas, INK type, a single
/// gold accent). Editorial, premium, not gaudy.
class AppColors {
  const AppColors._();

  static const Color bone = Color(0xFFF1EEE7);
  static const Color bone2 = Color(0xFFF5F3EE);
  static const Color ink = Color(0xFF0A0A0A);
  static const Color gold = Color(0xFFFDDA24);
  static const Color gray = Color(0xFF6F6862);
  static const Color ok = Color(0xFF1F7A4D);
  static const Color leak = Color(0xFFB4402F);
}

class AppTheme {
  const AppTheme._();

  static ThemeData get light {
    final base = ThemeData.light(useMaterial3: true);
    return base.copyWith(
      scaffoldBackgroundColor: AppColors.bone,
      colorScheme: base.colorScheme.copyWith(
        primary: AppColors.ink,
        secondary: AppColors.gold,
        surface: AppColors.bone,
        onSurface: AppColors.ink,
      ),
      textTheme: base.textTheme.apply(
        bodyColor: AppColors.ink,
        displayColor: AppColors.ink,
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: AppColors.gold,
          foregroundColor: AppColors.ink,
          shape: const StadiumBorder(),
          padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 18),
          textStyle: const TextStyle(
            fontWeight: FontWeight.w600,
            letterSpacing: 1.4,
            fontSize: 12,
          ),
        ),
      ),
    );
  }
}

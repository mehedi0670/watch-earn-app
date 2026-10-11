import "package:flutter/material.dart";

import "state.dart";

class EarnColors {
  static const ink = Color(0xFF10231C);
  static const green = Color(0xFF0E7A45);
  static const gold = Color(0xFFE2B043);
  static const cream = Color(0xFFF6F3EB);
  static const line = Color(0xFFE3DDD0);
  static const danger = Color(0xFF9E2B25);
  static const muted = Color(0xFF5E6A64);
}

ThemeData earnTheme() {
  return ThemeData(
    useMaterial3: true,
    scaffoldBackgroundColor: EarnColors.cream,
    colorScheme: ColorScheme.fromSeed(seedColor: EarnColors.green).copyWith(
      primary: EarnColors.green,
      surface: EarnColors.cream,
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: EarnColors.cream,
      foregroundColor: EarnColors.ink,
      elevation: 0,
      centerTitle: false,
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Colors.white,
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: const BorderSide(color: EarnColors.line)),
      enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: const BorderSide(color: EarnColors.line)),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: EarnColors.green,
        foregroundColor: Colors.white,
        minimumSize: const Size.fromHeight(52),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        textStyle: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16),
      ),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: Colors.white,
      indicatorColor: const Color(0xFFE5F6EC),
      labelTextStyle: WidgetStateProperty.all(const TextStyle(fontWeight: FontWeight.w600, fontSize: 12)),
    ),
  );
}

class AppScope extends InheritedNotifier<AppState> {
  const AppScope({required AppState state, required super.child, super.key}) : super(notifier: state);

  static AppState of(BuildContext context) {
    final scope = context.dependOnInheritedWidgetOfExactType<AppScope>();
    assert(scope != null, "AppScope missing");
    return scope!.notifier!;
  }
}

import "package:flutter/material.dart";
import "package:shared_preferences/shared_preferences.dart";

import "src/screens.dart";
import "src/state.dart";
import "src/theme.dart";

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final prefs = await SharedPreferences.getInstance();
  final state = AppState(prefs);
  runApp(EarnApp(state: state));
}

class EarnApp extends StatefulWidget {
  const EarnApp({required this.state, super.key});
  final AppState state;

  @override
  State<EarnApp> createState() => _EarnAppState();
}

class _EarnAppState extends State<EarnApp> {
  @override
  void initState() {
    super.initState();
    widget.state.boot();
  }

  @override
  Widget build(BuildContext context) {
    return AppScope(
      state: widget.state,
      child: MaterialApp(
        title: "EarnZA",
        debugShowCheckedModeBanner: false,
        theme: earnTheme(),
        home: const RootPage(),
      ),
    );
  }
}

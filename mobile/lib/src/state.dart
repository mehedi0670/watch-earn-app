import "package:firebase_auth/firebase_auth.dart";
import "package:firebase_core/firebase_core.dart";
import "package:flutter/foundation.dart";
import "package:google_sign_in/google_sign_in.dart";
import "package:shared_preferences/shared_preferences.dart";

import "api.dart";
import "config.dart";
import "device.dart";
import "firebase_options.dart";
import "models.dart";

class AppState extends ChangeNotifier {
  AppState(this.prefs);

  final SharedPreferences prefs;
  late EarnApi api = EarnApi(AppConfig.apiBase);

  bool booting = true;
  bool busy = false;
  String? bootError;
  String apiBase = AppConfig.apiBase;
  PublicConfig config = PublicConfig.empty();
  Member? user;
  Wallet? wallet;
  List<LedgerItem> ledger = [];
  List<CashOut> withdrawals = [];
  List<Notice> notifications = [];
  int unread = 0;
  bool _firebaseReady = false;
  bool _googleReady = false;

  bool get signedIn => user != null;

  Future<void> boot() async {
    apiBase = prefs.getString("apiBase") ?? AppConfig.apiBase;
    api = EarnApi(apiBase);
    api.token = prefs.getString("token");
    try {
      config = PublicConfig.fromJson(await api.get("/v1/config"));
      bootError = null;
      if (api.token != null) {
        try {
          await refresh();
        } catch (_) {
          await logout(silent: true);
        }
      }
    } on ApiException catch (error) {
      bootError = error.message;
    }
    booting = false;
    notifyListeners();
  }

  Future<void> setApiBase(String value) async {
    apiBase = value.trim().replaceAll(RegExp(r"/+$"), "");
    await prefs.setString("apiBase", apiBase);
    api = EarnApi(apiBase);
    config = PublicConfig.fromJson(await api.get("/v1/config"));
    bootError = null;
    notifyListeners();
  }

  Future<void> refresh() async {
    final me = await api.get("/v1/me");
    user = Member.fromJson(me["user"] as Map<String, dynamic>);
    wallet = Wallet.fromJson(me["wallet"] as Map<String, dynamic>);
    final notes = await api.get("/v1/notifications");
    notifications = ((notes["notifications"] as List?) ?? []).map((item) => Notice.fromJson(item as Map<String, dynamic>)).toList();
    unread = asInt(notes["unread"]);
    final history = await api.get("/v1/ledger");
    ledger = ((history["ledger"] as List?) ?? []).map((item) => LedgerItem.fromJson(item as Map<String, dynamic>)).toList();
    final cash = await api.get("/v1/withdrawals");
    withdrawals = ((cash["withdrawals"] as List?) ?? []).map((item) => CashOut.fromJson(item as Map<String, dynamic>)).toList();
    notifyListeners();
  }

  Future<void> login(String email, String password) async {
    if (AppConfig.useFirebase && !config.demoMode) {
      await _ensureFirebase();
      final credential = await FirebaseAuth.instance.signInWithEmailAndPassword(email: email.trim(), password: password);
      final idToken = await credential.user?.getIdToken();
      if (idToken == null) throw ApiException("AUTH", "Firebase did not return a session.");
      final result = await api.post("/v1/auth/firebase", {"idToken": idToken, "device": await collectDevice(prefs)});
      await _accept(result, idToken);
      return;
    }
    final result = await api.post("/v1/auth/login", {
      "email": email.trim(),
      "password": password,
      "device": await collectDevice(prefs),
    });
    await _accept(result, result["token"] as String?);
  }

  Future<void> signup(String name, String email, String password, String referral) async {
    if (AppConfig.useFirebase && !config.demoMode) {
      await _ensureFirebase();
      final credential = await FirebaseAuth.instance.createUserWithEmailAndPassword(email: email.trim(), password: password);
      await credential.user?.updateDisplayName(name.trim());
      final idToken = await credential.user?.getIdToken();
      if (idToken == null) throw ApiException("AUTH", "Firebase did not return a session.");
      final result = await api.post("/v1/auth/firebase", {
        "idToken": idToken,
        "device": await collectDevice(prefs),
        "referralCode": referral.trim(),
      });
      await _accept(result, idToken);
      return;
    }
    final result = await api.post("/v1/auth/signup", {
      "displayName": name.trim(),
      "email": email.trim(),
      "password": password,
      "referralCode": referral.trim(),
      "device": await collectDevice(prefs),
    });
    await _accept(result, result["token"] as String?);
  }

  Future<void> google() async {
    if (!AppConfig.useFirebase || config.demoMode) {
      final result = await api.post("/v1/auth/google-demo", {"device": await collectDevice(prefs)});
      await _accept(result, result["token"] as String?);
      return;
    }
    await _ensureFirebase();
    if (!_googleReady) {
      await GoogleSignIn.instance.initialize(
        serverClientId: AppConfig.googleServerClientId.isEmpty ? null : AppConfig.googleServerClientId,
      );
      _googleReady = true;
    }
    final account = await GoogleSignIn.instance.authenticate();
    final idToken = account.authentication.idToken;
    if (idToken == null) {
      throw ApiException("GOOGLE", "Google did not return an ID token. Set GOOGLE_SERVER_CLIENT_ID and the SHA-1 in Firebase.");
    }
    final credential = GoogleAuthProvider.credential(idToken: idToken);
    final signedIn = await FirebaseAuth.instance.signInWithCredential(credential);
    final firebaseToken = await signedIn.user?.getIdToken();
    if (firebaseToken == null) throw ApiException("GOOGLE", "Firebase did not return a session.");
    final result = await api.post("/v1/auth/firebase", {
      "idToken": firebaseToken,
      "device": await collectDevice(prefs),
    });
    await _accept(result, firebaseToken);
  }

  Future<String?> forgot(String email) async {
    if (AppConfig.useFirebase && !config.demoMode) {
      await _ensureFirebase();
      await FirebaseAuth.instance.sendPasswordResetEmail(email: email.trim());
      return null;
    }
    final result = await api.post("/v1/auth/forgot", {"email": email.trim()});
    return result["resetToken"] as String?;
  }

  Future<void> resetPassword(String token, String password) async {
    await api.post("/v1/auth/reset", {"token": token, "password": password});
  }

  Future<Map<String, dynamic>> prepareAd() async {
    return api.post("/v1/ads/prepare");
  }

  Future<void> completeDemoAd(String sessionId) async {
    await api.post("/v1/ads/demo-complete", {"sessionId": sessionId});
    await refresh();
  }

  Future<void> checkIn() async {
    await api.post("/v1/check-in");
    await refresh();
  }

  Future<void> requestCashOut(Map<String, dynamic> body) async {
    await api.post("/v1/withdrawals", body);
    await refresh();
  }

  Future<void> updateName(String name) async {
    await api.patch("/v1/me", {"displayName": name});
    await refresh();
  }

  Future<void> deleteAccount() async {
    await api.delete("/v1/me");
    await logout(silent: true);
    notifyListeners();
  }

  Future<void> markAllRead() async {
    for (final note in notifications.where((item) => !item.read)) {
      await api.post("/v1/notifications/${note.id}/read");
    }
    await refresh();
  }

  Future<void> logout({bool silent = false}) async {
    await prefs.remove("token");
    api.token = null;
    user = null;
    wallet = null;
    ledger = [];
    withdrawals = [];
    notifications = [];
    unread = 0;
    if (!silent) notifyListeners();
  }

  Future<void> _accept(Map<String, dynamic> result, String? token) async {
    if (token != null) {
      api.token = token;
      await prefs.setString("token", token);
    }
    user = Member.fromJson(result["user"] as Map<String, dynamic>);
    wallet = Wallet.fromJson(result["wallet"] as Map<String, dynamic>);
    notifyListeners();
    await refresh();
  }

  Future<void> _ensureFirebase() async {
    if (_firebaseReady) return;
    await Firebase.initializeApp(options: DefaultFirebaseOptions.android);
    _firebaseReady = true;
  }
}

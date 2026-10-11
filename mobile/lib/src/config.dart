/// Official Google test IDs. Replace both before a Play production release.
/// Shipping test IDs in a live app can get the AdMob account limited.
class AdUnits {
  static const testAppId = "ca-app-pub-3940256099942544~3347511713";
  static const testRewarded = "ca-app-pub-3940256099942544/5224354917";

  /// Override at build time: --dart-define=ADMOB_REWARDED_UNIT_ID=ca-app-pub-xxx/yyy
  /// Also replace the APPLICATION_ID meta-data in AndroidManifest.xml.
  static const rewarded = String.fromEnvironment(
    "ADMOB_REWARDED_UNIT_ID",
    defaultValue: testRewarded,
  );
}

class AppConfig {
  /// Emulator reaches the host machine at 10.0.2.2. Change it on the sign-in screen for a phone.
  static const apiBase = String.fromEnvironment(
    "API_BASE",
    defaultValue: "http://10.0.2.2:8787",
  );

  /// Turn on only after Firebase options and a real google-services.json are in place.
  static const useFirebase = bool.fromEnvironment("USE_FIREBASE", defaultValue: false);

  /// Web client ID from Firebase / Google Cloud. Required for Google sign-in ID tokens.
  static const googleServerClientId = String.fromEnvironment(
    "GOOGLE_SERVER_CLIENT_ID",
    defaultValue: "",
  );
}

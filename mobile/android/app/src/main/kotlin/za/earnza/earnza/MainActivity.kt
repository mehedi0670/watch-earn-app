package za.earnza.earnza

import android.provider.Settings
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "earnza/device").setMethodCallHandler { call, result ->
            if (call.method == "androidId") {
                val androidId = Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID)
                result.success(androidId)
            } else {
                result.notImplemented()
            }
        }
    }
}

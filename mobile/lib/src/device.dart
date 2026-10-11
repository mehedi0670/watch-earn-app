import "package:device_info_plus/device_info_plus.dart";
import "package:flutter/services.dart";
import "package:safe_device/safe_device.dart";
import "package:shared_preferences/shared_preferences.dart";

const _channel = MethodChannel("earnza/device");

Future<Map<String, dynamic>> collectDevice(SharedPreferences prefs) async {
  var deviceId = prefs.getString("deviceId");
  var emulator = false;
  var rooted = false;
  var model = "Android";
  try {
    final androidId = await _channel.invokeMethod<String>("androidId");
    if (androidId != null && androidId.length >= 8) deviceId = androidId;
    final info = await DeviceInfoPlugin().androidInfo;
    emulator = !info.isPhysicalDevice ||
        info.fingerprint.contains("generic") ||
        info.model.contains("Emulator") ||
        info.model.contains("sdk_gphone") ||
        info.product.contains("sdk") ||
        info.hardware.contains("goldfish") ||
        info.hardware.contains("ranchu");
    model = "${info.manufacturer} ${info.model}".trim();
  } catch (_) {}
  try {
    rooted = await SafeDevice.isJailBroken;
  } catch (_) {}
  deviceId ??= "earnza-${DateTime.now().microsecondsSinceEpoch}";
  await prefs.setString("deviceId", deviceId);
  return {
    "deviceId": deviceId,
    "isEmulator": emulator,
    "isRooted": rooted,
    "model": model,
    "platform": "android",
  };
}

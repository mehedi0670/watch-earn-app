import "dart:async";
import "dart:convert";

import "package:http/http.dart" as http;

class ApiException implements Exception {
  ApiException(this.code, this.message);
  final String code;
  final String message;
  @override
  String toString() => message;
}

class EarnApi {
  EarnApi(this.base);
  String base;
  String? token;

  Future<Map<String, dynamic>> get(String path) => send("GET", path);
  Future<Map<String, dynamic>> post(String path, [Map<String, dynamic>? body]) => send("POST", path, body);
  Future<Map<String, dynamic>> patch(String path, Map<String, dynamic> body) => send("PATCH", path, body);
  Future<Map<String, dynamic>> put(String path, Map<String, dynamic> body) => send("PUT", path, body);
  Future<Map<String, dynamic>> delete(String path) => send("DELETE", path);

  Future<Map<String, dynamic>> send(String method, String path, [Map<String, dynamic>? body]) async {
    final uri = Uri.parse("$base$path");
    final request = http.Request(method, uri);
    request.headers["content-type"] = "application/json";
    if (token != null) request.headers["authorization"] = "Bearer $token";
    if (body != null) request.body = jsonEncode(body);
    late http.Response response;
    try {
      final streamed = await request.send().timeout(const Duration(seconds: 25));
      response = await http.Response.fromStream(streamed);
    } on TimeoutException {
      throw ApiException("NETWORK", "The server took too long to respond.");
    } catch (_) {
      throw ApiException("NETWORK", "Cannot reach the EarnZA server at $base.");
    }
    Map<String, dynamic> payload = {};
    if (response.body.isNotEmpty) {
      final decoded = jsonDecode(response.body);
      if (decoded is Map<String, dynamic>) payload = decoded;
    }
    if (response.statusCode >= 400) {
      final error = payload["error"];
      if (error is Map) {
        throw ApiException("${error["code"] ?? "HTTP"}", "${error["message"] ?? "Request failed."}");
      }
      throw ApiException("HTTP", "Request failed (${response.statusCode}).");
    }
    return payload;
  }
}

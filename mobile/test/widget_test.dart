import "package:earnza/src/format.dart";
import "package:flutter_test/flutter_test.dart";

void main() {
  test("formats Rand and points the way the wallet shows them", () {
    expect(formatZar(80.2), "R80.20");
    expect(formatZar(1234.5), "R1,234.50");
    expect(formatPoints(8020), "8,020");
  });
}

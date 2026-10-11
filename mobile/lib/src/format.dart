String formatZar(num value) {
  final negative = value < 0;
  final fixed = value.abs().toStringAsFixed(2);
  final parts = fixed.split(".");
  final whole = parts[0].replaceAllMapped(RegExp(r"\B(?=(\d{3})+(?!\d))"), (match) => ",");
  return "${negative ? "-" : ""}R$whole.${parts[1]}";
}

String formatPoints(num value) {
  final whole = value.round().abs().toString().replaceAllMapped(RegExp(r"\B(?=(\d{3})+(?!\d))"), (match) => ",");
  return value < 0 ? "-$whole" : whole;
}

String watchHint({
  required String? reason,
  required int pointsPerAd,
  required int dailyAdCap,
  required int seconds,
}) {
  switch (reason) {
    case "blocked":
      return "This account is blocked. You can still read your history.";
    case "emulator":
      return "Rewards are turned off on emulators.";
    case "rooted":
      return "Rewards are turned off on rooted phones.";
    case "suspicious":
      return "This account is under review.";
    case "cap":
      return "You have used today's $dailyAdCap ads.";
    case "cooldown":
      return "Next ad in ${seconds}s.";
    default:
      return "Watch a short ad. The server adds $pointsPerAd points only after it verifies the view.";
  }
}

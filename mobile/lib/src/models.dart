int asInt(dynamic value) => value is int ? value : (value as num?)?.toInt() ?? 0;
double asDouble(dynamic value) => value is num ? value.toDouble() : 0;

class PublicConfig {
  PublicConfig({
    required this.demoMode,
    required this.pointsPerAd,
    required this.minPayoutPoints,
    required this.minPayoutZar,
    required this.dailyAdCap,
    required this.cooldownSeconds,
  });

  final bool demoMode;
  final int pointsPerAd;
  final int minPayoutPoints;
  final double minPayoutZar;
  final int dailyAdCap;
  final int cooldownSeconds;

  factory PublicConfig.fromJson(Map<String, dynamic> json) {
    return PublicConfig(
      demoMode: json["demoMode"] == true,
      pointsPerAd: asInt(json["pointsPerAd"]),
      minPayoutPoints: asInt(json["minPayoutPoints"]),
      minPayoutZar: asDouble(json["minPayoutZar"]),
      dailyAdCap: asInt(json["dailyAdCap"]),
      cooldownSeconds: asInt(json["cooldownSeconds"]),
    );
  }

  static PublicConfig empty() => PublicConfig(
        demoMode: true,
        pointsPerAd: 5,
        minPayoutPoints: 5000,
        minPayoutZar: 50,
        dailyAdCap: 30,
        cooldownSeconds: 60,
      );
}

class Member {
  Member({
    required this.id,
    required this.email,
    required this.displayName,
    required this.role,
    required this.points,
    required this.adsWatched,
    required this.blocked,
    required this.blockReason,
    required this.referralCode,
    required this.referralCount,
    required this.isEmulator,
    required this.isRooted,
    required this.deviceModel,
    required this.pendingWithdrawalId,
  });

  final String id;
  final String email;
  final String displayName;
  final String role;
  final int points;
  final int adsWatched;
  final bool blocked;
  final String? blockReason;
  final String referralCode;
  final int referralCount;
  final bool isEmulator;
  final bool isRooted;
  final String deviceModel;
  final String? pendingWithdrawalId;

  factory Member.fromJson(Map<String, dynamic> json) {
    return Member(
      id: json["id"] as String,
      email: json["email"] as String? ?? "",
      displayName: json["displayName"] as String? ?? "",
      role: json["role"] as String? ?? "user",
      points: asInt(json["points"]),
      adsWatched: asInt(json["adsWatched"]),
      blocked: json["blocked"] == true,
      blockReason: json["blockReason"] as String?,
      referralCode: json["referralCode"] as String? ?? "",
      referralCount: asInt(json["referralCount"]),
      isEmulator: json["isEmulator"] == true,
      isRooted: json["isRooted"] == true,
      deviceModel: json["deviceModel"] as String? ?? "",
      pendingWithdrawalId: json["pendingWithdrawalId"] as String?,
    );
  }
}

class Wallet {
  Wallet({
    required this.points,
    required this.zar,
    required this.pointsPerZar,
    required this.pointsPerAd,
    required this.adsToday,
    required this.dailyAdCap,
    required this.cooldownSeconds,
    required this.secondsUntilNextAd,
    required this.canWatch,
    required this.watchBlockReason,
    required this.canCheckIn,
    required this.minPayoutPoints,
    required this.minPayoutZar,
    required this.checkInBonusPoints,
    required this.referralBonusPoints,
    required this.pendingWithdrawalId,
  });

  final int points;
  final double zar;
  final int pointsPerZar;
  final int pointsPerAd;
  final int adsToday;
  final int dailyAdCap;
  final int cooldownSeconds;
  final int secondsUntilNextAd;
  final bool canWatch;
  final String? watchBlockReason;
  final bool canCheckIn;
  final int minPayoutPoints;
  final double minPayoutZar;
  final int checkInBonusPoints;
  final int referralBonusPoints;
  final String? pendingWithdrawalId;

  factory Wallet.fromJson(Map<String, dynamic> json) {
    return Wallet(
      points: asInt(json["points"]),
      zar: asDouble(json["zar"]),
      pointsPerZar: asInt(json["pointsPerZar"]),
      pointsPerAd: asInt(json["pointsPerAd"]),
      adsToday: asInt(json["adsToday"]),
      dailyAdCap: asInt(json["dailyAdCap"]),
      cooldownSeconds: asInt(json["cooldownSeconds"]),
      secondsUntilNextAd: asInt(json["secondsUntilNextAd"]),
      canWatch: json["canWatch"] == true,
      watchBlockReason: json["watchBlockReason"] as String?,
      canCheckIn: json["canCheckIn"] == true,
      minPayoutPoints: asInt(json["minPayoutPoints"]),
      minPayoutZar: asDouble(json["minPayoutZar"]),
      checkInBonusPoints: asInt(json["checkInBonusPoints"]),
      referralBonusPoints: asInt(json["referralBonusPoints"]),
      pendingWithdrawalId: json["pendingWithdrawalId"] as String?,
    );
  }
}

class LedgerItem {
  LedgerItem({required this.id, required this.type, required this.points, required this.note, required this.createdAt, required this.balanceAfter});
  final String id;
  final String type;
  final int points;
  final String note;
  final String createdAt;
  final int balanceAfter;

  factory LedgerItem.fromJson(Map<String, dynamic> json) => LedgerItem(
        id: json["id"] as String,
        type: json["type"] as String? ?? "",
        points: asInt(json["points"]),
        note: json["note"] as String? ?? "",
        createdAt: json["createdAt"] as String? ?? "",
        balanceAfter: asInt(json["balanceAfter"]),
      );
}

class CashOut {
  CashOut({
    required this.id,
    required this.points,
    required this.zarAmount,
    required this.method,
    required this.status,
    required this.phone,
    required this.bankName,
    required this.accountNumber,
    required this.voucherPin,
    required this.paymentReference,
    required this.rejectionReason,
    required this.createdAt,
  });

  final String id;
  final int points;
  final double zarAmount;
  final String method;
  final String status;
  final String? phone;
  final String? bankName;
  final String? accountNumber;
  final String? voucherPin;
  final String? paymentReference;
  final String? rejectionReason;
  final String createdAt;

  factory CashOut.fromJson(Map<String, dynamic> json) => CashOut(
        id: json["id"] as String,
        points: asInt(json["points"]),
        zarAmount: asDouble(json["zarAmount"]),
        method: json["method"] as String? ?? "",
        status: json["status"] as String? ?? "",
        phone: json["phone"] as String?,
        bankName: json["bankName"] as String?,
        accountNumber: json["accountNumber"] as String?,
        voucherPin: json["voucherPin"] as String?,
        paymentReference: json["paymentReference"] as String?,
        rejectionReason: json["rejectionReason"] as String?,
        createdAt: json["createdAt"] as String? ?? "",
      );
}

class Notice {
  Notice({required this.id, required this.title, required this.body, required this.kind, required this.createdAt, required this.read});
  final String id;
  final String title;
  final String body;
  final String kind;
  final String createdAt;
  final bool read;

  factory Notice.fromJson(Map<String, dynamic> json) => Notice(
        id: json["id"] as String,
        title: json["title"] as String? ?? "",
        body: json["body"] as String? ?? "",
        kind: json["kind"] as String? ?? "system",
        createdAt: json["createdAt"] as String? ?? "",
        read: json["read"] == true,
      );
}

export type Role = "user" | "admin";

export type Settings = {
  pointsPerZar: number;
  pointsPerAd: number;
  dailyAdCap: number;
  cooldownSeconds: number;
  minPayoutPoints: number;
  checkInBonusPoints: number;
  referralBonusPoints: number;
  estimatedEcpmZar: number;
  blockEmulators: boolean;
  blockRooted: boolean;
  blockSuspicious: boolean;
  payoutsRequireRevenueCover: boolean;
  maxSignupsPerIpPerDay: number;
  updatedAt: string | null;
};

export type User = {
  id: string;
  email: string;
  passwordHash: string | null;
  displayName: string;
  role: Role;
  points: number;
  lifetimePointsEarned: number;
  adsWatched: number;
  createdAt: string;
  blocked: boolean;
  blockReason: string | null;
  suspicious: boolean;
  suspiciousReasons: string[];
  deviceId: string | null;
  isEmulator: boolean;
  isRooted: boolean;
  deviceModel: string;
  referralCode: string;
  referredBy: string | null;
  referralCredited: boolean;
  referralCount: number;
  lastAdAt: string | null;
  adsToday: number;
  adsTodayDate: string | null;
  lastCheckInDate: string | null;
  pendingWithdrawalId: string | null;
  pendingAdSessionId: string | null;
  signupIp: string | null;
  deleted: boolean;
  provider: "password" | "google" | "firebase";
};

export type Stats = {
  totalUsers: number;
  signupsToday: number;
  signupsTodayDate: string;
  totalAds: number;
  adsToday: number;
  adsTodayDate: string;
  outstandingPoints: number;
  pendingWithdrawalPoints: number;
  paidOutPoints: number;
  estimatedRevenueZar: number;
  totalPointsIssued: number;
};

export type AdSession = {
  id: string;
  uid: string;
  createdAt: string;
  expiresAt: string;
  status: "pending" | "credited" | "rejected";
  transactionId: string | null;
};

export type LedgerType =
  | "ad_reward"
  | "check_in"
  | "referral"
  | "adjustment"
  | "withdrawal"
  | "withdrawal_refund"
  | "account_deleted";

export type LedgerEntry = {
  id: string;
  uid: string;
  type: LedgerType;
  points: number;
  balanceAfter: number;
  createdAt: string;
  note: string;
  meta: Record<string, string | number | boolean | null>;
};

export type WithdrawalStatus = "PENDING" | "APPROVED" | "REJECTED" | "PAID";
export type PayoutMethod = "1voucher" | "bank";
export type AccountType = "cheque" | "savings" | "transmission";

export type Withdrawal = {
  id: string;
  uid: string;
  userEmail: string;
  displayName: string;
  points: number;
  zarAmount: number;
  method: PayoutMethod;
  status: WithdrawalStatus;
  phone: string | null;
  accountHolder: string | null;
  bankName: string | null;
  accountNumber: string | null;
  branchCode: string | null;
  accountType: AccountType | null;
  voucherPin: string | null;
  paymentReference: string | null;
  adminNote: string | null;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
  reviewedBy: string | null;
  paidAt: string | null;
};

export type AppNotification = {
  id: string;
  uid: string;
  title: string;
  body: string;
  kind: "payout" | "earning" | "system";
  createdAt: string;
  read: boolean;
};

export type ResetToken = {
  tokenHash: string;
  uid: string;
  expiresAt: string;
  used: boolean;
};

export type RateRow = { count: number; resetAt: number };

export type DeviceInput = {
  deviceId: string;
  isEmulator: boolean;
  isRooted: boolean;
  model: string;
  platform: string;
};

export type VerifierKey = {
  keyId: number | string;
  pem?: string;
  base64?: string;
};

export const SA_BANKS = [
  "ABSA",
  "African Bank",
  "Capitec",
  "Discovery Bank",
  "FNB",
  "Investec",
  "Nedbank",
  "Standard Bank",
  "TymeBank",
  "Other",
] as const;

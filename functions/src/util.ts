import crypto from "crypto";
import type { Settings, Stats, User } from "./types";

export const ZA_TZ = "Africa/Johannesburg";

export const DEFAULT_SETTINGS: Settings = {
  pointsPerZar: 100,
  pointsPerAd: 5,
  dailyAdCap: 30,
  cooldownSeconds: 60,
  minPayoutPoints: 5000,
  checkInBonusPoints: 10,
  referralBonusPoints: 100,
  estimatedEcpmZar: 0.2,
  blockEmulators: true,
  blockRooted: true,
  blockSuspicious: false,
  payoutsRequireRevenueCover: true,
  maxSignupsPerIpPerDay: 3,
  updatedAt: null,
};

export function emptyStats(date = zaDate()): Stats {
  return {
    totalUsers: 0,
    signupsToday: 0,
    signupsTodayDate: date,
    totalAds: 0,
    adsToday: 0,
    adsTodayDate: date,
    outstandingPoints: 0,
    pendingWithdrawalPoints: 0,
    paidOutPoints: 0,
    estimatedRevenueZar: 0,
    totalPointsIssued: 0,
  };
}

export function zaDate(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ZA_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function pointsToZar(points: number, pointsPerZar: number): number {
  if (pointsPerZar <= 0) return 0;
  return round2(points / pointsPerZar);
}

export function zarCents(points: number, pointsPerZar: number): number {
  if (pointsPerZar <= 0) return 0;
  return Math.round((points * 100) / pointsPerZar);
}

export function id(prefix = ""): string {
  const raw = crypto.randomBytes(12).toString("base64url");
  return prefix ? `${prefix}_${raw}` : raw;
}

export function referralCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(8);
  let out = "";
  for (let i = 0; i < 8; i++) out += alphabet[bytes[i]! % alphabet.length];
  return out;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("base64url");
  const hash = crypto.scryptSync(password, salt, 32).toString("base64url");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string | null): boolean {
  if (!stored) return false;
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const actual = crypto.scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, "base64url");
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export type JwtClaims = { uid: string; role: "user" | "admin"; exp: number };

export function signJwt(claims: Omit<JwtClaims, "exp">, secret: string, ttlSeconds: number): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(
    JSON.stringify({ ...claims, exp: Math.floor(Date.now() / 1000) + ttlSeconds }),
  ).toString("base64url");
  const data = `${header}.${body}`;
  const sig = crypto.createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${sig}`;
}

export function verifyJwt(token: string, secret: string): JwtClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const data = `${header}.${body}`;
  const expected = crypto.createHmac("sha256", secret).update(data).digest("base64url");
  const a = Buffer.from(sig!);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body!, "base64url").toString("utf8")) as JwtClaims;
    if (!claims.uid || !claims.exp || claims.exp < Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
}

export function rollDayCount(dateField: string | null, count: number, today: string): number {
  return dateField === today ? count : 0;
}

export function freshUser(partial: Pick<User, "id" | "email" | "displayName" | "passwordHash" | "role" | "provider" | "referralCode"> & Partial<User>): User {
  return {
    points: 0,
    lifetimePointsEarned: 0,
    adsWatched: 0,
    createdAt: nowIso(),
    blocked: false,
    blockReason: null,
    suspicious: false,
    suspiciousReasons: [],
    deviceId: null,
    isEmulator: false,
    isRooted: false,
    deviceModel: "",
    referredBy: null,
    referralCredited: false,
    referralCount: 0,
    lastAdAt: null,
    adsToday: 0,
    adsTodayDate: null,
    lastCheckInDate: null,
    pendingWithdrawalId: null,
    pendingAdSessionId: null,
    signupIp: null,
    deleted: false,
    ...partial,
  };
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function assertEmail(email: string): string {
  const value = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || value.length > 120) {
    throw new ApiError(400, "EMAIL", "Enter a valid email address.");
  }
  return value;
}

export function assertPassword(password: string): void {
  if (typeof password !== "string" || password.length < 8 || password.length > 72) {
    throw new ApiError(400, "PASSWORD", "Password must be 8 to 72 characters.");
  }
}

export function assertName(name: string): string {
  const value = name.trim().replace(/\s+/g, " ");
  if (value.length < 2 || value.length > 60 || !/^[\p{L}\p{M}][\p{L}\p{M} '\-.]*$/u.test(value)) {
    throw new ApiError(400, "NAME", "Enter your name using letters, spaces, apostrophes or hyphens.");
  }
  return value;
}

export function assertDevice(input: unknown): import("./types").DeviceInput {
  const body = (input ?? {}) as Record<string, unknown>;
  const deviceId = String(body.deviceId ?? "").trim();
  if (!/^[A-Za-z0-9:_-]{8,128}$/.test(deviceId)) {
    throw new ApiError(400, "DEVICE", "This device could not be identified.");
  }
  return {
    deviceId,
    isEmulator: Boolean(body.isEmulator),
    isRooted: Boolean(body.isRooted),
    model: String(body.model ?? "").slice(0, 80),
    platform: String(body.platform ?? "android").slice(0, 20),
  };
}

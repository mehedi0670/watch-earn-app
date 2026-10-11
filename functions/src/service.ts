import crypto from "crypto";
import type { Repo, Tx } from "./repo";
import type {
  AccountType,
  AppNotification,
  DeviceInput,
  LedgerEntry,
  PayoutMethod,
  Settings,
  User,
  VerifierKey,
  Withdrawal,
} from "./types";
import {
  ApiError,
  assertEmail,
  assertName,
  assertPassword,
  freshUser,
  hashPassword,
  id,
  nowIso,
  pointsToZar,
  referralCode,
  rollDayCount,
  sha256,
  verifyPassword,
  zaDate,
  zarCents,
} from "./util";
import { verifyAdmobQuery } from "./ssv";

const SESSION_MS = 15 * 60 * 1000;

export type ServiceOptions = {
  demoMode: boolean;
  adminEmails: string[];
};

function consumeRate(
  row: { count: number; resetAt: number } | null,
  limit: number,
  windowMs: number,
  now = Date.now(),
): { allowed: boolean; next: { count: number; resetAt: number } } {
  if (!row || row.resetAt <= now) return { allowed: true, next: { count: 1, resetAt: now + windowMs } };
  if (row.count >= limit) return { allowed: false, next: row };
  return { allowed: true, next: { count: row.count + 1, resetAt: row.resetAt } };
}

function bumpToday(statsDate: string, count: number, today: string): { date: string; count: number } {
  if (statsDate !== today) return { date: today, count: 1 };
  return { date: today, count: count + 1 };
}

type TakenDevice = { takenDeviceOwner: string };

type CreditResult = {
  duplicate: boolean;
  points: number;
  balance?: number;
  blocked?: boolean;
  reason?: string;
  mismatch?: boolean;
};

/** Clear-cut watch rates block. High but still possible rates are only flagged. */
export function judgeAdPace(
  user: Pick<User, "lastAdAt" | "recentAdAt">,
  settings: Pick<Settings, "minSecondsBetweenAds" | "flagAdsPerHour" | "blockAdsPerHour">,
  nowMs: number,
): { block: string | null; flag: string | null } {
  if (user.lastAdAt) {
    const elapsed = (nowMs - new Date(user.lastAdAt).getTime()) / 1000;
    if (elapsed >= 0 && elapsed < settings.minSecondsBetweenAds) {
      return {
        block: `Verified ads arrived ${Math.max(0, Math.floor(elapsed))}s apart, under the ${settings.minSecondsBetweenAds}s minimum a person needs to watch one.`,
        flag: null,
      };
    }
  }
  const hourAgo = nowMs - 60 * 60 * 1000;
  const recent = (user.recentAdAt ?? []).filter((stamp) => new Date(stamp).getTime() > hourAgo);
  const count = recent.length + 1;
  if (count > settings.blockAdsPerHour) {
    return {
      block: `${count} verified ads in an hour is past the ${settings.blockAdsPerHour} limit of a real viewing session.`,
      flag: null,
    };
  }
  if (count > settings.flagAdsPerHour) {
    return { block: null, flag: `${count} verified ads in an hour is high enough to review.` };
  }
  return { block: null, flag: null };
}

export class EarnService {
  /** Tests move this forward so rate checks do not have to sleep. */
  nowMs: () => number = () => Date.now();

  constructor(
    private repo: Repo,
    private opts: ServiceOptions,
  ) {}

  private async gate(tx: Tx, key: string, limit: number, windowMs: number): Promise<void> {
    const current = await tx.getRate(key);
    const result = consumeRate(current, limit, windowMs);
    if (!result.allowed) throw new ApiError(429, "RATE_LIMIT", "Too many attempts. Please wait and try again.");
    await tx.saveRate(key, result.next);
  }

  async signup(input: {
    email: string;
    password: string;
    displayName: string;
    device: DeviceInput | null;
    referralCode?: string;
    ip: string;
    role?: "user" | "admin";
    provider?: User["provider"];
  }): Promise<User> {
    const email = assertEmail(input.email);
    assertPassword(input.password);
    const displayName = assertName(input.displayName);
    const role = input.role ?? "user";
    const code = (input.referralCode ?? "").trim().toUpperCase();
    const ipKey = `${input.ip}|${zaDate()}`;

    const outcome = await this.repo.transaction(async (tx): Promise<User | TakenDevice> => {
      const settings = await tx.getSettings();
      const existing = await tx.getEmailOwner(email);
      const refOwner = code ? await tx.getReferralOwner(code) : null;
      const deviceOwner = input.device ? await tx.getDeviceOwner(input.device.deviceId) : null;
      const ipCount = await tx.getIpCount(ipKey);
      const stats = await tx.getStats();
      const rate = await tx.getRate(`signup:${input.ip}`);
      const rateResult = consumeRate(rate, 10, 60 * 60 * 1000, this.nowMs());
      if (existing) throw new ApiError(409, "EMAIL_TAKEN", "An account with that email already exists.");
      if (code && !refOwner) throw new ApiError(400, "REFERRAL", "That referral code was not found.");
      if (input.device && deviceOwner) return { takenDeviceOwner: deviceOwner };
      if (!rateResult.allowed) throw new ApiError(429, "RATE_LIMIT", "Too many signups from this network. Try again later.");
      if (role === "user" && ipCount >= settings.maxSignupsPerIpPerDay) {
        throw new ApiError(429, "IP_LIMIT", "Too many accounts have been created from this network today.");
      }

      let ownCode = referralCode();
      for (let i = 0; i < 5 && (await tx.getReferralOwner(ownCode)); i++) ownCode = referralCode();

      const user = freshUser({
        id: id("usr"),
        email,
        displayName,
        passwordHash: hashPassword(input.password),
        role,
        provider: input.provider ?? "password",
        referralCode: ownCode,
        referredBy: refOwner,
        signupIp: input.ip,
      });
      this.applyDevice(user, input.device);
      const blockReason = this.applyDeviceFraud(user, settings, null);
      if (role === "user" && ipCount + 1 >= settings.flagSignupsPerIp) {
        this.addFlag(user, "Several accounts were created from this network today.");
      }

      const today = zaDate();
      if (role === "user") {
        if (stats.signupsTodayDate !== today) {
          stats.signupsToday = 0;
          stats.signupsTodayDate = today;
        }
        stats.totalUsers += 1;
        stats.signupsToday += 1;
      }

      await tx.saveRate(`signup:${input.ip}`, rateResult.next);
      await tx.saveIpCount(ipKey, ipCount + 1);
      await tx.saveUser(user);
      await tx.saveEmailOwner(email, user.id);
      await tx.saveReferralOwner(ownCode, user.id);
      if (input.device) await tx.saveDeviceOwner(input.device.deviceId, user.id);
      await tx.saveStats(stats);
      await tx.addNotification(this.notice(user.id, "system", "Welcome to EarnZA", "Watch a rewarded ad to earn points. Cash outs stay pending until they are paid manually."));
      if (blockReason) await tx.addNotification(this.notice(user.id, "system", "Account blocked", blockReason));
      return user;
    });
    return this.finishDeviceConflict(outcome);
  }

  async login(input: { email: string; password: string; device: DeviceInput; ip: string }): Promise<User> {
    const email = assertEmail(input.email);
    const user = await this.repo.getUserByEmail(email);
    const passwordOk = verifyPassword(input.password, user?.passwordHash ?? null);
    if (!user || user.deleted || !passwordOk) {
      await this.repo.transaction(async (tx) => {
        await this.gate(tx, `login:${input.ip}`, 20, 10 * 60 * 1000);
      });
      throw new ApiError(401, "LOGIN", "Email or password is incorrect.");
    }
    const outcome = await this.repo.transaction(async (tx): Promise<User | TakenDevice> => {
      const fresh = await this.requireUser(tx, user.id);
      const owner = await tx.getDeviceOwner(input.device.deviceId);
      const settings = await tx.getSettings();
      const withdrawal = fresh.pendingWithdrawalId ? await tx.getWithdrawal(fresh.pendingWithdrawalId) : null;
      const rate = await tx.getRate(`login:${input.ip}`);
      const decision = consumeRate(rate, 20, 10 * 60 * 1000, this.nowMs());
      if (!decision.allowed) throw new ApiError(429, "RATE_LIMIT", "Too many attempts. Please wait and try again.");
      if (owner && owner !== fresh.id) return { takenDeviceOwner: owner };
      let releaseDevice: string | null = null;
      if (fresh.deviceId && fresh.deviceId !== input.device.deviceId) {
        if (!this.opts.demoMode) throw new ApiError(409, "DEVICE_MISMATCH", "This account is linked to another device.");
        releaseDevice = fresh.deviceId;
      }
      await tx.saveRate(`login:${input.ip}`, decision.next);
      if (releaseDevice) await tx.deleteDevice(releaseDevice);
      if (!owner) await tx.saveDeviceOwner(input.device.deviceId, fresh.id);
      this.applyDevice(fresh, input.device);
      const blockReason = this.applyDeviceFraud(fresh, settings, withdrawal);
      await tx.saveUser(fresh);
      if (blockReason && withdrawal) await tx.saveWithdrawal(withdrawal);
      if (blockReason) await tx.addNotification(this.notice(fresh.id, "system", "Account blocked", blockReason));
      return fresh;
    });
    return this.finishDeviceConflict(outcome);
  }

  async googleDemo(input: { device: DeviceInput; ip: string }): Promise<User> {
    if (!this.opts.demoMode) throw new ApiError(404, "NOT_FOUND", "Google demo sign-in is only available in demo mode.");
    const email = "demo.google@earnza.local";
    const existing = await this.repo.getUserByEmail(email);
    if (!existing) {
      return this.signup({
        email,
        password: `demo-${crypto.randomBytes(12).toString("hex")}`,
        displayName: "Google Demo",
        device: input.device,
        ip: input.ip,
        provider: "google",
      });
    }
    const outcome = await this.repo.transaction(async (tx): Promise<User | TakenDevice> => {
      const fresh = await tx.getUser(existing.id);
      if (!fresh || fresh.deleted) throw new ApiError(401, "LOGIN", "This Google demo account is closed.");
      const settings = await tx.getSettings();
      const withdrawal = fresh.pendingWithdrawalId ? await tx.getWithdrawal(fresh.pendingWithdrawalId) : null;
      const taken = await this.bindExistingDevice(tx, fresh, input.device);
      if (taken) return { takenDeviceOwner: taken };
      const blockReason = this.applyDeviceFraud(fresh, settings, withdrawal);
      fresh.provider = "google";
      await tx.saveUser(fresh);
      if (blockReason && withdrawal) await tx.saveWithdrawal(withdrawal);
      if (blockReason) await tx.addNotification(this.notice(fresh.id, "system", "Account blocked", blockReason));
      return fresh;
    });
    return this.finishDeviceConflict(outcome);
  }

  async upsertFirebaseUser(input: {
    uid: string;
    email: string;
    displayName: string;
    provider: User["provider"];
    device: DeviceInput;
    referralCode?: string;
    ip: string;
  }): Promise<User> {
    const email = assertEmail(input.email);
    const existingById = await this.repo.getUserById(input.uid);
    if (existingById && !existingById.deleted) {
      const outcome = await this.repo.transaction(async (tx): Promise<User | TakenDevice> => {
        const fresh = await tx.getUser(input.uid);
        if (!fresh) throw new ApiError(401, "LOGIN", "Account not found.");
        const settings = await tx.getSettings();
        const withdrawal = fresh.pendingWithdrawalId ? await tx.getWithdrawal(fresh.pendingWithdrawalId) : null;
        const taken = await this.bindExistingDevice(tx, fresh, input.device);
        if (taken) return { takenDeviceOwner: taken };
        const blockReason = this.applyDeviceFraud(fresh, settings, withdrawal);
        await tx.saveUser(fresh);
        if (blockReason && withdrawal) await tx.saveWithdrawal(withdrawal);
        if (blockReason) await tx.addNotification(this.notice(fresh.id, "system", "Account blocked", blockReason));
        return fresh;
      });
      return this.finishDeviceConflict(outcome);
    }
    const displayName = input.displayName?.trim() ? assertName(input.displayName) : "EarnZA member";
    const code = (input.referralCode ?? "").trim().toUpperCase();
    const ipKey = `${input.ip}|${zaDate()}`;
    const outcome = await this.repo.transaction(async (tx): Promise<User | TakenDevice> => {
      const settings = await tx.getSettings();
      const emailOwner = await tx.getEmailOwner(email);
      const refOwner = code ? await tx.getReferralOwner(code) : null;
      const deviceOwner = await tx.getDeviceOwner(input.device.deviceId);
      const ipCount = await tx.getIpCount(ipKey);
      const stats = await tx.getStats();
      if (emailOwner) throw new ApiError(409, "EMAIL_TAKEN", "An account with that email already exists.");
      if (code && !refOwner) throw new ApiError(400, "REFERRAL", "That referral code was not found.");
      if (deviceOwner) return { takenDeviceOwner: deviceOwner };
      if (ipCount >= settings.maxSignupsPerIpPerDay) {
        throw new ApiError(429, "IP_LIMIT", "Too many accounts have been created from this network today.");
      }
      let ownCode = referralCode();
      for (let i = 0; i < 5 && (await tx.getReferralOwner(ownCode)); i++) ownCode = referralCode();
      const admin = this.opts.adminEmails.includes(email);
      const user = freshUser({
        id: input.uid,
        email,
        displayName,
        passwordHash: null,
        role: admin ? "admin" : "user",
        provider: input.provider,
        referralCode: ownCode,
        referredBy: refOwner,
        signupIp: input.ip,
      });
      this.applyDevice(user, input.device);
      const blockReason = this.applyDeviceFraud(user, settings, null);
      if (!admin && ipCount + 1 >= settings.flagSignupsPerIp) {
        this.addFlag(user, "Several accounts were created from this network today.");
      }
      const today = zaDate();
      if (!admin) {
        if (stats.signupsTodayDate !== today) {
          stats.signupsToday = 0;
          stats.signupsTodayDate = today;
        }
        stats.totalUsers += 1;
        stats.signupsToday += 1;
      }
      await tx.saveIpCount(ipKey, ipCount + 1);
      await tx.saveUser(user);
      await tx.saveEmailOwner(email, user.id);
      await tx.saveReferralOwner(ownCode, user.id);
      await tx.saveDeviceOwner(input.device.deviceId, user.id);
      await tx.saveStats(stats);
      await tx.addNotification(this.notice(user.id, "system", "Welcome to EarnZA", "Your account is ready."));
      if (blockReason) await tx.addNotification(this.notice(user.id, "system", "Account blocked", blockReason));
      return user;
    });
    return this.finishDeviceConflict(outcome);
  }

  async forgotPassword(emailRaw: string, ip: string): Promise<{ resetToken: string | null }> {
    const email = assertEmail(emailRaw);
    const user = await this.repo.getUserByEmail(email);
    return this.repo.transaction(async (tx) => {
      await this.gate(tx, `forgot:${ip}`, 8, 60 * 60 * 1000);
      if (!user || user.deleted || !user.passwordHash) return { resetToken: null };
      const token = crypto.randomBytes(24).toString("base64url");
      await tx.saveReset({
        tokenHash: sha256(token),
        uid: user.id,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        used: false,
      });
      return { resetToken: this.opts.demoMode ? token : null };
    });
  }

  async resetPassword(token: string, password: string): Promise<void> {
    assertPassword(password);
    if (!token || token.length < 20) throw new ApiError(400, "RESET", "That reset link is not valid.");
    await this.repo.transaction(async (tx) => {
      const row = await tx.getReset(sha256(token));
      const user = row ? await tx.getUser(row.uid) : null;
      if (!row || row.used || !user || new Date(row.expiresAt).getTime() < Date.now()) {
        throw new ApiError(400, "RESET", "That reset link is not valid or has expired.");
      }
      user.passwordHash = hashPassword(password);
      row.used = true;
      await tx.saveUser(user);
      await tx.saveReset(row);
    });
  }

  async getSelf(uid: string): Promise<User> {
    const user = await this.repo.getUserById(uid);
    if (!user || user.deleted) throw new ApiError(401, "AUTH", "Please sign in again.");
    return user;
  }

  async wallet(uid: string) {
    const user = await this.getSelf(uid);
    const settings = await this.repo.transaction((tx) => tx.getSettings());
    return {
      user: toSelf(user),
      wallet: buildWallet(user, settings, new Date(), { enforceDeviceBlocks: !this.opts.demoMode }),
    };
  }

  async updateProfile(uid: string, displayName: string): Promise<User> {
    const name = assertName(displayName);
    return this.repo.transaction(async (tx) => {
      const user = await this.requireUser(tx, uid);
      user.displayName = name;
      await tx.saveUser(user);
      return user;
    });
  }

  async deleteAccount(uid: string): Promise<void> {
    const existing = await this.repo.listWithdrawals({ uid });
    await this.repo.transaction(async (tx) => {
      const user = await this.requireUser(tx, uid);
      const stats = await tx.getStats();
      const withdrawals = [];
      for (const item of existing) {
        const withdrawal = await tx.getWithdrawal(item.id);
        if (withdrawal) withdrawals.push(withdrawal);
      }
      if (user.pendingWithdrawalId) {
        throw new ApiError(409, "PENDING_WITHDRAWAL", "Deletion is not available while a cash out is still open. Wait for it to be paid or rejected.");
      }
      if (user.deviceId) await tx.deleteDevice(user.deviceId);
      await tx.deleteEmailOwner(user.email);
      const removed = user.points;
      user.points = 0;
      user.deleted = true;
      user.blocked = true;
      user.blockReason = "Deleted by the account holder";
      user.displayName = "Deleted user";
      user.passwordHash = null;
      user.email = `deleted-${user.id}@deleted.earnza.local`;
      user.deviceId = null;
      stats.outstandingPoints -= removed;
      if (user.role === "user" && stats.totalUsers > 0) stats.totalUsers -= 1;
      await tx.saveUser(user);
      await tx.saveStats(stats);
      await tx.addLedger(this.ledger(user, "account_deleted", -removed, "Account deleted"));
      for (const withdrawal of withdrawals) {
        withdrawal.accountNumber = withdrawal.accountNumber ? "redacted" : null;
        withdrawal.voucherPin = null;
        withdrawal.phone = null;
        await tx.saveWithdrawal(withdrawal);
      }
    });
  }

  async publicConfig() {
    const settings = await this.repo.transaction((tx) => tx.getSettings());
    return {
      currency: "ZAR",
      demoMode: this.opts.demoMode,
      pointsPerZar: settings.pointsPerZar,
      pointsPerAd: settings.pointsPerAd,
      dailyAdCap: settings.dailyAdCap,
      cooldownSeconds: settings.cooldownSeconds,
      minPayoutPoints: settings.minPayoutPoints,
      minPayoutZar: pointsToZar(settings.minPayoutPoints, settings.pointsPerZar),
      checkInBonusPoints: settings.checkInBonusPoints,
      referralBonusPoints: settings.referralBonusPoints,
    };
  }

  async prepareAd(uid: string): Promise<{ sessionId: string; customData: string; userId: string; pointsOnSuccess: number }> {
    const outcome = await this.repo.transaction(async (tx) => {
      const user = await this.requireUser(tx, uid);
      const settings = await tx.getSettings();
      const existing = user.pendingAdSessionId ? await tx.getSession(user.pendingAdSessionId) : null;
      const withdrawal = user.pendingWithdrawalId ? await tx.getWithdrawal(user.pendingWithdrawalId) : null;
      if (!user.blocked) {
        const reason = this.applyDeviceFraud(user, settings, withdrawal);
        if (reason) {
          await tx.saveUser(user);
          if (withdrawal) await tx.saveWithdrawal(withdrawal);
          await tx.addNotification(this.notice(user.id, "system", "Account blocked", reason));
          return { blocked: true as const, reason };
        }
      }
      await this.gate(tx, `ad:${uid}`, 60, 60 * 60 * 1000);
      this.assertCanWatch(user, settings);
      if (existing && existing.status === "pending" && new Date(existing.expiresAt).getTime() > Date.now()) {
        return { blocked: false as const, sessionId: existing.id, customData: existing.id, userId: uid, pointsOnSuccess: settings.pointsPerAd };
      }
      if (existing && existing.status === "pending") {
        existing.status = "rejected";
        await tx.saveSession(existing);
      }
      const session = {
        id: id("ad"),
        uid,
        createdAt: nowIso(),
        expiresAt: new Date(Date.now() + SESSION_MS).toISOString(),
        status: "pending" as const,
        transactionId: null,
      };
      user.pendingAdSessionId = session.id;
      await tx.saveSession(session);
      await tx.saveUser(user);
      return { blocked: false as const, sessionId: session.id, customData: session.id, userId: uid, pointsOnSuccess: settings.pointsPerAd };
    });
    if (outcome.blocked) throw new ApiError(403, "BLOCKED", outcome.reason);
    return { sessionId: outcome.sessionId, customData: outcome.customData, userId: outcome.userId, pointsOnSuccess: outcome.pointsOnSuccess };
  }

  async completeDemoAd(uid: string, sessionId: string) {
    if (!this.opts.demoMode) {
      await this.punishMissingSsv(uid);
      throw new ApiError(403, "SSV_REQUIRED", "Rewards are only credited after a valid AdMob callback. This account is blocked.");
    }
    if (!sessionId) throw new ApiError(400, "SESSION", "Missing ad session.");
    const result = await this.repo.transaction(async (tx) => {
      const session = await tx.getSession(sessionId);
      if (!session || session.uid !== uid) throw new ApiError(404, "SESSION", "Ad session not found.");
      return this.applyCredit(tx, session.id, `demo:${session.id}`, null);
    });
    return this.finishCredit(result);
  }

  async creditSsv(rawQuery: string, keys: VerifierKey[]) {
    const verified = verifyAdmobQuery(rawQuery, keys);
    const params = new URLSearchParams(rawQuery.startsWith("?") ? rawQuery.slice(1) : rawQuery);
    if (!verified.ok) {
      await this.noteInvalidSsv(params.get("custom_data"));
      throw new ApiError(401, "SSV_INVALID", "AdMob signature verification failed.");
    }
    const transactionId = params.get("transaction_id");
    const customData = params.get("custom_data");
    const userId = params.get("user_id");
    if (!transactionId || !customData) throw new ApiError(400, "SSV_PARAMS", "Missing transaction or custom data.");
    const result = await this.repo.transaction(async (tx) => this.applyCredit(tx, customData, transactionId, userId));
    return this.finishCredit(result);
  }

  async checkIn(uid: string) {
    return this.repo.transaction(async (tx) => {
      const user = await this.requireUser(tx, uid);
      const settings = await tx.getSettings();
      const stats = await tx.getStats();
      if (user.blocked) throw new ApiError(403, "BLOCKED", "This account cannot earn right now.");
      const today = zaDate();
      if (user.lastCheckInDate === today) throw new ApiError(409, "ALREADY", "You have already checked in today.");
      const points = settings.checkInBonusPoints;
      user.lastCheckInDate = today;
      user.points += points;
      user.lifetimePointsEarned += points;
      stats.outstandingPoints += points;
      stats.totalPointsIssued += points;
      await tx.saveUser(user);
      await tx.saveStats(stats);
      await tx.addLedger(this.ledger(user, "check_in", points, "Daily check-in"));
      await tx.addNotification(this.notice(user.id, "earning", "Daily check-in", `You received ${points} points.`));
      return { points, balance: user.points };
    });
  }

  async requestWithdrawal(uid: string, input: Record<string, unknown>) {
    const points = Number(input.points);
    const method = input.method === "bank" ? "bank" : input.method === "1voucher" ? "1voucher" : "";
    if (!Number.isInteger(points) || points <= 0) throw new ApiError(400, "POINTS", "Enter a whole number of points.");
    if (!method) throw new ApiError(400, "METHOD", "Choose 1Voucher or a bank transfer.");
    const details = this.payoutDetails(method, input);
    return this.repo.transaction(async (tx) => {
      const user = await this.requireUser(tx, uid);
      const settings = await tx.getSettings();
      const stats = await tx.getStats();
      if (user.blocked) throw new ApiError(403, "BLOCKED", "This account cannot cash out.");
      if (user.pendingWithdrawalId) throw new ApiError(409, "PENDING", "You already have a cash out waiting for review.");
      if (points < settings.minPayoutPoints) {
        throw new ApiError(400, "MINIMUM", `The minimum cash out is ${settings.minPayoutPoints} points (R${pointsToZar(settings.minPayoutPoints, settings.pointsPerZar).toFixed(2)}).`);
      }
      if (points > user.points) throw new ApiError(400, "BALANCE", "You do not have enough points.");
      const commitment = stats.paidOutPoints + stats.pendingWithdrawalPoints + points;
      if (settings.payoutsRequireRevenueCover && zarCents(commitment, settings.pointsPerZar) > Math.round(stats.estimatedRevenueZar * 100)) {
        throw new ApiError(409, "PAYOUTS_PAUSED", "Cash outs are paused because paying this would exceed estimated ad revenue.");
      }
      const withdrawal: Withdrawal = {
        id: id("wd"),
        uid: user.id,
        userEmail: user.email,
        displayName: user.displayName,
        points,
        zarAmount: pointsToZar(points, settings.pointsPerZar),
        method,
        status: "PENDING",
        phone: details.phone,
        accountHolder: details.accountHolder,
        bankName: details.bankName,
        accountNumber: details.accountNumber,
        branchCode: details.branchCode,
        accountType: details.accountType,
        voucherPin: null,
        paymentReference: null,
        adminNote: null,
        rejectionReason: null,
        frozenReason: null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        reviewedBy: null,
        paidAt: null,
      };
      user.points -= points;
      user.pendingWithdrawalId = withdrawal.id;
      stats.outstandingPoints -= points;
      stats.pendingWithdrawalPoints += points;
      await tx.saveWithdrawal(withdrawal);
      await tx.saveUser(user);
      await tx.saveStats(stats);
      await tx.addLedger(this.ledger(user, "withdrawal", -points, `Cash out requested (${method === "1voucher" ? "1Voucher" : "bank transfer"})`));
      await tx.addNotification(this.notice(user.id, "payout", "Cash out requested", `R${withdrawal.zarAmount.toFixed(2)} is pending review. Nothing is paid automatically.`));
      return withdrawal;
    });
  }

  async listWithdrawals(uid: string) {
    return this.repo.listWithdrawals({ uid });
  }

  async listLedger(uid: string) {
    return this.repo.listLedger(uid, 100);
  }

  async listNotifications(uid: string) {
    return this.repo.listNotifications(uid);
  }

  async markRead(uid: string, notificationId: string) {
    await this.repo.transaction(async (tx) => {
      const note = await tx.getNotification(notificationId);
      if (!note || note.uid !== uid) throw new ApiError(404, "NOT_FOUND", "Notification not found.");
      note.read = true;
      await tx.saveNotification(note);
    });
  }

  async adminDashboard(actorId: string) {
    await this.assertAdmin(actorId);
    const [settings, stats, users, withdrawals, recentLedger] = await Promise.all([
      this.repo.transaction((tx) => tx.getSettings()),
      this.repo.transaction((tx) => tx.getStats()),
      this.repo.listUsers(),
      this.repo.listWithdrawals(),
      this.repo.listRecentLedger(12),
    ]);
    const rate = settings.pointsPerZar;
    const outstandingZar = pointsToZar(stats.outstandingPoints, rate);
    const pendingZar = pointsToZar(stats.pendingWithdrawalPoints, rate);
    const paidOutZar = pointsToZar(stats.paidOutPoints, rate);
    const owedZar = pointsToZar(stats.outstandingPoints + stats.pendingWithdrawalPoints, rate);
    const lifetimeCommitmentZar = pointsToZar(stats.outstandingPoints + stats.pendingWithdrawalPoints + stats.paidOutPoints, rate);
    const revenueCents = Math.round(stats.estimatedRevenueZar * 100);
    return {
      currency: "ZAR",
      totalUsers: stats.totalUsers,
      signupsToday: stats.signupsTodayDate === zaDate() ? stats.signupsToday : 0,
      adsWatchedTotal: stats.totalAds,
      adsWatchedToday: stats.adsTodayDate === zaDate() ? stats.adsToday : 0,
      pointsOutstanding: stats.outstandingPoints,
      outstandingZar,
      pendingWithdrawalPoints: stats.pendingWithdrawalPoints,
      pendingZar,
      paidOutPoints: stats.paidOutPoints,
      paidOutZar,
      estimatedRevenueZar: stats.estimatedRevenueZar,
      totalPointsIssued: stats.totalPointsIssued,
      issuedZar: pointsToZar(stats.totalPointsIssued, rate),
      owedZar,
      lifetimeCommitmentZar,
      headroomZar: pointsToZar(revenueCents - Math.round(lifetimeCommitmentZar * 100), 100),
      payoutHeadroomZar: pointsToZar(revenueCents - Math.round((paidOutZar + pendingZar) * 100), 100),
      revenueCoversLiability: revenueCents >= Math.round(lifetimeCommitmentZar * 100),
      pointsPerZar: rate,
      estimatedEcpmZar: settings.estimatedEcpmZar,
      recentSignups: users.filter((user) => user.role === "user" && !user.deleted).slice(0, 6).map(toAdmin),
      recentWithdrawals: withdrawals.slice(0, 6),
      recentLedger,
    };
  }

  async adminListUsers(actorId: string, query: string) {
    await this.assertAdmin(actorId);
    const q = query.trim().toLowerCase();
    const users = await this.repo.listUsers();
    return users
      .filter((user) => {
        if (!q) return true;
        return [user.email, user.displayName, user.referralCode, user.id, user.deviceId ?? ""].join(" ").toLowerCase().includes(q);
      })
      .map(toAdmin);
  }

  async adminGetUser(actorId: string, uid: string) {
    await this.assertAdmin(actorId);
    const user = await this.repo.getUserById(uid);
    if (!user) throw new ApiError(404, "NOT_FOUND", "User not found.");
    const [ledger, withdrawals] = await Promise.all([this.repo.listLedger(uid, 30), this.repo.listWithdrawals({ uid })]);
    return { user: toAdmin(user), ledger, withdrawals };
  }

  async adminBlock(actorId: string, uid: string, blocked: boolean, reason: string) {
    await this.assertAdmin(actorId);
    return this.repo.transaction(async (tx) => {
      const user = await tx.getUser(uid);
      if (!user) throw new ApiError(404, "NOT_FOUND", "User not found.");
      const withdrawal = user.pendingWithdrawalId ? await tx.getWithdrawal(user.pendingWithdrawalId) : null;
      if (blocked) {
        const text = reason.trim().slice(0, 240) || "Blocked by admin";
        this.applyAutoBlock(user, text);
        this.freezeWithdrawal(withdrawal, text);
        await tx.addNotification(this.notice(user.id, "system", "Account blocked", `${text} Pending cash outs are frozen.`));
      } else {
        user.blocked = false;
        user.blockReason = null;
        this.thawWithdrawal(withdrawal);
        await tx.addNotification(this.notice(user.id, "system", "Account unblocked", "You can earn again. A frozen cash out is back in the review queue."));
      }
      await tx.saveUser(user);
      if (withdrawal) await tx.saveWithdrawal(withdrawal);
      return toAdmin(user);
    });
  }

  async adminAdjust(actorId: string, uid: string, delta: number, note: string) {
    await this.assertAdmin(actorId);
    if (!Number.isInteger(delta) || delta === 0) throw new ApiError(400, "POINTS", "Enter a non-zero whole number of points.");
    if (note.trim().length < 3) throw new ApiError(400, "NOTE", "Add a short note for this adjustment.");
    return this.repo.transaction(async (tx) => {
      const user = await tx.getUser(uid);
      const stats = await tx.getStats();
      if (!user || user.deleted) throw new ApiError(404, "NOT_FOUND", "User not found.");
      if (user.points + delta < 0) throw new ApiError(400, "BALANCE", "That would make the balance negative.");
      user.points += delta;
      if (delta > 0) user.lifetimePointsEarned += delta;
      stats.outstandingPoints += delta;
      if (delta > 0) stats.totalPointsIssued += delta;
      await tx.saveUser(user);
      await tx.saveStats(stats);
      await tx.addLedger(this.ledger(user, "adjustment", delta, note.trim().slice(0, 200)));
      await tx.addNotification(this.notice(user.id, "earning", "Balance adjustment", `${delta > 0 ? "+" : ""}${delta} points. ${note.trim().slice(0, 140)}`));
      return toAdmin(user);
    });
  }

  async adminListWithdrawals(actorId: string, status?: string) {
    await this.assertAdmin(actorId);
    return this.repo.listWithdrawals(status ? { status } : undefined);
  }

  async adminReview(
    actorId: string,
    withdrawalId: string,
    action: "approve" | "reject" | "pay",
    fields: { voucherPin?: string; paymentReference?: string; note?: string; reason?: string },
  ) {
    await this.assertAdmin(actorId);
    return this.repo.transaction(async (tx) => {
      const withdrawal = await tx.getWithdrawal(withdrawalId);
      if (!withdrawal) throw new ApiError(404, "NOT_FOUND", "Withdrawal not found.");
      const user = await tx.getUser(withdrawal.uid);
      const stats = await tx.getStats();
      if (!user) throw new ApiError(404, "NOT_FOUND", "User not found.");
      if (withdrawal.status === "FROZEN") {
        throw new ApiError(409, "FROZEN", "This cash out is frozen because the account was blocked. Unblock the member to release it.");
      }
      const stamp = nowIso();
      withdrawal.updatedAt = stamp;
      withdrawal.reviewedBy = actorId;
      withdrawal.adminNote = fields.note?.trim().slice(0, 300) || withdrawal.adminNote;
      if (action === "approve") {
        if (withdrawal.status !== "PENDING") throw new ApiError(409, "STATUS", "Only a pending cash out can be approved.");
        withdrawal.status = "APPROVED";
        await tx.addNotification(this.notice(user.id, "payout", "Cash out approved", "Approved. Payment is still manual and will show here once it is sent."));
      } else if (action === "reject") {
        if (withdrawal.status !== "PENDING" && withdrawal.status !== "APPROVED") {
          throw new ApiError(409, "STATUS", "This cash out can no longer be rejected.");
        }
        withdrawal.status = "REJECTED";
        withdrawal.rejectionReason = fields.reason?.trim().slice(0, 300) || "Rejected";
        user.points += withdrawal.points;
        user.pendingWithdrawalId = null;
        stats.outstandingPoints += withdrawal.points;
        stats.pendingWithdrawalPoints -= withdrawal.points;
        await tx.addLedger(this.ledger(user, "withdrawal_refund", withdrawal.points, "Cash out rejected — points returned"));
        await tx.addNotification(this.notice(user.id, "payout", "Cash out rejected", withdrawal.rejectionReason));
      } else {
        if (withdrawal.status !== "PENDING" && withdrawal.status !== "APPROVED") {
          throw new ApiError(409, "STATUS", "This cash out can no longer be marked paid.");
        }
        if (withdrawal.method === "1voucher") {
          const pin = (fields.voucherPin ?? "").replace(/\s+/g, "");
          if (!/^[A-Za-z0-9]{8,24}$/.test(pin)) throw new ApiError(400, "PIN", "Enter the 1Voucher PIN (8–24 letters or digits).");
          withdrawal.voucherPin = pin;
        } else {
          const reference = (fields.paymentReference ?? "").trim();
          if (reference.length < 3 || reference.length > 40) throw new ApiError(400, "REFERENCE", "Enter the bank payment reference.");
          withdrawal.paymentReference = reference;
        }
        withdrawal.status = "PAID";
        withdrawal.paidAt = stamp;
        user.pendingWithdrawalId = null;
        stats.pendingWithdrawalPoints -= withdrawal.points;
        stats.paidOutPoints += withdrawal.points;
        const detail =
          withdrawal.method === "1voucher"
            ? `Your 1Voucher PIN is ${withdrawal.voucherPin}.`
            : `Bank reference: ${withdrawal.paymentReference}.`;
        await tx.addNotification(this.notice(user.id, "payout", "Cash out paid", `R${withdrawal.zarAmount.toFixed(2)} marked paid. ${detail}`));
      }
      await tx.saveWithdrawal(withdrawal);
      await tx.saveUser(user);
      await tx.saveStats(stats);
      return withdrawal;
    });
  }

  async adminGetSettings(actorId: string) {
    await this.assertAdmin(actorId);
    return this.repo.transaction((tx) => tx.getSettings());
  }

  async adminUpdateSettings(actorId: string, patch: Record<string, unknown>) {
    await this.assertAdmin(actorId);
    return this.repo.transaction(async (tx) => {
      const settings = await tx.getSettings();
      const next: Settings = {
        ...settings,
        pointsPerZar: num(patch, "pointsPerZar", settings.pointsPerZar, 1, 1_000_000),
        pointsPerAd: integer(patch, "pointsPerAd", settings.pointsPerAd, 1, 1000),
        dailyAdCap: integer(patch, "dailyAdCap", settings.dailyAdCap, 1, 500),
        cooldownSeconds: integer(patch, "cooldownSeconds", settings.cooldownSeconds, 10, 86_400),
        minPayoutPoints: integer(patch, "minPayoutPoints", settings.minPayoutPoints, 1, 10_000_000),
        checkInBonusPoints: integer(patch, "checkInBonusPoints", settings.checkInBonusPoints, 0, 10_000),
        referralBonusPoints: integer(patch, "referralBonusPoints", settings.referralBonusPoints, 0, 100_000),
        estimatedEcpmZar: num(patch, "estimatedEcpmZar", settings.estimatedEcpmZar, 0, 1000),
        maxSignupsPerIpPerDay: integer(patch, "maxSignupsPerIpPerDay", settings.maxSignupsPerIpPerDay, 1, 100),
        blockEmulators: bool(patch, "blockEmulators", settings.blockEmulators),
        blockRooted: bool(patch, "blockRooted", settings.blockRooted),
        blockSuspicious: bool(patch, "blockSuspicious", settings.blockSuspicious),
        payoutsRequireRevenueCover: bool(patch, "payoutsRequireRevenueCover", settings.payoutsRequireRevenueCover),
        autoBlockEmulators: bool(patch, "autoBlockEmulators", settings.autoBlockEmulators),
        autoBlockRooted: bool(patch, "autoBlockRooted", settings.autoBlockRooted),
        autoBlockSharedDevice: bool(patch, "autoBlockSharedDevice", settings.autoBlockSharedDevice),
        minSecondsBetweenAds: integer(patch, "minSecondsBetweenAds", settings.minSecondsBetweenAds, 5, 600),
        flagAdsPerHour: integer(patch, "flagAdsPerHour", settings.flagAdsPerHour, 1, 500),
        blockAdsPerHour: integer(patch, "blockAdsPerHour", settings.blockAdsPerHour, 1, 500),
        flagInvalidSsvCount: integer(patch, "flagInvalidSsvCount", settings.flagInvalidSsvCount, 1, 50),
        blockInvalidSsvCount: integer(patch, "blockInvalidSsvCount", settings.blockInvalidSsvCount, 1, 50),
        flagReferralCount: integer(patch, "flagReferralCount", settings.flagReferralCount, 1, 10_000),
        flagSignupsPerIp: integer(patch, "flagSignupsPerIp", settings.flagSignupsPerIp, 2, 100),
        updatedAt: nowIso(),
      };
      if (next.blockAdsPerHour < next.flagAdsPerHour) {
        throw new ApiError(400, "SETTINGS", "The auto-block ads-per-hour limit must be at least the review flag.");
      }
      if (next.blockInvalidSsvCount < next.flagInvalidSsvCount) {
        throw new ApiError(400, "SETTINGS", "The auto-block count for invalid ad callbacks must be at least the review flag.");
      }
      await tx.saveSettings(next);
      return next;
    });
  }

  /** Seed-only. One ledger line stands in for many verified ads so demo data stays consistent. */
  async grantHistoricalAds(uid: string, adCount: number) {
    if (!Number.isInteger(adCount) || adCount < 1 || adCount > 100_000) {
      throw new ApiError(400, "ADS", "Invalid historical ad count.");
    }
    return this.repo.transaction(async (tx) => {
      const user = await this.requireUser(tx, uid);
      const settings = await tx.getSettings();
      const stats = await tx.getStats();
      const points = adCount * settings.pointsPerAd;
      user.points += points;
      user.lifetimePointsEarned += points;
      user.adsWatched += adCount;
      stats.totalAds += adCount;
      stats.outstandingPoints += points;
      stats.estimatedRevenueZar = pointsToZar(Math.round((stats.estimatedRevenueZar + adCount * settings.estimatedEcpmZar) * 100), 100);
      stats.totalPointsIssued += points;
      await tx.saveUser(user);
      await tx.saveStats(stats);
      await tx.addLedger(this.ledger(user, "ad_reward", points, `Earlier verified ad rewards (${adCount} ads)`, { aggregated: true, ads: adCount }));
      return user;
    });
  }

  async audit(): Promise<string[]> {
    const [users, withdrawals, ledger, stats] = await Promise.all([
      this.repo.listUsers(),
      this.repo.listWithdrawals(),
      this.repo.listRecentLedger(100_000),
      this.repo.transaction((tx) => tx.getStats()),
    ]);
    const problems: string[] = [];
    const outstanding = users.reduce((sum, user) => sum + user.points, 0);
    const pending = withdrawals.filter((item) => item.status === "PENDING" || item.status === "APPROVED" || item.status === "FROZEN").reduce((sum, item) => sum + item.points, 0);
    const paid = withdrawals.filter((item) => item.status === "PAID").reduce((sum, item) => sum + item.points, 0);
    const ledgerSum = ledger.reduce((sum, item) => sum + item.points, 0);
    if (outstanding !== stats.outstandingPoints) problems.push(`outstanding ${outstanding} != stats ${stats.outstandingPoints}`);
    if (pending !== stats.pendingWithdrawalPoints) problems.push(`pending ${pending} != stats ${stats.pendingWithdrawalPoints}`);
    if (paid !== stats.paidOutPoints) problems.push(`paid ${paid} != stats ${stats.paidOutPoints}`);
    if (ledgerSum !== outstanding) problems.push(`ledger ${ledgerSum} != balances ${outstanding}`);
    return problems;
  }

  private async applyCredit(tx: Tx, sessionId: string, transactionId: string, userId: string | null): Promise<CreditResult> {
    const session = await tx.getSession(sessionId);
    const duplicate = await tx.hasProcessed(transactionId);
    const user = session ? await tx.getUser(session.uid) : null;
    const settings = await tx.getSettings();
    const stats = await tx.getStats();
    const referrerId = user && user.referredBy && !user.referralCredited ? user.referredBy : null;
    const referrer = referrerId ? await tx.getUser(referrerId) : null;
    const withdrawal = user?.pendingWithdrawalId ? await tx.getWithdrawal(user.pendingWithdrawalId) : null;
    if (duplicate) return { duplicate: true, points: 0 };
    if (!session || session.status !== "pending") throw new ApiError(409, "SESSION", "This ad session is not open.");
    if (new Date(session.expiresAt).getTime() < Date.now()) throw new ApiError(409, "EXPIRED", "This ad session has expired.");
    if (!user || user.deleted) throw new ApiError(404, "USER", "User not found.");
    if (userId && userId !== user.id) {
      return this.recordBadClaim(tx, user, withdrawal, "AdMob user id did not match this ad session.", settings);
    }
    this.assertCanWatch(user, settings);
    const pace = judgeAdPace(user, settings, this.nowMs());
    if (pace.block) {
      this.applyAutoBlock(user, pace.block);
      this.freezeWithdrawal(withdrawal, pace.block);
      session.status = "rejected";
      user.pendingAdSessionId = null;
      await tx.saveSession(session);
      await tx.saveUser(user);
      if (withdrawal) await tx.saveWithdrawal(withdrawal);
      await tx.addNotification(this.notice(user.id, "system", "Account blocked", pace.block));
      return { duplicate: false, points: 0, blocked: true, reason: pace.block };
    }
    if (pace.flag) this.addFlag(user, pace.flag);
    const points = settings.pointsPerAd;
    const today = zaDate();
    user.adsToday = rollDayCount(user.adsTodayDate, user.adsToday, today) + 1;
    user.adsTodayDate = today;
    user.points += points;
    user.lifetimePointsEarned += points;
    user.adsWatched += 1;
    const watchedAt = new Date(this.nowMs()).toISOString();
    user.lastAdAt = watchedAt;
    const hourAgo = this.nowMs() - 60 * 60 * 1000;
    user.recentAdAt = [...(user.recentAdAt ?? []).filter((stamp) => new Date(stamp).getTime() > hourAgo), watchedAt].slice(-100);
    user.pendingAdSessionId = null;
    session.status = "credited";
    session.transactionId = transactionId;
    const adsToday = bumpToday(stats.adsTodayDate, stats.adsToday, today);
    stats.adsTodayDate = adsToday.date;
    stats.adsToday = adsToday.count;
    stats.totalAds += 1;
    stats.outstandingPoints += points;
    stats.totalPointsIssued += points;
    stats.estimatedRevenueZar = pointsToZar(Math.round((stats.estimatedRevenueZar + settings.estimatedEcpmZar) * 100), 100);
    await tx.saveProcessed(transactionId, user.id);
    await tx.saveSession(session);
    await tx.addLedger(this.ledger(user, "ad_reward", points, "Rewarded ad", { transactionId }));
    await tx.addNotification(this.notice(user.id, "earning", "Ad reward", `+${points} points after server verification.`));

    if (referrer && !referrer.deleted && !referrer.blocked && referrer.deviceId !== user.deviceId) {
      const bonus = settings.referralBonusPoints;
      referrer.points += bonus;
      referrer.lifetimePointsEarned += bonus;
      referrer.referralCount += 1;
      if (referrer.referralCount >= settings.flagReferralCount) {
        this.addFlag(referrer, `${referrer.referralCount} referral rewards is high enough to review.`);
      }
      user.points += bonus;
      user.lifetimePointsEarned += bonus;
      user.referralCredited = true;
      stats.outstandingPoints += bonus * 2;
      stats.totalPointsIssued += bonus * 2;
      await tx.saveUser(referrer);
      await tx.addLedger(this.ledger(referrer, "referral", bonus, "Referral reward"));
      await tx.addLedger(this.ledger(user, "referral", bonus, "Welcome referral reward"));
      await tx.addNotification(this.notice(referrer.id, "earning", "Referral reward", `${user.displayName} watched their first ad. +${bonus} points.`));
      await tx.addNotification(this.notice(user.id, "earning", "Referral reward", `+${bonus} points for joining with a referral code.`));
    } else if (user.referredBy && !user.referralCredited) {
      user.referralCredited = true;
    }

    await tx.saveUser(user);
    await tx.saveStats(stats);
    return { duplicate: false as const, points, balance: user.points };
  }

  private assertCanWatch(user: User, settings: Settings) {
    if (user.blocked) throw new ApiError(403, "BLOCKED", "This account cannot watch ads for rewards.");
    if (!this.opts.demoMode && user.isEmulator && settings.blockEmulators) {
      throw new ApiError(403, "EMULATOR", "Rewards are not available on emulators.");
    }
    if (!this.opts.demoMode && user.isRooted && settings.blockRooted) {
      throw new ApiError(403, "ROOTED", "Rewards are not available on rooted devices.");
    }
    if (user.suspicious && settings.blockSuspicious) {
      throw new ApiError(403, "SUSPICIOUS", "This account is under review.");
    }
    const today = zaDate();
    const adsToday = rollDayCount(user.adsTodayDate, user.adsToday, today);
    if (adsToday >= settings.dailyAdCap) throw new ApiError(409, "DAILY_CAP", "You have reached today's watch limit.");
    if (user.lastAdAt) {
      const elapsed = (this.nowMs() - new Date(user.lastAdAt).getTime()) / 1000;
      const wait = Math.ceil(settings.cooldownSeconds - elapsed);
      if (wait > 0) throw new ApiError(409, "COOLDOWN", `Please wait ${wait} seconds before the next ad.`);
    }
  }

  private applyDevice(user: User, device: DeviceInput | null) {
    if (!device) return;
    user.deviceId = device.deviceId;
    user.isEmulator = device.isEmulator;
    user.isRooted = device.isRooted;
    user.deviceModel = device.model;
  }

  /** Returns the other account id when this device is already taken. Does not write in that case. */
  private async bindExistingDevice(tx: Tx, user: User, device: DeviceInput): Promise<string | null> {
    const owner = await tx.getDeviceOwner(device.deviceId);
    if (owner && owner !== user.id) return owner;
    const release = user.deviceId && user.deviceId !== device.deviceId ? user.deviceId : null;
    if (release && !this.opts.demoMode) {
      throw new ApiError(409, "DEVICE_MISMATCH", "This account is linked to another device.");
    }
    if (release) await tx.deleteDevice(release);
    if (!owner) await tx.saveDeviceOwner(device.deviceId, user.id);
    this.applyDevice(user, device);
    return null;
  }

  private async finishDeviceConflict(outcome: User | TakenDevice): Promise<User> {
    if ("takenDeviceOwner" in outcome) {
      await this.blockSharedDevice(outcome.takenDeviceOwner);
      throw new ApiError(409, "DEVICE_TAKEN", "This device already has an account.");
    }
    return outcome;
  }

  private finishCredit(result: CreditResult): CreditResult {
    if (result.mismatch) throw new ApiError(400, "SSV_USER", "User does not match this ad session.");
    if (result.blocked) throw new ApiError(403, "BLOCKED", result.reason ?? "This account is blocked.");
    return result;
  }

  private async blockSharedDevice(ownerId: string) {
    await this.repo.transaction(async (tx) => {
      const settings = await tx.getSettings();
      if (!settings.autoBlockSharedDevice) return;
      const user = await tx.getUser(ownerId);
      if (!user || user.deleted) return;
      const withdrawal = user.pendingWithdrawalId ? await tx.getWithdrawal(user.pendingWithdrawalId) : null;
      const reason = "Another account was attempted on this device.";
      this.applyAutoBlock(user, reason);
      this.freezeWithdrawal(withdrawal, reason);
      await tx.saveUser(user);
      if (withdrawal) await tx.saveWithdrawal(withdrawal);
      await tx.addNotification(this.notice(user.id, "system", "Account blocked", `${reason} Pending cash outs are frozen.`));
    });
  }

  private async noteInvalidSsv(customData: string | null) {
    if (!customData) return;
    await this.repo.transaction(async (tx) => {
      const session = await tx.getSession(customData);
      if (!session || session.status !== "pending") return;
      const user = await tx.getUser(session.uid);
      if (!user || user.deleted) return;
      const settings = await tx.getSettings();
      const withdrawal = user.pendingWithdrawalId ? await tx.getWithdrawal(user.pendingWithdrawalId) : null;
      await this.recordBadClaim(tx, user, withdrawal, "Reward claim failed AdMob signature verification.", settings);
    });
  }

  private async punishMissingSsv(uid: string) {
    await this.repo.transaction(async (tx) => {
      const user = await tx.getUser(uid);
      if (!user || user.deleted) return;
      const withdrawal = user.pendingWithdrawalId ? await tx.getWithdrawal(user.pendingWithdrawalId) : null;
      const reason = "Tried to claim a reward without a valid AdMob server callback.";
      this.applyAutoBlock(user, reason);
      this.freezeWithdrawal(withdrawal, reason);
      await tx.saveUser(user);
      if (withdrawal) await tx.saveWithdrawal(withdrawal);
      await tx.addNotification(this.notice(user.id, "system", "Account blocked", reason));
    });
  }

  /** Counts a bad reward claim. Flags first, then blocks once the configured count is reached. */
  private async recordBadClaim(tx: Tx, user: User, withdrawal: Withdrawal | null, detail: string, settings: Settings): Promise<CreditResult> {
    user.invalidSsvCount = (user.invalidSsvCount ?? 0) + 1;
    const count = user.invalidSsvCount;
    if (count >= settings.blockInvalidSsvCount) {
      const reason = `Reward claims without a valid AdMob callback (${count} failed checks).`;
      this.applyAutoBlock(user, reason);
      this.freezeWithdrawal(withdrawal, reason);
      await tx.saveUser(user);
      if (withdrawal) await tx.saveWithdrawal(withdrawal);
      await tx.addNotification(this.notice(user.id, "system", "Account blocked", reason));
      return { duplicate: false, points: 0, blocked: true, mismatch: detail.includes("user id"), reason };
    }
    if (count >= settings.flagInvalidSsvCount) {
      this.addFlag(user, `${detail} (${count} so far). Needs a manual look.`);
    }
    await tx.saveUser(user);
    return { duplicate: false, points: 0, blocked: false, mismatch: detail.includes("user id"), reason: detail };
  }

  private applyAutoBlock(user: User, reason: string) {
    const text = reason.slice(0, 240);
    user.blocked = true;
    user.blockReason = text;
    user.blockHistory = user.blockHistory ?? [];
    if (!user.blockHistory.includes(text)) user.blockHistory.push(text);
    this.addFlag(user, text);
  }

  private addFlag(user: User, reason: string) {
    const text = reason.slice(0, 240);
    user.suspiciousReasons = user.suspiciousReasons ?? [];
    if (!user.suspiciousReasons.includes(text)) user.suspiciousReasons.push(text);
    user.suspicious = true;
  }

  private deviceAction(user: User, settings: Settings): { block: string | null; flags: string[] } {
    const hard: string[] = [];
    const flags: string[] = [];
    if (user.isEmulator) {
      const reason = "Emulator or virtual device.";
      if (settings.autoBlockEmulators) hard.push(reason);
      else flags.push(reason);
    }
    if (user.isRooted) {
      const reason = "Rooted device.";
      if (settings.autoBlockRooted) hard.push(reason);
      else flags.push(reason);
    }
    if (!hard.length) return { block: null, flags };
    return { block: `Clear-cut device check: ${hard.join(" ")}`, flags };
  }

  /** Returns the block reason when this device is clear-cut cheating. */
  private applyDeviceFraud(user: User, settings: Settings, withdrawal: Withdrawal | null): string | null {
    const action = this.deviceAction(user, settings);
    for (const flag of action.flags) this.addFlag(user, flag);
    if (!action.block) return null;
    this.applyAutoBlock(user, action.block);
    this.freezeWithdrawal(withdrawal, action.block);
    return action.block;
  }

  private freezeWithdrawal(withdrawal: Withdrawal | null, reason: string) {
    if (!withdrawal) return;
    if (withdrawal.status !== "PENDING" && withdrawal.status !== "APPROVED") return;
    withdrawal.status = "FROZEN";
    withdrawal.frozenReason = reason.slice(0, 240);
    withdrawal.updatedAt = nowIso();
  }

  private thawWithdrawal(withdrawal: Withdrawal | null) {
    if (!withdrawal || withdrawal.status !== "FROZEN") return;
    withdrawal.status = "PENDING";
    withdrawal.frozenReason = null;
    withdrawal.updatedAt = nowIso();
  }

  private async requireUser(tx: Tx, uid: string): Promise<User> {
    const user = await tx.getUser(uid);
    if (!user || user.deleted) throw new ApiError(401, "AUTH", "Please sign in again.");
    return user;
  }

  private async assertAdmin(uid: string): Promise<User> {
    const user = await this.repo.getUserById(uid);
    if (!user || user.deleted || (user.role !== "admin" && !this.opts.adminEmails.includes(user.email))) {
      throw new ApiError(403, "ADMIN", "Admin access is required.");
    }
    return user;
  }

  private payoutDetails(method: PayoutMethod, input: Record<string, unknown>) {
    if (method === "1voucher") {
      const phone = String(input.phone ?? "").replace(/\s+/g, "");
      if (!/^0[6-8][0-9]{8}$/.test(phone)) throw new ApiError(400, "PHONE", "Enter a South African mobile number, for example 0821234567.");
      return { phone, accountHolder: null, bankName: null, accountNumber: null, branchCode: null, accountType: null as AccountType | null };
    }
    const accountHolder = String(input.accountHolder ?? "").trim();
    const bankName = String(input.bankName ?? "").trim();
    const accountNumber = String(input.accountNumber ?? "").replace(/\s+/g, "");
    const branchCode = String(input.branchCode ?? "").replace(/\s+/g, "");
    const accountType = String(input.accountType ?? "");
    if (accountHolder.length < 2 || accountHolder.length > 80) throw new ApiError(400, "ACCOUNT", "Enter the account holder name.");
    if (bankName.length < 2 || bankName.length > 40) throw new ApiError(400, "BANK", "Choose a bank.");
    if (!/^\d{6,16}$/.test(accountNumber)) throw new ApiError(400, "ACCOUNT", "Enter the account number (6–16 digits).");
    if (!/^\d{6}$/.test(branchCode)) throw new ApiError(400, "BRANCH", "Enter the 6-digit branch code.");
    if (accountType !== "cheque" && accountType !== "savings" && accountType !== "transmission") {
      throw new ApiError(400, "ACCOUNT_TYPE", "Choose cheque, savings or transmission.");
    }
    return { phone: null, accountHolder, bankName, accountNumber, branchCode, accountType: accountType as AccountType };
  }

  private ledger(user: User, type: LedgerEntry["type"], points: number, note: string, meta: LedgerEntry["meta"] = {}): LedgerEntry {
    return {
      id: id("led"),
      uid: user.id,
      type,
      points,
      balanceAfter: user.points,
      createdAt: nowIso(),
      note,
      meta,
    };
  }

  private notice(uid: string, kind: AppNotification["kind"], title: string, body: string): AppNotification {
    return { id: id("ntf"), uid, kind, title, body, createdAt: nowIso(), read: false };
  }
}

export function toSelf(user: User) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    points: user.points,
    lifetimePointsEarned: user.lifetimePointsEarned,
    adsWatched: user.adsWatched,
    createdAt: user.createdAt,
    blocked: user.blocked,
    blockReason: user.blockReason,
    referralCode: user.referralCode,
    referralCount: user.referralCount,
    lastAdAt: user.lastAdAt,
    adsToday: user.adsToday,
    adsTodayDate: user.adsTodayDate,
    lastCheckInDate: user.lastCheckInDate,
    pendingWithdrawalId: user.pendingWithdrawalId,
    isEmulator: user.isEmulator,
    isRooted: user.isRooted,
    deviceModel: user.deviceModel,
    provider: user.provider,
  };
}

export function toAdmin(user: User) {
  return {
    ...toSelf(user),
    suspicious: user.suspicious,
    suspiciousReasons: user.suspiciousReasons ?? [],
    blockHistory: user.blockHistory ?? [],
    invalidSsvCount: user.invalidSsvCount ?? 0,
    referralCredited: user.referralCredited,
    deviceId: user.deviceId,
    referredBy: user.referredBy,
    signupIp: user.signupIp,
    deleted: user.deleted,
  };
}

export function buildWallet(
  user: User,
  settings: Settings,
  now = new Date(),
  opts: { enforceDeviceBlocks?: boolean } = {},
) {
  const today = zaDate(now);
  const adsToday = rollDayCount(user.adsTodayDate, user.adsToday, today);
  let secondsUntilNextAd = 0;
  if (user.lastAdAt) {
    const elapsed = (now.getTime() - new Date(user.lastAdAt).getTime()) / 1000;
    secondsUntilNextAd = Math.max(0, Math.ceil(settings.cooldownSeconds - elapsed));
  }
  const enforceDeviceBlocks = opts.enforceDeviceBlocks !== false;
  const emulatorBlocked = enforceDeviceBlocks && user.isEmulator && settings.blockEmulators;
  const rootedBlocked = enforceDeviceBlocks && user.isRooted && settings.blockRooted;
  const capBlocked = adsToday >= settings.dailyAdCap;
  let watchBlockReason: string | null = null;
  if (user.blocked) watchBlockReason = "blocked";
  else if (emulatorBlocked) watchBlockReason = "emulator";
  else if (rootedBlocked) watchBlockReason = "rooted";
  else if (user.suspicious && settings.blockSuspicious) watchBlockReason = "suspicious";
  else if (capBlocked) watchBlockReason = "cap";
  else if (secondsUntilNextAd > 0) watchBlockReason = "cooldown";
  return {
    points: user.points,
    zar: pointsToZar(user.points, settings.pointsPerZar),
    pointsPerZar: settings.pointsPerZar,
    pointsPerAd: settings.pointsPerAd,
    adsToday,
    dailyAdCap: settings.dailyAdCap,
    cooldownSeconds: settings.cooldownSeconds,
    secondsUntilNextAd,
    canWatch: watchBlockReason === null,
    watchBlockReason,
    canCheckIn: !user.blocked && user.lastCheckInDate !== today,
    minPayoutPoints: settings.minPayoutPoints,
    minPayoutZar: pointsToZar(settings.minPayoutPoints, settings.pointsPerZar),
    checkInBonusPoints: settings.checkInBonusPoints,
    referralBonusPoints: settings.referralBonusPoints,
    pendingWithdrawalId: user.pendingWithdrawalId,
  };
}

function num(patch: Record<string, unknown>, key: string, fallback: number, min: number, max: number): number {
  if (patch[key] === undefined) return fallback;
  const value = Number(patch[key]);
  if (!Number.isFinite(value) || value < min || value > max) throw new ApiError(400, "SETTINGS", `${key} must be between ${min} and ${max}.`);
  return value;
}

function integer(patch: Record<string, unknown>, key: string, fallback: number, min: number, max: number): number {
  const value = num(patch, key, fallback, min, max);
  if (!Number.isInteger(value)) throw new ApiError(400, "SETTINGS", `${key} must be a whole number.`);
  return value;
}

function bool(patch: Record<string, unknown>, key: string, fallback: boolean): boolean {
  if (patch[key] === undefined) return fallback;
  if (typeof patch[key] !== "boolean") throw new ApiError(400, "SETTINGS", `${key} must be true or false.`);
  return patch[key] as boolean;
}

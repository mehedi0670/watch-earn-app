import assert from "node:assert/strict";
import crypto from "crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createApp } from "./http";
import { MemoryRepo } from "./repo";
import { seedDemo } from "./seed";
import { EarnService } from "./service";
import { contentToVerify, verifyAdmobQuery } from "./ssv";
import type { DeviceInput, VerifierKey } from "./types";

function device(id: string, extra: Partial<DeviceInput> = {}): DeviceInput {
  return { deviceId: id, isEmulator: false, isRooted: false, model: "test", platform: "android", ...extra };
}

function harness(demoMode = true) {
  const repo = new MemoryRepo();
  const service = new EarnService(repo, { demoMode, adminEmails: ["mehedi@earnza.local"] });
  return { repo, service };
}

async function adminOf(service: EarnService) {
  return service.signup({
    email: "mehedi@earnza.local",
    password: "EarnZA-admin-demo",
    displayName: "Mehedi",
    device: null,
    ip: "10.9.0.1",
    role: "admin",
  });
}

test("signup, login, and one device per account", async () => {
  const { service } = harness(false);
  const user = await service.signup({
    email: "thabo@earnza.local",
    password: "EarnZA-user-demo",
    displayName: "Thabo Mokoena",
    device: device("device-a-0001"),
    ip: "10.0.0.2",
  });
  assert.equal(user.points, 0);
  assert.equal((user as { passwordHash?: string }).passwordHash === undefined, false);

  await assert.rejects(
    () =>
      service.signup({
        email: "other@earnza.local",
        password: "EarnZA-user-demo",
        displayName: "Other Person",
        device: device("device-a-0001"),
        ip: "10.0.0.3",
      }),
    /already has an account/,
  );

  await assert.rejects(
    () =>
      service.login({
        email: "thabo@earnza.local",
        password: "EarnZA-user-demo",
        device: device("device-b-0001"),
        ip: "10.0.0.4",
      }),
    /another device/,
  );

  const again = await service.login({
    email: "thabo@earnza.local",
    password: "wrong-password-1",
    device: device("device-a-0001"),
    ip: "10.0.0.5",
  }).then(
    () => {
      throw new Error("expected failure");
    },
    (error: Error) => error,
  );
  assert.match(again.message, /incorrect/);
});

test("demo ad completion credits server points and ignores a client amount", async () => {
  const { service } = harness(true);
  const user = await service.signup({
    email: "thabo@earnza.local",
    password: "EarnZA-user-demo",
    displayName: "Thabo Mokoena",
    device: device("device-a-0001"),
    ip: "10.0.0.8",
  });
  const prepared = await service.prepareAd(user.id);
  assert.equal(prepared.pointsOnSuccess, 5);
  const credited = await service.completeDemoAd(user.id, prepared.sessionId);
  assert.equal(credited.duplicate, false);
  assert.equal(credited.points, 5);
  const view = await service.wallet(user.id);
  assert.equal(view.user.points, 5);
  assert.equal(view.wallet.zar, 0.05);
  const replay = await service.completeDemoAd(user.id, prepared.sessionId);
  assert.equal(replay.duplicate, true);
  assert.equal((await service.wallet(user.id)).user.points, 5);
  await assert.rejects(() => service.prepareAd(user.id), /wait/i);
});

test("daily cap, emulator block, and check-in once per day", async () => {
  const { service } = harness(false);
  const admin = await adminOf(service);
  const user = await service.signup({
    email: "naledi@earnza.local",
    password: "EarnZA-user-demo",
    displayName: "Naledi Dlamini",
    device: device("device-n-0001"),
    ip: "10.0.0.10",
  });
  await service.adminUpdateSettings(admin.id, { dailyAdCap: 1, cooldownSeconds: 10 });
  const session = await service.prepareAd(user.id);
  await assert.rejects(() => service.completeDemoAd(user.id, session.sessionId), /AdMob|blocked|disabled|Demo/);
});

test("production mode rejects emulators and enforces the daily cap through SSV", async () => {
  const { service } = harness(false);
  const admin = await adminOf(service);
  await service.adminUpdateSettings(admin.id, { dailyAdCap: 1, cooldownSeconds: 10 });
  const keys = testKeys();
  const user = await service.signup({
    email: "naledi@earnza.local",
    password: "EarnZA-user-demo",
    displayName: "Naledi Dlamini",
    device: device("device-n-0001"),
    ip: "10.0.0.11",
  });
  const emulator = await service.signup({
    email: "johan@earnza.local",
    password: "EarnZA-user-demo",
    displayName: "Johan Botha",
    device: device("device-emu-0001", { isEmulator: true }),
    ip: "10.0.0.12",
  });
  assert.equal(emulator.blocked, true);
  assert.match(emulator.blockReason ?? "", /emulator/i);
  await assert.rejects(() => service.prepareAd(emulator.id), /blocked|cannot watch|emulator/i);

  const prepared = await service.prepareAd(user.id);
  const raw = signQuery(keys.privateKey, ssvParams(prepared.sessionId, user.id, "tx-1", 999999));
  const credited = await service.creditSsv(raw, keys.publicKeys);
  assert.equal(credited.duplicate, false);
  const view = await service.wallet(user.id);
  assert.equal(view.user.points, 5);
  const replay = await service.creditSsv(raw, keys.publicKeys);
  assert.equal(replay.duplicate, true);
  assert.equal((await service.wallet(user.id)).user.points, 5);
  await assert.rejects(() => service.prepareAd(user.id), /limit|wait/i);
  await assert.rejects(() => service.creditSsv(signQuery(keys.privateKey, ssvParams(prepared.sessionId, user.id, "tx-2", 1)).replace("tx-2", "tx-3"), keys.publicKeys));
});

test("bad AdMob signatures are rejected", async () => {
  const { service } = harness(false);
  const user = await service.signup({
    email: "thabo@earnza.local",
    password: "EarnZA-user-demo",
    displayName: "Thabo Mokoena",
    device: device("device-a-0001"),
    ip: "10.0.0.13",
  });
  const prepared = await service.prepareAd(user.id);
  const keys = testKeys();
  const raw = signQuery(keys.privateKey, ssvParams(prepared.sessionId, user.id, "tx-9", 1));
  const tampered = raw.replace("tx-9", "tx-8");
  await assert.rejects(() => service.creditSsv(tampered, keys.publicKeys), /signature/i);
  assert.equal((await service.wallet(user.id)).user.points, 0);
  const unverified = verifyAdmobQuery(tampered, keys.publicKeys);
  assert.equal(unverified.ok, false);
});

test("referral bonus is paid once on the first verified ad", async () => {
  const { service } = harness(true);
  const referrer = await service.signup({
    email: "thabo@earnza.local",
    password: "EarnZA-user-demo",
    displayName: "Thabo Mokoena",
    device: device("device-a-0001"),
    ip: "10.0.0.14",
  });
  const referee = await service.signup({
    email: "naledi@earnza.local",
    password: "EarnZA-user-demo",
    displayName: "Naledi Dlamini",
    device: device("device-b-0001"),
    referralCode: referrer.referralCode,
    ip: "10.0.0.15",
  });
  assert.equal((await service.wallet(referrer.id)).user.points, 0);
  const prepared = await service.prepareAd(referee.id);
  await service.completeDemoAd(referee.id, prepared.sessionId);
  assert.equal((await service.wallet(referee.id)).user.points, 105);
  assert.equal((await service.wallet(referrer.id)).user.points, 100);
  assert.equal((await service.wallet(referrer.id)).user.referralCount, 1);
});

test("cash outs stay pending, refund on reject, and require a pin or reference when paid", async () => {
  const { service } = harness(true);
  const admin = await adminOf(service);
  const user = await service.signup({
    email: "sipho@earnza.local",
    password: "EarnZA-user-demo",
    displayName: "Sipho Ndebele",
    device: device("device-s-0001"),
    ip: "10.0.0.16",
  });
  await service.grantHistoricalAds(user.id, 1200);
  await assert.rejects(
    () => service.requestWithdrawal(user.id, { points: 100, method: "1voucher", phone: "0825550101" }),
    /minimum/i,
  );
  const withdrawal = await service.requestWithdrawal(user.id, { points: 5000, method: "1voucher", phone: "0825550101" });
  assert.equal(withdrawal.status, "PENDING");
  assert.equal((await service.wallet(user.id)).user.points, 1000);
  await assert.rejects(
    () => service.requestWithdrawal(user.id, { points: 5000, method: "1voucher", phone: "0825550101" }),
    /already/i,
  );
  await assert.rejects(
    () => service.adminReview(admin.id, withdrawal.id, "pay", {}),
    /PIN/i,
  );
  const rejected = await service.adminReview(admin.id, withdrawal.id, "reject", { reason: "Number does not match the account holder" });
  assert.equal(rejected.status, "REJECTED");
  assert.equal((await service.wallet(user.id)).user.points, 6000);

  const bank = await service.requestWithdrawal(user.id, {
    points: 5000,
    method: "bank",
    accountHolder: "Sipho Ndebele",
    bankName: "Capitec",
    accountNumber: "1234567890",
    branchCode: "470010",
    accountType: "savings",
  });
  await assert.rejects(() => service.adminReview(admin.id, bank.id, "pay", { voucherPin: "1234567890123456" }), /reference/i);
  const paid = await service.adminReview(admin.id, bank.id, "pay", { paymentReference: "CAP-100200" });
  assert.equal(paid.status, "PAID");
  assert.equal(paid.paymentReference, "CAP-100200");
  assert.equal((await service.wallet(user.id)).user.points, 1000);
  const notes = await service.listNotifications(user.id);
  assert.ok(notes.some((note) => note.body.includes("CAP-100200")));
});

test("payouts pause when they would exceed estimated ad revenue", async () => {
  const { service } = harness(true);
  const admin = await adminOf(service);
  const user = await service.signup({
    email: "aisha@earnza.local",
    password: "EarnZA-user-demo",
    displayName: "Aisha Patel",
    device: device("device-p-0001"),
    ip: "10.0.0.17",
  });
  await service.adminAdjust(admin.id, user.id, 8000, "Manual goodwill credit");
  await assert.rejects(
    () => service.requestWithdrawal(user.id, { points: 5000, method: "1voucher", phone: "0835550199" }),
    /exceed estimated ad revenue/,
  );
});

test("blocked users cannot earn and a non-admin cannot open the portal", async () => {
  const { service } = harness(true);
  const admin = await adminOf(service);
  const user = await service.signup({
    email: "aisha@earnza.local",
    password: "EarnZA-user-demo",
    displayName: "Aisha Patel",
    device: device("device-p-0002"),
    ip: "10.0.0.18",
  });
  await service.adminBlock(admin.id, user.id, true, "Suspicious referrals");
  await assert.rejects(() => service.prepareAd(user.id), /cannot watch/i);
  await assert.rejects(() => service.adminDashboard(user.id), /Admin/);
});

test("check-in, password reset, account deletion, and point conservation", async () => {
  const { service } = harness(true);
  const user = await service.signup({
    email: "lauren@earnza.local",
    password: "EarnZA-user-demo",
    displayName: "Lauren Evans",
    device: device("device-l-0001"),
    ip: "10.0.0.19",
  });
  const check = await service.checkIn(user.id);
  assert.equal(check.points, 10);
  await assert.rejects(() => service.checkIn(user.id), /already/i);
  const forgot = await service.forgotPassword("lauren@earnza.local", "10.0.0.20");
  assert.ok(forgot.resetToken);
  await service.resetPassword(forgot.resetToken!, "new-password-1");
  await service.login({
    email: "lauren@earnza.local",
    password: "new-password-1",
    device: device("device-l-0001"),
    ip: "10.0.0.21",
  });
  await service.deleteAccount(user.id);
  await assert.rejects(
    () =>
      service.login({
        email: "lauren@earnza.local",
        password: "new-password-1",
        device: device("device-l-0001"),
        ip: "10.0.0.22",
      }),
    /incorrect/,
  );
  assert.deepEqual(await service.audit(), []);
});

test("seeded demo data balances and the HTTP API never trusts client points", async () => {
  const { service } = harness(true);
  await seedDemo(service);
  const dash = await service.adminDashboard((await service.login({
    email: "mehedi@earnza.local",
    password: "EarnZA-admin-demo",
    device: device("admin-portal", { platform: "web" }),
    ip: "10.8.0.1",
  })).id);
  assert.equal(dash.revenueCoversLiability, true);
  assert.ok(dash.estimatedRevenueZar > dash.owedZar);
  assert.ok(dash.pendingZar > 0);
  assert.ok(dash.totalUsers >= 6);

  const keys = testKeys();
  const app = createApp(service, {
    authMode: "local",
    jwtSecret: "test-secret",
    tokenTtlSeconds: 3600,
    loadSsvKeys: async () => keys.publicKeys,
  });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    const login = await api(port, "/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: "thabo@earnza.local",
        password: "EarnZA-user-demo",
        device: device("device-http-0001"),
        points: 999999,
      }),
    });
    assert.equal(login.status, 200);
    assert.equal(JSON.stringify(login.body).includes("passwordHash"), false);
    assert.equal(JSON.stringify(login.body).includes("scrypt"), false);
    const token = login.body.token as string;
    const before = login.body.user.points as number;
    const prepared = await api(port, "/v1/ads/prepare", { method: "POST", token });
    const done = await api(port, "/v1/ads/demo-complete", {
      method: "POST",
      token,
      body: JSON.stringify({ sessionId: prepared.body.sessionId, points: 999999, reward_amount: 999999 }),
    });
    assert.equal(done.status, 200);
    assert.equal(done.body.user.points, before + 5);

    const raw = signQuery(
      keys.privateKey,
      ssvParams(String(prepared.body.sessionId), String(login.body.user.id), "tx-http", 999999),
    );
    const ssv = await api(port, `/v1/admob/ssv?${raw}`);
    assert.equal(ssv.status, 409);

    const outsider = await api(port, "/v1/admin/dashboard", { token });
    assert.equal(outsider.status, 403);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test("clear-cut cheating is blocked and borderline activity is only flagged", async () => {
  const { service } = harness(false);
  const admin = await adminOf(service);
  await service.adminUpdateSettings(admin.id, {
    cooldownSeconds: 10,
    minSecondsBetweenAds: 30,
    flagAdsPerHour: 2,
    blockAdsPerHour: 4,
    dailyAdCap: 20,
    minPayoutPoints: 5,
    flagInvalidSsvCount: 1,
    blockInvalidSsvCount: 3,
  });
  const keys = testKeys();
  let clock = Date.now();
  service.nowMs = () => clock;

  const owner = await service.signup({
    email: "sipho@earnza.local",
    password: "EarnZA-user-demo",
    displayName: "Sipho Ndebele",
    device: device("device-shared-0001"),
    ip: "10.2.0.2",
  });
  await service.grantHistoricalAds(owner.id, 2);
  const withdrawal = await service.requestWithdrawal(owner.id, { points: 5, method: "1voucher", phone: "0825550199" });
  await assert.rejects(
    () =>
      service.signup({
        email: "copy@earnza.local",
        password: "EarnZA-user-demo",
        displayName: "Copy Cat",
        device: device("device-shared-0001"),
        ip: "10.2.0.3",
      }),
    /already has an account/,
  );
  const blockedOwner = await service.adminGetUser(admin.id, owner.id);
  assert.equal(blockedOwner.user.blocked, true);
  assert.match(blockedOwner.user.blockReason ?? "", /another account/i);
  assert.equal(blockedOwner.withdrawals[0]?.status, "FROZEN");
  assert.match(blockedOwner.withdrawals[0]?.frozenReason ?? "", /another account/i);
  await assert.rejects(() => service.adminReview(admin.id, withdrawal.id, "pay", { voucherPin: "ABCD1234" }), /frozen/i);
  const unblocked = await service.adminBlock(admin.id, owner.id, false, "");
  assert.equal(unblocked.blocked, false);
  assert.match((unblocked.blockHistory ?? []).join(" "), /another account/i);
  const released = await service.adminListWithdrawals(admin.id, "PENDING");
  assert.equal(released.some((item) => item.id === withdrawal.id), true);

  const emulator = await service.signup({
    email: "emu@earnza.local",
    password: "EarnZA-user-demo",
    displayName: "Emulator User",
    device: device("device-emu-0002", { isEmulator: true }),
    ip: "10.2.0.4",
  });
  assert.equal(emulator.blocked, true);
  assert.match(emulator.blockReason ?? "", /emulator/i);

  const rooted = await service.signup({
    email: "root@earnza.local",
    password: "EarnZA-user-demo",
    displayName: "Rooted User",
    device: device("device-root-0001", { isRooted: true }),
    ip: "10.2.0.5",
  });
  assert.equal(rooted.blocked, true);
  assert.match(rooted.blockReason ?? "", /rooted/i);

  await service.adminUpdateSettings(admin.id, { autoBlockEmulators: false });
  const flagged = await service.signup({
    email: "soft@earnza.local",
    password: "EarnZA-user-demo",
    displayName: "Soft Flag",
    device: device("device-emu-0003", { isEmulator: true }),
    ip: "10.2.0.6",
  });
  assert.equal(flagged.blocked, false);
  assert.equal(flagged.suspicious, true);
  assert.match(flagged.suspiciousReasons.join(" "), /emulator/i);

  await service.adminUpdateSettings(admin.id, { autoBlockEmulators: true });
  const watcher = await service.signup({
    email: "watch@earnza.local",
    password: "EarnZA-user-demo",
    displayName: "Watcher",
    device: device("device-watch-0001"),
    ip: "10.2.0.7",
  });
  const first = await service.prepareAd(watcher.id);
  await service.creditSsv(signQuery(keys.privateKey, ssvParams(first.sessionId, watcher.id, "tx-pace-1", 1)), keys.publicKeys);
  clock += 20_000;
  const second = await service.prepareAd(watcher.id);
  await assert.rejects(
    () => service.creditSsv(signQuery(keys.privateKey, ssvParams(second.sessionId, watcher.id, "tx-pace-2", 1)), keys.publicKeys),
    /apart|blocked/i,
  );
  const afterPace = await service.getSelf(watcher.id);
  assert.equal(afterPace.blocked, true);
  assert.equal(afterPace.points, 5);

  await service.adminUpdateSettings(admin.id, { minSecondsBetweenAds: 5, flagAdsPerHour: 1, blockAdsPerHour: 4 });
  const steady = await service.signup({
    email: "steady@earnza.local",
    password: "EarnZA-user-demo",
    displayName: "Steady",
    device: device("device-steady-0001"),
    ip: "10.2.0.8",
  });
  clock += 20_000;
  const steadyFirst = await service.prepareAd(steady.id);
  await service.creditSsv(signQuery(keys.privateKey, ssvParams(steadyFirst.sessionId, steady.id, "tx-steady-1", 1)), keys.publicKeys);
  clock += 20_000;
  const steadySecond = await service.prepareAd(steady.id);
  await service.creditSsv(signQuery(keys.privateKey, ssvParams(steadySecond.sessionId, steady.id, "tx-steady-2", 1)), keys.publicKeys);
  const steadyUser = await service.getSelf(steady.id);
  assert.equal(steadyUser.blocked, false);
  assert.equal(steadyUser.suspicious, true);
  assert.match(steadyUser.suspiciousReasons.join(" "), /review/i);
  assert.equal(steadyUser.points, 10);

  const claimant = await service.signup({
    email: "claim@earnza.local",
    password: "EarnZA-user-demo",
    displayName: "Claimant",
    device: device("device-claim-0001"),
    ip: "10.2.0.9",
  });
  clock += 20_000;
  const session = await service.prepareAd(claimant.id);
  const bad = signQuery(keys.privateKey, ssvParams(session.sessionId, claimant.id, "tx-bad", 1)).replace("reward_amount=1", "reward_amount=9");
  await assert.rejects(() => service.creditSsv(bad, keys.publicKeys), /signature/i);
  const once = await service.getSelf(claimant.id);
  assert.equal(once.blocked, false);
  assert.equal(once.suspicious, true);
  await assert.rejects(() => service.creditSsv(bad, keys.publicKeys), /signature/i);
  await assert.rejects(() => service.creditSsv(bad, keys.publicKeys), /signature/i);
  const thrice = await service.getSelf(claimant.id);
  assert.equal(thrice.blocked, true);
  assert.match(thrice.blockReason ?? "", /AdMob/i);
  assert.equal(thrice.points, 0);

  const cheat = await service.signup({
    email: "cheat@earnza.local",
    password: "EarnZA-user-demo",
    displayName: "Cheat",
    device: device("device-cheat-0001"),
    ip: "10.2.0.10",
  });
  clock += 20_000;
  const demoSession = await service.prepareAd(cheat.id);
  await assert.rejects(() => service.completeDemoAd(cheat.id, demoSession.sessionId), /AdMob|blocked/i);
  assert.equal((await service.getSelf(cheat.id)).blocked, true);

  await assert.rejects(() => service.adminUpdateSettings(admin.id, { flagAdsPerHour: 10, blockAdsPerHour: 4 }), /auto-block/i);
  assert.deepEqual(await service.audit(), []);
});

test("SSV content drops the signature but keeps parameter order", () => {
  const raw = "ad_network=x&custom_data=abc&reward_amount=999&transaction_id=1&user_id=u&signature=abc&key_id=1";
  assert.equal(contentToVerify(raw), "ad_network=x&custom_data=abc&reward_amount=999&transaction_id=1&user_id=u");
});

function testKeys(): { privateKey: crypto.KeyObject; publicKeys: VerifierKey[] } {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return {
    privateKey,
    publicKeys: [{ keyId: 1, pem: publicKey.export({ type: "spki", format: "pem" }).toString() }],
  };
}

function ssvParams(customData: string, userId: string, transactionId: string, rewardAmount: number): string {
  return `ad_network=test&ad_unit=ca-app-pub-3940256099942544/5224354917&custom_data=${customData}&reward_amount=${rewardAmount}&reward_item=points&timestamp=1710000000&transaction_id=${transactionId}&user_id=${userId}`;
}

function signQuery(privateKey: crypto.KeyObject, payload: string): string {
  const signature = crypto.sign("sha256", Buffer.from(payload), privateKey).toString("base64url");
  return `${payload}&signature=${signature}&key_id=1`;
}

async function api(port: number, path: string, init: { method?: string; body?: string; token?: string } = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: init.method ?? "GET",
    headers: {
      "content-type": "application/json",
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
    },
    body: init.body,
  });
  const body = (await response.json()) as Record<string, any>;
  return { status: response.status, body };
}

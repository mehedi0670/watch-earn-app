import type { DeviceInput } from "./types";
import type { EarnService } from "./service";
import { ApiError } from "./util";

const USER_PASSWORD = "EarnZA-user-demo";

function device(id: string, extra: Partial<DeviceInput> = {}): DeviceInput {
  return {
    deviceId: id,
    isEmulator: false,
    isRooted: false,
    model: "Demo Android",
    platform: "android",
    ...extra,
  };
}

export async function seedDemo(service: EarnService): Promise<void> {
  await service.signup({
    email: "mehedi@earnza.local",
    password: "EarnZA-admin-demo",
    displayName: "Mehedi",
    device: null,
    ip: "10.1.0.1",
    role: "admin",
  });

  const thabo = await service.signup({
    email: "thabo@earnza.local",
    password: USER_PASSWORD,
    displayName: "Thabo Mokoena",
    device: device("device-thabo-0001", { model: "Samsung Galaxy A15" }),
    ip: "10.1.0.2",
  });
  const naledi = await service.signup({
    email: "naledi@earnza.local",
    password: USER_PASSWORD,
    displayName: "Naledi Dlamini",
    device: device("device-naledi-0001", { model: "Samsung Galaxy A54" }),
    referralCode: thabo.referralCode,
    ip: "10.1.0.3",
  });
  const johan = await service.signup({
    email: "johan@earnza.local",
    password: USER_PASSWORD,
    displayName: "Johan Botha",
    device: device("device-johan-emulator", { isEmulator: true, model: "sdk_gphone64" }),
    ip: "10.1.0.4",
  });
  const aisha = await service.signup({
    email: "aisha@earnza.local",
    password: USER_PASSWORD,
    displayName: "Aisha Patel",
    device: device("device-aisha-0001", { model: "Huawei P30" }),
    ip: "10.1.0.5",
  });
  const sipho = await service.signup({
    email: "sipho@earnza.local",
    password: USER_PASSWORD,
    displayName: "Sipho Ndebele",
    device: device("device-sipho-0001", { model: "Tecno Spark 10" }),
    ip: "10.1.0.6",
  });
  const lauren = await service.signup({
    email: "lauren@earnza.local",
    password: USER_PASSWORD,
    displayName: "Lauren Evans",
    device: device("device-lauren-0001", { model: "Pixel 7a" }),
    ip: "10.1.0.7",
  });
  const pieter = await service.signup({
    email: "pieter@earnza.local",
    password: USER_PASSWORD,
    displayName: "Pieter Naidoo",
    device: device("device-pieter-0001", { model: "Samsung Galaxy A05" }),
    ip: "10.1.0.8",
  });

  const admin = await service.login({
    email: "mehedi@earnza.local",
    password: "EarnZA-admin-demo",
    device: device("admin-portal", { model: "Admin portal", platform: "web" }),
    ip: "10.1.0.1",
  });

  await service.grantHistoricalAds(thabo.id, 1600);
  await service.grantHistoricalAds(naledi.id, 400);
  await service.grantHistoricalAds(johan.id, 100);
  await service.grantHistoricalAds(aisha.id, 80);
  await service.grantHistoricalAds(sipho.id, 1300);
  await service.grantHistoricalAds(lauren.id, 1200);
  await service.grantHistoricalAds(pieter.id, 1200);

  await service.requestWithdrawal(sipho.id, {
    points: 5000,
    method: "1voucher",
    phone: "0825550101",
  });
  await service.requestWithdrawal(lauren.id, {
    points: 5000,
    method: "bank",
    accountHolder: "Lauren Evans",
    bankName: "Standard Bank",
    accountNumber: "1002003004",
    branchCode: "051001",
    accountType: "savings",
  });
  await service.requestWithdrawal(pieter.id, {
    points: 5000,
    method: "1voucher",
    phone: "0825550102",
  });
  try {
    await service.signup({
      email: "copy@earnza.local",
      password: USER_PASSWORD,
      displayName: "Second Account",
      device: device("device-pieter-0001"),
      ip: "10.1.0.9",
    });
    throw new Error("A second account on Pieter's device should have been rejected.");
  } catch (err) {
    if (!(err instanceof ApiError) || err.code !== "DEVICE_TAKEN") throw err;
  }
  await service.adminBlock(admin.id, aisha.id, true, "Chargeback pattern on an earlier payout");
  // Johan was already blocked at signup, while these switches were on.
  // The demo turns them off afterwards so the emulator build can still watch an ad.
  await service.adminUpdateSettings(admin.id, { autoBlockEmulators: false, autoBlockRooted: false });

  const problems = await service.audit();
  if (problems.length) throw new Error(`Seed failed conservation check: ${problems.join("; ")}`);
}

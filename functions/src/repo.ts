import fs from "fs";
import path from "path";
import type {
  AdSession,
  AppNotification,
  LedgerEntry,
  RateRow,
  ResetToken,
  Settings,
  Stats,
  User,
  Withdrawal,
} from "./types";
import { DEFAULT_SETTINGS, emptyStats } from "./util";

export interface Tx {
  getSettings(): Promise<Settings>;
  saveSettings(s: Settings): Promise<void>;
  getStats(): Promise<Stats>;
  saveStats(s: Stats): Promise<void>;
  getUser(id: string): Promise<User | null>;
  saveUser(u: User): Promise<void>;
  getEmailOwner(email: string): Promise<string | null>;
  saveEmailOwner(email: string, uid: string): Promise<void>;
  deleteEmailOwner(email: string): Promise<void>;
  getReferralOwner(code: string): Promise<string | null>;
  saveReferralOwner(code: string, uid: string): Promise<void>;
  getDeviceOwner(deviceId: string): Promise<string | null>;
  saveDeviceOwner(deviceId: string, uid: string): Promise<void>;
  deleteDevice(deviceId: string): Promise<void>;
  getSession(id: string): Promise<AdSession | null>;
  saveSession(s: AdSession): Promise<void>;
  hasProcessed(transactionId: string): Promise<boolean>;
  saveProcessed(transactionId: string, uid: string): Promise<void>;
  getWithdrawal(id: string): Promise<Withdrawal | null>;
  saveWithdrawal(w: Withdrawal): Promise<void>;
  addLedger(e: LedgerEntry): Promise<void>;
  addNotification(n: AppNotification): Promise<void>;
  getNotification(id: string): Promise<AppNotification | null>;
  saveNotification(n: AppNotification): Promise<void>;
  getReset(hash: string): Promise<ResetToken | null>;
  saveReset(r: ResetToken): Promise<void>;
  getIpCount(key: string): Promise<number>;
  saveIpCount(key: string, count: number): Promise<void>;
  getRate(key: string): Promise<RateRow | null>;
  saveRate(key: string, row: RateRow): Promise<void>;
}

export interface Repo {
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  getUserByEmail(email: string): Promise<User | null>;
  getUserById(id: string): Promise<User | null>;
  listUsers(): Promise<User[]>;
  listWithdrawals(filter?: { uid?: string; status?: string }): Promise<Withdrawal[]>;
  listLedger(uid: string, limit: number): Promise<LedgerEntry[]>;
  listRecentLedger(limit: number): Promise<LedgerEntry[]>;
  listNotifications(uid: string): Promise<AppNotification[]>;
  userCount(): Promise<number>;
}

export type DB = {
  settings: Settings;
  stats: Stats;
  users: Record<string, User>;
  emailIndex: Record<string, string>;
  referralCodes: Record<string, string>;
  devices: Record<string, string>;
  sessions: Record<string, AdSession>;
  processedTx: Record<string, string>;
  ledger: LedgerEntry[];
  withdrawals: Record<string, Withdrawal>;
  notifications: AppNotification[];
  resets: Record<string, ResetToken>;
  ipSignups: Record<string, number>;
  rate: Record<string, RateRow>;
};

export function emptyDb(): DB {
  return {
    settings: { ...DEFAULT_SETTINGS },
    stats: emptyStats(),
    users: {},
    emailIndex: {},
    referralCodes: {},
    devices: {},
    sessions: {},
    processedTx: {},
    ledger: [],
    withdrawals: {},
    notifications: [],
    resets: {},
    ipSignups: {},
    rate: {},
  };
}

class MemoryTx implements Tx {
  constructor(private db: DB) {}

  async getSettings() {
    return structuredClone(this.db.settings);
  }
  async saveSettings(s: Settings) {
    this.db.settings = structuredClone(s);
  }
  async getStats() {
    return structuredClone(this.db.stats);
  }
  async saveStats(s: Stats) {
    this.db.stats = structuredClone(s);
  }
  async getUser(id: string) {
    return this.db.users[id] ? structuredClone(this.db.users[id]) : null;
  }
  async saveUser(u: User) {
    this.db.users[u.id] = structuredClone(u);
  }
  async getEmailOwner(email: string) {
    return this.db.emailIndex[email] ?? null;
  }
  async saveEmailOwner(email: string, uid: string) {
    this.db.emailIndex[email] = uid;
  }
  async deleteEmailOwner(email: string) {
    delete this.db.emailIndex[email];
  }
  async getReferralOwner(code: string) {
    return this.db.referralCodes[code] ?? null;
  }
  async saveReferralOwner(code: string, uid: string) {
    this.db.referralCodes[code] = uid;
  }
  async getDeviceOwner(deviceId: string) {
    return this.db.devices[deviceId] ?? null;
  }
  async saveDeviceOwner(deviceId: string, uid: string) {
    this.db.devices[deviceId] = uid;
  }
  async deleteDevice(deviceId: string) {
    delete this.db.devices[deviceId];
  }
  async getSession(id: string) {
    return this.db.sessions[id] ? structuredClone(this.db.sessions[id]) : null;
  }
  async saveSession(s: AdSession) {
    this.db.sessions[s.id] = structuredClone(s);
  }
  async hasProcessed(transactionId: string) {
    return Boolean(this.db.processedTx[transactionId]);
  }
  async saveProcessed(transactionId: string, uid: string) {
    this.db.processedTx[transactionId] = uid;
  }
  async getWithdrawal(id: string) {
    return this.db.withdrawals[id] ? structuredClone(this.db.withdrawals[id]) : null;
  }
  async saveWithdrawal(w: Withdrawal) {
    this.db.withdrawals[w.id] = structuredClone(w);
  }
  async addLedger(e: LedgerEntry) {
    this.db.ledger.push(structuredClone(e));
  }
  async addNotification(n: AppNotification) {
    this.db.notifications.push(structuredClone(n));
  }
  async getNotification(id: string) {
    const found = this.db.notifications.find((item) => item.id === id);
    return found ? structuredClone(found) : null;
  }
  async saveNotification(n: AppNotification) {
    const index = this.db.notifications.findIndex((item) => item.id === n.id);
    if (index >= 0) this.db.notifications[index] = structuredClone(n);
  }
  async getReset(hash: string) {
    return this.db.resets[hash] ? structuredClone(this.db.resets[hash]) : null;
  }
  async saveReset(r: ResetToken) {
    this.db.resets[r.tokenHash] = structuredClone(r);
  }
  async getIpCount(key: string) {
    return this.db.ipSignups[key] ?? 0;
  }
  async saveIpCount(key: string, count: number) {
    this.db.ipSignups[key] = count;
  }
  async getRate(key: string) {
    return this.db.rate[key] ? structuredClone(this.db.rate[key]) : null;
  }
  async saveRate(key: string, row: RateRow) {
    this.db.rate[key] = structuredClone(row);
  }
}

export class MemoryRepo implements Repo {
  private db: DB = emptyDb();
  private queue: Promise<void> = Promise.resolve();

  constructor(private persistPath: string | null = null) {}

  async init(): Promise<void> {
    if (!this.persistPath || !fs.existsSync(this.persistPath)) return;
    const parsed = JSON.parse(fs.readFileSync(this.persistPath, "utf8")) as DB;
    this.db = { ...emptyDb(), ...parsed };
  }

  private async persist(): Promise<void> {
    if (!this.persistPath) return;
    fs.mkdirSync(path.dirname(this.persistPath), { recursive: true });
    const tmp = `${this.persistPath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.db));
    fs.renameSync(tmp, this.persistPath);
  }

  async transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const snapshot = structuredClone(this.db);
      const result = await fn(new MemoryTx(snapshot));
      this.db = snapshot;
      await this.persist();
      return result;
    });
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async getUserByEmail(email: string) {
    const id = this.db.emailIndex[email.toLowerCase()];
    return id && this.db.users[id] ? structuredClone(this.db.users[id]) : null;
  }

  async getUserById(id: string) {
    return this.db.users[id] ? structuredClone(this.db.users[id]) : null;
  }

  async listUsers() {
    return Object.values(this.db.users)
      .map((user) => structuredClone(user))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listWithdrawals(filter?: { uid?: string; status?: string }) {
    return Object.values(this.db.withdrawals)
      .filter((item) => (filter?.uid ? item.uid === filter.uid : true))
      .filter((item) => (filter?.status ? item.status === filter.status : true))
      .map((item) => structuredClone(item))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listLedger(uid: string, limit: number) {
    return this.db.ledger
      .filter((item) => item.uid === uid)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map((item) => structuredClone(item));
  }

  async listRecentLedger(limit: number) {
    return [...this.db.ledger]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map((item) => structuredClone(item));
  }

  async listNotifications(uid: string) {
    return this.db.notifications
      .filter((item) => item.uid === uid)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 50)
      .map((item) => structuredClone(item));
  }

  async userCount() {
    return Object.keys(this.db.users).length;
  }
}

import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore, type Query, type Transaction } from "firebase-admin/firestore";
import type { Repo, Tx } from "./repo";
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

function db(): Firestore {
  if (getApps().length === 0) initializeApp();
  return getFirestore();
}

class FirestoreTx implements Tx {
  constructor(
    private fs: Firestore,
    private t: Transaction,
  ) {}

  private async read<T>(path: string): Promise<T | null> {
    const snap = await this.t.get(this.fs.doc(path));
    return snap.exists ? (snap.data() as T) : null;
  }

  async getSettings() {
    const data = await this.read<Settings>("meta/settings");
    return { ...DEFAULT_SETTINGS, ...(data ?? {}) };
  }
  async saveSettings(s: Settings) {
    this.t.set(this.fs.doc("meta/settings"), s);
  }
  async getStats() {
    const data = await this.read<Stats>("meta/stats");
    return { ...emptyStats(), ...(data ?? {}) };
  }
  async saveStats(s: Stats) {
    this.t.set(this.fs.doc("meta/stats"), s);
  }
  async getUser(id: string) {
    return this.read<User>(`users/${id}`);
  }
  async saveUser(u: User) {
    this.t.set(this.fs.doc(`users/${u.id}`), u);
  }
  async getEmailOwner(email: string) {
    const row = await this.read<{ uid: string }>(`emailIndex/${email}`);
    return row?.uid ?? null;
  }
  async saveEmailOwner(email: string, uid: string) {
    this.t.set(this.fs.doc(`emailIndex/${email}`), { uid });
  }
  async deleteEmailOwner(email: string) {
    this.t.delete(this.fs.doc(`emailIndex/${email}`));
  }
  async getReferralOwner(code: string) {
    const row = await this.read<{ uid: string }>(`referralCodes/${code}`);
    return row?.uid ?? null;
  }
  async saveReferralOwner(code: string, uid: string) {
    this.t.set(this.fs.doc(`referralCodes/${code}`), { uid });
  }
  async getDeviceOwner(deviceId: string) {
    const row = await this.read<{ uid: string }>(`devices/${deviceId}`);
    return row?.uid ?? null;
  }
  async saveDeviceOwner(deviceId: string, uid: string) {
    this.t.set(this.fs.doc(`devices/${deviceId}`), { uid });
  }
  async deleteDevice(deviceId: string) {
    this.t.delete(this.fs.doc(`devices/${deviceId}`));
  }
  async getSession(id: string) {
    return this.read<AdSession>(`adSessions/${id}`);
  }
  async saveSession(s: AdSession) {
    this.t.set(this.fs.doc(`adSessions/${s.id}`), s);
  }
  async hasProcessed(transactionId: string) {
    const row = await this.read<{ uid: string }>(`processedTx/${transactionId}`);
    return Boolean(row);
  }
  async saveProcessed(transactionId: string, uid: string) {
    this.t.set(this.fs.doc(`processedTx/${transactionId}`), { uid });
  }
  async getWithdrawal(id: string) {
    return this.read<Withdrawal>(`withdrawals/${id}`);
  }
  async saveWithdrawal(w: Withdrawal) {
    this.t.set(this.fs.doc(`withdrawals/${w.id}`), w);
  }
  async addLedger(e: LedgerEntry) {
    this.t.set(this.fs.doc(`ledger/${e.id}`), e);
  }
  async addNotification(n: AppNotification) {
    this.t.set(this.fs.doc(`notifications/${n.id}`), n);
  }
  async getNotification(id: string) {
    return this.read<AppNotification>(`notifications/${id}`);
  }
  async saveNotification(n: AppNotification) {
    this.t.set(this.fs.doc(`notifications/${n.id}`), n);
  }
  async getReset(hash: string) {
    return this.read<ResetToken>(`resets/${hash}`);
  }
  async saveReset(r: ResetToken) {
    this.t.set(this.fs.doc(`resets/${r.tokenHash}`), r);
  }
  async getIpCount(key: string) {
    const row = await this.read<{ count: number }>(`ipSignups/${encodeURIComponent(key)}`);
    return row?.count ?? 0;
  }
  async saveIpCount(key: string, count: number) {
    this.t.set(this.fs.doc(`ipSignups/${encodeURIComponent(key)}`), { count });
  }
  async getRate(key: string) {
    return this.read<RateRow>(`rateLimits/${encodeURIComponent(key)}`);
  }
  async saveRate(key: string, row: RateRow) {
    this.t.set(this.fs.doc(`rateLimits/${encodeURIComponent(key)}`), row);
  }
}

export class FirestoreRepo implements Repo {
  private fs: Firestore;

  constructor() {
    this.fs = db();
  }

  async transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.fs.runTransaction(async (t) => fn(new FirestoreTx(this.fs, t)));
  }

  async getUserByEmail(email: string) {
    const index = await this.fs.doc(`emailIndex/${email.toLowerCase()}`).get();
    if (!index.exists) return null;
    return this.getUserById(String(index.get("uid")));
  }

  async getUserById(id: string) {
    const snap = await this.fs.doc(`users/${id}`).get();
    return snap.exists ? (snap.data() as User) : null;
  }

  async listUsers() {
    const snap = await this.fs.collection("users").get();
    return snap.docs
      .map((doc) => doc.data() as User)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listWithdrawals(filter?: { uid?: string; status?: string }) {
    let query: Query = this.fs.collection("withdrawals");
    if (filter?.uid) query = query.where("uid", "==", filter.uid);
    else if (filter?.status) query = query.where("status", "==", filter.status);
    const snap = await query.get();
    return snap.docs
      .map((doc) => doc.data() as Withdrawal)
      .filter((item) => (filter?.uid && filter.status ? item.status === filter.status : true))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listLedger(uid: string, limit: number) {
    const snap = await this.fs.collection("ledger").where("uid", "==", uid).get();
    return snap.docs
      .map((doc) => doc.data() as LedgerEntry)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async listRecentLedger(limit: number) {
    const snap = await this.fs.collection("ledger").orderBy("createdAt", "desc").limit(limit).get();
    return snap.docs.map((doc) => doc.data() as LedgerEntry);
  }

  async listNotifications(uid: string) {
    const snap = await this.fs.collection("notifications").where("uid", "==", uid).get();
    return snap.docs
      .map((doc) => doc.data() as AppNotification)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 50);
  }

  async userCount() {
    const snap = await this.fs.collection("users").count().get();
    return snap.data().count;
  }
}

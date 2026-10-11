import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ApiError, api, login } from "./api";

type User = {
  id: string;
  email: string;
  displayName: string;
  role: string;
  points: number;
  adsWatched: number;
  blocked: boolean;
  blockReason: string | null;
  suspicious: boolean;
  suspiciousReasons: string[];
  isEmulator: boolean;
  isRooted: boolean;
  referralCode: string;
  referralCount: number;
  deviceModel: string;
  createdAt: string;
  deleted: boolean;
};

type Withdrawal = {
  id: string;
  uid: string;
  userEmail: string;
  displayName: string;
  points: number;
  zarAmount: number;
  method: "1voucher" | "bank";
  status: "PENDING" | "APPROVED" | "REJECTED" | "PAID";
  phone: string | null;
  accountHolder: string | null;
  bankName: string | null;
  accountNumber: string | null;
  branchCode: string | null;
  accountType: string | null;
  voucherPin: string | null;
  paymentReference: string | null;
  rejectionReason: string | null;
  createdAt: string;
};

type Settings = {
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
};

type Dashboard = {
  totalUsers: number;
  signupsToday: number;
  adsWatchedTotal: number;
  adsWatchedToday: number;
  outstandingZar: number;
  pendingZar: number;
  paidOutZar: number;
  owedZar: number;
  estimatedRevenueZar: number;
  lifetimeCommitmentZar: number;
  headroomZar: number;
  payoutHeadroomZar: number;
  revenueCoversLiability: boolean;
  pointsPerZar: number;
  estimatedEcpmZar: number;
  recentSignups: User[];
  recentWithdrawals: Withdrawal[];
};

const TOKEN_KEY = "earnza_admin_token";
const zar = new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" });
const num = new Intl.NumberFormat("en-ZA");

function money(value: number) {
  return zar.format(value);
}

export function App() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [page, setPage] = useState("dashboard");
  const [error, setError] = useState("");

  const signOut = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
  }, []);

  if (!token) return <Login onToken={(value) => { localStorage.setItem(TOKEN_KEY, value); setToken(value); }} />;

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          <div className="mark">R</div>
          <div>
            <strong>EarnZA</strong>
            <span>Owner portal</span>
          </div>
        </div>
        {[
          ["dashboard", "Dashboard"],
          ["users", "Users"],
          ["withdrawals", "Cash outs"],
          ["settings", "Settings"],
        ].map(([id, label]) => (
          <button key={id} className={page === id ? "active" : ""} onClick={() => { setPage(id); setError(""); }}>
            {label}
          </button>
        ))}
        <button className="logout" onClick={signOut}>Sign out</button>
      </aside>
      <main className="main">
        {error && <div className="error">{error}</div>}
        {page === "dashboard" && <DashboardPage token={token} onAuth={signOut} onError={setError} />}
        {page === "users" && <UsersPage token={token} onAuth={signOut} onError={setError} />}
        {page === "withdrawals" && <WithdrawalsPage token={token} onAuth={signOut} onError={setError} />}
        {page === "settings" && <SettingsPage token={token} onAuth={signOut} onError={setError} />}
      </main>
    </div>
  );
}

function Login({ onToken }: { onToken: (token: string) => void }) {
  const [email, setEmail] = useState("mehedi@earnza.local");
  const [password, setPassword] = useState("EarnZA-admin-demo");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await login(email, password);
      if (result.user.role !== "admin") throw new ApiError("ADMIN", "This login is not an admin account.");
      onToken(result.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="mark">R</div>
        <h1>EarnZA</h1>
        <p className="sub">Review users, pay cash outs, and keep rewards inside ad revenue.</p>
        {error && <div className="error">{error}</div>}
        <label>Email</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
        <label>Password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        <div style={{ height: 16 }} />
        <button className="primary" type="submit" disabled={busy} style={{ width: "100%" }}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <div className="demo-box">
          Local demo: <strong>mehedi@earnza.local</strong> / <strong>EarnZA-admin-demo</strong>.
          Change this before anyone else can reach the server.
        </div>
      </form>
    </div>
  );
}

function useLoad<T>(token: string, path: string, onAuth: () => void, onError: (msg: string) => void) {
  const [data, setData] = useState<T | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    api<T>(path, { token })
      .then((value) => { if (!cancelled) setData(value); })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && (err.code === "AUTH" || err.code === "ADMIN")) onAuth();
        else onError(err instanceof Error ? err.message : "Could not load data.");
      });
    return () => { cancelled = true; };
  }, [token, path, tick, onAuth, onError]);
  return { data, reload: () => setTick((n) => n + 1) };
}

function DashboardPage({ token, onAuth, onError }: PageProps) {
  const { data } = useLoad<Dashboard>(token, "/v1/admin/dashboard", onAuth, onError);
  if (!data) return <p>Loading the books…</p>;
  const scale = Math.max(data.estimatedRevenueZar, data.lifetimeCommitmentZar, 1);
  return (
    <>
      <div className="top">
        <div>
          <h1>Today’s books</h1>
          <p>Points owed against the ad revenue you estimate. Nothing here moves money by itself.</p>
        </div>
      </div>
      <div className={data.revenueCoversLiability ? "banner ok" : "banner bad"}>
        {data.revenueCoversLiability
          ? `Estimated ad revenue covers outstanding balances and payouts, with ${money(data.headroomZar)} headroom.`
          : "Liability is above estimated ad revenue. Do not approve more cash outs until the numbers are honest."}
      </div>
      <div className="grid">
        <Stat k="Signups today" v={num.format(data.signupsToday)} s={`${num.format(data.totalUsers)} members`} />
        <Stat k="Ads watched today" v={num.format(data.adsWatchedToday)} s={`${num.format(data.adsWatchedTotal)} verified in total`} />
        <Stat k="Still owed" v={money(data.owedZar)} s={`${money(data.outstandingZar)} in wallets · ${money(data.pendingZar)} pending`} />
        <Stat k="Estimated ad revenue" v={money(data.estimatedRevenueZar)} s={`${money(data.estimatedEcpmZar)} recorded per verified ad`} />
      </div>
      <div className="card" style={{ marginTop: 14 }}>
        <div className="k">Revenue against what members could still be paid, plus what is already paid</div>
        <div className="bars">
          <Bar label="Ad revenue" value={data.estimatedRevenueZar} scale={scale} kind="rev" />
          <Bar label="Still owed" value={data.owedZar} scale={scale} kind="owed" />
          <Bar label="Already paid" value={data.paidOutZar} scale={scale} kind="paid" />
        </div>
        <p className="note">
          Safe payout room before estimated revenue is used up: {money(data.payoutHeadroomZar)}. Lifetime commitment
          (balances + pending + paid) is {money(data.lifetimeCommitmentZar)}. The eCPM is a number you type from the
          AdMob console. If you inflate it, this guardrail stops meaning anything.
        </p>
      </div>
      <div className="split">
        <div className="card">
          <h3>Recent members</h3>
          <UserTable users={data.recentSignups} />
        </div>
        <div className="card">
          <h3>Latest cash outs</h3>
          <WithdrawalTable rows={data.recentWithdrawals} />
        </div>
      </div>
    </>
  );
}

function UsersPage({ token, onAuth, onError }: PageProps) {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const { data, reload } = useLoad<{ users: User[] }>(token, `/v1/admin/users?q=${encodeURIComponent(query)}`, onAuth, onError);
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <>
      <div className="top">
        <div>
          <h1>Members</h1>
          <p>Balances, devices, and who is blocked from earning.</p>
        </div>
      </div>
      <div className="tools">
        <input placeholder="Search name, email, code" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="primary" onClick={() => setQuery(q)}>Search</button>
      </div>
      <div className="card">
        <UserTable users={data?.users ?? []} onOpen={setSelected} />
      </div>
      {selected && (
        <UserDrawer
          token={token}
          id={selected}
          onClose={() => setSelected(null)}
          onChanged={() => { setSelected(null); reload(); }}
          onAuth={onAuth}
          onError={onError}
        />
      )}
    </>
  );
}

function UserDrawer({ token, id, onClose, onChanged, onAuth, onError }: { token: string; id: string; onClose: () => void; onChanged: () => void; onAuth: () => void; onError: (m: string) => void }) {
  const { data } = useLoad<{ user: User }>(token, `/v1/admin/users/${id}`, onAuth, onError);
  const [reason, setReason] = useState("Blocked after a manual review");
  const [delta, setDelta] = useState("0");
  const [note, setNote] = useState("");
  const user = data?.user;
  async function run(path: string, body: unknown) {
    try {
      await api(path, { method: "POST", token, body });
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not update the user.");
    }
  }
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {!user ? <p>Loading…</p> : (
          <>
            <h3>{user.displayName}</h3>
            <p className="note">{user.email} · {num.format(user.points)} points · {user.adsWatched} ads · code {user.referralCode}</p>
            <p>{user.blocked && <span className="pill bad">Blocked</span>}{user.suspicious && <span className="pill warn">Flagged</span>}{user.isEmulator && <span className="pill warn">Emulator</span>}{user.isRooted && <span className="pill warn">Rooted</span>}</p>
            <label>Block reason</label>
            <input value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="row-actions" style={{ marginTop: 10 }}>
              <button className="danger" onClick={() => run(`/v1/admin/users/${id}/block`, { blocked: true, reason })}>Block</button>
              <button className="ghost" onClick={() => run(`/v1/admin/users/${id}/block`, { blocked: false, reason: "" })}>Unblock</button>
            </div>
            <label>Adjust points (negative removes)</label>
            <input value={delta} onChange={(e) => setDelta(e.target.value)} />
            <label>Note</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why this balance changed" />
            <div style={{ height: 10 }} />
            <button className="primary" onClick={() => run(`/v1/admin/users/${id}/adjust`, { pointsDelta: Number(delta), note })}>Save adjustment</button>
          </>
        )}
      </div>
    </div>
  );
}

function WithdrawalsPage({ token, onAuth, onError }: PageProps) {
  const [status, setStatus] = useState("PENDING");
  const path = status === "ALL" ? "/v1/admin/withdrawals" : `/v1/admin/withdrawals?status=${status}`;
  const { data, reload } = useLoad<{ withdrawals: Withdrawal[] }>(token, path, onAuth, onError);
  const [active, setActive] = useState<Withdrawal | null>(null);
  return (
    <>
      <div className="top">
        <div>
          <h1>Cash outs</h1>
          <p>Approve, reject, or record the 1Voucher PIN or bank reference after you pay outside the app.</p>
        </div>
      </div>
      <div className="tools">
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          {["PENDING", "APPROVED", "PAID", "REJECTED", "ALL"].map((item) => <option key={item}>{item}</option>)}
        </select>
      </div>
      <div className="card">
        <WithdrawalTable rows={data?.withdrawals ?? []} onOpen={setActive} />
      </div>
      {active && <ReviewModal token={token} row={active} onClose={() => setActive(null)} onDone={() => { setActive(null); reload(); }} onError={onError} />}
    </>
  );
}

function ReviewModal({ token, row, onClose, onDone, onError }: { token: string; row: Withdrawal; onClose: () => void; onDone: () => void; onError: (m: string) => void }) {
  const [pin, setPin] = useState("");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  async function act(action: "approve" | "reject" | "pay") {
    try {
      await api(`/v1/admin/withdrawals/${row.id}/review`, {
        method: "POST",
        token,
        body: { action, voucherPin: pin, paymentReference: reference, reason, note },
      });
      onDone();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not update the cash out.");
    }
  }
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{money(row.zarAmount)} · {row.method === "1voucher" ? "1Voucher" : "Bank transfer"}</h3>
        <p className="note">{row.displayName} · {row.userEmail} · {row.status}</p>
        {row.method === "1voucher" ? <p>Mobile {row.phone}</p> : (
          <p className="note">{row.accountHolder}<br />{row.bankName} · {row.accountType}<br />Account {row.accountNumber}<br />Branch {row.branchCode}</p>
        )}
        {row.method === "1voucher" ? (
          <>
            <label>1Voucher PIN</label>
            <input value={pin} onChange={(e) => setPin(e.target.value)} placeholder="Recorded when you mark it paid" />
          </>
        ) : (
          <>
            <label>Bank payment reference</label>
            <input value={reference} onChange={(e) => setReference(e.target.value)} />
          </>
        )}
        <label>Rejection reason</label>
        <input value={reason} onChange={(e) => setReason(e.target.value)} />
        <label>Internal note</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="row-actions" style={{ marginTop: 14 }}>
          <button className="ghost" onClick={() => act("approve")}>Approve</button>
          <button className="gold" onClick={() => act("pay")}>Mark paid</button>
          <button className="danger" onClick={() => act("reject")}>Reject and refund</button>
        </div>
      </div>
    </div>
  );
}

function SettingsPage({ token, onAuth, onError }: PageProps) {
  const { data, reload } = useLoad<{ settings: Settings }>(token, "/v1/admin/settings", onAuth, onError);
  const [form, setForm] = useState<Settings | null>(null);
  useEffect(() => { if (data?.settings) setForm(data.settings); }, [data]);
  if (!form) return <p>Loading settings…</p>;
  function set<K extends keyof Settings>(key: K, value: Settings[K]) {
    setForm({ ...form!, [key]: value });
  }
  async function save() {
    try {
      await api("/v1/admin/settings", { method: "PUT", token, body: form });
      reload();
      onError("");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not save settings.");
    }
  }
  return (
    <>
      <div className="top">
        <div>
          <h1>Reward rules</h1>
          <p>These numbers are what the server uses. The phone cannot override them.</p>
        </div>
        <button className="primary" onClick={save}>Save settings</button>
      </div>
      <div className="card settings">
        <Field label="Points per Rand" value={form.pointsPerZar} onChange={(v) => set("pointsPerZar", v)} />
        <Field label="Points per verified ad" value={form.pointsPerAd} onChange={(v) => set("pointsPerAd", v)} />
        <Field label="Daily watch cap" value={form.dailyAdCap} onChange={(v) => set("dailyAdCap", v)} />
        <Field label="Seconds between ads" value={form.cooldownSeconds} onChange={(v) => set("cooldownSeconds", v)} />
        <Field label="Minimum cash out (points)" value={form.minPayoutPoints} onChange={(v) => set("minPayoutPoints", v)} />
        <Field label="Daily check-in points" value={form.checkInBonusPoints} onChange={(v) => set("checkInBonusPoints", v)} />
        <Field label="Referral bonus (each side)" value={form.referralBonusPoints} onChange={(v) => set("referralBonusPoints", v)} />
        <Field label="Estimated revenue per ad (ZAR)" value={form.estimatedEcpmZar} step="0.01" onChange={(v) => set("estimatedEcpmZar", v)} />
        <Field label="Max signups per network per day" value={form.maxSignupsPerIpPerDay} onChange={(v) => set("maxSignupsPerIpPerDay", v)} />
        <div>
          <Toggle label="Block rewards on emulators" checked={form.blockEmulators} onChange={(v) => set("blockEmulators", v)} />
          <Toggle label="Block rewards on rooted phones" checked={form.blockRooted} onChange={(v) => set("blockRooted", v)} />
          <Toggle label="Block flagged accounts" checked={form.blockSuspicious} onChange={(v) => set("blockSuspicious", v)} />
          <Toggle label="Refuse cash outs that exceed estimated revenue" checked={form.payoutsRequireRevenueCover} onChange={(v) => set("payoutsRequireRevenueCover", v)} />
        </div>
      </div>
      <p className="note">Demo mode records emulator and root flags but still allows rewards, so you can try the app on an Android emulator. Production Cloud Functions enforce the switches above.</p>
    </>
  );
}

function Stat({ k, v, s }: { k: string; v: string; s: string }) {
  return <div className="card"><div className="k">{k}</div><div className="v">{v}</div><div className="s">{s}</div></div>;
}

function Bar({ label, value, scale, kind }: { label: string; value: number; scale: number; kind: string }) {
  const width = `${Math.max(2, Math.round((value / scale) * 100))}%`;
  return (
    <div className="bar-row">
      <span>{label}</span>
      <div className="track"><div className={`fill ${kind}`} style={{ width }} /></div>
      <strong>{money(value)}</strong>
    </div>
  );
}

function UserTable({ users, onOpen }: { users: User[]; onOpen?: (id: string) => void }) {
  return (
    <table>
      <thead><tr><th>Member</th><th>Balance</th><th>Ads</th><th>Signals</th></tr></thead>
      <tbody>
        {users.map((user) => (
          <tr key={user.id} onClick={() => onOpen?.(user.id)} style={{ cursor: onOpen ? "pointer" : "default" }}>
            <td>{user.displayName}<div className="note">{user.email}</div></td>
            <td>{num.format(user.points)} pts</td>
            <td>{user.adsWatched}</td>
            <td>
              {user.role === "admin" && <span className="pill">Admin</span>}
              {user.blocked && <span className="pill bad">Blocked</span>}
              {user.isEmulator && <span className="pill warn">Emulator</span>}
              {user.isRooted && <span className="pill warn">Rooted</span>}
              {user.suspicious && <span className="pill warn">Flagged</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function WithdrawalTable({ rows, onOpen }: { rows: Withdrawal[]; onOpen?: (row: Withdrawal) => void }) {
  return (
    <table>
      <thead><tr><th>Member</th><th>Amount</th><th>Method</th><th>Status</th></tr></thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} onClick={() => onOpen?.(row)} style={{ cursor: onOpen ? "pointer" : "default" }}>
            <td>{row.displayName}<div className="note">{row.userEmail}</div></td>
            <td>{money(row.zarAmount)}</td>
            <td>{row.method === "1voucher" ? "1Voucher" : row.bankName}</td>
            <td><span className={`pill ${row.status === "PAID" ? "ok" : row.status === "REJECTED" ? "bad" : "warn"}`}>{row.status}</span></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Field({ label, value, onChange, step }: { label: string; value: number; onChange: (v: number) => void; step?: string }) {
  return (
    <label>{label}
      <input type="number" step={step ?? "1"} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

type PageProps = { token: string; onAuth: () => void; onError: (message: string) => void };

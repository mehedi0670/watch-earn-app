import express, { type NextFunction, type Request, type Response } from "express";
import type { EarnService } from "./service";
import type { User, VerifierKey } from "./types";
import { ApiError, assertDevice, signJwt, verifyJwt } from "./util";

export type FirebaseIdentity = {
  uid: string;
  email?: string;
  name?: string;
  provider: "google" | "firebase";
};

export type HttpOptions = {
  authMode: "local" | "firebase";
  jwtSecret: string;
  tokenTtlSeconds: number;
  loadSsvKeys: () => Promise<VerifierKey[]>;
  verifyFirebaseToken?: (token: string) => Promise<FirebaseIdentity>;
};

export function createApp(service: EarnService, opts: HttpOptions) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", true);
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", req.header("origin") || "*");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });
  app.use(express.json({ limit: "32kb" }));

  const wrap =
    (fn: (req: Request, res: Response) => Promise<void>) =>
    (req: Request, res: Response, next: NextFunction) => {
      fn(req, res).catch(next);
    };

  function ip(req: Request): string {
    const forwarded = req.header("x-forwarded-for");
    if (forwarded) return forwarded.split(",")[0]!.trim().slice(0, 64);
    return (req.ip || "unknown").slice(0, 64);
  }

  function issue(user: User): string {
    return signJwt({ uid: user.id, role: user.role }, opts.jwtSecret, opts.tokenTtlSeconds);
  }

  async function authPayload(user: User) {
    const view = await service.wallet(user.id);
    return opts.authMode === "local" ? { token: issue(user), ...view } : view;
  }

  async function actor(req: Request): Promise<User> {
    const header = req.header("authorization") || "";
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match?.[1]) throw new ApiError(401, "AUTH", "Please sign in again.");
    const token = match[1].trim();
    if (opts.authMode === "firebase") {
      if (!opts.verifyFirebaseToken) throw new ApiError(500, "AUTH", "Firebase auth is not configured.");
      const identity = await opts.verifyFirebaseToken(token);
      return service.getSelf(identity.uid);
    }
    const claims = verifyJwt(token, opts.jwtSecret);
    if (!claims) throw new ApiError(401, "AUTH", "Please sign in again.");
    return service.getSelf(claims.uid);
  }

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "earnza" });
  });

  app.get(
    "/v1/config",
    wrap(async (_req, res) => {
      res.json(await service.publicConfig());
    }),
  );

  app.post(
    "/v1/auth/signup",
    wrap(async (req, res) => {
      if (opts.authMode === "firebase") {
        throw new ApiError(400, "USE_FIREBASE", "Create the account with Firebase Auth, then call /v1/auth/firebase.");
      }
      const body = req.body as Record<string, unknown>;
      const user = await service.signup({
        email: String(body.email ?? ""),
        password: String(body.password ?? ""),
        displayName: String(body.displayName ?? ""),
        device: assertDevice(body.device),
        referralCode: typeof body.referralCode === "string" ? body.referralCode : undefined,
        ip: ip(req),
      });
      res.status(201).json(await authPayload(user));
    }),
  );

  app.post(
    "/v1/auth/login",
    wrap(async (req, res) => {
      if (opts.authMode === "firebase") throw new ApiError(400, "USE_FIREBASE", "Sign in with Firebase Auth.");
      const body = req.body as Record<string, unknown>;
      const user = await service.login({
        email: String(body.email ?? ""),
        password: String(body.password ?? ""),
        device: assertDevice(body.device),
        ip: ip(req),
      });
      res.json(await authPayload(user));
    }),
  );

  app.post(
    "/v1/auth/google-demo",
    wrap(async (req, res) => {
      const body = req.body as Record<string, unknown>;
      const user = await service.googleDemo({ device: assertDevice(body.device), ip: ip(req) });
      res.json(await authPayload(user));
    }),
  );

  app.post(
    "/v1/auth/forgot",
    wrap(async (req, res) => {
      if (opts.authMode === "firebase") {
        throw new ApiError(400, "USE_FIREBASE", "Use Firebase's password reset email.");
      }
      const body = req.body as Record<string, unknown>;
      const result = await service.forgotPassword(String(body.email ?? ""), ip(req));
      res.json({
        ok: true,
        message: "If that email has a password, a reset is ready.",
        resetToken: result.resetToken,
      });
    }),
  );

  app.post(
    "/v1/auth/reset",
    wrap(async (req, res) => {
      const body = req.body as Record<string, unknown>;
      await service.resetPassword(String(body.token ?? ""), String(body.password ?? ""));
      res.json({ ok: true });
    }),
  );

  app.post(
    "/v1/auth/firebase",
    wrap(async (req, res) => {
      if (opts.authMode !== "firebase" || !opts.verifyFirebaseToken) {
        throw new ApiError(404, "NOT_FOUND", "Firebase auth is not enabled on this server.");
      }
      const body = req.body as Record<string, unknown>;
      const identity = await opts.verifyFirebaseToken(String(body.idToken ?? ""));
      if (!identity.email) throw new ApiError(400, "EMAIL", "That account has no email address.");
      const user = await service.upsertFirebaseUser({
        uid: identity.uid,
        email: identity.email,
        displayName: identity.name || identity.email.split("@")[0] || "EarnZA member",
        provider: identity.provider,
        device: assertDevice(body.device),
        referralCode: typeof body.referralCode === "string" ? body.referralCode : undefined,
        ip: ip(req),
      });
      res.json(await authPayload(user));
    }),
  );

  app.get(
    "/v1/me",
    wrap(async (req, res) => {
      const user = await actor(req);
      res.json(await service.wallet(user.id));
    }),
  );

  app.patch(
    "/v1/me",
    wrap(async (req, res) => {
      const user = await actor(req);
      const body = req.body as Record<string, unknown>;
      await service.updateProfile(user.id, String(body.displayName ?? ""));
      res.json(await service.wallet(user.id));
    }),
  );

  app.delete(
    "/v1/me",
    wrap(async (req, res) => {
      const user = await actor(req);
      await service.deleteAccount(user.id);
      res.json({ ok: true });
    }),
  );

  app.post(
    "/v1/ads/prepare",
    wrap(async (req, res) => {
      const user = await actor(req);
      res.json(await service.prepareAd(user.id));
    }),
  );

  app.post(
    "/v1/ads/demo-complete",
    wrap(async (req, res) => {
      const user = await actor(req);
      const body = req.body as Record<string, unknown>;
      // `points` in the body is intentionally ignored. The server decides the reward.
      const result = await service.completeDemoAd(user.id, String(body.sessionId ?? ""));
      const view = await service.wallet(user.id);
      res.json({ ...result, ...view });
    }),
  );

  app.get(
    "/v1/admob/ssv",
    wrap(async (req, res) => {
      const raw = (req.originalUrl.split("?")[1] || "").split("#")[0];
      const keys = await opts.loadSsvKeys();
      const result = await service.creditSsv(raw, keys);
      res.json({ ok: true, ...result });
    }),
  );

  app.post(
    "/v1/check-in",
    wrap(async (req, res) => {
      const user = await actor(req);
      const result = await service.checkIn(user.id);
      res.json({ ...result, ...(await service.wallet(user.id)) });
    }),
  );

  app.post(
    "/v1/withdrawals",
    wrap(async (req, res) => {
      const user = await actor(req);
      const withdrawal = await service.requestWithdrawal(user.id, (req.body ?? {}) as Record<string, unknown>);
      res.status(201).json({ withdrawal, ...(await service.wallet(user.id)) });
    }),
  );

  app.get(
    "/v1/withdrawals",
    wrap(async (req, res) => {
      const user = await actor(req);
      res.json({ withdrawals: await service.listWithdrawals(user.id) });
    }),
  );

  app.get(
    "/v1/ledger",
    wrap(async (req, res) => {
      const user = await actor(req);
      res.json({ ledger: await service.listLedger(user.id) });
    }),
  );

  app.get(
    "/v1/notifications",
    wrap(async (req, res) => {
      const user = await actor(req);
      const notifications = await service.listNotifications(user.id);
      res.json({ notifications, unread: notifications.filter((item) => !item.read).length });
    }),
  );

  app.post(
    "/v1/notifications/:id/read",
    wrap(async (req, res) => {
      const user = await actor(req);
      await service.markRead(user.id, String(req.params.id));
      res.json({ ok: true });
    }),
  );

  app.get(
    "/v1/admin/dashboard",
    wrap(async (req, res) => {
      const user = await actor(req);
      res.json(await service.adminDashboard(user.id));
    }),
  );

  app.get(
    "/v1/admin/users",
    wrap(async (req, res) => {
      const user = await actor(req);
      res.json({ users: await service.adminListUsers(user.id, String(req.query.q ?? "")) });
    }),
  );

  app.get(
    "/v1/admin/users/:id",
    wrap(async (req, res) => {
      const user = await actor(req);
      res.json(await service.adminGetUser(user.id, String(req.params.id)));
    }),
  );

  app.post(
    "/v1/admin/users/:id/block",
    wrap(async (req, res) => {
      const user = await actor(req);
      const body = req.body as Record<string, unknown>;
      res.json({ user: await service.adminBlock(user.id, String(req.params.id), Boolean(body.blocked), String(body.reason ?? "")) });
    }),
  );

  app.post(
    "/v1/admin/users/:id/adjust",
    wrap(async (req, res) => {
      const user = await actor(req);
      const body = req.body as Record<string, unknown>;
      res.json({
        user: await service.adminAdjust(user.id, String(req.params.id), Number(body.pointsDelta), String(body.note ?? "")),
      });
    }),
  );

  app.get(
    "/v1/admin/withdrawals",
    wrap(async (req, res) => {
      const user = await actor(req);
      const status = typeof req.query.status === "string" && req.query.status ? req.query.status : undefined;
      res.json({ withdrawals: await service.adminListWithdrawals(user.id, status) });
    }),
  );

  app.post(
    "/v1/admin/withdrawals/:id/review",
    wrap(async (req, res) => {
      const user = await actor(req);
      const body = req.body as Record<string, unknown>;
      const action = body.action;
      if (action !== "approve" && action !== "reject" && action !== "pay") {
        throw new ApiError(400, "ACTION", "Action must be approve, reject or pay.");
      }
      res.json({
        withdrawal: await service.adminReview(user.id, String(req.params.id), action, {
          voucherPin: typeof body.voucherPin === "string" ? body.voucherPin : undefined,
          paymentReference: typeof body.paymentReference === "string" ? body.paymentReference : undefined,
          note: typeof body.note === "string" ? body.note : undefined,
          reason: typeof body.reason === "string" ? body.reason : undefined,
        }),
      });
    }),
  );

  app.get(
    "/v1/admin/settings",
    wrap(async (req, res) => {
      const user = await actor(req);
      res.json({ settings: await service.adminGetSettings(user.id) });
    }),
  );

  app.put(
    "/v1/admin/settings",
    wrap(async (req, res) => {
      const user = await actor(req);
      res.json({ settings: await service.adminUpdateSettings(user.id, (req.body ?? {}) as Record<string, unknown>) });
    }),
  );

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ApiError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message } });
      return;
    }
    console.error(err);
    res.status(500).json({ error: { code: "SERVER", message: "Something went wrong." } });
  });

  return app;
}

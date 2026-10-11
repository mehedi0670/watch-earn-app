import { initializeApp, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { onRequest } from "firebase-functions/v2/https";
import { FirestoreRepo } from "./firestoreRepo";
import { createApp } from "./http";
import { EarnService } from "./service";
import { fetchAdmobKeys } from "./ssv";

if (getApps().length === 0) initializeApp();

const adminEmails = (process.env.ADMIN_EMAILS || "")
  .split(",")
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean);

const service = new EarnService(new FirestoreRepo(), {
  demoMode: false,
  adminEmails,
});

const app = createApp(service, {
  authMode: "firebase",
  jwtSecret: process.env.JWT_SECRET || "unused-in-firebase-mode",
  tokenTtlSeconds: 3600,
  loadSsvKeys: fetchAdmobKeys,
  verifyFirebaseToken: async (token) => {
    const decoded = await getAuth().verifyIdToken(token);
    return {
      uid: decoded.uid,
      email: decoded.email,
      name: decoded.name,
      provider: decoded.firebase?.sign_in_provider === "google.com" ? "google" : "firebase",
    };
  },
});

/** Public HTTPS API. AdMob SSV must be able to reach /v1/admob/ssv without a Firebase user. */
export const api = onRequest({ region: "europe-west1", invoker: "public", cors: false }, app);

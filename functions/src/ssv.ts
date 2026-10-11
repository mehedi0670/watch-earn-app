import crypto from "crypto";
import type { VerifierKey } from "./types";

const KEYS_URL = "https://www.gstatic.com/admob/reward/verifier-keys.json";

let cache: { at: number; keys: VerifierKey[] } | null = null;

/**
 * AdMob rewarded SSV signs the raw query string with ECDSA P-256 / SHA-256.
 * `signature` and `key_id` are removed; every other parameter stays in the
 * original order and encoding. The reward amount in the query is ignored by
 * EarnZA — points come only from server settings after this check passes.
 */
export function contentToVerify(rawQuery: string): string {
  return rawQuery
    .split("&")
    .filter((part) => {
      const key = part.split("=")[0];
      return key !== "signature" && key !== "key_id";
    })
    .join("&");
}

function pemFromKey(key: VerifierKey): string | null {
  if (key.pem) return key.pem;
  if (!key.base64) return null;
  const body = key.base64.match(/.{1,64}/g)?.join("\n") ?? key.base64;
  return `-----BEGIN PUBLIC KEY-----\n${body}\n-----END PUBLIC KEY-----\n`;
}

export function verifyAdmobQuery(
  rawQuery: string,
  keys: VerifierKey[],
): { ok: true } | { ok: false; reason: string } {
  const params = new URLSearchParams(rawQuery);
  const signature = params.get("signature");
  const keyId = params.get("key_id");
  if (!signature || !keyId) return { ok: false, reason: "missing signature" };
  const key = keys.find((item) => String(item.keyId) === String(keyId));
  if (!key) return { ok: false, reason: "unknown key" };
  const pem = pemFromKey(key);
  if (!pem) return { ok: false, reason: "key has no pem" };
  try {
    const ok = crypto.verify(
      "sha256",
      Buffer.from(contentToVerify(rawQuery), "utf8"),
      pem,
      Buffer.from(signature, "base64url"),
    );
    return ok ? { ok: true } : { ok: false, reason: "bad signature" };
  } catch {
    return { ok: false, reason: "bad signature" };
  }
}

export async function fetchAdmobKeys(fetcher: typeof fetch = fetch): Promise<VerifierKey[]> {
  if (cache && Date.now() - cache.at < 12 * 60 * 60 * 1000) return cache.keys;
  const res = await fetcher(KEYS_URL);
  if (!res.ok) throw new Error(`AdMob verifier key fetch failed (${res.status})`);
  const body = (await res.json()) as { keys?: VerifierKey[] };
  if (!body.keys?.length) throw new Error("AdMob verifier key document was empty");
  cache = { at: Date.now(), keys: body.keys };
  return body.keys;
}

export function resetAdmobKeyCache(): void {
  cache = null;
}

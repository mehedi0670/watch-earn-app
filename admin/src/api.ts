export const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) || "http://127.0.0.1:8787";

const ADMIN_DEVICE = {
  deviceId: "admin-portal",
  isEmulator: false,
  isRooted: false,
  model: "Admin portal",
  platform: "web",
};

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, options: { method?: string; body?: unknown; token?: string | null } = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "content-type": "application/json",
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
  if (!response.ok) {
    throw new ApiError(payload.error?.code || "HTTP", payload.error?.message || `Request failed (${response.status})`);
  }
  return payload as T;
}

export function login(email: string, password: string) {
  return api<{ token: string; user: { role: string; displayName: string; email: string } }>("/v1/auth/login", {
    method: "POST",
    body: { email, password, device: ADMIN_DEVICE },
  });
}

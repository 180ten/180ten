// src/lib/adminApi.ts
// Browser-side helper to call /api/admin/* routes with the current Bearer JWT.
// Never throws to the console; surfaces messages so admin tabs can `showToast`.

import { sb } from "@/lib/supabase";

export class AdminApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function getBearer(): Promise<string> {
  const { data: { session } } = await sb.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new AdminApiError(401, "Bạn chưa đăng nhập admin.");
  return token;
}

async function readError(res: Response): Promise<string> {
  let msg = `HTTP ${res.status}`;
  try {
    const j = (await res.json()) as { error?: string };
    if (j?.error) msg = j.error;
  } catch { /* ignore */ }
  return msg;
}

/** POST /api/admin/<path>  with JSON body, returns parsed JSON. */
export async function adminCall<T = unknown>(path: string, body: unknown): Promise<T> {
  const token = await getBearer();
  const res = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization:  `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new AdminApiError(res.status, await readError(res));
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** GET /api/admin/<path>  with Bearer token, returns parsed JSON. */
export async function adminGet<T = unknown>(path: string): Promise<T> {
  const token = await getBearer();
  const res = await fetch(path, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new AdminApiError(res.status, await readError(res));
  return (await res.json()) as T;
}

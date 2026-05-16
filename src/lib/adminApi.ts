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

// ── Exam + question writes (service-role via /api/admin/exams) ─────────
// Direct sb.from("exams"|"questions").upsert() from the client is blocked by
// RLS — these helpers route writes through the admin endpoint where the
// service role bypasses RLS.

// (adminDeleteQuestions defined after this block — keeps the upsert
// pair next to each other up top.)

export async function adminUpsertExam(examRow: Record<string, unknown>): Promise<void> {
  await adminCall("/api/admin/exams", { action: "upsert_exam", examRow });
}

export async function adminDeleteQuestions(examId: string, ids: string[]): Promise<void> {
  if (!examId || !ids?.length) return;
  // Server caps at 50 per call; chunk client-side to match.
  for (let i = 0; i < ids.length; i += 50) {
    await adminCall("/api/admin/exams", {
      action: "delete_questions",
      exam_id: examId,
      ids: ids.slice(i, i + 50),
    });
  }
}

export async function adminUpsertQuestions(questions: Record<string, unknown>[]): Promise<void> {
  // Server caps at 50 per call; chunk client-side to match.
  for (let i = 0; i < questions.length; i += 50) {
    await adminCall("/api/admin/exams", {
      action: "upsert_questions",
      questions: questions.slice(i, i + 50),
    });
  }
}

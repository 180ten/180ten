// src/lib/examSubmit.ts
// Client-side helpers for the secure exam API.

import { sb } from "@/lib/supabase";
import type { SanitizedQuestion } from "@/lib/examShuffle";

// ── Types ─────────────────────────────────────────────────────────────
export interface SubmitAnswerInput {
  question_id: string;
  exam_id: string;
  slot_key: string;
  submitted_index: number;
}

export interface SubmitAnswerResult {
  is_correct: boolean;
  score: number;
  /** Position of the correct option (0-indexed in shuffled choices), returned after submit for review. */
  correct_index: number | null;
}

export interface StartExamResult {
  questions: SanitizedQuestion[];
  slotKeys: string[];
  /** slot_key → question type ("kanji", "bunsho", "listen_kadai", …) */
  slotTypeMap: Record<string, string>;
  /** slot_key → parent questions.id (UUID), needed for /submit-answer */
  slotToQuestionId: Record<string, string>;
}

export interface TargetPoolResult extends StartExamResult {
  /** slot_key → original parent exam_id (target practice spans many exams). */
  slotToExamId: Record<string, string>;
  virtualExam: { id: string; name: string; level: string };
  /** Diagnostic — how many rows DB had + how many distinct parent exams the picked questions came from. */
  meta?: { totalAvailable: number; sourceExamCount: number };
}

export interface TargetPoolInput {
  level: string;
  mondaiType: string;
  count: number;
}

export class ExamApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// ── Internals ─────────────────────────────────────────────────────────

/**
 * Race a promise against a timeout. If the promise hangs (Supabase client
 * broken after long background tab), we give up after `ms` and return the
 * fallback. Critical: the original promise keeps pending in background but
 * we no longer block on it.
 */
function withTimeout<T>(p: Promise<T>, ms: number, label: string, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      console.warn(`[examSubmit] ${label} timed out after ${ms}ms — using fallback`);
      resolve(fallback);
    }, ms);
    p.then((v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(v);
    }, (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      console.warn(`[examSubmit] ${label} rejected:`, err);
      resolve(fallback);
    });
  });
}

/**
 * Returns the JWT if the user is logged in, otherwise null (guest mode).
 * Forces a token refresh when the session is expired or expires within 60 s.
 * EVERY auth call is wrapped in a 4-second timeout — if Supabase client is
 * stuck (common after long background tab), we fall through to guest mode
 * and rely on retry-on-401 to recover.
 */
async function getOptionalBearer(): Promise<string | null> {
  try {
    const sessionRes = await withTimeout(
      sb.auth.getSession(),
      4000,
      "getSession()",
      { data: { session: null }, error: null } as Awaited<ReturnType<typeof sb.auth.getSession>>,
    );
    const session = sessionRes.data?.session;
    if (!session) return null;

    // If the access token is expired or expiring within 60 s → force refresh.
    const nowSec    = Math.floor(Date.now() / 1000);
    const expiresAt = session.expires_at ?? 0;
    if (expiresAt > 0 && nowSec >= expiresAt - 60) {
      const refreshRes = await withTimeout(
        sb.auth.refreshSession(),
        5000,
        "refreshSession()",
        { data: { session: null, user: null }, error: null } as Awaited<ReturnType<typeof sb.auth.refreshSession>>,
      );
      return refreshRes.data?.session?.access_token ?? null;
    }
    return session.access_token ?? null;
  } catch (e) {
    console.warn("[getOptionalBearer] unexpected error:", e);
    return null;
  }
}

/** Fetch with a hard timeout. Throws a timeout reason instead of a bare AbortError. */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 15_000,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => {
    ctrl.abort(new DOMException(`${url} timed out after ${timeoutMs}ms`, "TimeoutError"));
  }, timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function readError(res: Response): Promise<string> {
  let msg = `HTTP ${res.status}`;
  try {
    const j = (await res.json()) as { error?: string };
    if (j?.error) msg = j.error;
  } catch { /* ignore */ }
  return msg;
}

function authHeaders(token: string | null, jsonBody = false): Record<string, string> {
  const h: Record<string, string> = {};
  if (jsonBody) h["Content-Type"] = "application/json";
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

// ── GET /api/exam/[id]/start ─────────────────────────────────────────
export async function startExam(examId: string): Promise<StartExamResult> {
  const token = await getOptionalBearer();
  const res = await fetch(`/api/exam/${encodeURIComponent(examId)}/start`, {
    method: "GET",
    headers: authHeaders(token),
  });
  if (!res.ok) throw new ExamApiError(await readError(res), res.status);
  return (await res.json()) as StartExamResult;
}

// ── POST /api/exam/target-pool ───────────────────────────────────────
export async function startTargetPractice(input: TargetPoolInput): Promise<TargetPoolResult> {
  const token = await getOptionalBearer();
  const res = await fetch("/api/exam/target-pool", {
    method: "POST",
    headers: authHeaders(token, true),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new ExamApiError(await readError(res), res.status);
  return (await res.json()) as TargetPoolResult;
}

// ── POST /api/exam/submit-answer ─────────────────────────────────────

/** Throwing variant of withTimeout — rejects with the provided error if the
 *  promise doesn't settle in time. Use when callers expect to catch on failure. */
function withTimeoutThrow<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      reject(new ExamApiError(`${label} timeout after ${ms}ms`, 0));
    }, ms);
    p.then((v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(v);
    }, (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(err);
    });
  });
}

/** Internal — accepts a pre-fetched token so bulk-submit doesn't trigger
 *  N parallel refresh calls. Hard-caps the ENTIRE op (fetch + body parsing)
 *  at 12s. fetchWithTimeout alone only times response headers; body reads
 *  can hang separately. */
async function submitAnswerWithToken(
  input: SubmitAnswerInput,
  token: string | null,
): Promise<SubmitAnswerResult> {
  return withTimeoutThrow(
    (async () => {
      const res = await fetchWithTimeout(
        "/api/exam/submit-answer",
        {
          method: "POST",
          headers: authHeaders(token, true),
          body: JSON.stringify(input),
        },
        10_000,
      );
      if (!res.ok) throw new ExamApiError(await readError(res), res.status);
      return (await res.json()) as SubmitAnswerResult;
    })(),
    12_000,
    `submitAnswerWithToken(${input.slot_key})`,
  );
}

export async function submitAnswer(input: SubmitAnswerInput): Promise<SubmitAnswerResult> {
  const token = await getOptionalBearer();
  return submitAnswerWithToken(input, token);
}

/** Hits POST /api/exam/submit-batch with the given token, returns parsed
 *  results map or throws ExamApiError. Hard 25s timeout for the whole call.
 *  Seed is now derived server-side from cookie+exam_sessions — nothing to
 *  forward from the client. */
async function submitBatchHttp(
  inputs: SubmitAnswerInput[],
  token: string | null,
): Promise<Record<string, SubmitAnswerResult>> {
  const body = JSON.stringify({
    inputs: inputs.map(({ question_id, exam_id, slot_key, submitted_index }) => ({
      question_id, exam_id, slot_key, submitted_index,
    })),
  });

  return withTimeoutThrow(
    (async () => {
      const res = await fetchWithTimeout(
        "/api/exam/submit-batch",
        { method: "POST", headers: authHeaders(token, true), body },
        20_000,
      );
      if (!res.ok) throw new ExamApiError(await readError(res), res.status);
      const json = (await res.json()) as { results: Record<string, SubmitAnswerResult> };
      return json.results ?? {};
    })(),
    25_000,
    "submitBatchHttp",
  );
}

async function submitIndividually(
  inputs: SubmitAnswerInput[],
  token: string | null,
): Promise<Record<string, SubmitAnswerResult>> {
  const out: Record<string, SubmitAnswerResult> = {};
  let okCount = 0;
  let failedCount = 0;
  let cursor = 0;
  const workerCount = Math.min(6, inputs.length);

  async function worker() {
    while (cursor < inputs.length) {
      const inp = inputs[cursor++];
      try {
        out[inp.slot_key] = await submitAnswerWithToken(inp, token);
        okCount++;
      } catch (err) {
        failedCount++;
        console.warn("[submitAnswers] single fallback failed:", inp.slot_key, err);
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, worker));
  if (okCount === 0 && failedCount > 0) {
    throw new ExamApiError("Không chấm được bài. Vui lòng thử nộp lại.", 0);
  }
  for (const inp of inputs) {
    if (!out[inp.slot_key]) {
      out[inp.slot_key] = { is_correct: false, score: 0, correct_index: null };
    }
  }
  return out;
}

/**
 * Grade many answers — uses the batch endpoint (1 request, not N).
 * Falls back gracefully on auth failure with retry-on-401.
 *
 * Performance: 100 questions used to be ~30s (100 × 0.3s queued through
 * browser's 6-concurrent limit on dev server). Now it's 1 request, ~500ms.
 */
export async function submitAnswers(
  inputs: SubmitAnswerInput[],
): Promise<Record<string, SubmitAnswerResult>> {
  const t0 = Date.now();
  let token = await getOptionalBearer();

  console.log("[submitAnswers] starting", {
    hasToken: !!token,
    tokenLen: token?.length ?? 0,
    inputCount: inputs.length,
    bearerMs: Date.now() - t0,
  });

  // Empty short-circuit
  if (inputs.length === 0) return {};

  // ── Phase 1: try with current token ──
  try {
    const results = await submitBatchHttp(inputs, token);
    console.log("[submitAnswers] phase1 OK", {
      elapsedMs: Date.now() - t0,
      resultCount: Object.keys(results).length,
    });
    return results;
  } catch (err1) {
    if (!(err1 instanceof ExamApiError) || err1.status !== 401) {
      console.warn("[submitAnswers] batch failed, falling back to single-submit:", err1);
      return submitIndividually(inputs, token);
    }
    // 401 → fall through to refresh + retry
    console.warn("[submitAnswers] 401 → refreshing session...");
  }

  // ── Phase 2: refresh ONCE, retry the entire batch ──
  const refreshT0 = Date.now();
  try {
    const refreshRes = await withTimeout(
      sb.auth.refreshSession(),
      5000,
      "submitAnswers refresh",
      { data: { session: null, user: null }, error: null } as Awaited<ReturnType<typeof sb.auth.refreshSession>>,
    );
    token = refreshRes.data?.session?.access_token ?? null;
    console.log("[submitAnswers] refresh result", {
      gotNewToken: !!token,
      refreshMs: Date.now() - refreshT0,
    });
  } catch (e) {
    console.error("[submitAnswers] refresh threw:", e);
    token = null;
  }

  if (!token) {
    throw new ExamApiError("Phiên đăng nhập hết hạn. Vui lòng thử nộp lại.", 401);
  }

  try {
    const results = await submitBatchHttp(inputs, token);
    console.log("[submitAnswers] phase2 OK after refresh", {
      totalMs: Date.now() - t0,
      resultCount: Object.keys(results).length,
    });
    return results;
  } catch (err2) {
    console.warn("[submitAnswers] phase2 batch failed, falling back to single-submit:", err2);
    return submitIndividually(inputs, token);
  }
}

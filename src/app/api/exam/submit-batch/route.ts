// src/app/api/exam/submit-batch/route.ts
//
// POST /api/exam/submit-batch
//
// Batch grading — replaces N parallel calls to /submit-answer with ONE request.
// Same security model + deterministic shuffle, but:
//   - 1 auth check (vs N)
//   - 1 DB query for all unique questions (vs N)
//   - In-memory grading loop (free)
//   - 1 HTTP round-trip (vs N constrained by browser concurrency limit of 6)
//
// On dev mode this turns 100 × 2-4s into 1 × ~500ms.

import { NextResponse, after } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { buildBalancedPositionMapForQuestions, expectedPosForSlot, type AnswerPositionMap, type RawQuestion } from "@/lib/examShuffle";
import { hashSHA256 } from "@/lib/serverUtils";
import { buildReportData } from "@/lib/examLogic";

interface BatchInput {
  question_id: string;
  exam_id: string;
  slot_key: string;
  submitted_index: number;
}

interface BatchBody {
  inputs?: BatchInput[];
  /** Exam level — used to build the JLPT/BJT report server-side. */
  level?: string;
  /** Seconds spent on the exam — persisted into exam_results.time_spent. */
  time_spent?: number;
  /** @deprecated — server now derives seed from (cookie, exam_id) via
   *  exam_sessions; the client value is ignored. Field kept so the legacy
   *  request shape doesn't blow up parsing. */
  guest_seed?: string;
}

interface BatchResultEntry {
  is_correct: boolean;
  score: number;
  correct_index: number | null;
}

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function jsonError(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!SUPA_URL || !SERVICE_KEY) {
    return jsonError(500, "Server is missing Supabase env vars");
  }

  // ── 1+2) Auth check + body parse in parallel ─────────────────────────
  // getUser hits Supabase GoTrue (network) and req.json() reads the
  // request stream (CPU). Neither depends on the other, so race them.
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";

  const sb = createClient(SUPA_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const [userResult, parsedBody] = await Promise.all([
    token ? sb.auth.getUser(token) : Promise.resolve(null),
    (req.json() as Promise<BatchBody>).catch(() => null),
  ]);

  let authUserId: string | null = null;
  let tokenInvalid = false;
  if (token && userResult) {
    if (userResult.data?.user) authUserId = userResult.data.user.id;
    else tokenInvalid = !!userResult.error || !userResult.data?.user;
  }

  if (!parsedBody) return jsonError(400, "Body must be JSON");
  const body: BatchBody = parsedBody;

  const inputs = Array.isArray(body.inputs) ? body.inputs : [];
  if (inputs.length === 0) return jsonError(400, "inputs array required");
  if (inputs.length > 500) return jsonError(400, "inputs too many (max 500)");

  // Validate each input. submitted_index === -1 means "reveal-only" (the user
  // didn't choose anything) — the response still returns correct_index so the
  // review screen can highlight the right answer.
  for (const inp of inputs) {
    if (
      !inp.question_id ||
      !inp.exam_id ||
      !inp.slot_key ||
      typeof inp.submitted_index !== "number" ||
      !Number.isInteger(inp.submitted_index) ||
      inp.submitted_index < -1
    ) {
      return jsonError(400, `Invalid input for slot ${inp.slot_key ?? "?"}`);
    }
  }

  // ── 3) Identity resolution + per-exam seed lookup ────────────────────
  // Seed is server-side only (exam_sessions table, keyed by hashed identity
  // + exam_id + secret). The legacy `body.guest_seed` is ignored — closing
  // the brute-force-the-shuffle attack vector.
  const SERVER_SEED_SECRET = process.env.SERVER_SEED_SECRET;
  if (!SERVER_SEED_SECRET) return jsonError(500, "SERVER_SEED_SECRET is not set");

  if (!authUserId && tokenInvalid) {
    return jsonError(401, "Token expired or invalid — refresh session and retry");
  }
  const cookieStore = await cookies();
  const guestToken  = cookieStore.get("guest_exam_token")?.value;
  const identity    = authUserId ?? guestToken;
  if (!identity) return jsonError(401, "No valid session — please restart exam");

  const examIds = Array.from(new Set(inputs.map((i) => i.exam_id)));
  const sessionKeys = await Promise.all(
    examIds.map((id) => hashSHA256(`${identity}:${id}:${SERVER_SEED_SECRET}`)),
  );
  const keyToExam = new Map<string, string>();
  examIds.forEach((id, i) => keyToExam.set(sessionKeys[i], id));

  // Fire the seed lookup and the questions scope query concurrently —
  // they have no data dependency on each other.
  type DbRow = RawQuestion & { exam_id: string };
  const [sessRes, scopeRes] = await Promise.all([
    sb.from("exam_sessions")
      .select("session_key, seed")
      .in("session_key", sessionKeys)
      .gt("expires_at", new Date().toISOString()),
    sb.from("questions")
      .select("id,exam_id,type,level,order_index,data,audio_url,audio_script")
      .in("exam_id", examIds),
  ]);

  if (sessRes.error) {
    return jsonError(500, `exam_sessions lookup failed: ${sessRes.error.message}`);
  }
  if (scopeRes.error) return jsonError(500, scopeRes.error.message);

  const sessions = sessRes.data;
  const scopeRows = scopeRes.data;

  const seedByExam = new Map<string, string>();
  for (const s of (sessions ?? []) as { session_key: string; seed: string }[]) {
    const examId = keyToExam.get(s.session_key);
    if (examId) seedByExam.set(examId, s.seed);
  }
  // Reject if any exam is missing a session — never silently fall back.
  for (const examId of examIds) {
    if (!seedByExam.has(examId)) {
      return jsonError(400, `Session expired for exam ${examId} — please restart`);
    }
  }
  // Deliberately do NOT delete sessions here — expires_at handles cleanup,
  // and keeping them lets retries / re-submits stay consistent.

  // ── 4) Build byId map + per-exam shuffle position maps ───────────────
  if (!scopeRows || scopeRows.length === 0) return jsonError(404, "No questions found");

  const byId = new Map<string, DbRow>();
  for (const r of scopeRows as unknown as DbRow[]) byId.set(String(r.id), r);

  const posMaps: Record<string, AnswerPositionMap> = {};
  for (const examId of examIds) {
    const rawRows = (scopeRows as unknown as DbRow[]).filter((r) => String(r.exam_id) === examId);
    posMaps[examId] = buildBalancedPositionMapForQuestions(rawRows, seedByExam.get(examId)!, examId);
  }

  // ── 5) Grade each input in memory ────────────────────────────────────
  const results: Record<string, BatchResultEntry> = {};
  for (const inp of inputs) {
    const row = byId.get(inp.question_id);
    if (!row) {
      results[inp.slot_key] = { is_correct: false, score: 0, correct_index: null };
      continue;
    }
    // Verify the question really belongs to the claimed exam_id (prevents cross-exam attacks)
    if (String(row.exam_id) !== inp.exam_id) {
      results[inp.slot_key] = { is_correct: false, score: 0, correct_index: null };
      continue;
    }

    const seed = seedByExam.get(inp.exam_id)!;
    const expected = expectedPosForSlot(row, inp.slot_key, seed, inp.exam_id, posMaps[inp.exam_id]);
    if (expected === null) {
      results[inp.slot_key] = { is_correct: false, score: 0, correct_index: null };
      continue;
    }

    const isCorrect = inp.submitted_index === expected;
    results[inp.slot_key] = {
      is_correct: isCorrect,
      score: isCorrect ? 1 : 0,
      correct_index: expected,
    };
  }

  // ── 6) Build report server-side (single source of truth) ─────────────
  // The client used to call exam.submitExam(...) + buildReportData(...) and
  // then sb.from("exam_results").insert(...). Both are now server-side so
  // the client can't fabricate score_pct or report_data.
  const inputMap = new Map(inputs.map((i) => [i.slot_key, i]));
  const slotTypeMap: Record<string, string> = {};
  const allAnswers:  Record<string, number> = {};
  const answerKey:   Record<string, number> = {};
  let correct = 0, wrong = 0, skip = 0;
  for (const inp of inputs) {
    const r = results[inp.slot_key];
    const submitted = inputMap.get(inp.slot_key)?.submitted_index ?? -1;
    allAnswers[inp.slot_key] = submitted;
    answerKey[inp.slot_key]  = r.correct_index ?? -1;
    if (r.is_correct)         correct++;
    else if (submitted < 0)   skip++;
    else                      wrong++;
    const row = byId.get(inp.question_id);
    if (row) slotTypeMap[inp.slot_key] = row.type;
  }
  const total     = inputs.length;
  const score_pct = total > 0 ? Math.round((correct / total) * 100) : 0;
  const level     = typeof body.level === "string" ? body.level : "";
  const report    = buildReportData(answerKey, allAnswers, level, slotTypeMap);

  // ── 7) Persist exam_results AFTER the response — only for single-exam
  // + logged-in submits. Target practice (multiple parent exam_ids) and
  // guest sessions skip the insert; client still gets the report back
  // for local-only history.
  //
  // after() runs the callback once the response has been sent, so the
  // user no longer waits on the round-trip. The session_key was already
  // hashed for the seed lookup — reuse it instead of re-hashing.
  if (authUserId && examIds.length === 1) {
    const examIdSingle = examIds[0];
    const sessionKey   = sessionKeys[examIds.indexOf(examIdSingle)];
    after(async () => {
      const { error: insertErr } = await sb.from("exam_results").insert({
        user_id:     authUserId,
        exam_id:     examIdSingle,
        session_key: sessionKey,
        score_pct,
        correct,
        wrong,
        skip,
        total,
        time_spent:  typeof body.time_spent === "number" ? body.time_spent : 0,
        report_data: report,
      });
      // 23505 = duplicate key on session_key — same submission retried,
      // not an error. Any OTHER error gets logged.
      if (insertErr && (insertErr as { code?: string }).code !== "23505") {
        console.error("[submit-batch] exam_results insert failed:", insertErr.message);
      }
    });
  }

  return NextResponse.json({
    results,
    report_data: report,
    score: { correct, wrong, skip, total, score_pct },
  });
}

export function GET()    { return jsonError(405, "Method not allowed"); }
export function PUT()    { return jsonError(405, "Method not allowed"); }
export function DELETE() { return jsonError(405, "Method not allowed"); }
export function PATCH()  { return jsonError(405, "Method not allowed"); }

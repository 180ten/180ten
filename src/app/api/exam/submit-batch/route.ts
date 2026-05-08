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

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { buildBalancedPositionMapForQuestions, expectedPosForSlot, type AnswerPositionMap, type RawQuestion } from "@/lib/examShuffle";

interface BatchInput {
  question_id: string;
  exam_id: string;
  slot_key: string;
  submitted_index: number;
}

interface BatchBody {
  inputs?: BatchInput[];
  /** Required for guest sessions — same value used at /start. */
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

  // ── 1) Auth (single check for entire batch) ─────────────────────────
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";

  const sb = createClient(SUPA_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let authUserId: string | null = null;
  let tokenInvalid = false;
  if (token) {
    const { data: userRes, error: userErr } = await sb.auth.getUser(token);
    if (userRes?.user) authUserId = userRes.user.id;
    else tokenInvalid = !!userErr || !userRes?.user;
  }

  // ── 2) Parse body ────────────────────────────────────────────────────
  let body: BatchBody;
  try {
    body = (await req.json()) as BatchBody;
  } catch {
    return jsonError(400, "Body must be JSON");
  }

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

  // ── 3) Auth resolution (same as single endpoint) ─────────────────────
  if (!authUserId) {
    if (tokenInvalid) {
      return jsonError(401, "Token expired or invalid — refresh session and retry");
    }
    if (typeof body.guest_seed !== "string" || body.guest_seed.length < 8) {
      return jsonError(400, "Missing guest_seed (issued by /start)");
    }
  }
  const shuffleSeed = authUserId ?? (body.guest_seed as string);

  // ── 4) Fetch all unique questions in ONE DB query ────────────────────
  const uniqueIds = Array.from(new Set(inputs.map((i) => i.question_id)));
  const { data: rows, error: qErr } = await sb
    .from("questions")
    .select("id,exam_id,type,level,order_index,data")
    .in("id", uniqueIds);

  if (qErr) return jsonError(500, qErr.message);
  if (!rows || rows.length === 0) return jsonError(404, "No questions found");

  // Each row also carries its own exam_id (used to verify cross-exam attacks).
  type DbRow = RawQuestion & { exam_id: string };
  const byId = new Map<string, DbRow>();
  for (const r of rows) byId.set(String(r.id), r as unknown as DbRow);

  const examIds = Array.from(new Set(inputs.map((i) => i.exam_id)));
  const { data: scopeRows, error: scopeErr } = await sb
    .from("questions")
    .select("id,exam_id,type,level,order_index,data")
    .in("exam_id", examIds);
  if (scopeErr) return jsonError(500, scopeErr.message);

  const posMaps: Record<string, AnswerPositionMap> = {};
  for (const examId of examIds) {
    const rawRows = ((scopeRows ?? []) as unknown as DbRow[]).filter((r) => String(r.exam_id) === examId);
    posMaps[examId] = buildBalancedPositionMapForQuestions(rawRows, shuffleSeed, examId);
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

    const expected = expectedPosForSlot(row, inp.slot_key, shuffleSeed, inp.exam_id, posMaps[inp.exam_id]);
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

  return NextResponse.json({ results });
}

export function GET()    { return jsonError(405, "Method not allowed"); }
export function PUT()    { return jsonError(405, "Method not allowed"); }
export function DELETE() { return jsonError(405, "Method not allowed"); }
export function PATCH()  { return jsonError(405, "Method not allowed"); }

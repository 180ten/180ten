// src/app/api/exam/submit-answer/route.ts
//
// POST /api/exam/submit-answer
//
// Server-side answer grading. Re-derives the deterministic shuffled position
// for the slot using the same hash as /api/exam/[id]/start, then compares
// against the user's submitted_index.
//
// Required env vars:
//   NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// Headers:  Authorization: Bearer <user JWT>
// Request:  { question_id, exam_id, slot_key, submitted_index }
// Response: { is_correct: boolean, score: number, correct_index: number }
//
// `correct_index` is revealed only after submit so the client can render
// the post-submit review screen (green/red highlight).

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { buildBalancedPositionMapForQuestions, expectedPosForSlot, type RawQuestion } from "@/lib/examShuffle";
import { hashSHA256 } from "@/lib/serverUtils";

interface SubmitBody {
  question_id?: string;
  exam_id?: string;
  slot_key?: string;
  submitted_index?: number;
  /** @deprecated — server now derives the seed from (cookie identity,
   *  exam_id, server secret) via exam_sessions; the client value is ignored. */
  guest_seed?: string;
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

  // 1) Auth — OPTIONAL. Same shuffle seed as /start: real uid for logged-in,
  // "guest" otherwise. The deterministic shuffle ensures the SAME exam loaded
  // anonymously is graded with the SAME positions.
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";

  const sb = createClient(SUPA_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let authUserId: string | null = null;
  // tokenInvalid = true means: caller sent a Bearer token but it's invalid/expired.
  // We need to differentiate this from "no token at all" so the client can retry
  // with a refreshed token (401) instead of giving up (400).
  let tokenInvalid = false;
  if (token) {
    const { data: userRes, error: userErr } = await sb.auth.getUser(token);
    if (userRes?.user) authUserId = userRes.user.id;
    else tokenInvalid = !!userErr || !userRes?.user;
  }

  // 2) Body
  let body: SubmitBody;
  try {
    body = (await req.json()) as SubmitBody;
  } catch {
    return jsonError(400, "Body must be JSON");
  }
  const { question_id, exam_id, slot_key, submitted_index } = body;
  // submitted_index === -1 means "reveal-only" (user didn't pick) — the
  // response still includes correct_index so the review screen can highlight it.
  if (
    !question_id ||
    !exam_id ||
    !slot_key ||
    submitted_index === undefined ||
    submitted_index === null ||
    !Number.isInteger(submitted_index) ||
    submitted_index < -1
  ) {
    return jsonError(400, "Missing/invalid: question_id, exam_id, slot_key, submitted_index");
  }

  // Identity + per-exam seed lookup (matches submit-batch).
  const SERVER_SEED_SECRET = process.env.SERVER_SEED_SECRET;
  if (!SERVER_SEED_SECRET) return jsonError(500, "SERVER_SEED_SECRET is not set");

  if (!authUserId && tokenInvalid) {
    return jsonError(401, "Token expired or invalid — refresh session and retry");
  }
  const cookieStore = await cookies();
  const guestToken  = cookieStore.get("guest_exam_token")?.value;
  const identity    = authUserId ?? guestToken;
  if (!identity) return jsonError(401, "No valid session — please restart exam");

  const sessionKey = await hashSHA256(`${identity}:${exam_id}:${SERVER_SEED_SECRET}`);
  const { data: session, error: sessionError } = await sb
    .from("exam_sessions")
    .select("seed")
    .eq("session_key", sessionKey)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (sessionError) {
    return jsonError(500, `exam_sessions lookup failed: ${sessionError.message}`);
  }
  if (!session) return jsonError(400, "Session expired — please restart exam");
  const shuffleSeed = (session as { seed: string }).seed;

  // 3) Fetch question (service role bypasses RLS)
  const { data: row, error: qErr } = await sb
    .from("questions")
    .select("id,exam_id,type,level,order_index,data")
    .eq("id", question_id)
    .eq("exam_id", exam_id)
    .maybeSingle();

  if (qErr) return jsonError(500, qErr.message);
  if (!row) return jsonError(404, "Question not found for this exam");

  const { data: scopeRows, error: scopeErr } = await sb
    .from("questions")
    .select("id,exam_id,type,level,order_index,data")
    .eq("exam_id", exam_id);
  if (scopeErr) return jsonError(500, scopeErr.message);
  const posMap = buildBalancedPositionMapForQuestions((scopeRows ?? []) as unknown as RawQuestion[], shuffleSeed, exam_id);

  // 4) Re-derive expected position for this slot
  const expected = expectedPosForSlot(row as unknown as RawQuestion, slot_key, shuffleSeed, exam_id, posMap);
  if (expected === null) {
    return jsonError(400, `Unknown slot_key: ${slot_key}`);
  }

  const isCorrect = submitted_index === expected;
  return NextResponse.json({
    is_correct: isCorrect,
    score: isCorrect ? 1 : 0,
    correct_index: expected,
  });
}

export function GET()    { return jsonError(405, "Method not allowed"); }
export function PUT()    { return jsonError(405, "Method not allowed"); }
export function DELETE() { return jsonError(405, "Method not allowed"); }
export function PATCH()  { return jsonError(405, "Method not allowed"); }

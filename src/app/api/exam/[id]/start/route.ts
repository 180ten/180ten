// src/app/api/exam/[id]/start/route.ts
//
// GET /api/exam/<exam_id>/start
//
// Loads questions for an exam from the server, shuffles each answer slot
// deterministically per (user, exam, slot), strips the `correct` field,
// and returns sanitized questions ready to render.
//
// Headers:  Authorization: Bearer <user JWT>
// Response: { questions: SanitizedQuestion[], slotKeys: string[] }

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { buildBalancedPositionMapForQuestions, sanitizeQuestion, type SanitizedQuestion, type RawQuestion } from "@/lib/examShuffle";

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function jsonError(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!SUPA_URL || !SERVICE_KEY) {
    return jsonError(500, "Server is missing Supabase env vars");
  }

  // 1) Auth — OPTIONAL. Guest users get a stable "guest" seed.
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";

  const sb = createClient(SUPA_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let authUserId: string | null = null;
  if (token) {
    const { data: userRes } = await sb.auth.getUser(token);
    if (userRes?.user) authUserId = userRes.user.id;
    // If token invalid, silently fall through to guest mode below.
  }

  // Mint a per-session grading seed and return it to the client. Logged-in
  // users keep the historical uid seed so existing shuffle positions remain
  // stable, but submit can grade without waiting on a fresh auth lookup.
  const guestSeed = authUserId ?? crypto.randomUUID();
  const shuffleSeed = guestSeed;

  // 2) Resolve exam id from URL
  const { id: examId } = await ctx.params;
  if (!examId) return jsonError(400, "Missing exam id");

  // 3) Verify exam exists, published, and access policy
  const { data: exam, error: examErr } = await sb
    .from("exams")
    .select("id,is_published,is_premium")
    .eq("id", examId)
    .maybeSingle();
  if (examErr) return jsonError(500, examErr.message);
  if (!exam) return jsonError(404, "Exam not found");
  if (exam.is_published === false) return jsonError(403, "Exam is not published");

  // 3b) Server-side paywall — never trust the client's lock state.
  if (exam.is_premium === true) {
    if (!authUserId) {
      return jsonError(401, "Premium subscription required (please log in)");
    }
    const { data: profile, error: pErr } = await sb
      .from("profiles")
      .select("plan,plan_expires_at")
      .eq("id", authUserId)
      .maybeSingle();
    if (pErr) return jsonError(500, pErr.message);
    if (!profile) return jsonError(403, "Profile not found");

    const plan = String((profile as { plan?: string }).plan ?? "free").toLowerCase();
    const isPaid = plan === "premium" || plan === "1year" || plan === "3month" || plan === "lifetime";
    if (!isPaid) return jsonError(403, "Premium subscription required");

    if (plan !== "lifetime") {
      const expRaw = (profile as { plan_expires_at?: string | null }).plan_expires_at;
      if (!expRaw || new Date(expRaw).getTime() < Date.now()) {
        return jsonError(403, "Subscription expired");
      }
    }
  }

  // 4) Load all questions for this exam
  const { data: rows, error: qErr } = await sb
    .from("questions")
    .select("id,exam_id,type,level,order_index,data")
    .eq("exam_id", examId)
    .order("order_index", { ascending: true });

  if (qErr) return jsonError(500, qErr.message);
  if (!rows || rows.length === 0) {
    return NextResponse.json({ questions: [], slotKeys: [] });
  }

  // 5) Sanitize per question + build maps the client needs at submit time
  const sanitized: SanitizedQuestion[] = [];
  const allSlotKeys: string[] = [];
  const slotTypeMap: Record<string, string> = {};
  const slotToQuestionId: Record<string, string> = {};

  const rawRows = rows as unknown as RawQuestion[];
  const posMap = buildBalancedPositionMapForQuestions(rawRows, shuffleSeed, examId);

  for (const row of rawRows) {
    const { sanitized: sq, slotKeys } = sanitizeQuestion(row, shuffleSeed, examId, posMap);
    sanitized.push(sq);
    for (const k of slotKeys) {
      allSlotKeys.push(k);
      slotTypeMap[k] = sq.type;
      slotToQuestionId[k] = sq.id;
    }
  }

  return NextResponse.json({
    questions: sanitized,
    slotKeys: allSlotKeys,
    slotTypeMap,
    slotToQuestionId,
    // The client forwards this on submit so the server can re-derive the
    // same shuffled positions used when the exam was opened.
    guestSeed,
  });
}

// Reject other methods
export function POST()   { return jsonError(405, "Method not allowed"); }
export function PUT()    { return jsonError(405, "Method not allowed"); }
export function DELETE() { return jsonError(405, "Method not allowed"); }
export function PATCH()  { return jsonError(405, "Method not allowed"); }

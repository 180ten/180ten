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
//
// ── Caching strategy ───────────────────────────────────────────────────
// The Supabase fetch (exam metadata + raw questions) is wrapped in
// unstable_cache and tagged `exam-${examId}`. Admin actions invalidate via
// revalidateTag — see /api/admin/exams and /api/admin/revalidate-exam.
//
// SECURITY: only the static parts are cached. Per-request work stays live:
//   • Auth + premium-gate (depends on user JWT + profiles row)
//   • Shuffle position map (uses per-user seed)
//   • sanitizeQuestion mutation (deep-clones cached data first, so cached
//     rows are never mutated and `correct`/`wrongs` never leak)

import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import { buildBalancedPositionMapForQuestions, sanitizeQuestion, type SanitizedQuestion, type RawQuestion } from "@/lib/examShuffle";

// Run on Vercel Edge Runtime — lower cold-start, geo-distributed POPs.
// Verified Edge-safe: Supabase JS v2 uses Web fetch/crypto, examShuffle is
// pure ES, unstable_cache is wired through globalThis.__incrementalCache on
// Vercel's Edge sandbox, and crypto.randomUUID is part of Web Crypto.
export const runtime = "edge";

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

interface CachedExamData {
  exam: { id: string; is_published: boolean; is_premium: boolean };
  rows: RawQuestion[];
}

/**
 * Fetch exam metadata + raw questions from Supabase, cached at the Next.js
 * data-cache layer with a per-exam tag. The cache is invalidated by
 * revalidateTag(`exam-${examId}`) called from admin mutation routes.
 *
 * Cached payload contains `correct`/`wrongs` because the cache is server-only
 * — those fields are stripped by sanitizeQuestion before the response is
 * returned to the client.
 */
function getCachedExamData(
  examId: string,
  onMiss?: () => void,
): Promise<CachedExamData | null> {
  return unstable_cache(
    async (): Promise<CachedExamData | null> => {
      onMiss?.(); // fires only when the cb actually runs (= cache miss)
      if (!SUPA_URL || !SERVICE_KEY) {
        throw new Error("Missing Supabase env vars");
      }
      const sb = createClient(SUPA_URL, SERVICE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      const { data: exam, error: examErr } = await sb
        .from("exams")
        .select("id,is_published,is_premium")
        .eq("id", examId)
        .maybeSingle();
      if (examErr) throw new Error(examErr.message);
      if (!exam) return null;

      const { data: rows, error: qErr } = await sb
        .from("questions")
        .select("id,exam_id,type,level,order_index,data")
        .eq("exam_id", examId)
        .order("order_index", { ascending: true });
      if (qErr) throw new Error(qErr.message);

      return {
        exam: exam as { id: string; is_published: boolean; is_premium: boolean },
        rows: ((rows ?? []) as unknown) as RawQuestion[],
      };
    },
    [`exam-data-${examId}`],
    { tags: [`exam-${examId}`], revalidate: false },
  )();
}

function jsonError(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  // ── Timing instrumentation ────────────────────────────────────────────
  // Each phase is timed; cache hit/miss detected via the `onMiss` callback
  // passed into getCachedExamData (fires only when the inner fetch runs).
  // Remove or gate by env once root-cause is identified.
  const t0 = Date.now();

  if (!SUPA_URL || !SERVICE_KEY) {
    return jsonError(500, "Server is missing Supabase env vars");
  }

  // 1) Auth — OPTIONAL. Guest users get a stable random seed.
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
  const t1 = Date.now();

  const guestSeed = authUserId ?? crypto.randomUUID();
  const shuffleSeed = guestSeed;

  // 2) Resolve exam id from URL
  const { id: examId } = await ctx.params;
  if (!examId) return jsonError(400, "Missing exam id");

  // 3) Cached fetch — exam metadata + raw question rows
  let cacheMissed = false;
  let cached: CachedExamData | null;
  try {
    cached = await getCachedExamData(examId, () => { cacheMissed = true; });
  } catch (e) {
    return jsonError(500, e instanceof Error ? e.message : "Failed to load exam");
  }
  const t2 = Date.now();
  if (!cached) return jsonError(404, "Exam not found");
  const { exam, rows } = cached;
  if (exam.is_published === false) return jsonError(403, "Exam is not published");

  // 3b) Server-side paywall — never trust the client's lock state.
  // Profile lookup runs PER REQUEST (plan can change between requests).
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
  const t3 = Date.now();

  if (rows.length === 0) {
    console.log(`[exam/start] auth.getUser: ${t1 - t0}ms (token=${token ? "yes" : "no"})`);
    console.log(`[exam/start] cache ${cacheMissed ? "MISS" : "HIT"}: ${t2 - t1}ms`);
    console.log(`[exam/start] profiles.select: ${t3 - t2}ms (premium=${exam.is_premium ? "yes" : "no"})`);
    console.log(`[exam/start] sanitize: 0ms (no rows)`);
    console.log(`[exam/start] TOTAL: ${Date.now() - t0}ms`);
    return NextResponse.json({ questions: [], slotKeys: [] });
  }

  // 4) Sanitize per question + build maps the client needs at submit time.
  // sanitizeQuestion deep-clones q.data internally, so the cached `rows`
  // payload is never mutated even though we shuffle in place per-request.
  const sanitized: SanitizedQuestion[] = [];
  const allSlotKeys: string[] = [];
  const slotTypeMap: Record<string, string> = {};
  const slotToQuestionId: Record<string, string> = {};

  const posMap = buildBalancedPositionMapForQuestions(rows, shuffleSeed, examId);

  for (const row of rows) {
    const { sanitized: sq, slotKeys } = sanitizeQuestion(row, shuffleSeed, examId, posMap);
    sanitized.push(sq);
    for (const k of slotKeys) {
      allSlotKeys.push(k);
      slotTypeMap[k] = sq.type;
      slotToQuestionId[k] = sq.id;
    }
  }
  const t4 = Date.now();

  console.log(`[exam/start] auth.getUser: ${t1 - t0}ms (token=${token ? "yes" : "no"})`);
  console.log(`[exam/start] cache ${cacheMissed ? "MISS" : "HIT"}: ${t2 - t1}ms`);
  console.log(`[exam/start] profiles.select: ${t3 - t2}ms (premium=${exam.is_premium ? "yes" : "no"})`);
  console.log(`[exam/start] sanitize: ${t4 - t3}ms (rows=${rows.length}, slots=${allSlotKeys.length})`);
  console.log(`[exam/start] TOTAL: ${t4 - t0}ms (examId=${examId})`);

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

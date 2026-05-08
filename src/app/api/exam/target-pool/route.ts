// src/app/api/exam/target-pool/route.ts
//
// POST /api/exam/target-pool
//
// Builds a "synthetic exam session" from a random subset of questions
// matching (level, mondai_type) across ALL published exams.
//
// Request body:  { level: "N1"|...|"BJT", mondaiType: string, count: number }
// Response:      { questions, slotKeys, slotTypeMap, slotToQuestionId,
//                  slotToExamId, guestSeed, virtualExam }

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { buildBalancedPositionMapForQuestions, sanitizeQuestion, type AnswerPositionMap, type SanitizedQuestion, type RawQuestion } from "@/lib/examShuffle";

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const ALLOWED_LEVELS = new Set(["N1", "N2", "N3", "N4", "N5", "BJT"]);
const ALLOWED_MONDAI = new Set([
  "kanji","hyouki","iikae","bunmyaku","yoho",
  "bunpo1","bunpo2","bunsho","togo",
  "tan","chu","cho","joho","shudai",
  "listen_kadai","listen_point","listen_gaiyou","listen_hatsuwa","listen_sokuji","listen_togo",
  "bjt_1_1","bjt_1_2","bjt_1_3","bjt_2_1","bjt_2_2","bjt_2_3","bjt_3_1","bjt_3_2","bjt_3_3",
]);

function jsonError(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!SUPA_URL || !SERVICE_KEY) {
    return jsonError(500, "Server is missing Supabase env vars");
  }

  // 1) Parse + validate body
  let body: { level?: string; mondaiType?: string; count?: number };
  try { body = await req.json(); } catch { return jsonError(400, "Invalid JSON body"); }
  const level = String(body.level ?? "");
  const mondaiType = String(body.mondaiType ?? "");
  const wantCount = Math.max(1, Math.min(100, Number(body.count ?? 10)));
  if (!ALLOWED_LEVELS.has(level)) return jsonError(400, "Invalid level");
  if (!ALLOWED_MONDAI.has(mondaiType)) return jsonError(400, "Invalid mondaiType");

  const sb = createClient(SUPA_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 2) Auth (optional) — every session gets a seed the client can reuse when submitting
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
  let authUserId: string | null = null;
  if (token) {
    const { data: userRes } = await sb.auth.getUser(token);
    if (userRes?.user) authUserId = userRes.user.id;
  }
  const guestSeed = authUserId ?? crypto.randomUUID();

  // 3) Find published exams of the requested level (used to filter questions)
  const { data: examsData, error: eErr } = await sb
    .from("exams")
    .select("id,name,year,level,is_published,is_premium")
    .eq("level", level)
    .eq("is_published", true);
  if (eErr) return jsonError(500, eErr.message);
  const examIds = (examsData ?? []).map((e) => String(e.id));
  if (examIds.length === 0) {
    return NextResponse.json({ questions: [], slotKeys: [], slotTypeMap: {}, slotToQuestionId: {}, slotToExamId: {}, guestSeed, virtualExam: { id: "target-empty", name: "Target Practice", level } });
  }

  // 4) Pull all matching questions across those exams
  const { data: rows, error: qErr } = await sb
    .from("questions")
    .select("id,exam_id,type,level,order_index,data")
    .in("exam_id", examIds)
    .eq("type", mondaiType);
  if (qErr) return jsonError(500, qErr.message);
  console.log("[target-pool]", {
    level, mondaiType, wantCount,
    examsForLevel: examIds.length,
    rowsMatched: rows?.length ?? 0,
    uniqueExamIds: rows ? new Set(rows.map((r) => String(r.exam_id))).size : 0,
  });
  if (!rows || rows.length === 0) {
    return NextResponse.json({
      questions: [], slotKeys: [], slotTypeMap: {}, slotToQuestionId: {}, slotToExamId: {},
      guestSeed, virtualExam: { id: "target-empty", name: "Target Practice", level },
      meta: { totalAvailable: 0, sourceExamCount: 0 },
    });
  }

  // 5) Random N rows (Fisher-Yates partial shuffle)
  const arr = [...rows];
  const take = Math.min(wantCount, arr.length);
  for (let i = 0; i < take; i++) {
    const j = i + Math.floor(Math.random() * (arr.length - i));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  const picked = arr.slice(0, take) as unknown as (RawQuestion & { exam_id: string })[];

  // 6) Sanitize each question with its OWN parent exam_id as shuffle seed
  const shuffleUserSeed = guestSeed;
  const sanitized: SanitizedQuestion[] = [];
  const allSlotKeys: string[] = [];
  const slotTypeMap: Record<string, string> = {};
  const slotToQuestionId: Record<string, string> = {};
  const slotToExamId: Record<string, string> = {};
  const parentExamIds = Array.from(new Set(picked.map((p) => String(p.exam_id))));
  const { data: parentRows, error: parentErr } = await sb
    .from("questions")
    .select("id,exam_id,type,level,order_index,data")
    .in("exam_id", parentExamIds);
  if (parentErr) return jsonError(500, parentErr.message);
  const posMaps: Record<string, AnswerPositionMap> = {};
  for (const examId of parentExamIds) {
    const rawRows = ((parentRows ?? []) as unknown as (RawQuestion & { exam_id: string })[]).filter((r) => String(r.exam_id) === examId);
    posMaps[examId] = buildBalancedPositionMapForQuestions(rawRows, shuffleUserSeed, examId);
  }

  for (let i = 0; i < picked.length; i++) {
    const row = picked[i];
    const parentExamId = String(row.exam_id);
    // Override order_index so the synthetic exam renders questions in pulled order
    const rowWithOrder: RawQuestion = { ...row, order_index: i };
    const { sanitized: sq, slotKeys } = sanitizeQuestion(rowWithOrder, shuffleUserSeed, parentExamId, posMaps[parentExamId]);
    sanitized.push(sq);
    for (const k of slotKeys) {
      allSlotKeys.push(k);
      slotTypeMap[k] = sq.type;
      slotToQuestionId[k] = sq.id;
      slotToExamId[k] = parentExamId;
    }
  }

  const sourceExamCount = new Set(picked.map((p) => String(p.exam_id))).size;
  return NextResponse.json({
    questions: sanitized,
    slotKeys: allSlotKeys,
    slotTypeMap,
    slotToQuestionId,
    slotToExamId,
    guestSeed,
    virtualExam: {
      id: `target-${level}-${mondaiType}-${Date.now()}`,
      name: `Target ${level} · ${mondaiType}`,
      level,
    },
    meta: {
      totalAvailable: rows.length,
      sourceExamCount,
    },
  });
}

export function GET()    { return jsonError(405, "Method not allowed"); }
export function PUT()    { return jsonError(405, "Method not allowed"); }
export function DELETE() { return jsonError(405, "Method not allowed"); }
export function PATCH()  { return jsonError(405, "Method not allowed"); }

// POST /api/admin/exams — admin-only mutations on exams + questions
import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { requireAdmin, adminErrorResponse } from "@/lib/supabase-admin";

type Body =
  | { action: "toggle_publish" | "toggle_premium"; exam_id: string; value?: boolean }
  | { action: "delete"; exam_id: string }
  | { action: "upsert_exam"; examRow: Record<string, unknown> }
  | { action: "upsert_questions"; questions: Record<string, unknown>[] }
  | { action: "delete_questions"; exam_id: string; ids: string[] };

// Allowlist of exam columns the client may set — keeps unknown / sensitive
// fields out of the DB even if the caller is admin-authenticated.
const EXAM_ALLOWED = new Set([
  "id", "name", "level", "question_count",
  "is_published", "is_premium", "audio_url", "year",
]);
const QUESTION_ALLOWED = new Set([
  "id", "exam_id", "type", "level", "order_index", "data",
  "audio_url", "audio_script",
]);
function pickAllowed<T extends Record<string, unknown>>(input: T, allowed: Set<string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) if (allowed.has(k)) out[k] = v;
  return out;
}

export async function POST(req: Request) {
  try {
    const { service } = await requireAdmin(req);
    const body = (await req.json()) as Body;

    if (body.action === "upsert_exam") {
      if (!body.examRow || typeof body.examRow !== "object") {
        return NextResponse.json({ error: "examRow required" }, { status: 400 });
      }
      const cleaned = pickAllowed(body.examRow, EXAM_ALLOWED);
      const { error } = await service.from("exams").upsert(cleaned);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      const id = cleaned.id;
      if (typeof id === "string") revalidateTag(`exam-${id}`, "max");
      return NextResponse.json({ ok: true });
    }

    if (body.action === "delete_questions") {
      // Remove specific question rows the admin deleted in the composer
      // before the next upsert step inserts the surviving ones. Scoped
      // to exam_id so a malformed payload can't wipe rows from a
      // different exam. Same 50-per-call cap as upsert_questions; the
      // client chunks if it sent more.
      if (!body.exam_id || typeof body.exam_id !== "string") {
        return NextResponse.json({ error: "exam_id required" }, { status: 400 });
      }
      if (!Array.isArray(body.ids) || body.ids.length === 0) {
        return NextResponse.json({ ok: true, count: 0 });
      }
      if (body.ids.length > 50) {
        return NextResponse.json({ error: "max 50 ids per call" }, { status: 400 });
      }
      const ids = body.ids.filter((id): id is string => typeof id === "string" && id.length > 0);
      if (ids.length === 0) return NextResponse.json({ ok: true, count: 0 });
      const { error } = await service
        .from("questions")
        .delete()
        .eq("exam_id", body.exam_id)
        .in("id", ids);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      revalidateTag(`exam-${body.exam_id}`, "max");
      return NextResponse.json({ ok: true, count: ids.length });
    }

    if (body.action === "upsert_questions") {
      if (!Array.isArray(body.questions) || body.questions.length === 0) {
        return NextResponse.json({ error: "questions required" }, { status: 400 });
      }
      // Hard cap chunk size at 50 — matches the client chunking and keeps
      // a single request payload bounded.
      if (body.questions.length > 50) {
        return NextResponse.json({ error: "max 50 questions per call" }, { status: 400 });
      }
      const cleaned = body.questions.map((q) => pickAllowed(q, QUESTION_ALLOWED));
      const { error } = await service.from("questions").upsert(cleaned);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true, count: cleaned.length });
    }

    if (!body?.exam_id) return NextResponse.json({ error: "exam_id required" }, { status: 400 });

    if (body.action === "toggle_publish") {
      const { error } = await service.from("exams")
        .update({ is_published: body.value }).eq("id", body.exam_id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      revalidateTag(`exam-${body.exam_id}`, "max");
      return NextResponse.json({ ok: true });
    }

    if (body.action === "toggle_premium") {
      const { error } = await service.from("exams")
        .update({ is_premium: body.value }).eq("id", body.exam_id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      revalidateTag(`exam-${body.exam_id}`, "max");
      return NextResponse.json({ ok: true });
    }

    if (body.action === "delete") {
      // Delete questions first (FK)
      const { error: qErr } = await service.from("questions").delete().eq("exam_id", body.exam_id);
      if (qErr) return NextResponse.json({ error: qErr.message }, { status: 500 });
      const { error } = await service.from("exams").delete().eq("id", body.exam_id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      revalidateTag(`exam-${body.exam_id}`, "max");
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) { return adminErrorResponse(e); }
}

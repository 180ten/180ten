// POST /api/admin/exams — admin-only mutations on exams + questions
import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { requireAdmin, adminErrorResponse } from "@/lib/supabase-admin";

interface Body {
  action: "toggle_publish" | "toggle_premium" | "delete";
  exam_id: string;
  /** required for toggle_publish/toggle_premium: the new value */
  value?: boolean;
}

export async function POST(req: Request) {
  try {
    const { service } = await requireAdmin(req);
    const body = (await req.json()) as Body;

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

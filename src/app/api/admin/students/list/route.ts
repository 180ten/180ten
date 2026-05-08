// GET /api/admin/students/list — admin-only listing of all students.
// Service-role bypasses RLS so admin always sees the full list.

import { NextResponse } from "next/server";
import { requireAdmin, adminErrorResponse } from "@/lib/supabase-admin";

export async function GET(req: Request) {
  try {
    const { service } = await requireAdmin(req);

    const { data: profiles, error } = await service
      .from("profiles")
      .select("id,email,name,role,plan,plan_expires_at,created_at")
      .order("created_at", { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const ids = (profiles ?? []).map((p) => p.id).filter(Boolean);
    const examsDone: Record<string, number> = {};
    if (ids.length) {
      const { data: er } = await service.from("exam_results").select("user_id").in("user_id", ids);
      (er ?? []).forEach((r: { user_id: string }) => {
        examsDone[r.user_id] = (examsDone[r.user_id] ?? 0) + 1;
      });
    }

    const students = (profiles ?? []).map((p) => ({
      ...p,
      exams_done: examsDone[p.id] ?? 0,
    }));

    return NextResponse.json({ students });
  } catch (e) {
    return adminErrorResponse(e);
  }
}

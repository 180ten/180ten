// POST /api/admin/students — admin-only mutations on profiles + cleanup
import { NextResponse } from "next/server";
import { requireAdmin, adminErrorResponse } from "@/lib/supabase-admin";

type Body =
  | { action: "update_plan"; user_id: string; plan: string; plan_expires_at: string | null }
  | { action: "delete";      user_id: string };

export async function POST(req: Request) {
  try {
    const { service } = await requireAdmin(req);
    const body = (await req.json()) as Body;
    if (!body?.user_id) return NextResponse.json({ error: "user_id required" }, { status: 400 });

    if (body.action === "update_plan") {
      const { data, error } = await service.from("profiles")
        .update({ plan: body.plan, plan_expires_at: body.plan_expires_at })
        .eq("id", body.user_id)
        .select("id,plan");
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      if (!data || data.length === 0) {
        return NextResponse.json({ error: "Profile not found" }, { status: 404 });
      }
      return NextResponse.json({ ok: true, profile: data[0] });
    }

    if (body.action === "delete") {
      // FK cleanup: exam_results, payment_requests, leaderboard_weekly
      await service.from("exam_results").delete().eq("user_id", body.user_id);
      await service.from("payment_requests").delete().eq("user_id", body.user_id);
      await service.from("leaderboard_weekly").delete().eq("user_id", body.user_id);
      // Try DB function first; fallback: nullify profile
      const { error: rpcErr } = await service.rpc("delete_user_by_admin", {
        target_user_id: body.user_id,
      });
      if (rpcErr) {
        const { error: pErr } = await service.from("profiles").delete().eq("id", body.user_id);
        if (pErr) {
          await service.from("profiles").update({
            plan: "free", plan_expires_at: null, name: "[Đã xoá]",
          }).eq("id", body.user_id);
        }
      }
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) { return adminErrorResponse(e); }
}

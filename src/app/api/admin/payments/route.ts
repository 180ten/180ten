// POST /api/admin/payments — admin-only payment review (approve/reject/delete)
import { NextResponse } from "next/server";
import { requireAdmin, adminErrorResponse } from "@/lib/supabase-admin";

type Body =
  | { action: "approve"; req_id: string; user_id: string; plan: string; admin_email?: string }
  | { action: "reject";  req_id: string; admin_email?: string }
  | { action: "delete";  req_id: string }
  | { action: "delete_screenshot"; req_id: string; screenshot_url?: string };

function pathFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  const marker = "payment-screenshots/";
  const idx = url.indexOf(marker);
  return idx >= 0 ? url.substring(idx + marker.length) : null;
}

export async function POST(req: Request) {
  try {
    const { service, email } = await requireAdmin(req);
    const body = (await req.json()) as Body;

    if (body.action === "approve") {
      const profilePlan = body.plan === "1year" ? "premium" : body.plan;
      // expiry: end of day +N days
      function endOfDayPlus(days: number) {
        const d = new Date(); d.setDate(d.getDate() + days); d.setHours(23,59,59,999);
        return d.toISOString();
      }
      const expires =
        body.plan === "1year"  ? endOfDayPlus(365)
        : body.plan === "3month" ? endOfDayPlus(90)
        : null;

      const { data, error: pErr } = await service.from("profiles")
        .update({ plan: profilePlan, plan_expires_at: expires })
        .eq("id", body.user_id)
        .select("id");
      if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
      if (!data || data.length === 0) return NextResponse.json({ error: "User not found" }, { status: 404 });

      const { error: rErr } = await service.from("payment_requests").update({
        status: "approved",
        reviewed_at: new Date().toISOString(),
        reviewed_by: body.admin_email ?? email ?? "admin",
      }).eq("id", body.req_id);
      if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    if (body.action === "reject") {
      const { error } = await service.from("payment_requests").update({
        status: "rejected",
        reviewed_at: new Date().toISOString(),
        reviewed_by: body.admin_email ?? email ?? "admin",
      }).eq("id", body.req_id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    if (body.action === "delete") {
      // Pull screenshot URL first to also clean storage
      const { data: row } = await service.from("payment_requests")
        .select("screenshot").eq("id", body.req_id).maybeSingle();
      const path = pathFromUrl((row as { screenshot?: string } | null)?.screenshot);
      if (path) await service.storage.from("payment-screenshots").remove([path]);
      const { error } = await service.from("payment_requests").delete().eq("id", body.req_id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    if (body.action === "delete_screenshot") {
      const path = pathFromUrl(body.screenshot_url);
      if (path) await service.storage.from("payment-screenshots").remove([path]);
      const { error } = await service.from("payment_requests")
        .update({ screenshot: null }).eq("id", body.req_id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) { return adminErrorResponse(e); }
}

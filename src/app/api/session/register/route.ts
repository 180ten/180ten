// src/app/api/session/register/route.ts
//
// POST /api/session/register
//
// Body:    { device_id, device_name }
// Auth:    Bearer <user JWT>
// Returns: { ok: true, kicked: boolean, session_id: string }
//
// `session_id` is the UUID of THIS device's row in user_sessions. The
// client uses it as a Realtime filter — when the row is DELETEd by a
// concurrent /register from a sibling device that exceeded the cap, the
// kicked client signs itself out.
//
// Bookkeeping for the anti-account-sharing feature:
//   - Updates last_active if (user_id, device_id) already exists.
//   - Otherwise inserts a new row. If that would exceed the per-plan
//     session cap, the OLDEST session is deleted first ("kick"). The
//     client surfaces a toast when kicked === true.
//
// Plan caps:
//   free                                    → 1 device
//   premium / 1year / 3month / lifetime     → 2 devices
//
// SECURITY: service role bypasses RLS; the client (anon/authenticated)
// can only SELECT its own rows via the policy in the migration.

import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-admin";

const SESSION_LIMITS: Record<string, number> = {
  free:     1,
  premium:  2,
  "1year":  2,
  "3month": 2,
  lifetime: 2,
};

function jsonError(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

export async function POST(req: Request): Promise<NextResponse> {
  let service;
  try { service = getServiceClient(); }
  catch (e) { return jsonError(500, (e as Error).message); }

  // 1) Auth
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!token) return jsonError(401, "Missing Authorization");
  const { data: userRes, error: userErr } = await service.auth.getUser(token);
  if (userErr || !userRes?.user) return jsonError(401, "Invalid token");
  const userId = userRes.user.id;

  // 2) Body
  let body: { device_id?: string; device_name?: string };
  try { body = await req.json(); }
  catch { return jsonError(400, "Body must be JSON"); }
  const deviceId   = String(body.device_id ?? "").trim();
  const deviceName = body.device_name ? String(body.device_name).slice(0, 80) : null;
  if (!deviceId || deviceId.length > 100) return jsonError(400, "Invalid device_id");

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? null;

  // 3) Resolve plan + cap
  const { data: profile, error: pErr } = await service
    .from("profiles")
    .select("plan, plan_expires_at")
    .eq("id", userId)
    .maybeSingle();
  if (pErr) return jsonError(500, `profile lookup failed: ${pErr.message}`);

  const rawPlan = String((profile as { plan?: string } | null)?.plan ?? "free").toLowerCase();
  const expRaw  = (profile as { plan_expires_at?: string | null } | null)?.plan_expires_at ?? null;
  const isExpired = rawPlan !== "lifetime" && rawPlan !== "free" && expRaw
    && new Date(expRaw).getTime() < Date.now();
  const effectivePlan = isExpired ? "free" : rawPlan;
  const maxSessions   = SESSION_LIMITS[effectivePlan] ?? 1;

  // 4) Existing sessions (newest first)
  const { data: sessions, error: sErr } = await service
    .from("user_sessions")
    .select("id, device_id, last_active")
    .eq("user_id", userId)
    .order("last_active", { ascending: false });
  if (sErr) return jsonError(500, `sessions lookup failed: ${sErr.message}`);

  const existing = (sessions ?? []) as { id: string; device_id: string; last_active: string }[];
  const now = new Date().toISOString();

  // 4a) Same device → just refresh last_active + ip
  const sameDevice = existing.find((s) => s.device_id === deviceId);
  if (sameDevice) {
    const { error: uErr } = await service.from("user_sessions")
      .update({ last_active: now, ip })
      .eq("id", sameDevice.id);
    if (uErr) return jsonError(500, `session update failed: ${uErr.message}`);
    return NextResponse.json({ ok: true, kicked: false, session_id: sameDevice.id });
  }

  // 4b) Otherwise: kick oldest if at cap, then insert new
  let kicked = false;
  if (existing.length >= maxSessions) {
    const oldest = existing[existing.length - 1];
    const { error: dErr } = await service.from("user_sessions")
      .delete().eq("id", oldest.id);
    if (dErr) return jsonError(500, `session kick failed: ${dErr.message}`);
    kicked = true;
  }

  const { data: inserted, error: iErr } = await service.from("user_sessions").insert({
    user_id:     userId,
    device_id:   deviceId,
    device_name: deviceName,
    ip,
    last_active: now,
  }).select("id").single();
  if (iErr) return jsonError(500, `session insert failed: ${iErr.message}`);

  return NextResponse.json({
    ok:         true,
    kicked,
    session_id: (inserted as { id: string }).id,
  });
}

export function GET()    { return jsonError(405, "Method not allowed"); }
export function PUT()    { return jsonError(405, "Method not allowed"); }
export function DELETE() { return jsonError(405, "Method not allowed"); }
export function PATCH()  { return jsonError(405, "Method not allowed"); }

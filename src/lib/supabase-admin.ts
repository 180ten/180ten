// src/lib/supabase-admin.ts
// SERVER-ONLY. Service-role Supabase client + admin-JWT verification helper.
// Never import this from a "use client" file.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/** Throws-on-error builder for the service-role client (bypasses RLS). */
export function getServiceClient(): SupabaseClient {
  if (!SUPA_URL)     throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  if (!SERVICE_KEY)  throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return createClient(SUPA_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export class AdminError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface AdminContext {
  userId: string;
  email: string;
  /** Service-role client — use this for the actual DB op. */
  service: SupabaseClient;
}

/**
 * Verify the request bearer token belongs to a user whose
 * `profiles.role = 'admin'`. Returns a service-role client + caller info.
 *
 * Usage in any route handler:
 *   try {
 *     const { service, email } = await requireAdmin(req);
 *     // …do the privileged op via `service`
 *   } catch (e) {
 *     return adminErrorResponse(e);
 *   }
 */
export async function requireAdmin(req: Request): Promise<AdminContext> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : "";
  if (!token) throw new AdminError(401, "Missing Authorization: Bearer <jwt>");

  const service = getServiceClient();

  const { data: userRes, error: userErr } = await service.auth.getUser(token);
  if (userErr || !userRes?.user) {
    throw new AdminError(401, `Invalid or expired token: ${userErr?.message ?? "no user"}`);
  }
  const userId = userRes.user.id;
  const email  = userRes.user.email ?? "";

  const { data: profile, error: pErr } = await service
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  if (pErr) {
    throw new AdminError(500, `DB error checking role: ${pErr.message}`);
  }
  if (!profile) {
    throw new AdminError(403, `Profile row missing for user ${email}. Run: insert into profiles(id,role) values('${userId}','admin') on conflict(id) do update set role='admin';`);
  }
  const role = (profile as { role?: string }).role;
  if (role !== "admin") {
    throw new AdminError(403, `User ${email} has role='${role ?? "null"}', expected 'admin'.`);
  }

  return { userId, email, service };
}

import { NextResponse } from "next/server";

export function adminErrorResponse(e: unknown): NextResponse {
  if (e instanceof AdminError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[adminApi] unhandled:", e);
  return NextResponse.json({ error: "Internal error" }, { status: 500 });
}

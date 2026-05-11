// src/app/api/admin/security/route.ts
//
// Admin endpoint that aggregates anti-account-sharing telemetry.
//
//   GET  /api/admin/security             → full payload (anomalies + sessions)
//   GET  /api/admin/security?count=true  → just the badge count for sidebar
//   POST /api/admin/security  { action: "force_logout", user_id }
//        → DELETE every user_sessions row for that user. The Realtime DELETE
//          handler in useAuth on each device then signs itself out.
//
// All branches require admin auth (requireAdmin).

import { NextResponse } from "next/server";
import { requireAdmin, adminErrorResponse } from "@/lib/supabase-admin";

const WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function jsonError(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

interface AnomalyRow {
  user_id:    string;
  event_type: string;
  detail:     Record<string, unknown> | null;
  created_at: string;
}

interface SessionRow {
  id:          string;
  user_id:     string;
  device_id:   string;
  device_name: string | null;
  ip:          string | null;
  last_active: string;
  created_at:  string;
}

interface ProfileRow {
  id:    string;
  email: string | null;
  name:  string | null;
  plan:  string | null;
}

export async function GET(req: Request) {
  try {
    const { service } = await requireAdmin(req);
    const url    = new URL(req.url);
    const cutoff = new Date(Date.now() - WINDOW_MS).toISOString();

    // ── Pull anomalies in window ──
    const { data: anomaliesRaw, error: aErr } = await service
      .from("anomaly_events")
      .select("user_id, event_type, detail, created_at")
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false })
      .limit(1000);
    if (aErr) return jsonError(500, `anomaly lookup failed: ${aErr.message}`);
    const anomalies = (anomaliesRaw ?? []) as AnomalyRow[];

    // count=true → just the unique-user count for the sidebar badge
    if (url.searchParams.get("count") === "true") {
      const uniq = new Set(anomalies.map((a) => a.user_id)).size;
      return NextResponse.json({ count: uniq });
    }

    // ── Pull active sessions (broader: include all current sessions) ──
    const { data: sessionsRaw, error: sErr } = await service
      .from("user_sessions")
      .select("id, user_id, device_id, device_name, ip, last_active, created_at")
      .order("last_active", { ascending: false })
      .limit(2000);
    if (sErr) return jsonError(500, `sessions lookup failed: ${sErr.message}`);
    const sessions = (sessionsRaw ?? []) as SessionRow[];

    // ── Pull profile rows for user_ids referenced by either set ──
    const userIds = Array.from(new Set([
      ...anomalies.map((a) => a.user_id),
      ...sessions.map((s) => s.user_id),
    ]));
    let profilesById = new Map<string, ProfileRow>();
    if (userIds.length > 0) {
      const { data: profilesRaw, error: pErr } = await service
        .from("profiles")
        .select("id, email, name, plan")
        .in("id", userIds);
      if (pErr) return jsonError(500, `profile lookup failed: ${pErr.message}`);
      profilesById = new Map(((profilesRaw ?? []) as ProfileRow[]).map((p) => [p.id, p]));
    }

    // ── Group anomalies by user (count + ips + types + recent events) ──
    type AnomalyGroup = {
      user_id:    string;
      profile:    ProfileRow | null;
      total:      number;
      types:      Record<string, number>;
      ips:        string[];
      latest:     string;
      events:     AnomalyRow[];   // raw, sorted desc, capped 20
    };
    const groupMap = new Map<string, AnomalyGroup>();
    for (const ev of anomalies) {
      let g = groupMap.get(ev.user_id);
      if (!g) {
        g = {
          user_id: ev.user_id,
          profile: profilesById.get(ev.user_id) ?? null,
          total:   0,
          types:   {},
          ips:     [],
          latest:  ev.created_at,
          events:  [],
        };
        groupMap.set(ev.user_id, g);
      }
      g.total++;
      g.types[ev.event_type] = (g.types[ev.event_type] ?? 0) + 1;
      const ip = (ev.detail as { ip?: string } | null)?.ip;
      if (ip && !g.ips.includes(ip)) g.ips.push(ip);
      if (g.events.length < 20) g.events.push(ev);
      // latest already set on first occurrence (sorted desc)
    }
    const anomalyUsers = Array.from(groupMap.values())
      .sort((a, b) => b.total - a.total);

    // ── Group active sessions by user ──
    type SessionGroup = {
      user_id:  string;
      profile:  ProfileRow | null;
      sessions: SessionRow[];
    };
    const sessionGroupMap = new Map<string, SessionGroup>();
    for (const s of sessions) {
      let g = sessionGroupMap.get(s.user_id);
      if (!g) {
        g = { user_id: s.user_id, profile: profilesById.get(s.user_id) ?? null, sessions: [] };
        sessionGroupMap.set(s.user_id, g);
      }
      g.sessions.push(s);
    }
    // Show users with multiple sessions first, then everyone else
    const activeUsers = Array.from(sessionGroupMap.values())
      .sort((a, b) => b.sessions.length - a.sessions.length);

    return NextResponse.json({
      windowDays:     7,
      anomalyUsers,                       // [{ user_id, profile, total, types, ips, latest, events }]
      activeUsers,                        // [{ user_id, profile, sessions }]
      anomalyUserCount: anomalyUsers.length,
    });
  } catch (e) { return adminErrorResponse(e); }
}

export async function POST(req: Request) {
  try {
    const { service } = await requireAdmin(req);
    const body = (await req.json()) as { action?: string; user_id?: string };

    if (body.action === "force_logout") {
      if (!body.user_id) return jsonError(400, "user_id required");
      // Delete every session row → Realtime DELETE handler in useAuth
      // signs each device out. Anomaly events are kept for audit.
      const { error } = await service
        .from("user_sessions")
        .delete()
        .eq("user_id", body.user_id);
      if (error) return jsonError(500, `force_logout failed: ${error.message}`);
      return NextResponse.json({ ok: true });
    }

    return jsonError(400, "Unknown action");
  } catch (e) { return adminErrorResponse(e); }
}

export function PUT()    { return jsonError(405, "Method not allowed"); }
export function DELETE() { return jsonError(405, "Method not allowed"); }
export function PATCH()  { return jsonError(405, "Method not allowed"); }

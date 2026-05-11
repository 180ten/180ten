"use client";
// src/app/ad/tabs/SecurityTab.tsx
// Admin "Bảo mật" tab — surfaces anti-account-sharing telemetry.
//
// Two sections:
//   1) Tài khoản nghi ngờ — users with anomaly_events in the last 7 days
//      (rapid IP change, etc.). Click "Xem chi tiết" to expand the raw
//      event timeline.
//   2) Thiết bị đang active — every active user_sessions row, grouped by
//      user. Multi-session users surfaced first.
//
// Each row has a "Đăng xuất tất cả" button → POST /api/admin/security
// { action: 'force_logout', user_id } → server DELETEs the user's sessions
// → Realtime DELETE handler signs each device out within seconds.
//
// Auto-refreshes every 60s.

import { useEffect, useState, useCallback } from "react";
import { adminCall, adminGet, AdminApiError } from "@/lib/adminApi";

interface ProfileRow {
  id:    string;
  email: string | null;
  name:  string | null;
  plan:  string | null;
}

interface AnomalyEvent {
  user_id:    string;
  event_type: string;
  detail:     Record<string, unknown> | null;
  created_at: string;
}

interface AnomalyUser {
  user_id: string;
  profile: ProfileRow | null;
  total:   number;
  types:   Record<string, number>;
  ips:     string[];
  latest:  string;
  events:  AnomalyEvent[];
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

interface ActiveUser {
  user_id:  string;
  profile:  ProfileRow | null;
  sessions: SessionRow[];
}

interface SecurityPayload {
  windowDays:       number;
  anomalyUsers:     AnomalyUser[];
  activeUsers:      ActiveUser[];
  anomalyUserCount: number;
}

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60)        return `${sec}s trước`;
  const min = Math.floor(sec / 60);
  if (min < 60)        return `${min} phút trước`;
  const hr  = Math.floor(min / 60);
  if (hr  < 24)        return `${hr} giờ trước`;
  const day = Math.floor(hr / 24);
  return `${day} ngày trước`;
}

const TYPE_LABEL: Record<string, string> = {
  ip_change:       "IP thay đổi nhanh",
  timezone_change: "Múi giờ bất thường",
  ua_change:       "User-Agent đổi",
  country_change:  "Quốc gia thay đổi",
};

const C = { border: "#e5e3df", border2: "#d8d5cf", text: "#1a1917", muted: "#6b6864", accent: "#e8502a", red: "#e74c3c", green: "#22c55e", surface: "#fbfaf7" };

export default function SecurityTab() {
  const [data,    setData]    = useState<SecurityPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busyUser, setBusyUser] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await adminGet<SecurityPayload>("/api/admin/security");
      setData(res);
      setError(null);
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
    const id = setInterval(() => { void fetchData(); }, 60_000);
    return () => clearInterval(id);
  }, [fetchData]);

  function toggleExpand(uid: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid); else next.add(uid);
      return next;
    });
  }

  async function forceLogout(uid: string, label: string) {
    if (!confirm(`Đăng xuất tất cả thiết bị của "${label}"?`)) return;
    setBusyUser(uid);
    try {
      await adminCall("/api/admin/security", { action: "force_logout", user_id: uid });
      await fetchData();
    } catch (e) {
      alert(`Lỗi: ${e instanceof AdminApiError ? e.message : (e as Error).message}`);
    } finally {
      setBusyUser(null);
    }
  }

  if (loading && !data) {
    return <div style={{ padding: 32, color: C.muted }}>Đang tải dữ liệu bảo mật…</div>;
  }
  if (error) {
    return <div style={{ padding: 32, color: C.red }}>Lỗi: {error}</div>;
  }
  if (!data) return null;

  const { anomalyUsers, activeUsers } = data;

  return (
    <div style={{ padding: "24px 28px 60px", maxWidth: 1200 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: C.text, marginBottom: 4 }}>🛡️ Bảo mật</h1>
      <p style={{ fontSize: 13, color: C.muted, marginBottom: 28 }}>
        Phát hiện tài khoản chia sẻ — dữ liệu trong {data.windowDays} ngày gần nhất. Tự động refresh 60 giây.
      </p>

      {/* ── Section 1: Anomaly users ───────────────────────────────── */}
      <h2 style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 12 }}>
        ⚠️ Nghi ngờ share tài khoản{" "}
        <span style={{ color: C.muted, fontWeight: 500, fontSize: 13 }}>({anomalyUsers.length})</span>
      </h2>

      {anomalyUsers.length === 0 ? (
        <div style={{ padding: "16px 18px", border: `1px solid ${C.border}`, borderRadius: 10, background: C.surface, color: C.muted, fontSize: 13, marginBottom: 36 }}>
          Không có hoạt động đáng ngờ trong {data.windowDays} ngày qua.
        </div>
      ) : (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden", marginBottom: 36 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead style={{ background: C.surface }}>
              <tr style={{ textAlign: "left" }}>
                <th style={{ padding: "10px 14px", fontWeight: 700, color: C.muted, fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em" }}>User</th>
                <th style={{ padding: "10px 14px", fontWeight: 700, color: C.muted, fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em" }}>Email</th>
                <th style={{ padding: "10px 14px", fontWeight: 700, color: C.muted, fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em" }}>Số lần</th>
                <th style={{ padding: "10px 14px", fontWeight: 700, color: C.muted, fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em" }}>Chi tiết</th>
                <th style={{ padding: "10px 14px", fontWeight: 700, color: C.muted, fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em", width: 220 }}>Hành động</th>
              </tr>
            </thead>
            <tbody>
              {anomalyUsers.map((u) => {
                const label = u.profile?.name || u.profile?.email || u.user_id.slice(0, 8);
                const isOpen = expanded.has(u.user_id);
                return (
                  <>
                    <tr key={u.user_id} style={{ borderTop: `1px solid ${C.border}` }}>
                      <td style={{ padding: "12px 14px", color: C.text, fontWeight: 600 }}>{u.profile?.name || "—"}</td>
                      <td style={{ padding: "12px 14px", color: C.muted, fontSize: 12 }}>{u.profile?.email || "—"}</td>
                      <td style={{ padding: "12px 14px", color: C.red, fontWeight: 700 }}>{u.total} lần</td>
                      <td style={{ padding: "12px 14px", color: C.muted, fontSize: 12, lineHeight: 1.6 }}>
                        {Object.entries(u.types).map(([t, n]) => (
                          <div key={t}>{TYPE_LABEL[t] ?? t}: <strong>{n}x</strong></div>
                        ))}
                        {u.ips.length > 0 && (
                          <div style={{ marginTop: 4, fontSize: 11 }}>IP: {u.ips.slice(0, 3).join(", ")}{u.ips.length > 3 ? `, +${u.ips.length - 3}` : ""}</div>
                        )}
                        <div style={{ marginTop: 4, fontSize: 11, color: C.muted }}>Mới nhất: {formatRelative(u.latest)}</div>
                      </td>
                      <td style={{ padding: "12px 14px" }}>
                        <button
                          onClick={() => toggleExpand(u.user_id)}
                          style={{ marginRight: 6, padding: "5px 10px", border: `1px solid ${C.border2}`, background: "transparent", color: C.text, borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer" }}
                        >
                          {isOpen ? "Ẩn" : "Xem chi tiết"}
                        </button>
                        <button
                          onClick={() => forceLogout(u.user_id, label)}
                          disabled={busyUser === u.user_id}
                          style={{ padding: "5px 10px", border: `1px solid ${C.red}`, background: C.red, color: "#fff", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: busyUser === u.user_id ? "not-allowed" : "pointer", opacity: busyUser === u.user_id ? 0.6 : 1 }}
                        >
                          {busyUser === u.user_id ? "…" : "Đăng xuất tất cả"}
                        </button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr style={{ background: C.surface }}>
                        <td colSpan={5} style={{ padding: "10px 18px 16px" }}>
                          <div style={{ fontSize: 12, color: C.muted, marginBottom: 6, fontWeight: 600 }}>
                            {u.events.length} sự kiện gần nhất:
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "150px 140px 1fr", gap: 6, fontSize: 12, fontFamily: "monospace" }}>
                            {u.events.map((ev, i) => (
                              <>
                                <div key={`${i}-t`} style={{ color: C.muted }}>{new Date(ev.created_at).toLocaleString("vi-VN")}</div>
                                <div key={`${i}-y`} style={{ color: C.accent }}>{ev.event_type}</div>
                                <div key={`${i}-d`} style={{ color: C.text, wordBreak: "break-all" }}>{JSON.stringify(ev.detail)}</div>
                              </>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Section 2: Active sessions ─────────────────────────────── */}
      <h2 style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 12 }}>
        📱 Thiết bị đang active{" "}
        <span style={{ color: C.muted, fontWeight: 500, fontSize: 13 }}>({activeUsers.length} user)</span>
      </h2>

      {activeUsers.length === 0 ? (
        <div style={{ padding: "16px 18px", border: `1px solid ${C.border}`, borderRadius: 10, background: C.surface, color: C.muted, fontSize: 13 }}>
          Không có session nào đang active.
        </div>
      ) : (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead style={{ background: C.surface }}>
              <tr style={{ textAlign: "left" }}>
                <th style={{ padding: "10px 14px", fontWeight: 700, color: C.muted, fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em" }}>User</th>
                <th style={{ padding: "10px 14px", fontWeight: 700, color: C.muted, fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em" }}>Thiết bị</th>
                <th style={{ padding: "10px 14px", fontWeight: 700, color: C.muted, fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em" }}>IP</th>
                <th style={{ padding: "10px 14px", fontWeight: 700, color: C.muted, fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em" }}>Last active</th>
                <th style={{ padding: "10px 14px", fontWeight: 700, color: C.muted, fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em", width: 180 }}>Hành động</th>
              </tr>
            </thead>
            <tbody>
              {activeUsers.map((u) => {
                const label = u.profile?.name || u.profile?.email || u.user_id.slice(0, 8);
                return u.sessions.map((s, i) => (
                  <tr key={s.id} style={{ borderTop: `1px solid ${C.border}` }}>
                    {i === 0 ? (
                      <td rowSpan={u.sessions.length} style={{ padding: "12px 14px", color: C.text, fontWeight: 600, verticalAlign: "top", borderRight: `1px solid ${C.border}` }}>
                        <div>{u.profile?.name || "—"}</div>
                        <div style={{ fontSize: 11, color: C.muted, fontWeight: 400 }}>{u.profile?.email || u.user_id.slice(0, 8)}</div>
                        {u.sessions.length > 1 && (
                          <div style={{ marginTop: 4, fontSize: 11, color: C.red, fontWeight: 700 }}>{u.sessions.length} thiết bị</div>
                        )}
                      </td>
                    ) : null}
                    <td style={{ padding: "10px 14px", color: C.text, fontSize: 12 }}>{s.device_name || "—"}</td>
                    <td style={{ padding: "10px 14px", color: C.muted, fontSize: 12, fontFamily: "monospace" }}>{s.ip || "—"}</td>
                    <td style={{ padding: "10px 14px", color: C.muted, fontSize: 12 }}>{formatRelative(s.last_active)}</td>
                    {i === 0 ? (
                      <td rowSpan={u.sessions.length} style={{ padding: "12px 14px", verticalAlign: "top" }}>
                        <button
                          onClick={() => forceLogout(u.user_id, label)}
                          disabled={busyUser === u.user_id}
                          style={{ padding: "5px 10px", border: `1px solid ${C.red}`, background: C.red, color: "#fff", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: busyUser === u.user_id ? "not-allowed" : "pointer", opacity: busyUser === u.user_id ? 0.6 : 1 }}
                        >
                          {busyUser === u.user_id ? "…" : "Đăng xuất tất cả"}
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ));
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

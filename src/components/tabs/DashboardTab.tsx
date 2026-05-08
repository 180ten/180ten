"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ExamResult } from "@/hooks/useDashboard";
import SkillSpiderChart from "@/components/SkillSpiderChart";

const SKILL_AXES = [
  { key: "vocab",   jp: "文字", color: "#6C6FF7" },
  { key: "grammar", jp: "文法", color: "#f97316" },
  { key: "reading", jp: "読解", color: "#22c55e" },
  { key: "listen",  jp: "聴解", color: "#0ea5e9" },
];

interface SkillPcts { vocab: number; grammar: number; reading: number; listen: number; }

interface DashboardTabProps {
  isLoggedIn: boolean;
  profile: { name?: string; plan?: string } | null;
  user: { email?: string } | null;
  results: ExamResult[];
  localResults: ExamResult[];
  skillCur: SkillPcts | null;
  skillPrev: SkillPcts | null;
  onShowReport: (result: ExamResult) => void;
}

function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function buildBarChart(containerId: string, results: ExamResult[], period: 7 | 30) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const dayLabels = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];

  // Range: 2 days BEFORE today, then today, then (period-3) days AFTER.
  //   period 7  → -2 ... +4  (7 cells centered around today)
  //   period 30 → -2 ... +27 (30 cells)
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const back = 2;
  const forward = period - 1 - back; // total = back + 1 + forward = period

  const days: { dow: string; date: string; key: string; isToday: boolean }[] = [];
  for (let i = -back; i <= forward; i++) {
    const d = new Date(today); d.setDate(today.getDate() + i);
    const dow = dayLabels[(d.getDay() + 6) % 7];
    const date = `${d.getDate()}/${d.getMonth() + 1}`;
    const key = localDateKey(d);
    days.push({ dow, date, key, isToday: i === 0 });
  }
  const counts = days.map(() => 0);
  results.forEach((r) => {
    const sa = r.submitted_at ?? (r as Record<string, unknown>).created_at;
    if (!sa) return;
    const d = new Date(String(sa));
    if (Number.isNaN(d.getTime())) return;
    const key = localDateKey(d);
    const idx = days.findIndex((x) => x.key === key);
    if (idx >= 0) counts[idx]++;
  });
  const mx = Math.max(...counts, 1);
  // Y-axis tick rows scale with mx
  const tickMax = Math.max(4, mx);
  const ticks = [tickMax, Math.round(tickMax * 0.75), Math.round(tickMax * 0.5), Math.round(tickMax * 0.25), 0];

  // For 30-day mode, hide DOW + show every Nth date label only
  const labelEvery = period === 7 ? 1 : 5;

  el.innerHTML = `
    <div class="chart-y-axis">
      ${ticks.map((t) => `<div class="chart-y-tick">${t}</div>`).join("")}
    </div>
    <div class="chart-bars">
      ${counts.map((v, i) => `
        <div class="chart-bar-col${days[i].isToday ? " is-today" : ""}" title="${days[i].dow} ${days[i].date}: ${v > 0 ? v + " đề" : "Không có đề"}">
          <div class="chart-bar-num">${v > 0 ? v : ""}</div>
          <div class="chart-bar" style="height:${Math.max(4, Math.round((v / tickMax) * 140))}px;${v === 0 ? "background:var(--border);" : ""}${days[i].isToday ? "outline:2px solid var(--accent);outline-offset:1px;" : ""}"></div>
          <div class="chart-label">
            ${(i % labelEvery === 0 || days[i].isToday) ? `<div style="font-size:10.5px;color:var(--muted);white-space:nowrap;">${period === 7 ? days[i].dow + " " : ""}${days[i].date}</div>` : ""}
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

// Compute streak: # consecutive days (back from today) with at least 1 result
function computeStreak(results: ExamResult[]): number {
  const dates = new Set<string>();
  results.forEach((r) => {
    const sa = r.submitted_at ?? (r as Record<string, unknown>).created_at;
    if (!sa) return;
    const d = new Date(String(sa));
    if (!Number.isNaN(d.getTime())) dates.add(localDateKey(d));
  });
  let streak = 0;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  for (let i = 0; i < 365; i++) {
    const d = new Date(today); d.setDate(today.getDate() - i);
    const k = localDateKey(d);
    if (dates.has(k)) streak++;
    else if (i > 0) break; // allow today blank
  }
  return streak;
}

function fmtDate(s: string) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("vi-VN");
}

export default function DashboardTab({ isLoggedIn, profile, user, results, localResults, skillCur, onShowReport }: DashboardTabProps) {
  const router = useRouter();
  const [activeSkill, setActiveSkill] = useState<string | null>(null);
  const [chartPeriod, setChartPeriod] = useState<7 | 30>(7);

  const plan = (profile?.plan || "free").toLowerCase();
  const name = profile?.name || user?.email?.split("@")[0] || "bạn";

  // All time-based stats memoised so render stays pure
  const stats = useMemo(() => {
    const total = results.length;
    const avg = total > 0
      ? Math.round(results.reduce((s, r) => s + (Number(r.score) || 0), 0) / total)
      : 0;

    const weekStart = new Date(); weekStart.setHours(0,0,0,0); weekStart.setDate(weekStart.getDate() - 6);
    const prevWeekStart = new Date(weekStart); prevWeekStart.setDate(prevWeekStart.getDate() - 7);
    const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 7);

    const inRange = (r: ExamResult, from: Date, to: Date) => {
      const sa = r.submitted_at ?? (r as Record<string, unknown>).created_at;
      if (!sa) return false;
      const d = new Date(String(sa));
      return !Number.isNaN(d.getTime()) && d >= from && d < to;
    };
    const weekResults     = results.filter((r) => inRange(r, weekStart, weekEnd));
    const prevWeekResults = results.filter((r) => inRange(r, prevWeekStart, weekStart));
    const week         = weekResults.length;
    const prevWeekCnt  = prevWeekResults.length;
    const weekDelta    = week - prevWeekCnt;
    const weekAvg      = week > 0 ? Math.round(weekResults.reduce((s, r) => s + (Number(r.score) || 0), 0) / week) : 0;
    const prevWeekAvg  = prevWeekCnt > 0 ? Math.round(prevWeekResults.reduce((s, r) => s + (Number(r.score) || 0), 0) / prevWeekCnt) : 0;
    const avgDelta     = prevWeekCnt > 0 ? weekAvg - prevWeekAvg : 0;
    const streak       = computeStreak(results);

    return { total, avg, week, prevWeekCnt, weekDelta, avgDelta, streak };
  }, [results]);
  const { total, avg, week, prevWeekCnt, weekDelta, avgDelta, streak } = stats;

  const lsStats = useMemo(() => {
    const lsTotal = localResults.length;
    const lsAvg = lsTotal > 0
      ? Math.round(localResults.reduce((s, r) => s + (Number(r.score) || 0), 0) / lsTotal)
      : 0;
    const ws = new Date(); ws.setHours(0,0,0,0); ws.setDate(ws.getDate() - 6);
    const lsWeek = localResults.filter((r) => r.submitted_at && new Date(String(r.submitted_at)) >= ws).length;
    return { lsTotal, lsAvg, lsWeek };
  }, [localResults]);
  const { lsTotal, lsAvg, lsWeek } = lsStats;

  useEffect(() => {
    if (isLoggedIn) {
      buildBarChart("dash-chart", results, chartPeriod);
    } else {
      buildBarChart("ls-chart", localResults, chartPeriod);
    }
  }, [isLoggedIn, results, localResults, chartPeriod]);

  const planLabel =
    plan === "lifetime" ? "Trọn đời"
    : plan === "premium" || plan === "1year" ? "1 năm"
    : plan === "3month" ? "3 tháng"
    : "Trải nghiệm";

  const planExpiresAtRaw = (profile as { plan_expires_at?: string } | null)?.plan_expires_at;
  const planExpiryText = (() => {
    if (!planExpiresAtRaw) return "";
    if (plan === "lifetime") return "";
    if (plan !== "premium" && plan !== "1year" && plan !== "3month") return "";
    const d = new Date(planExpiresAtRaw);
    if (isNaN(d.getTime())) return "";
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    return `Hạn đến hết ngày ${dd}/${mm}/${yyyy}`;
  })();
  const spiderValues = skillCur
    ? [
        (skillCur.vocab ?? 0) / 100,
        (skillCur.grammar ?? 0) / 100,
        (skillCur.reading ?? 0) / 100,
        (skillCur.listen ?? 0) / 100,
      ]
    : [0, 0, 0, 0];

  return (
    <div id="tab-dashboard" className="tab-pane" style={{ display: "flex", flex: 1, flexDirection: "column" }}>
      {/* Logged-in dashboard */}
      <div id="dash-in" style={{ display: isLoggedIn ? "flex" : "none", flex: 1 }}>
        <div className="dash-wrap">
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 14, marginBottom: 24 }}>
            <div>
              <h2 style={{ fontSize: 26, fontWeight: 800 }}>Dashboard <span style={{ fontSize: 22 }}>👋</span></h2>
              <p id="dash-greet" style={{ marginTop: 4 }}>
                Chào {name}! Hôm nay luyện tập tốt không?
              </p>
            </div>
            <div style={{
              display: "flex", alignItems: "center", gap: 10,
              background: "var(--white)", border: "1px solid var(--border)",
              borderRadius: 14, padding: "8px 14px",
              boxShadow: "0 1px 8px rgba(0,0,0,.04)",
            }}>
              <div style={{
                width: 38, height: 38, borderRadius: 10, background: "#fff1e0",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 20,
              }}>🔥</div>
              <div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>Chuỗi ngày học</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: "#e8502a" }}>
                  {streak} ngày
                </div>
              </div>
            </div>
          </div>
          <div className="dash-stats-row">
            {/* Card 1 — Đề đã làm */}
            <div className="dash-stat-card c-orange">
              <span className="dash-stat-dot" />
              <div className="dash-stat-head">
                <div className="dash-stat-icon"><img src="/svg/clipboard.svg" alt="" aria-hidden width={26} height={26} /></div>
                <div className="dash-stat-num" id="ds-total" style={{ color: "#e8502a" }}>{total > 0 ? total : "—"}</div>
              </div>
              <div className="dash-stat-label">Đề đã làm</div>
              <div className="dash-stat-sub" style={{ color: weekDelta >= 0 ? "#15803d" : "#c2410c" }}>
                {prevWeekCnt > 0 || weekDelta !== 0
                  ? `${weekDelta >= 0 ? "▲" : "▼"} ${Math.abs(weekDelta)} đề so với tuần trước`
                  : " "}
              </div>
            </div>

            {/* Card 2 — Điểm trung bình */}
            <div className="dash-stat-card c-green">
              <span className="dash-stat-dot" />
              <div className="dash-stat-head">
                <div className="dash-stat-icon"><img src="/svg/cup.svg" alt="" aria-hidden width={26} height={26} /></div>
                <div className="dash-stat-num" id="ds-avg" style={{ color: "#15803d" }}>{total > 0 ? avg : "—"}</div>
              </div>
              <div className="dash-stat-label">Điểm trung bình</div>
              <div className="dash-stat-sub" style={{ color: avgDelta >= 0 ? "#15803d" : "#c2410c" }}>
                {prevWeekCnt > 0
                  ? `${avgDelta >= 0 ? "▲" : "▼"} ${Math.abs(avgDelta)}% so với tuần trước`
                  : " "}
              </div>
            </div>

            {/* Card 3 — Tuần học */}
            <div className="dash-stat-card c-teal">
              <span className="dash-stat-dot" />
              <div className="dash-stat-head">
                <div className="dash-stat-icon"><img src="/svg/calendar.svg" alt="" aria-hidden width={26} height={26} /></div>
                <div className="dash-stat-num" id="ds-week" style={{ color: "#0ea5e9" }}>{week > 0 ? week : "—"}</div>
              </div>
              <div className="dash-stat-label">Tuần học</div>
              <div className="dash-stat-sub" style={{ color: "#0ea5e9" }}>
                {week > 0 ? "Giữ vững phong độ nhé!" : "Hãy bắt đầu tuần mới!"}
              </div>
            </div>

            {/* Card 4 — Gói */}
            <div className="dash-stat-card c-purple">
              <span className="dash-stat-dot" />
              <div className="dash-stat-head">
                <div className="dash-stat-icon"><img src="/svg/graduate.svg" alt="" aria-hidden width={26} height={26} /></div>
                <div className="dash-stat-num" id="ds-plan" style={{ color: "#6c5ce7" }}>{planLabel}</div>
              </div>
              <div className="dash-stat-label">Gói {planLabel === "Trải nghiệm" ? "" : "Premium"}</div>
              <div className="dash-stat-sub" style={{ color: "#6c5ce7" }}>
                {planExpiryText
                  ? planExpiryText.replace("Hạn đến hết ngày ", "Hạn đến ")
                  : " "}
              </div>
            </div>
          </div>
          <div className="dash-grid">
            <div>
              <div className="dash-card">
                <div className="dash-card-header">
                  <h3>Đề làm theo ngày</h3>
                  <select
                    value={chartPeriod}
                    onChange={(e) => setChartPeriod(Number(e.target.value) as 7 | 30)}
                    style={{
                      height: 32, padding: "0 30px 0 12px", borderRadius: 8,
                      border: "1.5px solid var(--border)", background: "var(--white)",
                      fontFamily: "Be Vietnam Pro,Noto Sans JP,sans-serif", fontSize: 12, fontWeight: 600,
                      color: "var(--text)", cursor: "pointer", outline: "none",
                      appearance: "none", WebkitAppearance: "none", MozAppearance: "none",
                      backgroundImage:
                        "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>\")",
                      backgroundRepeat: "no-repeat",
                      backgroundPosition: "right 10px center",
                    }}
                  >
                    <option value={7}>7 ngày</option>
                    <option value={30}>30 ngày</option>
                  </select>
                </div>
                <div className="chart-wrap" id="dash-chart"></div>
              </div>
              <div className="dash-card">
                <div className="dash-card-header">
                  <h3><span className="dash-card-h-icon" style={{ background: "#fde0de" }}><img src="/svg/report.svg" alt="" width={14} height={14} /></span>Lịch sử làm đề</h3>
                </div>
                <table className="history-table">
                  <thead><tr><th>Đề thi</th><th>Cấp độ</th><th>Điểm</th><th>Thời gian</th><th>Ngày</th><th>Hành động</th></tr></thead>
                  <tbody id="hist-body">
                    {results.slice(0, 5).map((r, i) => {
                      const rr = r as Record<string, unknown>;
                      const lvl = String(rr.level ?? "").toLowerCase();
                      const pct = Number(r.score_pct ?? rr.score) || 0;
                      const passByLevel: Record<string, number> = { N1: 55, N2: 50, N3: 52, N4: 50, N5: 50 };
                      const passScore = passByLevel[String(rr.level ?? "")] ?? 50;
                      const passed = pct >= passScore;
                      const timeSec = Number(rr.time_spent ?? 0);
                      const timeMin = timeSec > 0 ? Math.round(timeSec / 60) : null;
                      return (
                        <tr
                          key={i}
                          style={{ cursor: "pointer" }}
                          className="hist-row"
                          onClick={() => onShowReport(r)}
                          title="Xem báo cáo"
                        >
                          <td style={{ fontWeight: 600 }}>{String(rr.exam_name || rr.name || "—")}</td>
                          <td><span className={`badge-level badge-${lvl}`}>{String(rr.level ?? "—")}</span></td>
                          <td><span style={{ fontWeight: 800, color: passed ? "#15803d" : "#c2410c" }}>{pct}%</span></td>
                          <td style={{ color: "var(--muted)", fontSize: 12.5 }}>{timeMin ? `${timeMin} phút` : "—"}</td>
                          <td style={{ color: "var(--muted)" }}>{fmtDate(String(r.submitted_at ?? (rr.created_at ?? "")))}</td>
                          <td>
                            <span className="hist-report-btn" title="Xem báo cáo">
                              <img src="/svg/report.svg" alt="" width={18} height={18} />
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                    {results.length === 0 && (
                      <tr><td colSpan={6} style={{ color: "var(--muted2)", textAlign: "center", padding: 20 }}>Chưa có lịch sử làm bài</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <div>
              <div className="dash-card">
                <h3>Thành tích từng phần</h3>
                <div className="dash-skill-canvas" style={{ display: "flex", justifyContent: "center", padding: "8px 0" }}>
                  <SkillSpiderChart values={spiderValues} width={300} height={260} />
                </div>

                {!skillCur && (
                  <div style={{ color: "var(--muted2)", fontSize: 13, textAlign: "center", padding: "8px 0 14px" }}>
                    Làm ít nhất 1 đề để xem thành tích.
                  </div>
                )}

                {skillCur && (
                  <>
                    <div style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 10,
                      marginTop: 10,
                    }}>
                      {SKILL_AXES.map((ax) => {
                        const v = (skillCur as unknown as Record<string, number>)[ax.key] ?? 0;
                        return (
                          <div
                            key={ax.key}
                            onClick={() => setActiveSkill((k) => k === ax.key ? null : ax.key)}
                            style={{
                              padding: "10px 14px",
                              background: activeSkill === ax.key ? `${ax.color}15` : "var(--surface)",
                              border: `1px solid ${activeSkill === ax.key ? ax.color : "var(--border)"}`,
                              borderRadius: 10,
                              cursor: "pointer", transition: "all .15s",
                              textAlign: "center",
                            }}
                          >
                            <div style={{ fontSize: 14, fontWeight: 700, color: ax.color, marginBottom: 2 }}>
                              {ax.jp}
                            </div>
                            <div style={{ fontSize: 18, fontWeight: 800, color: "var(--text)" }}>
                              {v}%
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Guest dashboard */}
      <div id="dash-out" style={{ display: isLoggedIn ? "none" : "flex", flex: 1, flexDirection: "column" }}>
        <div className="dash-wrap">
          <div style={{ marginBottom: 20, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
            <div>
              <h2 style={{ fontSize: 26, fontWeight: 800 }}>Dashboard</h2>
              <p style={{ marginTop: 4 }}>Lịch sử lưu trên máy này</p>
            </div>
          </div>
          <div className="stats-row">
            <div className="stat-card"><div className="n" id="ls-total" style={{ color: "var(--accent)" }}>{lsTotal}</div><div className="l">Đề đã làm</div></div>
            <div className="stat-card"><div className="n" id="ls-avg" style={{ color: "var(--green)" }}>{lsTotal ? lsAvg : "—"}</div><div className="l">Điểm TB</div></div>
            <div className="stat-card"><div className="n" id="ls-week" style={{ color: "var(--blue)" }}>{lsWeek}</div><div className="l">Tuần này</div></div>
            <div className="stat-card"><div className="n">free</div><div className="l">Gói</div></div>
          </div>
          <div className="dash-grid">
            <div>
              <div className="dash-card">
                <h3>Đề làm theo ngày</h3>
                <div className="chart-wrap" id="ls-chart"></div>
              </div>
              <div className="dash-card">
                <h3>Lịch sử làm đề</h3>
                <table className="history-table">
                  <thead><tr><th>Đề thi</th><th>Cấp</th><th>Điểm</th><th>Ngày</th><th></th></tr></thead>
                  <tbody id="ls-hist-body">
                    {localResults.slice(0, 20).map((r, i) => {
                      const rr = r as Record<string, unknown>;
                      const lvl = String(rr.level ?? "").toLowerCase();
                      const pct = Number(r.score_pct ?? rr.score) || 0;
                      const passByLevel: Record<string, number> = { N1: 55, N2: 50, N3: 52, N4: 50, N5: 50 };
                      const passScore = passByLevel[String(rr.level ?? "")] ?? 50;
                      const passed = pct >= passScore;
                      const hasReport = !!(rr.reportKey);
                      return (
                        <tr
                          key={i}
                          style={{ cursor: hasReport ? "pointer" : "default" }}
                          className={hasReport ? "hist-row" : ""}
                          onClick={() => hasReport && onShowReport(r)}
                          title={hasReport ? "Xem báo cáo" : undefined}
                        >
                          <td>{String(rr.exam_name ?? "—")}</td>
                          <td><span className={`badge-level badge-${lvl}`}>{String(rr.level ?? "—")}</span></td>
                          <td><span style={{ fontWeight: 800, color: passed ? "#15803d" : "#c2410c" }}>{pct}%</span></td>
                          <td style={{ color: "var(--muted)" }}>{fmtDate(String(r.submitted_at ?? (rr.created_at ?? "")))}</td>
                          <td>
                            <span
                              className="hist-report-btn"
                              style={{ opacity: hasReport ? 1 : 0.35 }}
                              title={hasReport ? "Xem báo cáo" : "Chưa có báo cáo"}
                            >
                              <img src="/svg/report.svg" alt="" width={18} height={18} />
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                    {localResults.length === 0 && (
                      <tr><td colSpan={5} style={{ color: "var(--muted2)", textAlign: "center", padding: 20 }}>Chưa có lịch sử làm bài</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <div>
              <div className="dash-card" style={{ background: "linear-gradient(135deg,#fff8e7,#fef3cd)", borderColor: "var(--amber)" }}>
                <h3 style={{ color: "#7a5000" }}>Đăng nhập để mở khóa</h3>
                <p style={{ fontSize: 13, color: "#a06000", lineHeight: 1.7, marginBottom: 14 }}>Đồng bộ lịch sử lên cloud, làm bài trên nhiều thiết bị, nhận phân tích chi tiết.</p>
                <button className="btn-primary" style={{ fontSize: 13, padding: "10px 20px" }} onClick={() => router.push("/login")}>Đăng nhập / Đăng ký</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";
import { useState, useEffect, useCallback } from "react";
import { adminCall, adminGet, AdminApiError } from "@/lib/adminApi";
import { isAdminEmail } from "@/lib/constants";

interface Student {
  id: string;
  email?: string;
  name?: string;
  full_name?: string;
  role?: string;
  plan?: string;
  plan_expires_at?: string;
  created_at?: string;
  exams_done?: number;
}

interface PlanModalState { open: boolean; userId: string; userName: string; selected: string; }
interface DelModalState  { open: boolean; userId: string; userName: string; }

const AVC = ["#e8502a","#2DB87A","#3B9FD4","#9B6FF7","#d4890a","#e05555"];

export default function StudentsTab() {
  const [all, setAll]           = useState<Student[]>([]);
  const [filtered, setFiltered] = useState<Student[]>([]);
  const [loading, setLoading]   = useState(false);
  const [query, setQuery]       = useState("");
  const [planModal, setPlanModal] = useState<PlanModalState>({ open: false, userId: "", userName: "", selected: "free" });
  const [delModal, setDelModal]   = useState<DelModalState>({ open: false, userId: "", userName: "" });
  const [toast, setToast]         = useState({ msg: "", type: "default" });

  function showToast(msg: string, type = "default") {
    setToast({ msg, type });
    setTimeout(() => setToast({ msg: "", type: "default" }), 2800);
  }

  const loadStudents = useCallback(async () => {
    setLoading(true);
    let resData: Student[];
    try {
      console.log("[StudentsTab] calling /api/admin/students/list");
      const r = await adminGet<{ students: Student[] }>("/api/admin/students/list");
      console.log("[StudentsTab] OK. Got students:", r.students?.length);
      resData = r.students ?? [];
    } catch (err) {
      const msg = err instanceof AdminApiError ? `${err.status} ${err.message}` : String(err);
      console.error("[StudentsTab] load failed:", msg, err);
      showToast("Lỗi tải học viên: " + msg, "error");
      setLoading(false);
      return;
    }

    const raw = resData.map((s) => ({
      ...s,
      name: s.name || s.full_name || s.email,
      // exams_done already populated by API
    }));

    // Filter out admin accounts and deduplicate
    const seen = new Set<string>();
    const students = raw.filter((s) => {
      const email = (s.email || "").toLowerCase();
      if (isAdminEmail(email) || s.role === "admin") return false;
      const key = s.id || email;
      if (!key) return false;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    setAll(students);
    applySearch(students, query);
    setLoading(false);
  }, [query]);

  function applySearch(rows: Student[], q: string) {
    const low = q.toLowerCase();
    setFiltered(
      q
        ? rows.filter((s) => (s.name || "").toLowerCase().includes(low) || (s.email || "").toLowerCase().includes(low))
        : rows
    );
  }

  useEffect(() => {
    const t = setTimeout(() => { void loadStudents(); }, 0);
    return () => clearTimeout(t);
  }, [loadStudents]);

  function filterStudents(q: string) {
    setQuery(q);
    applySearch(all, q);
  }

  const total    = all.length;
  const premium  = all.filter((s) => s.plan === "premium" || s.plan === "1year").length;
  const lifetime = all.filter((s) => s.plan === "lifetime").length;
  const free     = all.filter((s) => !s.plan || s.plan === "free").length;

  const planClass: Record<string, string> = { free: "plan-free", "3month": "plan-premium", premium: "plan-premium", "1year": "plan-premium", lifetime: "plan-lifetime" };
  const planLabel: Record<string, string> = { free: "Trải nghiệm", "3month": "3 tháng", premium: "1 năm", "1year": "1 năm", lifetime: "Trọn đời" };

  async function confirmPlan() {
    const { userId, selected } = planModal;
    function endOfDayPlus(days: number): string {
      const d = new Date();
      d.setDate(d.getDate() + days);
      d.setHours(23, 59, 59, 999);
      return d.toISOString();
    }
    const expires =
      selected === "premium"  ? endOfDayPlus(365)
      : selected === "3month" ? endOfDayPlus(90)
      : null;
    try {
      console.log("[confirmPlan] sending update_plan", { userId, selected });
      await adminCall("/api/admin/students", {
        action: "update_plan",
        user_id: userId,
        plan: selected,
        plan_expires_at: expires,
      });
      console.log("[confirmPlan] OK");
    } catch (err) {
      const msg = err instanceof AdminApiError ? `${err.status} ${err.message}` : String(err);
      console.error("[confirmPlan] failed:", msg, err);
      showToast("Lỗi: " + msg, "error");
      return;
    }
    showToast("Đã cấp quyền ✓", "success");
    setPlanModal((m) => ({ ...m, open: false }));
    void loadStudents();
  }

  async function confirmDel() {
    const { userId } = delModal;
    showToast("Đang xử lý...");
    try {
      await adminCall("/api/admin/students", { action: "delete", user_id: userId });
      showToast("Đã xoá tài khoản hoàn toàn ✓", "success");
    } catch (err: unknown) {
      showToast("Lỗi: " + (err instanceof AdminApiError ? err.message : (err as Error).message), "error");
    }
    setDelModal((m) => ({ ...m, open: false }));
    await new Promise((r) => setTimeout(r, 500));
    void loadStudents();
  }

  return (
    <div id="tab-students" className="tab-pane" style={{ display: "flex", flexDirection: "column" }}>
      <div className="topbar">
        <div>
          <div className="topbar-title">Quản lý học viên</div>
          <div className="topbar-sub">Cấp quyền, xem lịch sử</div>
        </div>
        <button type="button" onClick={() => void loadStudents()} style={{ padding: "7px 14px", borderRadius: 7, border: "1px solid #2a2a2a", background: "transparent", color: "#666", fontFamily: "Be Vietnam Pro,Noto Sans JP,sans-serif", fontSize: 11, cursor: "pointer" }}>↻ Refresh</button>
      </div>

      <div className="stats-row">
        <div className="stat-card"><div className="n" id="st-total">{loading ? "—" : total}</div><div className="l">Tổng học viên</div></div>
        <div className="stat-card"><div className="n" style={{ color: "#d4890a" }} id="st-premium">{loading ? "—" : premium}</div><div className="l">Premium</div></div>
        <div className="stat-card"><div className="n" style={{ color: "#2DB87A" }} id="st-lifetime">{loading ? "—" : lifetime}</div><div className="l">Trọn đời</div></div>
        <div className="stat-card"><div className="n" style={{ color: "#3B9FD4" }} id="st-free">{loading ? "—" : free}</div><div className="l">Trải nghiệm</div></div>
      </div>

      <div className="table-wrap">
        <div className="table-toolbar">
          <span className="table-toolbar-title">Tài khoản</span>
          <input className="search-input" placeholder="🔍 Tìm tên, email..." value={query} onChange={(e) => filterStudents(e.target.value)} />
        </div>
        <table>
          <thead><tr><th>Học viên</th><th>Email</th><th>Gói</th><th>Đề đã làm</th><th>Tham gia</th><th>Thao tác</th></tr></thead>
          <tbody id="student-tbody">
            {loading && <tr><td colSpan={6} style={{ textAlign: "center", padding: 28, color: "#2a2a2a" }}>Đang tải...</td></tr>}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={6} style={{ textAlign: "center", padding: 28, color: "#2a2a2a" }}>Không tìm thấy.</td></tr>
            )}
            {!loading && filtered.map((s, i) => {
              const displayName = s.name || s.full_name || s.email || "?";
              const planKey = s.plan || "free";
              return (
                <tr key={s.id}>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                      <div className="s-av" style={{ background: AVC[i % AVC.length] }}>{displayName[0].toUpperCase()}</div>
                      <div style={{ color: "#e8e8e8", fontWeight: 500, fontSize: 12 }}>{displayName}</div>
                    </div>
                  </td>
                  <td style={{ color: "#444" }}>{s.email || "—"}</td>
                  <td>
                    <span className={`plan-badge ${planClass[planKey] ?? "plan-free"}`}>{planLabel[planKey] ?? "Trải nghiệm"}</span>
                  </td>
                  <td>{s.exams_done ?? 0}</td>
                  <td style={{ color: "#333" }}>{s.created_at ? new Date(s.created_at).toLocaleDateString("vi-VN") : ""}</td>
                  <td>
                    <button type="button" className="act-btn promote" onClick={() => setPlanModal({ open: true, userId: s.id, userName: displayName, selected: planKey })}>Cấp quyền</button>
                    <button type="button" className="act-btn danger" onClick={() => setDelModal({ open: true, userId: s.id, userName: displayName })}>Xóa</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Plan modal */}
      {planModal.open && (
        <div className="modal-overlay active" onClick={(e) => { if (e.target === e.currentTarget) setPlanModal((m) => ({ ...m, open: false })); }}>
          <div className="modal">
            <h3>Cấp quyền</h3>
            <p id="plan-sub">Chọn gói cho <strong>{planModal.userName}</strong>:</p>
            <div>
              {(["free","3month","premium","lifetime"] as const).map((p) => {
                const icon  = p === "free" ? "🆓" : p === "3month" ? "🗓" : p === "premium" ? "⭐" : "👑";
                const name  = p === "free" ? "Trải nghiệm" : p === "3month" ? "3 tháng" : p === "premium" ? "1 năm" : "Trọn đời";
                const desc  = p === "free" ? "Cơ bản" : p === "3month" ? "Trọn 90 ngày" : p === "premium" ? "Trọn 365 ngày" : "Trọn đời";
                return (
                  <div key={p} className={`plan-option${planModal.selected === p ? " sel" : ""}`} onClick={() => setPlanModal((m) => ({ ...m, selected: p }))}>
                    <span style={{ fontSize: 18 }}>{icon}</span>
                    <div>
                      <div className="pname">{name}</div>
                      <div className="pdesc">{desc}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="modal-btns" style={{ marginTop: 18 }}>
              <button type="button" className="modal-cancel" onClick={() => setPlanModal((m) => ({ ...m, open: false }))}>Hủy</button>
              <button type="button" className="modal-confirm" onClick={() => void confirmPlan()}>Xác nhận</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete modal */}
      {delModal.open && (
        <div className="modal-overlay active" onClick={(e) => { if (e.target === e.currentTarget) setDelModal((m) => ({ ...m, open: false })); }}>
          <div className="modal">
            <h3>⚠️ Xóa tài khoản</h3>
            <p id="del-body">Xóa tài khoản <strong style={{ color: "#e8e8e8" }}>{delModal.userName}</strong>? Không thể hoàn tác.</p>
            <div className="modal-btns">
              <button type="button" className="modal-cancel" onClick={() => setDelModal((m) => ({ ...m, open: false }))}>Hủy</button>
              <button type="button" className="modal-confirm danger" onClick={() => void confirmDel()}>Xóa vĩnh viễn</button>
            </div>
          </div>
        </div>
      )}

      {toast.msg && <div className={`toast show ${toast.type}`}>{toast.msg}</div>}
    </div>
  );
}

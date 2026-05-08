"use client";
import { useState, useEffect, useCallback } from "react";
import { sb } from "@/lib/supabase";
import { adminCall, AdminApiError } from "@/lib/adminApi";

interface PayRequest {
  id: string;
  user_id: string;
  email?: string;
  plan: string;
  note?: string;
  screenshot?: string;
  status: "pending" | "approved" | "rejected";
  created_at?: string;
  reviewed_at?: string;
  reviewed_by?: string;
}

type FilterStatus = "all" | "pending" | "approved" | "rejected";

interface PaymentsTabProps {
  onPendingChange?: (n: number) => void;
  adminEmail?: string;
}

const AVC = ["#e8502a","#2DB87A","#3B9FD4","#9B6FF7","#d4890a","#e05555"];
const PLAN_LABEL: Record<string, string> = {
  "3month": "🗓 3 Tháng",
  "1year": "👑 1 Năm — 499K",
  lifetime: "👑 Lifetime — 999K",
};
const PLAN_LABEL_MODAL: Record<string, string> = {
  "3month": "3 Tháng",
  "1year": "1 Năm (499,000₫)",
  lifetime: "Lifetime (999,000₫)",
};

export default function PaymentsTab({ onPendingChange, adminEmail }: PaymentsTabProps) {
  const [all, setAll]           = useState<PayRequest[]>([]);
  const [filtered, setFiltered] = useState<PayRequest[]>([]);
  const [loading, setLoading]   = useState(false);
  const [filter, setFilter]     = useState<FilterStatus>("all");
  const [billTarget, setBillTarget] = useState<PayRequest | null>(null);
  const [toast, setToast]           = useState({ msg: "", type: "default" });

  function showToast(msg: string, type = "default") {
    setToast({ msg, type });
    setTimeout(() => setToast({ msg: "", type: "default" }), 2800);
  }

  const loadPayments = useCallback(async () => {
    setLoading(true);
    const { data, error } = await sb
      .from("payment_requests")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      showToast("Lỗi tải thanh toán: " + error.message, "error");
      setLoading(false);
      return;
    }
    const rows = (data ?? []) as PayRequest[];
    setAll(rows);
    applyFilter(rows, filter);
    const pending = rows.filter((r) => r.status === "pending").length;
    onPendingChange?.(pending);
    setLoading(false);
  }, [filter, onPendingChange]);

  function applyFilter(rows: PayRequest[], f: FilterStatus) {
    setFiltered(f === "all" ? rows : rows.filter((r) => r.status === f));
  }

  useEffect(() => {
    const t = setTimeout(() => { void loadPayments(); }, 0);
    return () => clearTimeout(t);
  }, [loadPayments]);

  function setFilterAnd(f: FilterStatus) {
    setFilter(f);
    applyFilter(all, f);
  }

  const total    = all.length;
  const pending  = all.filter((r) => r.status === "pending").length;
  const approved = all.filter((r) => r.status === "approved").length;
  const rejected = all.filter((r) => r.status === "rejected").length;

  async function approvePayment(reqId: string, userId: string, plan: string, email: string) {
    if (!confirm(`Duyệt yêu cầu gói "${plan}" cho ${email}?\n\nTài khoản sẽ được cấp quyền ngay.`)) return;
    setBillTarget(null);
    showToast("Đang xử lý...");
    try {
      await adminCall("/api/admin/payments", {
        action: "approve",
        req_id: reqId, user_id: userId, plan, admin_email: adminEmail,
      });
      const profilePlan = plan === "1year" ? "premium" : plan;
      showToast(`✓ Đã duyệt & cấp quyền "${profilePlan}" cho ${email}`, "success");
    } catch (err) {
      showToast(err instanceof AdminApiError ? err.message : "Lỗi không xác định", "error");
      return;
    }
    await new Promise((r) => setTimeout(r, 600));
    void loadPayments();
  }

  async function rejectPayment(reqId: string, email: string) {
    if (!confirm(`Từ chối yêu cầu của ${email}?`)) return;
    setBillTarget(null);
    showToast("Đang xử lý...");
    try {
      await adminCall("/api/admin/payments", { action: "reject", req_id: reqId, admin_email: adminEmail });
      showToast(`Đã từ chối yêu cầu của ${email}`);
    } catch (err) {
      showToast(err instanceof AdminApiError ? err.message : "Lỗi không xác định", "error");
      return;
    }
    await new Promise((r) => setTimeout(r, 400));
    void loadPayments();
  }

  async function deletePaymentById(id: string) {
    if (!confirm("Xoá yêu cầu thanh toán này? Không thể hoàn tác.")) return;
    showToast("Đang xoá...");
    try {
      await adminCall("/api/admin/payments", { action: "delete", req_id: id });
    } catch (err) {
      showToast("Lỗi: " + (err instanceof AdminApiError ? err.message : "không rõ"), "error");
      return;
    }
    showToast("Đã xoá ✓", "success");
    await new Promise((r) => setTimeout(r, 400));
    void loadPayments();
  }

  async function deleteScreenshot() {
    if (!billTarget) return;
    if (!confirm("Xoá ảnh bill của yêu cầu này? Thông tin yêu cầu vẫn còn.")) return;
    showToast("Đang xoá...");
    try {
      await adminCall("/api/admin/payments", {
        action: "delete_screenshot",
        req_id: billTarget.id,
        screenshot_url: billTarget.screenshot,
      });
    } catch (err) {
      showToast("Lỗi: " + (err instanceof AdminApiError ? err.message : "không rõ"), "error");
      return;
    }
    showToast("Đã xoá ảnh bill ✓", "success");
    setBillTarget(null);
    await new Promise((r) => setTimeout(r, 400));
    void loadPayments();
  }

  async function deletePaymentRequest() {
    if (!billTarget) return;
    if (!confirm(`Xoá toàn bộ yêu cầu thanh toán của ${billTarget.email}? Không thể hoàn tác.`)) return;
    showToast("Đang xoá...");
    try {
      await adminCall("/api/admin/payments", { action: "delete", req_id: billTarget.id });
    } catch (err) {
      showToast("Lỗi: " + (err instanceof AdminApiError ? err.message : "không rõ"), "error");
      return;
    }
    showToast("Đã xoá yêu cầu thanh toán ✓", "success");
    setBillTarget(null);
    await new Promise((r) => setTimeout(r, 400));
    void loadPayments();
  }

  function statusBadge(s: string) {
    if (s === "approved") return <span className="status-badge status-approved">✓ Đã duyệt</span>;
    if (s === "rejected") return <span className="status-badge status-rejected">✗ Từ chối</span>;
    return <span className="status-badge status-pending">⏳ Pending</span>;
  }

  const emptyMsg: Record<FilterStatus, string> = {
    all: "Chưa có yêu cầu nào.",
    pending: "Không có yêu cầu nào đang chờ duyệt 🎉",
    approved: "Chưa có yêu cầu nào được duyệt.",
    rejected: "Chưa có yêu cầu nào bị từ chối.",
  };

  return (
    <div id="tab-payments" className="tab-pane" style={{ display: "flex", flexDirection: "column" }}>
      <div className="topbar">
        <div>
          <div className="topbar-title">Kiểm tra thanh toán</div>
          <div className="topbar-sub">Xem bill, duyệt &amp; cấp quyền cho học viên</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div className="pay-filter-bar">
            {(["all","pending","approved","rejected"] as FilterStatus[]).map((f) => (
              <button type="button" key={f} className={`pay-filter-btn${filter === f ? " active" : ""}`} onClick={() => setFilterAnd(f)}>
                {f === "all" ? "Tất cả" : f === "pending" ? "⏳ Pending" : f === "approved" ? "✓ Đã duyệt" : "✗ Từ chối"}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => void loadPayments()} style={{ padding: "7px 14px", borderRadius: 7, border: "1px solid #2a2a2a", background: "transparent", color: "#666", fontFamily: "Be Vietnam Pro,Noto Sans JP,sans-serif", fontSize: 11, cursor: "pointer" }}>↻ Refresh</button>
        </div>
      </div>

      <div className="stats-row">
        <div className="stat-card"><div className="n">{loading ? "—" : total}</div><div className="l">Tổng yêu cầu</div></div>
        <div className="stat-card"><div className="n" style={{ color: "#e8502a" }}>{loading ? "—" : pending}</div><div className="l">Chờ duyệt</div></div>
        <div className="stat-card"><div className="n" style={{ color: "#2DB87A" }}>{loading ? "—" : approved}</div><div className="l">Đã duyệt</div></div>
        <div className="stat-card"><div className="n" style={{ color: "#555" }}>{loading ? "—" : rejected}</div><div className="l">Từ chối</div></div>
      </div>

      <div className="table-wrap">
        <table>
          <thead><tr>
            <th>Học viên</th><th>Gói</th><th>Nội dung CK</th>
            <th>Ngày gửi</th><th>Trạng thái</th><th>Bill</th><th>Thao tác</th>
          </tr></thead>
          <tbody id="pay-tbody">
            {loading && <tr><td colSpan={7} style={{ textAlign: "center", padding: 32, color: "#2a2a2a" }}>Đang tải...</td></tr>}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={7} style={{ textAlign: "center", padding: 40, color: "#2a2a2a" }}>{emptyMsg[filter]}</td></tr>
            )}
            {!loading && filtered.map((r, i) => {
              const init = (r.email || "?")[0].toUpperCase();
              const date = r.created_at
                ? new Date(r.created_at).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
                : "—";
              return (
                <tr key={r.id}>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div className="s-av" style={{ background: AVC[i % AVC.length], width: 26, height: 26, fontSize: 11 }}>{init}</div>
                      <div style={{ fontSize: 12, color: "#ccc", fontWeight: 500 }}>{r.email || "—"}</div>
                    </div>
                  </td>
                  <td style={{ fontSize: 11, color: "#d4890a", fontWeight: 700 }}>{PLAN_LABEL[r.plan] || r.plan}</td>
                  <td style={{ fontSize: 11, color: "#444", maxWidth: 130, wordBreak: "break-all" }}>{r.note || "—"}</td>
                  <td style={{ fontSize: 11, color: "#333" }}>{date}</td>
                  <td>{statusBadge(r.status)}</td>
                  <td>
                    {r.screenshot
                      ? <button type="button" className="act-btn" onClick={() => setBillTarget(r)}>🖼 Xem bill</button>
                      : <span style={{ fontSize: 11, color: "#2a2a2a" }}>Không có</span>
                    }
                  </td>
                  <td>
                    {r.status === "pending" ? (
                      <>
                        <button type="button" className="act-btn promote" onClick={() => void approvePayment(r.id, r.user_id, r.plan, r.email || "")}>✓ Duyệt</button>
                        <button type="button" className="act-btn danger" onClick={() => void rejectPayment(r.id, r.email || "")}>✗ Từ chối</button>
                        <button type="button" className="act-btn danger" onClick={() => void deletePaymentById(r.id)}>🗑</button>
                      </>
                    ) : (
                      <button type="button" className="act-btn danger" onClick={() => void deletePaymentById(r.id)}>🗑 Xoá</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Bill modal */}
      {billTarget && (
        <div className="modal-overlay active" id="bill-modal" onClick={(e) => { if (e.target === e.currentTarget) setBillTarget(null); }}>
          <div className="bill-modal-wrap" style={{ maxWidth: 560, width: "92%" }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 4 }}>🖼 Bill thanh toán</div>
                <div id="bill-info" style={{ fontSize: 11, color: "#555", lineHeight: 1.7 }}>
                  <b style={{ color: "#ccc" }}>{billTarget.email}</b> &nbsp;·&nbsp; {PLAN_LABEL_MODAL[billTarget.plan] || billTarget.plan}<br />
                  Nội dung: <b style={{ color: "#d4890a" }}>{billTarget.note || "—"}</b><br />
                  Gửi lúc: {billTarget.created_at ? new Date(billTarget.created_at).toLocaleString("vi-VN") : "—"}
                </div>
              </div>
              <button type="button" onClick={() => setBillTarget(null)} style={{ background: "transparent", border: "none", color: "#555", fontSize: 20, cursor: "pointer" }}>×</button>
            </div>
            {billTarget.screenshot && (
              // eslint-disable-next-line @next/next/no-img-element
              <img id="bill-img" src={billTarget.screenshot} alt="bill" style={{ width: "100%", maxHeight: 400, objectFit: "contain", borderRadius: 10, border: "1px solid #2a2a2a", background: "#0a0a0a", marginBottom: 16 }} />
            )}
            <div className="modal-btns" style={{ flexWrap: "wrap", gap: 8 }}>
              <button type="button" className="modal-cancel" onClick={() => setBillTarget(null)}>Đóng</button>
              {billTarget.status === "pending" && (
                <>
                  <button type="button" id="bill-approve-btn" className="modal-confirm" onClick={() => void approvePayment(billTarget.id, billTarget.user_id, billTarget.plan, billTarget.email || "")}>✓ Duyệt &amp; cấp quyền</button>
                  <button type="button" id="bill-reject-btn" className="modal-confirm danger" onClick={() => void rejectPayment(billTarget.id, billTarget.email || "")}>✗ Từ chối</button>
                </>
              )}
              {billTarget.screenshot && (
                <button type="button" id="bill-del-screenshot-btn" className="act-btn danger" style={{ fontSize: 12 }} onClick={() => void deleteScreenshot()}>🗑 Xoá ảnh</button>
              )}
              <button type="button" className="act-btn danger" style={{ fontSize: 12, marginLeft: "auto" }} onClick={() => void deletePaymentRequest()}>🗑 Xoá yêu cầu</button>
            </div>
          </div>
        </div>
      )}

      {toast.msg && <div className={`toast show ${toast.type}`}>{toast.msg}</div>}
    </div>
  );
}

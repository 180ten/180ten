"use client";
import { useState, useEffect, useCallback } from "react";
import { sb } from "@/lib/supabase";
import { adminCall, AdminApiError } from "@/lib/adminApi";

interface Exam { id: string; name: string; level: string; is_published: boolean; is_premium: boolean; created_at?: string; }

interface ExamsTabProps { onComposeNew: () => void; }

const LEVEL_COLORS: Record<string, string> = { N1: "#e74c3c", N2: "#e67e22", N3: "#2ecc71", N4: "#3498db", N5: "#9b59b6", BJT: "#8b5cf6" };

export default function ExamsTab({ onComposeNew }: ExamsTabProps) {
  const [exams, setExams]   = useState<Exam[]>([]);
  const [loading, setLoading] = useState(false);
  const [toast, setToast]     = useState("");

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(""), 2500); }

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await sb.from("exams").select("*").order("level").order("name");
    setExams((data ?? []) as Exam[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(t);
  }, [load]);

  async function togglePublish(e: Exam) {
    try {
      await adminCall("/api/admin/exams", { action: "toggle_publish", exam_id: e.id, value: !e.is_published });
      showToast(e.is_published ? "Đã ẩn đề." : "Đã xuất bản!");
      load();
    } catch (err) { showToast("Lỗi: " + (err instanceof AdminApiError ? err.message : "không rõ")); }
  }

  async function toggleFree(e: Exam) {
    try {
      await adminCall("/api/admin/exams", { action: "toggle_premium", exam_id: e.id, value: !e.is_premium });
      showToast("Đã cập nhật.");
      load();
    } catch (err) { showToast("Lỗi: " + (err instanceof AdminApiError ? err.message : "không rõ")); }
  }

  async function editExam(e: Exam) {
    onComposeNew(); // Switch to compose tab first
    // Wait for ComposeTab to mount and expose _jlptLoadExam
    let tries = 0;
    const interval = setInterval(() => {
      tries++;
      const loader = (window as unknown as Record<string, unknown>)._jlptLoadExam as ((e: unknown) => Promise<void>) | undefined;
      if (loader) { clearInterval(interval); void loader(e); }
      else if (tries > 50) { clearInterval(interval); showToast("Lỗi: Compose tab chưa sẵn sàng."); }
    }, 100);
  }

  async function deleteExam(e: Exam) {
    if (!confirm(`Xóa đề "${e.name}"? Không thể hoàn tác.`)) return;
    try {
      await adminCall("/api/admin/exams", { action: "delete", exam_id: e.id });
      showToast("Đã xóa đề.");
      load();
    } catch (err) { showToast("Lỗi: " + (err instanceof AdminApiError ? err.message : "không rõ")); }
  }

  return (
    <div id="tab-exams" className="tab-pane" style={{ display: "flex", flexDirection: "column" }}>
      <div className="topbar">
        <div><div className="topbar-title">Danh sách đề thi</div><div className="topbar-sub">Xuất bản / ẩn / xóa đề</div></div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={load} style={{ padding: "7px 14px", borderRadius: 7, border: "1px solid #2a2a2a", background: "transparent", color: "#666", fontFamily: "Be Vietnam Pro,Noto Sans JP,sans-serif", fontSize: 11, cursor: "pointer" }}>↻ Refresh</button>
          <button onClick={onComposeNew} style={{ padding: "7px 14px", borderRadius: 7, border: "none", background: "#e8502a", color: "#fff", fontFamily: "Be Vietnam Pro,Noto Sans JP,sans-serif", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>+ Soạn đề mới</button>
        </div>
      </div>
      <div className="exam-grid-admin" id="exam-admin-grid">
        {loading && <div style={{ gridColumn: "1/-1", color: "#2a2a2a", textAlign: "center", padding: 40 }}>Đang tải...</div>}
        {!loading && exams.length === 0 && <div style={{ gridColumn: "1/-1", color: "#333", textAlign: "center", padding: 40 }}>Chưa có đề thi nào.</div>}
        {!loading && exams.map((e) => (
          <div key={e.id} className={`exam-card-admin ${e.level.toLowerCase()}`}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: LEVEL_COLORS[e.level] ?? "#888", background: (LEVEL_COLORS[e.level] ?? "#888") + "22", padding: "2px 8px", borderRadius: 99 }}>{e.level}</span>
              <div style={{ display: "flex", gap: 4 }}>
                <span style={{ fontSize: 10, color: e.is_published ? "#2DB87A" : "#555", fontWeight: 700 }}>{e.is_published ? "● Công khai" : "○ Ẩn"}</span>
                <span style={{ fontSize: 10, color: e.is_premium ? "#555" : "#d4890a", fontWeight: 700, marginLeft: 6 }}>{e.is_premium ? "Premium" : "Free"}</span>
              </div>
            </div>
            <h4>{e.name}</h4>
            <div style={{ fontSize: 11, color: "#444", marginTop: 4, marginBottom: 12 }}>
              {e.created_at ? new Date(e.created_at).toLocaleDateString("vi-VN") : "—"}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button className="act-btn" onClick={() => togglePublish(e)} style={{ flex: 1 }}>
                {e.is_published ? "Ẩn" : "Xuất bản"}
              </button>
              <button className="act-btn" onClick={() => toggleFree(e)} style={{ flex: 1 }}>
                {e.is_premium ? "→ Free" : "→ Premium"}
              </button>
              <button className="act-btn" onClick={() => editExam(e)}>✎ Sửa</button>
              <button className="act-btn danger" onClick={() => deleteExam(e)}>🗑</button>
            </div>
          </div>
        ))}
      </div>
      {toast && <div className="toast show default">{toast}</div>}
    </div>
  );
}

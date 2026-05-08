"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { sb } from "@/lib/supabase";
import { adminCall, AdminApiError } from "@/lib/adminApi";

interface GrammarEntry {
  id?: string | number;
  name: string;
  furigana?: string;
  meaning: string;
  conjugation?: string;
  jlpt_level?: string;
  examples?: string[];
}

type EditingEntry = Partial<GrammarEntry> & { examples?: string[] };

const BATCH = 1000;

export default function GrammarTab() {
  const [all, setAll]                 = useState<GrammarEntry[]>([]);
  const [filtered, setFiltered]       = useState<GrammarEntry[]>([]);
  const [loading, setLoading]         = useState(false);
  const [query, setQuery]             = useState("");
  const [levelFilter, setLevelFilter] = useState("");
  const [editEntry, setEditEntry]     = useState<EditingEntry | null>(null);
  const [editOpen, setEditOpen]       = useState(false);
  const [editingId, setEditingId]     = useState<string | number | null>(null);
  const [editErr, setEditErr]         = useState("");
  const [saving, setSaving]           = useState(false);
  const [toast, setToast]             = useState({ msg: "", type: "default" });
  const importRef                     = useRef<HTMLInputElement>(null);
  // Bulk-select để xoá nhiều dòng cùng lúc
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy]       = useState(false);

  function showToast(msg: string, type = "default") {
    setToast({ msg, type });
    setTimeout(() => setToast({ msg: "", type: "default" }), 2800);
  }

  const loadGrammarList = useCallback(async () => {
    setLoading(true);
    let all2: GrammarEntry[] = [];
    let from = 0;
    while (true) {
      const { data, error } = await sb
        .from("grammar_library")
        .select("*")
        .order("created_at", { ascending: false })
        .range(from, from + BATCH - 1);
      if (error) { showToast("Lỗi: " + error.message, "error"); setLoading(false); return; }
      all2 = all2.concat((data ?? []) as GrammarEntry[]);
      if (!data || data.length < BATCH) break;
      from += BATCH;
    }
    setAll(all2);
    applyFilters(all2, query, levelFilter);
    setLoading(false);
  }, [query, levelFilter]);

  useEffect(() => {
    const t = setTimeout(() => { void loadGrammarList(); }, 0);
    return () => clearTimeout(t);
  }, [loadGrammarList]);

  function applyFilters(rows: GrammarEntry[], q: string, lv: string) {
    let res = rows;
    if (lv) res = res.filter((g) => g.jlpt_level === lv);
    if (q.trim()) {
      const lq = q.toLowerCase();
      res = res.filter((g) =>
        (g.name || "").includes(q) ||
        (g.furigana || "").includes(q) ||
        (g.meaning || "").toLowerCase().includes(lq) ||
        (g.conjugation || "").toLowerCase().includes(lq)
      );
    }
    setFiltered(res);
  }

  const total = all.length;
  const n5    = all.filter((g) => g.jlpt_level === "N5").length;
  const n4    = all.filter((g) => g.jlpt_level === "N4").length;
  const n3up  = all.filter((g) => g.jlpt_level && ["N3","N2","N1"].includes(g.jlpt_level)).length;

  const lvlColor: Record<string, string> = { N5:"#9B59B6",N4:"#3498db",N3:"#2ecc71",N2:"#e67e22",N1:"#e74c3c" };

  function openGrammarForm(grammar?: GrammarEntry) {
    setEditingId(grammar?.id ?? null);
    setEditEntry(grammar
      ? { ...grammar, examples: Array.isArray(grammar.examples) ? [...grammar.examples] : [] }
      : { name: "", furigana: "", meaning: "", conjugation: "", jlpt_level: "", examples: [""] }
    );
    setEditErr(""); setEditOpen(true);
  }

  function setExamples(exs: string[]) {
    setEditEntry((p) => p ? { ...p, examples: exs } : p);
  }

  async function saveGrammar() {
    if (!editEntry?.name?.trim() || !editEntry?.meaning?.trim()) {
      setEditErr("Vui lòng nhập đủ: Tên ngữ pháp, Nghĩa."); return;
    }
    setSaving(true); setEditErr("");
    const payload: Omit<GrammarEntry, "id"> = {
      name:        editEntry.name!.trim(),
      meaning:     editEntry.meaning!.trim(),
      furigana:    editEntry.furigana?.trim() || null as unknown as string,
      conjugation: editEntry.conjugation?.trim() || null as unknown as string,
      jlpt_level:  editEntry.jlpt_level || null as unknown as string,
      examples:    (editEntry.examples ?? []).filter(Boolean),
    };
    try {
      if (editingId) {
        await adminCall("/api/admin/grammar", { action: "update", id: String(editingId), payload });
      } else {
        await adminCall("/api/admin/grammar", { action: "create", payload });
      }
    } catch (err) {
      setSaving(false);
      setEditErr("Lỗi: " + (err instanceof AdminApiError ? err.message : "không rõ"));
      return;
    }
    setSaving(false);
    showToast(editingId ? "Đã cập nhật ngữ pháp ✓" : "Đã thêm ngữ pháp ✓", "success");
    setEditOpen(false); setEditEntry(null); setEditingId(null);
    void loadGrammarList();
  }

  async function deleteGrammar(id: string | number, name: string) {
    if (!confirm(`Xóa ngữ pháp "${name}"? Không thể hoàn tác.`)) return;
    try {
      await adminCall("/api/admin/grammar", { action: "delete", id: String(id) });
    } catch (err) {
      showToast("Lỗi: " + (err instanceof AdminApiError ? err.message : "không rõ"), "error");
      return;
    }
    showToast(`Đã xóa "${name}" ✓`, "success");
    void loadGrammarList();
  }

  // ── Bulk select / delete ──────────────────────────────────────────────
  function toggleSelect(id: string | number | undefined) {
    if (id == null) return;
    const key = String(id);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  function toggleSelectAllFiltered() {
    const visibleIds = filtered.map((g) => g.id).filter((x): x is string | number => x != null).map(String);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  }
  function clearSelection() { setSelectedIds(new Set()); }

  async function bulkDeleteSelected() {
    if (selectedIds.size === 0) return;
    if (!confirm(`Xoá ${selectedIds.size} ngữ pháp đã chọn? Không thể hoàn tác.`)) return;
    setBulkBusy(true);
    const ids = Array.from(selectedIds);
    let okCount = 0, failCount = 0; let lastErr = "";
    for (const id of ids) {
      try {
        await adminCall("/api/admin/grammar", { action: "delete", id });
        okCount++;
      } catch (err) {
        failCount++;
        lastErr = err instanceof AdminApiError ? err.message : "không rõ";
      }
    }
    setBulkBusy(false);
    setSelectedIds(new Set());
    if (failCount === 0) showToast(`Đã xoá ${okCount} ngữ pháp ✓`, "success");
    else showToast(`Xoá ${okCount}/${ids.length} — ${failCount} lỗi (${lastErr})`, "error");
    void loadGrammarList();
  }

  async function importGrammarExcel(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    showToast("Đang đọc file Excel...");
    try {
      const XLSX = (await import("xlsx")).default;
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as string[][];
      const firstCell = String(rows[0]?.[0] || "").trim();
      const startIdx = (firstCell === "Tên ngữ pháp" || firstCell === "name") ? 1 : 0;
      const dataRows = rows.slice(startIdx)
        .filter((r) => String(r[0] || "").trim())
        .map((r) => ({
          name:        String(r[0] || "").trim(),
          furigana:    String(r[1] || "").trim() || null,
          meaning:     String(r[2] || "").trim(),
          conjugation: String(r[3] || "").trim() || null,
          jlpt_level:  String(r[4] || "").trim() || null,
          examples:    r.slice(5).map((c) => String(c).trim()).filter(Boolean),
        }))
        .filter((r) => r.name && r.meaning);
      if (!dataRows.length) { showToast("File không có dữ liệu hợp lệ.", "error"); return; }
      showToast("Đang cập nhật thư viện...");
      let done = 0;
      for (let i = 0; i < dataRows.length; i += 50) {
        try {
          await adminCall("/api/admin/grammar", { action: "bulk_upsert", rows: dataRows.slice(i, i + 50) });
        } catch (err) {
          showToast("Lỗi import: " + (err instanceof AdminApiError ? err.message : "không rõ"), "error");
          return;
        }
        done += Math.min(50, dataRows.length - i);
      }
      showToast(`Đã import ${done} ngữ pháp ✓`, "success");
      void loadGrammarList();
    } catch (err: unknown) {
      showToast("Lỗi đọc file: " + (err as Error).message, "error");
    }
    if (importRef.current) importRef.current.value = "";
  }

  async function downloadTemplate() {
    const XLSX = (await import("xlsx")).default;
    const ws = XLSX.utils.aoa_to_sheet([
      ["Tên ngữ pháp","Furigana (không bắt buộc)","Nghĩa","Cách chia / Cấu trúc","Cấp độ JLPT","Ví dụ 1","Ví dụ 2","Ví dụ 3"],
      ["〜てもいい","てもいい","được phép làm ~","動詞て形 + もいい\n例：食べてもいい","N5","ここで写真を撮ってもいいですか。→ Tôi có thể chụp ảnh không?","窓を開けてもいいです。→ Bạn có thể mở cửa sổ.",""],
      ["〜ながら","ながら","vừa ~ vừa ~","動詞ます形 + ながら","N4","音楽を聴きながら勉強します。→ Vừa nghe nhạc vừa học bài.","",""],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Ngữ pháp");
    XLSX.writeFile(wb, "grammar_template.xlsx");
  }

  return (
    <div id="tab-grammar" className="tab-pane" style={{ display: "flex", flexDirection: "column" }}>
      <div className="topbar">
        <div>
          <div className="topbar-title">Thư viện ngữ pháp</div>
          <div className="topbar-sub">Quản lý ngữ pháp — hiển thị trên trang học sinh</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" onClick={() => void loadGrammarList()} style={{ padding: "7px 14px", borderRadius: 7, border: "1px solid #2a2a2a", background: "transparent", color: "#666", fontFamily: "Be Vietnam Pro,Noto Sans JP,sans-serif", fontSize: 11, cursor: "pointer" }}>↻ Refresh</button>
          <button type="button" onClick={() => void downloadTemplate()} style={{ padding: "7px 14px", borderRadius: 7, border: "1px solid #2a2a2a", background: "transparent", color: "#666", fontFamily: "Be Vietnam Pro,Noto Sans JP,sans-serif", fontSize: 11, cursor: "pointer" }}>⬇ Template</button>
          <label style={{ padding: "7px 14px", borderRadius: 7, border: "1px solid #2a2a2a", background: "transparent", color: "#666", fontFamily: "Be Vietnam Pro,Noto Sans JP,sans-serif", fontSize: 11, cursor: "pointer" }}>
            📥 Import Excel
            <input ref={importRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={(e) => void importGrammarExcel(e)} />
          </label>
          <button type="button" onClick={() => openGrammarForm()} style={{ padding: "7px 14px", borderRadius: 7, border: "none", background: "#e8502a", color: "#fff", fontFamily: "Be Vietnam Pro,Noto Sans JP,sans-serif", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>+ Thêm ngữ pháp</button>
        </div>
      </div>

      <div className="stats-row">
        <div className="stat-card"><div className="n" id="gs-total">{loading ? "—" : total}</div><div className="l">Tổng ngữ pháp</div></div>
        <div className="stat-card"><div className="n" style={{ color: "#9B59B6" }} id="gs-n5">{loading ? "—" : n5}</div><div className="l">N5</div></div>
        <div className="stat-card"><div className="n" style={{ color: "#3498db" }} id="gs-n4">{loading ? "—" : n4}</div><div className="l">N4</div></div>
        <div className="stat-card"><div className="n" style={{ color: "#2ecc71" }} id="gs-n3up">{loading ? "—" : n3up}</div><div className="l">N3 trở lên</div></div>
      </div>

      <div style={{ margin: "0 22px 14px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <input
          className="search-input" id="grammar-search" placeholder="🔍 Tìm ngữ pháp..." value={query}
          onChange={(e) => { setQuery(e.target.value); applyFilters(all, e.target.value, levelFilter); }}
          style={{ width: 240 }}
        />
        <select id="grammar-level-filter" value={levelFilter}
          onChange={(e) => { setLevelFilter(e.target.value); applyFilters(all, query, e.target.value); }}
          style={{ padding: "6px 10px", borderRadius: 7, border: "1px solid #2a2a2a", background: "#0f0f0f", color: "#e8e8e8", fontFamily: "Be Vietnam Pro,Noto Sans JP,sans-serif", fontSize: 12 }}>
          <option value="">Tất cả cấp độ</option>
          {["N5","N4","N3","N2","N1"].map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
      </div>

      {/* Bulk-action bar */}
      {selectedIds.size > 0 && (
        <div style={{ margin: "0 22px 12px", display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", background: "#2a0e0e", border: "1px solid #5a1f1f", borderRadius: 10 }}>
          <span style={{ fontSize: 12, color: "#f0a8a8", fontWeight: 600 }}>Đã chọn {selectedIds.size} ngữ pháp</span>
          <button type="button" onClick={clearSelection} style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid #5a1f1f", background: "transparent", color: "#bbb", fontFamily: "Be Vietnam Pro,Noto Sans JP,sans-serif", fontSize: 11, cursor: "pointer" }}>Bỏ chọn</button>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            onClick={() => void bulkDeleteSelected()}
            disabled={bulkBusy}
            title="Xoá các ngữ pháp đã tick"
            style={{ padding: "7px 14px", borderRadius: 7, border: "none", background: "#E05555", color: "#fff", fontFamily: "Be Vietnam Pro,Noto Sans JP,sans-serif", fontSize: 12, fontWeight: 700, cursor: bulkBusy ? "wait" : "pointer", opacity: bulkBusy ? 0.6 : 1, display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            🗑 {bulkBusy ? "Đang xoá..." : `Xoá ${selectedIds.size} ngữ pháp`}
          </button>
        </div>
      )}

      <div className="table-wrap" style={{ margin: "0 22px 22px" }}>
        <table>
          <thead><tr>
            <th style={{ width: 36, textAlign: "center" }}>
              <input
                type="checkbox"
                aria-label="Chọn tất cả"
                checked={filtered.length > 0 && filtered.every((g) => g.id != null && selectedIds.has(String(g.id)))}
                onChange={toggleSelectAllFiltered}
                style={{ cursor: "pointer" }}
              />
            </th>
            <th>Tên ngữ pháp</th><th>Furigana</th><th>Nghĩa</th>
            <th style={{ minWidth: 160 }}>Cách chia</th><th>Ví dụ</th><th>Cấp độ</th><th>Thao tác</th>
          </tr></thead>
          <tbody id="grammar-tbody">
            {loading && <tr><td colSpan={8} style={{ textAlign: "center", padding: 32, color: "#444" }}>Đang tải...</td></tr>}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={8} style={{ textAlign: "center", padding: 32, color: "#444" }}>Chưa có ngữ pháp nào.</td></tr>
            )}
            {!loading && filtered.map((g) => {
              const conj = g.conjugation
                ? g.conjugation.replace(/\n/g, " / ").substring(0, 60) + (g.conjugation.length > 60 ? "…" : "")
                : "—";
              const ex0 = (g.examples || []).slice(0, 1);
              const moreEx = (g.examples || []).length > 1;
              const lc = lvlColor[g.jlpt_level || ""] || "#555";
              const idKey = g.id != null ? String(g.id) : "";
              const checked = !!idKey && selectedIds.has(idKey);
              return (
                <tr key={g.id} style={{ background: checked ? "#1a1320" : undefined }}>
                  <td style={{ textAlign: "center" }}>
                    <input
                      type="checkbox"
                      aria-label={`Chọn ${g.name}`}
                      checked={checked}
                      onChange={() => toggleSelect(g.id)}
                      style={{ cursor: "pointer" }}
                    />
                  </td>
                  <td style={{ fontSize: 14, fontWeight: 700, color: "#e8e8e8" }}>{g.name || "—"}</td>
                  <td style={{ color: "#6C6FF7", fontSize: 12 }}>{g.furigana || "—"}</td>
                  <td>{g.meaning || "—"}</td>
                  <td style={{ fontSize: 11, color: "#555", maxWidth: 200 }}>{conj}</td>
                  <td>
                    {ex0.map((e, i) => <span key={i} style={{ fontSize: 10, color: "#555" }}>{e}</span>)}
                    {moreEx && <span style={{ fontSize: 10, color: "#3a3a3a" }}> +{(g.examples!).length - 1}</span>}
                  </td>
                  <td>
                    <span style={{ padding: "2px 8px", borderRadius: 99, fontSize: 10, fontWeight: 700, background: lc + "18", color: lc }}>
                      {g.jlpt_level || "—"}
                    </span>
                  </td>
                  <td>
                    <button type="button" className="act-btn" onClick={() => openGrammarForm(g)}>✎ Sửa</button>
                    <button type="button" className="act-btn danger" onClick={() => void deleteGrammar(g.id!, g.name)}>Xóa</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Add / Edit modal */}
      {editOpen && editEntry !== null && (
        <div
          className="modal-overlay active"
          style={{ alignItems: "flex-start", padding: "40px 0", overflowY: "auto" }}
          onClick={(e) => { if (e.target === e.currentTarget) setEditOpen(false); }}
        >
          <div id="grammar-modal" style={{ background: "#141414", border: "1px solid #2a2a2a", borderRadius: 14, width: "92%", maxWidth: 640, margin: "auto", padding: 28 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 22 }}>
              <div id="grammar-modal-title" style={{ fontSize: 15, fontWeight: 800 }}>{editingId ? "Sửa ngữ pháp" : "Thêm ngữ pháp"}</div>
              <button type="button" onClick={() => setEditOpen(false)} style={{ background: "transparent", border: "none", color: "#555", fontSize: 20, cursor: "pointer" }}>×</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
              {([
                { label: "Tên ngữ pháp *", field: "name",     placeholder: "〜てもいい" },
                { label: "Furigana",       field: "furigana", placeholder: "てもいい" },
              ] as { label: string; field: keyof EditingEntry; placeholder: string }[]).map(({ label, field, placeholder }) => (
                <div key={field}>
                  <label style={{ fontSize: 10, fontWeight: 700, color: "#555", textTransform: "uppercase", letterSpacing: ".06em", display: "block", marginBottom: 5 }}>{label}</label>
                  <input
                    id={`gf-${field}`}
                    value={String(editEntry[field] ?? "")}
                    onChange={(e) => setEditEntry((p) => p ? { ...p, [field]: e.target.value } : p)}
                    placeholder={placeholder}
                    style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1.5px solid #2a2a2a", background: "#0f0f0f", color: "#e8e8e8", fontFamily: "Be Vietnam Pro,Noto Sans JP,sans-serif", fontSize: 13, outline: "none" }} />
                </div>
              ))}
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 10, fontWeight: 700, color: "#555", textTransform: "uppercase", letterSpacing: ".06em", display: "block", marginBottom: 5 }}>Nghĩa *</label>
              <input id="gf-meaning" value={editEntry.meaning ?? ""} onChange={(e) => setEditEntry((p) => p ? { ...p, meaning: e.target.value } : p)} placeholder="được phép làm ~" style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1.5px solid #2a2a2a", background: "#0f0f0f", color: "#e8e8e8", fontFamily: "Be Vietnam Pro,Noto Sans JP,sans-serif", fontSize: 13, outline: "none" }} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14, marginBottom: 14 }}>
              <div>
                <label style={{ fontSize: 10, fontWeight: 700, color: "#555", textTransform: "uppercase", letterSpacing: ".06em", display: "block", marginBottom: 5 }}>Cách chia / Cấu trúc</label>
                <textarea id="gf-conjugation" value={editEntry.conjugation ?? ""} onChange={(e) => setEditEntry((p) => p ? { ...p, conjugation: e.target.value } : p)} placeholder={"動詞て形 + もいい\n例：食べてもいい"} rows={3} style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1.5px solid #2a2a2a", background: "#0f0f0f", color: "#e8e8e8", fontFamily: "Be Vietnam Pro,Noto Sans JP,sans-serif", fontSize: 12, outline: "none", resize: "vertical" }} />
              </div>
              <div>
                <label style={{ fontSize: 10, fontWeight: 700, color: "#555", textTransform: "uppercase", letterSpacing: ".06em", display: "block", marginBottom: 5 }}>Cấp độ JLPT</label>
                <select id="gf-level" value={editEntry.jlpt_level ?? ""} onChange={(e) => setEditEntry((p) => p ? { ...p, jlpt_level: e.target.value } : p)} style={{ padding: "9px 12px", borderRadius: 8, border: "1.5px solid #2a2a2a", background: "#0f0f0f", color: "#e8e8e8", fontFamily: "Be Vietnam Pro,Noto Sans JP,sans-serif", fontSize: 13, outline: "none" }}>
                  <option value="">—</option>
                  {["N5","N4","N3","N2","N1"].map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
            </div>
            <div style={{ marginBottom: 18 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <label style={{ fontSize: 10, fontWeight: 700, color: "#555", textTransform: "uppercase", letterSpacing: ".06em" }}>Ví dụ</label>
                <button type="button" onClick={() => setExamples([...(editEntry.examples ?? []), ""])} style={{ fontSize: 11, padding: "3px 10px", borderRadius: 6, border: "1px solid #2a2a2a", background: "transparent", color: "#e8502a", cursor: "pointer" }}>+ Thêm</button>
              </div>
              <div id="gf-examples-wrap">
                {(editEntry.examples ?? [""]).map((ex, idx) => (
                  <div key={idx} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 7 }}>
                    <input value={ex} placeholder="例：ここで写真を撮ってもいいですか。→ Tôi có thể chụp ảnh ở đây không?" onChange={(e) => { const exs = [...(editEntry.examples ?? [])]; exs[idx] = e.target.value; setExamples(exs); }} style={{ flex: 1, padding: "8px 12px", borderRadius: 7, border: "1.5px solid #2a2a2a", background: "#0f0f0f", color: "#e8e8e8", fontFamily: "Be Vietnam Pro,Noto Sans JP,sans-serif", fontSize: 12, outline: "none" }} />
                    <button type="button" onClick={() => setExamples((editEntry.examples ?? []).filter((_, i) => i !== idx))} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #2a2a2a", background: "transparent", color: "#E05555", cursor: "pointer", fontSize: 13 }}>✕</button>
                  </div>
                ))}
              </div>
            </div>
            {editErr && <div id="gf-err" style={{ color: "#E05555", fontSize: 12, marginBottom: 12 }}>{editErr}</div>}
            <div style={{ display: "flex", gap: 10 }}>
              <button type="button" className="modal-cancel" style={{ flex: 1 }} onClick={() => setEditOpen(false)}>Hủy</button>
              <button type="button" id="gf-save-btn" disabled={saving} className="modal-confirm" style={{ flex: 2, background: "#e8502a" }} onClick={() => void saveGrammar()}>
                {saving ? "Đang lưu..." : "💾 Lưu ngữ pháp"}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast.msg && <div className={`toast show ${toast.type}`}>{toast.msg}</div>}
    </div>
  );
}

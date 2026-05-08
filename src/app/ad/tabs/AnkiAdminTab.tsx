"use client";
import { useState, useEffect, useCallback } from "react";
import { sb } from "@/lib/supabase";
import { adminCall, AdminApiError } from "@/lib/adminApi";
import { fetchDictionaryWords } from "@/lib/dictionaryLookup";

interface AdminFolder { id: string; name: string; }
interface AdminDeck   { id: string; name: string; folder_id?: string; cards?: unknown[]; }

export default function AnkiAdminTab() {
  const [folders, setFolders] = useState<AdminFolder[]>([]);
  const [decks, setDecks]     = useState<AdminDeck[]>([]);
  // cards column is a JSONB array in anki_decks — no separate anki_cards table
  const [loading, setLoading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [deckName, setDeckName] = useState("");
  const [deckFolderId, setDeckFolderId] = useState("");
  const [deckWords, setDeckWords] = useState("");
  const [deckErr, setDeckErr]   = useState("");
  const [toast, setToast]       = useState("");
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [previewItems, setPreviewItems] = useState<Array<{ word: string; found: boolean; reading?: string; meaning?: string }>>([]);
  const [previewBusy, setPreviewBusy]   = useState(false);

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(""), 2500); }

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: fData }, { data: dData }] = await Promise.all([
      sb.from("anki_folders").select("*").order("name"),
      sb.from("anki_decks").select("id,name,folder_id,is_admin,cards").order("name"),
    ]);
    setFolders((fData ?? []) as AdminFolder[]);
    setDecks((dData ?? []) as AdminDeck[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(t);
  }, [load]);

  const totalCards = decks.reduce((s, d) => s + ((d.cards ?? []).length), 0);

  async function previewWords() {
    const words = deckWords.trim().split(/[\s\n,、]+/).map((w) => w.trim()).filter(Boolean);
    if (!words.length) { setDeckErr("Nhập ít nhất 1 từ để xem trước"); setPreviewItems([]); return; }
    setDeckErr("");
    setPreviewBusy(true);
    const { data: dictEntries, error } = await fetchDictionaryWords(sb, words);
    setPreviewBusy(false);
    if (error) { setDeckErr(error.message); return; }
    setPreviewItems(words.map((w) => {
      const e = dictEntries.find((d) => d.word === w) as Record<string, unknown> | undefined;
      return {
        word: w,
        found: !!e,
        reading: e ? String(e.reading ?? "") : undefined,
        meaning: e ? String(e.meaning ?? "") : undefined,
      };
    }));
  }

  async function saveAdminDeck() {
    if (!deckName.trim()) { setDeckErr("Nhập tên bộ thẻ"); return; }
    const words = deckWords.trim().split(/[\s\n]+/).filter(Boolean);
    if (!words.length) { setDeckErr("Nhập ít nhất 1 từ"); return; }
    setDeckErr("");
    const { data: dictEntries, error: dictErr } = await fetchDictionaryWords(sb, words);
    if (dictErr) { setDeckErr(dictErr.message); return; }

    const cards = words.map((w) => {
      const e = dictEntries.find((d) => d.word === w) as Record<string, unknown> | undefined;
      return {
        word: w,
        reading: e ? String(e.reading ?? "") : "",
        han_viet: e ? String(e.han_viet ?? "") : "",
        word_type: e ? String(e.word_type ?? "") : "",
        meaning: e ? String(e.meaning ?? "") : "",
        examples: e ? ((e.examples as unknown[]) ?? []) : [],
        vocab_id: e ? (e.id ?? null) : null,
      };
    });

    try {
      await adminCall("/api/admin/anki", {
        action: "create_deck",
        name: deckName.trim(),
        folder_id: deckFolderId || null,
        cards,
      });
    } catch (err) {
      setDeckErr(err instanceof AdminApiError ? err.message : "Lỗi không rõ");
      return;
    }
    showToast("Đã tạo bộ thẻ!");
    setFormOpen(false); setDeckName(""); setDeckFolderId(""); setDeckWords(""); setDeckErr("");
    setPreviewItems([]);
    load();
  }

  async function createFolder() {
    const name = prompt("Tên thư mục mới:");
    if (!name?.trim()) return;
    try {
      await adminCall("/api/admin/anki", { action: "create_folder", name: name.trim() });
      showToast("Đã tạo thư mục!"); load();
    } catch (err) { showToast("Lỗi: " + (err instanceof AdminApiError ? err.message : "không rõ")); }
  }

  async function deleteDeck(id: string) {
    if (!confirm("Xóa bộ thẻ này?")) return;
    try {
      await adminCall("/api/admin/anki", { action: "delete_deck", id });
      showToast("Đã xóa bộ thẻ."); load();
    } catch (err) { showToast("Lỗi: " + (err instanceof AdminApiError ? err.message : "không rõ")); }
  }

  async function dropToFolder(folderId: string | null) {
    if (!draggedId) return;
    const movingId = draggedId;
    setDraggedId(null); setDragOverId(null);
    try {
      await adminCall("/api/admin/anki", { action: "move_deck", id: movingId, folder_id: folderId });
      showToast(folderId ? "Đã chuyển bộ thẻ ✓" : "Đã bỏ khỏi thư mục ✓");
      load();
    } catch (err) { showToast("Lỗi: " + (err instanceof AdminApiError ? err.message : "không rõ")); }
  }

  async function deleteFolder(id: string) {
    if (!confirm("Xóa thư mục? Các bộ thẻ trong thư mục sẽ bị bỏ thư mục.")) return;
    try {
      await adminCall("/api/admin/anki", { action: "delete_folder", id });
      showToast("Đã xóa thư mục."); load();
    } catch (err) { showToast("Lỗi: " + (err instanceof AdminApiError ? err.message : "không rõ")); }
  }

  return (
    <div id="tab-anki" className="tab-pane" style={{ display: "flex", flexDirection: "column" }}>
      <div className="topbar">
        <div><div className="topbar-title">Anki Decks</div><div className="topbar-sub">Kéo bộ thẻ vào thư mục · 1 cấp · 1 thư mục/bộ thẻ</div></div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={createFolder} style={{ padding: "7px 14px", borderRadius: 7, border: "1px solid #6C6FF7", background: "#6C6FF715", color: "#6C6FF7", fontFamily: "Be Vietnam Pro,Noto Sans JP,sans-serif", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>📁 Tạo thư mục</button>
          <button onClick={() => setFormOpen((o) => !o)} style={{ padding: "7px 14px", borderRadius: 7, border: "none", background: "#6C6FF7", color: "#fff", fontFamily: "Be Vietnam Pro,Noto Sans JP,sans-serif", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>+ Tạo bộ thẻ</button>
        </div>
      </div>
      <div className="stats-row">
        <div className="stat-card"><div className="n" id="ak-total">{loading ? "—" : decks.length}</div><div className="l">Tổng bộ thẻ</div></div>
        <div className="stat-card"><div className="n" id="ak-folders" style={{ color: "#2DB87A" }}>{loading ? "—" : folders.length}</div><div className="l">Thư mục</div></div>
        <div className="stat-card"><div className="n" id="ak-cards" style={{ color: "#6C6FF7" }}>{loading ? "—" : totalCards}</div><div className="l">Tổng thẻ</div></div>
      </div>

      {formOpen && (
        <div id="admin-deck-form" style={{ margin: "0 22px 22px", background: "#141414", border: "1px solid #2a2a2a", borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 16, color: "#e8e8e8" }}>Tạo bộ thẻ mới</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 14 }}>
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, color: "#555", textTransform: "uppercase", letterSpacing: ".06em", display: "block", marginBottom: 5 }}>Tên bộ thẻ *</label>
              <input id="ad-deck-name" value={deckName} onChange={(e) => setDeckName(e.target.value)} placeholder="VD: N5 Cơ bản" style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1.5px solid #2a2a2a", background: "#0f0f0f", color: "#e8e8e8", fontFamily: "Be Vietnam Pro,Noto Sans JP,sans-serif", fontSize: 13, outline: "none" }} />
            </div>
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, color: "#555", textTransform: "uppercase", letterSpacing: ".06em", display: "block", marginBottom: 5 }}>Thư mục (tuỳ chọn)</label>
              <select id="ad-deck-folder" value={deckFolderId} onChange={(e) => setDeckFolderId(e.target.value)} style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1.5px solid #2a2a2a", background: "#0f0f0f", color: "#e8e8e8", fontFamily: "Be Vietnam Pro,Noto Sans JP,sans-serif", fontSize: 13, outline: "none" }}>
                <option value="">— Không có thư mục —</option>
                {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
          </div>
          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 10, fontWeight: 700, color: "#555", textTransform: "uppercase", letterSpacing: ".06em", display: "block", marginBottom: 5 }}>Danh sách từ vựng</label>
            <div style={{ fontSize: 11, color: "#444", marginBottom: 6 }}>Nhập từng từ cách nhau bằng dấu cách hoặc xuống dòng.</div>
            <textarea id="ad-deck-words" rows={5} value={deckWords} onChange={(e) => setDeckWords(e.target.value)} placeholder={"学校 行く 食べる\n先生 電車 勉強..."} style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1.5px solid #2a2a2a", background: "#0f0f0f", color: "#e8e8e8", fontFamily: "Be Vietnam Pro,Noto Sans JP,sans-serif", fontSize: 13, outline: "none", resize: "vertical" }} />
          </div>
          {previewItems.length > 0 && (
            <div style={{ marginBottom: 12, padding: "10px 12px", background: "#0f0f0f", border: "1px solid #2a2a2a", borderRadius: 8 }}>
              <div style={{ fontSize: 11, color: "#888", marginBottom: 8, display: "flex", justifyContent: "space-between" }}>
                <span>Xem trước {previewItems.length} thẻ</span>
                <span>
                  <span style={{ color: "#2DB87A" }}>● {previewItems.filter((i) => i.found).length} có trong từ điển</span>
                  &nbsp;·&nbsp;
                  <span style={{ color: "#E08A2B" }}>● {previewItems.filter((i) => !i.found).length} chưa có</span>
                </span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {previewItems.map((it, index) => (
                  <span
                    key={`${it.word}-${index}`}
                    title={it.found ? `${it.reading ?? ""} — ${it.meaning ?? ""}` : "Chưa có trong từ điển — sẽ tạo thẻ rỗng"}
                    style={{
                      padding: "4px 10px",
                      borderRadius: 99,
                      fontSize: 12,
                      fontWeight: 600,
                      background: it.found ? "#2DB87A22" : "#E08A2B22",
                      color: it.found ? "#2DB87A" : "#E08A2B",
                      border: `1px solid ${it.found ? "#2DB87A55" : "#E08A2B55"}`,
                    }}
                  >
                    {it.found ? "✓" : "⚠"} {it.word}
                  </span>
                ))}
              </div>
            </div>
          )}
          {deckErr && <div style={{ fontSize: 11, color: "#E05555", marginBottom: 10 }}>{deckErr}</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => { setFormOpen(false); setPreviewItems([]); }} style={{ padding: "9px 16px", borderRadius: 8, border: "1px solid #2a2a2a", background: "transparent", color: "#666", fontFamily: "Be Vietnam Pro,Noto Sans JP,sans-serif", fontSize: 12, cursor: "pointer" }}>Hủy</button>
            <button onClick={previewWords} disabled={previewBusy} style={{ padding: "9px 16px", borderRadius: 8, border: "1px solid #2a2a2a", background: "transparent", color: "#aaa", fontFamily: "Be Vietnam Pro,Noto Sans JP,sans-serif", fontSize: 12, cursor: "pointer", opacity: previewBusy ? 0.6 : 1 }}>
              {previewBusy ? "Đang kiểm tra..." : "🔍 Kiểm tra từ"}
            </button>
            <button onClick={saveAdminDeck} id="ad-deck-save" style={{ padding: "9px 20px", borderRadius: 8, border: "none", background: "#6C6FF7", color: "#fff", fontFamily: "Be Vietnam Pro,Noto Sans JP,sans-serif", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>💾 Lưu bộ thẻ</button>
          </div>
        </div>
      )}

      <div style={{ margin: "14px 22px 4px", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#555", textTransform: "uppercase", letterSpacing: ".06em" }}>Thư mục &amp; Bộ thẻ</span>
        <span style={{ fontSize: 10, color: "#333" }}>— kéo bộ thẻ vào thư mục để sắp xếp</span>
      </div>
      <div className="table-wrap" style={{ margin: "0 22px 16px" }}>
        <div id="anki-explorer" style={{ minHeight: 80, padding: "6px 0" }}>
          {loading && <div style={{ textAlign: "center", padding: 28, color: "#2a2a2a" }}>Đang tải...</div>}
          {!loading && (
            <>
              {/* Root decks — draggable, drop here removes folder */}
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOverId("root"); }}
                onDragLeave={() => setDragOverId(null)}
                onDrop={(e) => { e.preventDefault(); void dropToFolder(null); }}
                style={{ outline: dragOverId === "root" && draggedId ? "2px dashed #6C6FF7" : "none", borderRadius: 8, minHeight: 8 }}
              >
                {decks.filter((d) => !d.folder_id).map((d) => (
                  <div
                    key={d.id}
                    className="anki-deck-row"
                    draggable
                    onDragStart={() => setDraggedId(d.id)}
                    onDragEnd={() => { setDraggedId(null); setDragOverId(null); }}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderBottom: "1px solid #1a1a1a", opacity: draggedId === d.id ? 0.4 : 1, cursor: "grab" }}
                  >
                    <span style={{ flex: 1, fontWeight: 700, color: "#ccc", fontSize: 13 }}>🃏 {d.name}</span>
                    <span style={{ fontSize: 11, color: "#555" }}>{(d.cards ?? []).length} thẻ</span>
                    <button className="act-btn danger" onClick={() => deleteDeck(d.id)}>Xóa</button>
                  </div>
                ))}
              </div>
              {/* Folders — drop target */}
              {folders.map((f) => {
                const fDecks = decks.filter((d) => d.folder_id === f.id);
                const isOver = dragOverId === f.id && draggedId !== null;
                return (
                  <div
                    key={f.id}
                    className="anki-folder-row"
                    onDragOver={(e) => { e.preventDefault(); setDragOverId(f.id); }}
                    onDragLeave={() => setDragOverId(null)}
                    onDrop={(e) => { e.preventDefault(); void dropToFolder(f.id); }}
                    style={{ borderBottom: "1px solid #1a1a1a", outline: isOver ? "2px dashed #6C6FF7" : "none", borderRadius: 8 }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: isOver ? "#1a1a2e" : "#141414" }}>
                      <span style={{ flex: 1, fontWeight: 700, color: "#888", fontSize: 12 }}>📁 {f.name}</span>
                      <span style={{ fontSize: 11, color: "#555" }}>{fDecks.length} bộ thẻ</span>
                      <button className="act-btn danger" onClick={() => deleteFolder(f.id)}>Xóa thư mục</button>
                    </div>
                    {fDecks.map((d) => (
                      <div
                        key={d.id}
                        className="anki-deck-row"
                        draggable
                        onDragStart={() => setDraggedId(d.id)}
                        onDragEnd={() => { setDraggedId(null); setDragOverId(null); }}
                        style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 12px 7px 28px", borderTop: "1px solid #1a1a1a", opacity: draggedId === d.id ? 0.4 : 1, cursor: "grab" }}
                      >
                        <span style={{ flex: 1, color: "#aaa", fontSize: 12 }}>🃏 {d.name}</span>
                        <span style={{ fontSize: 11, color: "#555" }}>{(d.cards ?? []).length} thẻ</span>
                        <button className="act-btn danger" onClick={() => deleteDeck(d.id)}>Xóa</button>
                      </div>
                    ))}
                  </div>
                );
              })}
              {decks.length === 0 && <div style={{ textAlign: "center", padding: 28, color: "#333" }}>Chưa có bộ thẻ nào.</div>}
            </>
          )}
        </div>
      </div>
      {toast && <div className="toast show default">{toast}</div>}
    </div>
  );
}

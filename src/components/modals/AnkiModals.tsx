"use client";
import type { AnkiFolder, AnkiDeck, AnkiCard } from "@/components/tabs/AnkiTab";

/* ── Create Folder Modal ── */
interface CreateFolderModalProps {
  open: boolean;
  folderName: string;
  error: string;
  onNameChange: (v: string) => void;
  onSave: () => void;
  onClose: () => void;
}
export function CreateFolderModal({ open, folderName, error, onNameChange, onSave, onClose }: CreateFolderModalProps) {
  if (!open) return null;
  return (
    <div className="modal-overlay active" id="create-folder-modal" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: "var(--white)", borderRadius: "var(--r2)", width: "90%", maxWidth: 420, padding: 28, boxShadow: "var(--shadow2)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>Tạo thư mục mới</div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", fontSize: 20, cursor: "pointer", color: "var(--muted)" }}>×</button>
        </div>
        <label style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".06em", display: "block", marginBottom: 6 }}>Tên thư mục</label>
        <input
          id="folder-name-input"
          value={folderName}
          onChange={(e) => onNameChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSave()}
          placeholder="VD: Từ vựng N5"
          style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1.5px solid var(--border)", background: "var(--white)", fontFamily: "'Be Vietnam Pro','Noto Sans JP',sans-serif", fontSize: 14, outline: "none", marginBottom: 16, boxSizing: "border-box" }}
        />
        {error && <div style={{ fontSize: 11, color: "#e74c3c", marginBottom: 10 }}>{error}</div>}
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, padding: 11, borderRadius: 10, border: "1.5px solid var(--border2)", background: "transparent", fontFamily: "'Be Vietnam Pro','Noto Sans JP',sans-serif", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Hủy</button>
          <button onClick={onSave} style={{ flex: 2, padding: 11, borderRadius: 10, border: "none", background: "var(--accent)", color: "#fff", fontFamily: "'Be Vietnam Pro','Noto Sans JP',sans-serif", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>💾 Tạo thư mục</button>
        </div>
      </div>
    </div>
  );
}

/* ── Create Deck Modal ── */

/** Một thẻ ngữ pháp do user nhập tay. examples là raw text — mỗi cặp 2 dòng (Câu / → Nghĩa) hoặc "Câu → Nghĩa" 1 dòng. */
export interface GrammarCardInput {
  word: string;
  reading: string;
  meaning: string;
  conj: string;
  examples: string;
}

export const EMPTY_GRAMMAR_CARD: GrammarCardInput = { word: "", reading: "", meaning: "", conj: "", examples: "" };

interface CreateDeckModalProps {
  open: boolean;
  deckName: string;
  deckWords: string;
  error: string;
  preview: AnkiCard[];
  folders: AnkiFolder[];
  selectedFolderId: string;
  /** Loại thẻ — "vocab" giữ luồng cũ, "grammar" hiển thị form nhập tay */
  kind: "vocab" | "grammar";
  grammarCards: GrammarCardInput[];
  onKindChange: (k: "vocab" | "grammar") => void;
  onGrammarCardsChange: (cards: GrammarCardInput[]) => void;
  onDeckNameChange: (v: string) => void;
  onWordsChange: (v: string) => void;
  onFolderChange: (v: string) => void;
  onPreview: () => void;
  onSave: () => void;
  onClose: () => void;
}
export function CreateDeckModal({
  open, deckName, deckWords, error, preview, folders, selectedFolderId,
  kind, grammarCards, onKindChange, onGrammarCardsChange,
  onDeckNameChange, onWordsChange, onFolderChange, onPreview, onSave, onClose,
}: CreateDeckModalProps) {
  if (!open) return null;

  const kindBtn = (k: "vocab" | "grammar", label: string) => (
    <button
      key={k}
      type="button"
      onClick={() => onKindChange(k)}
      style={{
        flex: 1, padding: "8px 10px", borderRadius: 8,
        border: kind === k ? "1.5px solid var(--accent)" : "1.5px solid var(--border)",
        background: kind === k ? "var(--accent)" : "var(--white)",
        color: kind === k ? "#fff" : "var(--text)",
        fontFamily: "'Be Vietnam Pro','Noto Sans JP',sans-serif", fontWeight: 700, fontSize: 13, cursor: "pointer",
      }}
    >{label}</button>
  );

  function updateGrammar(idx: number, patch: Partial<GrammarCardInput>) {
    onGrammarCardsChange(grammarCards.map((c, i) => i === idx ? { ...c, ...patch } : c));
  }
  function addGrammar() { onGrammarCardsChange([...grammarCards, { ...EMPTY_GRAMMAR_CARD }]); }
  function removeGrammar(idx: number) { onGrammarCardsChange(grammarCards.filter((_, i) => i !== idx)); }

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "9px 12px", borderRadius: 8, border: "1.5px solid var(--border)",
    background: "var(--white)", fontFamily: "'Be Vietnam Pro','Noto Sans JP',sans-serif", fontSize: 13, outline: "none",
    boxSizing: "border-box",
  };
  const fieldLabel: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, color: "var(--muted)",
    textTransform: "uppercase", letterSpacing: ".06em", display: "block", marginBottom: 4,
  };

  return (
    <div className="modal-overlay active" id="create-deck-modal" style={{ alignItems: "flex-start", padding: "40px 0", overflowY: "auto" }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: "var(--white)", borderRadius: "var(--r2)", width: "92%", maxWidth: 600, margin: "auto", padding: 28, boxShadow: "var(--shadow2)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>Tạo bộ thẻ mới</div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", fontSize: 20, cursor: "pointer", color: "var(--muted)" }}>×</button>
        </div>

        {/* Loại thẻ */}
        <div style={{ marginBottom: 16 }}>
          <label style={fieldLabel}>Loại thẻ</label>
          <div style={{ display: "flex", gap: 8 }}>
            {kindBtn("vocab", "📖 Từ vựng")}
            {kindBtn("grammar", "📐 Ngữ pháp")}
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={fieldLabel}>Tên bộ thẻ</label>
          <input id="deck-name-input" value={deckName} onChange={(e) => onDeckNameChange(e.target.value)} placeholder={kind === "grammar" ? "VD: Ngữ pháp N3 - Bài 1" : "VD: Từ vựng N5 cơ bản"} style={inputStyle} />
        </div>
        {folders.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <label style={fieldLabel}>Thư mục (tuỳ chọn)</label>
            <select value={selectedFolderId} onChange={(e) => onFolderChange(e.target.value)} style={{ ...inputStyle, padding: "10px 14px" }}>
              <option value="">Không có thư mục</option>
              {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
        )}

        {/* VOCAB MODE — luồng cũ */}
        {kind === "vocab" && (
          <>
            <div style={{ marginBottom: 8 }}>
              <label style={fieldLabel}>Danh sách từ vựng</label>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>Nhập từng từ cách nhau bằng dấu cách hoặc xuống dòng. Từ có trong từ điển sẽ được tự động điền đầy đủ.</div>
              <textarea id="deck-words-input" rows={6} value={deckWords} onChange={(e) => onWordsChange(e.target.value)} placeholder={"学校 行く 食べる\n先生 電車\n..."} style={{ ...inputStyle, padding: "10px 14px", fontSize: 14, resize: "vertical", lineHeight: 1.7 }} />
            </div>
            {preview.length > 0 && (
              <div id="deck-preview" style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>Xem trước {preview.length} thẻ:</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {preview.slice(0, 20).map((c) => (
                    <span key={c.id} className="vocab-chip">{c.word}</span>
                  ))}
                  {preview.length > 20 && <span style={{ fontSize: 12, color: "var(--muted)" }}>+{preview.length - 20} từ nữa</span>}
                </div>
              </div>
            )}
          </>
        )}

        {/* GRAMMAR MODE — nhập tay từng thẻ */}
        {kind === "grammar" && (
          <div style={{ marginBottom: 14 }}>
            <label style={fieldLabel}>Danh sách thẻ ngữ pháp</label>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
              Nhập từng thẻ một. Trường tuỳ chọn: Furigana, Cách chia, Ví dụ.
              Mỗi ví dụ trên 1 dòng theo dạng <code style={{ background: "var(--surface)", padding: "1px 5px", borderRadius: 4 }}>Câu tiếng Nhật → Nghĩa tiếng Việt</code>.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, maxHeight: 360, overflowY: "auto", paddingRight: 4 }}>
              {grammarCards.map((c, idx) => (
                <div key={idx} style={{ border: "1.5px solid var(--border)", borderRadius: 10, padding: 12, background: "var(--surface)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>Thẻ #{idx + 1}</div>
                    {grammarCards.length > 1 && (
                      <button type="button" onClick={() => removeGrammar(idx)} style={{ background: "transparent", border: "none", color: "#c2410c", fontSize: 12, cursor: "pointer", fontWeight: 700 }}>✕ Xoá</button>
                    )}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                    <div>
                      <label style={fieldLabel}>Tên ngữ pháp *</label>
                      <input value={c.word} onChange={(e) => updateGrammar(idx, { word: e.target.value })} placeholder="〜なければならない" style={inputStyle} />
                    </div>
                    <div>
                      <label style={fieldLabel}>Furigana (tuỳ chọn)</label>
                      <input value={c.reading} onChange={(e) => updateGrammar(idx, { reading: e.target.value })} placeholder="〜なければならない" style={inputStyle} />
                    </div>
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <label style={fieldLabel}>Nghĩa *</label>
                    <input value={c.meaning} onChange={(e) => updateGrammar(idx, { meaning: e.target.value })} placeholder="Phải, không thể không..." style={inputStyle} />
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <label style={fieldLabel}>Cách chia (tuỳ chọn)</label>
                    <input value={c.conj} onChange={(e) => updateGrammar(idx, { conj: e.target.value })} placeholder="V-ない + ければならない" style={inputStyle} />
                  </div>
                  <div>
                    <label style={fieldLabel}>Ví dụ (tuỳ chọn — mỗi dòng 1 cặp Câu → Nghĩa)</label>
                    <textarea
                      rows={3}
                      value={c.examples}
                      onChange={(e) => updateGrammar(idx, { examples: e.target.value })}
                      placeholder={"明日学校に行かなければならない → Ngày mai phải đi học\n薬を飲まなければならない → Phải uống thuốc"}
                      style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <button type="button" onClick={addGrammar} style={{ marginTop: 10, padding: "8px 14px", borderRadius: 8, border: "1.5px dashed var(--accent)", background: "transparent", color: "var(--accent)", fontFamily: "'Be Vietnam Pro','Noto Sans JP',sans-serif", fontWeight: 700, fontSize: 12.5, cursor: "pointer", width: "100%" }}>+ Thêm thẻ</button>
          </div>
        )}

        {error && <div style={{ fontSize: 11, color: "#e74c3c", marginBottom: 10 }}>{error}</div>}
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, padding: 11, borderRadius: 10, border: "1.5px solid var(--border2)", background: "transparent", fontFamily: "'Be Vietnam Pro','Noto Sans JP',sans-serif", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Hủy</button>
          {kind === "vocab" && (
            <button onClick={onPreview} style={{ flex: 1, padding: 11, borderRadius: 10, border: "none", background: "var(--surface)", color: "var(--text)", fontFamily: "'Be Vietnam Pro','Noto Sans JP',sans-serif", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>🔍 Kiểm tra từ</button>
          )}
          <button onClick={onSave} id="save-deck-btn" style={{ flex: 2, padding: 11, borderRadius: 10, border: "none", background: "var(--accent)", color: "#fff", fontFamily: "'Be Vietnam Pro','Noto Sans JP',sans-serif", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>💾 Lưu bộ thẻ</button>
        </div>
      </div>
    </div>
  );
}

/* ── Deck Preview Modal ── */
interface DeckPreviewModalProps {
  open: boolean;
  deck: AnkiDeck | null;
  onClose: () => void;
}
export function DeckPreviewModal({ open, deck, onClose }: DeckPreviewModalProps) {
  if (!open || !deck) return null;
  return (
    <div className="modal-overlay active" id="deck-preview-modal" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: "var(--white)", borderRadius: "var(--r2)", width: "92%", maxWidth: 640, padding: 24, boxShadow: "var(--shadow2)" }}>
        <div className="deck-preview-head">
          <div>
            <div style={{ fontSize: 16, fontWeight: 800 }} id="deck-preview-title">{deck.name}</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }} id="deck-preview-sub">{deck.cards.length} thẻ</div>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", fontSize: 20, cursor: "pointer", color: "var(--muted)" }}>×</button>
        </div>
        <div className="deck-preview-list" id="deck-preview-list">
          {deck.cards.map((c) => (
            <div key={c.id} className="deck-preview-item" style={{ display: "flex", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
              <span style={{ fontWeight: 700, minWidth: 60 }}>{c.word}</span>
              {c.reading && <span style={{ color: "var(--muted)", fontSize: 13 }}>{c.reading}</span>}
              {c.meaning && <span style={{ fontSize: 13, flex: 1 }}>{c.meaning}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

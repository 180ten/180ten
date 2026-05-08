"use client";
import { useState, useEffect, useRef, useMemo } from "react";
import {
  useDictionary,
  useExamples,
  loadHistory, pushHistory, clearHistory,
  searchEntries,
  type DictEntry,
} from "@/hooks/useDictionary";
import { parseFurigana } from "@/lib/furigana";
import { useDictLang } from "@/components/modals/SettingsModal";

interface DictPopupProps {
  open: boolean;
  initialQuery?: string;
  onClose: () => void;
}

const LEVEL_COLORS: Record<string, string> = {
  N1: "#e8502a", N2: "#d4890a", N3: "#2a9e5f", N4: "#2b6cb0", N5: "#6c5ce7",
};


function splitExample(s: string): { jp: string; vi: string } {
  const parts = s.split(/\s*[→⇒]\s*/);
  if (parts.length >= 2) return { jp: parts[0].trim(), vi: parts.slice(1).join(" → ").trim() };
  return { jp: s.trim(), vi: "" };
}

/** Tách chuỗi nghĩa thành các dòng:
 *  - Phần trước " - " → dòng nghĩa ngắn
 *  - Phần sau " - "   → dòng nghĩa dài
 *  - Mỗi số ①②③...   → dòng riêng
 */
function parseMeaningLines(text: string): string[] {
  if (!text) return [];
  const dashIdx = text.indexOf(" - ");
  const short = dashIdx >= 0 ? text.slice(0, dashIdx).trim() : "";
  const rest  = dashIdx >= 0 ? text.slice(dashIdx + 3).trim() : text.trim();
  const lines: string[] = [];
  if (short) lines.push(short);
  if (!rest) return lines;
  // Tách theo ký tự số tròn ①-⑳
  const parts = rest.split(/([①-⑳])/);
  const prefix = parts[0].trim();
  if (prefix) lines.push(prefix);
  for (let i = 1; i + 1 < parts.length; i += 2) {
    const content = (parts[i + 1] || "").trim();
    lines.push(`${parts[i]}${content ? " " + content : ""}`);
  }
  return lines;
}

function MeaningDisplay({ text, className }: { text: string; className?: string }) {
  const lines = parseMeaningLines(text);
  if (lines.length === 0) return null;
  return (
    <div className={className}>
      {lines.map((line, i) => (
        <div key={i} style={{ lineHeight: 1.65, marginBottom: i < lines.length - 1 ? 2 : 0 }}>
          {line}
        </div>
      ))}
    </div>
  );
}

export default function DictPopup({ open, initialQuery, onClose }: DictPopupProps) {
  const { entries, loading }   = useDictionary(open);
  const dictLang                = useDictLang();
  const [query, setQuery]       = useState(initialQuery ?? "");
  const [debounced, setDeb]     = useState(initialQuery ?? "");
  const [history, setHistory]   = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // ─── Auto-focus + reset on open ───
  useEffect(() => {
    if (!open) return;
    setQuery(initialQuery ?? "");
    setDeb(initialQuery ?? "");
    setHistory(loadHistory());
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [open, initialQuery]);

  // ─── ESC closes ───
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // ─── Debounce query ───
  useEffect(() => {
    const t = setTimeout(() => setDeb(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  // ─── Compute results client-side ───
  const results = useMemo<DictEntry[]>(() => {
    if (!entries) return [];
    return searchEntries(entries, debounced, "", 20);
  }, [entries, debounced]);

  // ─── Lazy-load examples for the visible entries ───
  // Bulk dict load skips `examples` (heavy column) — fetch them on demand.
  const examplesMap = useExamples(results.map((r) => r.id));

  function selectFromHistory(w: string) {
    setQuery(w);
    setDeb(w);
    inputRef.current?.focus();
  }
  function onCardClick(entry: DictEntry) {
    // Save to history when user clicks/views a card
    setHistory(pushHistory(entry.word));
  }
  function onClearHistory() {
    clearHistory(); setHistory([]);
  }

  if (!open) return null;

  return (
    <div
      className="modal-overlay active"
      id="dict-popup"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ backdropFilter: "blur(4px)" }}
    >
      <div style={{
        background: "var(--white)", borderRadius: 18,
        width: "94%", maxWidth: 720, maxHeight: "88vh",
        display: "flex", flexDirection: "column",
        boxShadow: "0 20px 60px rgba(0,0,0,.18)",
      }}>
        {/* ── Sticky header ── */}
        <div style={{ padding: "18px 22px 12px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: "-0.5px" }}>📖 Từ điển tiếng Nhật</div>
              <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>
                Tìm theo Kanji, hiragana, Hán Việt hoặc nghĩa tiếng Việt.
              </div>
            </div>
            <button
              onClick={onClose}
              aria-label="Đóng"
              style={{ background: "transparent", border: "none", fontSize: 22, cursor: "pointer", color: "var(--muted)", lineHeight: 1, padding: 4 }}
            >×</button>
          </div>

          {/* Search input */}
          <div style={{ position: "relative" }}>
            <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", fontSize: 14, color: "var(--muted2)", pointerEvents: "none" }}>🔍</span>
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="VD: 学校  ·  がっこう  ·  trường học  ·  Học Hiệu"
              autoComplete="off"
              style={{
                width: "100%", padding: "11px 16px 11px 40px", borderRadius: 99,
                border: "1.5px solid var(--border)", background: "var(--surface)",
                fontFamily: "'Be Vietnam Pro','Noto Sans JP',sans-serif", fontSize: 13.5, color: "var(--text)",
                outline: "none", boxSizing: "border-box",
              }}
            />
          </div>

        </div>

        {/* ── Body ── */}
        <div style={{ flex: 1, overflowY: "auto", padding: "10px 22px 18px" }}>
          {loading && (
            <div style={{ textAlign: "center", color: "var(--muted)", padding: 36, fontSize: 13 }}>
              <span className="spinner" /> Đang tải từ điển...
            </div>
          )}

          {/* History when input empty */}
          {!loading && !debounced.trim() && history.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted2)", textTransform: "uppercase", letterSpacing: ".06em" }}>
                  Tra gần đây
                </div>
                <button
                  type="button" onClick={onClearHistory}
                  style={{ background: "none", border: "none", fontSize: 11, color: "var(--muted)", cursor: "pointer", padding: 0 }}
                >
                  Xoá
                </button>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {history.map((w) => (
                  <button
                    key={w} type="button"
                    onClick={() => selectFromHistory(w)}
                    style={{
                      padding: "5px 12px", borderRadius: 99,
                      border: "1px solid var(--border)", background: "var(--surface)",
                      fontFamily: "Be Vietnam Pro,Noto Sans JP,sans-serif", fontSize: 13, color: "var(--text)",
                      cursor: "pointer",
                    }}
                  >
                    🕒 {w}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Empty state — no query, no history */}
          {!loading && !debounced.trim() && history.length === 0 && (
            <div style={{ textAlign: "center", color: "var(--muted2)", padding: 36, fontSize: 13 }}>
              Bắt đầu gõ để tìm kiếm…
            </div>
          )}

          {/* No results */}
          {!loading && debounced.trim() && results.length === 0 && (
            <div style={{ textAlign: "center", color: "var(--muted2)", padding: 36 }}>
              <div style={{ fontSize: 38, opacity: .35, marginBottom: 8 }}>🔎</div>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--muted)" }}>Không tìm thấy “{debounced}”</div>
              <div style={{ fontSize: 11.5, marginTop: 6 }}>Thử Kanji hoặc cách đọc khác.</div>
            </div>
          )}

          {/* Results — matches legacy `.chip-popup` (.cp-*) markup from index.html */}
          {!loading && results.map((entry, i) => {
            const id = String(entry.id ?? `${entry.word}-${i}`);
            const lazyExamples = entry.id != null ? examplesMap.get(String(entry.id)) : undefined;
            const examples = ((entry.examples ?? lazyExamples ?? []) as string[]).filter(Boolean);
            const lvlColor = entry.jlpt_level ? LEVEL_COLORS[entry.jlpt_level] : null;
            const meaningText = dictLang === "jp-jp"
              ? (entry.meaning_jp || entry.meaning || "(意味なし)")
              : (entry.meaning || entry.meaning_jp || "(chưa có nghĩa)");

            return (
              <div
                key={id}
                onClick={() => onCardClick(entry)}
                style={{
                  position: "relative",
                  padding: "16px 16px 14px",
                  marginBottom: 12,
                  background: "var(--white)",
                  border: "1px solid var(--border)",
                  borderRadius: 14,
                  boxShadow: "0 8px 40px rgba(0,0,0,.06)",
                  cursor: "default",
                }}
              >
                {/* Từ loại — góc trên bên phải */}
                {entry.word_type && (
                  <span style={{
                    position: "absolute", top: 14, right: 14,
                    fontSize: 11, fontWeight: 600, color: "var(--muted)",
                    background: "var(--surface)", padding: "2px 9px",
                    borderRadius: 99, border: "1px solid var(--border)",
                  }}>{entry.word_type}</span>
                )}

                {/* Word — .cp-word style: 21px / 800 */}
                <div className="cp-word" style={{ fontSize: 21, fontWeight: 800, marginBottom: 2, paddingRight: entry.word_type ? 80 : 24 }}>
                  {entry.word}
                </div>

                {/* Reading — .cp-reading: 12px / blue / 600 */}
                {entry.reading && (
                  <div className="cp-reading" style={{ fontSize: 12, color: "var(--blue, #2b6cb0)", fontWeight: 600, marginBottom: 4 }}>
                    {entry.reading}
                  </div>
                )}

                {/* Badges row: Hán Việt + JLPT */}
                {(entry.han_viet || entry.jlpt_level) && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                    {entry.han_viet && (
                      <span style={{
                        display: "inline-flex", alignItems: "center", gap: 5,
                        fontSize: 11, fontWeight: 700,
                        color: "#d4890a", background: "#fef3cd",
                        padding: "2px 9px", borderRadius: 99,
                      }}>
                        <HanVietIcon />
                        {entry.han_viet}
                      </span>
                    )}
                    {lvlColor && (
                      <span style={{
                        fontSize: 11, fontWeight: 800,
                        color: lvlColor, background: lvlColor + "1f",
                        border: `1px solid ${lvlColor}55`,
                        padding: "2px 9px", borderRadius: 99,
                      }}>{entry.jlpt_level}</span>
                    )}
                  </div>
                )}

                {/* Meaning — .cp-meaning: 13px / 600 */}
                {(entry.meaning || entry.meaning_jp) && (
                  <div style={{ marginBottom: examples.length ? 10 : 0 }}>
                    <MeaningDisplay text={meaningText} className="cp-meaning" />
                  </div>
                )}

                {/* Examples — same divider style as chip-popup mLines */}
                {examples.length > 0 && (
                  <div style={{ marginTop: 6, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
                    {examples.slice(0, 3).map((ex, j) => {
                      const { jp, vi } = splitExample(String(ex));
                      const jpHtml = parseFurigana(jp);
                      return (
                        <div key={j} style={{ fontSize: 13, lineHeight: 2, marginBottom: 6, display: "flex", gap: 6, alignItems: "flex-start" }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted2)", minWidth: 16, paddingTop: 3, flexShrink: 0 }}>{j + 1}.</span>
                          <div>
                            <span
                              dangerouslySetInnerHTML={{ __html: jpHtml }}
                              style={{ fontFamily: "'Noto Sans JP', sans-serif" }}
                            />
                            {vi && (
                              <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
                                → {vi}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {examples.length > 3 && (
                      <div style={{ fontSize: 11, color: "var(--muted2)", marginTop: 2 }}>
                        +{examples.length - 3} ví dụ khác
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Inline translate / chat icon — replaces 🀄 emoji for the Hán Việt badge
function HanVietIcon() {
  return (
    <svg
      width="11" height="11" viewBox="0 0 512 512"
      fill="none" stroke="currentColor" strokeWidth={26}
      strokeLinecap="round" strokeLinejoin="round" strokeMiterlimit={10}
      aria-hidden
    >
      <path d="M278.672,198.998c-4.709-54.48-41.911-102.888-96.894-118.611c-71.049-20.313-144.889,21.607-164.931,93.64 c-10.472,37.643-4.177,76.05,14.359,107.046L10,336.778l55.736-17.18c49.647,37.411,119.404,35.889,167.602-6.627"/>
      <path d="M330.225,170.756c71.047-20.317,144.886,21.606,164.926,93.64c10.471,37.639,4.173,76.045-14.357,107.044L502,427.147 l-55.736-17.182c-12.709,9.582-27.318,17.027-43.47,21.646c-71.047,20.317-144.887-21.606-164.926-93.64 C217.828,265.939,259.178,191.073,330.225,170.756z"/>
      <line x1="311.265" y1="296.163" x2="311.265" y2="296.163"/>
      <line x1="366.449" y1="296.163" x2="366.449" y2="296.163"/>
      <line x1="421.633" y1="296.163" x2="421.633" y2="296.163"/>
      <line x1="105.388" y1="180.694" x2="185.714" y2="180.694"/>
      <path d="M165.633,180.694c0,35.978-23.022,67.918-57.153,79.296l-3.092,1.03"/>
      <path d="M125.469,180.694c0,35.978,23.022,67.918,57.153,79.296l3.092,1.03"/>
      <line x1="145.551" y1="160.612" x2="145.551" y2="180.694"/>
    </svg>
  );
}

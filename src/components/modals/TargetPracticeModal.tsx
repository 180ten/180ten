"use client";
import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { TYPE_MONDAI_MAP, REPORT_GROUPS } from "@/lib/constants";

// ── Types ─────────────────────────────────────────────────────────
export type TargetLevel = "N1" | "N2" | "N3" | "N4" | "N5" | "BJT";

export interface TargetConfig {
  level: TargetLevel;
  /** mondai type key from TYPE_MONDAI_MAP, e.g. "kanji" / "bunpo1" / "listen_kadai" */
  mondaiType: string;
  /** Number of questions to practice */
  count: number;
}

interface TargetPracticeModalProps {
  open: boolean;
  /** Total available questions per (level, mondaiType). Pass actual data when wired. */
  availableCounts?: Record<string, number>;
  onClose: () => void;
  onStart: (config: TargetConfig) => void;
}

// ── Constants ─────────────────────────────────────────────────────
const LEVELS: TargetLevel[] = ["N1", "N2", "N3", "N4", "N5", "BJT"];
const STORAGE_KEY = "jlptbro-target-practice-config";

const GROUP_THEME: Record<string, { label: string; bg: string; text: string; ring: string }> = {
  vocab:         { label: "言語知識（文字・語彙）", bg: "#EEEDFE", text: "#3C3489", ring: "#534AB7" },
  grammar:       { label: "文法",                   bg: "#FFF1E8", text: "#A04A1F", ring: "#D85A30" },
  reading:       { label: "読解",                   bg: "#E1F5EE", text: "#085041", ring: "#1D9E75" },
  listen:        { label: "聴解",                   bg: "#E6F1FB", text: "#0C447C", ring: "#185FA5" },
  bjt_listen:    { label: "BJT 第１部 聴解",        bg: "#E6F1FB", text: "#0C447C", ring: "#185FA5" },
  bjt_chodokkai: { label: "BJT 第２部 聴読解",      bg: "#FFF7E6", text: "#8C5E00", ring: "#C99500" },
  bjt_reading:   { label: "BJT 第３部 読解",        bg: "#E1F5EE", text: "#085041", ring: "#1D9E75" },
};

// Get list of mondai types for a given level
function mondaiTypesForLevel(level: TargetLevel): string[] {
  if (level === "BJT") {
    return Object.keys(TYPE_MONDAI_MAP).filter((t) => t.startsWith("bjt_"));
  }
  return Object.keys(TYPE_MONDAI_MAP).filter((t) => !t.startsWith("bjt_"));
}

// Group mondai types by their REPORT_GROUPS key
function groupMondais(types: string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  types.forEach((t) => {
    const g = TYPE_MONDAI_MAP[t]?.group;
    if (!g) return;
    if (!out[g]) out[g] = [];
    out[g].push(t);
  });
  Object.values(out).forEach((arr) => arr.sort((a, b) => (TYPE_MONDAI_MAP[a].mondai - TYPE_MONDAI_MAP[b].mondai)));
  return out;
}

function loadSavedConfig(): TargetConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Partial<TargetConfig>;
    if (!c.level || !c.mondaiType || typeof c.count !== "number") return null;
    return c as TargetConfig;
  } catch { return null; }
}

function saveConfig(c: TargetConfig) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(c)); } catch { /* ignore */ }
}

// ── Main component ───────────────────────────────────────────────
export default function TargetPracticeModal({ open, availableCounts, onClose, onStart }: TargetPracticeModalProps) {
  const [level, setLevel] = useState<TargetLevel>("N1");
  const [mondaiType, setMondaiType] = useState<string>("");
  const [count, setCount] = useState<number>(10);

  // Restore saved config when modal opens
  useEffect(() => {
    if (!open) return;
    const saved = loadSavedConfig();
    if (saved) {
      setLevel(saved.level);
      setMondaiType(saved.mondaiType);
      setCount(saved.count);
    } else {
      setLevel("N1");
      setMondaiType("");
      setCount(10);
    }
  }, [open]);

  // When level changes, ensure mondaiType is valid for the new level
  useEffect(() => {
    if (!open) return;
    const valid = mondaiTypesForLevel(level);
    if (mondaiType && !valid.includes(mondaiType)) setMondaiType("");
  }, [level, mondaiType, open]);

  const grouped = useMemo(() => groupMondais(mondaiTypesForLevel(level)), [level]);
  const maxAvailable = useMemo(() => {
    if (!mondaiType) return 0;
    const k = `${level}__${mondaiType}`;
    return availableCounts?.[k] ?? 30; // fallback estimate
  }, [level, mondaiType, availableCounts]);

  // Clamp count when max changes
  useEffect(() => {
    if (maxAvailable > 0 && count > maxAvailable) setCount(maxAvailable);
    if (maxAvailable > 0 && count < 1) setCount(1);
  }, [maxAvailable, count]);

  const estimatedMin = useMemo(() => {
    // ~1.5min/question for reading, ~1min for vocab, ~2min for listen — rough average 1.5min
    if (!mondaiType) return 0;
    const grp = TYPE_MONDAI_MAP[mondaiType]?.group;
    const perQ = grp === "listen" || grp === "bjt_listen" ? 2 : grp === "reading" || grp === "bjt_reading" ? 2 : 1;
    return Math.max(1, Math.round(count * perQ));
  }, [mondaiType, count]);

  const canStart = !!mondaiType && count >= 1 && count <= maxAvailable;

  function handleStart() {
    if (!canStart) return;
    const c: TargetConfig = { level, mondaiType, count };
    saveConfig(c);
    onStart(c);
  }

  if (!open) return null;

  return (
    <div
      className="modal-overlay active"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ padding: "20px 0" }}
    >
      <div style={{
        background: "#fff", borderRadius: 18,
        width: "94%", maxWidth: 720, maxHeight: "92vh",
        overflowY: "auto", padding: "1.5rem 1.75rem",
        position: "relative",
        boxShadow: "0 14px 50px rgba(0,0,0,.18)",
        animation: "tpm-pop .22s ease-out",
      }}>
        <style>{`@keyframes tpm-pop{from{transform:scale(.96);opacity:0;}to{transform:scale(1);opacity:1;}}`}</style>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
          <div style={{
            width: 42, height: 42, borderRadius: 12,
            background: "#fff3e8", display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Image src="/svg/target.svg" alt="" aria-hidden width={22} height={22} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#1a1917" }}>Target luyện thi</h2>
            <p style={{ margin: "2px 0 0 0", fontSize: 12.5, color: "#7a7870" }}>
              Chọn 1 Mondai để luyện chuyên sâu — câu hỏi được random từ tất cả đề trong Level
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "transparent", border: "none", fontSize: 22,
              color: "#7a7870", cursor: "pointer", lineHeight: 1, padding: 4,
            }}
            aria-label="Đóng"
          >×</button>
        </div>

        {/* STEP 1: LEVEL */}
        <div style={{ marginBottom: 22 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <span style={{
              width: 22, height: 22, borderRadius: "50%", background: "#e8502a",
              color: "#fff", fontSize: 12, fontWeight: 700,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
            }}>1</span>
            <span style={{ fontSize: 14, fontWeight: 600, color: "#1a1917" }}>Chọn Level</span>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {LEVELS.map((lv) => {
              const active = level === lv;
              return (
                <button
                  key={lv}
                  type="button"
                  onClick={() => setLevel(lv)}
                  style={{
                    minWidth: 64, padding: "9px 18px",
                    borderRadius: 99,
                    border: active ? "1.5px solid #e8502a" : "1.5px solid #e2e0d8",
                    background: active ? "#e8502a" : "#fff",
                    color: active ? "#fff" : "#1a1917",
                    fontFamily: "'Be Vietnam Pro','Noto Sans JP',sans-serif",
                    fontSize: 13.5, fontWeight: 600,
                    cursor: "pointer", transition: "all .15s",
                  }}
                >{lv}</button>
              );
            })}
          </div>
        </div>

        {/* STEP 2: MONDAI */}
        <div style={{ marginBottom: 22 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <span style={{
              width: 22, height: 22, borderRadius: "50%", background: "#e8502a",
              color: "#fff", fontSize: 12, fontWeight: 700,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
            }}>2</span>
            <span style={{ fontSize: 14, fontWeight: 600, color: "#1a1917" }}>Chọn Mondai</span>
            <span style={{ fontSize: 11, color: "#7a7870" }}>(chỉ 1)</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {Object.entries(grouped).map(([groupKey, types]) => {
              const theme = GROUP_THEME[groupKey] ?? { label: groupKey, bg: "#f5f4f1", text: "#1a1917", ring: "#7a7870" };
              return (
                <div key={groupKey}>
                  <div style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    background: theme.bg, color: theme.text,
                    fontSize: 12, fontWeight: 600,
                    padding: "4px 12px", borderRadius: 999,
                    marginBottom: 8,
                  }}>
                    <span>{theme.label}</span>
                    <span style={{ opacity: .65 }}>· {REPORT_GROUPS[groupKey]?.sub ?? ""}</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
                    {types.map((t) => {
                      const info = TYPE_MONDAI_MAP[t];
                      const active = mondaiType === t;
                      const k = `${level}__${t}`;
                      const avail = availableCounts?.[k];
                      return (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setMondaiType(t)}
                          style={{
                            textAlign: "left",
                            padding: "10px 14px",
                            borderRadius: 12,
                            border: active ? `2px solid ${theme.ring}` : "1.5px solid #ece9e0",
                            background: active ? theme.bg : "#fff",
                            cursor: "pointer", transition: "all .15s",
                            display: "flex", alignItems: "center", gap: 10,
                            fontFamily: "'Be Vietnam Pro','Noto Sans JP',sans-serif",
                          }}
                        >
                          <span style={{
                            width: 16, height: 16, borderRadius: "50%",
                            border: `2px solid ${active ? theme.ring : "#cbc8be"}`,
                            background: active ? theme.ring : "transparent",
                            flexShrink: 0,
                            display: "inline-flex", alignItems: "center", justifyContent: "center",
                          }}>
                            {active && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#fff" }} />}
                          </span>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: "#1a1917", lineHeight: 1.3 }}>{info.name}</div>
                            {avail != null && (
                              <div style={{ fontSize: 11, color: "#7a7870", marginTop: 2 }}>{avail} câu có sẵn</div>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* STEP 3: COUNT */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <span style={{
              width: 22, height: 22, borderRadius: "50%", background: "#e8502a",
              color: "#fff", fontSize: 12, fontWeight: 700,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
            }}>3</span>
            <span style={{ fontSize: 14, fontWeight: 600, color: "#1a1917" }}>Số câu hỏi</span>
            {mondaiType && maxAvailable > 0 && (
              <span style={{ fontSize: 11, color: "#7a7870" }}>(tối đa: {maxAvailable} câu)</span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <input
              type="range"
              min={1}
              max={Math.max(1, maxAvailable)}
              step={1}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              disabled={!mondaiType}
              style={{ flex: 1, accentColor: "#e8502a" }}
            />
            <input
              type="number"
              min={1}
              max={Math.max(1, maxAvailable)}
              value={count}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n)) setCount(Math.max(1, Math.min(maxAvailable || n, n)));
              }}
              disabled={!mondaiType}
              style={{
                width: 76, height: 38, padding: "0 10px",
                borderRadius: 8, border: "1.5px solid #e2e0d8",
                fontFamily: "'Be Vietnam Pro','Noto Sans JP',sans-serif",
                fontSize: 14, fontWeight: 600, textAlign: "center",
                outline: "none",
              }}
            />
          </div>
          {mondaiType && (
            <div style={{ marginTop: 10, fontSize: 12, color: "#7a7870" }}>
              ⏱ Thời gian ước tính: <b style={{ color: "#1a1917" }}>{estimatedMin} phút</b>
            </div>
          )}
        </div>

        {/* CTA */}
        <button
          type="button"
          onClick={handleStart}
          disabled={!canStart}
          style={{
            width: "100%", height: 50, borderRadius: 12,
            background: canStart ? "#e8502a" : "#e8e5de",
            color: canStart ? "#fff" : "#9a9890",
            border: "none",
            fontFamily: "'Be Vietnam Pro','Noto Sans JP',sans-serif",
            fontSize: 15, fontWeight: 700,
            cursor: canStart ? "pointer" : "not-allowed",
            transition: "all .15s",
            display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
          }}
        >
          <Image src="/svg/exam-start.svg" alt="" aria-hidden width={18} height={18} />
          Bắt đầu luyện
        </button>

        {!mondaiType && (
          <p style={{ marginTop: 10, fontSize: 12, color: "#7a7870", textAlign: "center" }}>
            Chọn 1 Mondai ở trên để bắt đầu
          </p>
        )}
      </div>
    </div>
  );
}

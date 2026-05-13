"use client";
// ── ComposeTab.tsx ──────────────────────────────────────────────
// Faithful TypeScript/React port of the JLPTAdmin Babel component
// from ad.html. Provides a full exam composer matching ad.html's UI.
// ───────────────────────────────────────────────────────────────
import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { sb } from "@/lib/supabase";
import { adminUpsertExam, adminUpsertQuestions, AdminApiError } from "@/lib/adminApi";
import { randomUUID } from "@/lib/uuid";
import {
  C, iBase, taBase,
  getComposeTypeGroups, getFixedHeaderText, isN1OrN2Level, isN4OrN5Level, isN3Level,
  TYPE_MAP, GROUP_MAP, ALL_TYPES,
  mkDefault, mkSQ, mkLQ, mkLQS, mkLTQ, normalizeBjtSogoChokaiQuestion,
  BJT_FORM_FIXED_JP,
  type TypeDef, type TypeGroup, type QData, type ComposeQuestion,
} from "@/app/ad/compose/composeConstants";

type XlsxModule = typeof import("xlsx");
let xlsxPromise: Promise<XlsxModule> | null = null;

async function loadXLSX() {
  if (!xlsxPromise) xlsxPromise = import("xlsx");
  return xlsxPromise;
}

function normHeaderKey(k: unknown) {
  return String(k || "").trim().toLowerCase().replace(/\s+/g, "_");
}
function setByPath(target: Record<string, unknown>, path: string, value: string) {
  if (!path) return;
  const parts = String(path).split(".");
  let cur: unknown = target;
  for (let i = 0; i < parts.length; i++) {
    const raw = parts[i];
    const isIdx = /^\d+$/.test(raw);
    const key = isIdx ? Number(raw) : raw;
    const last = i === parts.length - 1;
    if (last) {
      (cur as Record<string, unknown>)[String(key)] = value;
      return;
    }
    const nextRaw = parts[i + 1];
    const nextIsIdx = /^\d+$/.test(nextRaw);
    const dict = cur as Record<string, unknown>;
    if (dict[String(key)] == null) dict[String(key)] = nextIsIdx ? [] : {};
    cur = dict[String(key)] as unknown;
  }
}
function readCell(row: Record<string, string>, ...keys: string[]) {
  for (const k of keys) if (row[k] != null && String(row[k]).trim() !== "") return String(row[k]).trim();
  return "";
}
function pushQIfAny(list: QData[], q: QData) {
  const wrongs = (q.wrongs as string[] | undefined) || [];
  const has = !!(q.question || q.correct || wrongs.some(Boolean) || q.orderNum || q.explanation || q.vocab || q.grammar);
  if (has) list.push(q);
}
function applyCommonQA(q: QData, row: Record<string, string>, wrongCount = 3, prefix = "") {
  const p = prefix ? `${prefix}_` : "";
  q.question = readCell(row, p + "question", p + "q");
  q.correct = readCell(row, p + "correct", p + "answer");
  q.explanation = readCell(row, p + "explanation");
  q.vocab = readCell(row, p + "vocab");
  q.grammar = readCell(row, p + "grammar");
  q.wrongs = Array.from({ length: wrongCount }, (_, i) => readCell(row, p + "wrong" + (i + 1)));
  return q;
}

function buildQuestionFromExcelRow(typeId: string, row: Record<string, string>, level: string, idx: number): ComposeQuestion {
  const q = { ...(mkDefault(typeId) as QData), type: typeId, level, id: randomUUID() } as ComposeQuestion;
  Object.keys(row).forEach(k => { if (k.includes(".") && row[k] !== "") setByPath(q as unknown as Record<string, unknown>, k, row[k]); });

  if (["kanji","bunmyaku","iikae","hyouki","yoho","bunpo1","bunpo2"].includes(typeId)) return { ...q, ...applyCommonQA({ ...q }, row, 3, "") };
  if (typeId === "bunsho") {
    q.x = readCell(row, "x"); q.y = readCell(row, "y"); q.passage = readCell(row, "passage", "text");
    const list: QData[] = [];
    for (let i = 1; i <= 50; i++) { const qi = mkSQ(); applyCommonQA(qi, row, 3, "q" + i); pushQIfAny(list, qi); }
    if (!list.length) { const one = mkSQ(); applyCommonQA(one, row, 3, ""); pushQIfAny(list, one); }
    q.questions = list.length ? list : [mkSQ()]; return q;
  }
  if (["tan","chu","cho","shudai","joho"].includes(typeId)) {
    q.x = readCell(row, "x"); q.y = readCell(row, "y");
    const passages: Array<{ text: string; questions: QData[] }> = [];
    for (let p = 1; p <= 10; p++) {
      const text = readCell(row, `p${p}_text`, `passage${p}`, `passage_${p}`);
      const qs: QData[] = [];
      for (let i = 1; i <= 30; i++) { const qi = mkSQ(); applyCommonQA(qi, row, 3, `p${p}_q${i}`); pushQIfAny(qs, qi); }
      if (text || qs.length) passages.push({ text, questions: qs.length ? qs : [mkSQ()] });
    }
    if (!passages.length) {
      const one = { text: readCell(row, "passage", "text"), questions: [] as QData[] };
      for (let i = 1; i <= 30; i++) { const qi = mkSQ(); applyCommonQA(qi, row, 3, `q${i}`); pushQIfAny(one.questions, qi); }
      if (!one.questions.length) { const qi = mkSQ(); applyCommonQA(qi, row, 3, ""); pushQIfAny(one.questions, qi); }
      passages.push({ text: one.text, questions: one.questions.length ? one.questions : [mkSQ()] });
    }
    q.passages = passages; return q;
  }
  if (typeId === "togo") {
    q.passages = [readCell(row, "passage_a", "passagea", "p1_text"), readCell(row, "passage_b", "passageb", "p2_text")];
    const qs: QData[] = [];
    for (let i = 1; i <= 30; i++) { const qi = mkSQ(); applyCommonQA(qi, row, 3, `q${i}`); pushQIfAny(qs, qi); }
    if (!qs.length) { const one = mkSQ(); applyCommonQA(one, row, 3, ""); pushQIfAny(qs, one); }
    q.questions = qs.length ? qs : [mkSQ()]; return q;
  }
  if (typeId.startsWith("bjt_")) {
    if (typeId === "bjt_3_3") { q.question = readCell(row, "question", "q"); q.passage = readCell(row, "passage", "text"); }
    else if (typeId === "bjt_3_1" || typeId === "bjt_3_2") q.sentence = readCell(row, "sentence", "question", "q");
    else if (typeId === "bjt_2_2" || typeId === "bjt_2_3") { q.question = readCell(row, "question", "q"); q.imageUrl = readCell(row, "image", "imageurl", "img", "image_url"); }
    else q.imageUrl = readCell(row, "image", "imageurl", "img", "image_url");
    q.correct = readCell(row, "correct", "answer");
    q.wrongs = [readCell(row, "wrong1"), readCell(row, "wrong2"), readCell(row, "wrong3")];
    q.explanation = readCell(row, "explanation"); q.vocab = readCell(row, "vocab"); q.grammar = readCell(row, "grammar");
    if (typeId === "bjt_1_3" || typeId === "bjt_2_3") normalizeBjtSogoChokaiQuestion(q);
    return q;
  }
  return q;
}

function getComposeTemplate(typeId: string, level: string) {
  const simple = {
    headers: ["question","correct","wrong1","wrong2","wrong3","explanation","vocab","grammar"],
    sample: ["（試験）の勉強をする。","しけん","じけん","しげん","しけい","Giải thích mẫu","",""],
  };
  if (["kanji","bunmyaku","iikae","hyouki","yoho","bunpo1","bunpo2"].includes(typeId)) return simple;
  if (typeId === "bunsho") return { headers: ["x","y","passage","q1_question","q1_correct","q1_wrong1","q1_wrong2","q1_wrong3","q1_explanation"], sample: ["46","50","Nội dung đoạn văn...","Câu hỏi nhỏ 1","Đáp án đúng","Sai 1","Sai 2","Sai 3","Giải thích"] };
  if (["tan","chu","cho","shudai","joho"].includes(typeId)) return { headers: ["x","y","p1_text","p1_q1_question","p1_q1_correct","p1_q1_wrong1","p1_q1_wrong2","p1_q1_wrong3","p1_q1_explanation"], sample: ["1","3","Nội dung đoạn văn 1...","Câu hỏi đoạn 1","Đáp án đúng","Sai 1","Sai 2","Sai 3","Giải thích"] };
  if (typeId === "togo") return { headers: ["passage_a","passage_b","q1_question","q1_correct","q1_wrong1","q1_wrong2","q1_wrong3","q1_explanation"], sample: ["Nội dung A...","Nội dung B...","Câu hỏi chung","Đáp án đúng","Sai 1","Sai 2","Sai 3","Giải thích"] };
  if (typeId.startsWith("bjt_")) return { headers: ["question","imageurl","correct","wrong1","wrong2","wrong3","explanation"], sample: ["質問","https://...","正解","さ1","さ2","さ3",""] };
  if (typeId === "listen_sokuji") return { headers: ["q1_orderNum","q1_correct","q1_wrong1","q1_wrong2","q1_explanation","q1_vocab","q1_grammar"], sample: ["1","Đáp án đúng","Sai 1","Sai 2","Giải thích","",""] };
  if (typeId === "listen_togo") return isN1OrN2Level(level)
    ? { headers: ["type1_mainQuestion","type1_orderNum","type1_correct","type1_wrong1","type1_wrong2","type1_wrong3","type1_explanation","type2_mainQuestion","type2_q1_orderNum","type2_q1_correct","type2_q1_wrong1","type2_q1_wrong2","type2_q1_wrong3","type2_q1_explanation"], sample: ["Câu hỏi lớn type1","1","Đáp án đúng type1","Sai 1","Sai 2","Sai 3","Giải thích type1","Câu hỏi lớn type2","2","Đáp án đúng type2-q1","Sai 1","Sai 2","Sai 3","Giải thích type2-q1"] }
    : { headers: ["type1_orderNum","type1_correct","type1_wrong1","type1_wrong2","type1_wrong3","type1_explanation","type2_mainQuestion","type2_q1_orderNum","type2_q1_correct","type2_q1_wrong1","type2_q1_wrong2","type2_q1_wrong3","type2_q1_explanation"], sample: ["1","Đáp án đúng type1","Sai 1","Sai 2","Sai 3","Giải thích type1","Câu hỏi lớn type2","2","Đáp án đúng type2-q1","Sai 1","Sai 2","Sai 3","Giải thích type2-q1"] };
  return simple;
}

// ─── SHARED UI PRIMITIVES ────────────────────────────────────────
// Insert 【】 at the current caret position of an Inp/Ta element and place the
// caret between the two brackets. Uses the native value setter so React's
// controlled <input>/<textarea> still picks up the change via its own onChange.
function insertBrackets(el: HTMLInputElement | HTMLTextAreaElement | null) {
  if (!el) return;
  const start = el.selectionStart ?? el.value.length;
  const end   = el.selectionEnd   ?? el.value.length;
  const newVal = el.value.slice(0, start) + "【】" + el.value.slice(end);
  const proto = el instanceof HTMLTextAreaElement
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  setter?.call(el, newVal);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  requestAnimationFrame(() => {
    el.focus();
    el.selectionStart = start + 1;
    el.selectionEnd   = start + 1;
  });
}
function BracketBtn({ targetRef, style }: {
  targetRef: React.RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
  style?: React.CSSProperties;
}) {
  return (
    <button
      type="button"
      className="insert-bracket-btn"
      title="Chèn 【】 (đánh dấu từ vựng cho review)"
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => insertBrackets(targetRef.current)}
      style={style}
    >
      【】
    </button>
  );
}
function Inp({ value, onChange, placeholder, style, noBracketBtn }: {
  value: string; onChange: (v: string) => void; placeholder?: string; style?: React.CSSProperties; noBracketBtn?: boolean;
}) {
  const [f, setF] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const input = (
    <input ref={ref} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      style={{ ...iBase, borderColor: f ? C.accent : C.border2, ...(noBracketBtn ? {} : { flex: 1, minWidth: 0 }), ...style }}
      onFocus={() => setF(true)} onBlur={() => setF(false)} />
  );
  if (noBracketBtn) return input;
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "stretch" }}>
      {input}
      <BracketBtn targetRef={ref} />
    </div>
  );
}
function Ta({ value, onChange, placeholder, rows = 3, noBracketBtn }: {
  value: string; onChange: (v: string) => void; placeholder?: string; rows?: number; noBracketBtn?: boolean;
}) {
  const [f, setF] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const ta = (
    <textarea ref={ref} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      rows={rows} style={{ ...taBase, borderColor: f ? C.accent : C.border2, ...(noBracketBtn ? {} : { flex: 1, minWidth: 0 }) }}
      onFocus={() => setF(true)} onBlur={() => setF(false)} />
  );
  if (noBracketBtn) return ta;
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "flex-start" }}>
      {ta}
      <BracketBtn targetRef={ref} />
    </div>
  );
}
function RichTa({ value, onChange, placeholder, rows = 5 }: {
  value: string; onChange: (v: string) => void; placeholder?: string; rows?: number;
}) {
  const [f, setF] = useState(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const selectionRef = useRef({ start: 0, end: 0 });
  const rememberSelection = () => {
    const el = taRef.current;
    if (!el) return;
    selectionRef.current = { start: el.selectionStart, end: el.selectionEnd };
  };
  const applyEdit = (next: string, start: number, end: number) => {
    onChange(next);
    selectionRef.current = { start, end };
    requestAnimationFrame(() => {
      const el = taRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(start, end);
    });
    setTimeout(() => {
      const el = taRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(start, end);
    }, 0);
  };
  const insert = (b: string, a = "") => {
    const el = taRef.current;
    if (!el) return;
    const source = document.activeElement === el
      ? { start: el.selectionStart, end: el.selectionEnd }
      : selectionRef.current;
    const s = Math.max(0, Math.min(value.length, source.start));
    const e = Math.max(s, Math.min(value.length, source.end));
    const selected = value.slice(s, e);
    const next = value.slice(0, s) + b + selected + a + value.slice(e);
    const caretStart = selected ? s + b.length : s + b.length;
    const caretEnd = selected ? e + b.length : s + b.length;
    applyEdit(next, caretStart, caretEnd);
  };
  const setSize = (raw: string) => {
    const n = Math.max(10, Math.min(36, Number(raw) || 14));
    insert(`[size=${n}]`, "[/size]");
  };
  const alignLines = (align: "left" | "center" | "right") => {
    const el = taRef.current;
    if (!el) return;
    const source = document.activeElement === el
      ? { start: el.selectionStart, end: el.selectionEnd }
      : selectionRef.current;
    const s = Math.max(0, Math.min(value.length, source.start));
    const e = Math.max(s, Math.min(value.length, source.end));
    const start = value.lastIndexOf("\n", Math.max(0, s - 1)) + 1;
    const endAt = value.indexOf("\n", e);
    const end = endAt === -1 ? value.length : endAt;
    const block = value.slice(start, end);
    const lines = block.split("\n");
    const wrapped = lines.map((line) => {
      const clean = line.replace(/^\[(left|center|right)\]([\s\S]*)\[\/\1\]$/, "$2");
      return `[${align}]${clean}[/${align}]`;
    }).join("\n");
    applyEdit(value.slice(0, start) + wrapped + value.slice(end), start, start + wrapped.length);
  };
  const toolBtn = (label: string, title: string, onPress: () => void) => (
    <button
      key={`${title}-${label}`}
      title={title}
      type="button"
      onPointerDown={(e) => { e.preventDefault(); rememberSelection(); onPress(); }}
      style={{ padding: "2px 7px", borderRadius: 4, border: `1px solid ${C.border2}`, background: "transparent", color: C.muted, fontSize: 11, cursor: "pointer", fontWeight: 700 }}
    >
      {label}
    </button>
  );
  return (
    <div style={{ border: `1.5px solid ${f ? C.accent : C.border2}`, borderRadius: 8, overflow: "hidden" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, padding: "5px 8px", background: C.surface, borderBottom: `1px solid ${C.border}` }}>
        {([
          ["B","In đậm",["**","**"]],
          ["I","Nghiêng",["*","*"]],
          ["U̲","Gạch chân",["__","__"]],
          ["⇥","Thụt đầu",["　　",""]],
          ["縦","Viết dọc từ trên xuống dưới",["[縦]","[/縦]"]],
          ["【】","Đánh dấu từ vựng (review)",["【","】"]],
        ] as [string,string,[string,string]][]).map(([l,t,w]) => toolBtn(l, t, () => insert(w[0], w[1])))}
        {([
          ["左", "Căn trái", "left"],
          ["中", "Căn giữa", "center"],
          ["右", "Căn phải", "right"],
        ] as [string, string, "left" | "center" | "right"][]).map(([l, t, a]) => toolBtn(l, t, () => alignLines(a)))}
        <label title="Size chữ" style={{ display: "inline-flex", alignItems: "center", gap: 4, marginLeft: 2, color: C.muted, fontSize: 11, fontWeight: 700 }}>
          Size
          <input type="number" min={10} max={36} defaultValue={14}
            onMouseDown={e => e.stopPropagation()}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); setSize((e.currentTarget as HTMLInputElement).value); } }}
            style={{ width: 46, padding: "2px 5px", borderRadius: 4, border: `1px solid ${C.border2}`, background: C.panel, color: C.text, fontSize: 11, outline: "none" }} />
          <button type="button" onPointerDown={e => {
            e.preventDefault();
            rememberSelection();
            const input = (e.currentTarget.previousElementSibling as HTMLInputElement | null);
            setSize(input?.value || "14");
          }} style={{ padding: "2px 7px", borderRadius: 4, border: `1px solid ${C.border2}`, background: "transparent", color: C.muted, fontSize: 11, cursor: "pointer", fontWeight: 700 }}>A</button>
        </label>
      </div>
      <textarea ref={taRef} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        rows={rows}
        onFocus={() => { setF(true); rememberSelection(); }}
        onBlur={() => { rememberSelection(); setF(false); }}
        onSelect={rememberSelection}
        onClick={rememberSelection}
        onKeyUp={rememberSelection}
        style={{ ...taBase, border: "none", borderRadius: 0, background: C.panel }} />
    </div>
  );
}
function Fl({ label, hint, children, mb = 16 }: {
  label: string; hint?: string; children: React.ReactNode; mb?: number;
}) {
  return (
    <div style={{ marginBottom: mb }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 7, marginBottom: 5 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: "0.06em", textTransform: "uppercase" }}>{label}</span>
        {hint && <span style={{ fontSize: 10, color: C.muted2 }}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}
function VocabTagHint() {
  return (
    <div style={{ marginBottom: 12, padding: "8px 12px", background: "#fff7f1", border: "1px solid #fde0d3", borderLeft: "3px solid #f26419", borderRadius: 8, fontSize: 11, lineHeight: 1.65, color: "#1a1917" }}>
      <div style={{ fontWeight: 700, color: "#f26419", marginBottom: 2 }}>💡 Dùng 【từ】 để đánh dấu từ vựng quan trọng</div>
      <div>Ví dụ: 【私】は【会社員】です</div>
      <div>Có furigana: 【{`{(合格)(ごうかく)}`}】</div>
    </div>
  );
}
function FixedHeader({ text }: { text: string }) {
  return (
    <div style={{ marginBottom: 20, padding: "11px 14px", background: C.surface, border: `1px solid ${C.border2}`, borderRadius: 8, borderLeft: `3px solid ${C.muted}` }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 5 }}>Câu hỏi tổng (cố định)</div>
      <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.7 }}>{text}</div>
    </div>
  );
}
function WrongAnswers({ values, onChange, count = 3 }: {
  values: string[]; onChange: (v: string[]) => void; count?: number;
}) {
  return (
    <Fl label="Đáp án sai" hint={`${count} lựa chọn`}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
          <span style={{ fontSize: 11, color: C.red, fontWeight: 700, width: 14 }}>{i+1}</span>
          <Inp value={values[i] || ""} onChange={v => { const a = [...values]; a[i] = v; onChange(a); }} placeholder={`Sai ${i+1}`} />
        </div>
      ))}
    </Fl>
  );
}

// ─── VOCAB / GRAMMAR INPUTS ───────────────────────────────────────
function VocabInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const parse = (v: string) => { try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; } };
  const [input, setInput] = useState("");
  const [sugg, setSugg]   = useState<{word:string;reading:string;meaning:string}[]>([]);
  const [hiIdx, setHiIdx] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);
  const items: {word:string;reading:string;meaning:string}[] = parse(value);
  const emit = (newItems: typeof items) => onChange(newItems.length ? JSON.stringify(newItems) : "");

  const handleInput = (v: string) => {
    setInput(v); setHiIdx(-1);
    if (!v.trim()) { setSugg([]); return; }
    const lv = v.toLowerCase();
    const cache = (window as unknown as Record<string, unknown>).ADMIN_VOCAB_CACHE as {word:string;reading:string;meaning:string}[] | undefined;
    setSugg((cache || []).filter(x => x.word.includes(v) || (x.reading||"").includes(v) || (x.meaning||"").toLowerCase().includes(lv)).slice(0, 8));
  };
  const addWord = (w: {word:string;reading:string;meaning:string}) => {
    if (items.find(x => x.word === w.word)) { setInput(""); setSugg([]); setHiIdx(-1); return; }
    emit([...items, { word: w.word, reading: w.reading||"", meaning: w.meaning||"" }]);
    setInput(""); setSugg([]); setHiIdx(-1);
  };
  const removeItem = (idx: number) => emit(items.filter((_,i) => i !== idx));

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!sugg.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHiIdx(i => { const n = Math.min(i + 1, sugg.length - 1); scrollToIdx(n); return n; });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHiIdx(i => { const n = Math.max(i - 1, 0); scrollToIdx(n); return n; });
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (hiIdx >= 0 && hiIdx < sugg.length) addWord(sugg[hiIdx]);
    } else if (e.key === "Escape") {
      setSugg([]); setHiIdx(-1);
    }
  };
  const scrollToIdx = (n: number) => {
    requestAnimationFrame(() => {
      const el = listRef.current?.querySelector(`[data-idx="${n}"]`) as HTMLElement | null;
      el?.scrollIntoView({ block: "nearest" });
    });
  };

  return (
    <div>
      {items.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 8 }}>
          {items.map((it, i) => (
            <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 10px", borderRadius: 99, background: "#1e1e2e", border: "1px solid #6C6FF7", fontSize: 12, color: "#a5a8ff" }}>
              <span style={{ fontWeight: 700 }}>{it.word}</span>
              <span style={{ fontSize: 10, color: "#6C6FF7", marginLeft: 2 }}>{it.reading}</span>
              <span onClick={() => removeItem(i)} style={{ cursor: "pointer", color: C.muted2, marginLeft: 4, fontWeight: 700, fontSize: 14, lineHeight: "1" }}>×</span>
            </span>
          ))}
        </div>
      )}
      <div style={{ position: "relative" }}>
        <input value={input} onChange={e => handleInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => setTimeout(() => { setSugg([]); setHiIdx(-1); }, 150)}
          placeholder={items.length ? "Thêm từ khác..." : "Gõ từ hoặc nghĩa để tìm..."}
          style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1.5px solid #2a2a2a", background: "#0f0f0f", color: "#e8e8e8", fontFamily: "inherit", fontSize: 12, outline: "none" }} />
        {sugg.length > 0 && (
          <div ref={listRef} style={{ position: "absolute", bottom: "calc(100% + 4px)", left: 0, right: 0, background: "#141414", border: "1px solid #2a2a2a", borderRadius: 8, zIndex: 99, maxHeight: 220, overflowY: "auto", boxShadow: "0 -8px 24px rgba(0,0,0,.5)" }}>
            {sugg.map((s, i) => (
              <div key={i} data-idx={i}
                onMouseDown={(e) => { e.preventDefault(); addWord(s); }}
                onMouseEnter={() => setHiIdx(i)}
                style={{ padding: "8px 12px", cursor: "pointer", borderBottom: "1px solid #1a1a1a", fontSize: 12, display: "flex", gap: 8, alignItems: "center", background: i === hiIdx ? "#1e1e3a" : "transparent", transition: "background 0.1s" }}>
                <span style={{ fontWeight: 700, color: i === hiIdx ? "#a5a8ff" : "#e8e8e8", minWidth: 40 }}>{s.word}</span>
                <span style={{ color: "#6C6FF7", fontSize: 11 }}>{s.reading}</span>
                <span style={{ color: "#555", fontSize: 11, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.meaning}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
function GrammarInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const parse = (v: string) => { try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return v && v.trim() ? [{name:v,furigana:"",meaning:""}] : []; } };
  const [input, setInput] = useState("");
  const [sugg, setSugg]   = useState<{name:string;furigana:string;meaning:string}[]>([]);
  const [hiIdx, setHiIdx] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);
  const items: {name:string;furigana:string;meaning:string}[] = parse(value);
  const emit = (newItems: typeof items) => onChange(newItems.length ? JSON.stringify(newItems) : "");

  const handleInput = (v: string) => {
    setInput(v); setHiIdx(-1);
    if (!v.trim()) { setSugg([]); return; }
    const lv = v.toLowerCase();
    const cache = (window as unknown as Record<string, unknown>).ADMIN_GRAMMAR_CACHE as {name:string;furigana:string;meaning:string}[] | undefined;
    setSugg((cache || []).filter(x => (x.name||"").includes(v) || (x.furigana||"").includes(v) || (x.meaning||"").toLowerCase().includes(lv)).slice(0, 8));
  };
  const addItem = (g: {name:string;furigana:string;meaning:string}) => {
    if (items.find(x => x.name === g.name)) { setInput(""); setSugg([]); setHiIdx(-1); return; }
    emit([...items, { name: g.name, furigana: g.furigana||"", meaning: g.meaning||"" }]);
    setInput(""); setSugg([]); setHiIdx(-1);
  };
  const removeItem = (idx: number) => emit(items.filter((_,i) => i !== idx));

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!sugg.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHiIdx(i => { const n = Math.min(i + 1, sugg.length - 1); scrollToIdx(n); return n; });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHiIdx(i => { const n = Math.max(i - 1, 0); scrollToIdx(n); return n; });
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (hiIdx >= 0 && hiIdx < sugg.length) addItem(sugg[hiIdx]);
    } else if (e.key === "Escape") {
      setSugg([]); setHiIdx(-1);
    }
  };
  const scrollToIdx = (n: number) => {
    requestAnimationFrame(() => {
      const el = listRef.current?.querySelector(`[data-idx="${n}"]`) as HTMLElement | null;
      el?.scrollIntoView({ block: "nearest" });
    });
  };

  return (
    <div>
      {items.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 8 }}>
          {items.map((it, i) => (
            <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 10px", borderRadius: 99, background: "#1e2018", border: "1px solid #e8502a", fontSize: 12, color: "#ffb38a" }}>
              <span style={{ fontWeight: 700 }}>{it.name}</span>
              {it.furigana && <span style={{ fontSize: 10, color: "#e8502a", marginLeft: 2 }}>{it.furigana}</span>}
              <span onClick={() => removeItem(i)} style={{ cursor: "pointer", color: C.muted2, marginLeft: 4, fontWeight: 700, fontSize: 14, lineHeight: "1" }}>×</span>
            </span>
          ))}
        </div>
      )}
      <div style={{ position: "relative" }}>
        <input value={input} onChange={e => handleInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => setTimeout(() => { setSugg([]); setHiIdx(-1); }, 150)}
          placeholder={items.length ? "Thêm ngữ pháp khác..." : "Gõ tên ngữ pháp hoặc nghĩa để tìm..."}
          style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1.5px solid #2a2a2a", background: "#0f0f0f", color: "#e8e8e8", fontFamily: "inherit", fontSize: 12, outline: "none" }} />
        {sugg.length > 0 && (
          <div ref={listRef} style={{ position: "absolute", bottom: "calc(100% + 4px)", left: 0, right: 0, background: "#141414", border: "1px solid #2a2a2a", borderRadius: 8, zIndex: 99, maxHeight: 220, overflowY: "auto", boxShadow: "0 -8px 24px rgba(0,0,0,.5)" }}>
            {sugg.map((s, i) => (
              <div key={i} data-idx={i}
                onMouseDown={(e) => { e.preventDefault(); addItem(s); }}
                onMouseEnter={() => setHiIdx(i)}
                style={{ padding: "8px 12px", cursor: "pointer", borderBottom: "1px solid #1a1a1a", fontSize: 12, display: "flex", gap: 8, alignItems: "center", background: i === hiIdx ? "#221a10" : "transparent", transition: "background 0.1s" }}>
                <span style={{ fontWeight: 700, color: i === hiIdx ? "#ffb38a" : "#e8e8e8", minWidth: 60 }}>{s.name}</span>
                {s.furigana && <span style={{ color: "#e8502a", fontSize: 11 }}>{s.furigana}</span>}
                <span style={{ color: "#555", fontSize: 11, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.meaning}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
function ExplainFields({ data, onChange, qKey }: {
  data: QData; onChange: (k: string, v: string) => void; qKey?: string;
}) {
  return (
    <>
      <Fl label="Giải thích"><Ta value={String(data.explanation||"")} onChange={v => onChange("explanation",v)} placeholder="Giải thích đáp án..." rows={2} /></Fl>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Fl label="Từ vựng (tìm & chọn từ thư viện)">
          <VocabInput key={"v_"+(qKey||"new")} value={String(data.vocab||"")} onChange={v => onChange("vocab",v)} />
        </Fl>
        <Fl label="Ngữ pháp (tìm & chọn từ thư viện)">
          <GrammarInput key={"g_"+(qKey||"new")} value={String(data.grammar||"")} onChange={v => onChange("grammar",v)} />
        </Fl>
      </div>
    </>
  );
}

// ─── RENDER PREVIEW HELPERS ───────────────────────────────────────
function rBlue(t: string) {
  if (!t) return <span style={{ color: C.muted2 }}>Câu hỏi...</span>;
  return t.split(/(\([^)]*\))/g).map((p, i) =>
    /^\([^)]*\)$/.test(p) ? <span key={i} style={{ color: C.blue, textDecoration: "underline", fontWeight: 600 }}>{p.slice(1,-1)}</span> : <span key={i}>{p}</span>);
}
const richPairTags: Array<{ open: string; close: string; style: React.CSSProperties }> = [
  { open: "[縦]", close: "[/縦]", style: { display: "block", writingMode: "vertical-rl", textOrientation: "mixed", height: 440, maxHeight: "70vh", overflowX: "auto", width: "fit-content", maxWidth: "100%", marginLeft: "auto", marginRight: "auto", background: "#fff", border: "1px solid var(--border)", borderRadius: 8, padding: "22px 26px", boxSizing: "border-box" } },
  { open: "[left]", close: "[/left]", style: { textAlign: "left" } },
  { open: "[center]", close: "[/center]", style: { textAlign: "center" } },
  { open: "[right]", close: "[/right]", style: { textAlign: "right" } },
];
function rRichInline(src: string, key: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let i = 0;
  while (i < src.length) {
    const sizeMatch = src.slice(i).match(/^\[size=(\d{1,2})\]/);
    if (sizeMatch) {
      const close = "[/size]";
      const start = i + sizeMatch[0].length;
      const end = src.indexOf(close, start);
      if (end >= 0) {
        const px = Math.max(10, Math.min(36, Number(sizeMatch[1])));
        out.push(<span key={`${key}-size-${i}`} style={{ fontSize: px }}>{rRichInline(src.slice(start, end), `${key}-size-${i}`)}</span>);
        i = end + close.length;
        continue;
      }
    }
    const tag = richPairTags.find((x) => src.startsWith(x.open, i));
    if (tag) {
      const start = i + tag.open.length;
      const end = src.indexOf(tag.close, start);
      if (end >= 0) {
        out.push(<span key={`${key}-${tag.open}-${i}`} style={{ display: "block", ...tag.style }}>{rRichInline(src.slice(start, end), `${key}-${i}`)}</span>);
        i = end + tag.close.length;
        continue;
      }
    }
    if (src.startsWith("**", i)) {
      const end = src.indexOf("**", i + 2);
      if (end >= 0) {
        out.push(<strong key={`${key}-b-${i}`}>{rRichInline(src.slice(i + 2, end), `${key}-b-${i}`)}</strong>);
        i = end + 2;
        continue;
      }
    }
    if (src.startsWith("__", i)) {
      const end = src.indexOf("__", i + 2);
      if (end >= 0) {
        out.push(<span key={`${key}-u-${i}`} style={{ textDecoration: "underline" }}>{rRichInline(src.slice(i + 2, end), `${key}-u-${i}`)}</span>);
        i = end + 2;
        continue;
      }
    }
    if (src[i] === "*") {
      const end = src.indexOf("*", i + 1);
      if (end >= 0) {
        out.push(<em key={`${key}-i-${i}`}>{rRichInline(src.slice(i + 1, end), `${key}-i-${i}`)}</em>);
        i = end + 1;
        continue;
      }
    }
    // Furigana: {(漢字)(よみ)} or {(A)(B)} — works in both JP passages and
    // VI translations. Mirrors parseFurigana() in src/lib/furigana.ts so
    // the admin preview matches what review actually renders.
    if (src.startsWith("{(", i)) {
      const m = src.slice(i).match(/^\{\(([^)]*)\)\(([^)]*)\)\}/);
      if (m) {
        out.push(
          <ruby key={`${key}-r-${i}`}>{m[1]}<rt>{m[2]}</rt></ruby>
        );
        i += m[0].length;
        continue;
      }
    }
    let next = src.length;
    for (const marker of ["[size=", ...richPairTags.map((x) => x.open), "**", "__", "*", "{("]) {
      const at = src.indexOf(marker, i + 1);
      if (at >= 0 && at < next) next = at;
    }
    out.push(<React.Fragment key={`${key}-t-${i}`}>{src.slice(i, next)}</React.Fragment>);
    i = next;
  }
  return out;
}
function normalizeQuestionLines(t: string) {
  return String(t).replace(/\r\n?/g, "\n").replace(/(^|\n)[ \t　]+/g, "$1");
}
function rBlank(t: string) {
  if (!t) return <span style={{ color: C.muted2 }}>Câu hỏi...</span>;
  const text = normalizeQuestionLines(t);
  return (
    <span style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
      {text.split(/(\([^)]*\))/g).map((p, i) =>
        /^\([^)]*\)$/.test(p) ? <span key={i} style={{ display: "inline-block", width: 32, height: 20, border: `2px solid ${C.text}`, verticalAlign: "middle", margin: "0 3px", borderRadius: 3 }} /> : <React.Fragment key={i}>{rRichInline(p, `blank-${i}`)}</React.Fragment>)}
    </span>
  );
}
function rBlack(t: string) {
  if (!t) return <span style={{ color: C.muted2 }}>Câu hỏi...</span>;
  const parts = t.split(/(\([^)]*\))/g);
  return parts.map((p, i) =>
    /^\([^)]*\)$/.test(p) ? <span key={i} style={{ textDecoration: "underline", fontWeight: 700 }}>{p.slice(1,-1)}</span>
    : <span key={i}>{(i>0 && /^\([^)]*\)$/.test(parts[i-1])) ? p.replace(/^ /, "") : p}</span>);
}
function rBunpo2(t: string) {
  if (!t) return <span style={{ color: C.muted2 }}>Câu hỏi...</span>;
  const text = normalizeQuestionLines(t);
  return (
    <span style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
      {text.split(/(\(★\)|\([^)]*\))/g).map((p, i) =>
        p === "(★)" ? <span key={i} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 34, height: 22, border: `2px solid ${C.amber}`, color: C.amber, verticalAlign: "middle", margin: "0 2px", borderRadius: 3, fontSize: 12, fontWeight: 800 }}>★</span>
        : /^\([^)]*\)$/.test(p) ? <span key={i} style={{ display: "inline-block", width: 32, height: 20, border: `2px solid ${C.text}`, verticalAlign: "middle", margin: "0 2px", borderRadius: 3 }} />
        : <React.Fragment key={i}>{rRichInline(p, `bunpo2-${i}`)}</React.Fragment>)}
    </span>
  );
}
function rRich(t: string) {
  if (!t) return <span style={{ color: C.muted2 }}>Đoạn văn...</span>;
  return (
    <div style={{ fontSize: 15, lineHeight: 1.9, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
      {rRichInline(t, "rich")}
    </div>
  );
}
function PreviewChoices({ correct, wrongs }: { correct: string; wrongs: string[] }) {
  const [sel, setSel] = useState<number|null>(null);
  const all = [correct, ...wrongs];
  return (
    <div style={{ marginTop: 10 }}>
      {all.map((v, i) => (
        <button key={i} type="button" onClick={() => setSel(i)} style={{
          display: "block", width: "100%", textAlign: "left", marginBottom: 5,
          padding: "7px 11px", borderRadius: 7, fontSize: 12, cursor: "pointer",
          border: `1.5px solid ${sel===i?(i===0?C.green:C.red):C.border2}`,
          background: sel===i?(i===0?C.green+"18":C.red+"18"):"transparent",
          color: v ? C.text : C.muted,
        }}>
          <span style={{ marginRight: 6, color: C.muted }}>{"①②③④"[i]}</span>{v||"—"}
        </button>
      ))}
      {sel!==null && <div style={{ fontSize: 11, marginTop: 4, color: sel===0?C.green:C.red }}>{sel===0?"✓ Chính xác！":`✗ Đáp án đúng: ${correct}`}</div>}
    </div>
  );
}

// ─── QUESTION FORMS ───────────────────────────────────────────────
function VocabForm({ data, onChange, renderQ, typeId, level }: {
  data: QData; onChange: (d: QData) => void; renderQ: (t: string) => React.ReactNode; typeId: string; level: string;
}) {
  const u = (k: string, v: unknown) => onChange({ ...data, [k]: v });
  const isGrammarQuestion = typeId === "bunmyaku" || typeId === "bunpo1";
  return (
    <div>
      <FixedHeader text={getFixedHeaderText(typeId, data as Record<string,string>, level)} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
        <div style={{ paddingRight: 24, borderRight: `1px solid ${C.border}` }}>
          <Fl label="Câu hỏi" hint={isGrammarQuestion ? "B / I / căn lề / xuống dòng / () → □" : "Dùng () để highlight"}>
            {isGrammarQuestion ? (
              <RichTa value={String(data.question||"")} onChange={v => u("question",v)} placeholder="例：[center]彼は（）学校へ行った。[/center]" rows={3} />
            ) : (
              <Ta value={String(data.question||"")} onChange={v => u("question",v)} placeholder="例：（試験）の勉強をする。" rows={3} />
            )}
          </Fl>
          <Fl label="Đáp án đúng"><Inp value={String(data.correct||"")} onChange={v => u("correct",v)} placeholder="正解" /></Fl>
          <WrongAnswers values={(data.wrongs as string[])||["","",""]} onChange={v => u("wrongs",v)} />
          <ExplainFields data={data} onChange={(k,v) => u(k,v)} qKey={String(data.id||data.question||"").slice(0,20)||"q"} />
        </div>
        <div style={{ paddingLeft: 24 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 12 }}>Preview</div>
          <div style={{ fontSize: 14, lineHeight: 1.8, marginBottom: 12 }}>{renderQ(String(data.question||""))}</div>
          <PreviewChoices correct={String(data.correct||"")} wrongs={(data.wrongs as string[])||["","",""]} />
          {data.explanation ? <div style={{ marginTop: 10, padding: "9px 12px", background: C.surface, borderRadius: 8, fontSize: 12, color: C.muted, lineHeight: 1.6 }}>{String(data.explanation as string)}</div> : null}
        </div>
      </div>
    </div>
  );
}
function YohoForm({ data, onChange, level }: { data: QData; onChange: (d: QData) => void; level: string }) {
  const u = (k: string, v: unknown) => onChange({ ...data, [k]: v });
  const wrongs = (data.wrongs as string[]) || ["","",""];
  return (
    <div>
      <FixedHeader text={getFixedHeaderText("yoho", data as Record<string,string>, level)} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
        <div style={{ paddingRight: 24, borderRight: `1px solid ${C.border}` }}>
          <Fl label="Câu hỏi" hint="() → gạch chân xanh"><Ta value={String(data.question||"")} onChange={v => u("question",v)} placeholder="例：（急に）来た。" rows={3} /></Fl>
          <Fl label="Đáp án đúng" hint="() → gạch chân đen"><Inp value={String(data.correct||"")} onChange={v => u("correct",v)} placeholder="例：（急に）走った。" /></Fl>
          <Fl label="Đáp án sai" hint="() → gạch chân đen">
            {Array.from({length:3},(_,i) => (
              <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                <span style={{ fontSize: 11, color: C.red, fontWeight: 700, width: 14 }}>{i+1}</span>
                <Inp value={wrongs[i]||""} onChange={v => { const a=[...wrongs]; a[i]=v; u("wrongs",a); }} placeholder={`Sai ${i+1}`} />
              </div>
            ))}
          </Fl>
          <ExplainFields data={data} onChange={(k,v) => u(k,v)} qKey={String(data.id||data.question||"").slice(0,20)||"q"} />
        </div>
        <div style={{ paddingLeft: 24 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 12 }}>Preview</div>
          <div style={{ fontSize: 14, lineHeight: 1.8, marginBottom: 12 }}>{rBlue(String(data.question||""))}</div>
          <div>{[String(data.correct||""),...wrongs].map((v,i) => (
            <div key={i} style={{ marginBottom: 6, fontSize: 13 }}>
              <span style={{ color: C.muted, marginRight: 6 }}>{"①②③④"[i]}</span>
              {rBlack(v||"")}
            </div>
          ))}</div>
        </div>
      </div>
    </div>
  );
}
function Bunpo2Form({ data, onChange, level }: { data: QData; onChange: (d: QData) => void; level: string }) {
  const u = (k: string, v: unknown) => onChange({ ...data, [k]: v });
  return (
    <div>
      <FixedHeader text={getFixedHeaderText("bunpo2", data as Record<string,string>, level)} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
        <div style={{ paddingRight: 24, borderRight: `1px solid ${C.border}` }}>
          <Fl label="Câu hỏi" hint="B / I / căn lề / xuống dòng / () → □ / (★) → □★">
            <RichTa value={String(data.question||"")} onChange={v => u("question",v)} placeholder="例：[center]彼女は（）（★）（）来た。[/center]" rows={3} />
          </Fl>
          <Fl label="Đáp án đúng"><Inp value={String(data.correct||"")} onChange={v => u("correct",v)} placeholder="正解" /></Fl>
          <WrongAnswers values={(data.wrongs as string[])||["","",""]} onChange={v => u("wrongs",v)} />
          <ExplainFields data={data} onChange={(k,v) => u(k,v)} qKey={String(data.id||data.question||"").slice(0,20)||"q"} />
        </div>
        <div style={{ paddingLeft: 24 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 12 }}>Preview</div>
          <div style={{ fontSize: 14, lineHeight: 1.8, marginBottom: 12 }}>{rBunpo2(String(data.question||""))}</div>
          <PreviewChoices correct={String(data.correct||"")} wrongs={(data.wrongs as string[])||["","",""]} />
        </div>
      </div>
    </div>
  );
}
function BunshoForm({ data, onChange, level }: { data: QData; onChange: (d: QData) => void; level: string }) {
  const u = (k: string, v: unknown) => onChange({ ...data, [k]: v });
  const qs = (data.questions as QData[]) || [mkSQ()];
  const addQ = () => onChange({ ...data, questions: [...qs, mkSQ()] });
  const rmQ = (i: number) => onChange({ ...data, questions: qs.filter((_,j) => j!==i) });
  const uQ = (i: number, k: string, v: unknown) => { const a=[...qs]; a[i]={...a[i],[k]:v}; onChange({...data,questions:a}); };
  return (
    <div>
      <FixedHeader text={getFixedHeaderText("bunsho", data as Record<string,string>, level)} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
        <Fl label="Số x (bắt đầu)" mb={0}><Inp value={String(data.x||"")} onChange={v => u("x",v)} placeholder="46" noBracketBtn /></Fl>
        <Fl label="Số y (kết thúc)" mb={0}><Inp value={String(data.y||"")} onChange={v => u("y",v)} placeholder="50" noBracketBtn /></Fl>
      </div>
      <Fl label="Đoạn văn" hint="B / I / U / căn lề / size / 　　 thụt đầu / [縦][/縦] / 【từ】">
        <RichTa value={String(data.passage||"")} onChange={v => u("passage",v)} placeholder="Nội dung đoạn văn..." rows={7} />
      </Fl>
      <VocabTagHint />
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 14px", marginBottom: 16, background: C.surface }}>
        <div style={{ fontSize: 11, color: C.amber, fontWeight: 700, marginBottom: 6 }}>Preview đoạn văn</div>
        {rRich(String(data.passage||""))}
      </div>
      <Fl label="Bản dịch tiếng Việt" hint="B / I / U / căn lề / size / 　　 thụt đầu / [縦][/縦] / 【từ】">
        <RichTa
          value={String((data.vi_translation as string[])?.[0] || "")}
          onChange={v => {
            const arr = Array.isArray(data.vi_translation) ? [...(data.vi_translation as string[])] : [];
            arr[0] = v;
            onChange({ ...data, vi_translation: arr });
          }}
          placeholder="Bản dịch tiếng Việt của đoạn văn..."
          rows={5}
        />
      </Fl>
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 14px", marginBottom: 16, background: C.surface }}>
        <div style={{ fontSize: 11, color: C.amber, fontWeight: 700, marginBottom: 6 }}>Preview bản dịch</div>
        {rRich(String((data.vi_translation as string[])?.[0] || ""))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: "0.06em", textTransform: "uppercase" }}>Câu hỏi nhỏ ({qs.length})</span>
        <button type="button" onClick={addQ} style={{ padding: "5px 14px", borderRadius: 7, border: `1.5px solid ${C.amber}`, background: C.amber+"15", color: C.amber, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>+ Thêm câu</button>
      </div>
      {qs.map((q, i) => (
        <div key={i} style={{ border: `1.5px solid ${C.border2}`, borderRadius: 10, padding: 16, marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
            <span style={{ fontSize: 12, color: C.amber, fontWeight: 700 }}>[{(data.x&&data.y)?parseInt(String(data.x))+i:i+1}]</span>
            <button type="button" onClick={() => rmQ(i)} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 16 }}>✕</button>
          </div>
          <Fl label="Câu hỏi"><Ta value={String(q.question||"")} onChange={v => uQ(i,"question",v)} placeholder="この文章で筆者が言いたいことは何ですか。" rows={2} /></Fl>
          <Fl label="Đáp án đúng"><Inp value={String(q.correct||"")} onChange={v => uQ(i,"correct",v)} placeholder="正解" /></Fl>
          <WrongAnswers values={(q.wrongs as string[])||["","",""]} onChange={v => uQ(i,"wrongs",v)} />
          <ExplainFields data={q} onChange={(k,v) => uQ(i,k,v)} qKey={(String(q.id||q.question||"q"))+"-"+i} />
        </div>
      ))}
    </div>
  );
}
function ReadingBase({ data, onChange, qPerPassage, multiPassage, typeId, level }: {
  data: QData; onChange: (d: QData) => void; qPerPassage: number[]; multiPassage: boolean; typeId: string; level: string;
}) {
  const u = (k: string, v: unknown) => onChange({ ...data, [k]: v });
  const needsXY = ["tan","chu"].includes(typeId);
  const passages = (data.passages as {text:string;questions:QData[]}[]) || [];
  const addP = () => onChange({ ...data, passages: [...passages, { text: "", questions: Array.from({ length: qPerPassage[0] }, mkSQ) }] });
  const rmP = (i: number) => onChange({ ...data, passages: passages.filter((_,j) => j!==i) });
  const uP = (pi: number, k: string, v: unknown) => { const ps=[...passages]; ps[pi]={...ps[pi],[k]:v}; onChange({...data,passages:ps}); };
  const uQ = (pi: number, qi: number, k: string, v: unknown) => { const ps=[...passages]; const qs=[...(ps[pi].questions||[])]; qs[qi]={...qs[qi],[k]:v}; ps[pi]={...ps[pi],questions:qs}; onChange({...data,passages:ps}); };
  const addQ = (pi: number) => { const ps=[...passages]; ps[pi]={...ps[pi],questions:[...(ps[pi].questions||[]),mkSQ()]}; onChange({...data,passages:ps}); };
  const rmQ = (pi: number, qi: number) => { const ps=[...passages]; ps[pi]={...ps[pi],questions:(ps[pi].questions||[]).filter((_,j)=>j!==qi)}; onChange({...data,passages:ps}); };
  return (
    <div>
      <FixedHeader text={getFixedHeaderText(typeId, data as Record<string,string>, level)} />
      {needsXY && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
          <Fl label="Số x" mb={0}><Inp value={String(data.x||"")} onChange={v => u("x",v)} placeholder="例：46" noBracketBtn /></Fl>
          <Fl label="Số y" mb={0}><Inp value={String(data.y||"")} onChange={v => u("y",v)} placeholder="例：52" noBracketBtn /></Fl>
        </div>
      )}
      {passages.map((p, pi) => (
        <div key={pi} style={{ border: `1.5px solid ${C.border2}`, borderRadius: 12, padding: 18, marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <span style={{ fontSize: 12, color: C.green, fontWeight: 700 }}>{multiPassage ? `Đoạn văn ${pi+1}` : "Đoạn văn"}</span>
            {multiPassage && passages.length > 1 && <button type="button" onClick={() => rmP(pi)} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 16 }}>✕</button>}
          </div>
          <Fl label="Nội dung" hint="B / I / U / căn lề / size / 　　 / [縦][/縦] / 【từ】">
            <RichTa value={p.text||""} onChange={v => uP(pi,"text",v)} rows={6} placeholder="Paste đoạn văn..." />
          </Fl>
          <VocabTagHint />
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 14px", marginBottom: 12, background: C.surface }}>
            <div style={{ fontSize: 11, color: C.green, fontWeight: 700, marginBottom: 4 }}>Preview</div>{rRich(p.text||"")}
          </div>
          <Fl label="Bản dịch tiếng Việt" hint="B / I / U / căn lề / size / 　　 / [縦][/縦] / 【từ】">
            <RichTa
              value={String((data.vi_translation as string[])?.[pi] || "")}
              onChange={v => {
                const arr = Array.isArray(data.vi_translation) ? [...(data.vi_translation as string[])] : [];
                while (arr.length <= pi) arr.push("");
                arr[pi] = v;
                onChange({ ...data, vi_translation: arr });
              }}
              placeholder={multiPassage ? `Bản dịch đoạn văn ${pi+1}...` : "Bản dịch tiếng Việt của đoạn văn..."}
              rows={4}
            />
          </Fl>
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 14px", marginBottom: 12, background: C.surface }}>
            <div style={{ fontSize: 11, color: C.green, fontWeight: 700, marginBottom: 4 }}>Preview bản dịch</div>{rRich(String((data.vi_translation as string[])?.[pi] || ""))}
          </div>
          {(p.questions||[]).map((q, qi) => (
            <div key={qi} style={{ borderTop: `1px solid ${C.border}`, paddingTop: 14, marginTop: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <span style={{ fontSize: 12, color: C.muted, fontWeight: 700 }}>問{qi+1}</span>
                {(p.questions||[]).length > 1 && <button type="button" onClick={() => rmQ(pi,qi)} style={{ background: "none", border: "none", color: C.muted2, cursor: "pointer", fontSize: 14 }}>✕</button>}
              </div>
              <Fl label="Câu hỏi"><Ta value={String(q.question||"")} onChange={v => uQ(pi,qi,"question",v)} placeholder="この文章のテーマは何ですか。" rows={2} /></Fl>
              <Fl label="Đáp án đúng"><Inp value={String(q.correct||"")} onChange={v => uQ(pi,qi,"correct",v)} placeholder="正解" /></Fl>
              <WrongAnswers values={(q.wrongs as string[])||["","",""]} onChange={v => uQ(pi,qi,"wrongs",v)} />
              <ExplainFields data={q} onChange={(k,v) => uQ(pi,qi,k,v)} />
            </div>
          ))}
          <button type="button" onClick={() => addQ(pi)} style={{ marginTop: 12, padding: "5px 14px", borderRadius: 7, border: `1.5px solid ${C.green}`, background: C.green+"15", color: C.green, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>+ Thêm câu hỏi</button>
        </div>
      ))}
      {multiPassage && <button type="button" onClick={addP} style={{ padding: "7px 18px", borderRadius: 8, border: `1.5px solid ${C.green}`, background: C.green+"15", color: C.green, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>+ Thêm đoạn văn</button>}
    </div>
  );
}
function TogoForm({ data, onChange, level }: { data: QData; onChange: (d: QData) => void; level: string }) {
  const u = (k: string, v: unknown) => onChange({ ...data, [k]: v });
  const passages = (data.passages as string[]) || ["",""];
  const qs = (data.questions as QData[]) || [mkSQ()];
  const uP = (i: number, v: string) => { const ps=[...passages]; ps[i]=v; onChange({...data,passages:ps}); };
  const addQ = () => onChange({ ...data, questions: [...qs, mkSQ()] });
  const rmQ = (i: number) => onChange({ ...data, questions: qs.filter((_,j) => j!==i) });
  const uQ = (i: number, k: string, v: unknown) => { const a=[...qs]; a[i]={...a[i],[k]:v}; onChange({...data,questions:a}); };
  return (
    <div>
      <FixedHeader text={getFixedHeaderText("togo", data as Record<string,string>, level)} />
      {[0,1].map(pi => (
        <div key={pi} style={{ border: `1.5px solid ${C.border2}`, borderRadius: 12, padding: 18, marginBottom: 14 }}>
          <div style={{ fontSize: 12, color: C.blue, fontWeight: 700, marginBottom: 10 }}>Đoạn văn {pi===0?"A":"B"}</div>
          <Fl label="Nội dung" hint="B / I / U / căn lề / size / 　　 / [縦][/縦]">
            <RichTa value={passages[pi]||""} onChange={v => uP(pi,v)} rows={5} placeholder={`Đoạn văn ${pi===0?"A":"B"}...`} />
          </Fl>
          <div style={{ padding: "10px 14px", background: C.surface, borderRadius: 8, marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: C.blue, fontWeight: 700, marginBottom: 4 }}>Preview</div>
            {rRich(passages[pi]||"")}
          </div>
          <Fl label="Bản dịch tiếng Việt" hint="B / I / U / căn lề / size / 　　 / [縦][/縦] / 【từ】">
            <RichTa
              value={String((data.vi_translation as string[])?.[pi] || "")}
              onChange={v => {
                const arr = Array.isArray(data.vi_translation) ? [...(data.vi_translation as string[])] : [];
                while (arr.length <= pi) arr.push("");
                arr[pi] = v;
                onChange({ ...data, vi_translation: arr });
              }}
              placeholder={`Bản dịch đoạn văn ${pi===0?"A":"B"}...`}
              rows={4}
            />
          </Fl>
          <div style={{ padding: "10px 14px", background: C.surface, borderRadius: 8, marginTop: 8 }}>
            <div style={{ fontSize: 11, color: C.blue, fontWeight: 700, marginBottom: 4 }}>Preview bản dịch</div>
            {rRich(String((data.vi_translation as string[])?.[pi] || ""))}
          </div>
        </div>
      ))}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: "0.06em", textTransform: "uppercase" }}>Câu hỏi chung ({qs.length})</span>
        <button type="button" onClick={addQ} style={{ padding: "5px 14px", borderRadius: 7, border: `1.5px solid ${C.blue}`, background: C.blue+"15", color: C.blue, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>+ Thêm câu</button>
      </div>
      {qs.map((q,i) => (
        <div key={i} style={{ border: `1.5px solid ${C.border2}`, borderRadius: 10, padding: 16, marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
            <span style={{ fontSize: 12, color: C.blue, fontWeight: 700 }}>問{i+1}</span>
            <button type="button" onClick={() => rmQ(i)} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 16 }}>✕</button>
          </div>
          <Fl label="Câu hỏi"><Ta value={String(q.question||"")} onChange={v => uQ(i,"question",v)} placeholder="AとBの両方の文章が言いたいことは？" rows={2} /></Fl>
          <Fl label="Đáp án đúng"><Inp value={String(q.correct||"")} onChange={v => uQ(i,"correct",v)} placeholder="正解" /></Fl>
          <WrongAnswers values={(q.wrongs as string[])||["","",""]} onChange={v => uQ(i,"wrongs",v)} />
          <ExplainFields data={q} onChange={(k,v) => uQ(i,k,v)} qKey={(String(q.id||q.question||"q"))+"-"+i} />
        </div>
      ))}
    </div>
  );
}
function AudioPreview({ audioUrl }: { audioUrl: string }) {
  if (!audioUrl) return (
    <div style={{ marginBottom: 16, padding: "10px 14px", background: C.surface, border: `1px dashed ${C.purple}44`, borderRadius: 8, fontSize: 11, color: C.muted }}>
      🎧 Audio đề thi chưa được đặt — nhập ở mục "Audio đề thi" phía trên topbar.
    </div>
  );
  return (
    <div style={{ marginBottom: 16, padding: "10px 14px", background: C.surface, border: `1.5px solid ${C.purple}33`, borderRadius: 8, borderLeft: `3px solid ${C.purple}` }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: C.purple, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>Audio đề thi (dùng chung)</div>
      <audio controls src={audioUrl} style={{ width: "100%", height: 32, accentColor: C.purple } as React.CSSProperties} />
    </div>
  );
}
function ListenKadaiForm({ data, onChange, examAudio, typeId, level }: {
  data: QData; onChange: (d: QData) => void; examAudio: string; typeId: string; level: string;
}) {
  const n4n5 = isN4OrN5Level(level), n3 = isN3Level(level);
  const wrongCount = ((n4n5 && typeId==="listen_gaiyou") || (n3 && typeId==="listen_hatsuwa")) ? 2 : 3;
  const allowImage = (n4n5 && (typeId==="listen_kadai"||typeId==="listen_gaiyou")) || (n3 && typeId==="listen_hatsuwa");
  const qs = (data.questions as QData[]) || [];
  const addQ = () => onChange({ ...data, questions: [...qs, wrongCount===2?mkLQS():mkLQ()] });
  const rmQ = (i: number) => onChange({ ...data, questions: qs.filter((_,j) => j!==i) });
  const uQ = (i: number, k: string, v: unknown) => { const a=[...qs]; a[i]={...a[i],[k]:v}; if(k==="wrongs"&&wrongCount===2) a[i].wrongs=(v as string[]).slice(0,2); onChange({...data,questions:a}); };
  return (
    <div>
      <FixedHeader text={getFixedHeaderText(typeId, data as Record<string,string>, level)} />
      <AudioPreview audioUrl={examAudio} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: "0.06em", textTransform: "uppercase" }}>Câu hỏi ({qs.length})</span>
        <button type="button" onClick={addQ} style={{ padding: "5px 14px", borderRadius: 7, border: `1.5px solid ${C.purple}`, background: C.purple+"15", color: C.purple, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>+ Thêm câu</button>
      </div>
      {qs.map((q,i) => (
        <div key={i} style={{ border: `1.5px solid ${C.border2}`, borderRadius: 10, padding: 16, marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
            <span style={{ fontSize: 12, color: C.purple, fontWeight: 700 }}>Câu {i+1}</span>
            {qs.length>1 && <button type="button" onClick={() => rmQ(i)} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 16 }}>✕</button>}
          </div>
          <Fl label="Số thứ tự trong đề"><Inp value={String(q.orderNum||"")} onChange={v => uQ(i,"orderNum",v)} placeholder="例：1" style={{ width: 120 }} noBracketBtn /></Fl>
          <Fl label="Đáp án đúng"><Inp value={String(q.correct||"")} onChange={v => uQ(i,"correct",v)} placeholder="正解" /></Fl>
          <WrongAnswers values={(q.wrongs as string[])||["","",""]} onChange={v => uQ(i,"wrongs",v)} count={wrongCount} />
          {allowImage && (
            <Fl label="Ảnh minh hoạ (URL)" hint="N4/N5: 課題・発話表現 | N3: 発話表現のみ">
              <Inp value={String(q.imageUrl||"")} onChange={v => uQ(i,"imageUrl",v)} placeholder="https://...jpg/png" noBracketBtn />
              {q.imageUrl ? <img src={String(q.imageUrl)} alt="preview" style={{ marginTop: 8, maxWidth: "100%", maxHeight: 140, objectFit: "contain", border: `1px solid ${C.border2}`, borderRadius: 8, background: C.surface, padding: 4 }} /> : null}
            </Fl>
          )}
          <ExplainFields data={q} onChange={(k,v) => uQ(i,k,v)} qKey={(String(q.id||q.question||"q"))+"-"+i} />
        </div>
      ))}
    </div>
  );
}
function ListenSokujiForm({ data, onChange, examAudio, typeId, level }: {
  data: QData; onChange: (d: QData) => void; examAudio: string; typeId: string; level: string;
}) {
  const qs = (data.questions as QData[]) || [];
  const addQ = () => onChange({ ...data, questions: [...qs, mkLQS()] });
  const rmQ = (i: number) => onChange({ ...data, questions: qs.filter((_,j) => j!==i) });
  const uQ = (i: number, k: string, v: unknown) => { const a=[...qs]; a[i]={...a[i],[k]:v}; onChange({...data,questions:a}); };
  return (
    <div>
      <FixedHeader text={getFixedHeaderText(typeId, data as Record<string,string>, level)} />
      <AudioPreview audioUrl={examAudio} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: "0.06em", textTransform: "uppercase" }}>Câu hỏi ({qs.length})</span>
        <button type="button" onClick={addQ} style={{ padding: "5px 14px", borderRadius: 7, border: `1.5px solid ${C.purple}`, background: C.purple+"15", color: C.purple, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>+ Thêm câu</button>
      </div>
      {qs.map((q,i) => (
        <div key={i} style={{ border: `1.5px solid ${C.border2}`, borderRadius: 10, padding: 16, marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
            <span style={{ fontSize: 12, color: C.purple, fontWeight: 700 }}>Câu {i+1}</span>
            {qs.length>1 && <button type="button" onClick={() => rmQ(i)} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 16 }}>✕</button>}
          </div>
          <Fl label="Số thứ tự trong đề"><Inp value={String(q.orderNum||"")} onChange={v => uQ(i,"orderNum",v)} placeholder="例：1" style={{ width: 120 }} noBracketBtn /></Fl>
          <Fl label="Đáp án đúng"><Inp value={String(q.correct||"")} onChange={v => uQ(i,"correct",v)} placeholder="正解" /></Fl>
          <Fl label="Đáp án sai" hint="2 lựa chọn">
            {[0,1].map(si => (
              <div key={si} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                <span style={{ fontSize: 11, color: C.red, fontWeight: 700, width: 14 }}>{si+1}</span>
                <Inp value={((q.wrongs as string[])||["",""])[si]||""} onChange={v => { const a=[...((q.wrongs as string[])||["",""])]; a[si]=v; uQ(i,"wrongs",a); }} placeholder={`Sai ${si+1}`} />
              </div>
            ))}
          </Fl>
          <ExplainFields data={q} onChange={(k,v) => uQ(i,k,v)} qKey={(String(q.id||q.question||"q"))+"-"+i} />
        </div>
      ))}
    </div>
  );
}
function ListenTogoForm({ data, onChange, examAudio, typeId, level }: {
  data: QData; onChange: (d: QData) => void; examAudio: string; typeId: string; level: string;
}) {
  const t1 = (data.type1 as QData) || { mainQuestion:"", orderNum:"", correct:"", wrongs:["","",""], explanation:"", vocab:"", grammar:"" };
  const t2 = (data.type2 as {mainQuestion:string;questions:QData[]}) || { mainQuestion:"", questions:[mkLTQ(),mkLTQ()] };
  const ut1 = (k: string, v: unknown) => onChange({ ...data, type1: { ...t1, [k]: v } });
  const ut2 = (k: string, v: unknown) => onChange({ ...data, type2: { ...t2, [k]: v } });
  const uT2Q = (i: number, k: string, v: unknown) => {
    const qs = [...(t2.questions||[mkLTQ(),mkLTQ()])];
    qs[i] = { ...qs[i], [k]: v };
    onChange({ ...data, type2: { ...t2, questions: qs } });
  };
  return (
    <div>
      <FixedHeader text={getFixedHeaderText(typeId, data as Record<string,string>, level)} />
      <AudioPreview audioUrl={examAudio} />
      <div style={{ border: `1.5px solid ${C.purple}44`, borderRadius: 12, padding: 18, marginBottom: 16, background: C.purple+"05" }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.purple, marginBottom: 14 }}>Loại 1 — 1 câu (3 đáp án sai)</div>
        {isN1OrN2Level(level) && (
          <Fl label="Câu hỏi lớn"><Ta value={String(t1.mainQuestion||"")} onChange={v => ut1("mainQuestion",v)} placeholder="どちらがよいと思いますか。" rows={2} /></Fl>
        )}
        <Fl label="Số thứ tự trong đề"><Inp value={String(t1.orderNum||"")} onChange={v => ut1("orderNum",v)} placeholder="例：1" style={{ width: 120 }} noBracketBtn /></Fl>
        <Fl label="Đáp án đúng"><Inp value={String(t1.correct||"")} onChange={v => ut1("correct",v)} placeholder="正解" /></Fl>
        <WrongAnswers values={(t1.wrongs as string[])||["","",""]} onChange={v => ut1("wrongs",v)} count={3} />
        <ExplainFields data={t1} onChange={(k,v) => ut1(k,v)} />
      </div>
      <div style={{ border: `1.5px solid ${C.blue}44`, borderRadius: 12, padding: 18, background: C.blue+"05" }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.blue, marginBottom: 14 }}>Loại 2 — 2 câu (có câu hỏi lớn)</div>
        <Fl label="Câu hỏi lớn"><Ta value={String(t2.mainQuestion||"")} onChange={v => ut2("mainQuestion",v)} placeholder="どちらがよいと思いますか。" rows={2} /></Fl>
        {(t2.questions||[mkLTQ(),mkLTQ()]).map((q,i) => (
          <div key={i} style={{ border: `1px solid ${C.border2}`, borderRadius: 8, padding: 14, marginBottom: 10 }}>
            <div style={{ fontSize: 12, color: C.blue, fontWeight: 700, marginBottom: 10 }}>Câu {i+1}</div>
            <Fl label="Số thứ tự trong đề"><Inp value={String(q.orderNum||"")} onChange={v => uT2Q(i,"orderNum",v)} placeholder="例：2" style={{ width: 120 }} noBracketBtn /></Fl>
            <Fl label="Đáp án đúng"><Inp value={String(q.correct||"")} onChange={v => uT2Q(i,"correct",v)} placeholder="正解" /></Fl>
            <WrongAnswers values={(q.wrongs as string[])||["","",""]} onChange={v => uT2Q(i,"wrongs",v)} count={3} />
            <ExplainFields data={q} onChange={(k,v) => uT2Q(i,k,v)} />
          </div>
        ))}
      </div>
    </div>
  );
}
function BjtImageMcForm({ typeId, data, onChange, showQuestion, part1Tip }: {
  typeId: string; data: QData; onChange: (d: QData) => void; showQuestion?: boolean; part1Tip?: boolean;
}) {
  const u = (k: string, v: unknown) => onChange({ ...data, [k]: v });
  const fixed = BJT_FORM_FIXED_JP[typeId] || "";
  const img = String(data.imageUrl||"").trim();
  const isSogo = typeId==="bjt_1_3"||typeId==="bjt_2_3";
  const pickSogo = (n: number) => onChange({ ...data, correct: String(n), wrongs: [1,2,3,4].filter(x=>x!==n).map(String) });
  const curSogo = (() => { const n=parseInt(String(data.correct||"").trim(),10); return (n>=1&&n<=4)?n:1; })();
  return (
    <div>
      <FixedHeader text={fixed} />
      {part1Tip && (
        <div style={{ marginBottom: 14, padding: "10px 12px", background: C.purple+"12", borderRadius: 8, fontSize: 12, color: C.muted, lineHeight: 1.65, border: `1px solid ${C.purple}33` }}>
          <strong style={{ color: C.purple }}>第１部 聴解</strong> — Dùng ô <strong>🎧 BJT Audio</strong> trên thanh trên, dán link và bấm <strong>Save</strong> cho 第1部.
        </div>
      )}
      {showQuestion && <Fl label="Câu hỏi (質問)"><Ta value={String(data.question||"")} onChange={v=>u("question",v)} rows={3} placeholder="Nhập câu hỏi…" /></Fl>}
      <Fl label="Link ảnh / 資料"><Inp value={String(data.imageUrl||"")} onChange={v=>u("imageUrl",v)} placeholder="https://..." noBracketBtn /></Fl>
      {img && /^https?:\/\//i.test(img) && <div style={{ marginBottom: 16 }}><img src={img} alt="" style={{ maxWidth: "100%", maxHeight: 200, objectFit: "contain", borderRadius: 8, border: `1px solid ${C.border2}` }} /></div>}
      {isSogo ? (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, marginBottom: 10 }}>Đáp án đúng trong audio (chọn 1–4)</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
            {[1,2,3,4].map(n => (
              <label key={n} style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 14, fontWeight: 600, color: C.text }}>
                <input type="radio" name={"bjt-sogo-"+typeId+"-"+(data.id||"new")} checked={curSogo===n} onChange={() => pickSogo(n)} style={{ accentColor: C.accent, width: 16, height: 16 } as React.CSSProperties} />
                <span>{n}</span>
              </label>
            ))}
          </div>
          <div style={{ fontSize: 11, color: C.muted2, marginTop: 8, lineHeight: 1.55 }}>Trên trang thi, học viên chỉ thấy các ô <strong style={{ color: C.text }}>1 · 2 · 3 · 4</strong> theo đúng thứ tự (không xáo trộn).</div>
        </div>
      ) : (
        <>
          <Fl label="Đáp án đúng"><Inp value={String(data.correct||"")} onChange={v=>u("correct",v)} placeholder="正解" /></Fl>
          <WrongAnswers values={(data.wrongs as string[])||["","",""]} onChange={v=>u("wrongs",v)} />
        </>
      )}
      <ExplainFields data={data} onChange={u} qKey={String(data.id||typeId)} />
      <div style={{ marginTop: 18, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
        <div style={{ paddingRight: 20, borderRight: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, marginBottom: 8 }}>Preview</div>
          {img && /^https?:\/\//i.test(img) && <img src={img} alt="" style={{ maxWidth: "100%", maxHeight: 140, objectFit: "contain", marginBottom: 10, borderRadius: 6 }} />}
        </div>
        <div style={{ paddingLeft: 20 }}>
          {isSogo ? <div style={{ marginTop: 6, fontSize: 13, color: C.muted }}>Đáp án đúng: <strong style={{ color: C.green, fontSize: 16 }}>{curSogo}</strong> · trên index: 4 nút chỉ hiện số 1–4</div>
          : <PreviewChoices correct={String(data.correct||"")} wrongs={(data.wrongs as string[])||["","",""]} />}
        </div>
      </div>
    </div>
  );
}
function BjtGrammarMcForm({ typeId, data, onChange }: {
  typeId: string; data: QData; onChange: (d: QData) => void;
}) {
  const u = (k: string, v: unknown) => onChange({ ...data, [k]: v });
  return (
    <div>
      <FixedHeader text={BJT_FORM_FIXED_JP[typeId]||""} />
      <Fl label="Câu / 文" hint="Dùng ( ) trong câu — hiển thị thành ô trống giống 文脈規定">
        <Ta value={String(data.sentence||"")} onChange={v=>u("sentence",v)} rows={4} placeholder="例：この本は（　　）です。" />
      </Fl>
      <Fl label="Đáp án đúng"><Inp value={String(data.correct||"")} onChange={v=>u("correct",v)} placeholder="正解" /></Fl>
      <WrongAnswers values={(data.wrongs as string[])||["","",""]} onChange={v=>u("wrongs",v)} />
      <ExplainFields data={data} onChange={u} qKey={String(data.id||typeId)} />
      <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
        <div style={{ paddingRight: 20, borderRight: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, marginBottom: 8 }}>Preview</div>
          <div style={{ fontSize: 14, lineHeight: 1.85 }}>{rBlank(String(data.sentence||""))}</div>
        </div>
        <div style={{ paddingLeft: 20 }}><PreviewChoices correct={String(data.correct||"")} wrongs={(data.wrongs as string[])||["","",""]} /></div>
      </div>
    </div>
  );
}
function BjtPassageMcForm({ typeId, data, onChange }: {
  typeId: string; data: QData; onChange: (d: QData) => void;
}) {
  const u = (k: string, v: unknown) => onChange({ ...data, [k]: v });
  return (
    <div>
      <FixedHeader text={BJT_FORM_FIXED_JP[typeId]||""} />
      <Fl label="質問（câu hỏi）"><Ta value={String(data.question||"")} onChange={v=>u("question",v)} rows={2} /></Fl>
      <Fl label="Đoạn văn（段落）" hint="B / I / U / căn lề / size / thụt dòng / 縦">
        <RichTa value={String(data.passage||"")} onChange={v=>u("passage",v)} rows={10} placeholder="**太字** *斜体* __下線__ 　　インデント&#10;[縦]縦の文[/縦]" />
      </Fl>
      <Fl label="Bản dịch tiếng Việt" hint="B / I / U / căn lề / size / thụt dòng / 縦 / 【từ】">
        <RichTa
          value={String((data.vi_translation as string[])?.[0] || "")}
          onChange={v => {
            const arr = Array.isArray(data.vi_translation) ? [...(data.vi_translation as string[])] : [];
            arr[0] = v;
            onChange({ ...data, vi_translation: arr });
          }}
          placeholder="Bản dịch tiếng Việt của đoạn văn..."
          rows={5}
        />
      </Fl>
      <Fl label="Đáp án đúng"><Inp value={String(data.correct||"")} onChange={v=>u("correct",v)} placeholder="正解" /></Fl>
      <WrongAnswers values={(data.wrongs as string[])||["","",""]} onChange={v=>u("wrongs",v)} />
      <ExplainFields data={data} onChange={u} qKey={String(data.id||typeId)} />
      <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
        <div style={{ paddingRight: 20, borderRight: `1px solid ${C.border}`, fontSize: 13, lineHeight: 1.85 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, marginBottom: 8 }}>Preview 段落</div>
          {rRich(String(data.passage||""))}
        </div>
        <div style={{ paddingLeft: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, marginBottom: 8 }}>Preview 質問</div>
          <div style={{ fontSize: 14, marginBottom: 12 }}>{String(data.question||"")}</div>
          <PreviewChoices correct={String(data.correct||"")} wrongs={(data.wrongs as string[])||["","",""]} />
        </div>
      </div>
    </div>
  );
}

// ─── FORM ROUTER ──────────────────────────────────────────────────
function FormRouter({ typeId, data, onChange, examAudio, level }: {
  typeId: string; data: QData; onChange: (d: QData) => void; examAudio: string; level: string;
}) {
  if (String(typeId||"").startsWith("bjt_")) {
    if (typeId==="bjt_3_3") return <BjtPassageMcForm typeId={typeId} data={data} onChange={onChange} />;
    if (typeId==="bjt_3_1"||typeId==="bjt_3_2") return <BjtGrammarMcForm typeId={typeId} data={data} onChange={onChange} />;
    if (typeId==="bjt_2_2"||typeId==="bjt_2_3") return <BjtImageMcForm typeId={typeId} data={data} onChange={onChange} showQuestion />;
    return <BjtImageMcForm typeId={typeId} data={data} onChange={onChange} part1Tip={/^bjt_1_/.test(typeId)} />;
  }
  if (typeId==="kanji"||typeId==="iikae"||typeId==="hyouki") return <VocabForm data={data} onChange={onChange} renderQ={rBlue}  typeId={typeId} level={level} />;
  if (typeId==="bunmyaku"||typeId==="bunpo1") return <VocabForm data={data} onChange={onChange} renderQ={rBlank} typeId={typeId} level={level} />;
  if (typeId==="yoho")   return <YohoForm   data={data} onChange={onChange} level={level} />;
  if (typeId==="bunpo2") return <Bunpo2Form  data={data} onChange={onChange} level={level} />;
  if (typeId==="bunsho") return <BunshoForm  data={data} onChange={onChange} level={level} />;
  if (typeId==="tan")    return <ReadingBase data={data} onChange={onChange} qPerPassage={[1]}   multiPassage typeId="tan" level={level} />;
  if (typeId==="chu")    return <ReadingBase data={data} onChange={onChange} qPerPassage={[2]}   multiPassage typeId="chu" level={level} />;
  if (typeId==="cho")    return <ReadingBase data={data} onChange={onChange} qPerPassage={[2,3]} multiPassage typeId="cho" level={level} />;
  if (typeId==="togo")   return <TogoForm    data={data} onChange={onChange} level={level} />;
  if (typeId==="shudai") return <ReadingBase data={data} onChange={onChange} qPerPassage={[2,3]} multiPassage typeId="shudai" level={level} />;
  if (typeId==="joho")   return <ReadingBase data={data} onChange={onChange} qPerPassage={[2]}   multiPassage typeId="joho" level={level} />;
  if (typeId==="listen_kadai"||typeId==="listen_point"||typeId==="listen_gaiyou"||typeId==="listen_hatsuwa")
    return <ListenKadaiForm  data={data} onChange={onChange} examAudio={examAudio} typeId={typeId} level={level} />;
  if (typeId==="listen_sokuji") return <ListenSokujiForm data={data} onChange={onChange} examAudio={examAudio} typeId={typeId} level={level} />;
  if (typeId==="listen_togo")   return <ListenTogoForm   data={data} onChange={onChange} examAudio={examAudio} typeId={typeId} level={level} />;
  return <div style={{ color: C.muted, padding: 24 }}>Chưa hỗ trợ loại: {typeId}</div>;
}

// ─── MONDAI GROUPING MODAL ────────────────────────────────────────
// Lets the admin organise questions into 問題 groups via drag-and-drop.
// On Apply: flattens (ungrouped → group1 → group2 → …), writes
// order_index by position, closes. Groups themselves aren't persisted —
// per spec, the only persisted artifact is the resulting order.

interface MondaiGroup {
  id: string;
  label: string;
  questionIds: string[];
}

interface DragItem {
  questionId: string;
  fromGroupId: string; // 'ungrouped' or mondai group id
  fromIndex: number;
}

function MondaiGroupingModal({ questions, onApply, onClose }: {
  questions: ComposeQuestion[];
  onApply: (orderedIds: string[]) => void;
  onClose: () => void;
}) {
  const questionsMap = useMemo(() => {
    const m: Record<string, ComposeQuestion> = {};
    for (const q of questions) m[q.id] = q;
    return m;
  }, [questions]);

  // Initial state: every question goes to ungrouped, one empty mondai.
  const [ungrouped, setUngrouped] = useState<string[]>(() => questions.map(q => q.id));
  const [mondaiGroups, setMondaiGroups] = useState<MondaiGroup[]>(() => [
    { id: "mondai-1", label: "問題1", questionIds: [] },
  ]);
  const [dragging, setDragging] = useState<DragItem | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  function addGroup() {
    setMondaiGroups(prev => [
      ...prev,
      { id: `mondai-${prev.length + 1}-${Date.now()}`, label: `問題${prev.length + 1}`, questionIds: [] },
    ]);
  }

  function removeGroup(id: string) {
    setMondaiGroups(prev => {
      const g = prev.find(x => x.id === id);
      if (g && g.questionIds.length > 0) {
        // Move its members back into the ungrouped pool.
        setUngrouped(u => [...u, ...g.questionIds]);
      }
      return prev.filter(x => x.id !== id);
    });
  }

  function updateGroupLabel(id: string, label: string) {
    setMondaiGroups(prev => prev.map(g => g.id === id ? { ...g, label } : g));
  }

  function moveTo(toGroupId: string) {
    if (!dragging) return;
    // Remove from source.
    if (dragging.fromGroupId === "ungrouped") {
      setUngrouped(u => u.filter(id => id !== dragging.questionId));
    } else {
      setMondaiGroups(prev => prev.map(g =>
        g.id === dragging.fromGroupId
          ? { ...g, questionIds: g.questionIds.filter((_, i) => i !== dragging.fromIndex) }
          : g,
      ));
    }
    // Append to target.
    if (toGroupId === "ungrouped") {
      setUngrouped(u => [...u, dragging.questionId]);
    } else {
      setMondaiGroups(prev => prev.map(g =>
        g.id === toGroupId
          ? { ...g, questionIds: [...g.questionIds, dragging.questionId] }
          : g,
      ));
    }
  }

  function handleDrop(e: React.DragEvent, toGroupId: string) {
    e.preventDefault();
    moveTo(toGroupId);
    setDragging(null);
    setDragOver(null);
  }

  function applyOrder() {
    const orderedIds = [
      ...ungrouped,
      ...mondaiGroups.flatMap(g => g.questionIds),
    ];
    onApply(orderedIds);
  }

  // Order index of a question in the original list — shown on the card so
  // admins keep their bearings while shuffling.
  const origIndex: Record<string, number> = {};
  questions.forEach((q, i) => { origIndex[q.id] = i + 1; });

  function previewText(q: ComposeQuestion): string {
    const raw = String(
      q.question || q.sentence || q.passage || q.mainQuestion || q.imageUrl || q.audioUrl || "",
    ).replace(/\s+/g, " ").trim();
    return raw.length > 40 ? raw.slice(0, 40) + "…" : (raw || "(trống)");
  }

  // Render helper (NOT a nested component): calling a fresh-defined
  // component <DragCard /> on every render gives React.createElement a
  // new `type` each time, so reconciliation treats every card as a
  // different component → unmount/remount → the drag source DOM gets
  // ripped out mid-drag and the drop never lands. As a plain function
  // it just returns inline JSX whose root is a stable 'div' element.
  function renderDragCard(qId: string, fromGroupId: string, fromIndex: number) {
    const q = questionsMap[qId];
    if (!q) return null;
    const isDragging = dragging?.questionId === qId;
    return (
      <div
        key={qId}
        className={`question-drag-card${isDragging ? " dragging" : ""}`}
        draggable
        onDragStart={(e) => {
          // Some browsers (Firefox) refuse to start the drag without
          // any data on the transfer; setting an empty payload is a
          // standard workaround.
          try { e.dataTransfer.setData("text/plain", qId); } catch { /* noop */ }
          e.dataTransfer.effectAllowed = "move";
          setDragging({ questionId: qId, fromGroupId, fromIndex });
        }}
        onDragEnd={() => { setDragging(null); setDragOver(null); }}
      >
        <span className="drag-handle">⠿</span>
        <span style={{ fontWeight: 700, color: C.accent, minWidth: 20 }}>{origIndex[qId]}</span>
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{previewText(q)}</span>
      </div>
    );
  }

  return (
    <div className="mondai-modal-backdrop" onClick={onClose}>
      <div className="mondai-modal" onClick={e => e.stopPropagation()}>
        <div className="grouping-toolbar">
          <div style={{ fontSize: 16, fontWeight: 800, color: C.text }}>📦 Phân nhóm 問題</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={addGroup} style={{ padding: "8px 14px", borderRadius: 8, border: `1.5px solid ${C.accent}`, background: C.accent + "12", color: C.accent, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>+ Thêm 問題</button>
            <button type="button" onClick={applyOrder} style={{ padding: "8px 18px", borderRadius: 8, border: "none", background: C.green, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>✓ Xác nhận thứ tự</button>
            <button type="button" onClick={onClose} style={{ padding: "8px 14px", borderRadius: 8, border: `1.5px solid ${C.border2}`, background: "transparent", color: C.muted, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Hủy</button>
          </div>
        </div>

        <div className="mondai-groups-container">
          {/* Ungrouped pool — always leftmost */}
          <div
            className={`mondai-group ungrouped-pool${dragOver === "ungrouped" ? " drag-over" : ""}`}
            onDragOver={e => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (dragOver !== "ungrouped") setDragOver("ungrouped");
            }}
            onDragLeave={() => setDragOver(prev => prev === "ungrouped" ? null : prev)}
            onDrop={e => handleDrop(e, "ungrouped")}
          >
            <div className="mondai-group-header">
              <div style={{ fontSize: 13, fontWeight: 700, color: C.muted, padding: "0 4px" }}>
                📦 Chưa phân nhóm <span style={{ marginLeft: 6, fontSize: 11, padding: "2px 8px", borderRadius: 99, background: C.border2, color: C.muted }}>{ungrouped.length}</span>
              </div>
            </div>
            <div className="mondai-drop-zone">
              {ungrouped.length === 0
                ? <div className="mondai-empty">Trống — kéo về đây để bỏ nhóm</div>
                : ungrouped.map((qId, idx) => renderDragCard(qId, "ungrouped", idx))
              }
            </div>
          </div>

          {/* Mondai groups */}
          {mondaiGroups.map((g) => (
            <div
              key={g.id}
              className={`mondai-group${dragOver === g.id ? " drag-over" : ""}`}
              onDragOver={e => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (dragOver !== g.id) setDragOver(g.id);
              }}
              onDragLeave={() => setDragOver(prev => prev === g.id ? null : prev)}
              onDrop={e => handleDrop(e, g.id)}
            >
              <div className="mondai-group-header">
                <input
                  className="mondai-label-input"
                  value={g.label}
                  onChange={e => updateGroupLabel(g.id, e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => removeGroup(g.id)}
                  style={{ background: "none", border: "none", color: C.red, cursor: "pointer", fontSize: 16, padding: "0 4px", lineHeight: 1 }}
                  title="Xoá nhóm (di chuyển câu về Chưa phân nhóm)"
                >×</button>
              </div>
              <div className="mondai-drop-zone">
                {g.questionIds.length === 0
                  ? <div className="mondai-empty">Kéo câu hỏi vào đây</div>
                  : g.questionIds.map((qId, idx) => renderDragCard(qId, g.id, idx))
                }
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── DRAGGABLE QUESTION LIST ──────────────────────────────────────
function DraggableQuestionList({ questions, editingId, onEdit, onDelete, onReorder, typeOrder }: {
  questions: ComposeQuestion[];
  editingId: string | null;
  onEdit: (q: ComposeQuestion) => void;
  onDelete: (id: string) => void;
  onReorder: (qs: ComposeQuestion[]) => void;
  typeOrder: TypeDef[];
}) {
  const [dragging, setDragging] = useState<string|null>(null);
  const [dragOver, setDragOver] = useState<string|null>(null);
  const groups: Record<string, ComposeQuestion[]> = {};
  questions.forEach(q => { if (!groups[q.type]) groups[q.type]=[]; groups[q.type].push(q); });
  const orderedTypes = (typeOrder?.length ? typeOrder : ALL_TYPES).map(t=>t.id).filter(id=>groups[id]);
  const handleDragStart = (e: React.DragEvent, q: ComposeQuestion) => {
    setDragging(q.id); e.dataTransfer.effectAllowed = "move";
  };
  const handleDragOver = (e: React.DragEvent, q: ComposeQuestion) => {
    e.preventDefault();
    if (dragging && q.id !== dragging) {
      const dragQ = questions.find(x=>x.id===dragging);
      if (dragQ && dragQ.type === q.type) setDragOver(q.id);
    }
  };
  const handleDrop = (e: React.DragEvent, targetQ: ComposeQuestion) => {
    e.preventDefault();
    if (!dragging || dragging === targetQ.id) { setDragging(null); setDragOver(null); return; }
    const dragQ = questions.find(x=>x.id===dragging);
    if (!dragQ || dragQ.type !== targetQ.type) { setDragging(null); setDragOver(null); return; }
    const newQs = [...questions];
    const fromIdx = newQs.findIndex(x=>x.id===dragging);
    const toIdx   = newQs.findIndex(x=>x.id===targetQ.id);
    newQs.splice(toIdx, 0, newQs.splice(fromIdx,1)[0]);
    onReorder(newQs); setDragging(null); setDragOver(null);
  };
  const handleDragEnd = () => { setDragging(null); setDragOver(null); };
  if (!questions.length) return (
    <div style={{ padding: "32px 16px", textAlign: "center" }}>
      <div style={{ fontSize: 28, marginBottom: 10, opacity: 0.2 }}>📋</div>
      <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.7 }}>Chưa có câu nào.<br/>Soạn xong bấm <strong style={{ color: C.text }}>＋ Lưu câu</strong></div>
    </div>
  );
  return (
    <div>{orderedTypes.map(typeId => {
      const qs = groups[typeId];
      const grp = GROUP_MAP[typeId] || { color: C.accent };
	      const typeMeta = typeOrder.find(t => t.id === typeId) || TYPE_MAP[typeId];
	      return (
	        <div key={typeId}>
	          <div style={{ padding: "6px 12px", fontSize: 10, fontWeight: 700, color: grp.color, letterSpacing: "0.07em", textTransform: "uppercase", background: grp.color+"0c", borderTop: `1px solid ${C.border}` }}>
	            {typeMeta?.label}
	          </div>
          {qs.map((q, i) => {
            const preview = (String(q.question||q.sentence||q.imageUrl||q.passage||q.mainQuestion||q.audioUrl||"")).slice(0,32)||"(trống)";
            const active = q.id === editingId;
            const isDraggingThis = dragging === q.id;
            const isOver = dragOver === q.id;
            return (
              <div key={q.id} draggable onDragStart={e=>handleDragStart(e,q)} onDragOver={e=>handleDragOver(e,q)} onDrop={e=>handleDrop(e,q)} onDragEnd={handleDragEnd} onClick={()=>onEdit(q)}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", cursor: "grab",
                  background: isOver?"rgba(108,111,247,0.10)":active?grp.color+"14":"transparent",
                  borderLeft: active?`3px solid ${grp.color}`:"3px solid transparent",
                  borderTop: isOver?`2px solid ${C.accent}`:"2px solid transparent",
                  opacity: isDraggingThis?0.4:1, transition: "all 0.1s", userSelect: "none" }}>
                <span style={{ fontSize: 10, color: C.muted2, cursor: "grab", flexShrink: 0 }}>⠿</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: grp.color, minWidth: 16, flexShrink: 0 }}>{i+1}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: active?C.text:C.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{preview}{preview.length>=32?"…":""}</div>
                </div>
                <button type="button" onClick={e=>{e.stopPropagation(); if(window.confirm("Xoá câu này?")) onDelete(q.id);}}
                  style={{ background: "none", border: "none", color: C.red, cursor: "pointer", fontSize: 13, padding: "2px 6px", flexShrink: 0, opacity: 0.8, fontWeight: 700 }} title="Xoá câu">✕</button>
              </div>
            );
          })}
        </div>
      );
    })}</div>
  );
}

// ─── EXAM META ────────────────────────────────────────────────────
interface ExamMeta {
  id: string; name: string; level: string; year: string;
  thang: string; nam: string; loai: string; access: string; createdAt: string;
}

function ExamModal({ initial, onConfirm, onClose }: {
  initial?: ExamMeta | null;
  onConfirm: (e: ExamMeta) => void;
  onClose: () => void;
}) {
  const y = new Date().getFullYear().toString();
  const [level, setLevel] = useState(initial?.level||"N3");
  const [thang, setThang] = useState(initial?.thang||"7");
  const [nam, setNam]     = useState(initial?.nam||initial?.year||y);
  const suggest = useCallback(() =>
    level==="BJT" ? `Đề BJT Mock ${nam}` : `Đề thi JLPT ${level} T${thang}/${nam}`, [level,thang,nam]);
  const [nameTouched, setNameTouched] = useState(!!(initial?.name));
  const [name, setName] = useState(initial?.name||suggest());
  useEffect(() => { if (!nameTouched) setName(suggest()); }, [level,thang,nam,nameTouched,suggest]);
  const canConfirm = nam.trim().length>=4 && name.trim().length>0;
  const btnSel = (vals: string[], cur: string, set: (v:string)=>void) => (
    <div style={{ display: "flex", gap: 8 }}>
      {vals.map(v => (
        <button key={v} type="button" onClick={() => set(v)} style={{
          flex: 1, padding: "9px 0", borderRadius: 9,
          border: `1.5px solid ${cur===v?C.accent:C.border2}`,
          background: cur===v?C.accent+"18":"transparent",
          color: cur===v?C.accent:C.muted,
          fontFamily: "inherit", fontSize: 13, fontWeight: cur===v?700:400, cursor: "pointer", transition: "all .15s"
        }}>{v}</button>
      ))}
    </div>
  );
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.82)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div style={{ background: C.card, border: `1.5px solid ${C.border2}`, borderRadius: 18, padding: 36, width: 440, boxShadow: "0 32px 64px rgba(0,0,0,0.7)", position: "relative" }}>
        <button type="button" onClick={onClose} title="Đóng" style={{ position: "absolute", top: 14, right: 14, background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 20, lineHeight: "1", padding: 4 }}>✕</button>
        <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 4 }}>{initial?"Sửa bộ đề":"Tạo bộ đề mới"}</div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 28 }}>Chọn cấp độ và kỳ thi — chỉnh tên bộ đề nếu cần (bấm ↺ để lấy lại tên gợi ý).</div>
        <Fl label="Cấp độ" mb={20}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", gap: 8 }}>{btnSel(["N1","N2","N3"],level,setLevel)}</div>
            <div style={{ display: "flex", gap: 8 }}>{btnSel(["N4","N5","BJT"],level,setLevel)}</div>
          </div>
        </Fl>
        <Fl label="Tháng thi" mb={20} hint={level==="BJT"?"JLPT dùng cho tên gợi ý; BJT có thể bỏ qua":""}>
          <div style={{ opacity: level==="BJT"?0.45:1, pointerEvents: level==="BJT"?"none":"auto" }}>{btnSel(["7","12"],thang,setThang)}</div>
        </Fl>
        <Fl label="Năm" mb={20}>
          <input value={nam} onChange={e=>setNam(e.target.value)} placeholder="2024"
            style={{ ...iBase, width: 120, textAlign: "center", fontSize: 16, letterSpacing: 2 }} />
        </Fl>
        <Fl label="Tên bộ đề" hint={level==="BJT"?"↺ gợi ý theo năm BJT":"Sửa trực tiếp hoặc ↺ gợi ý theo JLPT + kỳ"} mb={24}>
          <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
            <input value={name} onChange={e=>{setName(e.target.value);setNameTouched(true);}} placeholder={suggest()}
              style={{ ...iBase, flex: 1, minWidth: 0 }} />
            <button type="button" title="Tên gợi ý" onClick={() => { setNameTouched(false); setName(suggest()); }}
              style={{ padding: "0 14px", borderRadius: 9, border: `1.5px solid ${C.border2}`, background: C.surface, color: C.muted, fontSize: 16, cursor: "pointer", flexShrink: 0 }}>↺</button>
          </div>
        </Fl>
        <div style={{ display: "flex", gap: 10 }}>
          <button type="button" onClick={onClose} style={{ flex: 1, padding: 11, borderRadius: 9, border: `1.5px solid ${C.border2}`, background: "transparent", color: C.muted, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Hủy</button>
          <button type="button" disabled={!canConfirm} onClick={() => onConfirm({
            name: name.trim(), level, year: nam, loai: initial?.loai||"Chính Thức",
            thang, nam, access: initial?.access||"Free",
            id: initial?.id||randomUUID(),
            createdAt: initial?.createdAt||new Date().toISOString(),
          })} style={{ flex: 2, padding: 11, borderRadius: 9, border: "none", background: C.accent, color: "#fff", fontSize: 13, fontWeight: 800, cursor: canConfirm?"pointer":"not-allowed", opacity: canConfirm?1:0.4, transition: "all .15s" }}>
            {initial?"Lưu thay đổi":"Bắt đầu soạn →"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── SAVE MODAL ───────────────────────────────────────────────────
function SaveModal({ exam, questions, audioUrl, onClose, showToast }: {
  exam: ExamMeta; questions: ComposeQuestion[]; audioUrl: string;
  onClose: () => void; showToast: (msg: string, type?: string) => void;
}) {
  const [status, setStatus] = useState<"idle"|"saving"|"revalidating"|"done"|"error">("idle");
  const [errMsg, setErrMsg] = useState("");

  const doSave = async () => {
    if (!questions.length) { setErrMsg("Chưa có câu hỏi nào để lưu."); return; }
    setStatus("saving"); setErrMsg("");
	    const examRow = {
	      id: exam.id, name: exam.name, level: exam.level,
	      question_count: questions.length,
	      is_published: true,
	      is_premium: exam.access === "Premium",
	      audio_url: audioUrl || null,
	      year: parseInt(exam.year) || null,
	    };
    // Routes through /api/admin/exams (service role) — RLS now blocks
    // direct anon writes on exams + questions.
    try {
      await adminUpsertExam(examRow as Record<string, unknown>);
    } catch (e) {
      const msg = e instanceof AdminApiError ? e.message : (e as Error).message;
      console.error("exam upsert error:", msg);
      setStatus("error"); setErrMsg("Lỗi upsert exam: " + msg); return;
    }
    const qs = questions.map((q, i) => ({
      id: q.id, exam_id: exam.id, type: q.type,
      level: q.level || exam.level,
      order_index: q.order_index ?? i,
      data: q,
    }));
    try {
      await adminUpsertQuestions(qs as Record<string, unknown>[]);
    } catch (e) {
      const msg = e instanceof AdminApiError ? e.message : (e as Error).message;
      console.error("questions upsert error:", msg);
      setStatus("error"); setErrMsg("Lỗi upsert câu hỏi: " + msg); return;
    }
    // Invalidate the Next.js data-cache for /api/exam/<id>/start so learners
    // see the new questions immediately. Failure here is non-fatal — cache
    // simply expires next time it's read.
    setStatus("revalidating");
    try {
      const { data: { session } } = await sb.auth.getSession();
      if (session?.access_token) {
        await fetch("/api/admin/revalidate-exam", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ examId: exam.id }),
        });
      }
    } catch (e) {
      console.warn("[Compose] revalidate failed (non-fatal):", e);
    }
    setStatus("done");
	    showToast(`Đã lưu và xuất bản bộ đề "${exam.name}" (${questions.length} câu) ✓`, "success");
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.82)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div style={{ background: C.card, border: `1.5px solid ${C.border2}`, borderRadius: 18, padding: 32, width: 420, boxShadow: "0 32px 64px rgba(0,0,0,0.7)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16 }}>Lưu bộ đề</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>{exam.name} · {exam.level}</div>
          </div>
          <button type="button" onClick={onClose} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 20 }}>✕</button>
        </div>
        <div style={{ background: C.surface, borderRadius: 12, padding: 16, marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: C.muted }}>Tổng câu hỏi</span>
            <span style={{ fontSize: 13, fontWeight: 700 }}>{questions.length} câu</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontSize: 12, color: C.muted }}>Cấp độ</span>
            <span style={{ fontSize: 13, fontWeight: 700 }}>{exam.level}</span>
          </div>
        </div>
        <div style={{ fontSize: 11, color: C.muted, marginBottom: 16, lineHeight: 1.7, padding: "10px 14px", background: C.panel, borderRadius: 8, borderLeft: `3px solid ${C.muted2}` }}>
	          💡 Sau khi lưu, bộ đề sẽ được xuất bản ngay cho học viên. Có thể vào <strong style={{ color: C.text }}>"Danh sách đề"</strong> để ẩn lại nếu cần.
        </div>
        {errMsg && <div style={{ fontSize: 12, color: C.red, marginBottom: 12, padding: "8px 12px", background: C.red+"12", borderRadius: 8 }}>{errMsg}</div>}
        {status==="done"
          ? <div style={{ textAlign: "center", padding: "14px", background: C.green+"18", borderRadius: 10, border: `1px solid ${C.green}44` }}>
              <div style={{ fontSize: 18, marginBottom: 6 }}>✓</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.green }}>Lưu thành công!</div>
	              <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>Bộ đề đã sẵn sàng trên web.</div>
              <button type="button" onClick={onClose} style={{ marginTop: 14, padding: "8px 24px", borderRadius: 8, border: "none", background: C.green, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Đóng</button>
            </div>
          : <div style={{ display: "flex", gap: 10 }}>
              <button type="button" onClick={onClose} style={{ flex: 1, padding: 11, borderRadius: 9, border: `1.5px solid ${C.border2}`, background: "transparent", color: C.muted, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Hủy</button>
              <button type="button" onClick={doSave} disabled={status==="saving"||status==="revalidating"} style={{ flex: 2, padding: 11, borderRadius: 9, border: "none", background: (status==="saving"||status==="revalidating")?C.muted2:C.green, color: "#fff", fontSize: 13, fontWeight: 800, cursor: (status==="saving"||status==="revalidating")?"not-allowed":"pointer", transition: "all .2s" }}>
                {status==="saving"?"⏳ Đang lưu...":status==="revalidating"?"⚡ Đang tạo cache...":status==="error"?"↺ Thử lại":"💾 Lưu bộ đề"}
              </button>
            </div>
        }
      </div>
    </div>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────
export default function ComposeTab({ showToast }: { showToast: (msg: string, type?: string) => void }) {
  const [exam, setExam]                 = useState<ExamMeta|null>(null);
  const [showExamModal, setShowExamModal] = useState(false);
  const [showSave, setShowSave]         = useState(false);
  const [questions, setQuestions]       = useState<ComposeQuestion[]>([]);
  const [editingId, setEditingId]       = useState<string|null>(null);
  const [activeId, setActiveId]         = useState("kanji");
  const [formData, setFormData]         = useState<Record<string,QData>>(() =>
    Object.fromEntries(ALL_TYPES.map(t => [t.id, mkDefault(t.id)])));
  const [pulse, setPulse]               = useState(false);
  const [showJSON, setShowJSON]         = useState(false);
  const [groupingOpen, setGroupingOpen] = useState(false);
  const [audioUrl, setAudioUrl]         = useState("");
  const [audioUrlDraft, setAudioUrlDraft] = useState("");
  const [bjtAudio, setBjtAudio]         = useState({ part1: "", part2: "" });
  const [bjtAudioDraft, setBjtAudioDraft] = useState({ part1: "", part2: "" });
  const [showAudioInput, setShowAudioInput] = useState(false);
  const [loadingExam, setLoadingExam]   = useState(false);
  const excelRef = useRef<HTMLInputElement>(null);
  const questionListScrollRef = useRef<HTMLDivElement>(null);

  const handleQuestionListDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    const el = questionListScrollRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const edge = 64;
    const step = 18;
    if (e.clientY < rect.top + edge) el.scrollBy({ top: -step });
    else if (e.clientY > rect.bottom - edge) el.scrollBy({ top: step });
  };

  useEffect(() => {
    let cancelled = false;
    async function loadAdminCaches() {
      try {
        let vocabAll: Array<Record<string, unknown>> = [];
        let from = 0;
        while (true) {
          const { data, error } = await sb
            .from("vocabulary_library")
            .select("id,word,reading,meaning,meaning_jp")   // không load examples — không cần cho autocomplete
            .order("id", { ascending: true })
            .range(from, from + 999);
          if (error) break;
          vocabAll = vocabAll.concat(data || []);
          if (!data || data.length < 1000) break;
          from += 1000;
        }
        from = 0;
        let grammarAll: Array<Record<string, unknown>> = [];
        while (true) {
          const { data, error } = await sb
            .from("grammar_library")
            .select("id,name,furigana,meaning")
            .order("id", { ascending: true })
            .range(from, from + 999);
          if (error) break;
          grammarAll = grammarAll.concat(data || []);
          if (!data || data.length < 1000) break;
          from += 1000;
        }
        if (!cancelled) {
          (window as unknown as Record<string, unknown>).ADMIN_VOCAB_CACHE = vocabAll;
          (window as unknown as Record<string, unknown>).ADMIN_GRAMMAR_CACHE = grammarAll;
        }
      } catch {}
    }
    void loadAdminCaches();
    return () => { cancelled = true; };
  }, []);

  const composeTypeGroups = getComposeTypeGroups(exam?.level||"");
  const composeAllTypes: TypeDef[] = composeTypeGroups.flatMap(g => g.types.map(t => ({ ...t, color: g.color })));
  const composeTypeIds  = composeAllTypes.map(t => t.id);
  const composeTypeMap  = Object.fromEntries(composeAllTypes.map(t => [t.id, t]));

  useEffect(() => {
    if (composeTypeIds.length && !composeTypeIds.includes(activeId)) {
      setActiveId(composeTypeIds[0]);
      setEditingId(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exam?.level]);

  const grpColor = GROUP_MAP[activeId]?.color || C.accent;
  const exportAudioUrl = exam?.level==="BJT"
    ? JSON.stringify({ bjt_part1: bjtAudio.part1||"", bjt_part2: bjtAudio.part2||"" })
    : (audioUrl||"");
  const data     = formData[activeId] || {};
  const setData  = (v: QData) => setFormData(d => ({ ...d, [activeId]: v }));
  const resetForm = () => setFormData(d => ({ ...d, [activeId]: mkDefault(activeId) }));

  const handleSaveQ = () => {
    if (!exam) { setShowExamModal(true); return; }
    const q: ComposeQuestion = { ...data, id: editingId||randomUUID(), type: activeId, level: exam.level };
    if (activeId==="bjt_1_3"||activeId==="bjt_2_3") normalizeBjtSogoChokaiQuestion(q);
    if (editingId) setQuestions(qs => qs.map(x => x.id===editingId?q:x));
    else setQuestions(qs => [...qs, q]);
    setEditingId(null); resetForm();
    setPulse(true); setTimeout(() => setPulse(false), 600);
  };
  const handleEdit = (q: ComposeQuestion) => {
    const row = { ...q };
    if (q.type==="bjt_1_3"||q.type==="bjt_2_3") normalizeBjtSogoChokaiQuestion(row);
    setActiveId(q.type);
    setFormData(d => ({ ...d, [q.type]: row }));
    setEditingId(q.id);
  };
  const handleDelete = (id: string) => {
    setQuestions(qs => qs.filter(q => q.id!==id));
    if (editingId===id) { setEditingId(null); resetForm(); }
  };
  const handleReorder = (newQs: ComposeQuestion[]) => setQuestions(newQs);
  const switchType = (id: string) => {
    if (editingId) setEditingId(null);
    setFormData(d => ({ ...d, [id]: mkDefault(id) }));
    setActiveId(id);
  };

  const handleImportComposeExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const file = input.files && input.files[0];
    if (!file) return;
    if (!exam) { showToast("Hãy tạo/chọn bộ đề trước khi import Excel.", "error"); input.value = ""; return; }
    try {
      const XLSX = await loadXLSX();
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as unknown[][];
      if (!rows.length) { showToast("File Excel rỗng.", "error"); input.value = ""; return; }
      const headers = (rows[0] || []).map(normHeaderKey);
      const startIdx = headers.some(Boolean) ? 1 : 0;
      const dataRows = rows.slice(startIdx).filter(r => (r || []).some(c => String(c || "").trim() !== ""));
      if (!dataRows.length) { showToast("Không có dòng dữ liệu hợp lệ.", "error"); input.value = ""; return; }

      // ── Marker parsing: rows like "m1", "rm2", "lm3" (rest of cells
      // empty) flag the start of a 問題 group. Detected groups produce a
      // resulting order_index reshuffle; nothing about the grouping is
      // persisted to the DB. Default section = read, default mondai = 1.
      const MONDAI_MARKER = /^(r|l)?m(\d+)$/i;
      let currentSection: "read" | "listen" = "read";
      let currentMondai = 1;
      let markersFound = 0;
      // Parallel array — same length as `built`. Holds the (section,
      // mondai) tag for each question so we can sort + count groups
      // after the build pass.
      const tags: { section: "read" | "listen"; mondai: number }[] = [];

      const built: ComposeQuestion[] = [];
      for (const r of dataRows) {
        const firstCell = String((r as unknown[])[0] ?? "").trim();
        const mm = firstCell.match(MONDAI_MARKER);
        const restEmpty = (r as unknown[]).slice(1).every((c) => !String(c ?? "").trim());
        if (mm && restEmpty) {
          const prefix = (mm[1] || "r").toLowerCase();
          currentSection = prefix === "l" ? "listen" : "read";
          currentMondai = parseInt(mm[2], 10);
          markersFound++;
          continue;
        }
        const rowObj: Record<string, string> = {};
        headers.forEach((h, idx) => { if (h) rowObj[h] = String((r as unknown[])[idx] ?? "").trim(); });
        const q = buildQuestionFromExcelRow(activeId, rowObj, exam.level, built.length);
        built.push(q);
        tags.push({ section: currentSection, mondai: currentMondai });
      }

      // Pair each built row with its tag, drop invalid, then optionally
      // sort by group when markers were present.
      const isValid = (q: ComposeQuestion) => !!(
        q && (
          q.question || q.passage || q.sentence || q.imageUrl ||
          (Array.isArray(q.passages) && q.passages.length) ||
          (Array.isArray(q.questions) && q.questions.length) ||
          q.mainQuestion || q.orderNum || (q.type1 && ((q.type1 as QData).correct || (q.type1 as QData).mainQuestion))
        )
      );
      const paired = built.map((q, i) => ({ q, tag: tags[i], origIdx: i })).filter((p) => isValid(p.q));
      if (!paired.length) { showToast("Không map được dữ liệu cho mondai hiện tại.", "error"); input.value = ""; return; }

      let finalQs: ComposeQuestion[];
      let groupSummary = "";
      if (markersFound > 0) {
        // Read groups before listen; mondai number ascending; preserve
        // upload order within the same group.
        paired.sort((a, b) => {
          if (a.tag.section !== b.tag.section) return a.tag.section === "read" ? -1 : 1;
          if (a.tag.mondai !== b.tag.mondai) return a.tag.mondai - b.tag.mondai;
          return a.origIdx - b.origIdx;
        });
        const baseOffset = questions.length;
        finalQs = paired.map(({ q }, i) => ({ ...q, order_index: baseOffset + i }));
        // Build toast: "読解 問題1 (6 câu), 聴解 問題1 (3 câu)" — preserves
        // the same sort order shown above.
        const counts = new Map<string, number>();
        for (const { tag } of paired) {
          const key = `${tag.section}-${tag.mondai}`;
          counts.set(key, (counts.get(key) || 0) + 1);
        }
        const labels: string[] = [];
        for (const [key, count] of counts) {
          const [sec, num] = key.split("-");
          const lbl = sec === "listen" ? `聴解 問題${num}` : `読解 問題${num}`;
          labels.push(`${lbl} (${count} câu)`);
        }
        groupSummary = labels.join(", ");
      } else {
        finalQs = paired.map(({ q }) => q);
      }

      setQuestions(qs => [...qs, ...finalQs]);
      setEditingId(null);
      resetForm();
      if (markersFound > 0) {
        showToast(`✅ Đã phân nhóm tự động: ${groupSummary}`, "success");
      } else {
        showToast(`Đã import ${finalQs.length} câu cho ${composeTypeMap[activeId]?.label || TYPE_MAP[activeId]?.label || activeId} ✓`, "success");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast("Lỗi import Excel: " + msg, "error");
    }
    input.value = "";
  };

  const handleDownloadComposeTemplate = async () => {
    try {
      const XLSX = await loadXLSX();
      const t = getComposeTemplate(activeId, exam?.level || "");
      const ws = XLSX.utils.aoa_to_sheet([t.headers, t.sample]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, TYPE_MAP[activeId]?.label || activeId);
      XLSX.writeFile(wb, `compose_template_${activeId}.xlsx`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast("Không tải được template: " + msg, "error");
    }
  };

  // Load existing exam for editing (called from ExamsTab via window bridge)
  const loadExamForEdit = useCallback(async (examData: Record<string, unknown>) => {
    setLoadingExam(true);
    try {
      const { data: qs, error } = await sb.from("questions").select("*").eq("exam_id", examData.id).order("order_index");
      if (error) { showToast("Lỗi load câu hỏi: "+error.message, "error"); return; }
      const newFormData = Object.fromEntries(ALL_TYPES.map(t => [t.id, mkDefault(t.id)]));
      const loadedQs: ComposeQuestion[] = (qs||[]).map(q => ({
        ...(q.data as QData || {}),
        id: String(q.id), type: String(q.type), level: String(q.level||examData.level||""),
        order_index: Number(q.order_index ?? 0),
      }));
      setExam({
        id: String(examData.id), name: String(examData.name), level: String(examData.level),
        year: String(examData.year||""), loai: String(examData.loai||"Chính Thức"),
        thang: String(examData.thang||"7"), nam: String(examData.year||""),
        access: examData.is_premium?"Premium":"Free",
        createdAt: String(examData.created_at||new Date().toISOString()),
      });
      const lvlUp = String(examData.level||"").toUpperCase();
      if (lvlUp==="BJT") {
        let p1="", p2="";
        try {
          const obj = typeof examData.audio_url==="string" ? JSON.parse(examData.audio_url) : (examData.audio_url||{}) as Record<string,string>;
          p1 = (obj as Record<string,string>).bjt_part1 || (obj as Record<string,string>).part1 || "";
          p2 = (obj as Record<string,string>).bjt_part2 || (obj as Record<string,string>).part2 || "";
        } catch { p1 = String(examData.audio_url||""); }
        setBjtAudio({ part1:p1, part2:p2 }); setBjtAudioDraft({ part1:p1, part2:p2 });
        setAudioUrl(""); setAudioUrlDraft("");
      } else {
        setAudioUrl(String(examData.audio_url||"")); setAudioUrlDraft(String(examData.audio_url||""));
        setBjtAudio({ part1:"", part2:"" }); setBjtAudioDraft({ part1:"", part2:"" });
      }
      setQuestions(loadedQs); setFormData(newFormData); setEditingId(null);
      showToast(`Đã load đề "${examData.name}" — chỉnh sửa rồi nhấn Lưu bộ đề`, "default");
    } finally { setLoadingExam(false); }
  }, [showToast]);

  // Expose to window so ExamsTab can call it
  useEffect(() => {
    (window as unknown as Record<string, unknown>)._jlptLoadExam = loadExamForEdit;
    return () => { delete (window as unknown as Record<string, unknown>)._jlptLoadExam; };
  }, [loadExamForEdit]);

  // ── Welcome screen
  if (!exam) return (
    <div style={{ height: "100vh", maxHeight: "100vh", background: C.bg, color: C.text, fontFamily: "'DM Sans','Helvetica Neue',sans-serif", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
      {showExamModal && <ExamModal onConfirm={e => { setExam(e); setShowExamModal(false); }} onClose={() => setShowExamModal(false)} />}
      <div style={{ textAlign: "center", padding: 40 }}>
        <div style={{ fontSize: 52, marginBottom: 16, opacity: 0.12 }}>📋</div>
        <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 8, letterSpacing: -0.5 }}>JLPT Admin v3</div>
        <div style={{ fontSize: 13, color: C.muted, marginBottom: 36, maxWidth: 300, lineHeight: 1.75, margin: "0 auto 36px" }}>
          Tạo bộ đề trước, sau đó soạn câu hỏi theo từng loại.
        </div>
        <button type="button" onClick={() => setShowExamModal(true)} style={{
          padding: "14px 40px", borderRadius: 12, border: "none",
          background: C.accent, color: "#fff", fontSize: 15, fontWeight: 800,
          cursor: "pointer", boxShadow: `0 8px 28px ${C.accent}55`,
          letterSpacing: 0.3, transition: "all .2s",
        }}>＋ Tạo bộ đề</button>
      </div>
      {loadingExam && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000 }}>
          <div style={{ background: C.card, borderRadius: 14, padding: "28px 40px", color: C.muted, fontSize: 14 }}>⏳ Đang tải đề...</div>
        </div>
      )}
    </div>
  );

  return (
    <div style={{ height: "100vh", maxHeight: "100vh", background: C.bg, color: C.text, fontFamily: "'DM Sans','Helvetica Neue',sans-serif", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {showExamModal && <ExamModal initial={exam} onConfirm={e => { setExam(e); setShowExamModal(false); }} onClose={() => setShowExamModal(false)} />}
      {showSave && <SaveModal exam={exam} questions={questions} audioUrl={exportAudioUrl} onClose={() => setShowSave(false)} showToast={showToast} />}
      {groupingOpen && (
        <MondaiGroupingModal
          questions={questions}
          onApply={(orderedIds) => {
            const indexById = new Map(orderedIds.map((id, i) => [id, i]));
            setQuestions(prev =>
              [...prev]
                .map(q => ({ ...q, order_index: indexById.get(q.id) ?? q.order_index ?? 0 }))
                .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0)),
            );
            setGroupingOpen(false);
          }}
          onClose={() => setGroupingOpen(false)}
        />
      )}

      {/* TOP BAR */}
      <div style={{ padding: "10px 20px", borderBottom: `1px solid ${C.border}`, background: C.surface, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0, gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: 1 }}>
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: grpColor, boxShadow: `0 0 8px ${grpColor}88` }} />
          <span style={{ fontWeight: 700, fontSize: 12, color: C.muted, whiteSpace: "nowrap" }}>JLPT Admin</span>
          <span style={{ color: C.muted2, fontSize: 12 }}>/</span>
          <span style={{ fontSize: 13, fontWeight: 700, maxWidth: 260, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{exam.name}</span>
          <span style={{ padding: "2px 8px", borderRadius: 99, background: grpColor+"22", color: grpColor, fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{exam.level}</span>
          <button type="button" onClick={() => setShowExamModal(true)} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 11, padding: "2px 6px", flexShrink: 0 }}>✎ Sửa</button>
          <button type="button" onClick={() => { if (window.confirm("Tạo bộ đề mới? Câu hỏi hiện tại sẽ bị xóa.")) {
            setExam(null); setQuestions([]); setEditingId(null);
            setAudioUrl(""); setAudioUrlDraft("");
            setBjtAudio({ part1:"", part2:"" }); setBjtAudioDraft({ part1:"", part2:"" });
            setShowAudioInput(false);
            setFormData(Object.fromEntries(ALL_TYPES.map(t => [t.id, mkDefault(t.id)])));
          }}} style={{ background: "none", border: `1px solid ${C.border2}`, color: C.muted, cursor: "pointer", fontSize: 11, padding: "2px 9px", borderRadius: 6, flexShrink: 0 }}>+ Mới</button>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
          {exam.level==="BJT" ? (
            <div style={{ display: "flex", alignItems: "center", gap: 6, background: C.panel, border: `1.5px solid ${C.purple}44`, borderRadius: 8, padding: "4px 8px" }}>
              <span style={{ fontSize: 11, color: C.purple, fontWeight: 700, whiteSpace: "nowrap" }}>🎧 BJT Audio</span>
              <input value={bjtAudioDraft.part1} onChange={e => setBjtAudioDraft(v => ({...v,part1:e.target.value}))}
                placeholder="第1部 聴解 URL" style={{ ...iBase, width: 160, padding: "4px 8px", fontSize: 11, borderColor: C.purple+"44" }} />
              <button type="button" onClick={() => setBjtAudio(v=>({...v,part1:bjtAudioDraft.part1}))}
                style={{ padding: "4px 9px", borderRadius: 6, border: "none", background: C.purple, color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Save</button>
              <input value={bjtAudioDraft.part2} onChange={e => setBjtAudioDraft(v => ({...v,part2:e.target.value}))}
                placeholder="第2部 聴読解 URL" style={{ ...iBase, width: 160, padding: "4px 8px", fontSize: 11, borderColor: C.purple+"44" }} />
              <button type="button" onClick={() => { setBjtAudio(v=>({...v,part2:bjtAudioDraft.part2})); showToast("Đã ghi 第２部 (bấm 💾 Lưu bộ đề để lưu DB)","success"); }}
                style={{ padding: "4px 9px", borderRadius: 6, border: "none", background: C.purple, color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Save</button>
            </div>
          ) : (showAudioInput ? (
            <div style={{ display: "flex", alignItems: "center", gap: 6, background: C.panel, border: `1.5px solid ${C.purple}44`, borderRadius: 8, padding: "4px 8px" }}>
              <span style={{ fontSize: 11, color: C.purple, fontWeight: 700, whiteSpace: "nowrap" }}>🎧 Audio URL</span>
              <input value={audioUrlDraft} onChange={e => setAudioUrlDraft(e.target.value)} placeholder="https://..." autoFocus
                style={{ ...iBase, width: 200, padding: "4px 8px", fontSize: 11, borderColor: C.purple+"44" }} />
              <button type="button" onClick={() => setAudioUrl((audioUrlDraft || "").trim().replace(/ /g, "%20"))}
                style={{ padding: "4px 9px", borderRadius: 6, border: "none", background: C.purple, color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Save</button>
              {audioUrl && <audio controls src={audioUrl} style={{ height: 28, width: 130, accentColor: C.purple } as React.CSSProperties} />}
              <button type="button" onClick={() => setShowAudioInput(false)} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 16, padding: "0 4px" }}>✕</button>
            </div>
          ) : (
            <button type="button" onClick={() => setShowAudioInput(true)} style={{ padding: "6px 12px", borderRadius: 7, border: `1.5px solid ${audioUrl?C.purple:C.border2}`, background: audioUrl?C.purple+"15":"transparent", color: audioUrl?C.purple:C.muted, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
              {audioUrl ? "🎧 Audio ✓" : "🎧 Thêm Audio"}
            </button>
          ))}
          {questions.length>0 && <button type="button" onClick={() => setShowSave(true)} style={{ padding: "6px 14px", borderRadius: 8, border: "none", background: C.green, color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>💾 Lưu bộ đề</button>}
          <button type="button" onClick={() => setShowJSON(s => !s)} style={{ padding: "6px 14px", borderRadius: 7, border: `1.5px solid ${C.border2}`, background: showJSON?C.panel:"transparent", color: showJSON?C.text:C.muted, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>{showJSON?"◀ Form":"{ } JSON"}</button>
        </div>
      </div>

      {/* BODY */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden", minHeight: 0 }}>

        {/* LEFT SIDEBAR */}
        <div style={{ width: 152, borderRight: `1px solid ${C.border}`, background: C.surface, overflowY: "auto", flexShrink: 0, padding: "12px 0", minHeight: 0 }}>
          {composeTypeGroups.map(g => (
            <div key={g.label} style={{ marginBottom: 16 }}>
              <div style={{ padding: "0 12px 4px", fontSize: 10, fontWeight: 700, color: g.color, letterSpacing: "0.08em", textTransform: "uppercase" }}>{g.label}</div>
              {g.types.map(t => (
                <button key={t.id} type="button" onClick={() => switchType(t.id)} style={{
                  display: "block", width: "100%", textAlign: "left", padding: "6px 12px", border: "none",
                  background: activeId===t.id?g.color+"18":"transparent",
                  color: activeId===t.id?g.color:C.muted,
                  fontSize: 11, fontWeight: activeId===t.id?700:400, cursor: "pointer",
                  borderLeft: activeId===t.id?`3px solid ${g.color}`:"3px solid transparent",
                  transition: "all 0.1s",
                }}>{t.label}</button>
              ))}
            </div>
          ))}
        </div>

        {/* CENTER */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px", minWidth: 0, minHeight: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18, gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
              <span style={{ fontWeight: 800, fontSize: 15, whiteSpace: "nowrap" }}>{composeTypeMap[activeId]?.label || TYPE_MAP[activeId]?.label || activeId}</span>
              <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 99, background: grpColor+"18", color: grpColor, fontWeight: 600 }}>{exam.level}</span>
              {editingId && <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 99, background: C.amber+"22", color: C.amber, fontWeight: 700 }}>✎ Đang sửa</span>}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
              <input ref={excelRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={handleImportComposeExcel} />
              <button type="button" onClick={() => excelRef.current?.click()} style={{ padding: "7px 12px", borderRadius: 7, border: `1.5px solid ${grpColor}66`, background: grpColor+"18", color: grpColor, fontSize: 12, fontWeight: 700, cursor: "pointer" }} title="Import Excel cho mondai hiện tại">📥 Import Excel</button>
              <button type="button" onClick={handleDownloadComposeTemplate} style={{ padding: "7px 12px", borderRadius: 7, border: `1.5px solid ${C.border2}`, background: "transparent", color: C.muted, fontSize: 12, fontWeight: 700, cursor: "pointer" }} title="Tải template Excel cho mondai hiện tại">⬇ Template Excel</button>
              {editingId && <button type="button" onClick={() => { setEditingId(null); resetForm(); }} style={{ padding: "7px 12px", borderRadius: 7, border: `1.5px solid ${C.border2}`, background: "transparent", color: C.muted, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Hủy</button>}
              <button type="button" onClick={handleSaveQ} style={{ padding: "7px 20px", borderRadius: 8, border: "none", background: pulse?C.green:grpColor, color: "#fff", fontSize: 13, fontWeight: 800, cursor: "pointer", transition: "background 0.25s", whiteSpace: "nowrap" }}>
                {editingId?"✓ Cập nhật":"＋ Lưu câu"}
              </button>
            </div>
          </div>
          {showJSON
            ? <pre style={{ background: C.panel, border: `1.5px solid ${C.border2}`, borderRadius: 10, padding: 20, fontSize: 12, lineHeight: 1.7, color: "#7ec8a0", fontFamily: "monospace", overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                {JSON.stringify({ type: activeId, level: exam.level, ...data }, null, 2)}
              </pre>
            : <FormRouter typeId={activeId} data={data} onChange={setData} examAudio={audioUrl} level={exam.level} />
          }
        </div>

        {/* RIGHT */}
        <div style={{ width: 226, borderLeft: `1px solid ${C.border}`, background: C.surface, display: "flex", flexDirection: "column", flexShrink: 0, minHeight: 0 }}>
          <div style={{ padding: "12px 13px 9px", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12, fontWeight: 700 }}>Danh sách câu</span>
              <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 99, background: C.border2, color: C.muted, fontWeight: 700 }}>{questions.length}</span>
            </div>
            <div style={{ fontSize: 10, color: C.muted2, marginTop: 3 }}>⠿ kéo để sắp xếp trong cùng nhóm</div>
            {questions.length > 0 && (
              <button
                type="button"
                onClick={() => setGroupingOpen(true)}
                style={{ marginTop: 8, width: "100%", padding: "7px 10px", borderRadius: 7, border: `1.5px solid ${C.accent}`, background: C.accent + "12", color: C.accent, fontSize: 11, fontWeight: 700, cursor: "pointer" }}
                title="Mở trình phân nhóm 問題 — kéo thả câu hỏi vào các nhóm rồi xác nhận thứ tự"
              >📦 Phân nhóm 問題</button>
            )}
          </div>
          <div
            ref={questionListScrollRef}
            className="compose-question-list-scroll"
            onDragOver={handleQuestionListDragOver}
            style={{ flex: 1, minHeight: 0, height: "100%", overflowY: "scroll", overscrollBehavior: "contain", WebkitOverflowScrolling: "touch", scrollbarGutter: "stable" }}
          >
            <DraggableQuestionList
              questions={questions} editingId={editingId}
              onEdit={handleEdit} onDelete={handleDelete} onReorder={handleReorder}
              typeOrder={composeAllTypes}
            />
          </div>
        </div>
      </div>

      {loadingExam && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000 }}>
          <div style={{ background: C.card, borderRadius: 14, padding: "28px 40px", color: C.muted, fontSize: 14 }}>⏳ Đang tải đề...</div>
        </div>
      )}
    </div>
  );
}

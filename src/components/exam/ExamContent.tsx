"use client";
import { memo, useMemo, useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import {
  renderQText, renderChoiceText, renderRich,
  buildMondaiHeader, buildBjtSectionHeader, bjtPartLabel,
} from "@/lib/furigana";
import { getSubImageUrl, type SubQuestion, type PassageGroup } from "@/lib/examRender";

const NUMS = ["1", "2", "3", "4"];

// ── Audio URL helper ──
// Strip XSS-relevant chars (<, ") and replace literal spaces with %20.
// We don't aggressively re-encode parens/brackets since R2 dev URLs accept
// them unencoded — over-encoding can break URLs already stored encoded.
function encodeAudioUrl(raw: string): string {
  return raw.trim().replace(/</g, "").replace(/"/g, "").replace(/ /g, "%20");
}

// ── Vocab / Grammar chip types ──
interface VocabItem { word: string; reading?: string; meaning: string; }
interface GrammarItem { name: string; furigana?: string; meaning: string; }
export interface AnkiCardInput { word: string; reading: string; meaning: string; word_type?: string; }

// ── Parse vocab meaning into short + numbered detail lines ──
const NUM_MARKS = /[①②③④⑤⑥⑦⑧⑨⑩]/;
function parseMeaning(m: string): { short: string; lines: string[] } {
  if (!m) return { short: "", lines: [] };
  // Split on first " - " or " ー " separator
  const sep = m.match(/^([\s\S]*?)\s[-ー]\s([\s\S]*)$/);
  if (sep) {
    const short  = sep[1].trim();
    const detail = sep[2].trim();
    // Split detail on ①②③... markers (each gets own line)
    const parts = detail.split(/(?=[①②③④⑤⑥⑦⑧⑨⑩])/).map((p) => p.trim()).filter(Boolean);
    return { short, lines: parts.length > 1 ? parts : detail.split("\n").map((p) => p.trim()).filter(Boolean) };
  }
  // No separator: first line is short, rest are detail
  const lines = m.split("\n").map((p) => p.trim()).filter(Boolean);
  return { short: lines[0] ?? "", lines: lines.slice(1) };
}
function shortMeaning(m: string): string { return parseMeaning(m).short || m.split("\n")[0].slice(0, 38); }

function parseArr<T>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[];
  if (typeof v === "string" && v.trim().startsWith("[")) {
    try { return JSON.parse(v) as T[]; } catch { /* noop */ }
  }
  return [];
}

// ── Quick-add button (handles loading/done state per chip) ──
function QuickAddBtn({ onAdd }: { onAdd: () => Promise<void> }) {
  const [st, setSt] = useState<"idle" | "loading" | "done">("idle");
  async function click(e: React.MouseEvent) {
    e.stopPropagation();
    if (st !== "idle") return;
    setSt("loading");
    try { await onAdd(); } catch { /* noop */ }
    setSt("done");
    setTimeout(() => setSt("idle"), 2000);
  }
  return (
    <button className={`vc-add-btn${st === "done" ? " added" : ""}`} title="Thêm vào Anki" onClick={click}>
      {st === "done" ? "✓" : "+"}
    </button>
  );
}

// ── Chip popup (portal so overflow:hidden on .explain-panel doesn't clip it) ──
function ChipPopup({
  type, item, anchor, onClose, onAdd,
}: {
  type: "vocab" | "grammar";
  item: VocabItem | GrammarItem;
  anchor: { x: number; y: number };
  onClose: () => void;
  onAdd: (card: AnkiCardInput) => Promise<void>;
}) {
  const [st, setSt] = useState<"idle" | "loading" | "done">("idle");

  const left = Math.min(anchor.x, (typeof window !== "undefined" ? window.innerWidth : 800) - 300);
  const below = anchor.y + 8;
  const above = anchor.y - 280;
  const top   = below + 280 > (typeof window !== "undefined" ? window.innerHeight : 600) ? above : below;

  const word    = type === "vocab" ? (item as VocabItem).word    : (item as GrammarItem).name;
  const reading = type === "vocab" ? (item as VocabItem).reading : (item as GrammarItem).furigana;

  async function handleAdd(e: React.MouseEvent) {
    e.stopPropagation();
    if (st !== "idle") return;
    setSt("loading");
    const card: AnkiCardInput = type === "vocab"
      ? { word: (item as VocabItem).word, reading: (item as VocabItem).reading ?? "", meaning: item.meaning }
      : { word: (item as GrammarItem).name, reading: (item as GrammarItem).furigana ?? "", meaning: item.meaning, word_type: "ngữ pháp" };
    try { await onAdd(card); } catch { /* noop */ }
    setSt("done");
    setTimeout(() => { setSt("idle"); onClose(); }, 1500);
  }

  const { short: mShort, lines: mLines } = type === "vocab" ? parseMeaning(item.meaning) : { short: item.meaning, lines: [] };

  return createPortal(
    <div className="chip-popup" style={{ left, top, position: "fixed" }} onClick={(e) => e.stopPropagation()}>
      <button className="cp-close" onClick={onClose}>×</button>
      <div className="cp-word" style={{ color: type === "grammar" ? "var(--accent)" : "var(--text)" }}>{word}</div>
      {reading && <div className="cp-reading">{reading}</div>}
      {type === "vocab" ? (
        <>
          <div className="cp-meaning" style={{ fontSize: 15, fontWeight: 800 }}>{mShort}</div>
          {mLines.length > 0 && (
            <div style={{ marginTop: 6, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
              {mLines.map((l, i) => (
                <div key={i} style={{ fontSize: 13, lineHeight: 1.65, marginBottom: NUM_MARKS.test(l[0] ?? "") ? 4 : 2 }}>
                  {l}
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="cp-meaning">{item.meaning}</div>
      )}
      <button className={`cp-add-btn${st === "done" ? " added" : ""}`} disabled={st === "loading"} onClick={handleAdd}>
        {st === "done" ? "✓ Đã thêm" : st === "loading" ? "..." : "＋ Thêm vào Anki"}
      </button>
    </div>,
    document.body
  );
}

interface ExamContentProps {
  questions: Record<string, unknown>[];
  answers: Record<string, number>;
  answerKey: Record<string, number>;
  keyTypeMap: Record<string, string>;
  submitted: boolean;
  onPick: (key: string, idx: number) => void;
  /** For listening phase: exam audio url */
  audioUrl?: string;
  phase: "read" | "listen";
  onAddToAnki?: (card: AnkiCardInput) => Promise<void>;
}

// ── Choice button ──
function ChoiceBtn({
  qKey, idx, text, nums, qType, sogoMc, selectedIdx, correctIdx, submitted, onPick,
}: {
  qKey: string; idx: number; text: string; nums: string[]; qType: string;
  sogoMc: boolean; selectedIdx: number | undefined; correctIdx: number | undefined;
  submitted: boolean; onPick: (key: string, idx: number) => void;
}) {
  const selected = selectedIdx === idx;
  const correct  = submitted && correctIdx === idx;
  const wrong    = submitted && selected && correctIdx !== idx;
  const cls = ["choice-btn", selected ? "selected" : "", correct ? "correct" : "", wrong ? "wrong" : ""].filter(Boolean).join(" ");
  return (
    <button className={cls} type="button" aria-pressed={selected} onClick={() => !submitted && onPick(qKey, idx)}>
      {sogoMc
        ? <span className="choice-media" dangerouslySetInnerHTML={{ __html: text }} />
        : (
          <>
            <span className="choice-num">{nums[idx] ?? `${idx + 1}`}</span>
            <span className="choice-label" dangerouslySetInnerHTML={{ __html: renderChoiceText(text, qType) }} />
          </>
        )
      }
      <span className="choice-check" aria-hidden="true">✓</span>
    </button>
  );
}
const MemoChoiceBtn = memo(ChoiceBtn);

// ── Explain panel ──
function ExplainPanel({
  qKey, data, onAddToAnki,
}: {
  qKey: string;
  data: SubQuestion | Record<string, unknown>;
  onAddToAnki?: (card: AnkiCardInput) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState(0);
  const [popup, setPopup] = useState<{
    type: "vocab" | "grammar";
    item: VocabItem | GrammarItem;
    anchor: { x: number; y: number };
  } | null>(null);

  const d = data as Record<string, unknown>;
  const expl       = String(d.explanation ?? "");
  const vocabItems = parseArr<VocabItem>(d.vocab);
  const gramItems  = parseArr<GrammarItem>(d.grammar);

  const tabs = ["📝 Giải thích", "📖 Từ vựng", "✏️ Ngữ pháp"];

  useEffect(() => {
    if (!popup) return;
    const close = () => setPopup(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [!!popup]);

  function openPopup(type: "vocab" | "grammar", item: VocabItem | GrammarItem, e: React.MouseEvent) {
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPopup({ type, item, anchor: { x: r.left, y: r.bottom } });
  }

  return (
    <>
      <button className={`explain-btn${open ? " open" : ""}`} style={{ display: "block" }} onClick={() => setOpen((o) => !o)}>
        {open ? "⬆️ Ẩn giải thích" : "⬇️ Xem giải thích"}
      </button>
      {open && (
        <div className="explain-panel open">
          <div className="explain-tabs">
            {tabs.map((t, i) => (
              <button key={i} className={`explain-tab${tab === i ? " active" : ""}`} onClick={() => setTab(i)}>{t}</button>
            ))}
          </div>
          <div className="explain-body">
            {tab === 0 && (
              expl
                ? <div style={{ whiteSpace: "pre-wrap" }} dangerouslySetInnerHTML={{ __html: expl }} />
                : <span className="explain-empty">Chưa có nội dung.</span>
            )}
            {tab === 1 && (
              vocabItems.length > 0
                ? <div style={{ lineHeight: 2.2 }}>
                    {vocabItems.map((v, i) => (
                      <span key={i} className="vocab-chip" onClick={(e) => openPopup("vocab", v, e)}>
                        <strong style={{ fontSize: 14 }}>{v.word}</strong>
                        {v.reading && <span style={{ fontSize: 11, color: "var(--blue)", fontWeight: 500, marginLeft: 3 }}>({v.reading})</span>}
                        <span style={{ fontSize: 11, marginLeft: 5, borderLeft: "1px solid var(--border2)", paddingLeft: 5 }}>
                          {shortMeaning(v.meaning)}
                        </span>
                        {onAddToAnki && (
                          <QuickAddBtn onAdd={() => onAddToAnki({ word: v.word, reading: v.reading ?? "", meaning: v.meaning })} />
                        )}
                      </span>
                    ))}
                  </div>
                : <span className="explain-empty">Chưa có từ vựng.</span>
            )}
            {tab === 2 && (
              gramItems.length > 0
                ? <div style={{ lineHeight: 2.2 }}>
                    {gramItems.map((g, i) => (
                      <span key={i} className="grammar-chip" onClick={(e) => openPopup("grammar", g, e)}>
                        <strong style={{ fontSize: 14 }}>{g.name}</strong>
                        {g.furigana && <span className="gc-furigana">({g.furigana})</span>}
                        <span className="gc-meaning">{g.meaning.slice(0, 28)}</span>
                        {onAddToAnki && (
                          <QuickAddBtn onAdd={() => onAddToAnki({ word: g.name, reading: g.furigana ?? "", meaning: g.meaning, word_type: "ngữ pháp" })} />
                        )}
                      </span>
                    ))}
                  </div>
                : <span className="explain-empty">Chưa có ngữ pháp.</span>
            )}
          </div>
        </div>
      )}
      {popup && (
        <ChipPopup
          type={popup.type}
          item={popup.item}
          anchor={popup.anchor}
          onClose={() => setPopup(null)}
          onAdd={async (card) => { if (onAddToAnki) await onAddToAnki(card); }}
        />
      )}
    </>
  );
}

// ── Single question block ──
function QBlock({
  qKey, num, qText, choices, qType, sideImageUrl, selectedIdx, correctIdx, submitted, onPick, explainData, onAddToAnki,
}: {
  qKey: string; num: number; qText: string; choices: string[]; qType: string;
  sideImageUrl: string; selectedIdx: number | undefined; correctIdx: number | undefined;
  submitted: boolean; onPick: (key: string, idx: number) => void;
  explainData?: SubQuestion | Record<string, unknown>;
  onAddToAnki?: (card: AnkiCardInput) => Promise<void>;
}) {
  const sogoMc = qType === "bjt_1_3" || qType === "bjt_2_3";
  const nums = choices.length <= 3 ? NUMS.slice(0, 3) : NUMS;
  const hasSideImg = !!sideImageUrl;

  return (
    <div className={`q-block${hasSideImg ? " q-block-has-side-img" : ""}${sogoMc ? " q-bjt-sogo-mc" : ""}${submitted ? " exam-submitted" : ""}`} id={`qb-${qKey}`}>
      <div className="q-question-row">
        <div className="q-num">{num}.</div>
        {qText && (
          <span className="q-text" dangerouslySetInnerHTML={{ __html: renderQText(qText, qType) }} />
        )}
      </div>
      {hasSideImg ? (
        <div className="q-side-img-row">
          <div className="q-side-img-cell">
            <Image src={sideImageUrl} alt="" className="q-side-img" width={400} height={300} style={{ objectFit: "contain" }} />
          </div>
          <div className="q-side-main-cell">
            <div className="choices">
              {choices.map((c, i) => (
                <MemoChoiceBtn key={i} qKey={qKey} idx={i} text={c} nums={nums} qType={qType}
                  sogoMc={sogoMc} selectedIdx={selectedIdx} correctIdx={correctIdx} submitted={submitted} onPick={onPick} />
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="choices">
          {choices.map((c, i) => (
            <MemoChoiceBtn key={i} qKey={qKey} idx={i} text={c} nums={nums} qType={qType}
              sogoMc={sogoMc} selectedIdx={selectedIdx} correctIdx={correctIdx} submitted={submitted} onPick={onPick} />
          ))}
        </div>
      )}
      {submitted && explainData && (
        <ExplainPanel qKey={qKey} data={explainData} onAddToAnki={onAddToAnki} />
      )}
    </div>
  );
}
function sameChoices(a: string[], b: string[]) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
const MemoQBlock = memo(QBlock, (prev, next) =>
  prev.qKey === next.qKey &&
  prev.num === next.num &&
  prev.qText === next.qText &&
  prev.qType === next.qType &&
  prev.sideImageUrl === next.sideImageUrl &&
  prev.selectedIdx === next.selectedIdx &&
  prev.correctIdx === next.correctIdx &&
  prev.submitted === next.submitted &&
  prev.explainData === next.explainData &&
  sameChoices(prev.choices, next.choices)
);

const PASSAGE_NOTE_RE = /^[\s　]*([（(]注(?:[0-9０-９一二三四五六七八九十]+)?[)）])([\s　:：、.．。-ー]?.*)$/;

function splitPassageNotes(text: string): {
  body: string;
  notes: { marker: string; text: string }[];
} {
  const lines = String(text).replace(/\r\n?/g, "\n").split("\n");
  const bodyLines: string[] = [];
  const notes: { marker: string; text: string }[] = [];
  let inNotes = false;

  lines.forEach((line) => {
    const match = line.match(PASSAGE_NOTE_RE);
    if (match) {
      inNotes = true;
      notes.push({
        marker: match[1],
        text: (match[2] ?? "").replace(/^[\s　:：、.．。-ー]+/, ""),
      });
      return;
    }

    if (inNotes) {
      if (!line.trim()) return;
      const last = notes[notes.length - 1];
      if (last) last.text = `${last.text}${last.text ? "\n" : ""}${line.trim()}`;
      return;
    }

    bodyLines.push(line);
  });

  return {
    body: bodyLines.join("\n").trimEnd(),
    notes,
  };
}

function getPassageDensity(text: string): "short" | "medium" | "long" | "dense" {
  const plain = String(text)
    .replace(/<[^>]+>/g, "")
    .replace(/[ \t\r\n　]/g, "");
  const lineCount = String(text).replace(/\r\n?/g, "\n").split("\n").filter((line) => line.trim()).length;
  const score = plain.length + Math.max(0, lineCount - 4) * 28;

  if (score <= 260) return "short";
  if (score <= 560) return "medium";
  if (score <= 900) return "long";
  return "dense";
}

const PassageBlock = memo(function PassageBlock({
  text,
}: {
  text: string;
}) {
  const { body, notes } = splitPassageNotes(text);
  const density = getPassageDensity(body || text);

  return (
    <div
      className={`q-block q-passage-block passage-density-${density}`}
    >
      {body && <div className="passage-card-body" dangerouslySetInnerHTML={{ __html: renderRich(body) }} />}
      {notes.length > 0 && (
        <div className="passage-note-box">
          <div className="passage-note-lines">
            {notes.map((note, idx) => (
              <div className="passage-note-line" key={`${note.marker}-${idx}`}>
                <span className="passage-note-marker">{note.marker}</span>
                <span className="passage-note-text" dangerouslySetInnerHTML={{ __html: renderRich(note.text) }} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

// Side-by-side layout: passage on the left, questions on the right.
// Stacks vertically on screens narrower than the breakpoint (see globals.css).
// align-items:stretch in CSS keeps both boxes the same height (matching
// whichever side is taller) — no scroll, no JS measurement needed.
//
// `equalWidth` switches the row to 50/50 columns. Used for mondai 7
// (bunsho / 文章の文法) where the passage is set the same width as the
// stacked sub-question cards.
function PassageSplit({
  left,
  right,
  equalWidth = false,
}: {
  left: React.ReactNode;
  right: React.ReactNode;
  equalWidth?: boolean;
}) {
  return (
    <div className={`passage-split${equalWidth ? " passage-split-equal" : ""}`}>
      <div className="passage-split-left">{left}</div>
      <div className="passage-split-right">{right}</div>
    </div>
  );
}

// ── Read pre-shuffled choices from a sub-question ──
// Server has already shuffled and stripped `correct`/`wrongs` — we just read.
function getChoices(sq: { choices?: string[] } | null | undefined): string[] {
  return (sq?.choices ?? []).filter(Boolean);
}

// ── Reading content ──
function ReadingContent({
  questions, answers, answerKey, keyTypeMap, submitted, onPick, onAddToAnki,
}: Pick<ExamContentProps, "questions" | "answers" | "answerKey" | "keyTypeMap" | "submitted" | "onPick" | "onAddToAnki">) {
  if (!questions.length) {
    return <div style={{ padding: 40, textAlign: "center", color: "var(--muted2)" }}>Không có câu đọc hiểu.</div>;
  }

  // Compute mondai numbering dynamically
  const seenTypes: string[] = [];
  questions.forEach((q) => {
    const t = String(q.type ?? "");
    if (!seenTypes.includes(t)) seenTypes.push(t);
  });
  const mondaiMap: Record<string, number> = {};
  seenTypes.forEach((t, i) => { mondaiMap[t] = i + 1; });

  let qNum = 1;
  let lastType: string | null = null;
  // Counts how many passage-bearing rows (PassageSplit blocks) we've already
  // rendered in the *current* mondai. Used to insert a divider before the
  // 2nd, 3rd, … passage so multi-passage mondai (e.g. mondai 9 N1 / tan with
  // 4 short passages, mondai 10 / chu, etc.) read clearly.
  let passageRowsInMondai = 0;
  const elems: React.ReactNode[] = [];

  elems.push(<div key="section-header" className="section-header">📖 Phần Đọc hiểu &amp; Từ vựng</div>);

  // Helper: push a divider before the next passage row (after the first).
  const pushPassageDivider = (key: string) => {
    if (passageRowsInMondai > 0) {
      elems.push(<hr key={key} className="passage-divider passage-divider-row" />);
    }
  };

  questions.forEach((q) => {
    const id   = String(q.id ?? "");
    const type = String(q.type ?? "");

    if (type !== lastType) {
      elems.push(
        <div key={`mh-${type}`} dangerouslySetInnerHTML={{ __html: buildMondaiHeader(mondaiMap[type] ?? 1, type) }} />
      );
      lastType = type;
      passageRowsInMondai = 0;
    }

    const passagesRaw = q.passages as PassageGroup[] | string[] | undefined;
    const passage     = q.passage as string | undefined;
    const subQs       = q.questions as SubQuestion[] | undefined;

    // togo (統合理解) compact shape: passages = [textA, textB] + shared
    // top-level `questions`. Composer + CSV import both produce this shape.
    const isTogoCompact =
      type === "togo" &&
      Array.isArray(passagesRaw) &&
      passagesRaw.length > 0 &&
      passagesRaw.every((p) => typeof p === "string");

    if (isTogoCompact) {
      const passageStrs = passagesRaw as string[];
      const sharedQs    = subQs ?? [];
      const left: React.ReactNode[] = [];
      let renderedPassageCount = 0;
      passageStrs.forEach((text, pIdx) => {
        if (text) {
          if (renderedPassageCount > 0) {
            left.push(<hr key={`${id}-div-${pIdx}`} className="passage-divider" />);
          }
          const label = pIdx === 0 ? "A." : pIdx === 1 ? "B." : `${String.fromCharCode(65 + pIdx)}.`;
          left.push(
            <div
              key={`${id}-pl-${pIdx}`}
              style={{
                fontFamily: "'Noto Sans JP', sans-serif",
                fontSize: 16, fontWeight: 800, color: "var(--text)",
                marginTop: pIdx === 0 ? 0 : 14, marginBottom: 6,
              }}
            >
              {label}
            </div>
          );
          left.push(<PassageBlock key={`${id}-pt-${pIdx}`} text={text} />);
          renderedPassageCount++;
        }
      });
      const right: React.ReactNode[] = sharedQs.map((sq, i) => {
        const key = `${id}-q-${i}`;
        const choices = getChoices(sq);
        return (
          <MemoQBlock key={key} qKey={key} num={qNum++} qText={sq.question ?? ""}
            choices={choices} qType={type} sideImageUrl={getSubImageUrl(sq as Record<string,unknown>)}
            selectedIdx={answers[key]} correctIdx={answerKey[key]} submitted={submitted} onPick={onPick}
            explainData={sq} onAddToAnki={onAddToAnki} />
        );
      });
      pushPassageDivider(`${id}-pre-div`);
      elems.push(<PassageSplit key={`${id}-split`} left={left} right={right} />);
      passageRowsInMondai++;
      return;
    }

    const passages = passagesRaw as PassageGroup[] | undefined;

    if (passages && passages.length) {
      // tan/chu/cho/shudai/joho with passages array
      passages.forEach((p, pIdx) => {
        const right: React.ReactNode[] = (p.questions ?? []).map((sq, qIdx) => {
          const key = `${id}-${pIdx}-${qIdx}`;
          const choices = getChoices(sq);
          return (
            <MemoQBlock key={key} qKey={key} num={qNum++} qText={sq.question ?? ""}
              choices={choices} qType={type} sideImageUrl={getSubImageUrl(sq as Record<string,unknown>)}
              selectedIdx={answers[key]} correctIdx={answerKey[key]} submitted={submitted} onPick={onPick}
              explainData={sq} onAddToAnki={onAddToAnki} />
          );
        });
        if (p.text) {
          pushPassageDivider(`${id}-passages-div-${pIdx}`);
          elems.push(
            <PassageSplit
              key={`${id}-split-${pIdx}`}
              left={<PassageBlock key={`${id}-pt-${pIdx}`} text={p.text} />}
              right={right}
            />
          );
          passageRowsInMondai++;
        } else {
          // No passage → just stack questions full width
          right.forEach((node) => elems.push(node));
        }
      });

    } else if (passage && subQs) {
      // bunsho: single passage + questions array
      const right: React.ReactNode[] = subQs.map((sq, i) => {
        const key = `${id}-b-${i}`;
        const choices = getChoices(sq);
        return (
          <MemoQBlock key={key} qKey={key} num={qNum++} qText={sq.question ?? ""}
            choices={choices} qType={type} sideImageUrl={getSubImageUrl(sq as Record<string,unknown>)}
            selectedIdx={answers[key]} correctIdx={answerKey[key]} submitted={submitted} onPick={onPick}
            explainData={sq} />
        );
      });
      pushPassageDivider(`${id}-bunsho-div`);
      elems.push(
        <PassageSplit
          key={`${id}-bunsho-split`}
          left={<PassageBlock key={`${id}-passage`} text={passage} />}
          right={right}
          equalWidth
        />
      );
      passageRowsInMondai++;

    } else {
      // Simple single question
      const choices: string[] =
        (q as { choices?: string[] }).choices ??
        (type === "bjt_1_3" || type === "bjt_2_3" ? ["1", "2", "3", "4"] : []);
      const stem = String(q.question ?? (q as Record<string,unknown>).mainQuestion ?? (q as Record<string,unknown>).sentence ?? "");
      const sideImg = getSubImageUrl(q);
      const qBlock = (
        <MemoQBlock key={id} qKey={id} num={qNum++} qText={stem}
          choices={choices} qType={type} sideImageUrl={sideImg}
          selectedIdx={answers[id]} correctIdx={answerKey[id]} submitted={submitted} onPick={onPick}
          explainData={q as Record<string, unknown>} onAddToAnki={onAddToAnki} />
      );
      const passageStr = (q as Record<string, unknown>).passage;
      if (passageStr && typeof passageStr === "string") {
        pushPassageDivider(`${id}-simple-div`);
        elems.push(
          <PassageSplit
            key={`${id}-simple-split`}
            left={<PassageBlock key={`${id}-p`} text={passageStr} />}
            right={[qBlock]}
          />
        );
        passageRowsInMondai++;
      } else {
        elems.push(qBlock);
      }
    }
  });

  return <>{elems}</>;
}

// ── Listening content ──
function ListeningContent({
  questions, answers, answerKey, keyTypeMap, submitted, onPick, audioUrl, level, onAddToAnki,
}: Pick<ExamContentProps, "questions" | "answers" | "answerKey" | "keyTypeMap" | "submitted" | "onPick" | "audioUrl" | "onAddToAnki"> & { level?: string }) {
  if (!questions.length) {
    return <div style={{ padding: 40, textAlign: "center", color: "var(--muted2)" }}>Không có câu nghe hiểu.</div>;
  }

  let qNum = 1;
  const elems: React.ReactNode[] = [];

  elems.push(<div key="section-header" className="section-header">🎧 Phần Nghe hiểu</div>);

  if (audioUrl) {
    const safeSrc = encodeAudioUrl(audioUrl);
    console.log("[listen] rendering audio bar", { rawAudioUrl: audioUrl, safeSrc });
    elems.push(
      <div
        key="audio-bar"
        className="audio-bar"
        onClick={(e) => console.log("[listen] audio-bar div clicked", { target: (e.target as HTMLElement).tagName })}
      >
        <audio
          key={safeSrc}
          controls
          src={safeSrc}
          id="listen-audio"
          onPlay={() => console.log("[listen] audio PLAY event")}
          onPause={() => console.log("[listen] audio PAUSE event")}
          onLoadStart={() => console.log("[listen] audio loadstart")}
          onClick={() => console.log("[listen] <audio> element clicked directly")}
        />
      </div>
    );
  } else {
    console.warn("[listen] no audioUrl — listening section will render without audio bar");
  }

  // Compute mondai numbering for listening types in first-appearance order.
  const seenTypes: string[] = [];
  questions.forEach((q) => {
    const t = String(q.type ?? "");
    if (!seenTypes.includes(t)) seenTypes.push(t);
  });
  const mondaiMap: Record<string, number> = {};
  seenTypes.forEach((t, i) => { mondaiMap[t] = i + 1; });
  let lastType: string | null = null;

  questions.forEach((q) => {
    const id   = String(q.id ?? "");
    const type = String(q.type ?? "");

    if (type !== lastType) {
      elems.push(
        <div key={`mh-${type}`} dangerouslySetInnerHTML={{ __html: buildMondaiHeader(mondaiMap[type] ?? 1, type) }} />
      );
      lastType = type;
    }

    if (type === "listen_togo") {
      const t1 = q.type1 as SubQuestion | undefined;
      const t2 = q.type2 as { mainQuestion?: string; questions?: SubQuestion[] } | undefined;
      if (t1) {
        if (t1.mainQuestion) {
          elems.push(
            <div key={`${id}-t1-mq`} style={{ padding: "10px 14px", background: "var(--surface)", borderRadius: 8, marginBottom: 10, fontSize: 13 }}
              dangerouslySetInnerHTML={{ __html: t1.mainQuestion }} />
          );
        }
        const key = `${id}-t1`;
        const choices = getChoices(t1);
        elems.push(
          <MemoQBlock key={key} qKey={key} num={qNum++} qText=""
            choices={choices} qType={type} sideImageUrl={getSubImageUrl(t1 as Record<string,unknown>)}
            selectedIdx={answers[key]} correctIdx={answerKey[key]} submitted={submitted} onPick={onPick}
            explainData={t1} onAddToAnki={onAddToAnki} />
        );
      }
      if (t2) {
        if (t2.mainQuestion) {
          elems.push(
            <div key={`${id}-t2-mq`} style={{ padding: "10px 14px", background: "var(--surface)", borderRadius: 8, marginBottom: 10, fontSize: 13 }}
              dangerouslySetInnerHTML={{ __html: t2.mainQuestion }} />
          );
        }
        (t2.questions ?? []).forEach((sq, i) => {
          const key = `${id}-t2-${i}`;
          const choices = getChoices(sq);
          elems.push(
            <MemoQBlock key={key} qKey={key} num={qNum++} qText=""
              choices={choices} qType={type} sideImageUrl={getSubImageUrl(sq as Record<string,unknown>)}
              selectedIdx={answers[key]} correctIdx={answerKey[key]} submitted={submitted} onPick={onPick}
              explainData={sq} onAddToAnki={onAddToAnki} />
          );
        });
      }
    } else {
      // listen_kadai, listen_point, listen_gaiyou, listen_sokuji
      const subQs = (q.questions as SubQuestion[]) ?? [];
      subQs.forEach((sq, i) => {
        const key = `${id}-${i}`;
        const choices = getChoices(sq);
        const nums = choices.length <= 3 ? NUMS.slice(0, 3) : NUMS;
        elems.push(
          <MemoQBlock key={key} qKey={key} num={qNum++} qText={sq.question ?? ""}
            choices={choices} qType={type} sideImageUrl={getSubImageUrl(sq as Record<string,unknown>)}
            selectedIdx={answers[key]} correctIdx={answerKey[key]} submitted={submitted} onPick={onPick}
            explainData={sq} onAddToAnki={onAddToAnki} />
        );
      });
    }
  });

  return <>{elems}</>;
}

// ── Main ExamContent ──
export default function ExamContent({
  questions, answers, answerKey, keyTypeMap, submitted, onPick, audioUrl, phase, onAddToAnki,
}: ExamContentProps) {
  const readQs = useMemo(
    () => questions.filter((q) => !String(q.type ?? "").startsWith("listen")),
    [questions],
  );
  const listenQs = useMemo(
    () => questions.filter((q) => String(q.type ?? "").startsWith("listen")),
    [questions],
  );

  if (phase === "listen") {
    return (
      <ListeningContent questions={listenQs} answers={answers} answerKey={answerKey}
        keyTypeMap={keyTypeMap} submitted={submitted} onPick={onPick} audioUrl={audioUrl} onAddToAnki={onAddToAnki} />
    );
  }
  return (
    <ReadingContent questions={readQs} answers={answers} answerKey={answerKey}
      keyTypeMap={keyTypeMap} submitted={submitted} onPick={onPick} onAddToAnki={onAddToAnki} />
  );
}

const TYPE_SHORT_LABEL: Record<string, string> = {
  kanji:          '漢字の読み方',
  bunmyaku:       '文脈規定',
  hyouki:         '表記',
  iikae:          '言い換え',
  yoho:           '用法',
  bunpo1:         '文の文法１',
  bunpo2:         '文の文法２',
  bunsho:         '文章の文法',
  tan:            '短文読解',
  chu:            '中文読解',
  cho:            '長文読解',
  togo:           '統合理解',
  shudai:         '主題把握',
  joho:           '情報検索',
  listen_kadai:   '課題理解',
  listen_point:   'ポイント理解',
  listen_gaiyou:  '概要理解',
  listen_hatsuwa: '発話表現',
  listen_sokuji:  '即時応答',
  listen_togo:    '統合的聴解',
  bjt_1_1: 'セクション１', bjt_1_2: 'セクション２', bjt_1_3: 'セクション３',
  bjt_2_1: 'セクション１', bjt_2_2: 'セクション２', bjt_2_3: 'セクション３',
  bjt_3_1: 'セクション１', bjt_3_2: 'セクション２', bjt_3_3: 'セクション３',
};

// ── Sidebar Q-grid ──
export function QGrid({
  answerKey, keyTypeMap, answers, submitted, phase,
}: {
  answerKey: Record<string, number>;
  keyTypeMap: Record<string, string>;
  answers: Record<string, number>;
  submitted: boolean;
  phase?: "read" | "listen" | "idle" | "ready" | "break" | "done";
}) {
  const keys = Object.keys(answerKey);
  if (!keys.length) return null;

  // Filter keys by current phase. During the read phase only show reading
  // mondai; during the listen phase only show listening mondai. Other phases
  // (break / done / review) show everything so users can review.
  const filteredKeys = keys.filter((k) => {
    const t = keyTypeMap[k] ?? "";
    const isListen = t.startsWith("listen");
    if (phase === "read")   return !isListen;
    if (phase === "listen") return  isListen;
    return true;
  });
  if (!filteredKeys.length) return null;

  // Group by type, preserving first-appearance order. Counter is local to the
  // filtered set so listen mondai are renumbered from 1 in the listen phase.
  const groups: { type: string; keys: string[]; startIdx: number }[] = [];
  const byType: Record<string, string[]> = {};
  let counter = 0;
  filteredKeys.forEach((k) => {
    const t = keyTypeMap[k] ?? "__other";
    if (!byType[t]) {
      byType[t] = [];
      groups.push({ type: t, keys: byType[t], startIdx: counter });
    }
    byType[t].push(k);
    counter++;
  });

  const hasRead   = groups.some(g => !g.type.startsWith("listen"));
  const firstListenIdx = groups.findIndex(g => g.type.startsWith("listen"));

  return (
    <>
      {groups.map(({ type, keys: gKeys, startIdx }, gi) => {
        const showSep = hasRead && gi === firstListenIdx;
        const shortName = TYPE_SHORT_LABEL[type] ?? "";
        const numPart = type === "__other" ? "問題" : `問題${gi + 1}`;
        return (
          <div key={type}>
            {showSep && <div className="q-phase-sep" />}
            <div className="q-mondai-group">
              <div className="q-mondai-title">
                {numPart}：
                {shortName && <span style={{ marginLeft: 3 }}>{shortName}</span>}
              </div>
              <div className="q-grid">
                {gKeys.map((k, i) => {
                  const answered = answers[k] !== undefined;
                  const correct  = submitted && answers[k] === answerKey[k];
                  const wrong    = submitted && answered && answers[k] !== answerKey[k];
                  const skip     = submitted && !answered;
                  const cls = ["q-dot",
                    correct ? "dot-correct" : wrong ? "dot-wrong" : skip ? "dot-skip" : answered ? "answered" : "",
                  ].filter(Boolean).join(" ");
                  return (
                    <div key={k} className={cls}
                      onClick={() => document.getElementById(`qb-${k}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}>
                      {startIdx + i + 1}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}

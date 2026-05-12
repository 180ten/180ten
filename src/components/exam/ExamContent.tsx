"use client";
import { memo, useMemo, useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import {
  renderQText, renderChoiceText,
  sanitizeHtml, sanitizedRenderRich, sanitizedRenderRichInline,
  buildMondaiHeader, buildBjtSectionHeader, bjtPartLabel,
} from "@/lib/furigana";
import { getSubImageUrl, type SubQuestion, type PassageGroup } from "@/lib/examRender";
import { getFixedHeaderText } from "@/app/ad/compose/composeConstants";
import {
  stripVocabTags, extractTaggedWords, extractVocabSegments,
  lookupVocab, lookupVocabBulk, prefetchVocab,
  type VocabEntry, type VocabSegment,
} from "@/lib/vocabTag";
import { sb } from "@/lib/supabase";

const NUMS = ["1", "2", "3", "4"];

// ── Structured vocab-tag renderer ────────────────────────────────────────
// Splits text into [text | vocab] segments. Each segment is React-rendered
// in its own <span>, and the inner HTML for each segment passes through a
// caller-supplied render function whose output MUST already be sanitised.
//
// Why structured: React auto-escapes the data-word attribute, so there's
// no chance of the manual-string-builder fallback letting a stray quote
// sneak in. Outer container styling is controlled by the parent.
function VocabSegments({
  text, renderText, renderVocab,
}: {
  text: string;
  /** Render function for plain text segments. The output is re-sanitised
   *  inside this component, so callers don't HAVE to sanitise themselves —
   *  but they may (sanitising twice is a no-op besides cost). */
  renderText: (s: string) => string;
  /** Render function for inner content of vocab segments. Defaults to
   *  `renderText` when not given. Same sanitise-twice contract. */
  renderVocab?: (s: string) => string;
}) {
  const renderV = renderVocab ?? renderText;
  const segs: VocabSegment[] = extractVocabSegments(text);
  return (
    <>
      {segs.map((seg, i) =>
        seg.type === "vocab"
          ? <span key={i} className="vocab-tag" data-word={seg.word}
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(renderV(seg.display)) }} />
          : <span key={i}
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(renderText(seg.value)) }} />
      )}
    </>
  );
}

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

// ── Auto-vocab box (review mode) ──────────────────────────────────────
// For each question in review mode, scans the surrounding text (passage +
// question stem) for 【...】 tags, bulk-fetches the matching vocabulary_library
// rows in ONE query (`.in('word', words)`), and renders a grid card per word.

// Vocab-tag short meaning: text before " - " trimmed, capped at `max` chars
// with ellipsis. Distinct from the file-level shortMeaning() (parseMeaning).
function shortMeaningForCard(meaning: string, max = 40): string {
  const cut = meaning.split(" - ")[0].trim();
  return cut.length > max ? cut.slice(0, max) + "…" : cut;
}

// DB format: "Công ty - ① Công ty pháp nhân... ② Tập thể / nhóm người..."
// Splits at the first " - " into shortM (gloss) and fullM (detail), then
// sub-splits fullM on ①②③… markers if present.
// (Distinct name from the file-level parseMeaning() used by ChipPopup.)
function parseTagMeaning(meaning: string): { shortM: string; fullM: string; numbered: string[] } {
  const dashIdx = meaning.indexOf(" - ");
  const shortM = dashIdx >= 0 ? meaning.slice(0, dashIdx).trim() : meaning.trim();
  const fullM  = dashIdx >= 0 ? meaning.slice(dashIdx + 3).trim() : "";
  const numbered = fullM
    ? fullM.split(/(?=[①②③④⑤⑥⑦⑧⑨⑩])/).map((s) => s.trim()).filter(Boolean)
    : [];
  return { shortM, fullM, numbered };
}

function parseExampleStrs(examples: unknown): string[] {
  const arr = Array.isArray(examples) ? examples : [];
  return arr.map((e) => {
    if (typeof e === "string") return e;
    if (e && typeof e === "object") {
      const o = e as { jp?: string; vi?: string };
      return o.vi ? `${o.jp ?? ""} → ${o.vi}` : (o.jp ?? "");
    }
    return "";
  }).filter(Boolean);
}

function AutoVocabBox({
  words, onAddToAnki,
}: {
  words: string[];
  onAddToAnki?: (card: AnkiCardInput) => Promise<void>;
}) {
  const [entryMap, setEntryMap] = useState<Map<string, VocabEntry> | null>(null);

  // Stable cache key — order doesn't matter, but de-dup happens upstream
  const stable = words.join("|");

  useEffect(() => {
    if (words.length === 0) { setEntryMap(new Map()); return; }
    let cancelled = false;
    void lookupVocabBulk(words, sb).then((map) => {
      if (!cancelled) setEntryMap(map);
    });
    return () => { cancelled = true; };
  }, [stable]); // eslint-disable-line react-hooks/exhaustive-deps

  if (words.length === 0) return null;

  // Dedupe + preserve first-occurrence order
  const seen: Set<string> = new Set();
  const uniq: string[] = [];
  for (const w of words) {
    const k = w.trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    uniq.push(k);
  }

  // Each pill carries `vocab-tag` so the document-level click delegation in
  // ExamContent opens the same VocabTagPopup as inline tags. The "+" button
  // stops propagation so it triggers Anki-add without opening the popup.
  return (
    <div className="av-pill-wrap">
      {uniq.map((word) => {
        const entry = entryMap?.get(word);
        const cut   = entry?.meaning ? shortMeaningForCard(entry.meaning, 20) : "";
        return (
          <span key={word} className="vocab-tag av-pill" data-word={word}>
            <span className="av-pill-word">{word}</span>
            {entry?.meaning && (
              <>
                <span className="av-pill-sep">：</span>
                <span className="av-pill-meaning">{cut}</span>
              </>
            )}
            {onAddToAnki && (
              <button
                type="button"
                className="av-pill-add"
                title="Thêm vào Anki"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  void onAddToAnki(entry ? {
                    word:      entry.word,
                    reading:   entry.reading ?? "",
                    meaning:   entry.meaning ?? "",
                    word_type: entry.word_type ?? undefined,
                  } : { word, reading: "", meaning: "" });
                }}
              >＋</button>
            )}
          </span>
        );
      })}
    </div>
  );
}

// ── Vocab-tag popup (review mode 【...】) ──────────────────────────────
// Reads from the 3-layer cache in lib/vocabTag (session → localStorage → DB).
// Click opens; hover prefetches; click outside closes (handled by the parent).

// Position is computed at CLICK time from the trigger's
// getBoundingClientRect (viewport coords) — never adds scrollX/scrollY since
// position:fixed is viewport-relative, not document-relative.

function VocabTagPopup({
  word, popupStyle, showAbove, onClose, onAddToAnki,
}: {
  word: string;
  popupStyle: React.CSSProperties;
  showAbove: boolean;
  onClose: () => void;
  onAddToAnki?: (card: AnkiCardInput) => Promise<void>;
}) {
  const [entry, setEntry] = useState<VocabEntry | null | undefined>(undefined);
  const [addState, setAddState] = useState<"idle" | "loading" | "done">("idle");
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setEntry(undefined);
    setAddState("idle");
    setExpanded(false);
    void lookupVocab(word, sb).then((e) => { if (!cancelled) setEntry(e); });
    return () => { cancelled = true; };
  }, [word]);

  async function handleAdd(e: React.MouseEvent) {
    e.stopPropagation();
    if (!entry || !onAddToAnki || addState !== "idle") return;
    setAddState("loading");
    try {
      await onAddToAnki({
        word:      entry.word,
        reading:   entry.reading ?? "",
        meaning:   entry.meaning ?? "",
        word_type: entry.word_type ?? undefined,
      });
    } catch { /* noop */ }
    setAddState("done");
    setTimeout(() => { setAddState("idle"); onClose(); }, 1500);
  }

  const meaning  = entry?.meaning ?? "";
  const { shortM, fullM, numbered } = parseTagMeaning(meaning);
  const examples = parseExampleStrs(entry?.examples);
  const hasMore  = !!fullM || examples.length > 0;

  return createPortal(
    <div
      className={`vocab-tag-popup ${showAbove ? "above" : "below"}`}
      style={popupStyle}
      onClick={(e) => e.stopPropagation()}
    >
      <button className="cp-close" onClick={onClose} aria-label="Đóng">×</button>
      <div className="cp-header">
        <span className="cp-word">{entry?.word ?? word}</span>
        {entry?.word_type && <span className="cp-type-badge">{entry.word_type}</span>}
      </div>
      {(entry?.reading || entry?.han_viet) && (
        <div className="cp-sub">
          {entry?.reading && <span className="cp-reading">{entry.reading}</span>}
          {entry?.reading && entry?.han_viet && <span className="cp-sub-sep">|</span>}
          {entry?.han_viet && <span className="cp-hanviet">{entry.han_viet}</span>}
        </div>
      )}
      {entry === undefined && <div style={{ fontSize: 13, color: "var(--muted2)" }}>Đang tải...</div>}
      {entry === null && <div style={{ fontSize: 13, color: "var(--muted2)" }}>Chưa có trong từ điển.</div>}
      {entry && (
        <>
          {shortM && <div className="cp-divider" />}
          {shortM && <div className="cp-short">{shortM}</div>}
          {expanded && fullM && (
            numbered.length > 1
              ? <div className="cp-numbered">
                  {numbered.map((line, i) => (
                    <div key={i} className="cp-numbered-item">{line}</div>
                  ))}
                </div>
              : <div className="cp-full">{fullM}</div>
          )}
          {expanded && examples.length > 0 && (
            <div className="cp-examples">
              {examples.map((ex, i) => (
                <div key={i} className="cp-example-line">{ex}</div>
              ))}
            </div>
          )}
          {(hasMore || onAddToAnki) && (
            <div className="cp-footer">
              {hasMore ? (
                <button type="button" className="cp-expand-btn" onClick={() => setExpanded((v) => !v)}>
                  {expanded ? "Rút gọn" : "Xem thêm"} <span aria-hidden>{expanded ? "∧" : "∨"}</span>
                </button>
              ) : <span aria-hidden />}
              {onAddToAnki ? (
                <button
                  type="button"
                  className={`cp-anki-btn${addState === "done" ? " added" : ""}`}
                  disabled={addState === "loading"}
                  onClick={handleAdd}
                >
                  {addState === "done" ? "✓ Đã thêm" : addState === "loading" ? "..." : "＋ Thêm vào Anki"}
                </button>
              ) : <span aria-hidden />}
            </div>
          )}
        </>
      )}
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
        ? <span className="choice-media" dangerouslySetInnerHTML={{ __html: sanitizeHtml(text) }} />
        : (
          <>
            <span className="choice-num">{nums[idx] ?? `${idx + 1}`}</span>
            <span className="choice-label" dangerouslySetInnerHTML={{ __html: sanitizeHtml(renderChoiceText(text, qType)) }} />
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
  qKey, data, onAddToAnki, taggedWords = [],
}: {
  qKey: string;
  data: SubQuestion | Record<string, unknown>;
  onAddToAnki?: (card: AnkiCardInput) => Promise<void>;
  /** Words extracted from 【】 in passage + question stem (review mode). */
  taggedWords?: string[];
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
                ? <div style={{ whiteSpace: "pre-wrap" }} dangerouslySetInnerHTML={{ __html: sanitizeHtml(expl) }} />
                : <span className="explain-empty">Chưa có nội dung.</span>
            )}
            {tab === 1 && (
              (vocabItems.length > 0 || taggedWords.length > 0)
                ? <>
                    {vocabItems.length > 0 && (
                      <div style={{ lineHeight: 2.2 }}>
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
                    )}
                    {taggedWords.length > 0 && (
                      <AutoVocabBox words={taggedWords} onAddToAnki={onAddToAnki} />
                    )}
                  </>
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
  passageText,
}: {
  qKey: string; num: number; qText: string; choices: string[]; qType: string;
  sideImageUrl: string; selectedIdx: number | undefined; correctIdx: number | undefined;
  submitted: boolean; onPick: (key: string, idx: number) => void;
  explainData?: SubQuestion | Record<string, unknown>;
  onAddToAnki?: (card: AnkiCardInput) => Promise<void>;
  /** Text of the parent passage (if any), used to derive auto-vocab in review. */
  passageText?: string;
}) {
  const sogoMc = qType === "bjt_1_3" || qType === "bjt_2_3";
  const nums = choices.length <= 3 ? NUMS.slice(0, 3) : NUMS;
  const hasSideImg = !!sideImageUrl;

  // Tagged words for the auto-vocab grid (review mode only). Combines parent
  // passage + this sub-question's stem so each card surfaces its full context.
  const taggedWords = useMemo(() => {
    if (!submitted) return [] as string[];
    const combined = `${passageText ?? ""}\n${qText ?? ""}`;
    const all = extractTaggedWords(combined);
    // Preserve order but de-dupe
    const seen = new Set<string>();
    const out: string[] = [];
    for (const w of all) {
      const k = w.trim();
      if (!k || seen.has(k)) continue;
      seen.add(k); out.push(k);
    }
    return out;
  }, [submitted, passageText, qText]);

  // qText render: review mode → structured segments (each text span gets the
  // qType-specific renderer; vocab span gets renderRichInline). Exam mode →
  // strip 【】 then renderQText then sanitise as one string.
  const renderQTextSafe = (s: string) => sanitizeHtml(renderQText(s, qType));

  return (
    <div className={`q-block${hasSideImg ? " q-block-has-side-img" : ""}${sogoMc ? " q-bjt-sogo-mc" : ""}${submitted ? " exam-submitted" : ""}`} id={`qb-${qKey}`}>
      <div className="q-question-row">
        <div className="q-num">{num}.</div>
        {qText && (
          submitted
            ? <span className="q-text">
                <VocabSegments
                  text={qText}
                  renderText={renderQTextSafe}
                  renderVocab={renderQTextSafe}
                />
              </span>
            : <span className="q-text" dangerouslySetInnerHTML={{ __html: renderQTextSafe(stripVocabTags(qText)) }} />
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
        <ExplainPanel qKey={qKey} data={explainData} onAddToAnki={onAddToAnki} taggedWords={taggedWords} />
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
  prev.passageText === next.passageText &&
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
  applyTags = false,
  viTranslation,
}: {
  text: string;
  applyTags?: boolean;
  /** Vietnamese translation for this passage. Only renders the toggle
   *  button in review mode (applyTags=true) AND when this is non-empty. */
  viTranslation?: string;
}) {
  const { body, notes } = splitPassageNotes(text);
  const density = getPassageDensity(body || text);
  const [showVi, setShowVi] = useState(false);
  const hasTranslation = applyTags && !!viTranslation && viTranslation.trim().length > 0;

  // applyTags=true (review): React-render structured segments inside an
  // inner <div> that mimics renderRich's wrapper (so .passage-card-body > div
  // CSS selectors keep matching). Inner segment HTML uses *Inline* renderer
  // to avoid nested wrappers.
  // applyTags=false (exam): strip 【】 entirely, then renderRich + sanitise.
  const renderBody = (s: string) =>
    applyTags ? null : (
      <div dangerouslySetInnerHTML={{ __html: sanitizedRenderRich(stripVocabTags(s)) }} />
    );

  return (
    <div
      className={`q-block q-passage-block passage-density-${density}`}
      style={{ position: "relative" }}
    >
      {hasTranslation && (
        <button
          type="button"
          className={`passage-translate-btn${showVi ? " active" : ""}`}
          onClick={() => setShowVi((v) => !v)}
          title={showVi ? "Quay lại tiếng Nhật" : "Xem bản dịch tiếng Việt"}
          aria-pressed={showVi}
          aria-label={showVi ? "Hiện bản gốc tiếng Nhật" : "Hiện bản dịch tiếng Việt"}
        >
          <img src="/svg/translate.svg" alt="" width={18} height={18} aria-hidden />
        </button>
      )}
      {showVi && hasTranslation ? (
        <div className="passage-card-body">
          <div style={{ fontSize: 16, lineHeight: 1.9, color: "#1a1917", whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontFamily: "'Be Vietnam Pro','Noto Sans JP',sans-serif" }}>
            {viTranslation}
          </div>
        </div>
      ) : (
        <>
          {body && (
            <div className="passage-card-body">
              {applyTags ? (
                <div style={{ fontSize: 16, lineHeight: 2, color: "#1a1917", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                  <VocabSegments text={body} renderText={sanitizedRenderRichInline} />
                </div>
              ) : (
                renderBody(body)
              )}
            </div>
          )}
          {notes.length > 0 && (
            <div className="passage-note-box">
              <div className="passage-note-lines">
                {notes.map((note, idx) => (
                  <div className="passage-note-line" key={`${note.marker}-${idx}`}>
                    <span className="passage-note-marker">{note.marker}</span>
                    <span className="passage-note-text">
                      {applyTags ? (
                        <div style={{ fontSize: 16, lineHeight: 2, color: "#1a1917", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                          <VocabSegments text={note.text} renderText={sanitizedRenderRichInline} />
                        </div>
                      ) : (
                        renderBody(note.text)
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
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
        <div key={`mh-${type}`} dangerouslySetInnerHTML={{ __html: sanitizeHtml(buildMondaiHeader(mondaiMap[type] ?? 1, type)) }} />
      );
      lastType = type;
      passageRowsInMondai = 0;
    }

    const passagesRaw = q.passages as PassageGroup[] | string[] | undefined;
    const passage     = q.passage as string | undefined;
    const subQs       = q.questions as SubQuestion[] | undefined;
    // Vietnamese translations for the row's passages, indexed by passage
    // position. JSONB column on questions; null/missing = no translation.
    const viTrans     = (q as { vi_translation?: unknown }).vi_translation;
    const viList: string[] = Array.isArray(viTrans)
      ? (viTrans as unknown[]).map((s) => (typeof s === "string" ? s : ""))
      : [];

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
          left.push(<PassageBlock key={`${id}-pt-${pIdx}`} text={text} applyTags={submitted} viTranslation={viList[pIdx]} />);
          renderedPassageCount++;
        }
      });
      const togoPassageText = passageStrs.filter(Boolean).join("\n");
      const right: React.ReactNode[] = sharedQs.map((sq, i) => {
        const key = `${id}-q-${i}`;
        const choices = getChoices(sq);
        return (
          <MemoQBlock key={key} qKey={key} num={qNum++} qText={sq.question ?? ""}
            choices={choices} qType={type} sideImageUrl={getSubImageUrl(sq as Record<string,unknown>)}
            selectedIdx={answers[key]} correctIdx={answerKey[key]} submitted={submitted} onPick={onPick}
            explainData={sq} onAddToAnki={onAddToAnki} passageText={togoPassageText} />
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
              explainData={sq} onAddToAnki={onAddToAnki} passageText={p.text ?? ""} />
          );
        });
        if (p.text) {
          pushPassageDivider(`${id}-passages-div-${pIdx}`);
          elems.push(
            <PassageSplit
              key={`${id}-split-${pIdx}`}
              left={<PassageBlock key={`${id}-pt-${pIdx}`} text={p.text} applyTags={submitted} viTranslation={viList[pIdx]} />}
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
            explainData={sq} onAddToAnki={onAddToAnki} passageText={passage} />
        );
      });
      pushPassageDivider(`${id}-bunsho-div`);
      elems.push(
        <PassageSplit
          key={`${id}-bunsho-split`}
          left={<PassageBlock key={`${id}-passage`} text={passage} applyTags={submitted} viTranslation={viList[0]} />}
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
      const passageStr = (q as Record<string, unknown>).passage;
      const passageStrText = typeof passageStr === "string" ? passageStr : "";
      const qBlock = (
        <MemoQBlock key={id} qKey={id} num={qNum++} qText={stem}
          choices={choices} qType={type} sideImageUrl={sideImg}
          selectedIdx={answers[id]} correctIdx={answerKey[id]} submitted={submitted} onPick={onPick}
          explainData={q as Record<string, unknown>} onAddToAnki={onAddToAnki} passageText={passageStrText} />
      );
      if (passageStr && typeof passageStr === "string") {
        pushPassageDivider(`${id}-simple-div`);
        elems.push(
          <PassageSplit
            key={`${id}-simple-split`}
            left={<PassageBlock key={`${id}-p`} text={passageStr} applyTags={submitted} viTranslation={viList[0]} />}
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

  // Resolve exam level from prop or first question, used to look up the
  // level-specific fixed-header text saved in admin compose.
  const examLevel = level || String(questions[0]?.level ?? "");

  let lastType: string | null = null;

  questions.forEach((q) => {
    const id   = String(q.id ?? "");
    const type = String(q.type ?? "");

    if (type !== lastType) {
      const headerText = getFixedHeaderText(type, q as Record<string, string>, examLevel);
      if (headerText) {
        elems.push(
          <div
            key={`mh-${type}`}
            style={{
              background: "#fef3ef",
              border: "1px solid #fde0d3",
              borderRadius: 12,
              padding: "12px 18px",
              margin: "18px 0 10px",
              fontSize: 16,
              lineHeight: 1.8,
              fontWeight: 700,
              color: "#1a1917",
              whiteSpace: "pre-wrap",
            }}
          >
            {headerText}
          </div>
        );
      }
      lastType = type;
    }

    if (type === "listen_togo") {
      const t1 = q.type1 as SubQuestion | undefined;
      const t2 = q.type2 as { mainQuestion?: string; questions?: SubQuestion[] } | undefined;
      if (t1) {
        if (t1.mainQuestion) {
          elems.push(
            <div key={`${id}-t1-mq`} style={{ padding: "10px 14px", background: "var(--surface)", borderRadius: 8, marginBottom: 10, fontSize: 13 }}>
              {submitted
                ? <VocabSegments text={t1.mainQuestion} renderText={sanitizeHtml} renderVocab={sanitizedRenderRichInline} />
                : <span dangerouslySetInnerHTML={{ __html: sanitizeHtml(stripVocabTags(t1.mainQuestion)) }} />}
            </div>
          );
        }
        const key = `${id}-t1`;
        const choices = getChoices(t1);
        elems.push(
          <MemoQBlock key={key} qKey={key} num={qNum++} qText=""
            choices={choices} qType={type} sideImageUrl={getSubImageUrl(t1 as Record<string,unknown>)}
            selectedIdx={answers[key]} correctIdx={answerKey[key]} submitted={submitted} onPick={onPick}
            explainData={t1} onAddToAnki={onAddToAnki} passageText={t1.mainQuestion ?? ""} />
        );
      }
      if (t2) {
        if (t2.mainQuestion) {
          elems.push(
            <div key={`${id}-t2-mq`} style={{ padding: "10px 14px", background: "var(--surface)", borderRadius: 8, marginBottom: 10, fontSize: 13 }}>
              {submitted
                ? <VocabSegments text={t2.mainQuestion} renderText={sanitizeHtml} renderVocab={sanitizedRenderRichInline} />
                : <span dangerouslySetInnerHTML={{ __html: sanitizeHtml(stripVocabTags(t2.mainQuestion)) }} />}
            </div>
          );
        }
        const t2Main = t2.mainQuestion ?? "";
        (t2.questions ?? []).forEach((sq, i) => {
          const key = `${id}-t2-${i}`;
          const choices = getChoices(sq);
          elems.push(
            <MemoQBlock key={key} qKey={key} num={qNum++} qText=""
              choices={choices} qType={type} sideImageUrl={getSubImageUrl(sq as Record<string,unknown>)}
              selectedIdx={answers[key]} correctIdx={answerKey[key]} submitted={submitted} onPick={onPick}
              explainData={sq} onAddToAnki={onAddToAnki} passageText={t2Main} />
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

  // ── Vocab-tag popup state + delegated handlers ────────────────────────
  // Active only in review mode. Click on .vocab-tag opens popup; hover
  // prefetches into the cache layer so the click feel instant. Mobile
  // (touch-only devices) skips hover and goes click-direct.
  const [vocabPopup, setVocabPopup] = useState<{
    word: string;
    popupStyle: React.CSSProperties;
    showAbove: boolean;
    key: number;
  } | null>(null);

  useEffect(() => {
    if (!submitted) { setVocabPopup(null); return; }
    const isTouch = typeof window !== "undefined" && ("ontouchstart" in window || (navigator as { maxTouchPoints?: number }).maxTouchPoints! > 0);

    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      // Click inside the popup itself → ignore (popup handles its own clicks)
      if (target.closest?.(".vocab-tag-popup")) return;
      const tag = target.closest?.("[data-word]") as HTMLElement | null;
      if (!tag) { setVocabPopup(null); return; }
      const word = tag.getAttribute("data-word") || "";
      if (!word) return;

      // Position from getBoundingClientRect (viewport-relative).
      // position:fixed is viewport-relative, so do NOT add scrollX/scrollY.
      const rect = tag.getBoundingClientRect();
      const popupW = 240;
      const popupH = 200; // estimated for flip decision
      const spaceBelow = window.innerHeight - rect.bottom;
      const showAbove = spaceBelow < popupH && rect.top > popupH;

      let left = rect.left;
      if (left + popupW > window.innerWidth - 8) left = window.innerWidth - popupW - 8;
      if (left < 8) left = 8;

      const top = showAbove
        ? rect.top - popupH - 8
        : rect.bottom + 8;

      const popupStyle: React.CSSProperties = {
        position: "fixed",
        top,
        left,
        zIndex: 9999,
      };

      // Diagnostic log — share these values if popup positions wrong.
      // Suspicious values: rect.* all 0 → trigger detached/hidden;
      //                    final left/top tiny while rect.left/top large → CSS override.
      console.log("[vocab-popup] click", {
        word,
        rect: { top: rect.top, left: rect.left, bottom: rect.bottom, right: rect.right, w: rect.width, h: rect.height },
        win: { w: window.innerWidth, h: window.innerHeight, scrollY: window.scrollY, scrollX: window.scrollX },
        showAbove,
        popupStyle,
        tagTagName: tag.tagName,
        tagClass: tag.className,
      });

      setVocabPopup({ word, popupStyle, showAbove, key: Date.now() });
    };

    const onMouseOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.closest?.("[data-word]") as HTMLElement | null;
      if (!tag) return;
      const word = tag.getAttribute("data-word") || "";
      if (word) prefetchVocab(word, sb);
    };

    document.addEventListener("click", onClick);
    if (!isTouch) document.addEventListener("mouseover", onMouseOver);
    return () => {
      document.removeEventListener("click", onClick);
      if (!isTouch) document.removeEventListener("mouseover", onMouseOver);
    };
  }, [submitted]);

  console.log("[ExamContent] render", {
    phase,
    submitted,
    totalQs: questions.length,
    readQsLen: readQs.length,
    listenQsLen: listenQs.length,
    sampleListenType: listenQs[0] ? String((listenQs[0] as Record<string, unknown>).type ?? "") : null,
  });

  const popupNode = vocabPopup && (
    <VocabTagPopup
      key={vocabPopup.key}
      word={vocabPopup.word}
      popupStyle={vocabPopup.popupStyle}
      showAbove={vocabPopup.showAbove}
      onClose={() => setVocabPopup(null)}
      onAddToAnki={onAddToAnki}
    />
  );

  if (phase === "listen") {
    return (
      <>
        <ListeningContent questions={listenQs} answers={answers} answerKey={answerKey}
          keyTypeMap={keyTypeMap} submitted={submitted} onPick={onPick} audioUrl={audioUrl} onAddToAnki={onAddToAnki} />
        {popupNode}
      </>
    );
  }
  // Review mode: after submit, render reading + listening stacked so users
  // can review every answer in one scroll. During the active read phase only
  // reading is shown.
  if (submitted && listenQs.length > 0) {
    console.log("[ExamContent] review mode → rendering reading + listening");
    return (
      <>
        <ReadingContent questions={readQs} answers={answers} answerKey={answerKey}
          keyTypeMap={keyTypeMap} submitted={submitted} onPick={onPick} onAddToAnki={onAddToAnki} />
        <ListeningContent questions={listenQs} answers={answers} answerKey={answerKey}
          keyTypeMap={keyTypeMap} submitted={submitted} onPick={onPick} audioUrl={audioUrl} onAddToAnki={onAddToAnki} />
        {popupNode}
      </>
    );
  }
  return (
    <>
      <ReadingContent questions={readQs} answers={answers} answerKey={answerKey}
        keyTypeMap={keyTypeMap} submitted={submitted} onPick={onPick} onAddToAnki={onAddToAnki} />
      {popupNode}
    </>
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

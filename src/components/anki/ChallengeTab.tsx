"use client";
// src/components/anki/ChallengeTab.tsx
//
// Anki "⚔️ Challenge" mode — typed-recall quiz over a user's deck.
//
// Flow: select-deck → select-type → playing → result
//   - Type 1: meaning (vi) → type the Japanese word
//   - Type 2: kanji → type the furigana (reading)
//   - Type 3: kanji → type the Han-Viet (only kanji words with han_viet)
//   - Type 4: mixed (each card randomly assigned 1/2/3, falls back to 1
//     if a card lacks the data needed for the assigned type)
//
// State is component-local — nothing persisted (a session is a session).

import { useEffect, useMemo, useRef, useState } from "react";
import type { AnkiDeck, SrsEntry } from "@/hooks/useAnki";

type ChallengeMode = "select-deck" | "select-type" | "playing" | "result";
type ChallengeType = 1 | 2 | 3 | 4;
type FixedType = 1 | 2 | 3;
type ChallengeScope = "learned" | "all" | "custom";

interface ChallengeCard {
  vocab_id: string;     // stable key — falls back to word + idx if vocab_id missing
  word: string;
  reading: string;
  meaning: string;
  han_viet: string;
}

interface SessionCard {
  card: ChallengeCard;
  /** Resolved type for this card after the Type 4 assignment + fallback. */
  type: FixedType;
}

interface SessionResult {
  card: ChallengeCard;
  type: FixedType;
  correct: boolean;
  attempts: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────

const HAS_KANJI = /[一-鿿]/;

function isKanjiWord(word: string): boolean {
  return HAS_KANJI.test(word);
}

function checkAnswer(input: string, expected: string): boolean {
  const normalize = (s: string) =>
    s.trim().toLowerCase()
     .replace(/\s+/g, "")
     .replace(/[・･]/g, "");
  return normalize(input) === normalize(expected);
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Deck.cards is JSON without id; produce stable, normalised challenge cards
 *  and drop entries that miss any required Type-1 fields (word, meaning). */
function deckToChallengeCards(deck: AnkiDeck): ChallengeCard[] {
  return deck.cards
    .map((c, idx) => ({
      vocab_id: String(c.vocab_id ?? `${deck.id}-${idx}`),
      word:     String(c.word ?? "").trim(),
      reading:  String(c.reading ?? "").trim(),
      meaning:  String(c.meaning ?? "").trim(),
      han_viet: String(c.han_viet ?? "").trim(),
    }))
    .filter((c) => c.word && c.meaning);
}

/** Build session for a fixed type. Type 3 filters out cards without kanji
 *  or without han_viet. */
function buildFixedSession(cards: ChallengeCard[], type: FixedType): SessionCard[] {
  let pool = cards;
  if (type === 3) {
    pool = cards.filter((c) => isKanjiWord(c.word) && c.han_viet.length > 0);
  }
  if (type === 2) {
    pool = cards.filter((c) => c.reading.length > 0);
  }
  return shuffle(pool).map((card) => ({ card, type }));
}

/** Type 4 assignment — even split across 1/2/3. Cards assigned to type 3
 *  that aren't valid for it (no kanji or no han_viet) fall back to type 1. */
function buildMixedSession(cards: ChallengeCard[]): SessionCard[] {
  const shuffled = shuffle(cards);
  const total = shuffled.length;
  const base = Math.floor(total / 3);
  const rem  = total % 3;
  const c1 = base + (rem >= 1 ? 1 : 0);
  const c2 = base + (rem >= 2 ? 1 : 0);
  const c3 = base;

  const out: SessionCard[] = [];
  let i = 0;
  for (let k = 0; k < c1; k++) out.push({ card: shuffled[i++], type: 1 });
  for (let k = 0; k < c2; k++) {
    const card = shuffled[i++];
    out.push({ card, type: card.reading ? 2 : 1 });
  }
  for (let k = 0; k < c3; k++) {
    const card = shuffled[i++];
    const valid3 = isKanjiWord(card.word) && card.han_viet.length > 0;
    out.push({ card, type: valid3 ? 3 : 1 });
  }
  return shuffle(out);
}

/** Type-1 only shows the short meaning — text before the first
 *  " - " / " – " / " — " separator. Falls back to the full string
 *  when there's no separator. */
function shortMeaning(meaning: string): string {
  const m = meaning.match(/^(.*?)\s+[-–—]\s+/);
  return m ? m[1].trim() : meaning;
}

function getQuestion(card: ChallengeCard, type: FixedType): { question: string; answer: string; placeholder: string; lang?: string } {
  switch (type) {
    case 1: return { question: `「${shortMeaning(card.meaning)}」tiếng Nhật là gì?`, answer: card.word,    placeholder: "Gõ chữ Nhật...", lang: "ja" };
    case 2: return { question: `「${card.word}」đọc như thế nào?`,                   answer: card.reading, placeholder: "Gõ furigana...", lang: "ja" };
    case 3: return { question: `「${card.word}」có âm Hán Việt là gì?`,              answer: card.han_viet, placeholder: "Gõ Hán Việt..." };
  }
}

// ── Component ───────────────────────────────────────────────────────────

interface Props {
  decks: AnkiDeck[];
  /** SRS progress map keyed by `${deckId}_${cardIdx}` — used to filter
   *  the "Từ đã học" scope. */
  progress: Record<string, SrsEntry>;
  isLoggedIn: boolean;
}

export default function ChallengeTab({ decks, progress, isLoggedIn }: Props) {
  const [mode, setMode]               = useState<ChallengeMode>("select-deck");
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null);
  const [selectedType, setSelectedType]     = useState<ChallengeType>(1);
  const [scope, setScope]                   = useState<ChallengeScope>("all");
  const [customCount, setCustomCount]       = useState<number>(20);
  const [sessionCards, setSessionCards]     = useState<SessionCard[]>([]);
  const [currentIndex, setCurrentIndex]     = useState(0);
  const [userInput, setUserInput]           = useState("");
  const [attempts, setAttempts]             = useState(0);
  const [lastResult, setLastResult]         = useState<"correct" | "wrong" | null>(null);
  const [showAnswer, setShowAnswer]         = useState(false);
  const [results, setResults]               = useState<SessionResult[]>([]);
  const [emptyMsg, setEmptyMsg]             = useState<string | null>(null);
  const inputRef                            = useRef<HTMLInputElement>(null);

  const selectedDeck = useMemo(
    () => decks.find((d) => d.id === selectedDeckId) ?? null,
    [decks, selectedDeckId],
  );

  // Pre-compute card count + learned-count per deck for the deck list
  // and the scope picker on the select-type screen.
  const deckSummaries = useMemo(() => decks.map((d) => {
    const cards = deckToChallengeCards(d);
    let learned = 0;
    for (let i = 0; i < d.cards.length; i++) {
      if (progress[`${d.id}_${i}`] != null) learned++;
    }
    return { id: d.id, name: d.name, total: cards.length, learned };
  }), [decks, progress]);

  const selectedSummary = useMemo(
    () => deckSummaries.find((s) => s.id === selectedDeckId) ?? null,
    [deckSummaries, selectedDeckId],
  );

  function pickDeck(deckId: string) {
    setSelectedDeckId(deckId);
    setEmptyMsg(null);
    setMode("select-type");
  }

  function startSession(type: ChallengeType) {
    if (!selectedDeck) return;

    // Apply the scope filter at the source — keep the original index so we
    // can look up SRS progress for "Từ đã học". deckToChallengeCards drops
    // cards missing word/meaning, but it doesn't preserve the original
    // index, so we inline the same logic here.
    const allCards: { card: ChallengeCard; idx: number }[] = selectedDeck.cards
      .map((c, idx) => ({
        idx,
        card: {
          vocab_id: String(c.vocab_id ?? `${selectedDeck.id}-${idx}`),
          word:     String(c.word ?? "").trim(),
          reading:  String(c.reading ?? "").trim(),
          meaning:  String(c.meaning ?? "").trim(),
          han_viet: String(c.han_viet ?? "").trim(),
        },
      }))
      .filter(({ card }) => card.word && card.meaning);

    const scoped = scope === "learned"
      ? allCards.filter(({ idx }) => progress[`${selectedDeck.id}_${idx}`] != null)
      : allCards;
    const cards = scoped.map((x) => x.card);

    if (cards.length === 0) {
      setEmptyMsg(
        scope === "learned"
          ? "Bộ thẻ này chưa có từ nào đã học."
          : "Bộ thẻ này không có thẻ nào hợp lệ để luyện.",
      );
      return;
    }

    let session: SessionCard[] = type === 4
      ? buildMixedSession(cards)
      : buildFixedSession(cards, type);

    if (scope === "custom") {
      const n = Math.max(1, Math.min(customCount || 1, session.length));
      session = session.slice(0, n);
    }

    if (session.length === 0) {
      setEmptyMsg(
        type === 3 ? "Không có từ Hán Việt nào trong phạm vi đã chọn."
        : type === 2 ? "Không có từ nào có cách đọc trong phạm vi đã chọn."
        : "Không có thẻ hợp lệ trong phạm vi đã chọn.",
      );
      return;
    }
    setSelectedType(type);
    setSessionCards(session);
    setCurrentIndex(0);
    setUserInput("");
    setAttempts(0);
    setLastResult(null);
    setShowAnswer(false);
    setResults([]);
    setEmptyMsg(null);
    setMode("playing");
  }

  function handleSubmit() {
    if (!sessionCards[currentIndex]) return;
    if (lastResult === "correct" || showAnswer) return;
    const cur = sessionCards[currentIndex];
    const { answer } = getQuestion(cur.card, cur.type);
    const ok = checkAnswer(userInput, answer);
    setAttempts(attempts + 1);
    setLastResult(ok ? "correct" : "wrong");
  }

  function handleNext() {
    const cur = sessionCards[currentIndex];
    if (!cur) return;
    const finalCorrect = lastResult === "correct";
    setResults((prev) => [
      ...prev,
      { card: cur.card, type: cur.type, correct: finalCorrect, attempts },
    ]);

    if (currentIndex + 1 >= sessionCards.length) {
      setMode("result");
      return;
    }
    setCurrentIndex((i) => i + 1);
    setUserInput("");
    setAttempts(0);
    setLastResult(null);
    setShowAnswer(false);
  }

  function restartSameDeck() {
    if (!selectedDeck) { setMode("select-deck"); return; }
    startSession(selectedType);
  }

  function backToSelect() {
    setMode("select-deck");
    setSelectedDeckId(null);
    setSessionCards([]);
    setResults([]);
    setEmptyMsg(null);
  }

  // Auto-focus the input on every new card so the user can keep typing
  // without clicking. autoFocus only fires on the initial mount; the
  // input element is re-used across cards, so we have to focus manually.
  useEffect(() => {
    if (mode !== "playing") return;
    const el = inputRef.current;
    if (el && !el.disabled) el.focus();
  }, [mode, currentIndex]);

  // After "✅ Đúng rồi!" appears the input is disabled, so a second Enter
  // would do nothing. Listen at the window level and advance to the next
  // card. The listener is only attached while in the "ready to advance"
  // state.
  //
  // Important: the same keydown that submitted the correct answer can
  // bubble to window AND auto-repeat if the user holds Enter even briefly.
  // We require a keyup before the next keydown counts so a single
  // sustained press never advances by itself.
  useEffect(() => {
    if (mode !== "playing") return;
    if (lastResult !== "correct") return;
    let armed = false;
    function onKeyUp(e: KeyboardEvent) {
      if (e.key === "Enter") armed = true;
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Enter" && armed && !e.repeat) {
        e.preventDefault();
        handleNext();
      }
    }
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("keydown", onKeyDown);
    };
    // handleNext is stable enough — re-binding on every relevant state
    // change is cheap and avoids the stale-closure trap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, lastResult, currentIndex, sessionCards.length]);

  // ── Render ───────────────────────────────────────────────────────────

  if (!isLoggedIn) {
    return (
      <div style={{ textAlign: "center", padding: 48, color: "var(--muted)" }}>
        Đăng nhập để dùng tính năng Challenge.
      </div>
    );
  }

  if (mode === "select-deck") {
    return (
      <div style={{ padding: "8px 4px 32px" }}>
        <h2 style={{ fontSize: 18, fontWeight: 800, marginBottom: 12, color: "var(--text)" }}>Chọn bộ thẻ để Challenge</h2>
        {deckSummaries.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", border: "1px dashed var(--border)", borderRadius: 12 }}>
            Bạn chưa có bộ thẻ nào. Tạo deck từ tab Flashcard SRS trước.
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
            {deckSummaries.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => pickDeck(d.id)}
                disabled={d.total === 0}
                style={{
                  padding: 16, borderRadius: 12, border: "1.5px solid var(--border)", background: "var(--white)",
                  textAlign: "left", cursor: d.total === 0 ? "not-allowed" : "pointer",
                  fontFamily: "'Be Vietnam Pro','Noto Sans JP',sans-serif",
                  opacity: d.total === 0 ? 0.5 : 1, transition: "all .15s",
                }}
                onMouseEnter={(e) => { if (d.total > 0) (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--accent)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border)"; }}
              >
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>{d.name}</div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>{d.total} thẻ</div>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (mode === "select-type") {
    const TYPES: {
      type: ChallengeType; icon: string; iconImg?: string; iconBg: string; iconColor: string;
      label: string; desc: string;
      exampleFrom: string; exampleArrow: string; exampleTo: string; exampleToColor: string; exampleToFont?: string;
      stat: string; statColor: string; duration: string;
      examplePreview?: "icons";
    }[] = [
      { type: 1, icon: "🪜", iconImg: "/challenge/dang1.png", iconBg: "#fff0e8", iconColor: "#f26419",
        label: "Dạng 1 – Recall tiếng Nhật", desc: "",
        exampleFrom: "Cầu thang", exampleArrow: "→", exampleTo: "階段", exampleToColor: "#f26419",
        exampleToFont: "'Noto Sans JP',sans-serif",
        stat: "Hiệu quả cao", statColor: "#f26419", duration: "5–7 phút" },
      { type: 2, icon: "📖", iconImg: "/challenge/dang2.png", iconBg: "#e3f2fd", iconColor: "#4a90d9",
        label: "Dạng 2 – Recall Furigana", desc: "",
        exampleFrom: "階段", exampleArrow: "→", exampleTo: "かいだん", exampleToColor: "#4a90d9",
        exampleToFont: "'Noto Sans JP',sans-serif",
        stat: "Hiệu quả cao", statColor: "#4a90d9", duration: "5–7 phút" },
      { type: 3, icon: "💬", iconImg: "/challenge/dang3.png", iconBg: "#e8f5e9", iconColor: "#16a34a",
        label: "Dạng 3 – Recall nghĩa", desc: "",
        exampleFrom: "階段", exampleArrow: "→", exampleTo: "Đoạn giai", exampleToColor: "#16a34a",
        stat: "Trung bình", statColor: "#6b6864", duration: "4–6 phút" },
      { type: 4, icon: "🔀", iconBg: "#f3e5f5", iconColor: "#9c5fd9",
        label: "Dạng 4 – Tất cả", desc: "",
        exampleFrom: "", exampleArrow: "", exampleTo: "", exampleToColor: "#9c5fd9",
        examplePreview: "icons",
        stat: "Thử thách", statColor: "#9c5fd9", duration: "8–10 phút" },
    ];

    return (
      <div style={{ padding: "0 4px 12px" }}>
        <button
          type="button" className="btn-ghost"
          onClick={() => { setMode("select-deck"); setEmptyMsg(null); }}
          style={{ padding: "4px 10px", fontSize: 13, marginBottom: 8 }}
        >← Đổi bộ thẻ</button>

        {/* Deck header — bullseye icon + name + subtitle */}
        <div className="challenge-deck-header">
          <div className="challenge-deck-icon">🎯</div>
          <div>
            <div className="challenge-deck-name">{selectedDeck?.name ?? "—"}</div>
            <div className="challenge-deck-sub">Chọn dạng luyện tập phù hợp với mục tiêu của bạn</div>
          </div>
        </div>

        {/* 4 type cards — click to preview, "Bắt đầu" to start */}
        <div className="challenge-type-grid">
          {TYPES.map((t) => {
            const isActive = selectedType === t.type;
            return (
              <button
                key={t.type} type="button"
                className={`challenge-type-card ${isActive ? "active" : ""}`}
                onClick={() => { setSelectedType(t.type); setEmptyMsg(null); }}
                aria-pressed={isActive}
              >
                {isActive && <span className="challenge-type-check">✓</span>}
                <div
                  className="challenge-type-icon-wrap"
                  style={{ background: t.iconBg, color: t.iconColor }}
                >
                  {t.iconImg
                    ? <img src={t.iconImg} alt="" width={42} height={42} style={{ display: "block", objectFit: "contain" }} />
                    : <span>{t.icon}</span>}
                </div>
                <div className="challenge-type-label">{t.label}</div>
                {t.desc && <div className="challenge-type-desc">{t.desc}</div>}

                <div className="challenge-example-box">
                  <div className="challenge-example-label">Ví dụ</div>
                  {t.examplePreview === "icons" ? (
                    <div className="challenge-example-icons">
                      <img src="/challenge/dang1.png" alt="" />
                      <span className="challenge-example-plus">+</span>
                      <img src="/challenge/dang2.png" alt="" />
                      <span className="challenge-example-plus">+</span>
                      <img src="/challenge/dang3.png" alt="" />
                    </div>
                  ) : (
                    <div className="challenge-example-row">
                      <span className="challenge-example-from">{t.exampleFrom}</span>
                      <span className="challenge-example-arrow">{t.exampleArrow}</span>
                      <span className="challenge-example-to" style={{ color: t.exampleToColor, fontFamily: t.exampleToFont }}>{t.exampleTo}</span>
                    </div>
                  )}
                </div>

                <div className="challenge-type-footer">
                  <span className="challenge-type-stat" style={{ color: t.statColor }}>📊 {t.stat}</span>
                  <span className="challenge-type-duration">⏱ {t.duration}</span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Scope picker — Từ đã học / Tất cả / Số lượng tự chọn. */}
        <div className="challenge-scope-grid">
          <button
            type="button"
            className={`challenge-scope-card ${scope === "learned" ? "active" : ""}`}
            onClick={() => setScope("learned")}
            disabled={(selectedSummary?.learned ?? 0) === 0}
            title={(selectedSummary?.learned ?? 0) === 0 ? "Chưa có từ đã học" : undefined}
          >
            <div className="challenge-scope-label">Từ đã học</div>
            <div className="challenge-scope-sub">
              {selectedSummary?.learned ?? 0} / {selectedSummary?.total ?? 0} thẻ
            </div>
          </button>
          <button
            type="button"
            className={`challenge-scope-card ${scope === "all" ? "active" : ""}`}
            onClick={() => setScope("all")}
          >
            <div className="challenge-scope-label">Tất cả</div>
            <div className="challenge-scope-sub">{selectedSummary?.total ?? 0} thẻ</div>
          </button>
          <div
            className={`challenge-scope-card ${scope === "custom" ? "active" : ""}`}
            onClick={() => setScope("custom")}
            role="button" tabIndex={0}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setScope("custom"); }}
          >
            <div className="challenge-scope-label">Số lượng tự chọn</div>
            <input
              type="number" min={1} max={selectedSummary?.total ?? undefined}
              className="challenge-scope-input"
              value={customCount}
              onClick={(e) => e.stopPropagation()}
              onFocus={() => setScope("custom")}
              onChange={(e) => {
                const v = Number(e.target.value);
                setCustomCount(Number.isFinite(v) && v > 0 ? Math.floor(v) : 1);
                setScope("custom");
              }}
            />
          </div>
        </div>

        {/* Centered start button (no attempts limit — user can keep
            trying until they tap "Xem đáp án"). */}
        <div style={{ display: "flex", justifyContent: "center", marginTop: 4 }}>
          <button
            type="button"
            className="challenge-start-btn"
            onClick={() => startSession(selectedType)}
          >
            Bắt đầu luyện tập <span aria-hidden>→</span>
          </button>
        </div>

        {emptyMsg && (
          <div style={{ marginTop: 10, padding: "10px 14px", border: "1px solid #fde047", background: "#fef9c3", borderRadius: 8, color: "#854d0e", fontSize: 13 }}>
            {emptyMsg}
          </div>
        )}
      </div>
    );
  }

  if (mode === "playing") {
    const cur = sessionCards[currentIndex];
    if (!cur) return null;
    const { question, answer, placeholder, lang } = getQuestion(cur.card, cur.type);
    return (
      <div style={{ padding: "8px 4px 32px" }}>
        <button type="button" className="btn-ghost" onClick={backToSelect} style={{ marginBottom: 16 }}>← Thoát</button>
        <div className="challenge-card">
          <div className="challenge-type-badge">Dạng {cur.type}</div>
          <div className="challenge-question">{question}</div>
          <input
            ref={inputRef}
            className={`challenge-input ${lastResult === "correct" ? "correct" : lastResult === "wrong" ? "wrong" : ""}`}
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !showAnswer && lastResult !== "correct") {
                handleSubmit();
              }
            }}
            placeholder={placeholder}
            lang={lang}
            autoFocus
            disabled={showAnswer || lastResult === "correct"}
          />

          {lastResult === "correct" && <div className="challenge-feedback correct">✅ Đúng rồi!</div>}
          {lastResult === "wrong" && (
            // key={attempts} re-mounts the node each wrong submit so the
            // shake animation re-plays from the 2nd wrong attempt onward.
            <div
              key={attempts}
              className={`challenge-feedback wrong${attempts >= 2 ? " shake" : ""}`}
            >❌ Sai, thử lại!</div>
          )}

          {showAnswer && (
            <div className="challenge-answer">Đáp án: <strong>{answer}</strong></div>
          )}

          <div className="challenge-actions">
            {!showAnswer && lastResult !== "correct" && (
              <button type="button" className="btn-accent" onClick={handleSubmit}>Kiểm tra</button>
            )}
            {!showAnswer && lastResult !== "correct" && attempts > 0 && (
              <button type="button" className="btn-ghost" onClick={() => setShowAnswer(true)}>👁 Xem đáp án</button>
            )}
            {(showAnswer || lastResult === "correct") && (
              <button type="button" className="btn-accent" onClick={handleNext}>
                {currentIndex + 1 >= sessionCards.length ? "Xem kết quả →" : "Tiếp tục →"}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // mode === "result"
  const correctList = results.filter((r) => r.correct);
  const wrongList   = results.filter((r) => !r.correct);
  return (
    <div className="challenge-result">
      <div className="challenge-result-score">{correctList.length} / {results.length}</div>
      <div className="challenge-result-label">câu đúng</div>

      <div className="challenge-result-breakdown">
        <div className="result-group">
          <div className="result-group-title">✅ Đúng ({correctList.length})</div>
          <div className="result-words">
            {correctList.length === 0
              ? <span style={{ fontSize: 13, color: "var(--muted)" }}>—</span>
              : correctList.map((r) => (
                <span key={r.card.vocab_id + ":" + r.type} className="result-word correct" title={`Dạng ${r.type}`}>{r.card.word}</span>
              ))}
          </div>
        </div>
        <div className="result-group">
          <div className="result-group-title">❌ Sai ({wrongList.length})</div>
          <div className="result-words">
            {wrongList.length === 0
              ? <span style={{ fontSize: 13, color: "var(--muted)" }}>—</span>
              : wrongList.map((r) => (
                <span key={r.card.vocab_id + ":" + r.type} className="result-word wrong" title={`Dạng ${r.type}`}>{r.card.word}</span>
              ))}
          </div>
        </div>
      </div>

      <div className="challenge-result-actions">
        <button type="button" className="btn-primary" onClick={restartSameDeck}>🔄 Thử lại</button>
        <button type="button" className="btn-ghost"   onClick={backToSelect}>← Chọn bộ thẻ khác</button>
      </div>
    </div>
  );
}

"use client";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from "react";

export interface AnkiCard {
  id: string;
  word: string;
  reading?: string;
  meaning?: string;
  meaning_jp?: string;
  han_viet?: string;
  word_type?: string;
  examples?: unknown[];
  interval?: number;
  due?: number;
  ef?: number;
  reps?: number;
  /** "grammar" → render layout ngữ pháp; thiếu/“vocab” → giữ layout cũ */
  kind?: "vocab" | "grammar";
}

export interface AnkiDeck {
  id: string;
  name: string;
  folderId?: string;
  isAdmin?: boolean;
  cards: AnkiCard[];
  dueCount?: number;
  newCount?: number;
}

export interface AnkiFolder {
  id: string;
  name: string;
  isAdmin?: boolean;
}

export interface AnkiStudyState {
  deck: AnkiDeck | null;
  cards: AnkiCard[];
  current: number;
  flipped: boolean;
  done: boolean;
  doneStats: { known: number; learning: number };
}

interface AnkiTabProps {
  isLoggedIn: boolean;
  isPremium: boolean;
  folders: AnkiFolder[];
  decks: AnkiDeck[];
  batchSize: number;
  studyState: AnkiStudyState | null;
  cardRef: React.RefObject<HTMLDivElement | null>;
  cardRateRef: React.RefObject<HTMLDivElement | null>;
  totalDone: number;
  onStartStudy: (deck: AnkiDeck) => void;
  onCloseStudy: () => void;
  onFlipCard: () => void;
  onRateCard: (rating: "yes" | "no") => void;
  onResetDeck: () => void;
  onSetBatchSize: (n: number) => void;
  onOpenCreateFolder: () => void;
  onOpenCreateDeck: () => void;
  onOpenDeckPreview: (deck: AnkiDeck) => void;
  onDeleteDeck: (id: string) => void;
  onDeleteFolder: (id: string) => void;
  onToggleSrsInfo: (e: React.MouseEvent) => void;
  srsInfoOpen: boolean;
  onOpenPremium: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseMeaningToRows(m: string): { short: string; rows: { num: string; text: string }[] } {
  if (!m) return { short: "", rows: [] };
  const circled = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];
  const firstCircleIdx = circled.reduce((min, c) => {
    const i = m.indexOf(c);
    return i >= 0 && i < min ? i : min;
  }, m.length);

  if (firstCircleIdx < m.length) {
    const dashIdx = m.indexOf(" - ");
    const short = (dashIdx >= 0 && dashIdx < firstCircleIdx)
      ? m.slice(0, dashIdx).trim()
      : m.slice(0, firstCircleIdx).trim();
    const rest = m.slice(firstCircleIdx);
    const parts = rest.split(/(?=[①②③④⑤⑥⑦⑧⑨⑩])/).map((p) => p.trim()).filter(Boolean);
    return {
      short,
      rows: parts.map((p) => {
        const num = circled.find((c) => p.startsWith(c)) ?? "";
        return { num, text: num ? p.slice(1).trim() : p };
      }),
    };
  }

  // No circled numbers — check for " - " separator
  const dashIdx = m.indexOf(" - ");
  if (dashIdx >= 0) {
    return {
      short: m.slice(0, dashIdx).trim(),
      rows: [{ num: "", text: m.slice(dashIdx + 3).trim() }],
    };
  }

  const lines = m.split("\n").filter(Boolean);
  return { short: lines[0] ?? m, rows: [] };
}

function parseExamples(examples: unknown): { jp: string; vi: string }[] {
  let arr: unknown[] = Array.isArray(examples) ? examples : [];
  if (typeof examples === "string") {
    try { arr = JSON.parse(examples); } catch { arr = (examples as string).split(/\n+/).filter(Boolean); }
  }
  return (Array.isArray(arr) ? arr : [])
    .map((e) => {
      if (typeof e === "string") {
        const s = e.trim();
        const ai = s.indexOf(" → ");
        if (ai !== -1) return { jp: s.slice(0, ai).trim(), vi: s.slice(ai + 3).trim() };
        const ai2 = s.indexOf("→");
        if (ai2 !== -1) return { jp: s.slice(0, ai2).trim(), vi: s.slice(ai2 + 1).trim() };
        return { jp: s, vi: "" };
      }
      if (typeof e === "object" && e !== null) {
        const ex = e as Record<string, unknown>;
        return { jp: String(ex.jp ?? ex.sentence ?? ""), vi: String(ex.vi ?? ex.meaning ?? "") };
      }
      return { jp: String(e), vi: "" };
    })
    .filter((e) => e.jp);
}

function parseFuriganaHtml(t: string): string {
  return t.replace(/\{\(([^)]*)\)\(([^)]*)\)\}/g, (_, kanji, reading) =>
    `<ruby>${kanji}<rt>${reading}</rt></ruby>`
  );
}

function Furi({ children }: { children: string }) {
  if (!children) return null;
  const html = parseFuriganaHtml(children);
  if (html === children) return <>{children}</>;
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

// ---------------------------------------------------------------------------
// CardBack sub-component
// ---------------------------------------------------------------------------

export interface CardBackHandle {
  toggleEx: () => void;
}

// ── Mặt sau thẻ NGỮ PHÁP ────────────────────────────────────────────────
// Layout theo mẫu user yêu cầu:
//   ┌──────────────────────┐
//   │   Tên ngữ pháp       │
//   │   (FURIGANA nếu có)  │
//   │                      │
//   │ NGHĨA: …             │
//   │ Cách chia: …         │
//   │                      │
//   │ VÍ DỤ:               │
//   │ Câu                  │
//   │ → Nghĩa              │
//   └──────────────────────┘
function GrammarCardBack({ card }: { card: AnkiCard }) {
  const meaningText = (card.meaning ?? "").trim();
  const conjText    = (card.meaning_jp ?? card.word_type ?? "").trim();
  const examples    = parseExamples(card.examples ?? []);

  const labelStyle: React.CSSProperties = {
    fontWeight: 800, color: "var(--accent)",
    fontSize: 13, letterSpacing: 0.3,
    textTransform: "uppercase", flexShrink: 0,
  };
  const rowStyle: React.CSSProperties = {
    padding: "10px 28px",
    display: "flex", gap: 10, alignItems: "flex-start", lineHeight: 1.55,
  };

  return (
    <div>
      {/* Header: tên ngữ pháp + furigana */}
      <div className="cb-header">
        <div className="cb-word"><Furi>{card.word || "—"}</Furi></div>
        {card.reading && <div className="cb-reading">{card.reading}</div>}
      </div>

      {/* NGHĨA */}
      {meaningText && (
        <div style={rowStyle}>
          <span style={labelStyle}>NGHĨA:</span>
          <div style={{ fontSize: 14, color: "var(--text)", flex: 1, minWidth: 0, wordBreak: "break-word" }}>
            <Furi>{meaningText}</Furi>
          </div>
        </div>
      )}

      {/* Cách chia */}
      {conjText && (
        <div style={rowStyle}>
          <span style={labelStyle}>Cách chia:</span>
          <div style={{ fontSize: 14, color: "var(--text)", flex: 1, minWidth: 0, wordBreak: "break-word" }}>
            <Furi>{conjText}</Furi>
          </div>
        </div>
      )}

      {/* VÍ DỤ */}
      {examples.length > 0 && (
        <div style={{ padding: "10px 28px 18px" }}>
          <div style={{ ...labelStyle, marginBottom: 8 }}>VÍ DỤ:</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {examples.map((ex, i) => (
              <div key={i} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <div className="cb-jp" style={{ fontSize: 14, color: "var(--text)" }}>
                  <Furi>{ex.jp}</Furi>
                </div>
                {ex.vi && (
                  <div className="cb-vi" style={{ fontSize: 13.5, color: "var(--muted)", paddingLeft: 4 }}>
                    → {ex.vi}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const ROWS_PREVIEW = 2;

const CardBack = forwardRef<CardBackHandle, { card: AnkiCard }>(function CardBack({ card }, ref) {
  const [showEx,     setShowEx]     = useState(false);
  const [showJp,     setShowJp]     = useState(false);
  const [showMoreVi, setShowMoreVi] = useState(false);
  const [showMoreJp, setShowMoreJp] = useState(false);

  useImperativeHandle(ref, () => ({
    toggleEx: () => setShowEx((s) => !s),
  }));

  // Thẻ ngữ pháp: layout riêng (NGHĨA / Cách chia / VÍ DỤ luôn hiện)
  // Thẻ từ vựng: rơi xuống nhánh cũ ở dưới, không đổi gì.
  if (card.kind === "grammar") {
    return <GrammarCardBack card={card} />;
  }

  const { short: viShort, rows: viRows } = parseMeaningToRows(card.meaning ?? "");

  const jpRows: { num: string; text: string }[] = card.meaning_jp
    ? (() => {
        const { rows } = parseMeaningToRows(card.meaning_jp);
        return rows.length > 0 ? rows : [{ num: "", text: card.meaning_jp }];
      })()
    : [];
  const hasJp = jpRows.length > 0;

  const examples = parseExamples(card.examples ?? []);

  function stopAndToggleEx(e: React.MouseEvent) {
    e.stopPropagation();
    setShowEx((s) => !s);
  }

  function stopAndToggleJp(e: React.MouseEvent) {
    e.stopPropagation();
    setShowJp((s) => !s);
  }

  const activePanelRows = showJp && hasJp ? jpRows : viRows;
  const showAllVi = showMoreVi || activePanelRows.length <= ROWS_PREVIEW;
  const visibleRows = showAllVi ? activePanelRows : activePanelRows.slice(0, ROWS_PREVIEW);
  const hasMore = activePanelRows.length > ROWS_PREVIEW;
  const headerMeaning = (showJp && hasJp) ? jpRows[0]?.text || viShort : viShort;

  return (
    <div className="acb-card">
      {/* ── Header (decorative) ── */}
      <div className="acb-header">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/images/sakuramoi.png" alt="" aria-hidden className="acb-deco-sakura" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/images/fuji.png" alt="" aria-hidden className="acb-deco-fuji" />
        <div className="acb-header-center">
          {card.reading && <div className="acb-reading">{card.reading}</div>}
          <div className="acb-word"><Furi>{card.word || "—"}</Furi></div>
          {card.han_viet && (
            <>
              <div className="acb-divider" />
              <div className="acb-hanviet">{card.han_viet}</div>
            </>
          )}
        </div>
      </div>

      {/* ── Content ── */}
      <div className="acb-content">
        {(viShort || activePanelRows.length > 0) && (
          <div className="acb-block">
            <div className="acb-block-head">
              <span className="acb-block-ico" aria-hidden>
                <Image src="/svg/mean.svg" alt="" aria-hidden width={14} height={14} />
              </span>
              <span className="acb-block-title"><Furi>{headerMeaning || (card.meaning ?? "")}</Furi></span>
              {hasJp && (
                <button
                  type="button"
                  className="acb-jp-toggle"
                  title="Đổi nghĩa Việt / Nhật"
                  onClick={stopAndToggleJp}
                  aria-label="Đổi nghĩa Việt / Nhật"
                >
                  <Image src="/svg/8933942.svg" alt="" aria-hidden width={12} height={12} />
                </button>
              )}
            </div>
            {visibleRows.length > 0 && (
              <div className="acb-block-divider" />
            )}
            {visibleRows.length > 0 && (
              <ul className="acb-sublist">
                {visibleRows.map((r, i) => {
                  const showNum = activePanelRows.length > 1;
                  return (
                    <li key={i} className={`acb-subitem${showNum ? "" : " no-num"}`}>
                      {showNum && <span className="acb-subnum">{r.num || String(i + 1)}</span>}
                      <span className="acb-subtext"><Furi>{r.text}</Furi></span>
                    </li>
                  );
                })}
              </ul>
            )}
            {hasMore && !showAllVi && (
              <button
                type="button"
                className="acb-more"
                onClick={(e) => { e.stopPropagation(); if (showJp && hasJp) setShowMoreJp(true); else setShowMoreVi(true); }}
              >
                Xem thêm ▾
              </button>
            )}
          </div>
        )}

        {examples.length > 0 && (
          <div className="acb-block acb-block-ex">
            <div className="acb-block-head" onClick={stopAndToggleEx} style={{ cursor: "pointer" }}>
              <span className="acb-block-ico" aria-hidden>
                <Image src="/svg/ex.svg" alt="" aria-hidden width={14} height={14} />
              </span>
              <span className="acb-block-title">Ví dụ</span>
              <span className="acb-ex-caret">{showEx ? "▴" : "▾"}</span>
            </div>
            {showEx && (
              <ul className="acb-exlist">
                {examples.slice(0, 3).map((ex, i) => (
                  <li key={i} className="acb-exitem">
                    <span className="acb-exdot" />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="acb-exjp"><Furi>{ex.jp}</Furi></div>
                      {ex.vi && <div className="acb-exvi">{ex.vi}</div>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// DeckRow sub-component
// ---------------------------------------------------------------------------

function DeckThumbnail({ level }: { level?: string }) {
  const lvl = level && /^N[1-5]$/.test(level) ? level : "—";
  return (
    <div className="deck-thumbnail">
      <span className="dt-jlpt">JLPT</span>
      <span className="dt-level">{lvl}</span>
    </div>
  );
}

/** Extract `N1`–`N5` from a string (deck or folder name). Returns null if absent. */
function extractJlptLevel(...sources: (string | undefined)[]): string | null {
  for (const s of sources) {
    const m = s ? s.match(/N[1-5]/i) : null;
    if (m) return m[0].toUpperCase();
  }
  return null;
}

function DeckRow({
  deck,
  folderName,
  onStart,
  onPreview,
  onDelete,
}: {
  deck: AnkiDeck;
  folderName?: string;
  onStart: (d: AnkiDeck) => void;
  onPreview: (d: AnkiDeck) => void;
  onDelete: (id: string) => void;
}) {
  const newCount = deck.newCount ?? 0;
  const dueCount = deck.dueCount ?? 0;
  const total = deck.cards.length;
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div
      className="deck-card-row"
      onClick={(e) => {
        if ((e.target as HTMLElement).closest(".deck-action")) return;
        onStart(deck);
      }}
    >
      <DeckThumbnail level={extractJlptLevel(deck.name, folderName) ?? undefined} />
      <div className="deck-card-body">
        <div className="deck-card-name">{deck.name}</div>
        <div className="deck-card-meta">Cập nhật: gần đây</div>
      </div>
      <div className="deck-card-actions">
        <button
          type="button"
          className="deck-action deck-search-btn"
          onClick={(e) => { e.stopPropagation(); onPreview(deck); }}
          title="Xem danh sách thẻ"
          aria-label="Xem danh sách thẻ"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#7a7870" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.35-4.35" strokeLinecap="round" />
          </svg>
        </button>
        <span className="srs-pill srs-pill-new">{newCount} mới</span>
        <span className="srs-pill srs-pill-review">{dueCount} ôn</span>
        <span className="srs-pill srs-pill-all">{total} tất cả</span>
        {!deck.isAdmin && (
          <div className="deck-action deck-menu-wrap">
            <button
              type="button"
              className="deck-menu-btn"
              onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }}
              aria-label="Tùy chọn"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="#9a9890">
                <circle cx="12" cy="5" r="1.7" />
                <circle cx="12" cy="12" r="1.7" />
                <circle cx="12" cy="19" r="1.7" />
              </svg>
            </button>
            {menuOpen && (
              <div className="deck-menu-pop" onClick={(e) => e.stopPropagation()}>
                <button type="button" onClick={() => { setMenuOpen(false); onDelete(deck.id); }}>Xoá bộ thẻ</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FolderRow sub-component
// ---------------------------------------------------------------------------

function FolderRow({
  folder,
  decks,
  onStart,
  onPreview,
  onDelete,
  onDeleteFolder,
}: {
  folder: AnkiFolder;
  decks: AnkiDeck[];
  onStart: (d: AnkiDeck) => void;
  onPreview: (d: AnkiDeck) => void;
  onDelete: (id: string) => void;
  onDeleteFolder: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="folder-section">
      <div
        className="folder-header"
        onClick={(e) => {
          if ((e.target as HTMLElement).closest(".folder-del-btn")) return;
          setOpen((o) => !o);
        }}
      >
        <div className="folder-icon-box">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="#e8502a" aria-hidden>
            <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
          </svg>
        </div>
        <span className="folder-name">{folder.name}</span>
        <span className="folder-count-pill">{decks.length} bộ thẻ</span>
        {!folder.isAdmin && (
          <button
            type="button"
            className="folder-del-btn"
            onClick={(e) => { e.stopPropagation(); onDeleteFolder(folder.id); }}
            title="Xoá thư mục"
            aria-label="Xoá thư mục"
          >
            ✕
          </button>
        )}
        <button type="button" className="folder-chevron" aria-label={open ? "Thu gọn" : "Mở rộng"}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9a9890" strokeWidth="2.5">
            {open
              ? <path d="M18 15l-6-6-6 6" strokeLinecap="round" strokeLinejoin="round" />
              : <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />}
          </svg>
        </button>
      </div>
      {open && (
        <div className="folder-body" id={`folder-content-${folder.id}`}>
          {decks.map((d) => (
            <DeckRow key={d.id} deck={d} folderName={folder.name} onStart={onStart} onPreview={onPreview} onDelete={onDelete} />
          ))}
          <div className="folder-dropzone">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#e8502a" strokeWidth="2.5">
              <path d="M12 5v14M5 12h14" strokeLinecap="round" />
            </svg>
            <span>Kéo bộ thẻ vào đây</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main AnkiTab component
// ---------------------------------------------------------------------------

export default function AnkiTab({
  isLoggedIn,
  isPremium,
  folders,
  decks,
  batchSize,
  studyState,
  cardRef,
  cardRateRef,
  totalDone,
  onStartStudy,
  onCloseStudy,
  onFlipCard,
  onRateCard,
  onResetDeck,
  onSetBatchSize,
  onOpenCreateFolder,
  onOpenCreateDeck,
  onOpenDeckPreview,
  onDeleteDeck,
  onDeleteFolder,
  onToggleSrsInfo,
  srsInfoOpen,
  onOpenPremium,
}: AnkiTabProps) {
  const router = useRouter();
  void isPremium;
  void onOpenPremium;
  const showLock = !isLoggedIn;
  const showContent = isLoggedIn;
  const inStudy = studyState?.deck != null && !studyState.done;
  const studyDone = studyState?.done === true;

  const batchOptions = [10, 20, 30, 0];
  const folderIds = new Set(folders.map((f) => f.id));
  const folderDecks = (folderId: string) => decks.filter((d) => d.folderId === folderId);
  const adminFolders = folders.filter((f) => f.isAdmin);
  const userFolders  = folders.filter((f) => !f.isAdmin);
  const isRootOrOrphan = (d: AnkiDeck) => !d.folderId || !folderIds.has(d.folderId);
  const adminRootDecks = decks.filter((d) => isRootOrOrphan(d) && d.isAdmin);
  const userRootDecks  = decks.filter((d) => isRootOrOrphan(d) && !d.isAdmin);
  const curCard =
    studyState && studyState.cards.length > 0 && studyState.current < studyState.cards.length
      ? studyState.cards[studyState.current]
      : null;

  // Animation state
  const [animState, setAnimState] = useState<"idle" | "completing">("idle");
  // noAnim must be in React state so it survives the re-render triggered by onRateCard
  const [noAnim, setNoAnim] = useState(false);
  const cardBoxRef = useRef<HTMLDivElement>(null);
  const rateBusyRef = useRef(false);
  // Ref to CardBack — lets the keyboard handler toggle examples from the parent
  const cardBackRef = useRef<CardBackHandle>(null);
  // Stable refs so keyboard handler doesn't go stale
  const handleFlipRef = useRef<() => void>(() => {});
  const handleRateRef = useRef<(r: "yes" | "no") => void>(() => {});
  // Track flip state in a ref so the keyboard useEffect never captures stale value
  const flippedRef = useRef(false);
  flippedRef.current = studyState?.flipped ?? false;

  // className driven by React state — includes no-anim so React doesn't blow it away on re-render
  const cardCls = [
    "anki-card-el",
    studyState?.flipped ? "flipped" : "",
    animState === "completing" ? "completing" : "",
    noAnim ? "no-anim" : "",
  ].filter(Boolean).join(" ");

  // Flip: if already flipped → 360° completing animation; if not → normal flip
  function handleFlip() {
    if (rateBusyRef.current) return;
    if (window.getSelection()?.toString()) return;
    if (studyState?.flipped && animState === "idle") {
      setAnimState("completing");
      setTimeout(() => {
        setAnimState("idle");
        onFlipCard(); // toggles flipped → false
      }, 460);
    } else if (!studyState?.flipped && animState === "idle") {
      onFlipCard();
    }
  }

  // Keep refs current so keyboard handler always calls latest version
  handleFlipRef.current = handleFlip;

  // Keyboard: Space/↑↓ = flip, Enter = ví dụ, ←/→ = rate.
  // Use *capture* phase so a focused study button doesn't swallow Space/Enter
  // before our handler runs (browser fires button-click on Space when focused).
  useEffect(() => {
    if (!inStudy) return;
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      // Skip when the user is typing into a real input
      if (tag === "input" || tag === "textarea" || tag === "select" || target?.isContentEditable) return;

      if (e.key === " " || e.code === "Space" || e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        handleFlipRef.current();
      } else if (e.key === "Enter") {
        // Don't hijack Enter on focused buttons — let browser fire their click
        if (tag === "button") return;
        e.preventDefault();
        if (flippedRef.current) cardBackRef.current?.toggleEx();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        e.stopPropagation();
        handleRateRef.current("yes");
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        e.stopPropagation();
        handleRateRef.current("no");
      }
    }
    document.addEventListener("keydown", onKey, true); // capture: true
    return () => document.removeEventListener("keydown", onKey, true);
  }, [inStudy]);

  function handleRate(rating: "yes" | "no") {
    if (rateBusyRef.current || animState !== "idle") return;
    rateBusyRef.current = true;
    const cardBox = cardBoxRef.current;
    const cardEl = cardRef.current;
    const overlay = cardEl?.parentElement?.querySelector(".card-rate-overlay") as HTMLElement | null;
    if (cardBox && overlay) {
      // 1) Show overlay + dim card
      overlay.className = `card-rate-overlay ${rating === "yes" ? "known" : "learning"} show`;
      overlay.textContent = rating === "yes" ? "Đã biết" : "Đang học";
      if (cardEl) cardEl.classList.add("rate-dimmed");

      // 2) After brief pause, fling card off screen
      setTimeout(() => {
        cardBox.classList.add(rating === "yes" ? "fling-right" : "fling-left");
      }, 120);

      // 3) After fling completes: reset, render new card, animate entrance
      setTimeout(() => {
        overlay.className = "card-rate-overlay";
        cardBox.classList.remove("fling-right", "fling-left");
        cardBox.classList.add("fling-none");

        // setNoAnim(true) batches with all the setXxx inside onRateCard (React 18 auto-batch)
        // so the new card renders with no-anim in cardCls — no flip-back transition visible
        setNoAnim(true);
        onRateCard(rating);
        rateBusyRef.current = false;

        requestAnimationFrame(() => {
          cardBox.classList.remove("fling-none");
          cardBox.classList.add("card-enter");
          setNoAnim(false); // re-enable transitions for next interaction
          setTimeout(() => cardBox.classList.remove("card-enter"), 260);
        });
      }, 500);
    } else {
      onRateCard(rating);
      rateBusyRef.current = false;
    }
  }

  handleRateRef.current = handleRate;

  const progressPct =
    studyState?.cards.length
      ? Math.round((totalDone / studyState.cards.length) * 100)
      : 0;

  return (
    <div
      id="tab-anki"
      className="tab-pane"
      style={{ display: "flex", flex: 1, flexDirection: "column", overflowY: "auto" }}
    >
      {/* Lock overlay — chỉ yêu cầu đăng nhập, không cần Premium */}
      <div className="anki-lock" id="anki-lock" style={{ display: showLock ? "flex" : "none" }}>
        <div style={{ fontSize: 48, opacity: 0.25 }}>🔒</div>
        <div style={{ fontSize: 20, fontWeight: 800 }}>Đăng nhập để sử dụng Anki</div>
        <div style={{ fontSize: 14, color: "var(--muted)", maxWidth: 300, lineHeight: 1.7 }}>
          Đăng nhập để truy cập bộ thẻ Anki và luyện từ vựng hiệu quả hơn.
        </div>
        <button
          className="btn-accent"
          id="anki-lock-action"
          style={{ padding: "12px 28px", borderRadius: 12, fontSize: 14 }}
          onClick={() => router.push("/login")}
        >
          Đăng nhập
        </button>
      </div>

      {/* Content */}
      <div
        id="anki-content"
        style={{ display: showContent ? "flex" : "none", flex: 1, flexDirection: "column" }}
      >
        {/* Deck list view */}
        <div
          id="anki-deck-view"
          style={{
            flex: 1,
            overflowY: "auto",
            display: inStudy || studyDone ? "none" : "block",
          }}
        >
          <div className="flashcard-srs-wrap">
            {/* Header */}
            <div className="srs-page-head">
              <div className="srs-title-row">
                <div className="srs-title-icon">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="#e8502a" aria-hidden>
                    <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                  </svg>
                </div>
                <div>
                  <h2 className="srs-page-title">
                    Flashcard SRS
                    <span className="srs-info-wrap">
                      <button
                        className="srs-info-btn srs-info-btn-new"
                        onClick={onToggleSrsInfo}
                        title="More information"
                        aria-label="More information"
                      >i</button>
                      {srsInfoOpen && (
                        <div id="srs-info-box" className="srs-info-popup">
                          Flashcard SRS là phương pháp học thông minh kết hợp giữa thẻ ghi nhớ và Hệ
                          thống lặp lại ngắt quãng (Spaced Repetition System). Thay vì học nhồi nhét,
                          hệ thống sẽ tự động tính toán và nhắc bạn ôn tập kiến thức ngay tại thời
                          điểm bạn sắp quên.
                        </div>
                      )}
                    </span>
                  </h2>
                  <p className="srs-page-sub">Hệ thống học lặp lại ngắt quãng thông minh</p>
                </div>
              </div>
              <div className="srs-actions">
                <button type="button" className="srs-btn-ghost" onClick={onOpenCreateFolder}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="#7a7870" aria-hidden>
                    <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                  </svg>
                  Tạo thư mục
                </button>
                <button type="button" className="srs-btn-accent" onClick={onOpenCreateDeck}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                    <path d="M12 5v14M5 12h14" strokeLinecap="round" />
                  </svg>
                  Tạo bộ thẻ
                </button>
              </div>
            </div>

            {/* Session picker card */}
            <div className="srs-card">
              <div className="srs-card-label">Số thẻ mỗi phiên học</div>
              <div className="srs-session-tabs">
                {batchOptions.map((n) => {
                  const active = batchSize === n;
                  return (
                    <button
                      key={n}
                      type="button"
                      className={`srs-session-tab${active ? " active" : ""}`}
                      onClick={() => onSetBatchSize(n)}
                    >
                      {n === 0 ? "Tất cả" : `${n} thẻ`}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Library card */}
            <div className="srs-card">
              <div className="srs-card-label">Thư viện</div>
              <div id="anki-tree-body">
                {decks.length === 0 && folders.length === 0 && (
                  <div style={{ color: "var(--muted2)", fontSize: 13, padding: "20px 0" }}>
                    Chưa có bộ thẻ nào. Tạo thư mục và bộ thẻ đầu tiên!
                  </div>
                )}

                {adminFolders.map((folder) => (
                  <FolderRow key={folder.id} folder={folder} decks={folderDecks(folder.id)} onStart={onStartStudy} onPreview={onOpenDeckPreview} onDelete={onDeleteDeck} onDeleteFolder={onDeleteFolder} />
                ))}
                {adminRootDecks.map((deck) => (
                  <DeckRow key={deck.id} deck={deck} onStart={onStartStudy} onPreview={onOpenDeckPreview} onDelete={onDeleteDeck} />
                ))}

                {(userFolders.length > 0 || userRootDecks.length > 0) && (
                  <div className="srs-section-sub">Của tôi</div>
                )}
                {userFolders.map((folder) => (
                  <FolderRow key={folder.id} folder={folder} decks={folderDecks(folder.id)} onStart={onStartStudy} onPreview={onOpenDeckPreview} onDelete={onDeleteDeck} onDeleteFolder={onDeleteFolder} />
                ))}
                {userRootDecks.map((deck) => (
                  <DeckRow key={deck.id} deck={deck} onStart={onStartStudy} onPreview={onOpenDeckPreview} onDelete={onDeleteDeck} />
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Study view */}
        <div
          className="anki-study-wrap"
          id="anki-study-view"
          style={{ display: inStudy || studyDone ? "flex" : "none" }}
        >
          {/* Study head */}
          <div
            className="anki-study-head"
            style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 3 }}
          >
            <button
              onClick={onCloseStudy}
              className="study-back-btn"
              title="Quay lại"
              aria-label="Quay lại"
            >
              <Image src="/svg/study-back.svg" alt="" aria-hidden width={20} height={20} />
            </button>
            <div className="study-meta" style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }} id="study-deck-name">
                {studyState?.deck?.name ?? "Bộ thẻ"}
              </div>
              <div className="study-progress-row">
                <Image src="/svg/study-progress.svg" alt="" aria-hidden width={14} height={14} />
                <span id="study-progress">
                  {totalDone} / {studyState?.cards.length ?? 0}
                </span>
              </div>
              {/* Progress bar */}
              <div
                style={{
                  height: 4,
                  background: "var(--border)",
                  borderRadius: 99,
                  marginTop: 6,
                  overflow: "hidden",
                  width: "100%",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    background: "var(--accent)",
                    borderRadius: 99,
                    width: `${progressPct}%`,
                    transition: "width .3s ease",
                  }}
                />
              </div>
            </div>
            <button
              id="study-reset-btn"
              onClick={onResetDeck}
              style={{
                padding: "7px 12px",
                borderRadius: 8,
                border: "1.5px solid #f0c9c9",
                background: "#fff7f7",
                color: "#b42318",
                cursor: "pointer",
                fontFamily: "'Be Vietnam Pro','Noto Sans JP',sans-serif",
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              ↺ Reset
            </button>
          </div>

          {/* Study main area */}
          <div className="anki-study-main">
            {/* Done screen */}
            {studyDone && (
              <div style={{ textAlign: "center", padding: "40px 20px" }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>🎉</div>
                <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 8 }}>Hoàn thành!</div>
                <div style={{ fontSize: 14, color: "var(--muted)", marginBottom: 8 }}>
                  Đã học xong {studyState?.doneStats.known ?? 0} thẻ trong phiên này!
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "center",
                    gap: 10,
                    marginBottom: 20,
                    flexWrap: "wrap",
                  }}
                >
                  <span
                    className="srs-badge srs-new"
                    style={{ fontSize: 13, padding: "4px 14px" }}
                  >
                    ✓ Đã biết: {studyState?.doneStats.known ?? 0}
                  </span>
                  <span
                    className="srs-badge srs-review"
                    style={{ fontSize: 13, padding: "4px 14px" }}
                  >
                    ↺ Đang học: {studyState?.doneStats.learning ?? 0}
                  </span>
                </div>
                <button
                  onClick={onCloseStudy}
                  className="btn-accent"
                  style={{ padding: "10px 24px", borderRadius: 10 }}
                >
                  ← Về danh sách
                </button>
              </div>
            )}

            {/* Card study area */}
            {!studyDone && (
              <div className="ql-study-area">
                <div className="anki-card-box" ref={cardBoxRef} style={{ flex: 1, maxWidth: "none" }}>
                  {/* 3-D flip card */}
                  <div
                    className={cardCls}
                    id="anki-card-el"
                    ref={cardRef}
                    onClick={handleFlip}
                  >
                    {/* Face Front */}
                    <div className="anki-card-face face-front">
                      <div className="cf-wrap">
                        <div className="cf-word"><Furi>{curCard?.word || "—"}</Furi></div>
                      </div>
                    </div>
                    {/* Face Back */}
                    <div className="anki-card-face face-back">
                      {curCard ? <CardBack key={curCard.id} ref={cardBackRef} card={curCard} /> : null}
                    </div>
                  </div>
                  <div
                    className="card-rate-overlay"
                    id="card-rate-overlay"
                    ref={cardRateRef}
                  />
                </div>

                {/* Side action buttons */}
                <div className="ql-side-actions">
                  <button
                    className="ql-side-btn no"
                    id="ql-btn-no"
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => { (e.currentTarget as HTMLButtonElement).blur(); handleRate("no"); }}
                    title="Đang học (←)"
                    aria-label="Đang học"
                    style={{ visibility: "visible" }}
                  >
                    <Image
                      src="/svg/study-learning.svg"
                      alt=""
                      aria-hidden
                      width={24}
                      height={24}
                    />
                  </button>
                  <button
                    className="ql-side-btn yes"
                    id="ql-btn-yes"
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => { (e.currentTarget as HTMLButtonElement).blur(); handleRate("yes"); }}
                    title="Đã biết (→)"
                    aria-label="Đã biết"
                    style={{ visibility: "visible" }}
                  >
                    <Image
                      src="/svg/study-known.svg"
                      alt=""
                      aria-hidden
                      width={24}
                      height={24}
                    />
                  </button>
                </div>
              </div>
            )}

            {/* Keyboard hint — always visible during study */}
            {!studyDone && (
              <div className="ql-hint" id="ql-hint">
                Space / ↑↓: lật thẻ &nbsp;·&nbsp; Enter: ví dụ &nbsp;·&nbsp; ←: Đang học &nbsp;·&nbsp; →: Đã biết
              </div>
            )}

            <div id="anki-btns" style={{ display: "none" }} />
          </div>
        </div>
      </div>
    </div>
  );
}

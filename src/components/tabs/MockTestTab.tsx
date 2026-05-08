"use client";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Skeleton } from "boneyard-js/react";
import ExamContent, { QGrid, type AnkiCardInput } from "@/components/exam/ExamContent";
import TargetPracticeModal, { type TargetConfig } from "@/components/modals/TargetPracticeModal";

export interface ExamMeta {
  id: string;
  name: string;
  level: string;
  year: string;
  questionCount: number;
  readMin: number;
  listenMin: number;
  /** true = đề từ thứ 4 trở đi (cần Premium để thi) */
  locked: boolean;
  /** Total global attempts on this exam */
  attempts?: number;
  /** Created within the last 30 days */
  isNew?: boolean;
}

export interface UserExamStats {
  examsDone: number;
  avgPct: number;
  totalTimeSec: number;
  totalAttempts: number;
}

type LevelFilter = "N1" | "N2" | "N3" | "N4" | "N5" | "BJT";

interface MockTestTabProps {
  exams: ExamMeta[];
  examsLoading: boolean;
  examsError: string | null;
  onRetryLoadExams: () => void;
  isPremium: boolean;
  isLoggedIn: boolean;
  userStats: UserExamStats;
  onStartExam: (exam: ExamMeta) => void;
  onStartTargetPractice?: (cfg: TargetConfig) => void;
  /** ID đề đang load (null nếu không có). Card tương ứng sẽ disable + hiện spinner. */
  startingExamId?: string | null;
  onOpenPremium: () => void;
  examViewerRef: React.RefObject<HTMLDivElement | null>;
  examContentRef: React.RefObject<HTMLDivElement | null>;
  examSidebarRef: React.RefObject<HTMLDivElement | null>;
  examState: "list" | "ready" | "doing" | "result";
  onBeginExam: () => void;
  currentExam: ExamMeta | null;
  phaseTag: string;
  phaseTagClass: string;
  examSubtitle: string;
  timerText: string;
  trScore: string;
  trTime: string;
  trCorrect: string;
  trWrong: string;
  trSkip: string;
  progress: string;
  onExitClick: () => void;
  onSubmitClick: () => void;
  isSubmitting?: boolean;
  onShowReport: () => void;
  // Exam content rendering
  allQuestions: Record<string, unknown>[];
  answers: Record<string, number>;
  answerKey: Record<string, number>;
  keyTypeMap: Record<string, string>;
  submitted: boolean;
  examPhase: "read" | "listen" | "idle" | "ready" | "break" | "done";
  examAudioUrl?: string;
  onPick: (key: string, idx: number) => void;
  onAddToAnki?: (card: AnkiCardInput) => Promise<void>;
}

const LEVEL_THEMES: Record<string, { gradient: string; solid: string; shadow: string }> = {
  N1:  { gradient: "linear-gradient(135deg,#ff6b3d 0%,#e8502a 100%)", solid: "#e8502a", shadow: "rgba(232,80,42,.28)" },
  N2:  { gradient: "linear-gradient(135deg,#5cb0e8 0%,#2b85d8 100%)", solid: "#2b85d8", shadow: "rgba(43,133,216,.28)" },
  N3:  { gradient: "linear-gradient(135deg,#56c37b 0%,#2a9e5f 100%)", solid: "#2a9e5f", shadow: "rgba(42,158,95,.28)" },
  N4:  { gradient: "linear-gradient(135deg,#ffc547 0%,#f59e0b 100%)", solid: "#f59e0b", shadow: "rgba(245,158,11,.28)" },
  N5:  { gradient: "linear-gradient(135deg,#b39ddb 0%,#8a6dd5 100%)", solid: "#8a6dd5", shadow: "rgba(138,109,213,.28)" },
  BJT: { gradient: "linear-gradient(135deg,#4dc6c0 0%,#2a9b9f 100%)", solid: "#2a9b9f", shadow: "rgba(42,155,159,.28)" },
};

const LOCK_SVG = (
  <svg className="lock-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden>
    <g fill="#efa83c">
      <path d="m19 9.58-2.57.64-3.21-4a1.5 1.5 0 0 0 -2.34 0l-3.21 4-2.62-.64a1.51 1.51 0 0 0 -1.82 1.82l1.77 6.22a1 1 0 0 0 1 .73h12a1 1 0 0 0 1-.73l1.78-6.22a1.51 1.51 0 0 0 -1.78-1.82z" />
      <circle cx="2.75" cy="7.25" r="1.25" />
      <circle cx="21.25" cy="7.25" r="1.25" />
      <circle cx="12" cy="3" r="1.25" />
      <path d="m18 22h-12a1 1 0 0 1 0-2h12a1 1 0 0 1 0 2z" />
    </g>
  </svg>
);

export default function MockTestTab({
  exams,
  examsLoading,
  examsError,
  onRetryLoadExams,
  isPremium,
  isLoggedIn,
  userStats,
  onStartExam,
  onStartTargetPractice,
  startingExamId,
  onOpenPremium,
  examViewerRef,
  examContentRef,
  examSidebarRef,
  examState,
  currentExam,
  phaseTag,
  phaseTagClass,
  examSubtitle,
  timerText,
  trScore,
  trTime,
  trCorrect,
  trWrong,
  trSkip,
  progress,
  onBeginExam,
  onExitClick,
  onSubmitClick,
  isSubmitting = false,
  onShowReport,
  allQuestions,
  answers,
  answerKey,
  keyTypeMap,
  submitted,
  examPhase,
  examAudioUrl,
  onPick,
  onAddToAnki,
}: MockTestTabProps) {
  const router = useRouter();
  const [levelFilter, setLevelFilter] = useState<LevelFilter>("N1");
  const [search, setSearch]         = useState("");
  const [yearFilter, setYearFilter] = useState<string>("");
  const [sortBy, setSortBy]         = useState<"newest" | "oldest" | "popular">("newest");
  const [viewMode, setViewMode]     = useState<"grid" | "list">("grid");
  const [page, setPage]             = useState(1);
  const [targetOpen, setTargetOpen] = useState(false);
  const PAGE_SIZE = 9;

  function handleStartTarget(cfg: TargetConfig) {
    setTargetOpen(false);
    if (onStartTargetPractice) onStartTargetPractice(cfg);
  }

  const forLevel = exams.filter((e) => e.level === levelFilter);
  const allYears = Array.from(new Set(forLevel.map((e) => e.year).filter(Boolean))).sort().reverse();

  // Search + year filter
  const searched = forLevel.filter((e) => {
    if (yearFilter && String(e.year) !== yearFilter) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      if (!e.name.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  // Sort
  const sorted = [...searched].sort((a, b) => {
    if (sortBy === "popular") return (b.attempts ?? 0) - (a.attempts ?? 0);
    const ay = parseInt(a.year || "0", 10);
    const by = parseInt(b.year || "0", 10);
    return sortBy === "oldest" ? ay - by : by - ay;
  });

  const visible = isPremium ? sorted : sorted.filter((e) => !e.locked);
  const showPremiumTeaser = !isPremium && forLevel.some((e) => e.locked);

  // Pagination
  const totalPages  = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const safePage    = Math.min(page, totalPages);
  const pageStart   = (safePage - 1) * PAGE_SIZE;
  const paged       = visible.slice(pageStart, pageStart + PAGE_SIZE);

  function fmtNum(n: number): string {
    return n.toLocaleString("vi-VN");
  }

  return (
    <div
      id="tab-mocktest"
      className="tab-pane"
      style={{ display: "flex", flex: 1, flexDirection: "column", minHeight: 0, overflow: "hidden" }}
    >
      <div id="exam-list" style={{ display: examState === "list" ? "block" : "none" }}>
        <div className="mocktest-wrap">
          {/* ── Header row: title + stats card ── */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 14, marginBottom: 12 }}>
            <div>
              <h2 style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.5px" }}>Luyện thi thử</h2>
              <p style={{ marginTop: 2, color: "var(--muted)", fontSize: 12.5 }}>
                Luyện đề thi thử bám sát đề thi thật
              </p>
            </div>
            <StatsCard stats={userStats} />
          </div>

          {/* ── Level tabs ── */}
          <div className="section-tabs">
            {(["N1", "N2", "N3", "N4", "N5", "BJT"] as LevelFilter[]).map((l) => (
              <button
                key={l}
                type="button"
                className={`section-tab${levelFilter === l ? " active" : ""}`}
                onClick={() => { setLevelFilter(l); setPage(1); }}
              >
                {l}
              </button>
            ))}
          </div>

          {/* ── Search + filter + sort row ── */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center", justifyContent: "space-between", margin: "12px 0" }}>
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", flex: "0 1 auto" }}>
            <div style={{ position: "relative", width: 320, minWidth: 200 }}>
              <input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="Tìm đề thi..."
                style={{
                  width: "100%", height: 44, padding: "0 44px 0 14px", borderRadius: 8,
                  border: "1.5px solid var(--border)", background: "var(--white)",
                  fontFamily: "Be Vietnam Pro,Noto Sans JP,sans-serif", fontSize: 13, outline: "none",
                  boxSizing: "border-box",
                }}
              />
              <Image
                src="/svg/search.svg"
                alt="" aria-hidden width={16} height={16}
                style={{
                  position: "absolute", right: 14, top: "50%",
                  transform: "translateY(-50%)", opacity: 0.45, pointerEvents: "none",
                }}
              />
            </div>
            <select
              value={yearFilter}
              onChange={(e) => { setYearFilter(e.target.value); setPage(1); }}
              style={{
                height: 44, padding: "0 36px 0 14px", borderRadius: 8,
                border: "1.5px solid var(--border)", background: "var(--white)",
                fontFamily: "Be Vietnam Pro,Noto Sans JP,sans-serif", fontSize: 13,
                cursor: "pointer", outline: "none", minWidth: 140,
                appearance: "none", WebkitAppearance: "none", MozAppearance: "none",
                backgroundImage:
                  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>\")",
                backgroundRepeat: "no-repeat",
                backgroundPosition: "right 14px center",
              }}
            >
              <option value="">Tất cả năm</option>
              {allYears.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <select
              value={sortBy}
              onChange={(e) => { setSortBy(e.target.value as "newest" | "oldest" | "popular"); setPage(1); }}
              style={{
                height: 44, padding: "0 36px 0 14px", borderRadius: 8,
                border: "1.5px solid var(--border)", background: "var(--white)",
                fontFamily: "Be Vietnam Pro,Noto Sans JP,sans-serif", fontSize: 13,
                cursor: "pointer", outline: "none",
                appearance: "none", WebkitAppearance: "none", MozAppearance: "none",
                backgroundImage:
                  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>\")",
                backgroundRepeat: "no-repeat",
                backgroundPosition: "right 14px center",
              }}
            >
              <option value="newest">Mới nhất</option>
              <option value="oldest">Cũ nhất</option>
              <option value="popular">Phổ biến</option>
            </select>
            </div>

            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <TargetButton onClick={() => setTargetOpen(true)} />
              <ViewToggleBtn
                active={viewMode === "grid"}
                onClick={() => setViewMode("grid")}
                title="Lưới"
                icon={<GridIcon />}
              />
              <ViewToggleBtn
                active={viewMode === "list"}
                onClick={() => setViewMode("list")}
                title="Danh sách"
                icon={<ListIcon />}
              />
            </div>
          </div>
          <Skeleton
            name="exam-grid"
            loading={exams.length === 0 && examsLoading}
            animate="shimmer"
            color="#e8e5de"
            fallback={
              <div className="exam-grid">
                {[1,2,3,4,5,6].map((i) => (
                  <div key={i} className="exam-card" style={{ background: "#f0efe9", borderColor: "#e2e0d8" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ height: 18, width: "70%", background: "#e2e0d8", borderRadius: 6, marginBottom: 10 }} />
                      <div style={{ height: 12, width: "40%", background: "#e8e5de", borderRadius: 6 }} />
                      <div style={{ display: "flex", gap: 14, marginTop: 14 }}>
                        <div style={{ height: 10, width: 56, background: "#e8e5de", borderRadius: 6 }} />
                        <div style={{ height: 10, width: 56, background: "#e8e5de", borderRadius: 6 }} />
                      </div>
                    </div>
                    <div style={{ height: 36, background: "#e2e0d8", borderRadius: 10, marginTop: 12 }} />
                  </div>
                ))}
              </div>
            }
          >
          <div
            id="exam-grid"
            style={{
              display: "grid",
              // auto-FILL keeps 3 cols even when level has < 3 exams
              // (auto-fit would stretch a single card to full row width)
              gridTemplateColumns: viewMode === "grid" ? "repeat(auto-fill, minmax(320px, 1fr))" : "1fr",
              gap: viewMode === "grid" ? 12 : 10,
            }}
          >
            {exams.length === 0 && examsLoading && (
              <div style={{ gridColumn: "1/-1", color: "var(--muted2)", textAlign: "center", padding: 60 }}>
                Đang tải đề thi...
              </div>
            )}
            {exams.length === 0 && !examsLoading && examsError && (
              <div style={{ gridColumn: "1/-1", textAlign: "center", padding: 60, display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
                <div style={{ fontSize: 40 }}>⚠️</div>
                <div style={{ color: "#c0392b", fontSize: 14, fontWeight: 600 }}>{examsError}</div>
                <div style={{ color: "var(--muted)", fontSize: 12 }}>Kiểm tra kết nối mạng và thử lại.</div>
                <button
                  type="button"
                  className="btn-accent"
                  style={{ padding: "10px 24px", borderRadius: 99, fontSize: 13 }}
                  onClick={onRetryLoadExams}
                >
                  ↻ Thử lại
                </button>
              </div>
            )}
            {exams.length === 0 && !examsLoading && !examsError && (
              <div style={{ gridColumn: "1/-1", textAlign: "center", padding: 60, display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
                <div style={{ color: "var(--muted2)", fontSize: 14 }}>Chưa có đề thi nào.</div>
                <button
                  type="button"
                  className="btn-ghost"
                  style={{ padding: "8px 20px" }}
                  onClick={onRetryLoadExams}
                >
                  ↻ Tải lại
                </button>
              </div>
            )}
            {exams.length > 0 && forLevel.length === 0 && (
              <div style={{ gridColumn: "1/-1", color: "var(--muted2)", textAlign: "center", padding: 60 }}>
                Chưa có đề thi
              </div>
            )}
            {exams.length > 0 &&
              paged.map((exam) => (
                <ExamCard
                  key={exam.id}
                  exam={exam}
                  viewMode={viewMode}
                  fmtNum={fmtNum}
                  onStart={onStartExam}
                  isStarting={startingExamId === exam.id}
                  anyStarting={!!startingExamId}
                />
              ))}
            {exams.length > 0 && showPremiumTeaser && (
              <div className="exam-card locked">
                <div className="lock-overlay">
                  <div className="lock-center">
                    {LOCK_SVG}
                    <div className="lock-title">Premium</div>
                    <div className="lock-sub">
                      Đăng ký Premium để làm toàn bộ đề (từ đề thứ 4 trở đi mỗi cấp)
                    </div>
                  </div>
                  {isLoggedIn ? (
                    <button type="button" className="lock-btn" onClick={onOpenPremium}>
                      ⭐ Nâng cấp Premium
                    </button>
                  ) : (
                    <button type="button" className="lock-btn" onClick={() => router.push("/login")}>
                      Đăng nhập
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
          </Skeleton>

          {/* ── Pagination ── */}
          {visible.length > PAGE_SIZE && (
            <Pagination
              page={safePage}
              total={totalPages}
              onChange={setPage}
            />
          )}
        </div>
      </div>

      <div
        id="exam-viewer"
        ref={examViewerRef}
        style={{
          display: examState !== "list" ? "flex" : "none",
          flex: 1,
          flexDirection: "column",
          minHeight: 0,
        }}
      >
        <div className={`exam-toolbar${examState === "result" ? " result-mode" : ""}`}>
          <div className="exam-toolbar-main">
            <button className="study-back-btn" onClick={onExitClick} title="Quay lại" aria-label="Quay lại">
              <Image src="/svg/study-back.svg" alt="" aria-hidden width={20} height={20} />
            </button>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 15, fontWeight: 700 }} id="ev-title">
                  {currentExam?.name ?? "Đề thi"}
                </span>
                {phaseTag && (
                  <span id="ev-phase-tag" className={`phase-tag ${phaseTagClass}`}>
                    {phaseTag}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 11 }} id="ev-sub">
                {examSubtitle}
              </div>
            </div>
          </div>

          <div className="toolbar-doing" id="toolbar-doing" style={{ display: examState === "doing" ? "flex" : "none" }}>
            <div className="exam-timer" id="ev-timer">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden style={{ marginRight: 6, verticalAlign: -3 }}>
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {timerText}
            </div>
            <button
              className="btn-accent"
              style={{ padding: "8px 22px", fontSize: 14, fontWeight: 700, borderRadius: 99, opacity: isSubmitting ? 0.65 : 1, cursor: isSubmitting ? "wait" : "pointer" }}
              id="ev-submit-top"
              type="button"
              disabled={isSubmitting}
              onClick={onSubmitClick}
            >
              {isSubmitting ? "Đang nộp..." : "Nộp bài"}
            </button>
          </div>

          <div className="toolbar-result" id="toolbar-result" style={{ display: examState === "result" ? "flex" : "none" }}>
            <div className="result-stat score" id="tr-score">
              <span className="result-stat-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="m12 3 2.62 5.31 5.86.85-4.24 4.13 1 5.83L12 16.36l-5.24 2.76 1-5.83-4.24-4.13 5.86-.85L12 3Z" />
                </svg>
              </span>
              <span className="result-stat-text">
                <b>{trScore}</b>
                <span>điểm</span>
              </span>
            </div>
            <div className="result-stat time" id="tr-time">
              <span className="result-stat-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="13" r="7" />
                  <path d="M9 2h6M12 6v7l4-2M18 6l1.8-1.8" />
                </svg>
              </span>
              <span className="result-stat-text">
                <b>{trTime.replace(/\s*phút$/i, "")}</b>
                <span>phút</span>
              </span>
            </div>
            <div className="result-stat correct" id="tr-correct">
              <span className="result-stat-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="M5 12.4 9.2 16.5 19 6.5" />
                </svg>
              </span>
              <span className="result-stat-text">
                <b>{trCorrect}</b>
                <span>đúng</span>
              </span>
            </div>
            <div className="result-stat wrong" id="tr-wrong">
              <span className="result-stat-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </span>
              <span className="result-stat-text">
                <b>{trWrong}</b>
                <span>sai</span>
              </span>
            </div>
            <div className="result-stat skip" id="tr-skip">
              <span className="result-stat-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="M7 3h10M7 21h10M8 3c0 4.5 8 4.5 8 9s-8 4.5-8 9M16 3c0 4.5-8 4.5-8 9s8 4.5 8 9" />
                </svg>
              </span>
              <span className="result-stat-text">
                <b>{trSkip}</b>
                <span>chưa làm</span>
              </span>
            </div>
            <button
              type="button"
              onClick={onShowReport}
              className="result-report-btn"
            >
              <span aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="M4 19V11M10 19V7M16 19V4M22 19H2" />
                </svg>
              </span>
              <span>Báo cáo năng lực</span>
            </button>
          </div>
        </div>

        <div className={`exam-body${examState === "ready" ? " ready-mode" : ""}`}>
          <div className={`exam-content${examState === "ready" ? " ready-mode" : ""}`} id="ev-content" ref={examContentRef}>
            {examState === "ready" && currentExam && (
              <div className="exam-ready-screen">
                <span
                  className={`exam-ready-badge badge-level badge-${currentExam.level.toLowerCase()}`}
                >
                  {currentExam.level}
                </span>
                <div className="exam-ready-title">{currentExam.name}</div>
                <div className="exam-ready-sub">
                  Kiểm tra thông tin trước khi bắt đầu.<br />
                  Đồng hồ chỉ bắt đầu khi bạn bấm &ldquo;Bắt đầu thi&rdquo;.
                </div>
                <div className="exam-ready-info">
                  <div className="exam-ready-info-item item-pencil">
                    <span className="exam-ready-info-icon ico-pencil">
                      <Image src="/svg/pencil.svg" alt="" aria-hidden width={26} height={26} />
                    </span>
                    <div>
                      <b>{currentExam.questionCount} câu</b>
                      Tổng câu hỏi
                    </div>
                  </div>
                  <div className="exam-ready-info-item item-read">
                    <span className="exam-ready-info-icon ico-read">
                      <Image src="/svg/read.svg" alt="" aria-hidden width={26} height={26} />
                    </span>
                    <div>
                      <b>{currentExam.readMin} phút</b>
                      Thời gian đọc
                    </div>
                  </div>
                  {currentExam.listenMin > 0 && (
                    <div className="exam-ready-info-item item-listen">
                      <span className="exam-ready-info-icon ico-listen">
                        <Image src="/svg/headphone-purple.svg" alt="" aria-hidden width={26} height={26} />
                      </span>
                      <div>
                        <b>{currentExam.listenMin} phút</b>
                        Thời gian nghe
                      </div>
                    </div>
                  )}
                </div>
                <button className="exam-start-btn" type="button" onClick={onBeginExam}>
                  ▶ Bắt đầu thi
                </button>
                <div className="exam-ready-meta">
                  <div>
                    <span className="exam-ready-meta-ico">
                      <Image src="/svg/level-black.svg" alt="" aria-hidden width={20} height={20} />
                    </span>
                    <div>Cấp độ<b>{currentExam.level}</b></div>
                  </div>
                  <div>
                    <span className="exam-ready-meta-ico">
                      <Image
                        src={currentExam.id.startsWith("target-") ? "/svg/target-black.svg" : "/svg/row-doc.svg"}
                        alt="" aria-hidden width={20} height={20}
                      />
                    </span>
                    <div>Loại đề<b>{currentExam.id.startsWith("target-") ? "Target" : "Full Test"}</b></div>
                  </div>
                  <div>
                    <span className="exam-ready-meta-ico">
                      <Image src="/svg/clock-black.svg" alt="" aria-hidden width={20} height={20} />
                    </span>
                    <div>Tổng thời gian<b>{currentExam.readMin + currentExam.listenMin} phút</b></div>
                  </div>
                </div>
              </div>
            )}
            {(examPhase === "read" || examPhase === "listen" || examPhase === "done") && (
              <ExamContent
                questions={allQuestions}
                answers={answers}
                answerKey={answerKey}
                keyTypeMap={keyTypeMap}
                submitted={submitted && examState === "result"}
                onPick={onPick}
                audioUrl={examAudioUrl}
                phase={examPhase === "listen" ? "listen" : "read"}
                onAddToAnki={onAddToAnki}
              />
            )}
          </div>
          {examState !== "ready" && (
            <div className="exam-sidebar" id="ev-sidebar" ref={examSidebarRef}>
              <div className="sidebar-card" id="ev-nav-section">
                <div className="sidebar-title">Câu hỏi</div>
                <div className="q-grid" id="ev-qgrid">
                  <QGrid answerKey={answerKey} keyTypeMap={keyTypeMap} answers={answers} submitted={submitted && examState === "result"} />
                </div>
              </div>
              {examState === "doing" && (
                <button
                  className="submit-btn"
                  id="ev-submit-side"
                  type="button"
                  disabled={isSubmitting}
                  style={{ opacity: isSubmitting ? 0.65 : 1, cursor: isSubmitting ? "wait" : "pointer" }}
                  onClick={onSubmitClick}
                >
                  {isSubmitting ? "⏳ Đang nộp..." : "🏁 Nộp bài"}
                </button>
              )}
              <div className="sidebar-card" style={{ padding: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 800, marginBottom: 6, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--muted)" }}>
                  Tiến độ
                </div>
                <div id="ev-progress" style={{ fontSize: 13, fontWeight: 600 }}>
                  {progress}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <TargetPracticeModal
        open={targetOpen}
        onClose={() => setTargetOpen(false)}
        onStart={handleStartTarget}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────

function StatsCard({ stats }: { stats: UserExamStats }) {
  function fmtTime(sec: number) {
    if (!sec) return "0m";
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }
  // icon = path under /public/svg, bg = pill background, n = number, l = label
  const items = [
    { icon: "/svg/stats-test.svg",    bg: "#fff1e0", n: String(stats.examsDone),                         l: "Đề đã thi" },
    { icon: "/svg/stats-average.svg", bg: "#e6f8d8", n: `${stats.avgPct}%`,                              l: "Tỷ lệ trung bình" },
    { icon: "/svg/stats-clock.svg",   bg: "#dbeafe", n: fmtTime(stats.totalTimeSec),                     l: "Tổng thời gian" },
    { icon: "/svg/stats-times.svg",   bg: "#fae0ff", n: stats.totalAttempts.toLocaleString("vi-VN"),     l: "Lượt thi" },
  ];
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 20,
      background: "var(--white)", border: "1px solid var(--border)",
      borderRadius: 12, padding: "8px 14px",
      boxShadow: "0 1px 8px rgba(0,0,0,.04)",
      flexWrap: "wrap",
    }}>
      {items.map((it, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 7,
            background: it.bg, display: "flex",
            alignItems: "center", justifyContent: "center",
            flexShrink: 0,
          }}>
            <Image src={it.icon} alt="" aria-hidden width={16} height={16} />
          </div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, lineHeight: 1.1 }}>{it.n}</div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>{it.l}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// Inline icon + text used in card meta rows
function MetaItem({ icon, text }: { icon: string; text: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <Image src={icon} alt="" aria-hidden width={14} height={14} />
      {text}
    </span>
  );
}

function ExamCard({
  exam, viewMode, fmtNum, onStart, isStarting = false, anyStarting = false,
}: {
  exam: ExamMeta;
  viewMode: "grid" | "list";
  fmtNum: (n: number) => string;
  onStart: (e: ExamMeta) => void;
  /** đề này đang được load — hiện spinner trên nút */
  isStarting?: boolean;
  /** có đề khác đang load — disable hết để tránh spam click */
  anyStarting?: boolean;
}) {
  const yearBadge = exam.year && (
    <span style={{
      fontSize: 11, fontWeight: 700,
      color: "var(--accent)", background: "#fee5dc",
      padding: "2px 9px", borderRadius: 99, whiteSpace: "nowrap",
    }}>Năm {exam.year}</span>
  );
  const newBadge = exam.isNew && (
    <span style={{
      fontSize: 10, fontWeight: 700, color: "#147a3a",
      background: "#dcfce7", border: "1px solid #bbf7d0",
      padding: "1px 7px", borderRadius: 99, whiteSpace: "nowrap",
    }}>Mới</span>
  );
  const theme = LEVEL_THEMES[exam.level] ?? LEVEL_THEMES.N1;
  const levelBadge = (
    <div style={{
      width: 44, height: 44, borderRadius: 10,
      background: theme.gradient, color: "#fff",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: 13, fontWeight: 800, flexShrink: 0,
      boxShadow: `0 4px 12px ${theme.shadow}`,
    }}>{exam.level}</div>
  );
  const disabled = anyStarting;
  const startBtn = (
    <button
      type="button"
      onClick={() => { if (!disabled) onStart(exam); }}
      disabled={disabled}
      aria-busy={isStarting || undefined}
      style={{
        background: theme.gradient, color: "#fff",
        border: "none", height: 36, padding: "0 18px",
        borderRadius: 8, fontFamily: "Be Vietnam Pro,Noto Sans JP,sans-serif",
        fontSize: 13, fontWeight: 700,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled && !isStarting ? 0.55 : 1,
        whiteSpace: "nowrap",
        display: "inline-flex", alignItems: "center", gap: 8,
      }}
    >
      {isStarting ? "Đang tải…" : "Bắt đầu thi"}
      {isStarting ? (
        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden style={{ animation: "spin 0.7s linear infinite" }}>
          <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="3" />
          <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
      ) : (
      <svg width="14" height="14" viewBox="0 0 48 48" fill="currentColor" aria-hidden>
        <path d="M13 41a4.722 4.722 0 0 1-2.386-.653 4.528 4.528 0 0 1-2.28-3.938V11.588a4.528 4.528 0 0 1 2.28-3.938 4.685 4.685 0 0 1 4.711-.036l22 12.412a4.543 4.543 0 0 1 0 7.948l-22 12.412A4.731 4.731 0 0 1 13 41zm0-32a2.715 2.715 0 0 0-1.377.377 2.546 2.546 0 0 0-1.289 2.211v24.824a2.546 2.546 0 0 0 1.289 2.211 2.707 2.707 0 0 0 2.72.021l22-12.412a2.542 2.542 0 0 0 0-4.464l-22-12.412A2.736 2.736 0 0 0 13 9z"/>
      </svg>
      )}
    </button>
  );

  // ─── LIST mode: single horizontal row, ultra-compact ───
  if (viewMode === "list") {
    return (
      <div style={{
        background: "var(--white)", border: "1px solid var(--border)",
        borderRadius: 12, padding: "10px 14px",
        display: "flex", alignItems: "center", gap: 12,
        boxShadow: "0 1px 3px rgba(0,0,0,.02)",
      }}>
        {levelBadge}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.25, margin: 0 }}>{exam.name}</h3>
            {newBadge}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 3, fontSize: 12, color: "var(--muted)" }}>
            <MetaItem icon="/svg/meta-questions.svg" text={`${exam.questionCount} câu`} />
            <MetaItem icon="/svg/meta-read.svg"      text={`${exam.readMin}p`} />
            <MetaItem icon="/svg/meta-listen.svg"    text={`${exam.listenMin}p`} />
            <MetaItem icon="/svg/people.svg"         text={fmtNum(exam.attempts ?? 0)} />
          </div>
        </div>
        {yearBadge}
        {startBtn}
      </div>
    );
  }

  // ─── GRID mode: matches reference image ───
  // Bigger gradient badge (level color), title 2-line, divider, meta row, full-width gradient CTA at bottom.
  const bigLevelBadge = (
    <div style={{
      width: 50, height: 50, borderRadius: 11,
      background: theme.gradient, color: "#fff",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: 16, fontWeight: 800, flexShrink: 0,
      boxShadow: `0 5px 14px ${theme.shadow}`,
      letterSpacing: "-0.5px",
    }}>{exam.level}</div>
  );
  const fullStartBtn = (
    <button
      type="button"
      onClick={() => { if (!disabled) onStart(exam); }}
      disabled={disabled}
      aria-busy={isStarting || undefined}
      style={{
        width: "100%", height: 40,
        background: theme.gradient, color: "#fff",
        border: "none", borderRadius: 10,
        fontFamily: "Be Vietnam Pro,Noto Sans JP,sans-serif",
        fontSize: 13.5, fontWeight: 700,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled && !isStarting ? 0.55 : 1,
        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 9,
        boxShadow: `0 5px 14px ${theme.shadow}`,
        transition: "transform .15s ease, box-shadow .2s ease",
      }}
    >
      <span>{isStarting ? "Đang tải…" : "Bắt đầu thi"}</span>
      {isStarting ? (
        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden style={{ animation: "spin 0.7s linear infinite" }}>
          <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="3" />
          <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 48 48" fill="currentColor" aria-hidden>
          <path d="M13 41a4.722 4.722 0 0 1-2.386-.653 4.528 4.528 0 0 1-2.28-3.938V11.588a4.528 4.528 0 0 1 2.28-3.938 4.685 4.685 0 0 1 4.711-.036l22 12.412a4.543 4.543 0 0 1 0 7.948l-22 12.412A4.731 4.731 0 0 1 13 41z"/>
        </svg>
      )}
    </button>
  );
  return (
    <div style={{
      position: "relative",
      background: "var(--white)", border: "1px solid var(--border)",
      borderRadius: 14, padding: 14,
      display: "flex", flexDirection: "column", gap: 10,
      boxShadow: "0 2px 10px rgba(0,0,0,.04)",
    }}>
      {/* Optional badges top-right (year + new) */}
      <div style={{ position: "absolute", top: 12, right: 14, display: "flex", gap: 6 }}>
        {newBadge}
        {yearBadge}
      </div>

      {/* Top: gradient badge + title (2 lines) */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, paddingRight: 80 }}>
        {bigLevelBadge}
        <h3 style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.3, margin: 0, color: "var(--text)" }}>
          {exam.name}
        </h3>
      </div>

      {/* Divider + meta row (compact, left-aligned) */}
      <div style={{
        borderTop: "1px solid var(--border)", paddingTop: 10,
        display: "flex", flexWrap: "wrap",
        gap: 12, fontSize: 12.5, color: "var(--muted)",
      }}>
        <MetaItem icon="/svg/meta-questions.svg" text={`${exam.questionCount} câu`} />
        <MetaItem icon="/svg/meta-read.svg"      text={`${exam.readMin} phút`} />
        <MetaItem icon="/svg/meta-listen.svg"    text={`${exam.listenMin} phút`} />
      </div>

      {/* Full-width CTA */}
      {fullStartBtn}
    </div>
  );
}

// ── View toggle (grid / list) ──
function TargetButton({ onClick }: { onClick: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      {hover && (
        <div style={{
          position: "absolute", bottom: "calc(100% + 8px)", right: 0,
          background: "#1a1917", color: "#fff",
          padding: "8px 12px", borderRadius: 8,
          fontSize: 12, lineHeight: 1.4,
          whiteSpace: "nowrap", maxWidth: 280,
          boxShadow: "0 6px 24px rgba(0,0,0,.18)",
          zIndex: 5, pointerEvents: "none",
        }}>
          Chọn Mondai bạn muốn luyện tập<br />và thi tập trung vào phần đó
        </div>
      )}
      <button
        type="button"
        onClick={onClick}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          height: 44, padding: "0 14px 0 12px",
          display: "inline-flex", alignItems: "center", gap: 8,
          borderRadius: 8,
          border: "1.5px solid var(--border)",
          background: "var(--white)",
          color: "#d60000",
          fontFamily: "Be Vietnam Pro,Noto Sans JP,sans-serif",
          fontSize: 13, fontWeight: 600,
          cursor: "pointer",
          transition: "all .15s",
          boxShadow: "0 2px 8px rgba(214,0,0,.18), 0 1px 3px rgba(0,0,0,.04)",
        }}
        title="Target luyện thi"
      >
        <Image src="/svg/target2.svg" alt="" aria-hidden width={18} height={18} />
        <span>Target luyện thi</span>
      </button>
    </div>
  );
}

function ViewToggleBtn({
  active, onClick, title, icon,
}: { active: boolean; onClick: () => void; title: string; icon: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      style={{
        width: 44, height: 44, borderRadius: 8,
        border: active ? "1.5px solid var(--accent)" : "1.5px solid var(--border)",
        background: active ? "var(--accent)" : "var(--white)",
        color: active ? "#fff" : "var(--muted)",
        cursor: "pointer", padding: 0,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        transition: "all .15s",
      }}
    >
      {icon}
    </button>
  );
}

// Lucide-style icons (inline SVG, no extra dep)
function GridIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect width="7" height="7" x="3"  y="3"  rx="1" />
      <rect width="7" height="7" x="14" y="3"  rx="1" />
      <rect width="7" height="7" x="14" y="14" rx="1" />
      <rect width="7" height="7" x="3"  y="14" rx="1" />
    </svg>
  );
}
function ListIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="8" x2="21" y1="6"  y2="6"  />
      <line x1="8" x2="21" y1="12" y2="12" />
      <line x1="8" x2="21" y1="18" y2="18" />
      <line x1="3" x2="3.01" y1="6"  y2="6"  />
      <line x1="3" x2="3.01" y1="12" y2="12" />
      <line x1="3" x2="3.01" y1="18" y2="18" />
    </svg>
  );
}

function Pagination({
  page, total, onChange,
}: { page: number; total: number; onChange: (p: number) => void }) {
  // Build page list with ellipsis: 1 [2] 3 ... 6
  const pages: (number | "...")[] = [];
  if (total <= 7) {
    for (let i = 1; i <= total; i++) pages.push(i);
  } else {
    pages.push(1);
    if (page > 3) pages.push("...");
    for (let i = Math.max(2, page - 1); i <= Math.min(total - 1, page + 1); i++) pages.push(i);
    if (page < total - 2) pages.push("...");
    pages.push(total);
  }

  const baseBtn: React.CSSProperties = {
    minWidth: 36, height: 36, borderRadius: 10,
    border: "1px solid var(--border)", background: "var(--white)",
    fontFamily: "Be Vietnam Pro,Noto Sans JP,sans-serif", fontSize: 13, fontWeight: 600,
    cursor: "pointer", display: "inline-flex",
    alignItems: "center", justifyContent: "center",
  };
  const activeBtn: React.CSSProperties = {
    ...baseBtn,
    background: "var(--accent)", color: "#fff", borderColor: "var(--accent)",
  };

  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 6, padding: "20px 0" }}>
      <button
        type="button"
        disabled={page === 1}
        onClick={() => onChange(Math.max(1, page - 1))}
        style={{ ...baseBtn, opacity: page === 1 ? 0.4 : 1, cursor: page === 1 ? "not-allowed" : "pointer" }}
      >‹</button>
      {pages.map((p, i) =>
        p === "..." ? (
          <span key={`e${i}`} style={{ padding: "0 6px", color: "var(--muted2)" }}>…</span>
        ) : (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            style={p === page ? activeBtn : baseBtn}
          >{p}</button>
        )
      )}
      <button
        type="button"
        disabled={page === total}
        onClick={() => onChange(Math.min(total, page + 1))}
        style={{ ...baseBtn, opacity: page === total ? 0.4 : 1, cursor: page === total ? "not-allowed" : "pointer" }}
      >›</button>
    </div>
  );
}

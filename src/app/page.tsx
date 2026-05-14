"use client";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import Image from "next/image";
import Nav, { type TabId } from "@/components/Nav";
import SplashScreen from "@/components/SplashScreen";
import CountdownBar from "@/components/CountdownBar";
import DictFab from "@/components/DictFab";

import HomeTab from "@/components/tabs/HomeTab";
import DashboardTab from "@/components/tabs/DashboardTab";
import MockTestTab, { type ExamMeta } from "@/components/tabs/MockTestTab";
import AnkiTab from "@/components/tabs/AnkiTab";
import type { AnkiStudyState } from "@/components/tabs/AnkiTab";
import ChallengeTab from "@/components/anki/ChallengeTab";

import BreakOverlay from "@/components/modals/BreakOverlay";
import ExamConfirmModal from "@/components/modals/ExamConfirmModal";
import InfoModal from "@/components/modals/InfoModal";
import PremiumModal from "@/components/modals/PremiumModal";
import SettingsModal from "@/components/modals/SettingsModal";
import DictPopup from "@/components/modals/DictPopup";
import ReportModal from "@/components/modals/ReportModal";
import { CreateFolderModal, CreateDeckModal, DeckPreviewModal, EMPTY_GRAMMAR_CARD, type GrammarCardInput } from "@/components/modals/AnkiModals";

import { useAuth } from "@/hooks/useAuth";
import { useExam } from "@/hooks/useExam";
import { useAnki, isPremiumForAnki } from "@/hooks/useAnki";
import { useDashboard, saveLocalResult, getWeekStart, type ExamResult } from "@/hooks/useDashboard";
import type { AnkiDeck as AnkiDeckHook, AnkiFolder as AnkiFolderHook } from "@/hooks/useAnki";
import type { AnkiDeck as AnkiDeckComp, AnkiFolder as AnkiFolderComp, AnkiCard as AnkiCardComp } from "@/components/tabs/AnkiTab";
import { sb } from "@/lib/supabase";
import { fetchDictionaryWords } from "@/lib/dictionaryLookup";
import { FREE_EXAMS_PER_LEVEL, LEVEL_TIMES } from "@/lib/constants";
import { startExam, startTargetPractice, submitAnswers, ExamApiError, type SubmitAnswerInput } from "@/lib/examSubmit";
import type { TargetConfig } from "@/components/modals/TargetPracticeModal";

type InfoKey = "about" | "privacy" | "terms" | "contact";

function examYear(e: { name?: string; year?: unknown }): string {
  if (e.year != null && String(e.year).trim()) return String(e.year);
  const m = String(e.name || "").match(/\b(19|20)\d{2}\b/);
  return m ? m[0] : "";
}

function isPremiumPlan(plan?: string) {
  const p = (plan || "free").toLowerCase();
  return p === "1year" || p === "lifetime" || p === "premium" || p === "3month";
}


function formatTimer(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Convert hook AnkiDeck → component AnkiDeck
// Hook's AnkiCard is a JSON object (no separate `id`) — use array index as fallback id
function toCompDeck(d: AnkiDeckHook): AnkiDeckComp {
  const folderId = typeof d.folder_id === "string" && d.folder_id.trim() ? d.folder_id : undefined;
  return {
    id: d.id,
    name: d.name,
    folderId,
    isAdmin: d.is_admin,
    dueCount: 0,
    newCount: 0,
    cards: (d.cards || []).map((c, idx) => ({
      id: String(c.vocab_id ?? idx),
      word: c.word,
      reading: c.reading,
      meaning: c.meaning,
      meaning_jp: c.meaning_jp,
      han_viet: c.han_viet,
      word_type: c.word_type,
      examples: c.examples,
      kind: c.kind,
    })) as AnkiCardComp[],
  };
}

function toCompFolder(f: AnkiFolderHook): AnkiFolderComp {
  return { id: f.id, name: f.name, isAdmin: f.is_admin };
}

export default function Home() {
  // ── Auth ──
  const { user, profile, ready } = useAuth();

  useEffect(() => {
    const block = (e: Event) => e.preventDefault();
    document.addEventListener("contextmenu", block);
    document.addEventListener("dragstart", block);
    return () => {
      document.removeEventListener("contextmenu", block);
      document.removeEventListener("dragstart", block);
    };
  }, []);

  // ── Active tab ──
  const [activeTab, setActiveTab] = useState<TabId>("home");

  // ── Dashboard ──
  const dash = useDashboard(profile);
  // Lazy: only fetch when user opens MockTest (needs userStats) or Dashboard
  // (needs results/skill chart). HomeTab is independent — it reads hsUsers /
  // hsExams only, never dash.*. Loading once per profile avoids repeated
  // exam_results queries on every tab toggle.
  const dashLoadedForProfile = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (activeTab !== "dashboard" && activeTab !== "mocktest") return;
    const currentProfileId = profile?.id ?? null;
    if (dashLoadedForProfile.current === currentProfileId) return;
    dashLoadedForProfile.current = currentProfileId;
    const t = setTimeout(() => { void dash.loadDashboard(); }, 0);
    return () => clearTimeout(t);
  }, [activeTab, profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Hero stats (Supabase counts) ──
  // Cached in localStorage for 10 minutes — these are slow-moving counters
  // and the home banner doesn't need them fresh every page-load.
  // v2 cache shape adds `hours` (sum(time_spent_sec) → integer hours).
  const HERO_STATS_KEY = "jlptbro-hero-stats-v2";
  const HERO_STATS_TTL_MS = 10 * 60 * 1000;

  function readHeroCache(): { users?: string; exams?: string; hours?: string } | null {
    try {
      const raw = localStorage.getItem(HERO_STATS_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { users?: string; exams?: string; hours?: string; cachedAt?: number };
      if (!parsed.cachedAt || Date.now() - parsed.cachedAt > HERO_STATS_TTL_MS) return null;
      return { users: parsed.users, exams: parsed.exams, hours: parsed.hours };
    } catch { return null; }
  }
  function writeHeroCache(users: string, exams: string, hours: string) {
    try {
      localStorage.setItem(HERO_STATS_KEY, JSON.stringify({ users, exams, hours, cachedAt: Date.now() }));
    } catch { /* quota exceeded — ignore */ }
  }

  // useState initial MUST be the same on server and client to avoid the
  // hydration mismatch that crashed earlier (React error #418). Cache is
  // read INSIDE the effect (post-hydration) and applied via setState.
  const [hsUsers, setHsUsers] = useState("—");
  const [hsExams, setHsExams] = useState("—");
  const [hsHours, setHsHours] = useState("—");

  useEffect(() => {
    // Cache read happens after hydration — safe to touch localStorage.
    const cached = readHeroCache();
    if (cached) {
      if (cached.users) setHsUsers(cached.users);
      if (cached.exams) setHsExams(cached.exams);
      if (cached.hours) setHsHours(cached.hours);
      // Cache fresh → skip the three RPC round-trips entirely.
      return;
    }

    let usersStr = "";
    let examsStr = "";
    let hoursStr = "";
    const persist = () => {
      if (usersStr && examsStr && hoursStr) writeHeroCache(usersStr, examsStr, hoursStr);
    };

    sb.rpc("get_total_users")
      .then(({ data, error }) => {
        if (error) {
          console.warn("[home] get_total_users failed, fallback to count:", error.message);
          return sb.from("profiles").select("*", { count: "exact", head: true })
            .then(({ count }) => {
              if (count != null) {
                usersStr = count.toLocaleString("vi");
                setHsUsers(usersStr);
                persist();
              }
            });
        }
        if (data != null) {
          usersStr = Number(data).toLocaleString("vi");
          setHsUsers(usersStr);
          persist();
        }
      });

    sb.rpc("get_total_exams")
      .then(({ data, error }) => {
        if (error) {
          console.warn("[home] get_total_exams failed, fallback to count:", error.message);
          return sb.from("exams").select("*", { count: "exact", head: true }).eq("is_published", true)
            .then(({ count }) => {
              if (count != null) {
                examsStr = String(count);
                setHsExams(examsStr);
                persist();
              }
            });
        }
        if (data != null) {
          examsStr = String(data);
          setHsExams(examsStr);
          persist();
        }
      });

    // Fires in parallel with the two above. RPC bypasses RLS on
    // exam_results (owner-only). Returns total seconds across all learners
    // → convert to whole hours, comma-format.
    sb.rpc("get_total_practice_seconds")
      .then(({ data, error }) => {
        if (error) {
          console.warn("[home] get_total_practice_seconds failed:", error.message);
          // No safe anon fallback (exam_results is owner-RLS) — leave as "—".
          return;
        }
        const seconds = Number(data ?? 0);
        const hours = Math.floor(seconds / 3600);
        hoursStr = hours.toLocaleString("vi");
        setHsHours(hoursStr);
        persist();
      });
  }, []);

  // ── Exam ──
  const exam = useExam();
  const examContentRef = useRef<HTMLDivElement>(null);
  const examSidebarRef = useRef<HTMLDivElement>(null);
  const examViewerRef = useRef<HTMLDivElement>(null);

  const examViewState: "list" | "ready" | "doing" | "result" =
    exam.phase === "idle" ? "list" : exam.phase === "done" ? "result" : exam.phase === "ready" ? "ready" : "doing";
  const isInExam = activeTab === "mocktest" && examViewState !== "list";
  const breakTimeLeft = exam.phase === "break" ? formatTimer(exam.breakSec) : "30:00";
  const [confirmModal, setConfirmModal] = useState<{ open: boolean; title: string; body: string; onOk: () => void }>({
    open: false, title: "", body: "", onOk: () => {},
  });
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportAnimate, setReportAnimate] = useState(false);
  const [dashReportData, setDashReportData] = useState<import("@/lib/examLogic").ReportData | null>(null);
  const [dashReportName, setDashReportName] = useState("");
  const [toastMsg, setToastMsg] = useState("");
  const breakTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function showToast(msg: string) {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(""), 2800);
  }

  // Anti-account-sharing: listen for "session-kicked" CustomEvent dispatched
  // by useAuth's Realtime DELETE handler. Show a blocking modal with a
  // 5-second countdown then redirect to /login.
  const [kickedCountdown, setKickedCountdown] = useState<number | null>(null);

  useEffect(() => {
    const onKicked = () => setKickedCountdown(5);
    window.addEventListener("session-kicked", onKicked);
    return () => window.removeEventListener("session-kicked", onKicked);
  }, []);

  useEffect(() => {
    if (kickedCountdown === null) return;
    if (kickedCountdown === 0) {
      // Force signOut even if the Realtime DELETE handler's signOut failed
      // (network blip, refresh race) — never redirect while still authed.
      sb.auth.signOut().finally(() => { window.location.href = "/login"; });
      return;
    }
    const t = setTimeout(() => setKickedCountdown((c) => (c ?? 1) - 1), 1000);
    return () => clearTimeout(t);
  }, [kickedCountdown]);

  async function handleAddToAnki(card: { word: string; reading: string; meaning: string; word_type?: string }) {
    if (!user) { showToast("Đăng nhập để dùng tính năng này"); return; }
    const deckName = exam.curExam?.name ?? "Ôn thi JLPT";

    // Look up vocabulary_library to get full card shape — same logic as
    // handleSaveDeck so quick-add cards match cards created from a deck form.
    let entry: Record<string, unknown> | undefined;
    try {
      const { data } = await fetchDictionaryWords(sb, [card.word]);
      entry = data.find((e) => e.word === card.word) as Record<string, unknown> | undefined;
    } catch { /* offline / RLS — fall back to provided values */ }

    // Unified shape: SAME keys as handleSaveDeck (page.tsx:402-413)
    const fullCard = {
      word:       card.word,
      reading:    entry ? String(entry.reading ?? "")    : (card.reading || ""),
      han_viet:   entry ? String(entry.han_viet ?? "")   : "",
      word_type:  entry ? String(entry.word_type ?? "")  : (card.word_type || ""),
      meaning:    entry ? String(entry.meaning ?? "")    : card.meaning,
      meaning_jp: entry ? String(entry.meaning_jp ?? "") : "",
      examples:   entry ? ((entry.examples as unknown[]) ?? []) : [],
      vocab_id:   entry ? (entry.id ?? null) : null,
    };

    // RLS-scoped — own decks only. is_admin=false to skip admin templates.
    const { data: existing } = await sb.from("anki_decks").select("id,cards").eq("name", deckName).eq("is_admin", false).maybeSingle();
    if (existing) {
      const cards: typeof fullCard[] = existing.cards || [];
      if (cards.find((c) => c.word === card.word)) { showToast(`"${card.word}" đã có trong bộ thẻ`); return; }
      await sb.from("anki_decks").update({ cards: [...cards, fullCard] }).eq("id", existing.id);
    } else {
      await sb.from("anki_decks").insert({ user_id: user.id, name: deckName, cards: [fullCard], is_admin: false, folder_id: null });
    }
    showToast(`Đã thêm "${card.word}" vào "${deckName}"`);
    void anki.loadAnki();
  }

  // Load exams when switching to mocktest tab (only when needed).
  // Trigger ONLY on activeTab change — not on examsLoading/length transitions —
  // otherwise a successful load returning 0 rows would keep re-firing forever.
  // User can click "↻ Thử lại" to manually retry on demand.
  useEffect(() => {
    if (activeTab !== "mocktest") return;
    void exam.loadExams();
  }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const mockExamList = useMemo(() => {
    const prem = isPremiumPlan(profile?.plan);
    const seen: Record<string, number> = {};
    return exam.allExams.map((e) => {
      const L = String(e.level || "");
      const rank = seen[L] ?? 0;
      seen[L] = rank + 1;
      const times = LEVEL_TIMES[L] ?? { read: 90, listen: 45 };
      const created = e.created_at ? new Date(e.created_at).getTime() : 0;
      const isNew   = created > 0 && (Date.now() - created) < 30 * 24 * 60 * 60 * 1000;
      return {
        id: e.id,
        name: e.name,
        level: L,
        year: examYear(e),
        questionCount: Number(e.question_count) || 0,
        readMin: times.read,
        listenMin: times.listen,
        locked: !prem && rank >= FREE_EXAMS_PER_LEVEL,
        attempts: Number(e.attempts) || 0,
        isNew,
      } satisfies ExamMeta;
    });
  }, [exam.allExams, profile?.plan]);

  // User stats for the StatsCard at top right of Mock Test.
  // dash.results đã merge remote + local (dedup theo exam_id+phút+score)
  // — không cộng dash.localResults nữa để tránh đếm trùng. Lấy time_spent
  // từ row khi có, fallback về local map theo reportKey.
  const userStats = useMemo(() => {
    const localTimeByKey = new Map<string, number>();
    dash.localResults.forEach((r) => {
      if (r.reportKey) localTimeByKey.set(r.reportKey, Number(r.spentSec) || 0);
    });
    const all = dash.results.map((r) => {
      const explicit = Number((r as Record<string, unknown>).time_spent);
      const fromKey = r.id ? localTimeByKey.get(String(r.id)) : undefined;
      return {
        pct: Number(r.score_pct) || 0,
        time: Number.isFinite(explicit) && explicit > 0 ? explicit : (fromKey ?? 0),
        examId: r.exam_id,
      };
    });
    const totalAttempts = all.length;
    const distinct = new Set(all.map((a) => a.examId).filter(Boolean));
    const examsDone = distinct.size > 0 ? distinct.size : totalAttempts;
    const avgPct = totalAttempts > 0
      ? Math.round(all.reduce((s, a) => s + a.pct, 0) / totalAttempts)
      : 0;
    const totalTimeSec = all.reduce((s, a) => s + a.time, 0);
    return { examsDone, avgPct, totalTimeSec, totalAttempts };
  }, [dash.results, dash.localResults]);

  // Maps returned by /start — needed at submit time so we know
  // which (question_id, slot_key) pairs to grade.
  const [examSlotKeys, setExamSlotKeys]             = useState<string[]>([]);
  const [examSlotTypes, setExamSlotTypes]           = useState<Record<string, string>>({});
  const [examSlotToQId, setExamSlotToQId]           = useState<Record<string, string>>({});
  const [examSlotToExamId, setExamSlotToExamId]     = useState<Record<string, string>>({});
  // Note: legacy guest_seed state removed — seed is server-side via cookie + exam_sessions.
  // ID đề đang load để disable nút + hiện spinner — click "Bắt đầu thi" gọi
  // /api/exam/[id]/start (1-3s), trước đây không có feedback nên cảm giác đơ.
  const [startingExamId, setStartingExamId]         = useState<string | null>(null);
  // Guard: ngăn nộp bài 2 lần đồng thời (double-click, timer + nút)
  const [isSubmitting, setIsSubmitting]             = useState(false);

  async function handleStartExam(meta: ExamMeta) {
    if (startingExamId) return; // chống double-click khi đang load
    setIsSubmitting(false);
    const isPrem = isPremiumPlan(profile?.plan);
    if (meta.locked && !isPrem) {
      setPremiumOpen(true);
      return;
    }
    setStartingExamId(meta.id);
    // Load via secure API: server shuffles + strips `correct`
    let started;
    try {
      started = await startExam(meta.id);
    } catch (e) {
      const msg = e instanceof ExamApiError ? e.message : "Lỗi tải đề thi.";
      console.error("[mocktest] startExam failed:", msg);
      showToast(msg);
      setStartingExamId(null);
      return;
    }
    if (!started.questions || started.questions.length === 0) {
      showToast("Không tải được đề thi. Vui lòng thử lại.");
      setStartingExamId(null);
      return;
    }
    // Flatten the sanitized rows into the same shape the renderer expects:
    //   { id, type, level, order_index, ...data }
    const qs = started.questions.map((row) => ({
      ...(row.data ?? {}),
      id: row.id,
      type: row.type,
      level: row.level,
      order_index: row.order_index,
      audio_url:     (row as { audio_url?: string | null }).audio_url        ?? null,
      audio_script:  (row as { audio_script?: string | null }).audio_script  ?? null,
      audio_display: (row as { audio_display?: string | null }).audio_display ?? null,
    })) as unknown as import("@/hooks/useExam").Question[];

    const readQs   = qs.filter((q) => !String((q as unknown as Record<string,unknown>).type ?? "").startsWith("listen"));
    const listenQs = qs.filter((q) =>  String((q as unknown as Record<string,unknown>).type ?? "").startsWith("listen"));

    setExamSlotKeys(started.slotKeys);
    setExamSlotTypes(started.slotTypeMap);
    setExamSlotToQId(started.slotToQuestionId);
    setExamSlotToExamId({}); // normal exam: all slots use curExam.id (fallback)

    // Placeholder answerKey so the QGrid sidebar knows which slots exist.
    // Values are -1 (unreachable) — they're only used after `submitted=true`,
    // at which point handleSubmitExam replaces them with real correct positions.
    const placeholderKey: Record<string, number> = {};
    for (const k of started.slotKeys) placeholderKey[k] = -1;

    exam.setState((s) => ({
      ...s,
      curExam: exam.allExams.find((e) => e.id === meta.id) ?? null,
      readQs:    readQs  as typeof s.readQs,
      listenQs:  listenQs as typeof s.listenQs,
      answers:   {},
      answerKey: placeholderKey,
      keyTypeMap: started.slotTypeMap,
      phase:     "ready",
      submitted: false,
      reportData: null,
    }));
    setStartingExamId(null);
  }

  async function handleStartTargetPractice(cfg: TargetConfig) {
    if (startingExamId) return;
    setIsSubmitting(false);
    setStartingExamId("target");
    let pool;
    try {
      pool = await startTargetPractice({ level: cfg.level, mondaiType: cfg.mondaiType, count: cfg.count });
    } catch (e) {
      const msg = e instanceof ExamApiError ? e.message : "Lỗi tải câu hỏi target.";
      console.error("[target] startTargetPractice failed:", msg);
      showToast(msg);
      setStartingExamId(null);
      return;
    }
    if (!pool.questions || pool.questions.length === 0) {
      showToast("Không tìm được câu hỏi cho mục tiêu này.");
      setStartingExamId(null);
      return;
    }
    if (pool.meta) {
      showToast(`Đã lấy ${pool.questions.length} câu từ ${pool.meta.sourceExamCount} đề (tổng pool: ${pool.meta.totalAvailable})`);
    }

    const qs = pool.questions.map((row) => ({
      ...(row.data ?? {}),
      id: row.id,
      type: row.type,
      level: row.level,
      order_index: row.order_index,
    })) as unknown as import("@/hooks/useExam").Question[];

    const readQs   = qs.filter((q) => !String((q as unknown as Record<string,unknown>).type ?? "").startsWith("listen"));
    const listenQs = qs.filter((q) =>  String((q as unknown as Record<string,unknown>).type ?? "").startsWith("listen"));

    setExamSlotKeys(pool.slotKeys);
    setExamSlotTypes(pool.slotTypeMap);
    setExamSlotToQId(pool.slotToQuestionId);
    setExamSlotToExamId(pool.slotToExamId);

    const placeholderKey: Record<string, number> = {};
    for (const k of pool.slotKeys) placeholderKey[k] = -1;

    const virtualExam = {
      id: pool.virtualExam.id,
      name: pool.virtualExam.name,
      level: pool.virtualExam.level,
      is_published: true,
      is_premium: false,
    } as import("@/hooks/useExam").Exam;

    exam.setState((s) => ({
      ...s,
      curExam: virtualExam,
      readQs:    readQs  as typeof s.readQs,
      listenQs:  listenQs as typeof s.listenQs,
      answers:   {},
      answerKey: placeholderKey,
      keyTypeMap: pool.slotTypeMap,
      phase:     "ready",
      submitted: false,
      reportData: null,
    }));
    setStartingExamId(null);
  }

  function handleBeginExam() {
    setIsSubmitting(false);
    const times = exam.getLevelTimes();
    const hasReading = exam.readQs.length > 0;
    const hasListening = exam.listenQs.length > 0;
    console.log("[exam] handleBeginExam", { hasReading, hasListening, readCount: exam.readQs.length, listenCount: exam.listenQs.length });

    // Listening-only exam: skip the reading phase entirely.
    if (!hasReading && hasListening) {
      exam.startTimer(times.listen * 60, () => { void handleSubmitExam(); });
      exam.setState((s) => ({ ...s, phase: "listen" }));
      return;
    }

    exam.startTimer(times.read * 60, () => {
      // When the read timer expires, route through the break phase if the
      // exam has a listening section. Without this, listening was never shown.
      if (exam.listenQs.length > 0) {
        goToBreak();
      } else {
        void handleSubmitExam();
      }
    });
    exam.setState((s) => ({ ...s, phase: "read" }));
  }

  function goToBreak() {
    console.log("[exam] goToBreak called — switching to break phase");
    if (breakTimerRef.current) clearInterval(breakTimerRef.current);
    const breakSeconds = 300;
    exam.setState((s) => ({ ...s, phase: "break", breakSec: breakSeconds }));
    const endTime = Date.now() + breakSeconds * 1000;
    breakTimerRef.current = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
      exam.setState((s) => (s.breakSec === remaining ? s : { ...s, breakSec: remaining }));
      if (remaining <= 0) {
        if (breakTimerRef.current) clearInterval(breakTimerRef.current);
        handleStartListening();
      }
    }, 1000);
  }

  async function handleSubmitExam() {
    // CRITICAL: trace() prints stack so we can identify the trigger source.
    // Two legitimate callers: (1) timer onEnd at line 408, (2) confirm modal OK.
    // If trace shows ANYTHING else, that's the bug.
    console.trace("[submit] handleSubmitExam called from:");
    console.log("[submit] handleSubmitExam ENTER", {
      hasCurExam: !!exam.curExam,
      isSubmitting,
      slotCount: examSlotKeys.length,
      answeredCount: Object.keys(exam.answers).length,
      visibility: typeof document !== "undefined" ? document.visibilityState : "n/a",
      timerSec: exam.timerSec,
      phase: exam.phase,
      listenQsCount: exam.listenQs.length,
    });
    if (!exam.curExam) { console.warn("[submit] EARLY EXIT: no curExam"); return; }
    // SAFETY GUARD: if we're still in the reading phase and there are unseen
    // listening questions, never finalize — divert to the break overlay so the
    // listening section actually plays before scoring.
    if (exam.phase === "read" && exam.listenQs.length > 0) {
      console.warn("[submit] redirected to break: listening section still pending");
      goToBreak();
      return;
    }
    // Prevent double-submit (timer fires + button clicked simultaneously, or double-click)
    if (isSubmitting) { console.warn("[submit] EARLY EXIT: already submitting"); return; }
    setIsSubmitting(true);

    // Wrap EVERYTHING after setIsSubmitting(true) so isSubmitting is always reset,
    // even if an unexpected error occurs mid-way.
    try {
    const curExam   = exam.curExam;
    const answers   = exam.answers;
    const timerSec  = exam.timerSec;
    const phase     = exam.phase;

    // 1) Grade EVERY slot via the secure server-side endpoint.
    //    Unanswered slots are sent with submitted_index = -1 so the server
    //    still returns correct_index for them — the review screen highlights
    //    the right answer even on questions the user skipped.
    const inputs: SubmitAnswerInput[] = [];
    for (const slotKey of examSlotKeys) {
      const qId = examSlotToQId[slotKey];
      if (!qId) continue;
      const idx = answers[slotKey];
      const submitted_index = (typeof idx === "number") ? idx : -1;
      inputs.push({
        question_id:    qId,
        exam_id:        examSlotToExamId[slotKey] ?? curExam.id,
        slot_key:       slotKey,
        submitted_index,
      });
    }
    console.log("[submit] built inputs:", { count: inputs.length, sample: inputs[0] });

    // ─── OFFLINE SAFETY NET ──────────────────────────────────────────────
    // Save the entire submission attempt to localStorage BEFORE making any
    // network calls. If everything fails (network, auth, server down), the
    // user can recover from this snapshot. Cleared on successful submit.
    const pendingKey = `pending-submit-${curExam.id}-${Date.now()}`;
    try {
      localStorage.setItem(pendingKey, JSON.stringify({
        examId: curExam.id, examName: curExam.name, examLevel: curExam.level,
        inputs, answers, timerSec, phase,
        slotTypes: examSlotTypes, slotKeys: examSlotKeys,
        userId: user?.id ?? null,
        savedAt: Date.now(),
      }));
      console.log("[submit] saved offline snapshot:", pendingKey);
    } catch (e) {
      console.warn("[submit] failed to save offline snapshot:", e);
    }
    try {
      // 1) Compute timeSpent BEFORE submit so the server (which now writes
      //    exam_results.time_spent) sees the same value the client uses for
      //    its local snapshot.
      const times     = exam.getLevelTimes();
      const readTotal = times.read * 60;
      const timeSpent = phase === "listen"
        ? readTotal + Math.max(0, times.listen * 60 - timerSec)
        : Math.max(0, readTotal - timerSec);

      console.log("[submit] calling submitAnswers...");
      const t0 = Date.now();
      const serverResp = await submitAnswers(inputs, { level: curExam.level, timeSpent });
      const serverResults = serverResp.results;
      const elapsed = Date.now() - t0;
      const correctCount = Object.values(serverResults).filter((r) => r.is_correct).length;
      const failedCount  = Object.values(serverResults).filter((r) => !r.is_correct && r.score === 0).length;
      console.log("[submit] submitAnswers DONE", {
        elapsedMs: elapsed,
        results: Object.keys(serverResults).length,
        correct: correctCount,
        failedOrWrong: failedCount,
      });

      // 2) Build a "fake" answerKey from server verdicts so the existing
      //    examLogic.submitExam + ReportModal continue to work unchanged:
      //    server returns correct_index after submit so review can highlight
      //    both the selected wrong answer and the real correct answer.
      const fakeAnswerKey: Record<string, number> = {};
      for (const slotKey of examSlotKeys) {
        const result = serverResults[slotKey];
        if (typeof result?.correct_index === "number") {
          fakeAnswerKey[slotKey] = result.correct_index;
        } else {
          fakeAnswerKey[slotKey] = -1;
        }
      }

      const report = exam.submitExam(fakeAnswerKey, answers, curExam.level, examSlotTypes);
      // Persist to state so the renderer can highlight correct choices in the report
      exam.setState((s) => ({ ...s, answerKey: fakeAnswerKey, keyTypeMap: examSlotTypes }));

      const allKeys = Object.keys(fakeAnswerKey);
      // Prefer server's authoritative score; fall back to client compute when
      // submit-batch fell back to per-question /submit-answer (no aggregate).
      const correct = serverResp.score.total > 0
        ? serverResp.score.correct
        : allKeys.filter((k) => answers[k] === fakeAnswerKey[k]).length;
      const total   = serverResp.score.total > 0
        ? serverResp.score.total
        : allKeys.length;
      const pct     = serverResp.score.total > 0
        ? serverResp.score.score_pct
        : (total ? Math.round((correct / total) * 100) : 0);

      const isPrem = isPremiumPlan(profile?.plan);
      const localTs = Date.now();
      const reportKey = "local-" + localTs;

      // Target Practice (virtual exam id) → exam_results.exam_id FK sẽ violate vì
      // virtual id không có trong bảng exams. Skip Supabase, chỉ lưu local.
      const isTargetPractice = curExam.id.startsWith("target-");

      if (!user) {
        // GUEST → localStorage only
        try { localStorage.setItem("jlptbro-report-result-" + reportKey, JSON.stringify(report)); } catch {}
        saveLocalResult(curExam.name, curExam.level, pct, timeSpent, reportKey, null);
      } else if (isTargetPractice) {
        // TARGET (logged-in) → localStorage only (skip Supabase do FK constraint)
        try { localStorage.setItem("jlptbro-report-result-" + reportKey, JSON.stringify(report)); } catch {}
        saveLocalResult(curExam.name, curExam.level, pct, timeSpent, reportKey, user.id);
      } else {
        // LOGGED-IN (free hoặc premium):
        //   1) localStorage cho lịch sử local (instant + offline-safe).
        //   2) exam_results đã được /api/exam/submit-batch insert server-side
        //      (RLS now blocks anon writes — see Bước 4 migration). Client
        //      no longer touches exam_results directly.
        try { localStorage.setItem("jlptbro-report-result-" + reportKey, JSON.stringify(report)); } catch {}
        saveLocalResult(curExam.name, curExam.level, pct, timeSpent, reportKey, user.id);

        try {
          // XP/leaderboard remains premium-only
          if (isPrem) {
            const xpEarned = correct * 10;
            if (xpEarned > 0) {
              await sb.rpc("add_my_weekly_xp", {
                p_week_start: getWeekStart(),
                p_amount:     xpEarned,
              });
            }
          }
        } catch (err) {
          console.error("[exam] XP rpc failed (local đã lưu)", err);
        }
      }

      void dash.loadDashboard();
      // Submit completed (results may include some failures, but bulk worked).
      // Remove the offline snapshot — we no longer need it.
      try { localStorage.removeItem(pendingKey); } catch {}
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[exam] submitAnswers failed:", err);
      // Keep the pending snapshot so user can retry.
      showToast(`Lỗi nộp bài: ${msg.slice(0, 80)}. Bài đã lưu, có thể thử lại.`);
    }

    } finally {
      // Always reset — covers: success, submitAnswers error, unexpected throws.
      setIsSubmitting(false);
    }
  }

  function handleExitExam() {
    if (exam.phase === "read" || exam.phase === "break" || exam.phase === "listen") {
      setConfirmModal({
        open: true,
        title: "Thoát đề thi?",
        body: "Bài làm sẽ không được lưu. Bạn có chắc muốn thoát không?",
        onOk: () => {
          setIsSubmitting(false);
          if (breakTimerRef.current) clearInterval(breakTimerRef.current);
          exam.closeExam();
          setConfirmModal((c) => ({ ...c, open: false }));
        },
      });
    } else {
      setIsSubmitting(false);
      if (breakTimerRef.current) clearInterval(breakTimerRef.current);
      exam.closeExam();
    }
  }

  function handleStartListening() {
    if (breakTimerRef.current) clearInterval(breakTimerRef.current);
    const times = exam.getLevelTimes();
    exam.startTimer(times.listen * 60, () => {
      void handleSubmitExam();
    });
    exam.setState((s) => ({ ...s, phase: "listen" }));
  }

  const setExamState = exam.setState;
  const handlePickAnswer = useCallback((key: string, idx: number) => {
    setExamState((s) => {
      if (s.answers[key] === idx) return s;
      return { ...s, answers: { ...s.answers, [key]: idx } };
    });
  }, [setExamState]);

  // ── Anki ──
  const anki = useAnki(profile);
  const ankiCardRef = useRef<HTMLDivElement>(null);
  const ankiCardRateRef = useRef<HTMLDivElement>(null);

  const [srsInfoOpen, setSrsInfoOpen] = useState(false);
  const [ankiTab, setAnkiTab] = useState<"srs" | "challenge">("srs");
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [folderNameInput, setFolderNameInput] = useState("");
  const [folderError, setFolderError] = useState("");
  const [createDeckOpen, setCreateDeckOpen] = useState(false);
  const [deckNameInput, setDeckNameInput] = useState("");
  const [deckWordsInput, setDeckWordsInput] = useState("");
  const [deckFolderId, setDeckFolderId] = useState("");
  const [deckPreviewCards, setDeckPreviewCards] = useState<AnkiCardComp[]>([]);
  const [deckError, setDeckError] = useState("");
  const [previewDeck, setPreviewDeck] = useState<AnkiDeckComp | null>(null);
  const [deckKind, setDeckKind] = useState<"vocab" | "grammar">("vocab");
  const [grammarCards, setGrammarCards] = useState<GrammarCardInput[]>([{ ...EMPTY_GRAMMAR_CARD }]);

  useEffect(() => {
    if (activeTab !== "anki" || !ready) return;
    const t = setTimeout(() => { void anki.loadAnki(); }, 0);
    return () => clearTimeout(t);
  }, [activeTab, ready, profile?.id, anki.loadAnki]);

  const ankiStudyState: AnkiStudyState | null = anki.studyDeck
    ? {
        deck: toCompDeck(anki.studyDeck),
        // studyQueue is StudyItem[] — extract the card from each item
        cards: (anki.studyQueue || []).map((item, i) => ({
          id: String(item.card.vocab_id ?? item.idx ?? i),
          word: item.card.word,
          reading: item.card.reading,
          meaning: item.card.meaning,
          meaning_jp: item.card.meaning_jp,
          han_viet: item.card.han_viet,
          word_type: item.card.word_type,
          examples: item.card.examples,
          kind: item.card.kind,
        })),
        current: anki.studyPos,
        flipped: anki.flipped,
        done: anki.studyPos >= (anki.studyQueue?.length ?? 0) && (anki.studyQueue?.length ?? 0) > 0,
        doneStats: { known: anki.totalDone, learning: anki.totalLearning },
      }
    : null;

  async function handleSaveFolder() {
    if (!folderNameInput.trim()) { setFolderError("Vui lòng nhập tên thư mục"); return; }
    if (!profile?.id) return;
    const { error } = await sb.from("anki_folders").insert({ name: folderNameInput.trim(), user_id: profile.id, is_admin: false });
    if (error) { setFolderError(error.message); return; }
    setCreateFolderOpen(false); setFolderNameInput(""); setFolderError("");
    anki.loadAnki();
  }

  function resetDeckForm() {
    setCreateDeckOpen(false);
    setDeckNameInput("");
    setDeckWordsInput("");
    setDeckPreviewCards([]);
    setDeckError("");
    setDeckKind("vocab");
    setGrammarCards([{ ...EMPTY_GRAMMAR_CARD }]);
  }

  /** Parse textarea ví dụ → array {jp, vi}. Hỗ trợ "Câu → Nghĩa" trên 1 dòng
   *  hoặc 2 dòng kế tiếp (dòng 2 bắt đầu bằng "→"). */
  function parseGrammarExamples(raw: string): { jp: string; vi: string }[] {
    const lines = raw.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    const out: { jp: string; vi: string }[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const arrowIdx = line.indexOf("→");
      if (arrowIdx >= 0) {
        out.push({ jp: line.slice(0, arrowIdx).trim(), vi: line.slice(arrowIdx + 1).trim() });
      } else {
        const next = lines[i + 1];
        if (next && next.startsWith("→")) {
          out.push({ jp: line, vi: next.slice(1).trim() });
          i++;
        } else {
          out.push({ jp: line, vi: "" });
        }
      }
    }
    return out;
  }

  async function handleSaveDeck() {
    if (!deckNameInput.trim()) { setDeckError("Vui lòng nhập tên bộ thẻ"); return; }
    if (!profile?.id) return;

    let cards: Record<string, unknown>[];

    if (deckKind === "grammar") {
      const valid = grammarCards
        .map((c) => ({ ...c, word: c.word.trim(), reading: c.reading.trim(), meaning: c.meaning.trim(), conj: c.conj.trim(), examples: c.examples }))
        .filter((c) => c.word && c.meaning);
      if (valid.length === 0) {
        setDeckError("Vui lòng nhập ít nhất 1 thẻ ngữ pháp với Tên và Nghĩa.");
        return;
      }
      cards = valid.map((c) => ({
        word:       c.word,
        reading:    c.reading,
        meaning:    c.meaning,
        meaning_jp: c.conj, // "Cách chia" được render từ field này
        word_type:  "",
        han_viet:   "",
        examples:   parseGrammarExamples(c.examples),
        kind:       "grammar",
        vocab_id:   null,
      }));
    } else {
      const words = deckWordsInput.trim().split(/[\s\n,、]+/).map((w) => w.trim()).filter(Boolean);
      if (words.length === 0) { setDeckError("Vui lòng nhập ít nhất 1 từ"); return; }

      const { data: dictEntries, error: dictErr } = await fetchDictionaryWords(sb, words);
      if (dictErr) { setDeckError(dictErr.message); return; }

      cards = words.map((w) => {
        const entry = dictEntries.find((e) => e.word === w) as Record<string, unknown> | undefined;
        return {
          word: w,
          reading: entry ? String(entry.reading ?? "") : "",
          han_viet: entry ? String(entry.han_viet ?? "") : "",
          word_type: entry ? String(entry.word_type ?? "") : "",
          meaning: entry ? String(entry.meaning ?? "") : "",
          meaning_jp: entry ? String(entry.meaning_jp ?? "") : "",
          examples: entry ? ((entry.examples as unknown[]) ?? []) : [],
          vocab_id: entry ? (entry.id ?? null) : null,
          kind: "vocab",
        };
      });
    }

    const { error: deckErr } = await sb.from("anki_decks").insert({
      name: deckNameInput.trim(),
      user_id: profile.id,
      folder_id: deckFolderId || null,
      is_admin: false,
      cards,
    });
    if (deckErr) { setDeckError(deckErr.message); return; }
    resetDeckForm();
    anki.loadAnki();
  }

  async function handlePreviewDeckWords() {
    const words = deckWordsInput.trim().split(/[\s\n]+/).filter(Boolean);
    if (!words.length) return;
    const { data, error } = await fetchDictionaryWords(sb, words);
    if (error) { setDeckError(error.message); return; }
    setDeckPreviewCards(words.map((w, i) => {
      const e = data.find((d) => d.word === w) as Record<string, unknown> | undefined;
      return { id: String(i), word: w, reading: e ? String(e.reading ?? "") : undefined, meaning: e ? String(e.meaning ?? "") : undefined };
    }));
  }

  async function handleDeleteDeck(id: string) {
    await sb.from("anki_card_progress").delete().eq("deck_id", id);
    await sb.from("anki_decks").delete().eq("id", id);
    anki.loadAnki();
  }

  async function handleDeleteFolder(id: string) {
    // Reset folder reference on decks inside folder, then delete folder
    await sb.from("anki_decks").update({ folder_id: null }).eq("folder_id", id);
    await sb.from("anki_folders").delete().eq("id", id);
    anki.loadAnki();
  }

  // ── Modals ──
  const [infoKey, setInfoKey] = useState<InfoKey | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [premiumOpen, setPremiumOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dictOpen, setDictOpen] = useState(false);
  const closeAnkiStudy = anki.closeStudy;

  const handleTabChange = useCallback((tab: TabId) => {
    if (activeTab === "anki" && tab !== "anki") {
      closeAnkiStudy();
    }
    setActiveTab(tab);
    if (tab === "anki" && (!user || !isPremiumForAnki(profile))) {
      // allow navigation, lock shown inside AnkiTab
    }
  }, [activeTab, closeAnkiStudy, user, profile]);

  const compDecks = anki.decks.map((d) => {
    const stats = anki.getDeckStats(d);
    return { ...toCompDeck(d), dueCount: stats.reviewCount, newCount: stats.newCount };
  });
  const compFolders = anki.folders.map(toCompFolder);

  // ExamResult adapter for DashboardTab (score field)
  function adaptResults(rs: ExamResult[]): (ExamResult & { score?: number; submitted_at?: string })[] {
    return rs.map((r) => ({
      ...r,
      score: r.score_pct,
      submitted_at: r.created_at,
    }));
  }

  const timerText = formatTimer(exam.timerSec);

  // Compute result stats
  const totalQs    = Object.keys(exam.answerKey).length;
  const answeredQs = Object.keys(exam.answers).length;
  const correctQs  = Object.keys(exam.answerKey).filter((k) => exam.answers[k] === exam.answerKey[k]).length;
  const wrongQs = exam.phase === "done" ? answeredQs - correctQs : 0;
  const skipQs = exam.phase === "done" ? totalQs - answeredQs : 0;
  const spentMin = exam.curExam
    ? Math.round((exam.getLevelTimes().read * 60 - exam.timerSec) / 60)
    : 0;

  return (
    <>
      <SplashScreen visible={!ready} />
      <div id="vocab-global-popup"></div>
      <div id="grammar-global-popup"></div>
      <DictFab onClick={() => setDictOpen(true)} />

      <BreakOverlay
        visible={exam.phase === "break"}
        timeLeft={breakTimeLeft}
        onStartListening={handleStartListening}
      />

      <div id="page-app" className={`page active${isInExam ? " exam-open" : ""}`}>
        <Nav
          user={user}
          profile={profile}
          authReady={ready}
          activeTab={activeTab}
          onTabChange={handleTabChange}
          onOpenPremium={() => setPremiumOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
        />
        <CountdownBar />

        {/* HOME TAB */}
        <div style={{ display: activeTab === "home" ? "flex" : "none", flex: 1, flexDirection: "column" }}>
          <HomeTab
            onSwitchTab={handleTabChange}
            onOpenInfoModal={(key) => { setInfoKey(key); setInfoOpen(true); }}
            hsUsers={hsUsers}
            hsExams={hsExams}
            hsHours={hsHours}
          />
        </div>

        {/* DASHBOARD TAB */}
        <div style={{ display: activeTab === "dashboard" ? "flex" : "none", flex: 1, flexDirection: "column" }}>
          <DashboardTab
            isLoggedIn={!!user}
            profile={profile}
            user={user}
            results={adaptResults(dash.results)}
            localResults={adaptResults(
              dash.localResults.map((r) => ({ ...r, exam_name: r.examName, score_pct: r.pct, created_at: r.ts ? new Date(r.ts).toISOString() : new Date().toISOString() }))
            )}
            skillCur={dash.skillCur as { vocab: number; grammar: number; reading: number; listen: number } | null}
            skillPrev={dash.skillPrev as { vocab: number; grammar: number; reading: number; listen: number } | null}
            onShowReport={(r) => {
              const rr = r as Record<string,unknown>;
              const storageKey = rr.reportKey
                ? "jlptbro-report-result-" + String(rr.reportKey)
                : "jlptbro-report-result-" + String(rr.id ?? "");
              try {
                const raw = localStorage.getItem(storageKey);
                if (raw) {
                  setDashReportData(JSON.parse(raw) as import("@/lib/examLogic").ReportData);
                  setDashReportName(String(rr.exam_name ?? r.level ?? "—"));
                  setReportAnimate(false);
                  setReportModalOpen(true);
                  return;
                }
              } catch {}
              showToast("Không tìm thấy báo cáo (chưa lưu hoặc đã xóa cache).");
            }}
          />
        </div>

        {/* MOCK TEST TAB */}
        <div style={{ display: activeTab === "mocktest" ? "flex" : "none", flex: 1, flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
          <MockTestTab
            exams={mockExamList}
            examsLoading={exam.examsLoading}
            examsError={exam.examsError}
            onRetryLoadExams={() => void exam.loadExams({ force: true })}
            isPremium={isPremiumPlan(profile?.plan)}
            isLoggedIn={!!user}
            userStats={userStats}
            onStartExam={handleStartExam}
            onStartTargetPractice={handleStartTargetPractice}
            startingExamId={startingExamId}
            onOpenPremium={() => setPremiumOpen(true)}
            examViewerRef={examViewerRef}
            examContentRef={examContentRef}
            examSidebarRef={examSidebarRef}
            examState={examViewState}
            onBeginExam={handleBeginExam}
            currentExam={
              exam.curExam
                ? (mockExamList.find((x) => x.id === exam.curExam!.id) ?? {
                    id: exam.curExam.id,
                    name: exam.curExam.name,
                    level: exam.curExam.level,
                    year: "",
                    questionCount: totalQs || examSlotKeys.length || (exam.readQs.length + exam.listenQs.length),
                    readMin: Math.max(1, Math.ceil((exam.readQs.length || examSlotKeys.length || 0) * 1.2)),
                    listenMin: exam.listenQs.length > 0 ? Math.max(1, Math.ceil(exam.listenQs.length * 1.5)) : 0,
                    locked: false,
                  })
                : null
            }
            phaseTag={exam.phase === "read" ? "Đọc hiểu" : exam.phase === "listen" ? "Nghe hiểu" : ""}
            phaseTagClass={exam.phase === "read" ? "read" : "listen"}
            examSubtitle={exam.curExam ? exam.curExam.level : ""}
            timerText={timerText}
            trScore={exam.reportData ? String(exam.reportData.jlpt?.totalScaled ?? exam.reportData.bjt?.score ?? correctQs) : "—"}
            trTime={`${spentMin} phút`}
            trCorrect={String(correctQs)}
            trWrong={String(wrongQs)}
            trSkip={String(skipQs)}
            progress={`${answeredQs} / ${totalQs} đã trả lời`}
            onExitClick={handleExitExam}
            isSubmitting={isSubmitting}
            onSubmitClick={() => {
              if (isSubmitting) return;
              const hasListening = exam.listenQs.length > 0;
              console.log("[exam] submit clicked", { phase: exam.phase, hasListening, listenQsCount: exam.listenQs.length });
              if (exam.phase === "read" && hasListening) {
                setConfirmModal({
                  open: true,
                  title: "Sang phần Nghe hiểu?",
                  body: "Bạn đã hoàn thành Phần Đọc hiểu. Nghỉ giữa giờ rồi tiếp tục với Phần Nghe hiểu nhé.",
                  onOk: () => { goToBreak(); setConfirmModal((c) => ({ ...c, open: false })); },
                });
              } else {
                setConfirmModal({
                  open: true,
                  title: "Nộp bài?",
                  body: `Bạn đã trả lời ${answeredQs}/${totalQs} câu. Nộp bài ngay không?`,
                  onOk: () => { handleSubmitExam(); setConfirmModal((c) => ({ ...c, open: false })); },
                });
              }
            }}
            onShowReport={() => { setReportAnimate(true); setReportModalOpen(true); }}
            allQuestions={[
              ...(exam.readQs as unknown as Record<string, unknown>[]),
              ...(exam.listenQs as unknown as Record<string, unknown>[]),
            ]}
            answers={exam.answers}
            answerKey={exam.answerKey}
            keyTypeMap={exam.keyTypeMap}
            submitted={exam.submitted}
            examPhase={exam.phase}
            examAudioUrl={(() => {
              const raw = exam.curExam?.audio_url;
              if (!raw) return undefined;
              // Plain URL string (most common — non-BJT JLPT exams).
              if (typeof raw === "string") {
                const trimmed = raw.trim();
                if (!trimmed.startsWith("{")) return trimmed || undefined;
                // Stored as a JSON-stringified object — parse and pick the
                // listening URL. Falls back to BJT keys for older data, then
                // any first non-empty URL value.
                try {
                  const parsed = JSON.parse(trimmed) as Record<string, unknown>;
                  const m = parsed as Record<string, string>;
                  const pick =
                    m.listen ?? m.legacy ?? m.bjt_part1 ?? m.part1 ?? m.bjt_part2 ?? m.part2;
                  if (pick) return pick;
                  for (const v of Object.values(m)) {
                    if (typeof v === "string" && v.trim()) return v.trim();
                  }
                  return undefined;
                } catch {
                  return trimmed || undefined;
                }
              }
              if (typeof raw === "object") {
                const m = raw as Record<string, string>;
                const pick =
                  m.listen ?? m.legacy ?? m.bjt_part1 ?? m.part1 ?? m.bjt_part2 ?? m.part2;
                if (pick) return pick;
                for (const v of Object.values(m)) {
                  if (typeof v === "string" && v.trim()) return v.trim();
                }
                return undefined;
              }
              return undefined;
            })()}
            onPick={handlePickAnswer}
            onAddToAnki={handleAddToAnki}
          />
        </div>

        {/* ANKI TAB */}
        <div style={{ display: activeTab === "anki" ? "flex" : "none", flex: 1, flexDirection: "column" }}>
          {/* Anki section sub-tabs: SRS (existing) vs Challenge (typed-recall quiz) */}
          <div className="anki-tab-switcher" style={{ padding: "16px 22px 0" }}>
            <button
              type="button"
              className={`anki-tab-btn ${ankiTab === "srs" ? "active" : ""}`}
              onClick={() => setAnkiTab("srs")}
            >🗂️ Flashcard SRS</button>
            <button
              type="button"
              className={`anki-tab-btn ${ankiTab === "challenge" ? "active" : ""}`}
              onClick={() => setAnkiTab("challenge")}
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <img src="/challenge/challenge-icon.png" alt="" width={20} height={20} style={{ display: "block", objectFit: "contain" }} />
              Challenge
            </button>
          </div>

          {ankiTab === "srs" && (
            <AnkiTab
              isLoggedIn={!!user}
              isPremium={isPremiumForAnki(profile)}
              folders={compFolders}
              decks={compDecks}
              batchSize={anki.settings.batchSize}
              studyState={ankiStudyState}
              cardRef={ankiCardRef}
              cardRateRef={ankiCardRateRef}
              onStartStudy={(d) => anki.startStudy(anki.decks.find((dk) => dk.id === d.id)!)}
              onCloseStudy={anki.closeStudy}
              onFlipCard={anki.flipCard}
              onRateCard={(r) => anki.rateCard(r === "yes")}
              onResetDeck={() => {
                if (anki.studyDeck) anki.startStudy(anki.studyDeck);
              }}
              onSetBatchSize={(n) => anki.updateSettings({ batchSize: n })}
              onOpenCreateFolder={() => setCreateFolderOpen(true)}
              onOpenCreateDeck={() => setCreateDeckOpen(true)}
              onOpenDeckPreview={(d) => {
                const full = anki.decks.find((dk) => dk.id === d.id);
                if (full) setPreviewDeck(toCompDeck(full));
              }}
              onDeleteDeck={handleDeleteDeck}
              onDeleteFolder={handleDeleteFolder}
              onToggleSrsInfo={(e) => { e.stopPropagation(); setSrsInfoOpen((o) => !o); }}
              srsInfoOpen={srsInfoOpen}
              totalDone={anki.totalDone}
              onOpenPremium={() => setPremiumOpen(true)}
            />
          )}

          {ankiTab === "challenge" && (
            <div style={{ padding: "4px 22px 22px", flex: 1, overflowY: "auto" }}>
              <ChallengeTab decks={anki.decks} progress={anki.progress} isLoggedIn={!!user} />
            </div>
          )}
        </div>

        <div style={{ display: activeTab === "chinhta" ? "flex" : "none", flex: 1, flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 48, textAlign: "center", gap: 18 }}>
          <Image src="/svg/baotri.svg" alt="Đang phát triển" width={180} height={180} priority draggable={false} style={{ maxWidth: "60vw", height: "auto" }} />
          <h2 style={{ fontFamily: "Be Vietnam Pro,Noto Sans JP,sans-serif", fontSize: 28, fontWeight: 800, color: "var(--text)", margin: 0 }}>Kakitori</h2>
          <p style={{ fontFamily: "Be Vietnam Pro,Noto Sans JP,sans-serif", fontSize: 16, color: "var(--muted)", margin: 0, maxWidth: 440 }}>Tính năng đang phát triển. Hãy quay lại sau nhé!</p>
        </div>
      </div>

      {/* Toast */}
      {toastMsg && <div className="toast show">{toastMsg}</div>}

      {/* Session-kicked overlay (anti-account-sharing) */}
      {kickedCountdown !== null && (
        <div className="kicked-overlay">
          <div className="kicked-modal">
            <div className="kicked-icon">⚠️</div>
            <h2>Tài khoản đã đăng nhập nơi khác</h2>
            <p>Tài khoản của bạn vừa được đăng nhập từ một thiết bị khác. Bạn sẽ được chuyển về trang đăng nhập sau:</p>
            <div className="kicked-countdown">{kickedCountdown}</div>
            <p className="kicked-sub">giây</p>
            <button
              type="button"
              className="btn-primary"
              onClick={() => { sb.auth.signOut().finally(() => { window.location.href = "/login"; }); }}
            >
              Đăng nhập lại ngay
            </button>
          </div>
        </div>
      )}

      {/* Modals */}
      <ExamConfirmModal
        open={confirmModal.open}
        title={confirmModal.title}
        body={confirmModal.body}
        onClose={() => setConfirmModal((c) => ({ ...c, open: false }))}
        onOk={confirmModal.onOk}
      />

      <InfoModal
        open={infoOpen}
        infoKey={infoKey}
        onClose={() => setInfoOpen(false)}
      />

      <PremiumModal
        open={premiumOpen}
        userEmail={user?.email}
        onClose={() => setPremiumOpen(false)}
      />

      <SettingsModal
        open={settingsOpen}
        user={user}
        profile={profile}
        onClose={() => setSettingsOpen(false)}
        onOpenPremium={() => setPremiumOpen(true)}
      />

      <DictPopup
        open={dictOpen}
        onClose={() => setDictOpen(false)}
      />

      <ReportModal
        open={reportModalOpen}
        reportData={dashReportData ?? exam.reportData}
        examName={dashReportData ? dashReportName : (exam.curExam ? `${exam.curExam.name} · ${exam.curExam.level}` : "—")}
        animateOnOpen={reportAnimate}
        isTarget={
          dashReportData
            ? dashReportName.startsWith("Target")
            : (exam.curExam?.id ?? "").startsWith("target-")
        }
        onClose={() => { setReportModalOpen(false); setDashReportData(null); setReportAnimate(false); }}
      />

      <CreateFolderModal
        open={createFolderOpen}
        folderName={folderNameInput}
        error={folderError}
        onNameChange={setFolderNameInput}
        onSave={handleSaveFolder}
        onClose={() => { setCreateFolderOpen(false); setFolderNameInput(""); setFolderError(""); }}
      />

      <CreateDeckModal
        open={createDeckOpen}
        deckName={deckNameInput}
        deckWords={deckWordsInput}
        error={deckError}
        preview={deckPreviewCards}
        folders={compFolders}
        selectedFolderId={deckFolderId}
        kind={deckKind}
        grammarCards={grammarCards}
        onKindChange={(k) => { setDeckKind(k); setDeckError(""); }}
        onGrammarCardsChange={setGrammarCards}
        onDeckNameChange={setDeckNameInput}
        onWordsChange={setDeckWordsInput}
        onFolderChange={setDeckFolderId}
        onPreview={handlePreviewDeckWords}
        onSave={handleSaveDeck}
        onClose={resetDeckForm}
      />

      <DeckPreviewModal
        open={!!previewDeck}
        deck={previewDeck}
        onClose={() => setPreviewDeck(null)}
      />
    </>
  );
}

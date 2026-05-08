"use client";
// ── useExam.ts ───────────────────────────────────────────────
// Exam session state: loading, phase switching, timer, submit.
// Full logic lives in htdocs/index.html — this hook is the TypeScript
// typed container. Component implementations wire in the actual logic.
// ─────────────────────────────────────────────────────────────
import { useState, useRef, useCallback } from 'react';
import { LEVEL_TIMES, BJT_PHASES, type BjtPhase } from '@/lib/constants';
import { buildReportData, type ReportData } from '@/lib/examLogic';

const EXAM_LEVEL_ORDER = ['N1', 'N2', 'N3', 'N4', 'N5', 'BJT'] as const;

export interface Exam {
  id: string;
  name: string;
  level: string;
  is_published: boolean;
  is_premium: boolean;
  created_at?: string;
  /** Hydrated from questions count */
  question_count?: number;
  /** Hydrated from exam_results count (global) */
  attempts?: number;
  year?: string | number;
  audio_url?: string | Record<string, string>;
  [key: string]: unknown;
}

export interface Question {
  key: string;
  num: number;
  type: string;
  question: string;
  choices: string[];
  correct: number;
  passage?: string;
  image_url?: string;
  audio_url?: string;
  explain?: string;
  vocab?: string;
  grammar?: string;
  [key: string]: unknown;
}

export type ExamPhase = 'idle' | 'ready' | 'read' | 'break' | 'listen' | 'done';

export interface ExamState {
  allExams:      Exam[];
  curExam:       Exam | null;
  readQs:        Question[];
  listenQs:      Question[];
  answers:       Record<string, number>;
  answerKey:     Record<string, number>;
  keyTypeMap:    Record<string, string>;
  phase:         ExamPhase;
  timerSec:      number;
  breakSec:      number;
  submitted:     boolean;
  reportData:    ReportData | null;
  bjtPhaseIndex: number;
  examsLoading:  boolean;
  examsError:    string | null;
}

export function useExam() {
  const [state, setState] = useState<ExamState>({
    allExams: [], curExam: null, readQs: [], listenQs: [],
    answers: {}, answerKey: {}, keyTypeMap: {},
    phase: 'idle', timerSec: 0, breakSec: 300,
    submitted: false, reportData: null, bjtPhaseIndex: 0,
    examsLoading: false, examsError: null,
  });
  const loadingRef = useRef(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const breakRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadExams = useCallback(async (opts?: { force?: boolean }) => {
    console.log('[useExam] loadExams called, force =', opts?.force, 'loadingRef =', loadingRef.current);
    if (loadingRef.current) { console.log('[useExam] bail: already loading'); return; }
    loadingRef.current = true;
    // bump version when exam shape changes (was v2 — broke after is_free → is_premium)
    const cacheKey  = 'jlptbro-exams-cache-v3';
    const cacheTTL  = 5 * 60 * 1000;

    if (!opts?.force) {
      try {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          const { ts, data } = JSON.parse(cached);
          if (Date.now() - ts < cacheTTL && Array.isArray(data) && data.length) {
            setState((s) => ({ ...s, allExams: data as Exam[], examsLoading: false, examsError: null }));
            loadingRef.current = false;
            return;
          }
        }
      } catch { /* ignore */ }
    }

    setState((s) => ({ ...s, examsLoading: true, examsError: null }));

    try {
      // Use raw fetch with anon apikey — DELIBERATELY skips the user's JWT.
      // The exam list is public data; using user's auth would let an
      // overly-strict RLS policy on `exams` return 0 rows for logged-in users
      // even when anon sees the same rows fine.
      const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!SUPA_URL || !ANON_KEY) throw new Error('Missing Supabase env vars');

      console.log('[useExam] fetching exams (anon)...');
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 30000);
      let resp: Response;
      try {
        resp = await fetch(
          `${SUPA_URL}/rest/v1/exams?select=*&is_published=eq.true&order=created_at.desc`,
          {
            headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
            signal: ctrl.signal,
          },
        );
      } finally {
        clearTimeout(timer);
      }
      if (!resp.ok) {
        throw new Error(`Supabase ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
      }
      const raw = (await resp.json()) as unknown;
      console.log('[useExam] fetch returned. rows =', Array.isArray(raw) ? raw.length : '(not array)');

      const rows = (Array.isArray(raw) ? raw : []) as Exam[];

      const sortRows = (rs: Exam[]): Exam[] => {
        const byLevel: Record<string, Exam[]> = {};
        for (const e of rs) {
          const L = String(e.level || '');
          if (!byLevel[L]) byLevel[L] = [];
          byLevel[L].push(e);
        }
        for (const L of Object.keys(byLevel)) {
          byLevel[L].sort((a, b) =>
            String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')),
          );
        }
        const out = EXAM_LEVEL_ORDER.flatMap((L) => byLevel[L] ?? []);
        const levelSet = new Set<string>(EXAM_LEVEL_ORDER as unknown as string[]);
        const extraLevels = Object.keys(byLevel).filter((L) => !levelSet.has(L));
        extraLevels.sort();
        for (const L of extraLevels) out.push(...(byLevel[L] ?? []));
        return out;
      };

      // Show exam list immediately — user can browse while we count questions
      const ordered = sortRows(rows);
      setState((s) => ({ ...s, allExams: ordered, examsLoading: false, examsError: null }));
      try {
        localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data: ordered }));
      } catch { /* ignore */ }

      // Background hydrate question_count + attempts — non-blocking
      void (async () => {
        try {
          const ids = rows.map((e) => e.id).filter(Boolean);
          if (!ids.length) return;

          // (a) question count
          const idsParam = ids.map((i) => `"${i}"`).join(',');
          const qcMap: Record<string, number> = {};
          try {
            const r = await fetch(
              `${SUPA_URL}/rest/v1/questions_client?select=exam_id&exam_id=in.(${idsParam})`,
              { headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } },
            );
            if (r.ok) {
              const qrows = (await r.json()) as { exam_id?: string }[];
              qrows.forEach((row) => {
                const id = row.exam_id;
                if (id) qcMap[id] = (qcMap[id] || 0) + 1;
              });
            }
          } catch { /* ignore */ }

          // (b) global attempts per exam — RPC `get_exam_attempt_counts`
          //     bypasses exam_results RLS via SECURITY DEFINER. If function
          //     not yet created, the call 404s and we just skip the field.
          const attMap: Record<string, number> = {};
          try {
            const r = await fetch(
              `${SUPA_URL}/rest/v1/rpc/get_exam_attempt_counts`,
              {
                method: 'POST',
                headers: {
                  apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`,
                  'Content-Type': 'application/json',
                },
                body: '{}',
              },
            );
            if (r.ok) {
              const arows = (await r.json()) as { exam_id: string; attempts: number }[];
              arows.forEach((row) => { attMap[row.exam_id] = Number(row.attempts) || 0; });
            }
          } catch { /* ignore */ }

          const hydrated = rows.map((e) => ({
            ...e,
            question_count: qcMap[e.id] !== undefined ? qcMap[e.id] : (e.question_count ?? 0),
            attempts: attMap[e.id] !== undefined ? attMap[e.id] : (e.attempts ?? 0),
          }));
          const orderedHydrated = sortRows(hydrated);
          setState((s) => ({ ...s, allExams: orderedHydrated }));
          try {
            localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data: orderedHydrated }));
          } catch { /* ignore */ }
        } catch (hydrateErr) {
          console.warn('[useExam] hydrate failed (non-fatal):', hydrateErr);
        }
      })();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Không tải được đề thi.';
      // Verbose log to make root-cause obvious in DevTools
      console.error('[useExam] load exams failed:', msg, '\nFull error object:', err);
      // Fallback: try expired cache as last resort
      try {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          const { data } = JSON.parse(cached);
          if (Array.isArray(data) && data.length) {
            setState((s) => ({ ...s, allExams: data as Exam[], examsLoading: false, examsError: null }));
            loadingRef.current = false;
            return;
          }
        }
      } catch { /* ignore */ }
      setState((s) => ({ ...s, examsLoading: false, examsError: msg }));
    } finally {
      loadingRef.current = false;
    }
  }, []);

  const isBjt = useCallback(() => state.curExam?.level === 'BJT', [state.curExam]);

  const getCurrentBjtPhase = useCallback((): BjtPhase => {
    const idx = Math.max(0, Math.min(state.bjtPhaseIndex, BJT_PHASES.length - 1));
    return BJT_PHASES[idx];
  }, [state.bjtPhaseIndex]);

  const getBjtQuestionsForCurrentPhase = useCallback((): Question[] => {
    const phase = getCurrentBjtPhase();
    return state.readQs.filter((q) => phase.types.includes(q.type));
  }, [state.readQs, getCurrentBjtPhase]);

  const getExamAudioMeta = useCallback((): Record<string, string> => {
    const raw = state.curExam?.audio_url;
    if (!raw) return {};
    if (typeof raw === 'object') return raw as Record<string, string>;
    try { return JSON.parse(raw as string); } catch { return { legacy: String(raw) }; }
  }, [state.curExam]);

  const getLevelTimes = useCallback(() => {
    const lvl = state.curExam?.level ?? '';
    return LEVEL_TIMES[lvl] ?? { read: 90, listen: 45 };
  }, [state.curExam]);

  const startTimer = useCallback((sec: number, onEnd: () => void) => {
    if (timerRef.current) clearInterval(timerRef.current);
    // Wall-clock based timer — DOES NOT decrement a counter, computes remaining
    // from Date.now() each tick. This fixes the background-tab bug where
    // browsers throttle setInterval and then "catch up" with a burst of ticks
    // when the tab becomes visible again, decrementing the counter rapidly
    // past zero and triggering a phantom auto-submit.
    const endTime = Date.now() + sec * 1000;
    let onEndFired = false;
    const fireOnce = () => {
      if (onEndFired) return;
      onEndFired = true;
      if (timerRef.current) clearInterval(timerRef.current);
      onEnd();
    };
    setState((s) => ({ ...s, timerSec: sec }));
    timerRef.current = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
      setState((s) => (s.timerSec === remaining ? s : { ...s, timerSec: remaining }));
      if (remaining <= 0) fireOnce();
    }, 1000);
  }, []);

  const submitExam = useCallback((allKey: Record<string, number>, allAns: Record<string, number>, level: string, keyTypeMap: Record<string, string>): ReportData => {
    if (timerRef.current) clearInterval(timerRef.current);
    const report = buildReportData(allKey, allAns, level, keyTypeMap);
    setState((s) => ({ ...s, submitted: true, phase: 'done', reportData: report }));
    return report;
  }, []);

  const closeExam = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (breakRef.current) clearInterval(breakRef.current);
    setState((s) => ({
      ...s, curExam: null, readQs: [], listenQs: [],
      answers: {}, answerKey: {}, keyTypeMap: {},
      phase: 'idle', timerSec: 0, submitted: false, reportData: null, bjtPhaseIndex: 0,
    }));
  }, []);

  return {
    ...state,
    loadExams, isBjt, getCurrentBjtPhase, getBjtQuestionsForCurrentPhase,
    getExamAudioMeta, getLevelTimes, startTimer, submitExam, closeExam,
    setState,
  };
}

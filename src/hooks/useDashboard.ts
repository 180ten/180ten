"use client";
// ── useDashboard.ts ──────────────────────────────────────────
// Dashboard: history, stats, spider chart data, rank/streak.
// Logic migrated from htdocs/index.html (renderDashStats,
// renderSkillDeltas, loadRankSection, getMyStreak, getMyWeekXP).
// ─────────────────────────────────────────────────────────────
import { useState, useCallback } from 'react';
import { sb } from '@/lib/supabase';
import { SKILL_AXES, LOCAL_RESULTS_KEY } from '@/lib/constants';
import { pctFromGroup, type GroupsMap } from '@/lib/examLogic';
import type { Profile } from './useAuth';

export interface ExamResult {
  id?: string;
  exam_id?: string;
  exam_name: string;
  level: string;
  score_pct: number;
  report_data?: unknown;
  created_at?: string;
  [key: string]: unknown;
}

export interface LocalResult {
  examName: string; level: string; pct: number; spentSec: number; ts: number; reportKey?: string;
  /** Owner of this entry. Empty/undefined = guest. Used to prevent cross-account leakage. */
  userId?: string | null;
}

// No `id`/`user_id` exposed to the client — leaderboard reads only the
// sanitised view `leaderboard_public` and the `get_my_weekly_rank` RPC.
export interface RankEntry { name: string; xp: number; rank: number; }

export function getWeekStart(): string {
  const now  = new Date();
  const day  = now.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const mon  = new Date(now);
  mon.setDate(now.getDate() + diff);
  mon.setHours(0, 0, 0, 0);
  return mon.toISOString().slice(0, 10);
}

export interface DashboardState {
  results:       ExamResult[];
  localResults:  LocalResult[];
  loading:       boolean;
  rankTop:       RankEntry[];
  myRank:        number | null;
  myXp:          number;
  streak:        number;
  weekDays:      boolean[];
  skillCur:      Record<string, number> | null;
  skillPrev:     Record<string, number> | null;
}

/** Read all entries (no filter). Internal use only. */
function getAllLocalResults(): LocalResult[] {
  try {
    const raw = localStorage.getItem(LOCAL_RESULTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

/**
 * Read local results filtered by owner. Pass `userId` for logged-in user;
 * pass `null`/`undefined` for guest mode (only returns entries with no owner).
 */
export function getLocalResults(userId?: string | null): LocalResult[] {
  const all = getAllLocalResults();
  if (userId) return all.filter((r) => r.userId === userId);
  // Guest mode: only entries that were also created in guest mode
  return all.filter((r) => !r.userId);
}

export function saveLocalResult(examName: string, level: string, pct: number, spentSec: number, reportKey?: string, userId?: string | null): void {
  try {
    const arr = getAllLocalResults();
    arr.unshift({ examName, level, pct, spentSec, ts: Date.now(), reportKey, userId: userId ?? null });
    localStorage.setItem(LOCAL_RESULTS_KEY, JSON.stringify(arr.slice(0, 100)));
  } catch {}
}

/**
 * Wipe ALL local exam data: the result list + every saved report blob.
 * Call this on logout so a subsequent guest session doesn't leak the
 * previous user's history.
 */
export function clearLocalExamData(): void {
  try {
    localStorage.removeItem(LOCAL_RESULTS_KEY);
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('jlptbro-report-result-')) toRemove.push(k);
    }
    toRemove.forEach((k) => localStorage.removeItem(k));
  } catch {}
}

/** Build skill % map from a list of ExamResult with report_data */
export function buildSkillPcts(results: ExamResult[]): Record<string, number> | null {
  if (!results.length) return null;
  const agg: GroupsMap = { vocab: { c: 0, t: 0 }, grammar: { c: 0, t: 0 }, reading: { c: 0, t: 0 }, listen: { c: 0, t: 0 } };
  let hasData = false;
  results.forEach((r) => {
    const rd = r.report_data as { groups?: GroupsMap } | null;
    if (!rd?.groups) return;
    hasData = true;
    SKILL_AXES.forEach(({ key }) => {
      const g = rd.groups![key];
      if (g) { agg[key].c += g.c; agg[key].t += g.t; }
    });
  });
  if (!hasData) return null;
  const pcts: Record<string, number> = {};
  SKILL_AXES.forEach(({ key }) => { pcts[key] = pctFromGroup(agg[key]); });
  return pcts;
}

export function useDashboard(profile: Profile | null) {
  const [state, setState] = useState<DashboardState>({
    results: [], localResults: [], loading: false,
    rankTop: [], myRank: null, myXp: 0, streak: 0, weekDays: Array(7).fill(false),
    skillCur: null, skillPrev: null,
  });

  const loadDashboard = useCallback(async () => {
    const localRs = getLocalResults(profile?.id ?? null);

    // Adapt localStorage results → ExamResult shape (with report_data loaded from storage)
    const adaptedLocal: ExamResult[] = localRs.map((r) => {
      let report_data: unknown = null;
      if (r.reportKey) {
        try {
          const raw = localStorage.getItem('jlptbro-report-result-' + r.reportKey);
          if (raw) report_data = JSON.parse(raw);
        } catch {}
      }
      return {
        id: r.reportKey,
        exam_name: r.examName,
        level: r.level,
        score_pct: r.pct,
        report_data,
        created_at: r.ts ? new Date(r.ts).toISOString() : new Date().toISOString(),
        reportKey: r.reportKey,
      } as ExamResult;
    });

    // Guest only: display local history (guest never writes to Supabase)
    if (!profile?.id) {
      setState((s) => ({
        ...s,
        results: adaptedLocal,
        localResults: localRs,
        skillCur: buildSkillPcts(adaptedLocal.slice(0, 5)),
        skillPrev: buildSkillPcts(adaptedLocal.slice(5, 10)),
        loading: false,
      }));
      return;
    }

    // Any logged-in user (free OR premium): Supabase is source of truth
    setState((s) => ({ ...s, loading: true }));
    // No FK on exam_results.exam_id → don't try to join `exams`. Fetch flat,
    // resolve exam_name client-side. Try `created_at` order first; if missing,
    // retry without order so the dashboard still works on partial schemas.
    let rs: Array<Record<string, unknown>> | null = null;
    let rsErr: { message: string } | null = null;
    {
      const r = await sb
        .from('exam_results')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      rs = r.data; rsErr = r.error;
      if (rsErr && /created_at.*does not exist|column .* does not exist/i.test(rsErr.message)) {
        console.warn('[Dashboard] exam_results missing created_at — retry unordered');
        const r2 = await sb.from('exam_results').select('*').limit(50);
        rs = r2.data; rsErr = r2.error;
      }
    }
    console.log('[Dashboard] load exam_results:', { error: rsErr?.message, count: rs?.length });

    // Resolve exam_name + level via separate query (no FK on exam_id, can't JOIN).
    // Use anon raw fetch — exams is public via RLS.
    const ids = Array.from(new Set(((rs || []) as Array<{ exam_id?: string }>).map((r) => r.exam_id).filter(Boolean) as string[]));
    const examMeta = new Map<string, { name?: string; level?: string }>();
    if (ids.length > 0) {
      const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (SUPA_URL && ANON_KEY) {
        try {
          const idsParam = ids.map((i) => `"${i}"`).join(',');
          const r = await fetch(
            `${SUPA_URL}/rest/v1/exams?select=id,name,level&id=in.(${idsParam})`,
            { headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } },
          );
          if (r.ok) {
            const rows = (await r.json()) as { id: string; name?: string; level?: string }[];
            rows.forEach((x) => examMeta.set(String(x.id), { name: x.name, level: x.level }));
          }
        } catch (e) { console.warn('[Dashboard] resolve exam meta failed:', e); }
      }
    }

    const remote = ((rs || []) as Array<Record<string, unknown>>).map((r) => {
      const meta = examMeta.get(String(r.exam_id ?? ''));
      return {
        ...r,
        exam_name: meta?.name ?? String(r.exam_name ?? ''),
        level:     meta?.level ?? String(r.level ?? ''),
      } as ExamResult;
    });

    // Merge remote + local (deduped). Đảm bảo lịch sử không biến mất khi
    // Supabase save thất bại hoặc RLS chặn SELECT — local luôn là phao cứu sinh.
    // Dedupe key ưu tiên (exam_id + created_at-second) để không trùng giữa
    // bản remote và bản local copy của cùng một lượt làm bài.
    const seen = new Set<string>();
    const merged: ExamResult[] = [];
    const pushIfNew = (r: ExamResult) => {
      const ts = r.created_at ? new Date(String(r.created_at)).getTime() : 0;
      // Bucket timestamp theo phút để tránh lệch ms giữa local-ts và DB-ts
      const bucket = ts ? Math.floor(ts / 60000) : 0;
      const key = `${r.exam_id ?? r.exam_name ?? ''}_${bucket}_${Math.round(Number(r.score_pct) || 0)}`;
      if (seen.has(key)) return;
      seen.add(key);
      merged.push(r);
    };
    remote.forEach(pushIfNew);
    adaptedLocal.forEach(pushIfNew);

    // Sort newest-first
    merged.sort((a, b) => {
      const ta = a.created_at ? new Date(String(a.created_at)).getTime() : 0;
      const tb = b.created_at ? new Date(String(b.created_at)).getTime() : 0;
      return tb - ta;
    });

    const results = merged;
    const cur  = buildSkillPcts(results.slice(0, 5));
    const prev = buildSkillPcts(results.slice(5, 10));

    setState((s) => ({
      ...s,
      results,
      localResults: localRs,
      skillCur: cur,
      skillPrev: prev,
      loading: false,
    }));
  }, [profile]);

  const loadRankSection = useCallback(async () => {
    const weekStart = getWeekStart();

    // 1) Top 10 — sanitised view, NO user_id in response
    const { data: topRaw } = await sb
      .from('leaderboard_public')
      .select('display_name, xp, rank')
      .eq('week_start', weekStart)
      .order('rank', { ascending: true })
      .limit(10);

    const top: RankEntry[] = (topRaw ?? []).map((r) => ({
      name: String((r as { display_name?: string }).display_name ?? '—'),
      xp:   Number((r as { xp?: number }).xp ?? 0),
      rank: Number((r as { rank?: number }).rank ?? 0),
    }));
    setState((s) => ({ ...s, rankTop: top }));

    if (!profile?.id) return;

    // 2) My own xp/rank — RPC (server uses auth.uid(), no user_id sent from client)
    //    Streak is on `profiles` (own row) and is fine to read directly.
    const [{ data: rankRow }, { data: me }] = await Promise.all([
      sb.rpc('get_my_weekly_rank', { p_week_start: weekStart }).single(),
      sb.from('profiles').select('streak,streak_days').eq('id', profile.id).single(),
    ]);

    const myXp   = Number((rankRow as { my_xp?: number } | null)?.my_xp   ?? 0);
    const myRank = Number((rankRow as { my_rank?: number } | null)?.my_rank ?? 0);

    setState((s) => ({
      ...s,
      myRank:   myRank > 0 ? myRank : null,
      myXp,
      streak:   (me?.streak as number) ?? 0,
      weekDays: (me?.streak_days as boolean[]) ?? Array(7).fill(false),
    }));
  }, [profile]);

  return { ...state, loadDashboard, loadRankSection };
}

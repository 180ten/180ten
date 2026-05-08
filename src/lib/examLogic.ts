// ── examLogic.ts ─────────────────────────────────────────────
// Score calculation and report building, migrated verbatim from
// htdocs/index.html (buildJLPTScores, buildBJTScores, buildReportData)
// ─────────────────────────────────────────────────────────────

import { TYPE_MONDAI_MAP, JLPT_SECTION_CFG, JLPT_PASSING } from './constants';

export interface GroupStats { c: number; t: number; correct?: number; total?: number; }
export type GroupsMap = Record<string, GroupStats>;

export interface SectionResult {
  label: string; sub: string; vi: string; color: string;
  correct: number; total: number; scaled: number; max: number; min: number;
  pass: boolean;
}

export interface JlptResult {
  sections: Record<string, SectionResult>;
  order: string[];
  totalScaled: number;
  totalMax: number;
  minTotal: number;
  pass: boolean;
  level: string;
}

export function buildJLPTScores(level: string, groups: GroupsMap): JlptResult | null {
  const cfg     = JLPT_SECTION_CFG[level];
  const passing = JLPT_PASSING[level] || {};
  if (!cfg) return null;

  const secs: Record<string, SectionResult> = {};
  (cfg.order as string[]).forEach((sKey) => {
    const sec = (cfg as Record<string, unknown>)[sKey] as { label: string; sub: string; vi: string; color: string; groups: string[]; max: number };
    let c = 0, t = 0;
    sec.groups.forEach((g: string) => {
      c += (groups[g] || { c: 0 }).c;
      t += (groups[g] || { t: 0 }).t;
    });
    const scaled = t > 0 ? Math.round(c / t * sec.max) : 0;
    const min    = passing[sKey] || 0;
    secs[sKey] = {
      label: sec.label, sub: sec.sub, vi: sec.vi, color: sec.color,
      correct: c, total: t, scaled, max: sec.max, min,
      pass: (t > 0 && scaled >= min),
    };
  });

  const totalScaled = (cfg.order as string[]).reduce((s, k) => s + secs[k].scaled, 0);
  const allPass     = (cfg.order as string[]).every((k) => secs[k].pass);
  const minTotal    = passing.total || 0;
  return {
    sections: secs,
    order: cfg.order as string[],
    totalScaled, totalMax: cfg.total as number, minTotal,
    pass: (totalScaled >= minTotal && allPass),
    level,
  };
}

export function getBjtGrade(score: number): string {
  if (score >= 600) return 'J1+';
  if (score >= 530) return 'J1';
  if (score >= 420) return 'J2';
  if (score >= 320) return 'J3';
  if (score >= 200) return 'J4';
  return 'J5';
}

export interface BjtPartResult {
  key: string; label: string; sub: string; color: string;
  correct: number; total: number; score: number; max: number; pct: number;
}

export interface BjtResult {
  score: number; scoreRaw: number; maxScore: number;
  grade: string; correct: number; total: number;
  sections: Record<string, BjtPartResult>;
  order: string[];
}

export function buildBJTScores(groups: GroupsMap, stats: Record<string, GroupStats>): BjtResult {
  const allTypes = Object.keys(stats || {}).filter((t) => {
    const m = TYPE_MONDAI_MAP[t];
    return m && (m.group === 'bjt_listen' || m.group === 'bjt_chodokkai' || m.group === 'bjt_reading');
  });
  const totalQ   = allTypes.reduce((s, t) => s + (stats[t] ? stats[t].t : 0), 0);
  const totalC   = allTypes.reduce((s, t) => s + (stats[t] ? stats[t].c : 0), 0);
  const scoreRaw = totalC * 10;
  const score    = Math.max(0, Math.min(800, scoreRaw));

  const parts: Record<string, BjtPartResult> = {
    bjt_listen:    { key: 'bjt_listen',    label: '聴解',   sub: '第１部', color: '#0ea5e9', correct: (groups.bjt_listen    || { c: 0 }).c, total: (groups.bjt_listen    || { t: 0 }).t, score: 0, max: 0, pct: 0 },
    bjt_chodokkai: { key: 'bjt_chodokkai', label: '聴読解', sub: '第２部', color: '#f59e0b', correct: (groups.bjt_chodokkai || { c: 0 }).c, total: (groups.bjt_chodokkai || { t: 0 }).t, score: 0, max: 0, pct: 0 },
    bjt_reading:   { key: 'bjt_reading',   label: '読解',   sub: '第３部', color: '#22c55e', correct: (groups.bjt_reading   || { c: 0 }).c, total: (groups.bjt_reading   || { t: 0 }).t, score: 0, max: 0, pct: 0 },
  };
  Object.keys(parts).forEach((k) => {
    const p = parts[k];
    p.score = p.correct * 10;
    p.max   = p.total   * 10;
    p.pct   = p.total > 0 ? Math.round(p.correct / p.total * 100) : 0;
  });

  return { score, scoreRaw, maxScore: 800, grade: getBjtGrade(score), correct: totalC, total: totalQ, sections: parts, order: ['bjt_listen','bjt_chodokkai','bjt_reading'] };
}

export interface ReportData {
  stats:  Record<string, GroupStats>;
  groups: GroupsMap;
  jlpt:   JlptResult | null;
  bjt:    BjtResult  | null;
  level:  string;
}

/** Build full report data from answer key and user answers. keyTypeMap: questionKey → qType */
export function buildReportData(
  allKey: Record<string, number>,
  allAns: Record<string, number>,
  level: string,
  keyTypeMap: Record<string, string>,
): ReportData {
  const stats: Record<string, GroupStats> = {};
  Object.keys(allKey).forEach((k) => {
    const type = keyTypeMap[k];
    if (!type) return;
    if (!stats[type]) stats[type] = { c: 0, t: 0 };
    stats[type].t!++;
    if (allAns[k] === allKey[k]) stats[type].c++;
  });

  const groups: GroupsMap = {
    vocab:         { c: 0, t: 0 }, grammar:       { c: 0, t: 0 },
    reading:       { c: 0, t: 0 }, listen:         { c: 0, t: 0 },
    bjt_listen:    { c: 0, t: 0 }, bjt_chodokkai: { c: 0, t: 0 }, bjt_reading: { c: 0, t: 0 },
  };
  Object.keys(stats).forEach((type) => {
    const m = TYPE_MONDAI_MAP[type];
    if (!m) return;
    groups[m.group].c += stats[type].c;
    groups[m.group].t += stats[type].t;
  });

  const jlpt = (level && level !== 'BJT') ? buildJLPTScores(level, groups) : null;
  const bjt  = (level === 'BJT')           ? buildBJTScores(groups, stats)  : null;
  return { stats, groups, jlpt, bjt, level };
}

/** pct from a GroupStats object */
export function pctFromGroup(g: GroupStats | undefined): number {
  if (!g || !g.t) return 0;
  return Math.round(g.c / g.t * 100);
}

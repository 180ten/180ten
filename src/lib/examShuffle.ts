// src/lib/examShuffle.ts
// Single source of truth for choice shuffling — used by:
//   • /api/exam/[id]/start          → shuffle [correct,...wrongs] into `choices`
//   • /api/exam/submit-answer       → re-derive expected position to grade
//
// The shuffle is *deterministic* for a given (userId, examId, slotKey).
// Server can therefore re-derive position at submit time without storing it.

// ─── Type sets (mirror examRender.ts) ─────────────────────────────────
export const SIMPLE_TYPES = new Set<string>([
  "kanji", "bunmyaku", "iikae", "yoho", "bunpo1", "bunpo2", "hyouki",
  "bjt_3_1", "bjt_3_2",
]);
export const PASSAGE_TYPES = new Set<string>([
  "tan", "chu", "cho", "togo", "shudai", "joho",
]);
const SIMPLE_BJT_TYPES = new Set<string>([
  "bjt_1_1", "bjt_1_2", "bjt_2_1", "bjt_2_2",
]);
// Listen mondai that print no choice text — learner just hears
// "1番…2番…" and picks a number, so admins choose the correct
// position via radio in ComposeTab and we render fixed
// `["1","2",…]` choices like bjt_1_3 / bjt_2_3.
const FIXED_CHOICE_LISTEN_TYPES = new Set<string>([
  "listen_gaiyou", "listen_sokuji",
]);

/** N4/N5 概要理解 prints 1から3 on the test paper; everywhere else
 *  uses 4 choices. listen_sokuji is always 3. */
function fixedChoiceCount(type: string, level: string | null | undefined): 3 | 4 {
  if (type === "listen_sokuji") return 3;
  if (type === "listen_gaiyou") {
    const lv = String(level ?? "").toUpperCase();
    return (lv === "N4" || lv === "N5") ? 3 : 4;
  }
  return 4; // safe default; never reached given current callers
}

/** listen_togo type2 sub-questions store admin input as `options[4]`
 *  + `correctIdx`. Adapt to the legacy `correct + wrongs` shape that
 *  applyShuffle / nChoices already understand. Falls back to the
 *  legacy fields when `options` is absent so old saves keep working. */
function readT2Sub(sq: SubQ): { correct: string; wrongs: string[] } {
  if (Array.isArray(sq.options)) {
    const options = (sq.options as unknown[]).map((v) => String(v ?? ""));
    const rawIdx = parseInt(String(sq.correctIdx ?? "0"), 10);
    const safeIdx = isNaN(rawIdx) || rawIdx < 0 || rawIdx >= options.length ? 0 : rawIdx;
    return {
      correct: options[safeIdx] ?? "",
      wrongs: options.filter((_, i) => i !== safeIdx),
    };
  }
  return {
    correct: String(sq.correct ?? ""),
    wrongs: ((sq.wrongs as string[]) ?? []).map(String),
  };
}

// ─── SubQ shape (loose) ──────────────────────────────────────────────
export interface SubQ {
  question?: string;
  mainQuestion?: string;
  correct?: string;
  wrongs?: string[];
  choices?: string[]; // populated AFTER sanitize
  explanation?: string;
  vocab?: string;
  grammar?: string;
  imageUrl?: string;
  imageurl?: string;
  image_url?: string;
  [k: string]: unknown;
}

export interface PassageGroupShape {
  text?: string;
  questions?: SubQ[];
  [k: string]: unknown;
}

/**
 * `togo` (統合理解) is composed in two shapes:
 *   1. Compact (current admin form & CSV import): `passages: string[]` (A & B
 *      texts) + a top-level `questions: SubQ[]` shared by both.
 *   2. Legacy passage shape: `passages: PassageGroupShape[]` like tan/chu/cho.
 * Detect (1) so the player + grader can route accordingly.
 */
function isTogoCompactShape(data: Record<string, unknown>): boolean {
  const ps = data.passages;
  if (!Array.isArray(ps) || ps.length === 0) return false;
  return ps.every((p) => typeof p === "string");
}

// ─── Deterministic hash (FNV-1a 32-bit) ──────────────────────────────
export function hashToInt(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function deterministicPos(
  userId: string,
  examId: string,
  slotKey: string,
  n: number,
): number {
  if (n <= 1) return 0;
  return hashToInt(`${userId}|${examId}|${slotKey}`) % n;
}

export interface AnswerSlotPlan {
  slotKey: string;
  n: number;
}

export type AnswerPositionMap = Record<string, number>;

function byHash(seed: string) {
  return (a: string | number, b: string | number) =>
    hashToInt(`${seed}|${a}`) - hashToInt(`${seed}|${b}`);
}

function pushSlot(slots: AnswerSlotPlan[], slotKey: string, node: SubQ | undefined) {
  if (!node) return;
  const n = nChoices(node.correct, node.wrongs);
  if (n > 1) slots.push({ slotKey, n });
}

export function collectAnswerSlots(q: RawQuestion): AnswerSlotPlan[] {
  const id = String(q.id);
  const type = String(q.type);
  const data = (q.data ?? {}) as Record<string, unknown>;
  const slots: AnswerSlotPlan[] = [];

  if (SIMPLE_TYPES.has(type) || SIMPLE_BJT_TYPES.has(type)) {
    pushSlot(slots, id, data as SubQ);
  } else if (type === "bunsho") {
    ((data.questions as SubQ[]) ?? []).forEach((sq, i) => pushSlot(slots, `${id}-b-${i}`, sq));
  } else if (type === "togo" && isTogoCompactShape(data)) {
    ((data.questions as SubQ[]) ?? []).forEach((sq, i) => pushSlot(slots, `${id}-q-${i}`, sq));
  } else if (PASSAGE_TYPES.has(type)) {
    ((data.passages as PassageGroupShape[]) ?? []).forEach((p, pIdx) => {
      (p.questions ?? []).forEach((sq, qIdx) => pushSlot(slots, `${id}-${pIdx}-${qIdx}`, sq));
    });
  } else if (type === "listen_togo") {
    // t1 is fixed-choice (radio 1/2/3/4) — no balancing needed.
    // t2 sub-questions read options/correctIdx (or legacy
    // correct/wrongs) before joining the balanced position map.
    ((data.type2 as { questions?: SubQ[] } | undefined)?.questions ?? []).forEach((sq, i) => {
      const { correct, wrongs } = readT2Sub(sq);
      const n = nChoices(correct, wrongs);
      if (n > 1) slots.push({ slotKey: `${id}-t2-${i}`, n });
    });
  } else if (type.startsWith("listen_")) {
    ((data.questions as SubQ[]) ?? []).forEach((sq, i) => pushSlot(slots, `${id}-${i}`, sq));
  }

  return slots;
}

export function buildBalancedPositionMap(
  slots: AnswerSlotPlan[],
  seed: string,
  scope: string,
): AnswerPositionMap {
  const out: AnswerPositionMap = {};
  const byN = new Map<number, AnswerSlotPlan[]>();
  for (const slot of slots) {
    if (slot.n <= 1) { out[slot.slotKey] = 0; continue; }
    const arr = byN.get(slot.n) ?? [];
    arr.push(slot);
    byN.set(slot.n, arr);
  }

  for (const [n, group] of byN) {
    const orderedSlots = [...group].sort((a, b) => byHash(`${seed}|${scope}|slot|${n}`)(a.slotKey, b.slotKey));
    const base = Math.floor(group.length / n);
    const rem = group.length % n;
    const remPositions = Array.from({ length: n }, (_, i) => i).sort(byHash(`${seed}|${scope}|rem|${n}`)).slice(0, rem);
    const bag: number[] = [];
    for (let pos = 0; pos < n; pos++) {
      for (let i = 0; i < base; i++) bag.push(pos);
    }
    bag.push(...remPositions);
    const orderedBag = bag
      .map((pos, i) => ({ pos, key: `${pos}-${i}` }))
      .sort((a, b) => byHash(`${seed}|${scope}|bag|${n}`)(a.key, b.key))
      .map((x) => x.pos);
    orderedSlots.forEach((slot, i) => { out[slot.slotKey] = orderedBag[i] ?? 0; });
  }

  return out;
}

export function buildBalancedPositionMapForQuestions(
  rows: RawQuestion[],
  seed: string,
  scope: string,
): AnswerPositionMap {
  return buildBalancedPositionMap(rows.flatMap(collectAnswerSlots), seed, scope);
}

// ─── Choice helpers ──────────────────────────────────────────────────
export function nChoices(
  correct: string | undefined,
  wrongs: string[] | undefined,
): number {
  const w = (wrongs ?? []).filter(Boolean).length;
  return Math.min(4, 1 + w) || 1;
}

/** Shuffle `wrongs` deterministically with `seedVal` (mulberry32) and
 *  then splice `correct` in at `pos`. Wrongs order and correct position
 *  are independent — grading still cares only about the correct slot,
 *  so re-deriving wrongs order at submit time is not required.
 *  Falls back to `Math.random()` when no seed is given (callers from
 *  tests / scripts that don't care about determinism). */
export function shuffleChoices(
  correct: string,
  wrongs: string[],
  pos: number,
  seedVal?: number,
): string[] {
  const cleaned = [correct, ...(wrongs ?? [])].filter(Boolean);
  if (cleaned.length < 2) return cleaned;

  const wrongList = [...(wrongs ?? [])].filter(Boolean);

  // mulberry32 — small, fast, no allocations beyond the closure. Same
  // seed → same permutation, so refresh during exam stays stable.
  const rand = seedVal !== undefined
    ? (() => {
        let s = seedVal >>> 0;
        return () => {
          s = (s + 0x6D2B79F5) >>> 0;
          let t = Math.imul(s ^ (s >>> 15), 1 | s);
          t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
      })()
    : () => Math.random();

  for (let i = wrongList.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [wrongList[i], wrongList[j]] = [wrongList[j], wrongList[i]];
  }

  const safePos = Math.max(0, Math.min(pos, wrongList.length));
  wrongList.splice(safePos, 0, correct);
  return wrongList;
}

// ─── Question shape passed in/out of the helpers ────────────────────
export interface RawQuestion {
  id: string;
  type: string;
  level?: string | null;
  order_index?: number | null;
  data: Record<string, unknown>;
  /** Per-question audio override (review mode). Falls back to
   *  data.audioUrl / exam.audio_url at render time. */
  audio_url?: string | null;
  /** JSON-stringified AudioScriptLine[] (see lib/audioScript.ts). */
  audio_script?: string | null;
}

export interface SanitizedQuestion {
  id: string;
  type: string;
  level?: string | null;
  order_index?: number | null;
  data: Record<string, unknown>; // contains `choices` arrays, no `correct`/`wrongs`
  audio_url?: string | null;
  audio_script?: string | null;
}

// ─── Internal: replace correct+wrongs with shuffled choices ─────────
function applyShuffle(
  node: SubQ,
  userId: string,
  examId: string,
  slotKey: string,
  posMap?: AnswerPositionMap,
): void {
  const correct = String(node.correct ?? "");
  const wrongs = (node.wrongs ?? []) as string[];
  const n = nChoices(correct, wrongs);
  const pos = posMap?.[slotKey] ?? deterministicPos(userId, examId, slotKey, n);
  // Distinct namespace from deterministicPos so the wrongs permutation
  // is independent of the correct-position pick.
  const wrongsSeed = hashToInt(`${userId}|${examId}|${slotKey}|wrongs`);
  node.choices = shuffleChoices(correct, wrongs, pos, wrongsSeed);
  delete node.correct;
  delete node.wrongs;
}

// ─── Sanitize a single question + collect its slot keys ─────────────
export function sanitizeQuestion(
  q: RawQuestion,
  userId: string,
  examId: string,
  posMap?: AnswerPositionMap,
): { sanitized: SanitizedQuestion; slotKeys: string[] } {
  const id = String(q.id);
  const type = String(q.type);
  // Deep clone so we don't mutate caller's data
  const data = JSON.parse(JSON.stringify(q.data ?? {})) as Record<string, unknown>;
  const slotKeys: string[] = [];

  if (SIMPLE_TYPES.has(type) || SIMPLE_BJT_TYPES.has(type)) {
    applyShuffle(data as SubQ, userId, examId, id, posMap);
    slotKeys.push(id);

  } else if (type === "bjt_1_3" || type === "bjt_2_3") {
    // Fixed choices ['1','2','3','4']. Strip correct, no shuffle.
    (data as SubQ).choices = ["1", "2", "3", "4"];
    delete (data as SubQ).correct;
    delete (data as SubQ).wrongs;
    slotKeys.push(id);

  } else if (type === "bunsho") {
    const subQs = (data.questions as SubQ[]) ?? [];
    subQs.forEach((sq, i) => {
      const key = `${id}-b-${i}`;
      applyShuffle(sq, userId, examId, key, posMap);
      slotKeys.push(key);
    });

  } else if (type === "togo" && isTogoCompactShape(data)) {
    const subQs = (data.questions as SubQ[]) ?? [];
    subQs.forEach((sq, i) => {
      const key = `${id}-q-${i}`;
      applyShuffle(sq, userId, examId, key, posMap);
      slotKeys.push(key);
    });

  } else if (PASSAGE_TYPES.has(type)) {
    const passages = (data.passages as PassageGroupShape[]) ?? [];
    passages.forEach((p, pIdx) => {
      (p.questions ?? []).forEach((sq, qIdx) => {
        const key = `${id}-${pIdx}-${qIdx}`;
        applyShuffle(sq, userId, examId, key, posMap);
        slotKeys.push(key);
      });
    });

  } else if (type === "listen_togo") {
    // t1 = single sub with fixed `["1","2","3","4"]` choices (admin
    // picked the correct number directly). Same shape as bjt_1_3 /
    // listen_gaiyou — no shuffle, no posMap entry.
    const t1 = data.type1 as SubQ | undefined;
    if (t1) {
      const key = `${id}-t1`;
      t1.choices = ["1", "2", "3", "4"];
      delete t1.correct;
      delete t1.wrongs;
      slotKeys.push(key);
    }
    // t2 sub-questions store text per-option as `options[]` +
    // `correctIdx`. Convert to the legacy correct/wrongs shape so
    // applyShuffle can run as before — the shuffle still randomises
    // option order between learners.
    const t2 = data.type2 as { mainQuestion?: string; questions?: SubQ[] } | undefined;
    if (t2?.questions) {
      t2.questions.forEach((sq, i) => {
        const key = `${id}-t2-${i}`;
        const { correct, wrongs } = readT2Sub(sq);
        sq.correct = correct;
        sq.wrongs = wrongs;
        delete sq.options;
        delete sq.correctIdx;
        applyShuffle(sq, userId, examId, key, posMap);
        slotKeys.push(key);
      });
    }

  } else if (type.startsWith("listen_")) {
    const isFixed = FIXED_CHOICE_LISTEN_TYPES.has(type);
    const fixedN = isFixed ? fixedChoiceCount(type, q.level) : 0;
    const subQs = (data.questions as SubQ[]) ?? [];
    subQs.forEach((sq, i) => {
      const key = `${id}-${i}`;
      if (isFixed) {
        // Fixed `["1","2",…]` choices — admin picked the correct
        // number via radio. Mirror bjt_1_3: drop correct/wrongs so
        // the client never sees the answer.
        sq.choices = Array.from({ length: fixedN }, (_, n) => String(n + 1));
        delete sq.correct;
        delete sq.wrongs;
      } else {
        applyShuffle(sq, userId, examId, key, posMap);
      }
      slotKeys.push(key);
    });
  }

  return {
    sanitized: {
      id,
      type,
      level: q.level ?? null,
      order_index: q.order_index ?? null,
      data,
      audio_url:    q.audio_url    ?? null,
      audio_script: q.audio_script ?? null,
    },
    slotKeys,
  };
}

// ─── Re-derive expected position for a slot at submit time ──────────
export function expectedPosForSlot(
  q: RawQuestion,
  slotKey: string,
  userId: string,
  examId: string,
  posMap?: AnswerPositionMap,
): number | null {
  const id = String(q.id);
  const type = String(q.type);
  const data = (q.data ?? {}) as Record<string, unknown>;

  // bjt_1_3 / bjt_2_3 → fixed mapping, no shuffle
  if (type === "bjt_1_3" || type === "bjt_2_3") {
    if (slotKey !== id) return null;
    const cn = parseInt(String((data as SubQ).correct ?? ""), 10);
    return isNaN(cn) || cn < 1 ? 0 : cn - 1;
  }

  // Simple top-level question
  if (SIMPLE_TYPES.has(type) || SIMPLE_BJT_TYPES.has(type)) {
    if (slotKey !== id) return null;
    const top = data as SubQ;
    const n = nChoices(top.correct, top.wrongs);
    return posMap?.[id] ?? deterministicPos(userId, examId, id, n);
  }

  // bunsho: ${id}-b-${i}
  if (type === "bunsho") {
    const m = slotKey.match(new RegExp(`^${escRe(id)}-b-(\\d+)$`));
    if (!m) return null;
    const i = parseInt(m[1], 10);
    const sq = ((data.questions as SubQ[]) ?? [])[i];
    if (!sq) return null;
    const n = nChoices(sq.correct, sq.wrongs);
    return posMap?.[slotKey] ?? deterministicPos(userId, examId, slotKey, n);
  }

  // togo (compact shape): ${id}-q-${i}
  if (type === "togo" && isTogoCompactShape(data)) {
    const m = slotKey.match(new RegExp(`^${escRe(id)}-q-(\\d+)$`));
    if (!m) return null;
    const i = parseInt(m[1], 10);
    const sq = ((data.questions as SubQ[]) ?? [])[i];
    if (!sq) return null;
    const n = nChoices(sq.correct, sq.wrongs);
    return posMap?.[slotKey] ?? deterministicPos(userId, examId, slotKey, n);
  }

  // PASSAGE_TYPES: ${id}-${pIdx}-${qIdx}
  if (PASSAGE_TYPES.has(type)) {
    const m = slotKey.match(new RegExp(`^${escRe(id)}-(\\d+)-(\\d+)$`));
    if (!m) return null;
    const pIdx = parseInt(m[1], 10);
    const qIdx = parseInt(m[2], 10);
    const sq = ((data.passages as PassageGroupShape[]) ?? [])[pIdx]?.questions?.[qIdx];
    if (!sq) return null;
    const n = nChoices(sq.correct, sq.wrongs);
    return posMap?.[slotKey] ?? deterministicPos(userId, examId, slotKey, n);
  }

  // listen_togo: ${id}-t1 or ${id}-t2-${i}
  if (type === "listen_togo") {
    if (slotKey === `${id}-t1`) {
      // Fixed-choice radio — same shape as bjt_1_3 / listen_gaiyou.
      const t1 = data.type1 as SubQ | undefined;
      if (!t1) return null;
      const cn = parseInt(String(t1.correct ?? ""), 10);
      return isNaN(cn) || cn < 1 ? 0 : cn - 1;
    }
    const m = slotKey.match(new RegExp(`^${escRe(id)}-t2-(\\d+)$`));
    if (m) {
      const i = parseInt(m[1], 10);
      const t2 = data.type2 as { questions?: SubQ[] } | undefined;
      const sq = t2?.questions?.[i];
      if (!sq) return null;
      const { correct, wrongs } = readT2Sub(sq);
      const n = nChoices(correct, wrongs);
      return posMap?.[slotKey] ?? deterministicPos(userId, examId, slotKey, n);
    }
    return null;
  }

  // listen_*: ${id}-${i}
  if (type.startsWith("listen_")) {
    const m = slotKey.match(new RegExp(`^${escRe(id)}-(\\d+)$`));
    if (!m) return null;
    const i = parseInt(m[1], 10);
    const sq = ((data.questions as SubQ[]) ?? [])[i];
    if (!sq) return null;
    // Fixed-choice listen mondai store correct as "1".."N" directly,
    // same shape as bjt_1_3. No deterministic shuffle, no posMap.
    if (FIXED_CHOICE_LISTEN_TYPES.has(type)) {
      const cn = parseInt(String(sq.correct ?? ""), 10);
      return isNaN(cn) || cn < 1 ? 0 : cn - 1;
    }
    const n = nChoices(sq.correct, sq.wrongs);
    return posMap?.[slotKey] ?? deterministicPos(userId, examId, slotKey, n);
  }

  return null;
}

function escRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

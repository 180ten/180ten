"use client";
// src/lib/vocabTag.ts
// Vocab tag 【...】 in passages/main-question text. Three-layer cache:
//   1. session Map (in-memory, lives until full reload)
//   2. localStorage (7-day TTL, survives reloads)
//   3. Supabase fetch (single-row, deduped by `inflight`)
import type { SupabaseClient } from "@supabase/supabase-js";

// ── Tag parsing ──────────────────────────────────────────────────────────
// `inner` is whatever sits between 【...】. The DISPLAY value is always
// kept verbatim by callers (extractVocabSegments puts it in seg.display).
// The LOOKUP word, however, must match vocabulary_library.word — so we
// peel one layer of common wrapping that admins use as visual emphasis:
//
//   {(漢字)(かな)}  furigana  → kanji portion
//   (漢字)           half-paren wrap (e.g. 【(会社)】)
//   （漢字）          full-width paren wrap
//
// Anything else falls through unchanged.
function extractWordFromTag(inner: string): string {
  // 1) Furigana form  {(漢字)(かな)}
  const fur = inner.match(/^\{\(([^)]+)\)\([^)]+\)\}$/);
  if (fur) return fur[1];

  // 2) Half-width parens (...)
  const par = inner.match(/^\(([^)]+)\)$/);
  if (par) return par[1];

  // 3) Full-width parens （...）
  const fpar = inner.match(/^（([^）]+)）$/);
  if (fpar) return fpar[1];

  return inner;
}

export function extractTaggedWords(text: string): string[] {
  if (!text) return [];
  return [...text.matchAll(/【([^】]+)】/g)].map((m) => extractWordFromTag(m[1]));
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Wrap each 【...】 in a clickable span. Inner is kept verbatim so the
// downstream furigana parser inside renderRich() still emits <ruby> tags
// from {(A)(B)} forms.
//
// PREFERRED: use `extractVocabSegments` + React rendering (auto-escapes
// data-word) instead of this string-builder. Kept for backwards compat.
export function renderVocabTags(text: string): string {
  if (!text) return "";
  return text.replace(/【([^】]+)】/g, (_, inner) => {
    const word = extractWordFromTag(inner);
    return `<span class="vocab-tag" data-word="${escapeAttr(word)}">${inner}</span>`;
  });
}

// Structured-data variant — returns segments so React can render each one
// with auto-escaped attributes (no manual string concatenation, no chance
// of forgetting to escape). The `display` field carries the inner content
// verbatim so downstream renderRich/parseFurigana can still produce ruby.
export type VocabSegment =
  | { type: "text";  value: string }
  | { type: "vocab"; word: string; display: string };

export function extractVocabSegments(text: string): VocabSegment[] {
  if (!text) return [];
  const segments: VocabSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(/【([^】]+)】/g)) {
    const idx = m.index ?? 0;
    if (idx > last) segments.push({ type: "text", value: text.slice(last, idx) });
    const word = extractWordFromTag(m[1]);
    // display is m[1] verbatim — wrappers like (), （）, _ stay visible;
    // only `word` (used for vocabulary_library lookup) gets normalised.
    segments.push({ type: "vocab", word, display: m[1] });
    last = idx + m[0].length;
  }
  if (last < text.length) segments.push({ type: "text", value: text.slice(last) });
  return segments;
}

// Strip 【】 brackets entirely, keeping the inner content verbatim. Used in
// exam mode (pre-submit) so students see plain text — no markup, no styling.
// Inner is kept untouched so {(A)(B)} furigana still renders downstream.
export function stripVocabTags(text: string): string {
  if (!text) return text;
  return text.replace(/【([^】]+)】/g, "$1");
}

// ── 3-layer cache ────────────────────────────────────────────────────────
export interface VocabEntry {
  word:      string;
  reading:   string | null;
  han_viet:  string | null;
  word_type: string | null;
  meaning:   string | null;
  examples:  unknown;
  cachedAt:  number;
}

// v2 — added han_viet field. Bumping invalidates older cached rows on first
// load so they get refetched with the new column.
const LS_KEY = "jlptbro-vocab-tag-cache-v2";
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
type LocalCache = Record<string, VocabEntry>;

const sessionCache = new Map<string, VocabEntry | null>();
const inflight     = new Map<string, Promise<VocabEntry | null>>();

function readLocal(): LocalCache {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as LocalCache) : {};
  } catch { return {}; }
}

function writeLocal(cache: LocalCache) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(LS_KEY, JSON.stringify(cache)); } catch { /* quota */ }
}

async function fetchFromDb(word: string, sb: SupabaseClient): Promise<VocabEntry | null> {
  const { data, error } = await sb
    .from("vocabulary_library")
    .select("word, reading, han_viet, word_type, meaning, examples")
    .eq("word", word)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { word: string; reading?: string | null; han_viet?: string | null; word_type?: string | null; meaning?: string | null; examples?: unknown };
  return {
    word:      row.word,
    reading:   row.reading   ?? null,
    han_viet:  row.han_viet  ?? null,
    word_type: row.word_type ?? null,
    meaning:   row.meaning   ?? null,
    examples:  row.examples  ?? null,
    cachedAt:  Date.now(),
  };
}

export async function lookupVocab(word: string, sb: SupabaseClient): Promise<VocabEntry | null> {
  const key = word.trim();
  if (!key) return null;

  // Layer 1 — session Map
  if (sessionCache.has(key)) return sessionCache.get(key) ?? null;

  // Layer 2 — localStorage (7-day TTL)
  const local = readLocal();
  const hit = local[key];
  if (hit && Date.now() - hit.cachedAt < TTL_MS) {
    sessionCache.set(key, hit);
    return hit;
  }

  // Layer 3 — Supabase, deduped per word so concurrent calls share one fetch
  const pending = inflight.get(key);
  if (pending) return pending;

  const promise = fetchFromDb(key, sb)
    .then((entry) => {
      sessionCache.set(key, entry);
      if (entry) {
        const next = { ...readLocal(), [key]: entry };
        writeLocal(next);
      }
      return entry;
    })
    .finally(() => { inflight.delete(key); });

  inflight.set(key, promise);
  return promise;
}

// Fire-and-forget — for hover prefetch.
export function prefetchVocab(word: string, sb: SupabaseClient): void {
  void lookupVocab(word, sb).catch(() => { /* ignore */ });
}

// Bulk lookup — used by the auto-vocab grid in review mode. Pulls cached
// entries from the session/localStorage layers first, then issues a SINGLE
// `.in('word', missing)` query for the rest. Returns Map<word, VocabEntry>;
// missing words are simply absent from the map.
export async function lookupVocabBulk(words: string[], sb: SupabaseClient): Promise<Map<string, VocabEntry>> {
  const out = new Map<string, VocabEntry>();
  const seen = new Set<string>();
  const missing: string[] = [];

  const local = readLocal();
  for (const raw of words) {
    const key = raw.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);

    if (sessionCache.has(key)) {
      const e = sessionCache.get(key);
      if (e) out.set(key, e);
      continue;
    }
    const hit = local[key];
    if (hit && Date.now() - hit.cachedAt < TTL_MS) {
      sessionCache.set(key, hit);
      out.set(key, hit);
      continue;
    }
    missing.push(key);
  }

  if (missing.length === 0) return out;

  const { data, error } = await sb
    .from("vocabulary_library")
    .select("word, reading, han_viet, word_type, meaning, examples")
    .in("word", missing);

  if (error || !data) {
    // Cache nothing on failure so a retry later can succeed
    return out;
  }

  const found = new Set<string>();
  for (const row of data as { word: string; reading?: string|null; han_viet?: string|null; word_type?: string|null; meaning?: string|null; examples?: unknown }[]) {
    const entry: VocabEntry = {
      word:      row.word,
      reading:   row.reading   ?? null,
      han_viet:  row.han_viet  ?? null,
      word_type: row.word_type ?? null,
      meaning:   row.meaning   ?? null,
      examples:  row.examples  ?? null,
      cachedAt:  Date.now(),
    };
    sessionCache.set(row.word, entry);
    out.set(row.word, entry);
    found.add(row.word);
  }
  // Cache misses to short-circuit future lookups for words not in the dict
  for (const m of missing) if (!found.has(m)) sessionCache.set(m, null);

  // Persist newly fetched entries to localStorage in one batch
  if (found.size > 0) {
    const next = readLocal();
    for (const w of found) {
      const e = sessionCache.get(w);
      if (e) next[w] = e;
    }
    writeLocal(next);
  }

  return out;
}

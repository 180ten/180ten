"use client";
// src/lib/vocabTag.ts
// Vocab tag 【...】 in passages/main-question text. Three-layer cache:
//   1. session Map (in-memory, lives until full reload)
//   2. localStorage (7-day TTL, survives reloads)
//   3. Supabase fetch (single-row, deduped by `inflight`)
import type { SupabaseClient } from "@supabase/supabase-js";

// ── Tag parsing ──────────────────────────────────────────────────────────
// Inner content can be plain (e.g. 私) or a furigana block ({(漢字)(かな)}).
// In the latter case, the "word" is the kanji portion — what we look up
// against vocabulary_library.word.
function extractWordFromTag(inner: string): string {
  const m = inner.match(/^\{\(([^)]+)\)\([^)]+\)\}$/);
  return m ? m[1] : inner;
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
export function renderVocabTags(text: string): string {
  if (!text) return "";
  return text.replace(/【([^】]+)】/g, (_, inner) => {
    const word = extractWordFromTag(inner);
    return `<span class="vocab-tag" data-word="${escapeAttr(word)}">${inner}</span>`;
  });
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
  word_type: string | null;
  meaning:   string | null;
  examples:  unknown;
  cachedAt:  number;
}

const LS_KEY = "jlptbro-vocab-tag-cache-v1";
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
    .select("word, reading, word_type, meaning, examples")
    .eq("word", word)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { word: string; reading?: string | null; word_type?: string | null; meaning?: string | null; examples?: unknown };
  return {
    word:      row.word,
    reading:   row.reading   ?? null,
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
    .select("word, reading, word_type, meaning, examples")
    .in("word", missing);

  if (error || !data) {
    // Cache nothing on failure so a retry later can succeed
    return out;
  }

  const found = new Set<string>();
  for (const row of data as { word: string; reading?: string|null; word_type?: string|null; meaning?: string|null; examples?: unknown }[]) {
    const entry: VocabEntry = {
      word:      row.word,
      reading:   row.reading   ?? null,
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

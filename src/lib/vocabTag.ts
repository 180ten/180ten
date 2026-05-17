"use client";
// src/lib/vocabTag.ts
// Vocab tag 〖...〗 in passages / question stems / answer choices.
// 【...】 is intentionally NOT recognised — admins use it as literal
// punctuation now, and any text wrapped in 【...】 should render
// verbatim (no popup, no auto-vocab, no bracket stripping).
//
// Three-layer cache for the lookup itself:
//   1. session Map (in-memory, lives until full reload)
//   2. localStorage (7-day TTL, survives reloads)
//   3. Supabase fetch (single-row, deduped by `inflight`)
import type { SupabaseClient } from "@supabase/supabase-js";

const VOCAB_TAG_RE = /〖([^〗]+)〗/g;

// ── Tag parsing ──────────────────────────────────────────────────────────
// `inner` is whatever sits between the brackets. The DISPLAY value is always
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
  // 1) Strip every {(kanji)(kana)} furigana atom → kanji only.
  //    Handles single atom, prefix/suffix, multi-atom:
  //    {(醍醐味)(だいごみ)}        → 醍醐味
  //    {(喋)(しゃべ)}れる          → 喋れる
  //    お{(喋)(しゃべ)}り          → お喋り
  //    {(召)(め)}し{(上)(あ)}がる  → 召し上がる
  const stripped = inner.replace(/\{\(([^)]+)\)\([^)]+\)\}/g, "$1");
  if (stripped !== inner) return stripped;

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
  return [...text.matchAll(VOCAB_TAG_RE)].map((m) => extractWordFromTag(m[1]));
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
  return text.replace(VOCAB_TAG_RE, (_, inner) => {
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
  for (const m of text.matchAll(VOCAB_TAG_RE)) {
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

// Strip vocab brackets entirely, keeping the inner content verbatim. Used
// in exam mode (pre-submit) so students see plain text — no markup, no
// styling. Inner is kept untouched so {(A)(B)} furigana still renders
// downstream.
export function stripVocabTags(text: string): string {
  if (!text) return text;
  return text.replace(VOCAB_TAG_RE, "$1");
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

type VocabRow = {
  word: string;
  reading?: string | null;
  han_viet?: string | null;
  word_type?: string | null;
  meaning?: string | null;
  examples?: unknown;
};

function rowToEntry(row: VocabRow): VocabEntry {
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

const VOCAB_COLS = "word, reading, han_viet, word_type, meaning, examples";

// 美化語 (bikago) prefix candidates. お店 → 店, ご飯 → 飯, 御飯 → 飯.
// Heuristic — only strip when:
//   • surface is at least 3 chars (single-mora bases like お湯 stay
//     as written; one extra DB miss isn't worth false-stripping
//     ありがとう → りがとう)
//   • base after the prefix starts with kanji (or hiragana for お/御);
//     ご is normally followed by kanji so we keep that stricter
//
// The actual existence check still happens at DB level — over-strip
// is harmless (just one wasted query), under-strip is the cost we
// accept to avoid bogus matches.
function stripBikago(surface: string): string[] {
  const candidates: string[] = [];

  if (surface.startsWith("お") && surface.length >= 3) {
    const base = surface.slice(1);
    // base bắt đầu bằng kanji hoặc hiragana
    if (/^[一-鿿ぁ-ゖ]/.test(base)) {
      candidates.push(base);
    }
  }

  if (surface.startsWith("ご") && surface.length >= 3) {
    const base = surface.slice(1);
    // ご thường đi với kanji
    if (/^[一-鿿]/.test(base)) {
      candidates.push(base);
    }
  }

  if (surface.startsWith("御") && surface.length >= 3) {
    const base = surface.slice(1);
    if (/^[一-鿿ぁ-ゖ]/.test(base)) {
      candidates.push(base);
    }
  }

  return candidates;
}

// Lookup a single surface form. Tries `word = surface` first; on miss,
// falls back to `variants @> [surface]`; on miss again, strips
// 美化語 prefix (お/ご/御) and retries both word + variants on the base
// form. The cached entry is keyed by the original SURFACE (お店), with
// `entry.word` carrying the canonical form (店) — so subsequent lookups
// of the same surface hit the cache instantly.
async function fetchFromDb(surface: string, sb: SupabaseClient): Promise<VocabEntry | null> {
  // 1) Exact word match
  const { data: exact, error: exactErr } = await sb
    .from("vocabulary_library")
    .select(VOCAB_COLS)
    .eq("word", surface)
    .maybeSingle();
  if (exactErr) return null;
  if (exact) return rowToEntry(exact as VocabRow);

  // 2) Variant fallback — text[] column, PostgREST `@>` containment.
  const { data: byVariant } = await sb
    .from("vocabulary_library")
    .select(VOCAB_COLS)
    .contains("variants", [surface])
    .maybeSingle();
  if (byVariant) return rowToEntry(byVariant as VocabRow);

  // 3) Strip 美化語 prefix and retry — お店 → 店, ご飯 → 飯, …
  for (const base of stripBikago(surface)) {
    const { data: baseExact } = await sb
      .from("vocabulary_library")
      .select(VOCAB_COLS)
      .eq("word", base)
      .maybeSingle();
    if (baseExact) return rowToEntry(baseExact as VocabRow);

    const { data: baseVariant } = await sb
      .from("vocabulary_library")
      .select(VOCAB_COLS)
      .contains("variants", [base])
      .maybeSingle();
    if (baseVariant) return rowToEntry(baseVariant as VocabRow);
  }

  return null;
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
      if (entry) {
        // Only cache POSITIVE hits — caching null pinned stale negatives
        // when admins added variants/bikago entries mid-session.
        sessionCache.set(key, entry);
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

  // ── Phase 1: bulk match by canonical word (one round-trip) ─────
  const { data, error } = await sb
    .from("vocabulary_library")
    .select(VOCAB_COLS)
    .in("word", missing);

  if (error || !data) {
    // Cache nothing on failure so a retry later can succeed
    return out;
  }

  const foundKeys = new Set<string>();
  for (const row of data as VocabRow[]) {
    const entry = rowToEntry(row);
    sessionCache.set(row.word, entry);
    out.set(row.word, entry);
    foundKeys.add(row.word);
  }

  // ── Phase 2: variant fallback for surfaces still missing ───────
  // PostgREST doesn't support OR over array containment, so we issue
  // one tiny query per unmatched surface. Acceptable because most
  // exam runs have ≤ a handful of inflected forms per question.
  const phase2Missing = missing.filter((m) => !foundKeys.has(m));
  for (const surface of phase2Missing) {
    const { data: vrow } = await sb
      .from("vocabulary_library")
      .select(VOCAB_COLS)
      .contains("variants", [surface])
      .maybeSingle();
    if (vrow) {
      const entry = rowToEntry(vrow as VocabRow);
      // Key the cache by the SURFACE so the next lookup of the same
      // inflected form is an instant cache hit.
      sessionCache.set(surface, entry);
      out.set(surface, entry);
      foundKeys.add(surface);
    }
  }

  // ── Phase 3: 美化語 strip — お店 → 店, ご飯 → 飯 ────────────────
  // Same N+1 shape as phase 2; bikago surfaces are always rare in any
  // single passage so the cost is negligible.
  const phase3Missing = missing.filter((m) => !foundKeys.has(m));
  for (const surface of phase3Missing) {
    for (const base of stripBikago(surface)) {
      const { data: baseExact } = await sb
        .from("vocabulary_library")
        .select(VOCAB_COLS)
        .eq("word", base)
        .maybeSingle();
      if (baseExact) {
        const entry = rowToEntry(baseExact as VocabRow);
        sessionCache.set(surface, entry);
        out.set(surface, entry);
        foundKeys.add(surface);
        break;
      }
      const { data: baseVariant } = await sb
        .from("vocabulary_library")
        .select(VOCAB_COLS)
        .contains("variants", [base])
        .maybeSingle();
      if (baseVariant) {
        const entry = rowToEntry(baseVariant as VocabRow);
        sessionCache.set(surface, entry);
        out.set(surface, entry);
        foundKeys.add(surface);
        break;
      }
    }
  }
  // Deliberately NOT caching null for unmatched surfaces — keeps the
  // cache from going stale when admins add a missing entry mid-session.

  // Persist newly fetched entries to localStorage in one batch
  if (foundKeys.size > 0) {
    const next = readLocal();
    for (const w of foundKeys) {
      const e = sessionCache.get(w);
      if (e) next[w] = e;
    }
    writeLocal(next);
  }

  return out;
}

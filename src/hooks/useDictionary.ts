"use client";
// src/hooks/useDictionary.ts
// Loads `vocabulary_library` once, caches in module memory + localStorage, and
// exposes helpers for client-side search + filter. Re-opens of the modal
// re-use the cache so subsequent searches are instant.
//
// Performance strategy:
//   1. Bulk load skips the heavy `examples` JSON column (search doesn't need it).
//   2. Pages are fetched in parallel after a `count(head)` probe.
//   3. Result is persisted to localStorage with a 24h TTL — revisits are instant.
//   4. `examples` are loaded on demand by id when DictPopup actually displays
//      the cards (only ~20 ids at a time, so cheap).

import { useEffect, useState } from "react";
import { sb } from "@/lib/supabase";

export interface DictEntry {
  id?: string | number;
  word: string;
  reading?: string;
  han_viet?: string;
  word_type?: string;
  meaning?: string;
  meaning_jp?: string;
  jlpt_level?: string;
  examples?: string[];
}

const PAGE_SIZE         = 1000;
const STORAGE_VERSION   = 2;
const STORAGE_KEY       = `jlptbro-dict-v${STORAGE_VERSION}`;
const STORAGE_TTL_MS    = 24 * 60 * 60 * 1000; // 24h
const LIGHT_FIELDS      = "id,word,reading,han_viet,word_type,meaning,meaning_jp,jlpt_level";

// Module-level cache — survives modal close/open within a page session
let CACHE: DictEntry[] | null = null;
let CACHE_PROMISE: Promise<DictEntry[]> | null = null;

interface StorageEnvelope {
  ts: number;
  rows: DictEntry[];
}

function readStorageCache(): DictEntry[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StorageEnvelope;
    if (!parsed?.rows || !Array.isArray(parsed.rows)) return null;
    if (typeof parsed.ts !== "number") return null;
    if (Date.now() - parsed.ts > STORAGE_TTL_MS) return null;
    return parsed.rows;
  } catch { return null; }
}

function writeStorageCache(rows: DictEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ts: Date.now(), rows } as StorageEnvelope));
  } catch { /* quota exceeded — ignore */ }
}

async function fetchFresh(): Promise<DictEntry[]> {
  // 1) Get total count up front so we can fan out pages in parallel.
  //    `head: true` skips the row payload — it's a cheap probe.
  let total = 0;
  try {
    const { count, error } = await sb
      .from("vocabulary_library")
      .select("id", { count: "exact", head: true });
    if (error) {
      console.warn("[useDictionary] count failed, fallback serial:", error.message);
    } else if (typeof count === "number") {
      total = count;
    }
  } catch (e) {
    console.warn("[useDictionary] count threw:", e);
  }

  // Fallback: if count failed, fetch serially up to 30k.
  if (total <= 0) return fetchSerial();

  const pageCount = Math.ceil(total / PAGE_SIZE);
  const pages = await Promise.all(
    Array.from({ length: pageCount }, (_, p) => {
      const from = p * PAGE_SIZE;
      const to   = from + PAGE_SIZE - 1;
      return sb
        .from("vocabulary_library")
        .select(LIGHT_FIELDS)
        .order("word")
        .range(from, to)
        .then(({ data, error }) => {
          if (error) {
            console.warn(`[useDictionary] page ${p} failed:`, error.message);
            return [] as DictEntry[];
          }
          return (data ?? []) as DictEntry[];
        });
    }),
  );

  const out: DictEntry[] = ([] as DictEntry[]).concat(...pages);
  writeStorageCache(out);
  return out;
}

async function fetchSerial(): Promise<DictEntry[]> {
  const out: DictEntry[] = [];
  for (let from = 0; from < 30000; from += PAGE_SIZE) {
    const { data, error } = await sb
      .from("vocabulary_library")
      .select(LIGHT_FIELDS)
      .range(from, from + PAGE_SIZE - 1)
      .order("word");
    if (error) {
      console.warn("[useDictionary] serial load failed:", error.message);
      break;
    }
    if (!data || data.length === 0) break;
    out.push(...(data as DictEntry[]));
    if (data.length < PAGE_SIZE) break;
  }
  if (out.length > 0) writeStorageCache(out);
  return out;
}

async function loadAll(): Promise<DictEntry[]> {
  if (CACHE) return CACHE;
  if (CACHE_PROMISE) return CACHE_PROMISE;

  CACHE_PROMISE = (async () => {
    // Hit localStorage first — instant on revisit.
    if (typeof window !== "undefined") {
      const stored = readStorageCache();
      if (stored && stored.length > 0) {
        CACHE = stored;
        return stored;
      }
    }
    const fresh = await fetchFresh();
    CACHE = fresh;
    return fresh;
  })();
  return CACHE_PROMISE;
}

export function useDictionary(open: boolean) {
  const [entries, setEntries] = useState<DictEntry[] | null>(CACHE);
  const [loading, setLoading] = useState(!CACHE);

  useEffect(() => {
    if (!open) return;
    if (CACHE) { setEntries(CACHE); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    void loadAll().then((rows) => {
      if (!cancelled) { setEntries(rows); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [open]);

  return { entries, loading };
}

// ── Examples (lazy, on-demand) ──────────────────────────────────────
// Bulk load skips the `examples` column. DictPopup calls `useExamples(ids)`
// for the entries it's about to render — typically ≤20, so cheap.

const EXAMPLES_CACHE = new Map<string, string[]>();
const EXAMPLES_INFLIGHT = new Map<string, Promise<void>>();

function idKey(id: string | number | undefined): string {
  return id == null ? "" : String(id);
}

async function fetchExamples(ids: string[]): Promise<void> {
  const missing = ids.filter((id) => id && !EXAMPLES_CACHE.has(id) && !EXAMPLES_INFLIGHT.has(id));
  if (missing.length === 0) return;

  // Mark inflight before awaiting so concurrent callers de-dupe.
  const promise = (async () => {
    const { data, error } = await sb
      .from("vocabulary_library")
      .select("id,examples")
      .in("id", missing);
    if (error) {
      console.warn("[useDictionary] fetchExamples failed:", error.message);
      // Cache empty on failure so we don't hammer the endpoint.
      for (const id of missing) EXAMPLES_CACHE.set(id, []);
      return;
    }
    const seen = new Set<string>();
    for (const row of (data ?? []) as { id: string | number; examples?: string[] }[]) {
      const key = idKey(row.id);
      EXAMPLES_CACHE.set(key, Array.isArray(row.examples) ? row.examples : []);
      seen.add(key);
    }
    // Backfill misses (deleted rows) so we don't keep retrying them.
    for (const id of missing) if (!seen.has(id)) EXAMPLES_CACHE.set(id, []);
  })();

  for (const id of missing) EXAMPLES_INFLIGHT.set(id, promise);
  try {
    await promise;
  } finally {
    for (const id of missing) EXAMPLES_INFLIGHT.delete(id);
  }
}

export function useExamples(ids: (string | number | undefined)[]): Map<string, string[]> {
  const [, setTick] = useState(0);
  // Stable key: sorted id list — only refetch when the visible set changes.
  const keys = ids.map(idKey).filter(Boolean);
  const stable = keys.slice().sort().join("|");

  useEffect(() => {
    if (keys.length === 0) return;
    const need = keys.filter((id) => !EXAMPLES_CACHE.has(id));
    if (need.length === 0) return;
    let cancelled = false;
    void fetchExamples(need).then(() => { if (!cancelled) setTick((v) => v + 1); });
    return () => { cancelled = true; };
  }, [stable]); // eslint-disable-line react-hooks/exhaustive-deps

  return EXAMPLES_CACHE;
}

// ── Search history (per-browser) ────────────────────────────────────
const HISTORY_KEY = "jlptbro-dict-history";
const HISTORY_MAX = 10;

export function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string").slice(0, HISTORY_MAX) : [];
  } catch { return []; }
}

export function pushHistory(word: string): string[] {
  const w = String(word || "").trim();
  if (!w) return loadHistory();
  const cur = loadHistory().filter((x) => x !== w);
  const next = [w, ...cur].slice(0, HISTORY_MAX);
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  return next;
}

export function clearHistory(): void {
  try { localStorage.removeItem(HISTORY_KEY); } catch { /* ignore */ }
}

// ── Search + filter ────────────────────────────────────────────────
export function searchEntries(
  all: DictEntry[],
  query: string,
  level: string,
  limit = 20,
): DictEntry[] {
  let res = all;
  if (level) res = res.filter((e) => (e.jlpt_level ?? "") === level);

  const q = query.trim().toLowerCase();
  if (!q) return res.slice(0, limit);

  // Score: exact > starts-with > contains
  const scored: { e: DictEntry; s: number }[] = [];
  for (const e of res) {
    const fields = [e.word, e.reading, e.meaning, e.han_viet]
      .filter((x): x is string => typeof x === "string")
      .map((x) => x.toLowerCase());
    let s = 0;
    for (const f of fields) {
      if (f === q) s = Math.max(s, 100);
      else if (f.startsWith(q)) s = Math.max(s, 50);
      else if (f.includes(q)) s = Math.max(s, 10);
    }
    if (s > 0) scored.push({ e, s });
  }
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, limit).map((x) => x.e);
}

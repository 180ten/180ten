// src/lib/grammarTag.ts
// Grammar tag 〔...〕 in passages / question stems / answer choices.
// Sister to vocabTag.ts: parser, stripper, and a lookup that returns
// the same VocabEntry shape so the existing VocabTagPopup can render
// either source with a single component.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { VocabEntry } from "@/lib/vocabTag";

const GRAMMAR_TAG_RE = /〔([^〕]+)〕/g;

export type GrammarSegment =
  | { type: "text";    value: string }
  | { type: "grammar"; content: string };

/** Split `text` on 〔...〕 markers. Returns plain-text and grammar
 *  segments interleaved in source order. Empty input → []. */
export function extractGrammarSegments(text: string): GrammarSegment[] {
  if (!text) return [];
  const segments: GrammarSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(GRAMMAR_TAG_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) segments.push({ type: "text", value: text.slice(last, idx) });
    segments.push({ type: "grammar", content: m[1] });
    last = idx + m[0].length;
  }
  if (last < text.length) segments.push({ type: "text", value: text.slice(last) });
  return segments;
}

/** Remove the 〔...〕 brackets and keep only the inner text. Used in exam
 *  mode (pre-submit) so the visual marker is hidden but the underlying
 *  word still reads naturally. */
export function stripGrammarTags(text: string): string {
  if (!text) return text;
  return text.replace(GRAMMAR_TAG_RE, "$1");
}

// ── Grammar lookup ─────────────────────────────────────────────────────
// Looks `name` up in `grammar_library` and maps the row to the same
// VocabEntry shape the popup already understands:
//   grammar.name      → word
//   grammar.furigana  → reading
//   grammar.meaning   → meaning
//   grammar.examples  → examples
//   word_type         → "ngữ pháp" (badge label)
// Session-cached so the same pattern doesn't re-fetch on every popup.
const grammarSession = new Map<string, VocabEntry | null>();
const grammarInflight = new Map<string, Promise<VocabEntry | null>>();

export async function lookupGrammar(
  name: string,
  sb: SupabaseClient,
): Promise<VocabEntry | null> {
  const key = name.trim();
  if (!key) return null;
  if (grammarSession.has(key)) return grammarSession.get(key) ?? null;
  const pending = grammarInflight.get(key);
  if (pending) return pending;

  const promise = (async (): Promise<VocabEntry | null> => {
    const { data, error } = await sb
      .from("grammar_library")
      .select("name, furigana, meaning, examples")
      .eq("name", key)
      .maybeSingle();
    if (error || !data) {
      grammarSession.set(key, null);
      return null;
    }
    const row = data as { name: string; furigana?: string | null; meaning?: string | null; examples?: unknown };
    const entry: VocabEntry = {
      word:      row.name,
      reading:   row.furigana ?? null,
      han_viet:  null,
      word_type: "ngữ pháp",
      meaning:   row.meaning ?? null,
      examples:  row.examples ?? [],
      cachedAt:  Date.now(),
    };
    grammarSession.set(key, entry);
    return entry;
  })();

  grammarInflight.set(key, promise);
  try { return await promise; }
  finally { grammarInflight.delete(key); }
}

/** Pre-warm the session cache (cheap; no localStorage layer for grammar). */
export function prefetchGrammar(name: string, sb: SupabaseClient): void {
  void lookupGrammar(name, sb);
}

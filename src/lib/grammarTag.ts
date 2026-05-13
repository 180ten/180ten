// src/lib/grammarTag.ts
// Grammar tag 〔...〕 in passages / question stems / answer choices.
//
// Distinct from vocab tags (〖...〗 / 【...】) so admins can mark grammar
// patterns separately. Currently used purely for visual highlight (no
// popup / DB lookup) — the parser is intentionally minimal so a future
// grammar-popup feature can plug into the same segment list without
// changing call sites.

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

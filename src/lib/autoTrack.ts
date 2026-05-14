// src/lib/autoTrack.ts
// Greedy text wrapper used by ComposeTab's "⚡ Auto-track" button.
// Given a passage and the admin's vocab + grammar dictionary, walks
// the text left-to-right and wraps any matching surface in 〖...〗
// (vocab) or 〔...〕 (grammar). Anything already inside one of those
// brackets is left untouched so the function is safe to re-run.
//
// Matching strategy: longest-surface-first. Keeps によって from being
// half-claimed by に or よ when both happen to be in the dictionary.
//
// Vocab variants are flattened into the same flat list as the
// canonical word — both wrap the SAME way (〖〗) so downstream
// rendering doesn't have to know which form was matched.

export interface AutoTrackDict {
  vocab:   Array<{ word: string; variants?: string[] | null }>;
  grammar: Array<{ name: string }>;
}

interface MatchEntry {
  surface: string;
  type: "vocab" | "grammar";
}

const BRACKET_RE = /〖[^〗]*〗|〔[^〕]*〕/g;

function buildEntries(dict: AutoTrackDict): MatchEntry[] {
  const entries: MatchEntry[] = [];
  for (const v of dict.vocab) {
    const w = (v.word ?? "").trim();
    if (w) entries.push({ surface: w, type: "vocab" });
    for (const variant of v.variants ?? []) {
      const s = (variant ?? "").trim();
      if (s) entries.push({ surface: s, type: "vocab" });
    }
  }
  for (const g of dict.grammar) {
    const s = (g.name ?? "").trim();
    if (s) entries.push({ surface: s, type: "grammar" });
  }

  // Longest first so によって beats に / よ when both are listed.
  entries.sort((a, b) => b.surface.length - a.surface.length);

  // De-dup by surface — first wins (i.e. longer or earlier source).
  const seen = new Set<string>();
  return entries.filter((e) => {
    if (seen.has(e.surface)) return false;
    seen.add(e.surface);
    return true;
  });
}

function processSegment(seg: string, entries: MatchEntry[]): string {
  if (!seg) return seg;
  let out = "";
  let i = 0;
  while (i < seg.length) {
    let matched: MatchEntry | null = null;
    for (const entry of entries) {
      if (seg.startsWith(entry.surface, i)) { matched = entry; break; }
    }
    if (matched) {
      out += matched.type === "vocab"
        ? `〖${matched.surface}〗`
        : `〔${matched.surface}〕`;
      i += matched.surface.length;
    } else {
      out += seg[i];
      i++;
    }
  }
  return out;
}

export function autoTrack(text: string, dict: AutoTrackDict): string {
  if (!text) return text;
  const entries = buildEntries(dict);
  if (entries.length === 0) return text;

  // Find existing 〖〗 / 〔〕 spans and skip them.
  const spans: Array<{ start: number; end: number; raw: string }> = [];
  BRACKET_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BRACKET_RE.exec(text)) !== null) {
    spans.push({ start: m.index, end: m.index + m[0].length, raw: m[0] });
  }

  const out: string[] = [];
  let pos = 0;
  for (const span of spans) {
    out.push(processSegment(text.slice(pos, span.start), entries));
    out.push(span.raw);
    pos = span.end;
  }
  out.push(processSegment(text.slice(pos), entries));
  return out.join("");
}

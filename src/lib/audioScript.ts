// src/lib/audioScript.ts
// Per-listen-question audio script — array of timestamped lines.
// Stored as a JSON-stringified array in `questions.audio_script` (TEXT
// column). The editor in admin ComposeTab and the review-mode
// ListenScriptBox in ExamContent both go through these helpers so the
// on-the-wire shape stays canonical.

export interface AudioScriptLine {
  /** "MM:SS" or "HH:MM:SS" — start of this line in the audio. */
  start: string;
  /** "MM:SS" or "HH:MM:SS" — end (currently shown for completeness;
   *  click-to-seek only uses `start`). */
  end: string;
  /** Line text. May contain {(漢字)(ふりがな)} furigana, 〖vocab〗 and
   *  〔grammar〕 tags — review renders through sanitizedRenderRich. */
  text: string;
}

/** Tolerant parser — accepts:
 *  - JSON-stringified AudioScriptLine[] (the canonical shape)
 *  - Plain string (legacy: stored as a single un-timestamped block)
 *  - null / undefined / "" → []
 *
 *  Plain strings get wrapped into a single line with empty timestamps
 *  so older data still renders in the timestamp UI without losing text. */
export function parseScriptLines(raw: string | null | undefined): AudioScriptLine[] {
  if (!raw) return [];
  const trimmed = String(raw).trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed
        .map((p) => ({
          start: String((p as { start?: unknown })?.start ?? ""),
          end:   String((p as { end?: unknown })?.end ?? ""),
          text:  String((p as { text?: unknown })?.text ?? ""),
        }))
        .filter((l) => l.text.trim());
    }
  } catch { /* fall through */ }
  // Legacy plain-text script — keep as one line.
  return [{ start: "", end: "", text: trimmed }];
}

/** "00:05" → 5, "01:23" → 83, "1:23:45" → 5025. NaN-safe → 0. */
export function parseTimecode(t: string): number {
  if (!t) return 0;
  const parts = t.split(":").map((p) => Number(p.trim()));
  if (parts.some((n) => !Number.isFinite(n))) return 0;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return parts[0] || 0;
}

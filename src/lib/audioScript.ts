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
      // Don't filter empty-text rows — the admin editor relies on
      // round-tripping its current row list through this parser, so
      // dropping `{start:"", end:"", text:""}` would make "+ Thêm
      // dòng" appear to do nothing (the new blank row would never
      // come back from the store).
      return parsed.map((p) => ({
        start: String((p as { start?: unknown })?.start ?? ""),
        end:   String((p as { end?: unknown })?.end ?? ""),
        text:  String((p as { text?: unknown })?.text ?? ""),
      }));
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

// ── audio_display: placeholder-template format ────────────────────
// audio_display is now stored as plain text with `《N》` placeholders
// for sentence positions and `\n` for newlines. The textarea editor
// in ComposeTab and the review renderer in ExamContent both go
// through these helpers so the on-the-wire shape stays canonical.

import { sanitizedRenderRichInline } from "@/lib/furigana";

const escAttr = (s: string) =>
  String(s).replace(/[&<>"]/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;",
  }[c]!));

const escText = (s: string) =>
  String(s).replace(/[&<>]/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
  }[c]!));

/** Replace `《N》` placeholders with sentence spans + `\n` with `<br>`.
 *  `mode === "preview"` emits `.ade-chip-display` chips for the live
 *  editor overlay; `mode === "review"` emits `.script-sentence` spans
 *  with `data-seek-idx` so the audio player can wire click-to-seek.
 *  Both modes feed sentence text through `sanitizedRenderRichInline`
 *  so {(漢字)(ふりがな)}, 〖vocab〗 and 〔grammar〕 tags render the
 *  same in the editor preview and the learner-facing review. */
export function renderAudioDisplayTemplate(
  template: string,
  lines: AudioScriptLine[],
  mode: "preview" | "review",
): string {
  // Split-and-rebuild keeps surrounding admin-typed text plain (just
  // entity-escaped) while letting sentence text inherit the rich
  // renderer's furigana / vocab / grammar styling.
  const parts = String(template ?? "").split(/(《\d+》|\n)/g);
  return parts.map((part) => {
    if (part === "\n") return "<br>";
    const m = /^《(\d+)》$/.exec(part);
    if (m) {
      const idx = parseInt(m[1], 10);
      const line = idx >= 0 ? lines[idx] : undefined;
      if (!line) return "";
      const titleAttr = line.start ? ` title="▶ ${escAttr(line.start)}"` : "";
      const inner = sanitizedRenderRichInline(line.text);
      if (mode === "review") {
        return `<span class="script-sentence" data-seek-idx="${idx}"${titleAttr}>${inner}</span>`;
      }
      return `<span class="ade-chip-display"${titleAttr}>${inner}</span>`;
    }
    return escText(part);
  }).join("");
}

/** Migrate legacy HTML-format audio_display values (the old
 *  contentEditable editor saved chip wrappers + <br>s) to the new
 *  `《N》` template. Browser-only — guarded so SSR imports don't blow
 *  up when DOMParser isn't around. */
export function htmlToAudioDisplayTemplate(html: string): string {
  if (!html) return "";
  if (typeof DOMParser === "undefined") return html;
  if (!/data-sentence|<br|<\/?(p|div)/i.test(html)) return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll<HTMLElement>("[data-sentence]").forEach((el) => {
    const idx = el.getAttribute("data-sentence") ?? "";
    el.replaceWith(doc.createTextNode(`《${idx}》`));
  });
  doc.querySelectorAll("br").forEach((br) => {
    br.replaceWith(doc.createTextNode("\n"));
  });
  // Block-level elements implied a line break in the old editor.
  doc.querySelectorAll("p,div").forEach((el) => {
    el.appendChild(doc.createTextNode("\n"));
  });
  return (doc.body.textContent ?? "").replace(/\n+$/, "");
}

// ── furigana.ts ──────────────────────────────────────────────
// Text-rendering utilities migrated verbatim from htdocs/index.html
// ─────────────────────────────────────────────────────────────
// isomorphic-dompurify wraps the upstream DOMPurify with a JSDOM polyfill
// when running on Node, so sanitisation works during Next.js SSR/hydration
// AND in the browser with the same API.
import DOMPurify from "isomorphic-dompurify";

/** {(漢字)(よみ)} → <ruby>漢字<rt>よみ</rt></ruby> */
export function parseFurigana(t: string): string {
  if (!t) return t;
  return String(t).replace(/\{\(([^)]*)\)\(([^)]*)\)\}/g, (_: string, kanji: string, reading: string) =>
    `<ruby>${kanji}<rt>${reading}</rt></ruby>`
  );
}

const richPairTags = [
  { open: '[縦]', close: '[/縦]', style: 'display:block;writing-mode:vertical-rl;text-orientation:mixed;height:440px;max-height:70vh;overflow-x:auto;width:fit-content;max-width:100%;margin-left:auto;margin-right:auto;background:#fff;border:1px solid var(--border);border-radius:8px;padding:22px 26px;box-sizing:border-box;' },
  { open: '[left]', close: '[/left]', style: 'display:block;text-align:left;' },
  { open: '[center]', close: '[/center]', style: 'display:block;text-align:center;' },
  { open: '[right]', close: '[/right]', style: 'display:block;text-align:right;' },
];

export function renderRichInline(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    // [color=…]…[/color] — hex (#abc / #abcdef / #abcdef88),
    // rgb(r,g,b), or a named colour. Anything that fails the
    // allow-pattern falls back to inherit so a malformed admin entry
    // can never inject arbitrary CSS via the style attribute.
    const colorMatch = src.slice(i).match(/^\[color=([^\]]{1,32})\]/);
    if (colorMatch) {
      const close = '[/color]';
      const start = i + colorMatch[0].length;
      const end = src.indexOf(close, start);
      if (end >= 0) {
        const raw = colorMatch[1].trim();
        const safe = /^(#[0-9a-fA-F]{3,8}|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)|[a-zA-Z]{2,20})$/.test(raw)
          ? raw : 'inherit';
        out += `<span style="color:${safe};">${renderRichInline(src.slice(start, end))}</span>`;
        i = end + close.length;
        continue;
      }
    }

    const sizeMatch = src.slice(i).match(/^\[size=(\d{1,2})\]/);
    if (sizeMatch) {
      const close = '[/size]';
      const start = i + sizeMatch[0].length;
      const end = src.indexOf(close, start);
      if (end >= 0) {
        const px = Math.max(10, Math.min(36, Number(sizeMatch[1])));
        out += `<span style="font-size:${px}px;">${renderRichInline(src.slice(start, end))}</span>`;
        i = end + close.length;
        continue;
      }
    }

    const tag = richPairTags.find((x) => src.startsWith(x.open, i));
    if (tag) {
      const start = i + tag.open.length;
      const end = src.indexOf(tag.close, start);
      if (end >= 0) {
        out += `<span style="${tag.style}">${renderRichInline(src.slice(start, end))}</span>`;
        i = end + tag.close.length;
        continue;
      }
    }

    if (src.startsWith('**', i)) {
      const end = src.indexOf('**', i + 2);
      if (end >= 0) {
        out += `<strong>${renderRichInline(src.slice(i + 2, end))}</strong>`;
        i = end + 2;
        continue;
      }
    }

    if (src.startsWith('__', i)) {
      const end = src.indexOf('__', i + 2);
      if (end >= 0) {
        out += `<span style="text-decoration:underline;">${renderRichInline(src.slice(i + 2, end))}</span>`;
        i = end + 2;
        continue;
      }
    }

    if (src[i] === '*') {
      const end = src.indexOf('*', i + 1);
      if (end >= 0) {
        out += `<em>${renderRichInline(src.slice(i + 1, end))}</em>`;
        i = end + 1;
        continue;
      }
    }

    let next = src.length;
    for (const marker of ['[color=', '[size=', ...richPairTags.map((x) => x.open), '**', '__', '*']) {
      const at = src.indexOf(marker, i + 1);
      if (at >= 0 && at < next) next = at;
    }
    out += parseFurigana(src.slice(i, next));
    i = next;
  }
  return out;
}

function normalizeQuestionLines(t: string): string {
  return String(t).replace(/\r\n?/g, '\n').replace(/(^|\n)[ \t　]+/g, '$1');
}

/** Rich text renderer: vertical marker, bold/italic/underline, furigana, indentation. */
export function renderRich(t: string): string {
  if (!t) return '';

  return `<div style="font-size:16px;line-height:2;color:#1a1917;white-space:pre-wrap;overflow-wrap:anywhere;">${renderRichInline(t)}</div>`;
}

// ── XSS sanitisation ─────────────────────────────────────────
// renderRich/renderQText/etc. emit HTML strings that get pumped into
// dangerouslySetInnerHTML. Anything coming from user-authored question
// content (passages, choices, vocab tags) MUST pass through this filter
// first so injected <script>, on*-handlers, javascript: URIs etc. are
// stripped — even after DB writes are locked down by RLS.
//
// Allowlist covers everything the renderers above can produce:
//   - Block: div  (renderRich wrapper, vertical writing block)
//   - Inline: span, ruby, rt, rp, strong, em, b, i, br
//   - Attrs: style (size/align/vertical), class, data-word (vocab tags)
const SANITIZE_CONFIG = {
  ALLOWED_TAGS: ["div", "span", "ruby", "rt", "rp", "strong", "em", "b", "i", "br",
                 "table", "thead", "tbody", "tr", "td", "th"],
  ALLOWED_ATTR: ["style", "class", "data-word", "colspan", "rowspan"],
};

// ── BBCode table pre-pass ────────────────────────────────────
// [table]…[/table] → <table class="rte-table">…</table>. First
// line = headers, subsequent lines = body rows, '|' separates
// cells. Cell content runs through renderRichInline so 〖vocab〗 /
// 〔grammar〕 / furigana / **bold** / *italic* / __underline__ all
// work inside cells. Must run BEFORE renderRich(Inline) so the
// remaining text doesn't mistake `|` for anything else.
function convertBBTable(src: string): string {
  if (!src || !/\[table\]/i.test(src)) return src;
  return src.replace(/\[table\]([\s\S]*?)\[\/table\]/gi, (_, inner) => {
    const rows = String(inner).trim().split("\n").map(l => l.trim()).filter(Boolean);
    if (rows.length === 0) return "";
    const splitRow = (line: string) => line.split("|").map(c => c.trim());
    const head = splitRow(rows[0]);
    let html = '<table class="rte-table"><thead><tr>';
    for (const h of head) html += `<th>${renderRichInline(h)}</th>`;
    html += '</tr></thead>';
    if (rows.length > 1) {
      html += '<tbody>';
      for (const row of rows.slice(1)) {
        html += '<tr>';
        for (const cell of splitRow(row)) html += `<td>${renderRichInline(cell)}</td>`;
        html += '</tr>';
      }
      html += '</tbody>';
    }
    html += '</table>';
    return html;
  });
}

/** Sanitise an HTML fragment with the renderer-aware allowlist. */
export function sanitizeHtml(html: string): string {
  if (!html) return "";
  return DOMPurify.sanitize(html, SANITIZE_CONFIG);
}

/** renderRich + sanitize — preferred for any dangerouslySetInnerHTML call. */
export function sanitizedRenderRich(t: string): string {
  return sanitizeHtml(renderRich(convertBBTable(t)));
}

/** renderRichInline + sanitize — for fragments that should NOT add the
 *  block-level wrapper div (e.g. children inside a parent renderRich div). */
export function sanitizedRenderRichInline(t: string): string {
  return sanitizeHtml(renderRichInline(convertBBTable(t)));
}


/** (text) → blue underline — kanji, iikae, hyouki */
export function renderQBlue(t: string): string {
  if (!t) return '';
  return t.split(/(\([^)]*\))/).map((p) => {
    if (/^\([^)]*\)$/.test(p)) return `<span style="color:#2b6cb0;text-decoration:underline;font-weight:600;">${p.slice(1, -1)}</span>`;
    return p;
  }).join('');
}

/** (text) → blank box — bunmyaku, bunpo1 */
export function renderQBlank(t: string): string {
  if (!t) return '';
  const body = normalizeQuestionLines(t).split(/(\([^)]*\))/).map((p) => {
    if (/^\([^)]*\)$/.test(p)) return '<span style="display:inline-block;width:32px;height:20px;border:2px solid #1a1917;vertical-align:middle;margin:0 3px;border-radius:3px;"></span>';
    return renderRichInline(p);
  }).join('');
  return `<span style="white-space:pre-wrap;overflow-wrap:anywhere;">${body}</span>`;
}

/** (text) → blue underline for question text of yoho */
export function renderQBlueYoho(t: string): string {
  if (!t) return '';
  return t.split(/(\([^)]*\))/).map((p) => {
    if (/^\([^)]*\)$/.test(p)) return `<span style="color:#2b6cb0;text-decoration:underline;font-weight:600;">${p.slice(1, -1)}</span>`;
    return p;
  }).join('');
}

/** (text) → black bold underline for choice text of yoho */
export function renderQBlackYoho(t: string): string {
  if (!t) return '';
  return t.split(/(\([^)]*\))/).map((p) => {
    if (/^\([^)]*\)$/.test(p)) return `<span style="text-decoration:underline;font-weight:700;">${p.slice(1, -1)}</span>`;
    return p;
  }).join('');
}

/** (★) → gold box, () → blank box — bunpo2 */
export function renderQBunpo2(t: string): string {
  if (!t) return '';
  const body = normalizeQuestionLines(t).split(/(\(★\)|\([^)]*\))/).map((p) => {
    if (p === '(★)') return '<span style="display:inline-flex;align-items:center;justify-content:center;width:34px;height:22px;border:2px solid #d4890a;color:#d4890a;vertical-align:middle;margin:0 2px;border-radius:3px;font-size:12px;font-weight:800;">★</span>';
    if (/^\([^)]*\)$/.test(p)) return '<span style="display:inline-block;width:32px;height:20px;border:2px solid #1a1917;vertical-align:middle;margin:0 2px;border-radius:3px;"></span>';
    return renderRichInline(p);
  }).join('');
  return `<span style="white-space:pre-wrap;overflow-wrap:anywhere;">${body}</span>`;
}

/** Apply correct renderer to question text based on question type. */
export function renderQText(text: string, qType: string): string {
  if (!text) return '';
  if (qType === 'bunmyaku' || qType === 'bunpo1' || qType === 'bjt_3_1' || qType === 'bjt_3_2') return renderQBlank(text);
  if (qType === 'bunpo2') return renderQBunpo2(text);
  const t = parseFurigana(text);
  if (qType === 'kanji' || qType === 'iikae' || qType === 'hyouki') return renderQBlue(t);
  if (qType === 'yoho') return renderQBlueYoho(t);
  return t;
}

/** Apply correct renderer to choice text based on question type. */
export function renderChoiceText(text: string, qType: string): string {
  if (!text) return '';
  const t = parseFurigana(text);
  if (qType === 'yoho') return renderQBlackYoho(t);
  return t;
}

/** Convert ASCII digit(s) to full-width zenkaku: 1 → １ */
export function toZenkaku(n: number | string): string {
  return String(n).split('').map((c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0)).join('');
}

import { TYPE_INSTRUCTIONS, TYPE_MAP_BJT_LABEL } from './constants';

/** Build standard 問題N header HTML. */
export function buildMondaiHeader(mondaiNum: number, typeId: string): string {
  const instr = TYPE_INSTRUCTIONS[typeId] || '';
  return `<div style="background:#fef3ef;border:1px solid #fde0d3;border-radius:12px;padding:12px 18px;margin:18px 0 10px;font-size:17px;line-height:1.8;font-weight:700;">`
    + `<span style="font-weight:800;color:#e8502a;">問題${toZenkaku(mondaiNum)}　</span>`
    + `<span style="color:#1a1917;">${instr}</span>`
    + `</div>`;
}

/** Build BJT section header HTML. */
export function buildBjtSectionHeader(typeId: string): string {
  const jp = TYPE_INSTRUCTIONS[typeId] || '';
  return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px 18px;margin:16px 0 12px;font-size:15px;line-height:1.9;color:var(--text);">`
    + `<span style="font-weight:800;color:var(--accent);">${TYPE_MAP_BJT_LABEL[typeId] || ''}</span>`
    + `<div style="margin-top:8px;">${jp}</div></div>`;
}

/** Return display label for a BJT part. */
export function bjtPartLabel(typeId: string): string {
  if (!typeId || !typeId.startsWith('bjt_')) return '';
  const p = typeId.charAt(4);
  if (p === '1') return '第１部　聴解';
  if (p === '2') return '第２部';
  if (p === '3') return '第３部';
  return '';
}

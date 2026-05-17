// POST /api/admin/vocab — admin-only mutations on vocabulary_library
import { NextResponse } from "next/server";
import { requireAdmin, adminErrorResponse } from "@/lib/supabase-admin";

type Body =
  | { action: "create"; payload: Record<string, unknown> }
  | { action: "update"; id: string; payload: Record<string, unknown> }
  | { action: "delete"; id: string }
  | { action: "bulk_upsert"; rows: Record<string, unknown>[] }
  | { action: "attach_examples"; raw: string };

// Allowlist: only these caller-supplied fields ever reach the DB.
const VOCAB_ALLOWED = new Set([
  "word", "reading", "han_viet", "word_type", "meaning", "meaning_jp",
  "examples", "jlpt_level", "variants",
]);

// ── Helpers cho attach_examples ──────────────────────────────────────────
type ParsedLine = {
  jp:           string;
  vi:           string;
  vocabTerms:   string[];
  grammarTerms: string[];
};

/** Bỏ form furigana {(A)(B)} trong term → chỉ giữ phần kanji A.
 *  Hỗ trợ nhiều block trong cùng term. */
function stripFuriganaToTerm(s: string): string {
  return s
    .replace(/\{\(([^)]*)\)\([^)]*\)\}/g, "$1")
    .trim();
}

/** Tách 1 dòng input thành câu sạch + danh sách term ＜vocab＞ và 「grammar」.
 *  Furigana form {(漢字)(かな)} bên trong marker → term là phần kanji,
 *  còn câu sạch giữ nguyên {(...)(...)} để renderer flashcard hiện ruby. */
function parseExampleLine(line: string): ParsedLine | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let jpRaw = trimmed;
  let vi    = "";
  const arrowIdx = trimmed.indexOf("→");
  if (arrowIdx >= 0) {
    jpRaw = trimmed.slice(0, arrowIdx).trim();
    vi    = trimmed.slice(arrowIdx + 1).trim();
  }

  const vocabRe   = /[＜<]([^＞>]+)[＞>]/g;
  // [] và 「」「』 đều nhận diện là grammar marker
  const grammarRe = /\[([^\]]+)\]/g;

  const v: string[] = [];
  const g: string[] = [];
  for (const m of jpRaw.matchAll(vocabRe)) v.push(stripFuriganaToTerm(m[1]));
  for (const m of jpRaw.matchAll(grammarRe)) {
    // Strip vocab markers <> bên trong grammar term trước khi lưu
    const inner = m[1].replace(/[＜<]([^＞>]+)[＞>]/g, "$1");
    g.push(stripFuriganaToTerm(inner));
  }

  // Strip tất cả marker nhưng giữ nguyên {(漢字)(かな)} để hiện furigana.
  const jp = jpRaw.replace(vocabRe, "$1").replace(grammarRe, "$1").trim();
  if (!jp) return null;

  const dedup = (xs: string[]) => Array.from(new Set(xs.map((s) => s.trim()).filter(Boolean)));
  return { jp, vi, vocabTerms: dedup(v), grammarTerms: dedup(g) };
}

/** Format câu thành chuỗi "JP → VI". */
function formatExample(jp: string, vi: string): string {
  return vi ? `${jp} → ${vi}` : jp;
}

/** Append example vào examples array; dedup theo JP đã chuẩn hoá. */
function appendExample(existing: unknown, jp: string, vi: string): { changed: boolean; next: unknown[] } {
  const arr: unknown[] = Array.isArray(existing) ? [...existing] : [];
  const norm = (s: string) => s.replace(/\s+/g, "");
  const newJpKey = norm(jp);

  const isDup = arr.some((e) => {
    if (typeof e === "string") {
      const ai = e.indexOf(" → ");
      const exJp = ai >= 0 ? e.slice(0, ai) : e;
      return norm(exJp) === newJpKey;
    }
    if (e && typeof e === "object") {
      return norm(String((e as { jp?: string }).jp ?? "")) === newJpKey;
    }
    return false;
  });
  if (isDup) return { changed: false, next: arr };

  arr.push(formatExample(jp, vi));
  return { changed: true, next: arr };
}

function pickAllowed(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (VOCAB_ALLOWED.has(k)) out[k] = v;
  }
  return out;
}

// ── Pending-examples queue ────────────────────────────────────────────────
// Looks up pending_examples rows for the given words/kind and applies them
// to the matching DB entries (vocab or grammar). Consumed rows are deleted.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function applyPendingExamples(service: any, terms: string[], kind: "vocab" | "grammar"): Promise<number> {
  if (terms.length === 0) return 0;

  const { data: pending, error: pErr } = await service
    .from("pending_examples")
    .select("id,term,example")
    .in("term", terms)
    .eq("kind", kind);
  if (pErr || !pending || pending.length === 0) return 0;

  const table  = kind === "vocab" ? "vocabulary_library" : "grammar_library";
  const keyCol = kind === "vocab" ? "word" : "name";

  const uniqueTerms = Array.from(new Set(pending.map((p: { term: string }) => String(p.term))));
  const { data: rows } = await service
    .from(table)
    .select(`id,${keyCol},examples`)
    .in(keyCol, uniqueTerms);
  if (!rows || rows.length === 0) return 0;

  // Index by term
  const byTerm = new Map<string, { id: string | number; examples: unknown }[]>();
  for (const r of rows) {
    const k = String(r[keyCol]).trim();
    const list = byTerm.get(k) ?? [];
    list.push({ id: r.id, examples: r.examples });
    byTerm.set(k, list);
  }

  const dirty = new Map<string | number, unknown[]>();
  const appliedIds: string[] = [];

  for (const p of pending) {
    const term = String(p.term).trim();
    const hits = byTerm.get(term);
    if (!hits) continue;
    const example = String(p.example);
    const arrowIdx = example.indexOf(" → ");
    const jp = arrowIdx >= 0 ? example.slice(0, arrowIdx) : example;
    const vi = arrowIdx >= 0 ? example.slice(arrowIdx + 3) : "";
    for (const r of hits) {
      const cur = dirty.get(r.id) ?? r.examples;
      const { changed, next } = appendExample(cur, jp, vi);
      if (changed) { dirty.set(r.id, next); appliedIds.push(String(p.id)); }
    }
  }

  for (const [id, examples] of dirty) {
    await service.from(table).update({ examples }).eq("id", id);
  }
  if (appliedIds.length > 0) {
    await service.from("pending_examples").delete().in("id", appliedIds);
  }
  return appliedIds.length;
}

export async function POST(req: Request) {
  try {
    const { service } = await requireAdmin(req);
    const body = (await req.json()) as Body;

    if (body.action === "create") {
      const data = pickAllowed(body.payload);
      const { error } = await service.from("vocabulary_library").insert(data);
      if (error) {
        // 23505 = unique violation. The DB has UNIQUE (word)
        // (constraint: vocabulary_library_word_unique) — surface a
        // friendly VN message instead of the raw Postgres text so the
        // admin knows to use Edit on the existing row.
        if ((error as { code?: string }).code === "23505") {
          const w = String(data.word ?? "").trim();
          const r = String(data.reading ?? "").trim();
          return NextResponse.json({
            error: `Từ "${w}"${r ? ` (${r})` : ""} đã tồn tại — hãy tìm và Sửa thay vì Thêm mới.`,
          }, { status: 409 });
        }
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      // Auto-apply any queued pending examples for this new word
      const word = String(data.word ?? "").trim();
      const autoApplied = word ? await applyPendingExamples(service, [word], "vocab") : 0;
      return NextResponse.json({ ok: true, autoApplied });
    }

    if (body.action === "update") {
      if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
      const data = pickAllowed(body.payload);
      const { error } = await service.from("vocabulary_library").update(data).eq("id", body.id);
      if (error) {
        if ((error as { code?: string }).code === "23505") {
          const w = String(data.word ?? "").trim();
          const r = String(data.reading ?? "").trim();
          return NextResponse.json({
            error: `Đã có từ khác với cùng "${w}"${r ? ` (${r})` : ""} — không thể đổi sang giá trị trùng.`,
          }, { status: 409 });
        }
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      return NextResponse.json({ ok: true });
    }

    if (body.action === "delete") {
      if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
      const { error } = await service.from("vocabulary_library").delete().eq("id", body.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    if (body.action === "bulk_upsert") {
      if (!Array.isArray(body.rows) || body.rows.length === 0) {
        return NextResponse.json({ error: "rows required" }, { status: 400 });
      }
      const cleaned = body.rows.map(pickAllowed);
      // Server-side dedup defends against duplicate `word` entries in
      // a single batch — Postgres' ON CONFLICT DO UPDATE can't touch
      // the same row twice in one statement ("cannot affect row a
      // second time"). Last occurrence wins, mirroring the client.
      const deduped = Array.from(
        (cleaned as Record<string, unknown>[]).reduce((map, row) => {
          map.set(row.word as string, row);
          return map;
        }, new Map<string, Record<string, unknown>>()).values()
      );
      // onConflict matches the DB's UNIQUE (word) constraint
      // (vocabulary_library_word_unique) so a re-upload with the same
      // `word` updates the existing row instead of 23505-erroring.
      const { error } = await service.from("vocabulary_library").upsert(deduped, { onConflict: "word" });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      // Auto-apply pending examples for all words in this batch
      const words = deduped.map((r) => String(r.word ?? "").trim()).filter(Boolean);
      const autoApplied = await applyPendingExamples(service, words, "vocab");
      return NextResponse.json({ ok: true, count: deduped.length, autoApplied });
    }

    if (body.action === "attach_examples") {
      if (!body.raw?.trim()) return NextResponse.json({ error: "raw required" }, { status: 400 });

      // 1) Parse từng dòng
      const parsed = body.raw
        .split(/\r?\n/)
        .map(parseExampleLine)
        .filter((p): p is ParsedLine => !!p);
      if (parsed.length === 0) {
        return NextResponse.json({ error: "Không tìm thấy ví dụ hợp lệ." }, { status: 400 });
      }

      // 2) Gom toàn bộ term cần tra
      const allVocab   = Array.from(new Set(parsed.flatMap((p) => p.vocabTerms)));
      const allGrammar = Array.from(new Set(parsed.flatMap((p) => p.grammarTerms)));

      // 3) Load các entry tương ứng (chỉ lấy id + word/name + examples)
      type VocabRow   = { id: string | number; word: string;  examples: unknown };
      type GrammarRow = { id: string | number; name: string;  examples: unknown };

      let vocabRows: VocabRow[] = [];
      let grammarRows: GrammarRow[] = [];

      if (allVocab.length > 0) {
        const { data, error } = await service
          .from("vocabulary_library")
          .select("id,word,examples")
          .in("word", allVocab);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        vocabRows = (data ?? []) as VocabRow[];
      }
      if (allGrammar.length > 0) {
        const { data, error } = await service
          .from("grammar_library")
          .select("id,name,examples")
          .in("name", allGrammar);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        grammarRows = (data ?? []) as GrammarRow[];
      }

      // 4) Index nhanh theo word/name
      const byVocab   = new Map<string, VocabRow[]>();
      const byGrammar = new Map<string, GrammarRow[]>();
      for (const r of vocabRows)   { const k = String(r.word).trim(); const list = byVocab.get(k)   ?? []; list.push(r); byVocab.set(k, list); }
      for (const r of grammarRows) { const k = String(r.name).trim(); const list = byGrammar.get(k) ?? []; list.push(r); byGrammar.set(k, list); }

      // 5) Áp dụng từng line vào row tương ứng (giữ ví dụ đã đổi trong RAM trước)
      const dirtyVocab   = new Map<string | number, unknown[]>();
      const dirtyGrammar = new Map<string | number, unknown[]>();
      let attachedCount = 0;
      const unmatched   = new Set<string>();
      const linesAttached = new Set<number>();
      // Pending entries to save (terms not found in DB yet)
      const pendingRows: { term: string; kind: "vocab" | "grammar"; example: string }[] = [];

      parsed.forEach((line, lineIdx) => {
        const applyVocab = (term: string) => {
          const hits = byVocab.get(term);
          if (!hits || hits.length === 0) {
            unmatched.add(term);
            pendingRows.push({ term, kind: "vocab", example: formatExample(line.jp, line.vi) });
            return;
          }
          for (const r of hits) {
            const cur = dirtyVocab.get(r.id) ?? r.examples;
            const { changed, next } = appendExample(cur, line.jp, line.vi);
            if (changed) {
              dirtyVocab.set(r.id, next);
              attachedCount++;
              linesAttached.add(lineIdx);
            }
          }
        };
        const applyGrammar = (term: string) => {
          const hits = byGrammar.get(term);
          if (!hits || hits.length === 0) {
            unmatched.add(term);
            pendingRows.push({ term, kind: "grammar", example: formatExample(line.jp, line.vi) });
            return;
          }
          for (const r of hits) {
            const cur = dirtyGrammar.get(r.id) ?? r.examples;
            const { changed, next } = appendExample(cur, line.jp, line.vi);
            if (changed) {
              dirtyGrammar.set(r.id, next);
              attachedCount++;
              linesAttached.add(lineIdx);
            }
          }
        };
        line.vocabTerms.forEach(applyVocab);
        line.grammarTerms.forEach(applyGrammar);
      });

      // 6) Bulk update các row đã đổi
      for (const [id, examples] of dirtyVocab) {
        const { error } = await service.from("vocabulary_library").update({ examples }).eq("id", id);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      }
      for (const [id, examples] of dirtyGrammar) {
        const { error } = await service.from("grammar_library").update({ examples }).eq("id", id);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      }

      // 7) Lưu các ví dụ chưa khớp vào hàng chờ (pending_examples)
      //    → sẽ tự động đính vào khi từ/ngữ pháp đó được thêm sau này.
      let pendingSaved = 0;
      if (pendingRows.length > 0) {
        const { error: pErr } = await service.from("pending_examples").insert(pendingRows);
        if (!pErr) pendingSaved = pendingRows.length;
        // Non-fatal: don't fail the whole request if pending save has an issue
      }

      return NextResponse.json({
        ok:              true,
        linesParsed:     parsed.length,
        linesAttached:   linesAttached.size,
        vocabUpdated:    dirtyVocab.size,
        grammarUpdated:  dirtyGrammar.size,
        attachedCount,
        unmatchedTerms:  Array.from(unmatched),
        pendingSaved,
      });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) { return adminErrorResponse(e); }
}

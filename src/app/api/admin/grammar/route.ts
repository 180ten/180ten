// POST /api/admin/grammar — admin-only mutations on grammar_library
import { NextResponse } from "next/server";
import { requireAdmin, adminErrorResponse } from "@/lib/supabase-admin";

type Body =
  | { action: "create"; payload: Record<string, unknown> }
  | { action: "update"; id: string; payload: Record<string, unknown> }
  | { action: "delete"; id: string }
  | { action: "bulk_upsert"; rows: Record<string, unknown>[] };

// Allowlist: only these caller-supplied fields ever reach the DB.
// Prevents mass-assignment of system columns (id, created_at, …).
const GRAMMAR_ALLOWED = new Set([
  "name", "furigana", "meaning", "conjugation", "jlpt_level", "examples",
]);
function pickAllowed(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (GRAMMAR_ALLOWED.has(k)) out[k] = v;
  }
  return out;
}

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
    if (e && typeof e === "object") return norm(String((e as { jp?: string }).jp ?? "")) === newJpKey;
    return false;
  });
  if (isDup) return { changed: false, next: arr };
  arr.push(vi ? `${jp} → ${vi}` : jp);
  return { changed: true, next: arr };
}

/** Apply queued pending_examples (kind='grammar') to newly inserted grammar entries. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function applyPendingGrammar(service: any, names: string[]): Promise<number> {
  if (names.length === 0) return 0;
  const { data: pending, error: pErr } = await service
    .from("pending_examples")
    .select("id,term,example")
    .in("term", names)
    .eq("kind", "grammar");
  if (pErr || !pending || pending.length === 0) return 0;

  const uniqueNames = Array.from(new Set(pending.map((p: { term: string }) => String(p.term))));
  const { data: rows } = await service
    .from("grammar_library")
    .select("id,name,examples")
    .in("name", uniqueNames);
  if (!rows || rows.length === 0) return 0;

  const byName = new Map<string, { id: string | number; examples: unknown }[]>();
  for (const r of rows) {
    const k = String(r.name).trim();
    const list = byName.get(k) ?? [];
    list.push({ id: r.id, examples: r.examples });
    byName.set(k, list);
  }

  const dirty = new Map<string | number, unknown[]>();
  const appliedIds: string[] = [];

  for (const p of pending) {
    const name = String(p.term).trim();
    const hits = byName.get(name);
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
    await service.from("grammar_library").update({ examples }).eq("id", id);
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
      const { error } = await service.from("grammar_library").insert(data);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      // Auto-apply any queued pending examples for this grammar entry
      const name = String(data.name ?? "").trim();
      const autoApplied = name ? await applyPendingGrammar(service, [name]) : 0;
      return NextResponse.json({ ok: true, autoApplied });
    }

    if (body.action === "update") {
      if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
      const { error } = await service.from("grammar_library").update(pickAllowed(body.payload)).eq("id", body.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    if (body.action === "delete") {
      if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
      const { error } = await service.from("grammar_library").delete().eq("id", body.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    if (body.action === "bulk_upsert") {
      if (!Array.isArray(body.rows) || body.rows.length === 0) {
        return NextResponse.json({ error: "rows required" }, { status: 400 });
      }
      const cleaned = body.rows.map(pickAllowed);
      const { error } = await service.from("grammar_library").upsert(cleaned);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      // Auto-apply pending examples for all grammar names in this batch
      const names = cleaned.map((r) => String(r.name ?? "").trim()).filter(Boolean);
      const autoApplied = await applyPendingGrammar(service, names);
      return NextResponse.json({ ok: true, count: cleaned.length, autoApplied });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) { return adminErrorResponse(e); }
}

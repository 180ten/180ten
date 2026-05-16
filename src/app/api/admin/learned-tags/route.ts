// /api/admin/learned-tags
//
// GET  → returns every row in learned_tags as { surface, tag_type }[]
//        for the auto-track route to merge into its dictionary.
// POST → body { tags: { surface, tag_type }[] } — inserts new rows,
//        skips ones already present (any tag_type), and reports any
//        surface/type conflicts (same surface stored as the OTHER
//        type) so the admin can fix the source markup.
//
// Admin-only — service role bypasses RLS so the learned_tags table
// stays writable through this endpoint without exposing it to
// learners.

import { NextResponse } from "next/server";
import { requireAdmin, adminErrorResponse } from "@/lib/supabase-admin";

type TagType = "vocab" | "grammar";
interface LearnedTag { surface: string; tag_type: TagType }
interface PostBody    { tags?: unknown }

export async function GET(req: Request): Promise<NextResponse> {
  try {
    const { service } = await requireAdmin(req);
    const { data, error } = await service
      .from("learned_tags")
      .select("surface, tag_type")
      .order("surface");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ tags: data ?? [] });
  } catch (e) {
    return adminErrorResponse(e);
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const { service } = await requireAdmin(req);
    const body = (await req.json()) as PostBody;
    const incoming: LearnedTag[] = Array.isArray(body.tags)
      ? (body.tags as unknown[])
          .map((t): LearnedTag | null => {
            if (!t || typeof t !== "object") return null;
            const surface = String((t as { surface?: unknown }).surface ?? "").trim();
            const tag_type = String((t as { tag_type?: unknown }).tag_type ?? "");
            if (!surface || (tag_type !== "vocab" && tag_type !== "grammar")) return null;
            return { surface, tag_type: tag_type as TagType };
          })
          .filter((t): t is LearnedTag => t !== null)
      : [];

    if (incoming.length === 0) {
      return NextResponse.json({ added: 0, skipped: 0, conflicts: [] });
    }

    // De-dup by surface within this request — last value wins.
    const dedup = new Map<string, LearnedTag>();
    for (const t of incoming) dedup.set(t.surface, t);
    const tags = Array.from(dedup.values());

    const { data: existing, error: selErr } = await service
      .from("learned_tags")
      .select("surface, tag_type")
      .in("surface", tags.map((t) => t.surface));
    if (selErr) return NextResponse.json({ error: selErr.message }, { status: 500 });

    const existingMap = new Map<string, TagType>(
      (existing ?? []).map((e) => [e.surface as string, e.tag_type as TagType]),
    );

    const conflicts: string[] = [];
    const toInsert: LearnedTag[] = [];
    let skipped = 0;

    for (const tag of tags) {
      const prior = existingMap.get(tag.surface);
      if (prior) {
        if (prior !== tag.tag_type) {
          conflicts.push(`"${tag.surface}" đã được lưu là ${prior === "vocab" ? "〖〗" : "〔〕"}`);
        }
        skipped++;
        continue;
      }
      toInsert.push(tag);
    }

    let added = 0;
    if (toInsert.length > 0) {
      const { error: insErr } = await service.from("learned_tags").insert(toInsert);
      if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
      added = toInsert.length;
    }

    return NextResponse.json({ added, skipped, conflicts });
  } catch (e) {
    return adminErrorResponse(e);
  }
}

export function PUT()    { return NextResponse.json({ error: "Method not allowed" }, { status: 405 }); }
export function DELETE() { return NextResponse.json({ error: "Method not allowed" }, { status: 405 }); }
export function PATCH()  { return NextResponse.json({ error: "Method not allowed" }, { status: 405 }); }

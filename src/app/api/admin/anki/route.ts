// POST /api/admin/anki — admin-only mutations on anki_decks + anki_folders
import { NextResponse } from "next/server";
import { requireAdmin, adminErrorResponse } from "@/lib/supabase-admin";

type Body =
  | { action: "create_folder"; name: string }
  | { action: "delete_folder"; id: string }
  | { action: "create_deck";   name: string; folder_id: string | null; cards: unknown[] }
  | { action: "delete_deck";   id: string }
  | { action: "move_deck";     id: string; folder_id: string | null };

export async function POST(req: Request) {
  try {
    const { service } = await requireAdmin(req);
    const body = (await req.json()) as Body;

    if (body.action === "create_folder") {
      if (!body.name?.trim()) return NextResponse.json({ error: "name required" }, { status: 400 });
      const { error } = await service.from("anki_folders")
        .insert({ name: body.name.trim(), is_admin: true });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    if (body.action === "delete_folder") {
      if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
      // Detach decks first
      const { error: e1 } = await service.from("anki_decks")
        .update({ folder_id: null }).eq("folder_id", body.id);
      if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });
      const { error } = await service.from("anki_folders").delete().eq("id", body.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    if (body.action === "create_deck") {
      if (!body.name?.trim()) return NextResponse.json({ error: "name required" }, { status: 400 });
      const { error } = await service.from("anki_decks").insert({
        name:      body.name.trim(),
        folder_id: body.folder_id ?? null,
        cards:     body.cards ?? [],
        is_admin:  true,
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    if (body.action === "delete_deck") {
      if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
      await service.from("anki_card_progress").delete().eq("deck_id", body.id);
      const { error } = await service.from("anki_decks").delete().eq("id", body.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    if (body.action === "move_deck") {
      if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
      const { error } = await service.from("anki_decks")
        .update({ folder_id: body.folder_id ?? null }).eq("id", body.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) { return adminErrorResponse(e); }
}

// GET /api/admin/autotrack
// Returns the dictionary used by ComposeTab's "⚡ Auto-track" button
// to wrap matching surfaces in 〖〗 (vocab) / 〔〕 (grammar).
//
// Vocab: each entry has `word` plus an optional `variants` array
// (inflected forms). Grammar: `name`. Both are sent in canonical
// order — the client sorts by length descending before scanning.
//
// Admin-only — uses service role to read both libraries.

import { NextResponse } from "next/server";
import { requireAdmin, adminErrorResponse } from "@/lib/supabase-admin";

export async function GET(req: Request): Promise<NextResponse> {
  try {
    const { service } = await requireAdmin(req);

    // learned_tags: surfaces an admin has explicitly tagged inside a
    // passage and saved via the "📖 Học" button. Auto-track gives them
    // priority over the dictionaries so freshly-learned forms always
    // win against shorter dictionary entries.
    const [vocabRes, grammarRes, learnedRes] = await Promise.all([
      service
        .from("vocabulary_library")
        .select("word, variants")
        .order("word"),
      service
        .from("grammar_library")
        .select("name")
        .order("name"),
      service
        .from("learned_tags")
        .select("surface, tag_type")
        .order("surface"),
    ]);

    if (vocabRes.error) {
      return NextResponse.json({ error: vocabRes.error.message }, { status: 500 });
    }
    if (grammarRes.error) {
      return NextResponse.json({ error: grammarRes.error.message }, { status: 500 });
    }
    // learned_tags is brand new — if the migration hasn't been applied
    // yet (or the table is empty), fall back to [] rather than 500ing
    // the whole dictionary fetch.
    const learned = learnedRes.error ? [] : (learnedRes.data ?? []);

    return NextResponse.json({
      vocab: vocabRes.data ?? [],
      grammar: grammarRes.data ?? [],
      learned,
    });
  } catch (e) {
    return adminErrorResponse(e);
  }
}

export function POST()   { return NextResponse.json({ error: "Method not allowed" }, { status: 405 }); }
export function PUT()    { return NextResponse.json({ error: "Method not allowed" }, { status: 405 }); }
export function DELETE() { return NextResponse.json({ error: "Method not allowed" }, { status: 405 }); }
export function PATCH()  { return NextResponse.json({ error: "Method not allowed" }, { status: 405 }); }

import type { SupabaseClient } from "@supabase/supabase-js";

/** PostgREST `.in()` với danh sách rất dài dễ vượt giới hạn URL — chia nhỏ và gộp kết quả. */
const WORD_IN_CHUNK = 100;

export async function fetchDictionaryWords(
  client: SupabaseClient,
  words: string[],
): Promise<{ data: Record<string, unknown>[]; error: { message: string } | null }> {
  const uniq = [...new Set(words.map((w) => w.trim()).filter(Boolean))];
  const merged: Record<string, unknown>[] = [];
  for (let i = 0; i < uniq.length; i += WORD_IN_CHUNK) {
    const slice = uniq.slice(i, i + WORD_IN_CHUNK);
    const { data, error } = await client.from("vocabulary_library").select("*").in("word", slice);
    if (error) return { data: [], error: { message: error.message } };
    if (data?.length) merged.push(...(data as Record<string, unknown>[]));
  }
  return { data: merged, error: null };
}

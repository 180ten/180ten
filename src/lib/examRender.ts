// src/lib/examRender.ts
// Rendering-side types + small helpers.
// Choice shuffling has moved to the server (see examShuffle.ts and the
// /api/exam/[id]/start endpoint). The client never sees `correct`/`wrongs`
// during the exam — only pre-shuffled `choices: string[]`.

export interface SubQuestion {
  question?: string;
  mainQuestion?: string;
  /** Pre-shuffled by server. Use this directly when rendering. */
  choices?: string[];
  /** @deprecated server strips this — present only on admin-side preview. */
  correct?: string;
  /** @deprecated server strips this — present only on admin-side preview. */
  wrongs?: string[];
  explanation?: string;
  vocab?: string;
  grammar?: string;
  imageUrl?: string;
  imageurl?: string;
  image_url?: string;
}

export interface PassageGroup {
  text?: string;
  questions?: SubQuestion[];
}

export function getSubImageUrl(d: Record<string, unknown> | SubQuestion): string {
  const u =
    (d as Record<string, unknown>).imageUrl ??
    (d as Record<string, unknown>).imageurl ??
    (d as Record<string, unknown>).image_url;
  return typeof u === "string" ? u : "";
}

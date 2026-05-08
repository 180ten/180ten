import { createClient } from "@supabase/supabase-js";

// ── Required env vars ────────────────────────────────────────────────
// Hard-fail at module load if either is missing. Next.js inlines
// NEXT_PUBLIC_* at build time, so a missing var produces a thrown error
// the first time this module is imported in the browser or on the server.

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!SUPA_URL) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
}

const SUPA_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!SUPA_KEY) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_ANON_KEY");
}

// ── Derived storage key ──────────────────────────────────────────────
// Supabase JS uses `sb-${projectRef}-auth-token` by default.
// Derive from URL so we don't leak the project ref anywhere else.
function deriveStorageKey(url: string): string {
  const ref = url.match(/^https?:\/\/([^.]+)\.supabase\.co/i)?.[1];
  if (!ref) {
    throw new Error(`Cannot derive Supabase project ref from URL: ${url}`);
  }
  return `sb-${ref}-auth-token`;
}

export const SB_STORAGE_KEY = deriveStorageKey(SUPA_URL);

// ── Clients ──────────────────────────────────────────────────────────

/** Main app session (same storage key as default Supabase client). */
export const sb = createClient(SUPA_URL, SUPA_KEY, {
  auth: {
    storage: typeof window !== "undefined" ? window.localStorage : undefined,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: "pkce",
  },
});


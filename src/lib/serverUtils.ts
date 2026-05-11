// src/lib/serverUtils.ts
// SERVER-ONLY shared utilities for the /api/exam/* routes.
// Edge-compatible: uses Web Crypto APIs (no Node-only imports).

/**
 * Hex-encoded SHA-256 of `input`.
 * Used to derive `session_key = sha256(identity:examId:SERVER_SEED_SECRET)`
 * for the exam_sessions table — keeps the raw identity opaque.
 */
export async function hashSHA256(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

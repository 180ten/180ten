// src/lib/uuid.ts
// crypto.randomUUID() requires a secure context (HTTPS or localhost) — it
// throws in modern browsers when the page is served from a LAN IP over HTTP.
// This wrapper falls back to a v4 UUID built from getRandomValues (always
// available) and finally to Math.random for ancient runtimes.

export function randomUUID(): string {
  // 1) Native, secure context only
  try {
    const c = (typeof globalThis !== "undefined" ? globalThis.crypto : undefined) as
      | (Crypto & { randomUUID?: () => string })
      | undefined;
    if (c?.randomUUID) return c.randomUUID();
  } catch { /* ignore */ }

  // 2) v4 from getRandomValues — works in any browser, any context
  try {
    const c = globalThis.crypto;
    if (c?.getRandomValues) {
      const b = new Uint8Array(16);
      c.getRandomValues(b);
      b[6] = (b[6] & 0x0f) | 0x40; // version 4
      b[8] = (b[8] & 0x3f) | 0x80; // variant 10xx
      const h = Array.from(b, (n) => n.toString(16).padStart(2, "0"));
      return `${h.slice(0, 4).join("")}-${h.slice(4, 6).join("")}-${h.slice(6, 8).join("")}-${h.slice(8, 10).join("")}-${h.slice(10, 16).join("")}`;
    }
  } catch { /* ignore */ }

  // 3) Last-resort, NOT cryptographically random — fine for client-side ids
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

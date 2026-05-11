"use client";
// src/lib/deviceFingerprint.ts
// CLIENT-ONLY — never import from a server route.
//
// FingerprintJS open-source (no Pro account) returns a stable visitorId for
// the user's browser/device combo. Stable enough to detect "same machine
// signing in twice in 2 different tabs" but NOT a strong fraud signal —
// users who clear browser data or switch browsers get a new id. That's
// acceptable for the anti-account-sharing flow: the worst case is a few
// extra "session kicked" prompts, never a false data leak.

import FingerprintJS from "@fingerprintjs/fingerprintjs";

let cached: string | null = null;
let inflight: Promise<string> | null = null;

export async function getDeviceFingerprint(): Promise<string> {
  if (cached) return cached;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const fp = await FingerprintJS.load();
      const result = await fp.get();
      cached = result.visitorId;
      return cached;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Best-effort human label, e.g. "Chrome on MacOS". UA-based, unreliable
 *  on modern UA-Client-Hints browsers but good enough for a "manage
 *  devices" list later. */
export function getDeviceName(): string {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const browser = ua.includes("Edg")     ? "Edge"
                : ua.includes("Chrome")  ? "Chrome"
                : ua.includes("Firefox") ? "Firefox"
                : ua.includes("Safari")  ? "Safari"
                : "Browser";
  const os = ua.includes("iPhone")  ? "iPhone"
           : ua.includes("iPad")    ? "iPad"
           : ua.includes("Android") ? "Android"
           : ua.includes("Mac")     ? "MacOS"
           : ua.includes("Win")     ? "Windows"
           : ua.includes("Linux")   ? "Linux"
           : "Unknown";
  return `${browser} on ${os}`;
}

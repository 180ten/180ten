"use client";
import { useEffect } from "react";
import { sb } from "@/lib/supabase";

/**
 * Wakes up Supabase realtime sockets that browsers close on idle background
 * tabs. Auth-token freshness is left to the supabase-js
 * `autoRefreshToken: true` setting — calling refreshSession() here used to
 * race with fresh-login token storage writes and trigger Supabase's
 * "compromised refresh token" detection on focus events right after a new
 * login, signing the user out immediately.
 *
 * Safe to mount once at app root.
 */
export function useTabVisibility(): void {
  useEffect(() => {
    let last = 0;
    const THROTTLE_MS = 5_000;

    function rehydrate() {
      const now = Date.now();
      if (now - last < THROTTLE_MS) return;
      last = now;
      // Auth refresh deliberately removed — see header comment.
      try {
        const rt = sb.realtime as unknown as { isConnected?: () => boolean; connect?: () => void };
        if (rt.connect && rt.isConnected && !rt.isConnected()) rt.connect();
      } catch { /* ignore */ }
    }

    function onVisible() {
      if (document.visibilityState === "visible") rehydrate();
    }
    function onFocus() { rehydrate(); }

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  }, []);
}

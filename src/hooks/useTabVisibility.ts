"use client";
import { useEffect } from "react";
import { sb } from "@/lib/supabase";

/**
 * Combined visibility/focus handler that fixes Chrome background-tab freeze:
 * - Refreshes Supabase auth session when tab becomes visible (or window focused).
 * - Reconnects Supabase realtime channels (browsers close idle WebSockets).
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
      // refreshSession() actually requests a new access token from Supabase
      // (getSession() only reads in-memory state and won't fix an expired token).
      void sb.auth.refreshSession();
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

"use client";
// ── useAuth.ts ───────────────────────────────────────────────
// Auth state migrated from the boot IIFE and fetchProfile() in index.html.
// Manages SB_USER + SB_PROFILE, handles onAuthStateChange, stale-session cleanup.
// ─────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback } from 'react';
import type { User } from '@supabase/supabase-js';
import { sb } from '@/lib/supabase';
import { SB_STORAGE_KEY } from '@/lib/constants';

export interface Profile {
  id: string;
  email: string;
  name: string;
  plan: string;
  role?: string;
  [key: string]: unknown;
}

export interface AuthState {
  user:    User | null;
  profile: Profile | null;
  ready:   boolean;
}

function cleanStaleSession(): void {
  // Sweep legacy admin-portal storage key (the old `sbAdmin` client we removed).
  // Without this, getSession() on the regular client can collide with stale
  // entries and throw "Invalid Refresh Token: Refresh Token Not Found".
  try { localStorage.removeItem('sb-admin-session'); } catch { /* ignore */ }

  try {
    const raw = localStorage.getItem(SB_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    const session = parsed && (parsed.access_token ? parsed : (parsed.currentSession || null));
    if (!session || !session.access_token || (session.expires_at && session.expires_at * 1000 < Date.now())) {
      localStorage.removeItem(SB_STORAGE_KEY);
    }
  } catch { localStorage.removeItem(SB_STORAGE_KEY); }
}

function getSessionFromStorage() {
  try {
    const raw = localStorage.getItem(SB_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const session = parsed && (parsed.access_token ? parsed : (parsed.currentSession || null));
    if (!session || !session.access_token) return null;
    if (session.expires_at && session.expires_at * 1000 < Date.now()) return null;
    return session;
  } catch { return null; }
}

export function useAuth(): AuthState & { refetchProfile: () => Promise<void> } {
  const [user,    setUser]    = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [ready,   setReady]   = useState(false);

  /** Returns true on success, false if all paths failed (e.g., network/RLS error). */
  const fetchProfile = useCallback(async (u: User): Promise<boolean> => {
    try {
      // Narrow column list — skips heavy jsonb / blob columns that aren't read
      // before SplashScreen lifts. Every consumer of `profile` reads only the
      // fields below (audited 2026-05-09): id, email, name, plan,
      // plan_expires_at, role. Other tables/queries fetch what they need.
      const r = await sb.from('profiles')
        .select('id, email, name, plan, plan_expires_at, role')
        .eq('id', u.id).single();
      if (r.data) {
        const data = r.data as Profile & { plan_expires_at?: string | null };
        // Tự động hạ về 'free' nếu plan có hạn và đã hết
        const plan = (data.plan || 'free').toLowerCase();
        const expRaw = data.plan_expires_at;
        const isTimeLimited = plan !== 'free' && plan !== 'lifetime';
        if (isTimeLimited && expRaw) {
          const exp = new Date(expRaw);
          if (!isNaN(exp.getTime()) && exp.getTime() < Date.now()) {
            await sb.from('profiles')
              .update({ plan: 'free', plan_expires_at: null })
              .eq('id', u.id);
            setProfile({ ...data, plan: 'free', plan_expires_at: null } as Profile);
            return true;
          }
        }
        setProfile(data as Profile);
        return true;
      }
      // Row missing → create fallback so Nav shows full pill instead of "Đăng xuất only".
      const fallback: Profile = {
        id:    u.id,
        email: u.email ?? '',
        name:  (u.user_metadata?.full_name as string) || u.email?.split('@')[0] || 'User',
        plan:  'free',
      };
      setProfile(fallback);
      try {
        await sb.from('profiles').upsert(
          { id: u.id, email: u.email, name: fallback.name, plan: 'free' },
          { onConflict: 'id', ignoreDuplicates: true }
        );
      } catch { /* ignore upsert failure — profile state already set */ }
      return true;
    } catch (e) {
      console.warn('[useAuth] fetchProfile failed:', e);
      return false;
    }
  }, []);

  const refetchProfile = useCallback(async () => {
    if (user) await fetchProfile(user);
  }, [user, fetchProfile]);

  useEffect(() => {
    cleanStaleSession();

    let booted = false;
    const safetyTimer = setTimeout(() => { if (!booted) { booted = true; setReady(true); } }, 6000);

    const boot = async (u: User | null) => {
      if (booted) return;
      booted = true;
      clearTimeout(safetyTimer);
      if (u) {
        setUser(u);
        for (let i = 0; i < 3; i++) {
          const ok = await fetchProfile(u);
          if (ok) break;
          await new Promise<void>((r) => setTimeout(r, 600));
        }
      }
      setReady(true);
    };

    const localSession = getSessionFromStorage();
    if (localSession?.user) {
      boot(localSession.user as User);
    }

    const { data: { subscription } } = sb.auth.onAuthStateChange(async (evt, ses) => {
      if (evt === 'SIGNED_OUT') {
        setUser(null); setProfile(null);
        if (!booted) { booted = true; clearTimeout(safetyTimer); setReady(true); }
        return;
      }
      if (evt === 'TOKEN_REFRESHED' && !ses) {
        try { localStorage.removeItem(SB_STORAGE_KEY); } catch {}
        setUser(null); setProfile(null);
        if (!booted) { booted = true; clearTimeout(safetyTimer); setReady(true); }
        return;
      }
      if (ses?.user) {
        setUser(ses.user);
        for (let i = 0; i < 3; i++) {
          const ok = await fetchProfile(ses.user);
          if (ok) break;
          await new Promise<void>((r) => setTimeout(r, 600));
        }
        if (!booted) { booted = true; clearTimeout(safetyTimer); setReady(true); }
        if (evt === 'SIGNED_IN' && typeof window !== 'undefined' && window.location.hash) {
          window.history.replaceState(null, '', window.location.pathname);
        }
      }
    });

    (async () => {
      try {
        const s = await Promise.race([
          sb.auth.getSession(),
          new Promise<{ data: { session: null } }>((r) => setTimeout(() => r({ data: { session: null } }), 3000)),
        ]);
        if (s.data?.session?.user) {
          await boot(s.data.session.user);
        } else {
          const hasToken = typeof window !== 'undefined' &&
            (window.location.hash.includes('access_token') ||
             window.location.hash.includes('type=signup') ||
             window.location.search.includes('code='));
          if (!hasToken) await boot(null);
        }
      } catch { await boot(null); }
    })();

    return () => { clearTimeout(safetyTimer); subscription.unsubscribe(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tự cập nhật profile khi admin đổi plan / role từ Supabase Studio:
  //   1) Realtime trên row profile của user (cần bật Realtime cho bảng profiles)
  //   2) Refetch khi user quay lại tab (fallback luôn hoạt động)
  useEffect(() => {
    if (!user) return;

    const channel = sb
      .channel(`profile:${user.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${user.id}` },
        (payload) => { setProfile(payload.new as Profile); },
      )
      .subscribe();

    let lastFetch = 0;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastFetch < 30_000) return; // throttle: tối đa 1 lần / 30s
      lastFetch = now;
      void fetchProfile(user);
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);

    return () => {
      sb.removeChannel(channel);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [user, fetchProfile]);

  return { user, profile, ready, refetchProfile };
}

"use client";
// ── useAuth.ts ───────────────────────────────────────────────
// Auth state migrated from the boot IIFE and fetchProfile() in index.html.
// Manages SB_USER + SB_PROFILE, handles onAuthStateChange, stale-session cleanup.
// ─────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback, useRef } from 'react';
import type { User } from '@supabase/supabase-js';
import { sb } from '@/lib/supabase';
import { SB_STORAGE_KEY } from '@/lib/constants';
import { getDeviceFingerprint, getDeviceName } from '@/lib/deviceFingerprint';

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
    console.log('[useAuth] fetchProfile ENTER', { uid: u.id });
    const t0 = Date.now();
    try {
      // BISECT: temporarily reverted to select('*') to rule out narrowing as
      // cause of post-deploy SplashScreen hang. Restore narrow list once
      // root-cause is confirmed.
      const r = await sb.from('profiles')
        .select('*')
        .eq('id', u.id).single();
      console.log('[useAuth] fetchProfile QUERY', {
        elapsedMs: Date.now() - t0,
        hasData: !!r.data,
        errorCode: r.error?.code ?? null,
        errorMessage: r.error?.message ?? null,
        dataKeys: r.data ? Object.keys(r.data) : null,
      });
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
            console.log('[useAuth] fetchProfile EXIT (downgraded plan)', { elapsedMs: Date.now() - t0 });
            return true;
          }
        }
        setProfile(data as Profile);
        console.log('[useAuth] fetchProfile EXIT (ok)', { elapsedMs: Date.now() - t0 });
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
      } catch (upErr) {
        console.warn('[useAuth] fetchProfile upsert fallback failed:', upErr);
      }
      console.log('[useAuth] fetchProfile EXIT (fallback)', { elapsedMs: Date.now() - t0 });
      return true;
    } catch (e) {
      console.warn('[useAuth] fetchProfile THREW:', e, { elapsedMs: Date.now() - t0 });
      return false;
    }
  }, []);

  const refetchProfile = useCallback(async () => {
    if (user) await fetchProfile(user);
  }, [user, fetchProfile]);

  useEffect(() => {
    console.log('[useAuth] effect MOUNT');
    cleanStaleSession();

    let booted = false;
    const safetyTimer = setTimeout(() => {
      if (!booted) {
        console.warn('[useAuth] safetyTimer FIRED at 6s — boot hung, forcing ready=true');
        booted = true;
        setReady(true);
      }
    }, 6000);

    // 4-second per-attempt timeout — if Supabase auth lock contention
    // hangs fetchProfile, race against a timer that resolves false so the
    // boot loop can move on instead of blocking setReady forever.
    const fetchProfileBounded = (u: User): Promise<boolean> =>
      Promise.race([
        fetchProfile(u),
        new Promise<boolean>((r) => setTimeout(() => r(false), 4000)),
      ]);

    const boot = async (u: User | null, reason: string) => {
      console.log('[useAuth] boot ENTER', { reason, hasUser: !!u, alreadyBooted: booted });
      if (booted) return;
      booted = true;
      // Note: safety timer NOT cleared here — kept armed so that if any
      // step below stalls past 6s the timer can still force ready=true.
      if (u) {
        setUser(u);
        for (let i = 0; i < 3; i++) {
          console.log('[useAuth] boot fetchProfile attempt', i + 1);
          const ok = await fetchProfileBounded(u);
          console.log('[useAuth] boot fetchProfile attempt', i + 1, '→', ok);
          if (ok) break;
          await new Promise<void>((r) => setTimeout(r, 600));
        }
      }
      // Work done — now release the safety net and lift the splash.
      clearTimeout(safetyTimer);
      setReady(true);
      console.log('[useAuth] boot DONE setReady(true)', { reason });
    };

    const localSession = getSessionFromStorage();
    console.log('[useAuth] localStorage session present?', !!localSession?.user);
    if (localSession?.user) {
      boot(localSession.user as User, 'localStorage');
    }

    const { data: { subscription } } = sb.auth.onAuthStateChange(async (evt, ses) => {
      console.log('[useAuth] onAuthStateChange', { evt, hasSession: !!ses, booted });
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
        // Skip the fetchProfile loop when boot has already completed it.
        // Otherwise INITIAL_SESSION triggers a duplicate fetch that races
        // boot's own fetch and contributes to Supabase auth-lock contention.
        if (!booted) {
          for (let i = 0; i < 3; i++) {
            const ok = await fetchProfileBounded(ses.user);
            if (ok) break;
            await new Promise<void>((r) => setTimeout(r, 600));
          }
          booted = true;
          clearTimeout(safetyTimer);
          setReady(true);
        }
        if (evt === 'SIGNED_IN' && typeof window !== 'undefined' && window.location.hash) {
          window.history.replaceState(null, '', window.location.pathname);
        }
      }
    });

    (async () => {
      try {
        console.log('[useAuth] getSession race START');
        const s = await Promise.race([
          sb.auth.getSession(),
          new Promise<{ data: { session: null } }>((r) => setTimeout(() => r({ data: { session: null } }), 3000)),
        ]);
        console.log('[useAuth] getSession race RESULT', { hasSession: !!s.data?.session?.user });
        if (s.data?.session?.user) {
          await boot(s.data.session.user, 'getSession');
        } else {
          const hasToken = typeof window !== 'undefined' &&
            (window.location.hash.includes('access_token') ||
             window.location.hash.includes('type=signup') ||
             window.location.search.includes('code='));
          if (!hasToken) await boot(null, 'getSession-empty');
        }
      } catch (e) {
        console.warn('[useAuth] getSession race threw:', e);
        await boot(null, 'getSession-throw');
      }
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
    // user.id (not user) — onAuthStateChange replaces the User object on
    // every TOKEN_REFRESHED, which would tear down + leave the channel
    // unsubscribed (the lastRegisteredUidRef guard blocks re-subscribe).
    // Keying on .id only re-runs when the actual identity changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, fetchProfile]);

  // ── Anti-account-sharing: register active session + check anomalies ──
  // Fires once per logged-in user. Decoupled from the boot path so a hung
  // /api/session/* request can never block setReady.
  //
  // After a successful /register, subscribes to a Supabase Realtime channel
  // that fires when this device's user_sessions row gets DELETEd by a
  // sibling /register that exceeded the per-plan cap. On that event we
  // dispatch session-kicked (UI banner) and then sb.auth.signOut() so the
  // kicked browser drops back to the login screen.
  //
  // Filter is `id=eq.${session_id}` (PK) — Supabase Realtime supports
  // value filters on any column, but PK is the most reliable choice and
  // matches the RLS SELECT policy "auth.uid() = user_id".
  const lastRegisteredUidRef = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || !user) return;
    if (lastRegisteredUidRef.current === user.id) return;
    lastRegisteredUidRef.current = user.id;

    let alive = true;
    let kickChannel: ReturnType<typeof sb.channel> | null = null;

    (async () => {
      try {
        const deviceId   = await getDeviceFingerprint();
        const deviceName = getDeviceName();
        const ses        = await sb.auth.getSession();
        const token      = ses.data.session?.access_token;
        if (!token || !alive) return;

        // Register — await so we know if a sibling session got kicked.
        const res = await fetch('/api/session/register', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body:    JSON.stringify({ device_id: deviceId, device_name: deviceName }),
        });
        if (!alive || !res.ok) return;

        const data = await res.json() as { kicked?: boolean; session_id?: string };
        // Note: do NOT dispatch session-kicked here. `kicked: true` means
        // this device just evicted an older one — THIS device should
        // continue normally. The evicted device finds out via the
        // Realtime DELETE handler below and signs itself out there.
        if (data.kicked) {
          console.log('[useAuth] register: this device evicted an older session');
        }

        // Subscribe to Realtime DELETE on THIS device's session row. When
        // a sibling /register evicts us, we sign out immediately.
        if (data.session_id && alive) {
          console.log('[session-kick] subscribing for session_id=', data.session_id);
          kickChannel = sb
            .channel(`session-kick:${user.id}:${data.session_id}`)
            .on(
              'postgres_changes',
              {
                event:  'DELETE',
                schema: 'public',
                table:  'user_sessions',
                filter: `id=eq.${data.session_id}`,
              },
              async (payload) => {
                // Defense-in-depth: Supabase Realtime postgres_changes
                // filter on DELETE has historically been unreliable
                // (events for other rows in the same table can leak
                // through if REPLICA IDENTITY isn't FULL). Verify the
                // payload's old.id matches OUR session_id before kicking
                // ourselves out — otherwise the new device that just
                // evicted us would also receive its sibling's DELETE
                // event and sign itself out too.
                const deletedId = (payload as { old?: { id?: string } }).old?.id;
                if (deletedId && deletedId !== data.session_id) {
                  console.log('[session-kick] DELETE for OTHER session', deletedId, '— ignoring');
                  return;
                }

                console.log('[session-kick] DELETE event received (OUR session)', payload);
                if (typeof window !== 'undefined') {
                  window.dispatchEvent(new CustomEvent('session-kicked'));
                }
                // Brief delay so the toast paints before the page reloads.
                await new Promise((r) => setTimeout(r, 300));
                console.log('[session-kick] calling signOut...');
                const { error } = await sb.auth.signOut();
                console.log('[session-kick] signOut result', { error });
              },
            )
            .subscribe((status, err) => {
              console.log('[session-kick] channel subscribe status=', status, 'err=', err);
            });
        }

        // Anomaly check — fire-and-forget, never block.
        fetch('/api/session/check-anomaly', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body:    JSON.stringify({
            device_id:  deviceId,
            timezone:   Intl.DateTimeFormat().resolvedOptions().timeZone,
            user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
          }),
        }).catch(() => { /* silent */ });
      } catch (e) {
        console.warn('[useAuth] session register/anomaly failed:', e);
      }
    })();

    return () => {
      alive = false;
      if (kickChannel) sb.removeChannel(kickChannel);
    };
    // user.id (not user) — see profile-channel useEffect above for why.
    // Token refresh would otherwise tear down the kick channel and the
    // lastRegisteredUidRef guard would then block re-subscription.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, user?.id]);

  // Reset the once-per-uid guard when the user signs out.
  useEffect(() => {
    if (!user) lastRegisteredUidRef.current = null;
  }, [user]);

  return { user, profile, ready, refetchProfile };
}

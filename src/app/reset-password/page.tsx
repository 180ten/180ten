"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { sb } from "@/lib/supabase";
import { BANNED_PW } from "@/lib/constants";

type Phase = "loading" | "ready" | "expired" | "done";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [pw, setPw]     = useState("");
  const [pw2, setPw2]   = useState("");
  const [busy, setBusy] = useState(false);
  const [okMsg, setOk]  = useState("");
  const [errMsg, setErr] = useState("");
  const [phase, setPhase] = useState<Phase>("loading");

  // ── 1) On mount: explicitly extract recovery tokens from URL hash and
  //    call setSession() so we can be SURE the recovery session is active
  //    before letting the user submit a new password.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      console.log("[reset-password] mount — checking recovery session");

      // Parse #access_token / #refresh_token from URL hash.
      // Supabase recovery links arrive as `…/reset-password#access_token=…&refresh_token=…&type=recovery`
      const hash = typeof window !== "undefined" ? window.location.hash : "";
      const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
      const accessToken  = params.get("access_token");
      const refreshToken = params.get("refresh_token");
      const type         = params.get("type"); // expect "recovery"

      console.log("[reset-password] hash params:", {
        hasAccess:  !!accessToken,
        hasRefresh: !!refreshToken,
        type,
      });

      // Case A: tokens present in hash — install them as the active session
      if (accessToken && refreshToken) {
        const { data, error } = await sb.auth.setSession({
          access_token:  accessToken,
          refresh_token: refreshToken,
        });
        console.log("[reset-password] setSession result:", { error, hasSession: !!data.session });
        if (cancelled) return;
        if (error || !data.session) {
          setPhase("expired");
          return;
        }
        // Wipe hash from URL so a back/forward doesn't replay tokens
        try { history.replaceState(null, "", window.location.pathname); } catch { /* ignore */ }
        setPhase("ready");
        return;
      }

      // Case B: no hash — maybe Supabase JS auto-detected on a previous mount,
      // or user is already in recovery mode. Check current session.
      const { data: { session } } = await sb.auth.getSession();
      console.log("[reset-password] fallback getSession:", { hasSession: !!session });
      if (cancelled) return;
      setPhase(session ? "ready" : "expired");
    })();

    return () => { cancelled = true; };
  }, []);

  // ── 2) Submit new password ──
  async function submit() {
    setOk(""); setErr("");
    if (pw.length < 8)              { setErr("Mật khẩu phải có ít nhất 8 ký tự."); return; }
    if (BANNED_PW.includes(pw))     { setErr("Mật khẩu này quá phổ biến / không an toàn."); return; }
    if (pw !== pw2)                 { setErr("Hai mật khẩu nhập không khớp."); return; }

    // Re-verify session is still alive before doing anything destructive
    const { data: { session } } = await sb.auth.getSession();
    if (!session) {
      setErr("Phiên đặt lại đã hết hạn. Vui lòng yêu cầu link mới.");
      setPhase("expired");
      return;
    }

    setBusy(true);
    const { data, error } = await sb.auth.updateUser({ password: pw });
    console.log("[reset-password] updateUser result:", { error, user: data?.user?.id });
    setBusy(false);

    if (error) {
      setErr(error.message || "Không đặt lại được mật khẩu. Link có thể đã hết hạn.");
      return;
    }

    // Global sign-out — revokes the user's refresh tokens on EVERY device.
    // Critical after a password change: any other browser/phone still holding
    // an old session token would otherwise stay logged in until token expiry
    // (~1h) and could continue acting as the user. Global scope kills them
    // server-side immediately. User must log in again everywhere with the
    // new password.
    await sb.auth.signOut({ scope: "global" })
      .catch((e) => console.warn("[reset-password] signOut(global) warn:", e));

    setPhase("done");
    setOk("✅ Đặt lại mật khẩu thành công! Đang chuyển sang trang đăng nhập...");
    setTimeout(() => router.replace("/login"), 3000);
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, background: "var(--bg)" }}>
      <div style={{ width: "100%", maxWidth: 420, background: "var(--white)", border: "1px solid var(--border)", borderRadius: 16, padding: "32px 28px", boxShadow: "0 12px 40px rgba(0,0,0,.08)" }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 6 }}>Đặt lại mật khẩu</div>
          <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>Chọn mật khẩu mới cho tài khoản của bạn.</div>
        </div>

        {phase === "loading" && (
          <div style={{ textAlign: "center", padding: 24, color: "var(--muted)" }}>
            <span className="spinner" /> Đang xác minh link...
          </div>
        )}

        {phase === "expired" && (
          <div style={{ fontSize: 12.5, color: "#e05555", background: "#fee2e2", border: "1px solid #fecaca", padding: "10px 12px", borderRadius: 8 }}>
            Link đã hết hạn hoặc không hợp lệ. <Link href="/forgot-password" style={{ color: "var(--accent)", fontWeight: 600 }}>Yêu cầu link mới</Link>.
          </div>
        )}

        {phase === "ready" && (
          <>
            <label style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", display: "block", marginBottom: 6 }}>Mật khẩu mới</label>
            <input
              type="password" value={pw} onChange={(e) => setPw(e.target.value)}
              placeholder="Tối thiểu 8 ký tự" autoFocus
              style={{ width: "100%", padding: "11px 14px", borderRadius: 10, border: "1.5px solid var(--border)", fontSize: 14, fontFamily: "Be Vietnam Pro,Noto Sans JP,sans-serif", outline: "none", boxSizing: "border-box", marginBottom: 14 }}
            />
            <label style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", display: "block", marginBottom: 6 }}>Xác nhận mật khẩu mới</label>
            <input
              type="password" value={pw2} onChange={(e) => setPw2(e.target.value)}
              placeholder="Nhập lại mật khẩu"
              onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
              style={{ width: "100%", padding: "11px 14px", borderRadius: 10, border: "1.5px solid var(--border)", fontSize: 14, fontFamily: "Be Vietnam Pro,Noto Sans JP,sans-serif", outline: "none", boxSizing: "border-box", marginBottom: 14 }}
            />

            {errMsg && <div style={{ fontSize: 12.5, color: "#e05555", background: "#fee2e2", border: "1px solid #fecaca", padding: "10px 12px", borderRadius: 8, marginBottom: 12 }}>{errMsg}</div>}

            <button
              onClick={() => void submit()}
              disabled={busy}
              style={{ width: "100%", padding: 12, borderRadius: 10, border: "none", background: "var(--accent)", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "Be Vietnam Pro,Noto Sans JP,sans-serif", opacity: busy ? 0.6 : 1 }}
            >
              {busy ? "Đang đặt lại..." : "Đặt lại mật khẩu"}
            </button>

            <div style={{ textAlign: "center", marginTop: 18, fontSize: 13 }}>
              <Link href="/login" style={{ color: "var(--accent)", textDecoration: "none", fontWeight: 500 }}>← Quay lại đăng nhập</Link>
            </div>
          </>
        )}

        {phase === "done" && (
          <div style={{ fontSize: 13.5, color: "#147a3a", background: "#dcfce7", border: "1px solid #bbf7d0", padding: 14, borderRadius: 10, lineHeight: 1.6 }}>
            {okMsg}
          </div>
        )}
      </div>
    </div>
  );
}

"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { sb } from "@/lib/supabase";

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "1x00000000000000000000AA";

export default function ForgotPasswordPage() {
  const [email, setEmail]               = useState("");
  const [busy, setBusy]                 = useState(false);
  const [okMsg, setOk]                  = useState("");
  const [errMsg, setErr]                = useState("");
  const [captchaToken, setCaptchaToken] = useState("");
  const turnstileRef                    = useRef<TurnstileInstance>(null);

  function resetCaptcha() {
    setCaptchaToken("");
    turnstileRef.current?.reset();
  }

  async function submit() {
    setOk(""); setErr("");
    const trimmed = email.trim();
    if (!trimmed) { setErr("Vui lòng nhập email."); return; }
    if (!/^\S+@\S+\.\S+$/.test(trimmed)) { setErr("Email không hợp lệ."); return; }
    if (!captchaToken) { setErr("Vui lòng hoàn thành xác minh không phải robot."); return; }

    setBusy(true);
    const { error } = await sb.auth.resetPasswordForEmail(trimmed, {
      redirectTo: `${window.location.origin}/reset-password`,
      captchaToken,
    });
    setBusy(false);
    resetCaptcha(); // Turnstile token is single-use — reset for next attempt

    if (error) {
      const m = error.message || "";
      if (/rate.?limit/i.test(m)) {
        setErr("Bạn đã gửi quá nhiều email. Vui lòng đợi vài phút rồi thử lại.");
      } else if (/not.*found|invalid/i.test(m)) {
        setErr("Không tìm thấy tài khoản với email này.");
      } else if (/captcha/i.test(m)) {
        setErr("Xác minh captcha thất bại. Vui lòng thử lại.");
      } else {
        setErr(m);
      }
      return;
    }
    setOk("Email đặt lại mật khẩu đã được gửi! Vui lòng kiểm tra hộp thư (cả mục Spam).");
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, background: "var(--bg)" }}>
      <div style={{ width: "100%", maxWidth: 420, background: "var(--white)", border: "1px solid var(--border)", borderRadius: 16, padding: "32px 28px", boxShadow: "0 12px 40px rgba(0,0,0,.08)" }}>
        {okMsg ? (
          // ── Success panel — replaces the form once email sent ──
          <div style={{ textAlign: "center" }}>
            <div style={{ width: 72, height: 72, borderRadius: "50%", background: "#dcfce7", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 18px", fontSize: 36 }}>
              ✉️
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 10 }}>Đã gửi email!</div>
            <p style={{ fontSize: 13.5, color: "var(--muted)", lineHeight: 1.7, marginBottom: 6 }}>
              {okMsg}
            </p>
            <p style={{ fontSize: 12, color: "var(--muted2)", lineHeight: 1.6, marginBottom: 26 }}>
              Email đã gửi tới <b style={{ color: "var(--text)" }}>{email}</b>. Link có hiệu lực 1 giờ.
            </p>
            <Link
              href="/"
              style={{ display: "block", width: "100%", padding: 12, borderRadius: 10, border: "none", background: "var(--accent)", color: "#fff", fontSize: 14, fontWeight: 700, fontFamily: "Be Vietnam Pro,Noto Sans JP,sans-serif", textDecoration: "none", textAlign: "center", boxSizing: "border-box" }}
            >
              ← Về trang chủ
            </Link>
            <div style={{ textAlign: "center", marginTop: 14, fontSize: 13 }}>
              <Link href="/login" style={{ color: "var(--muted)", textDecoration: "none" }}>Đăng nhập</Link>
            </div>
          </div>
        ) : (
          // ── Form ──
          <>
            <div style={{ textAlign: "center", marginBottom: 24 }}>
              <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 6 }}>Quên mật khẩu?</div>
              <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
                Nhập email đăng ký, chúng tôi sẽ gửi link đặt lại mật khẩu cho bạn.
              </div>
            </div>

            <label style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", display: "block", marginBottom: 6 }}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ten@email.com"
              onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
              autoFocus
              style={{ width: "100%", padding: "11px 14px", borderRadius: 10, border: "1.5px solid var(--border)", fontSize: 14, fontFamily: "Be Vietnam Pro,Noto Sans JP,sans-serif", outline: "none", boxSizing: "border-box", marginBottom: 14 }}
            />

            <div style={{ width: "100%", marginBottom: 14 }}>
              <Turnstile
                ref={turnstileRef}
                siteKey={TURNSTILE_SITE_KEY}
                options={{ theme: "light", size: "flexible" }}
                onSuccess={(token) => setCaptchaToken(token)}
                onError={() => setCaptchaToken("")}
                onExpire={() => setCaptchaToken("")}
                style={{ width: "100%" }}
              />
            </div>

            {errMsg && <div style={{ fontSize: 12.5, color: "#e05555", background: "#fee2e2", border: "1px solid #fecaca", padding: "10px 12px", borderRadius: 8, marginBottom: 12 }}>{errMsg}</div>}

            <button
              onClick={() => void submit()}
              disabled={busy || !captchaToken}
              style={{ width: "100%", padding: 12, borderRadius: 10, border: "none", background: "var(--accent)", color: "#fff", fontSize: 14, fontWeight: 700, cursor: (busy || !captchaToken) ? "not-allowed" : "pointer", fontFamily: "Be Vietnam Pro,Noto Sans JP,sans-serif", opacity: (busy || !captchaToken) ? 0.6 : 1 }}
            >
              {!captchaToken ? "⏳ Đang xác minh..." : busy ? "Đang gửi..." : "Gửi email đặt lại mật khẩu"}
            </button>

            <div style={{ textAlign: "center", marginTop: 18, fontSize: 13 }}>
              <Link href="/login" style={{ color: "var(--accent)", textDecoration: "none", fontWeight: 500 }}>← Quay lại đăng nhập</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

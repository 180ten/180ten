"use client";
import { useRef, useState } from "react";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { sb } from "@/lib/supabase";
import { isAdminEmail } from "@/lib/constants";

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "1x00000000000000000000AA";

interface AdminGateProps {
  onSuccess: (user: { id: string; email?: string; user_metadata?: Record<string, unknown> }) => void;
}

export default function AdminGate({ onSuccess }: AdminGateProps) {
  const [email, setEmail]   = useState("");
  const [pw, setPw]         = useState("");
  const [error, setError]   = useState("");
  const [busy, setBusy]     = useState(false);
  const [captchaToken, setCaptchaToken] = useState("");
  const turnstileRef = useRef<TurnstileInstance>(null);

  function resetCaptcha() {
    setCaptchaToken("");
    turnstileRef.current?.reset();
  }

  async function doLogin() {
    setError("");
    if (!isAdminEmail(email)) {
      setError("Tài khoản này không có quyền truy cập admin.");
      return;
    }
    if (!captchaToken) {
      setError("Vui lòng hoàn thành xác minh không phải robot.");
      return;
    }
    setBusy(true);
    const { data, error: authErr } = await sb.auth.signInWithPassword({
      email,
      password: pw,
      options: { captchaToken },
    });
    setBusy(false);
    resetCaptcha();
    if (authErr || !data.user) {
      setError(authErr?.message ?? "Đăng nhập thất bại (không có user trả về).");
      return;
    }

    const { data: profile } = await sb.from("profiles").select("role").eq("id", data.user.id).single();
    if (!profile || (profile as { role?: string }).role !== "admin") {
      await sb.auth.signOut();
      setError("Tài khoản này không có quyền admin.");
      return;
    }
    onSuccess(data.user);
  }

  return (
    <div id="gate">
      <div className="gate-box">
        <div className="gate-logo">180<span>ten</span></div>
        <div className="gate-badge">ADMIN PORTAL</div>
        <label className="gate-label">Email</label>
        <input
          type="email"
          className="gate-input"
          id="g-email"
          placeholder="admin@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <label className="gate-label">Mật khẩu</label>
        <input
          type="password"
          className="gate-input"
          id="g-pw"
          placeholder="••••••••"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && doLogin()}
        />
        <div style={{ width: "100%", padding: "12px 0 4px" }}>
          <Turnstile
            ref={turnstileRef}
            siteKey={TURNSTILE_SITE_KEY}
            options={{ size: "invisible" }}
            onSuccess={(token) => setCaptchaToken(token)}
            onError={() => setCaptchaToken("")}
            onExpire={() => setCaptchaToken("")}
            style={{ width: "100%" }}
          />
        </div>
        <button
          className="gate-btn"
          id="g-btn"
          onClick={doLogin}
          disabled={busy || !captchaToken}
        >
          {!captchaToken
            ? <><span className="spinner"></span>Đang xác minh...</>
            : busy
              ? <><span className="spinner"></span>Đang đăng nhập...</>
              : "Đăng nhập →"}
        </button>
        {error && <div className="gate-err show" id="g-err">{error}</div>}
        <div className="gate-hint">Chỉ tài khoản admin mới vào được.</div>
      </div>
    </div>
  );
}

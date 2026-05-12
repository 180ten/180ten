"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { BANNED_PW, SB_STORAGE_KEY, VIET_NAMES } from "@/lib/constants";
import { sb } from "@/lib/supabase";

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "1x00000000000000000000AA"; // fallback = always-passes test key

type AuthTab = "login" | "register";
type ToastType = "" | "success" | "error";

function fakeMail(): string {
  const name = VIET_NAMES[Math.floor(Math.random() * VIET_NAMES.length)];
  return `${name}${1990 + Math.floor(Math.random() * 34)}@gmail.com`;
}

function valPw(pw: string): string | null {
  if (pw.length < 6) return "Mật khẩu phải có ít nhất 6 ký tự.";
  if (BANNED_PW.indexOf(pw) >= 0) {
    return `Mật khẩu này đã được ${fakeMail()} sử dụng, vui lòng chọn mật khẩu khác.`;
  }
  return null;
}

function warnPw(pw: string): string | null {
  if (pw.length < 8) return "⚠️ Mật khẩu ngắn, dễ bị đoán. Nên dùng ít nhất 8 ký tự.";
  if (!/[0-9]/.test(pw) && !/[^a-zA-Z]/.test(pw)) {
    return "⚠️ Nên thêm số hoặc ký tự đặc biệt để tăng bảo mật.";
  }
  return null;
}

function getPwStrength(pw: string): { width: string; background: string } {
  let s = 0;
  if (pw.length >= 6) s++;
  if (pw.length >= 8) s++;
  if (/[A-Z]/.test(pw)) s++;
  if (/[0-9]/.test(pw)) s++;
  if (pw.length >= 12) s++;
  const colors = ["#e74c3c", "#e67e22", "#f1c40f", "#2ecc71", "#27ae60"];
  return {
    width: `${s * 20}%`,
    background: colors[Math.max(0, s - 1)] ?? "var(--border)",
  };
}

export default function LoginPage() {
  const router = useRouter();

  const [tab, setTab] = useState<AuthTab>("login");
  const [showSplash, setShowSplash] = useState(true);
  const [splashHiding, setSplashHiding] = useState(false);

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPw, setLoginPw] = useState("");
  const [loginErr, setLoginErr] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginCaptchaToken, setLoginCaptchaToken] = useState("");
  const loginTurnstileRef = useRef<TurnstileInstance>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [captchaToken, setCaptchaToken] = useState("");
  const turnstileRef = useRef<TurnstileInstance>(null);
  const [pwErr, setPwErr] = useState("");
  const [pw2Err, setPw2Err] = useState("");
  const [capErr, setCapErr] = useState("");
  const [regErr, setRegErr] = useState("");
  const [regBusy, setRegBusy] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState("");

  const [toastMsg, setToastMsg] = useState("");
  const [toastType, setToastType] = useState<ToastType>("");
  const [toastVisible, setToastVisible] = useState(false);

  const pwStrength = useMemo(() => getPwStrength(pw), [pw]);

  const hideSplash = useCallback(() => {
    setSplashHiding(true);
    window.setTimeout(() => setShowSplash(false), 400);
  }, []);

  const resetCaptcha = useCallback(() => {
    setCaptchaToken("");
    turnstileRef.current?.reset();
  }, []);

  const showToast = useCallback((msg: string, type: ToastType) => {
    setToastMsg(msg);
    setToastType(type);
    setToastVisible(true);
    window.setTimeout(() => setToastVisible(false), 3200);
  }, []);

  useEffect(() => {
    let mounted = true;

    const boot = async () => {
      try {
        const raw = localStorage.getItem(SB_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          const ses = parsed && (parsed.access_token ? parsed : (parsed.currentSession || null));
          if (ses && ses.expires_at && ses.expires_at * 1000 < Date.now()) {
            localStorage.removeItem(SB_STORAGE_KEY);
          } else if (ses && ses.access_token) {
            router.replace("/");
            return;
          }
        }
      } catch {}

      const hasToken =
        window.location.hash.includes("access_token") ||
        window.location.search.includes("code=");

      if (hasToken) {
        const {
          data: { subscription },
        } = sb.auth.onAuthStateChange((_evt, ses) => {
          if (ses && ses.user) router.replace("/");
        });

        try {
          const { data } = await sb.auth.getSession();
          if (data.session?.user) {
            router.replace("/");
            subscription.unsubscribe();
            return;
          }
        } finally {
          subscription.unsubscribe();
        }
      }

      if (!mounted) return;
      hideSplash();
    };

    void boot();
    return () => {
      mounted = false;
    };
  }, [hideSplash, router]);

  const doLogin = useCallback(async () => {
    setLoginErr("");
    if (!loginEmail.trim() || !loginPw) {
      setLoginErr("Vui lòng điền đầy đủ.");
      return;
    }
    if (!loginCaptchaToken) {
      setLoginErr("Vui lòng hoàn thành xác minh không phải robot.");
      return;
    }

    setLoginBusy(true);
    const r = await sb.auth.signInWithPassword({
      email: loginEmail.trim(),
      password: loginPw,
      options: { captchaToken: loginCaptchaToken },
    });
    setLoginBusy(false);
    setLoginCaptchaToken("");
    loginTurnstileRef.current?.reset();

    if (r.error) {
      setLoginErr(r.error.message || "Đăng nhập thất bại.");
      return;
    }
    router.replace("/");
  }, [loginEmail, loginPw, loginCaptchaToken, router]);

  const doGoogleLogin = useCallback(async () => {
    const r = await sb.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/` },
    });
    if (r.error) showToast(`Lỗi đăng nhập Google: ${r.error.message}`, "error");
  }, [showToast]);

  const doRegister = useCallback(async () => {
    setPwErr("");
    setPw2Err("");
    setCapErr("");
    setRegErr("");

    if (!name.trim() || !email.trim()) {
      setRegErr("Vui lòng điền đầy đủ thông tin.");
      return;
    }

    const passwordError = valPw(pw);
    if (passwordError) {
      setPwErr(passwordError);
      return;
    }

    const passwordWarn = warnPw(pw);
    if (passwordWarn) setPwErr(passwordWarn);

    if (pw !== pw2) {
      setPw2Err("Mật khẩu nhập lại không khớp.");
      return;
    }

    if (!captchaToken) {
      setCapErr("Vui lòng hoàn thành xác minh không phải robot.");
      return;
    }

    setRegBusy(true);
    const r = await sb.auth.signUp({
      email: email.trim(),
      password: pw,
      options: { data: { full_name: name.trim() }, captchaToken },
    });
    setRegBusy(false);
    // Token Turnstile chỉ dùng được 1 lần — reset sau mỗi lần submit dù thành công hay lỗi
    resetCaptcha();

    if (r.error) {
      const msg = r.error.message || "";
      if (
        msg.toLowerCase().includes("already registered") ||
        msg.toLowerCase().includes("already been registered") ||
        msg.toLowerCase().includes("user already exists")
      ) {
        setRegErr("⚠️ Email này đã được đăng ký. Vui lòng đăng nhập hoặc dùng email khác.");
      } else if (msg.toLowerCase().includes("captcha")) {
        setRegErr("⚠️ Xác minh captcha thất bại. Vui lòng thử lại.");
      } else {
        setRegErr(msg);
      }
      return;
    }

    if (r.data?.user && r.data.user.identities && r.data.user.identities.length === 0) {
      setRegErr("⚠️ Email này đã được đăng ký. Vui lòng đăng nhập hoặc dùng email khác.");
      return;
    }

    setConfirmEmail(email.trim());
    setModalOpen(true);
  }, [captchaToken, email, name, pw, pw2, resetCaptcha]);

  return (
    <>
      {showSplash ? (
        <div id="splash" className={splashHiding ? "hide" : ""}>
          <div>
            <div className="splash-logo">
              180<span>ten</span>
            </div>
            <div className="splash-bar">
              <div className="splash-fill" />
            </div>
          </div>
        </div>
      ) : null}

      <div className="auth-wrap">
        <div className="auth-left">
          <div className="auth-logo">
            180<span>ten</span>
          </div>
          <div className="auth-tagline">
            Luyện thi JLPT
            <br />
            thông minh hơn.
          </div>
          <div className="auth-sub">
            Hệ thống đề thi mô phỏng JLPT chuẩn định dạng, giải thích chi tiết từng câu,
            theo dõi tiến độ mỗi ngày.
          </div>
          <div style={{ marginTop: "auto", display: "flex", gap: 8, alignItems: "flex-start" }}>
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "var(--accent)",
                flexShrink: 0,
                marginTop: 5,
              }}
            />
            <div style={{ fontSize: 14, opacity: 0.6, fontStyle: "italic", lineHeight: 1.7 }}>
              &ldquo;Nhờ 180ten mà mình pass N2 lần đầu tiên!&rdquo;
              <br />
              <span style={{ opacity: 0.5, fontSize: 12, fontStyle: "normal" }}>
                — Nguyễn Phương Anh, N2 pass 2024
              </span>
            </div>
          </div>
        </div>

        <div className="auth-right">
          <div className="auth-form-wrap">
            <div style={{ marginBottom: 28 }}>
              <div style={{ fontSize: 24, fontWeight: 800, marginBottom: 4 }}>Chào mừng 👋</div>
              <div style={{ color: "var(--muted)", fontSize: 14 }}>
                Bắt đầu hành trình JLPT của bạn
              </div>
            </div>

            <div className="auth-tabs">
              <button
                className={`auth-tab ${tab === "login" ? "active" : ""}`}
                id="tab-login"
                onClick={() => setTab("login")}
              >
                Đăng nhập
              </button>
              <button
                className={`auth-tab ${tab === "register" ? "active" : ""}`}
                id="tab-register"
                onClick={() => setTab("register")}
              >
                Đăng ký
              </button>
            </div>

            <div id="form-login" style={{ display: tab === "login" ? "" : "none" }}>
              <div className="form-group">
                <label>Email</label>
                <input
                  type="email"
                  className="form-input"
                  id="li-email"
                  placeholder="ten@email.com"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Mật khẩu</label>
                <input
                  type="password"
                  className="form-input"
                  id="li-pw"
                  placeholder="••••••••"
                  value={loginPw}
                  onChange={(e) => setLoginPw(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void doLogin();
                  }}
                />
              </div>
              <div className="form-group">
                <label>Xác nhận không phải robot</label>
                <div style={{ width: "100%", padding: "4px 0" }}>
                  <Turnstile
                    ref={loginTurnstileRef}
                    siteKey={TURNSTILE_SITE_KEY}
                    options={{ size: "invisible" }}
                    onSuccess={(token) => setLoginCaptchaToken(token)}
                    onError={() => setLoginCaptchaToken("")}
                    onExpire={() => setLoginCaptchaToken("")}
                    style={{ width: "100%" }}
                  />
                </div>
              </div>
              <div className={`form-error ${loginErr ? "show" : ""}`} id="li-err">
                {loginErr}
              </div>
              <button className="btn-submit" id="li-btn" onClick={() => void doLogin()} disabled={loginBusy || !loginCaptchaToken}>
                {!loginCaptchaToken ? (
                  <>
                    <span className="spinner" />
                    Đang xác minh...
                  </>
                ) : loginBusy ? (
                  <>
                    <span className="spinner" />
                    Đang xử lý...
                  </>
                ) : (
                  "Đăng nhập"
                )}
              </button>
              <div style={{ textAlign: "center", marginTop: 12 }}>
                <button
                  type="button"
                  onClick={() => router.push("/forgot-password")}
                  style={{
                    background: "none", border: "none", padding: 0,
                    color: "var(--accent)", fontSize: 13, fontWeight: 500,
                    cursor: "pointer", fontFamily: "Be Vietnam Pro,Noto Sans JP,sans-serif",
                  }}
                >
                  Quên mật khẩu?
                </button>
              </div>
              <div className="divider">hoặc</div>
              <button className="btn-google" onClick={() => void doGoogleLogin()}>
                <svg width="20" height="20" viewBox="0 0 48 48">
                  <path
                    fill="#EA4335"
                    d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                  />
                  <path
                    fill="#4285F4"
                    d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                  />
                  <path
                    fill="#34A853"
                    d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                  />
                </svg>
                Đăng nhập với Google
              </button>
            </div>

            <div id="form-register" style={{ display: tab === "register" ? "" : "none" }}>
              <div className="form-group">
                <label>Tên tài khoản</label>
                <input
                  type="text"
                  className="form-input"
                  id="rg-name"
                  placeholder="Nguyễn Văn A"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Email</label>
                <input
                  type="email"
                  className="form-input"
                  id="rg-email"
                  placeholder="ten@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Mật khẩu</label>
                <input
                  type="password"
                  className="form-input"
                  id="rg-pw"
                  placeholder="Tối thiểu 6 ký tự"
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                />
                <div className="pw-strength">
                  <div
                    className="pw-strength-fill"
                    id="pw-bar"
                    style={{ width: pwStrength.width, background: pwStrength.background }}
                  />
                </div>
                <div className="pw-hint">
                  Tối thiểu 6 ký tự.
                </div>
                <div className={`form-error ${pwErr ? "show" : ""}`} id="rg-pw-err">
                  {pwErr}
                </div>
              </div>
              <div className="form-group">
                <label>Nhập lại mật khẩu</label>
                <input
                  type="password"
                  className="form-input"
                  id="rg-pw2"
                  placeholder="••••••••"
                  value={pw2}
                  onChange={(e) => setPw2(e.target.value)}
                />
                <div className={`form-error ${pw2Err ? "show" : ""}`} id="rg-pw2-err">
                  {pw2Err}
                </div>
              </div>
              <div className="form-group">
                <label>Xác nhận không phải robot</label>
                <div style={{ width: "100%", padding: "4px 0" }}>
                  <Turnstile
                    ref={turnstileRef}
                    siteKey={TURNSTILE_SITE_KEY}
                    options={{ size: "invisible" }}
                    onSuccess={(token) => { setCaptchaToken(token); setCapErr(""); }}
                    onError={() => { setCaptchaToken(""); setCapErr("Lỗi tải Turnstile, vui lòng thử lại."); }}
                    onExpire={() => { setCaptchaToken(""); }}
                    style={{ width: "100%" }}
                  />
                </div>
                <div className={`form-error ${capErr ? "show" : ""}`} id="rg-cap-err">
                  {capErr}
                </div>
              </div>
              <div className={`form-error ${regErr ? "show" : ""}`} id="rg-err">
                {regErr}
              </div>
              <button className="btn-submit" id="rg-btn" onClick={() => void doRegister()} disabled={regBusy || !captchaToken}>
                {!captchaToken ? (
                  <>
                    <span className="spinner" />
                    Đang xác minh...
                  </>
                ) : regBusy ? (
                  <>
                    <span className="spinner" />
                    Đang xử lý...
                  </>
                ) : (
                  "Tạo tài khoản"
                )}
              </button>
              <div className="divider">hoặc</div>
              <button className="btn-google" onClick={() => void doGoogleLogin()}>
                <svg width="20" height="20" viewBox="0 0 48 48">
                  <path
                    fill="#EA4335"
                    d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                  />
                  <path
                    fill="#4285F4"
                    d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                  />
                  <path
                    fill="#34A853"
                    d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                  />
                </svg>
                Đăng ký với Google
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className={`modal-overlay ${modalOpen ? "active" : ""}`} id="modal" onClick={() => setModalOpen(false)}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <h3 id="m-title">📧 Xác nhận email</h3>
          <p id="m-body">
            Chúng tôi đã gửi email xác nhận đến <strong>{confirmEmail}</strong>. Vui lòng
            kiểm tra hộp thư và nhấn link để kích hoạt tài khoản.
          </p>
          <div className="modal-btns">
            <button
              onClick={() => setModalOpen(false)}
              style={{
                border: "1.5px solid var(--border)",
                background: "transparent",
                color: "var(--text)",
              }}
            >
              Đóng
            </button>
            <button
              id="m-ok"
              style={{ background: "var(--accent)", color: "#fff", border: "none" }}
              onClick={() => setModalOpen(false)}
            >
              OK
            </button>
          </div>
        </div>
      </div>

      <div className={`toast${toastType ? ` ${toastType}` : ""}${toastVisible ? " show" : ""}`} id="toast">
        {toastMsg}
      </div>
    </>
  );
}

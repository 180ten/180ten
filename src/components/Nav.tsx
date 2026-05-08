"use client";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { sb, SB_STORAGE_KEY } from "@/lib/supabase";
import { clearLocalExamData } from "@/hooks/useDashboard";

export type TabId = "home" | "dashboard" | "mocktest" | "anki" | "chinhta";

interface Profile {
  name?: string;
  plan?: string;
}

interface NavProps {
  user: { email?: string } | null;
  profile: Profile | null;
  authReady: boolean;
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  onOpenPremium: () => void;
  onOpenSettings: () => void;
}

export default function Nav({ user, profile, authReady, activeTab, onTabChange, onOpenPremium, onOpenSettings }: NavProps) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLButtonElement>(null);
  const [pillRect, setPillRect] = useState<{ top: number; right: number } | null>(null);

  useEffect(() => {
    if (!menuOpen || !pillRef.current) { setPillRect(null); return; }
    function update() {
      if (!pillRef.current) return;
      const r = pillRef.current.getBoundingClientRect();
      setPillRect({ top: r.bottom + 6, right: window.innerWidth - r.right });
    }
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [menuOpen]);

  // Close menu on outside click + ESC + tab switch
  useEffect(() => {
    if (!menuOpen) return;
    function onDoc(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setMenuOpen(false); }
    function onHide() { if (document.visibilityState !== "visible") setMenuOpen(false); }
    function onBlur() { setMenuOpen(false); }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("blur", onBlur);
    };
  }, [menuOpen]);

  async function doLogout() {
    setMenuOpen(false);
    clearLocalExamData();
    try { localStorage.removeItem(SB_STORAGE_KEY); } catch { /* ignore */ }
    await sb.auth.signOut().catch(() => {});
    router.replace("/login");
  }

  function goDashboard() { setMenuOpen(false); onTabChange("dashboard"); }
  function goSettings()  { setMenuOpen(false); onOpenSettings(); }

  const plan = (profile?.plan || "free").toLowerCase();
  const name = profile?.name || (user?.email?.split("@")[0] ?? "");
  const init = (name || "U")[0].toUpperCase();

  let pillClass = "avatar-pill";
  let crownSrc = "";
  if (plan === "1year" || plan === "premium") { pillClass += " plan-1year"; crownSrc = "/svg/plan-1year.svg"; }
  else if (plan === "3month") { pillClass += " plan-1year"; crownSrc = "/svg/plan-1year.svg"; }
  else if (plan === "lifetime") { pillClass += " plan-lifetime"; crownSrc = "/svg/plan-lifetime.svg"; }

  // Tabs WITHOUT dashboard (it's now in the dropdown)
  const tabs: { id: TabId; label: string }[] = [
    { id: "home",     label: "Trang chủ" },
    { id: "mocktest", label: "Mogi" },
    { id: "anki",     label: "Anki" },
    { id: "chinhta",  label: "Kakitori" },
  ];

  return (
    <nav>
      <div className="nav-logo" suppressHydrationWarning>
        <span className="brand-wordmark" suppressHydrationWarning>
          <span className="brand-180" suppressHydrationWarning>180</span>
          <span className="brand-ten" suppressHydrationWarning>ten</span>
        </span>
      </div>
      <div className="nav-tabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={`nav-tab${activeTab === t.id ? " active" : ""}`}
            onClick={() => onTabChange(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="nav-right" id="nav-right">
        {!authReady ? (
          <div className="nav-auth-skel" aria-hidden>
            <div className="nav-auth-skel-pill" />
          </div>
        ) : user ? (
          <>
            {plan === "free" && (
              <button className="btn-premium" onClick={onOpenPremium}>⭐ Nâng cấp Premium</button>
            )}
            <div ref={menuRef} style={{ position: "relative" }}>
              <button
                ref={pillRef}
                type="button"
                className={pillClass}
                onClick={() => setMenuOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                style={{ cursor: "pointer", border: "none" }}
              >
                {crownSrc && <span className="crown"><Image src={crownSrc} alt="" aria-hidden width={16} height={16} /></span>}
                <div className="av">{init}</div>
                <span>{name}</span>
                <span style={{ marginLeft: 4, fontSize: 10, color: "var(--muted)", transition: "transform .15s", transform: menuOpen ? "rotate(180deg)" : "none" }}>▼</span>
              </button>

              {menuOpen && pillRect && typeof document !== "undefined" && createPortal(
                <>
                  <div
                    onClick={() => setMenuOpen(false)}
                    style={{ position: "fixed", inset: 0, background: "transparent", zIndex: 9998 }}
                    aria-hidden
                  />
                  <div
                    ref={menuRef}
                    role="menu"
                    style={{
                      position: "fixed",
                      top: pillRect.top,
                      right: pillRect.right,
                      minWidth: 180,
                      background: "var(--white)",
                      border: "1px solid var(--border)",
                      borderRadius: 12,
                      boxShadow: "0 8px 28px rgba(0,0,0,.12)",
                      padding: 6,
                      zIndex: 9999,
                    }}
                  >
                    <MenuItem iconSrc="/svg/menu-dashboard.svg" label="Dashboard" onClick={goDashboard} />
                    <MenuItem iconSrc="/svg/menu-settings.svg"  label="Cài đặt"   onClick={goSettings} />
                    <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />
                    <MenuItem iconSrc="/svg/menu-logout.svg"    label="Đăng xuất" onClick={doLogout} danger />
                  </div>
                </>,
                document.body
              )}
            </div>
          </>
        ) : (
          <button className="btn-accent nav-login-btn" onClick={() => router.push("/login")}>
            <Image className="auth-btn-icon" src="/svg/icon-login.svg" alt="" aria-hidden width={18} height={18} />
            Đăng nhập
          </button>
        )}
      </div>
    </nav>
  );
}

function MenuItem({ iconSrc, label, onClick, danger }: { iconSrc: string; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      onMouseDown={(e) => e.preventDefault()}
      style={{
        display: "flex", alignItems: "center", gap: 10,
        width: "100%", padding: "9px 12px",
        background: "transparent", border: "none",
        fontFamily: "Be Vietnam Pro,Noto Sans JP,sans-serif", fontSize: 13, fontWeight: 600,
        color: danger ? "#c2410c" : "var(--text)",
        cursor: "pointer", borderRadius: 8, textAlign: "left",
      }}
      onMouseOver={(e) => { e.currentTarget.style.background = "var(--surface)"; }}
      onMouseOut={(e) => { e.currentTarget.style.background = "transparent"; }}
    >
      <Image src={iconSrc} alt="" aria-hidden width={16} height={16} style={{ flexShrink: 0 }} />
      {label}
    </button>
  );
}

"use client";
import { useState, useEffect } from "react";
import { sb } from "@/lib/supabase";
import { isAdminEmail } from "@/lib/constants";

import AdminGate from "./components/AdminGate";
import AdminSidebar, { type AdminTabId } from "./components/AdminSidebar";
import StudentsTab  from "./tabs/StudentsTab";
import PaymentsTab  from "./tabs/PaymentsTab";
import ExamsTab     from "./tabs/ExamsTab";
import ComposeTab   from "./tabs/ComposeTab";
import VocabTab     from "./tabs/VocabTab";
import GrammarTab   from "./tabs/GrammarTab";
import AnkiAdminTab from "./tabs/AnkiAdminTab";
import SecurityTab  from "./tabs/SecurityTab";
import { adminGet } from "@/lib/adminApi";

interface AdminUser {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
}

export default function AdminPage() {
  const [adminUser, setAdminUser]   = useState<AdminUser | null>(null);
  const [checking, setChecking]     = useState(true);
  const [activeTab, setActiveTab]   = useState<AdminTabId>("students");
  const [pendingPay, setPendingPay] = useState(0);
  const [securityCount, setSecurityCount] = useState(0);
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    if (typeof window === "undefined") return "dark";
    try {
      const saved = localStorage.getItem("jlpt-admin-theme");
      if (saved === "light" || saved === "dark") return saved;
    } catch { /* ignore */ }
    return "dark";
  });
  const [toastMsg, setToastMsg]   = useState("");
  const [toastType, setToastType] = useState("default");

  function adminShowToast(msg: string, type = "default") {
    setToastMsg(msg); setToastType(type);
    setTimeout(() => setToastMsg(""), 3500);
  }

  // Sidebar badge: number of users with anomaly_events in the last 7 days.
  // Polls every 60s; fails silent (badge stays at last value or 0).
  useEffect(() => {
    if (!adminUser) return;
    let cancelled = false;
    async function fetchCount() {
      try {
        const data = await adminGet<{ count?: number }>("/api/admin/security?count=true");
        if (!cancelled) setSecurityCount(data.count ?? 0);
      } catch { /* silent — keep prior badge */ }
    }
    void fetchCount();
    const id = setInterval(fetchCount, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [adminUser]);

  // Try to restore existing admin session on mount
  useEffect(() => {
    (async () => {
      const { data: { session } } = await sb.auth.getSession();
      if (session?.user && isAdminEmail(session.user.email)) {
        const { data: profile } = await sb
          .from("profiles")
          .select("role")
          .eq("id", session.user.id)
          .single();
        if (profile && (profile as { role?: string }).role === "admin") {
          setAdminUser(session.user as AdminUser);
          setChecking(false);
          return;
        }
        await sb.auth.signOut();
      }
      setChecking(false);
    })();
  }, []);

  function handleToggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try { localStorage.setItem("jlpt-admin-theme", next); } catch {}
  }

  async function handleLogout() {
    await sb.auth.signOut();
    setAdminUser(null);
  }

  function handleTabChange(tab: AdminTabId) {
    setActiveTab(tab);
  }

  if (checking) {
    return (
      <div id="gate">
        <div className="gate-box" style={{ textAlign: "center" }}>
          <div className="gate-logo">jlpt<span>bro</span></div>
          <div style={{ marginTop: 20, color: "#555", fontSize: 13 }}>
            <span className="spinner"></span> Đang kiểm tra phiên...
          </div>
        </div>
      </div>
    );
  }

  if (!adminUser) {
    return <AdminGate onSuccess={(u) => setAdminUser(u as AdminUser)} />;
  }

  return (
    <div id="admin-app" className={theme === "light" ? "theme-light" : ""} style={{ display: "flex" }}>
      {toastMsg && (
        <div id="toast" className={`toast ${toastType} show`} style={{ position: "fixed", bottom: 28, right: 28, zIndex: 9999, padding: "12px 22px", borderRadius: 10, fontSize: 13, fontWeight: 600, background: toastType==="success"?"#2DB87A":toastType==="error"?"#E05555":"#222", color: "#fff", boxShadow: "0 4px 20px rgba(0,0,0,.5)", pointerEvents: "none" }}>{toastMsg}</div>
      )}
      <AdminSidebar
        adminUser={adminUser}
        activeTab={activeTab}
        pendingPayments={pendingPay}
        securityCount={securityCount}
        theme={theme}
        onToggleTheme={handleToggleTheme}
        onTabChange={handleTabChange}
        onLogout={handleLogout}
      />
      <div className="content">
        {activeTab === "students" && <StudentsTab />}
        {activeTab === "payments" && <PaymentsTab onPendingChange={setPendingPay} adminEmail={adminUser.email} />}
        {activeTab === "security" && <SecurityTab />}
        {activeTab === "exams"    && <ExamsTab onComposeNew={() => setActiveTab("compose")} />}
        {activeTab === "compose"  && <ComposeTab showToast={adminShowToast} />}
        {activeTab === "vocab"    && <VocabTab />}
        {activeTab === "grammar"  && <GrammarTab />}
        {activeTab === "anki"     && <AnkiAdminTab />}
      </div>
    </div>
  );
}

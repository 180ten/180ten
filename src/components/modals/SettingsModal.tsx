"use client";
import { useEffect, useState } from "react";
import { sb } from "@/lib/supabase";

export type DictLang = "jp-vi" | "jp-jp";

const DICT_LANG_KEY = "dict-lang";
export const DEFAULT_DICT_LANG: DictLang = "jp-vi";
export const DICT_LANG_EVENT = "dict-lang-change";

interface DictLangOption {
  id: DictLang;
  label: string;
  sub: string;
}

const DICT_LANG_OPTIONS: DictLangOption[] = [
  { id: "jp-vi", label: "Nhật – Việt", sub: "Giải nghĩa bằng tiếng Việt + Hán Việt" },
  { id: "jp-jp", label: "Nhật – Nhật", sub: "Giải nghĩa bằng tiếng Nhật"             },
];

const PLAN_LABEL: Record<string, string> = {
  free:     "Trải nghiệm (Miễn phí)",
  "3month": "3 Tháng",
  "1year":  "1 Năm",
  premium:  "1 Năm",
  lifetime: "Trọn đời",
};

const PLAN_BADGE: Record<string, { bg: string; fg: string; border: string }> = {
  free:     { bg: "#f1f5f9", fg: "#475569", border: "#cbd5e1" },
  "3month": { bg: "#fef3cd", fg: "#a16207", border: "#facc15" },
  "1year":  { bg: "#fee2e2", fg: "#b91c1c", border: "#fca5a5" },
  premium:  { bg: "#fee2e2", fg: "#b91c1c", border: "#fca5a5" },
  lifetime: { bg: "#dbeafe", fg: "#1d4ed8", border: "#93c5fd" },
};

export function loadDictLang(): DictLang {
  if (typeof window === "undefined") return DEFAULT_DICT_LANG;
  try {
    const v = localStorage.getItem(DICT_LANG_KEY);
    if (v === "jp-vi" || v === "jp-jp") return v;
  } catch { /* ignore */ }
  return DEFAULT_DICT_LANG;
}

/** Subscribe to dict-lang changes (localStorage + same-tab custom event). */
export function useDictLang(): DictLang {
  const [lang, setLang] = useState<DictLang>(DEFAULT_DICT_LANG);
  useEffect(() => {
    setLang(loadDictLang());
    const onCustom = (e: Event) => {
      const v = (e as CustomEvent<DictLang>).detail;
      if (v === "jp-vi" || v === "jp-jp") setLang(v);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === DICT_LANG_KEY) setLang(loadDictLang());
    };
    window.addEventListener(DICT_LANG_EVENT, onCustom as EventListener);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(DICT_LANG_EVENT, onCustom as EventListener);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return lang;
}

interface PendingPayment {
  id: string;
  plan: string;
  created_at?: string;
}

interface SettingsModalProps {
  open: boolean;
  user: { id?: string } | null;
  profile: { plan?: string } | null;
  onClose: () => void;
  onOpenPremium?: () => void;
}

export default function SettingsModal({ open, user, profile, onClose, onOpenPremium }: SettingsModalProps) {
  const [dictLang, setDictLang] = useState<DictLang>(DEFAULT_DICT_LANG);
  const [pending, setPending] = useState<PendingPayment | null>(null);
  const [loadingPending, setLoadingPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDictLang(loadDictLang());
  }, [open]);

  // Load latest pending payment_request for this user (to show "đang xử lý")
  useEffect(() => {
    if (!open || !user?.id) { setPending(null); return; }
    let cancelled = false;
    setLoadingPending(true);
    (async () => {
      const { data, error } = await sb
        .from("payment_requests")
        .select("id, plan, created_at, status")
        .eq("user_id", user.id)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(1);
      if (cancelled) return;
      if (error) { setPending(null); setLoadingPending(false); return; }
      const row = (data ?? [])[0];
      setPending(row ? { id: row.id, plan: row.plan, created_at: row.created_at } : null);
      setLoadingPending(false);
    })();
    return () => { cancelled = true; };
  }, [open, user?.id]);

  // ESC closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  function pickLang(id: DictLang) {
    setDictLang(id);
    try { localStorage.setItem(DICT_LANG_KEY, id); } catch { /* ignore */ }
    try { window.dispatchEvent(new CustomEvent(DICT_LANG_EVENT, { detail: id })); } catch { /* ignore */ }
  }

  const planKey = (profile?.plan || "free").toLowerCase();
  const planLabel = PLAN_LABEL[planKey] ?? planKey;
  const badge = PLAN_BADGE[planKey] ?? PLAN_BADGE.free;
  const isFree = planKey === "free";

  const pendingPlanLabel = pending ? (PLAN_LABEL[pending.plan] ?? pending.plan) : "";
  const pendingDate = pending?.created_at
    ? new Date(pending.created_at).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : "";

  return (
    <div
      className="modal-overlay active"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ zIndex: 9999 }}
    >
      <div style={{
        background: "var(--white)", borderRadius: 18, width: "94%", maxWidth: 560,
        maxHeight: "88vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,.18)",
      }}>
        {/* Header */}
        <div style={{ padding: "20px 24px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: "-0.5px" }}>⚙️ Cài đặt</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>Tuỳ chỉnh ngôn ngữ và quản lý gói của bạn.</div>
          </div>
          <button
            onClick={onClose}
            aria-label="Đóng"
            style={{ background: "transparent", border: "none", fontSize: 22, cursor: "pointer", color: "var(--muted)", lineHeight: 1, padding: 4 }}
          >×</button>
        </div>

        <div style={{ padding: "16px 24px 22px", display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Section 1: Dictionary language */}
          <section>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: "var(--text)" }}>Ngôn ngữ từ điển</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {DICT_LANG_OPTIONS.map((opt) => {
                const selected = dictLang === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => pickLang(opt.id)}
                    style={{
                      display: "flex", alignItems: "center", gap: 12,
                      padding: "12px 14px", borderRadius: 12,
                      border: `1.5px solid ${selected ? "#2b6cb0" : "var(--border)"}`,
                      background: selected ? "rgba(43,108,176,.06)" : "var(--white)",
                      cursor: "pointer",
                      textAlign: "left",
                      fontFamily: "Be Vietnam Pro,Noto Sans JP,sans-serif",
                    }}
                  >
                    <span aria-hidden style={{
                      width: 18, height: 18, borderRadius: "50%",
                      border: `2px solid ${selected ? "#2b6cb0" : "var(--border)"}`,
                      background: selected ? "#2b6cb0" : "transparent",
                      boxShadow: selected ? "inset 0 0 0 3px var(--white)" : "none",
                      flexShrink: 0,
                    }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{opt.label}</div>
                      <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>{opt.sub}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Section 2: Manage plan */}
          <section>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: "var(--text)" }}>Quản lý gói của bạn</div>
            </div>

            {!user ? (
              <div style={{
                padding: "14px 16px", borderRadius: 12, border: "1px dashed var(--border)",
                background: "var(--surface)", fontSize: 13, color: "var(--muted)",
              }}>
                Đăng nhập để xem gói đăng ký của bạn.
              </div>
            ) : (
              <div style={{
                padding: "14px 16px", borderRadius: 12, border: "1px solid var(--border)",
                background: "var(--white)", display: "flex", flexDirection: "column", gap: 12,
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 11.5, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 700 }}>Gói hiện tại</div>
                    <div style={{ fontSize: 15.5, fontWeight: 800, color: "var(--text)", marginTop: 4 }}>{planLabel}</div>
                  </div>
                  <span style={{
                    fontSize: 11, fontWeight: 800,
                    color: badge.fg, background: badge.bg, border: `1px solid ${badge.border}`,
                    padding: "4px 10px", borderRadius: 99, textTransform: "uppercase", letterSpacing: ".04em",
                  }}>
                    {isFree ? "Miễn phí" : "Đã thanh toán"}
                  </span>
                </div>

                {loadingPending && (
                  <div style={{ fontSize: 12.5, color: "var(--muted)" }}>Đang kiểm tra trạng thái thanh toán…</div>
                )}

                {pending && !loadingPending && (
                  <div style={{
                    padding: "10px 12px", borderRadius: 10,
                    border: "1px solid #facc15", background: "#fffbeb",
                    display: "flex", alignItems: "flex-start", gap: 10,
                  }}>
                    <span aria-hidden style={{ fontSize: 16, lineHeight: "20px" }}>⏳</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: "#a16207" }}>Đang xử lý</div>
                      <div style={{ fontSize: 12, color: "#78350f", marginTop: 2, lineHeight: 1.5 }}>
                        Yêu cầu nâng cấp <strong>{pendingPlanLabel}</strong> đang chờ duyệt.
                        {pendingDate && <> · Gửi lúc {pendingDate}</>}
                        <br />
                        Chúng tôi sẽ xử lý trong vòng 5 phút sau khi nhận được chuyển khoản.
                      </div>
                    </div>
                  </div>
                )}

                {isFree && !pending && !loadingPending && onOpenPremium && (
                  <button
                    type="button"
                    onClick={() => { onClose(); onOpenPremium(); }}
                    style={{
                      alignSelf: "flex-start",
                      padding: "9px 16px", borderRadius: 99,
                      border: "none", background: "linear-gradient(135deg,#f59e0b,#d97706)",
                      color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer",
                      fontFamily: "Be Vietnam Pro,Noto Sans JP,sans-serif",
                    }}
                  >
                    ⭐ Nâng cấp Premium
                  </button>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

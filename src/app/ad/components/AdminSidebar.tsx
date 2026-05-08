"use client";

export type AdminTabId = "students" | "payments" | "exams" | "compose" | "vocab" | "grammar" | "anki";

interface AdminSidebarProps {
  adminUser: { email?: string; user_metadata?: Record<string, unknown> } | null;
  activeTab: AdminTabId;
  pendingPayments: number;
  theme: "dark" | "light";
  onToggleTheme: () => void;
  onTabChange: (tab: AdminTabId) => void;
  onLogout: () => void;
}

const NAV_ITEMS: { id: AdminTabId; label: string; icon: string; group?: string }[] = [
  { id: "students",  label: "Học viên",         icon: "👥", group: "Quản lý" },
  { id: "payments",  label: "Thanh toán",        icon: "💳" },
  { id: "exams",     label: "Danh sách đề",      icon: "📋" },
  { id: "compose",   label: "Soạn đề",           icon: "✏️",  group: "Nội dung" },
  { id: "vocab",     label: "Thư viện từ vựng",  icon: "📖" },
  { id: "grammar",   label: "Thư viện ngữ pháp", icon: "📝" },
  { id: "anki",      label: "Anki Decks",        icon: "🃏" },
];

export default function AdminSidebar({
  adminUser, activeTab, pendingPayments, theme, onToggleTheme, onTabChange, onLogout,
}: AdminSidebarProps) {
  const name = String(adminUser?.user_metadata?.full_name ?? adminUser?.email?.split("@")[0] ?? "Admin");
  const init = name[0].toUpperCase();

  return (
    <div className="sidebar">
      <div className="sidebar-logo">
        <span className="nm">jlpt<span className="brand-bro">bro</span></span>
        <span className="bd">ADMIN</span>
      </div>
      <div className="s-nav">
        {NAV_ITEMS.map((item) => (
          <div key={item.id}>
            {item.group && <div className="nav-grp">{item.group}</div>}
            <button
              className={`nav-item${activeTab === item.id ? " active" : ""}`}
              onClick={() => onTabChange(item.id)}
            >
              <span className="ico">{item.icon}</span>
              {item.label}
              {item.id === "payments" && pendingPayments > 0 && (
                <span className="pay-badge-dot" id="pay-nav-badge">{pendingPayments}</span>
              )}
            </button>
          </div>
        ))}
      </div>
      <div className="sidebar-bottom">
        <div className="user-pill">
          <div className="user-av" id="admin-av">{init}</div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#ccc" }} id="admin-name">{name}</div>
            <div style={{ fontSize: 10, color: "#444" }}>Super Admin</div>
          </div>
        </div>
        <button className="btn-theme-toggle" onClick={onToggleTheme}>
          {theme === "dark" ? "☀️ Chế độ sáng" : "🌙 Chế độ tối"}
        </button>
        <button className="btn-logout" onClick={onLogout}>← Đăng xuất</button>
      </div>
    </div>
  );
}

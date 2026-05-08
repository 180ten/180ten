"use client";
interface BreakOverlayProps {
  visible: boolean;
  timeLeft: string;
  onStartListening: () => void;
}

export default function BreakOverlay({ visible, timeLeft, onStartListening }: BreakOverlayProps) {
  return (
    <div id="break-overlay" className={`break-overlay${visible ? "" : " hidden"}`}>
      <div className="break-emoji">☕</div>
      <div className="break-title">Nghỉ giữa giờ</div>
      <div className="break-sub">
        Bạn đã hoàn thành <strong>Phần Đọc hiểu</strong>. Hãy nghỉ ngơi trước khi bắt đầu Phần Nghe hiểu.
      </div>
      <div className="break-clock" id="break-clock">{timeLeft}</div>
      <div style={{ fontSize: 12, color: "var(--muted)" }}>Tự động bắt đầu khi hết giờ nghỉ</div>
      <button className="break-btn" id="break-next-btn" onClick={onStartListening}>
        ▶ Bắt đầu Nghe hiểu ngay
      </button>
    </div>
  );
}

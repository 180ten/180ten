"use client";
interface ExamConfirmModalProps {
  open: boolean;
  title: string;
  body: string;
  onClose: () => void;
  onOk: () => void;
  okLabel?: string;
}

export default function ExamConfirmModal({ open, title, body, onClose, onOk, okLabel = "OK" }: ExamConfirmModalProps) {
  if (!open) return null;
  return (
    <div className="modal-overlay active" id="modal" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <h3 id="m-title">{title}</h3>
        <p id="m-body">{body}</p>
        <div className="modal-btns">
          <button onClick={onClose} style={{ border: "1.5px solid var(--border)", background: "transparent", color: "var(--text)" }}>Đóng</button>
          <button id="m-ok" onClick={onOk} style={{ background: "var(--accent)", color: "#fff", border: "none" }}>{okLabel}</button>
        </div>
      </div>
    </div>
  );
}

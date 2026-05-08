"use client";
import Image from "next/image";
import { useEffect, useState } from "react";

const JLPT_DATES = [
  new Date("2025-07-06"),
  new Date("2025-12-07"),
  new Date("2026-07-05"),
  new Date("2026-12-06"),
];

function getNextExamDate(): Date {
  const now = new Date();
  return JLPT_DATES.find((d) => d > now) ?? JLPT_DATES[JLPT_DATES.length - 1];
}

const DISMISS_KEY = "jlptbro-countdown-dismissed";

export default function CountdownBar() {
  const [text, setText] = useState("Đang tính...");
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    try {
      const target = getNextExamDate().toISOString().slice(0, 10);
      if (localStorage.getItem(DISMISS_KEY) === target) setHidden(true);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    function update() {
      const next = getNextExamDate();
      const days = Math.ceil((next.getTime() - Date.now()) / 86400000);
      setText(
        days > 0
          ? `Còn ${days} ngày nữa là đến kỳ thi JLPT rồi. Cố lên!`
          : "Hôm nay là ngày thi JLPT! Chúc bạn thi tốt!"
      );
    }
    update();
    const id = setInterval(update, 60000);
    return () => clearInterval(id);
  }, []);

  function dismiss() {
    setHidden(true);
    try {
      const target = getNextExamDate().toISOString().slice(0, 10);
      localStorage.setItem(DISMISS_KEY, target);
    } catch { /* ignore */ }
  }

  if (hidden) return null;

  return (
    <div id="jlpt-countdown-bar" className="jlpt-countdown-bar">
      <Image src="/svg/countdown.svg" alt="" aria-hidden width={16} height={16} />
      <span id="jlpt-countdown-text">{text}</span>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Đóng"
        title="Đóng"
        style={{
          position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)",
          background: "transparent", border: "none", color: "#a44722",
          fontSize: 18, lineHeight: 1, cursor: "pointer", padding: 4,
          opacity: 0.7,
        }}
        onMouseOver={(e) => { e.currentTarget.style.opacity = "1"; }}
        onMouseOut={(e) => { e.currentTarget.style.opacity = "0.7"; }}
      >×</button>
    </div>
  );
}

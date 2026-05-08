"use client";
import { useState, useEffect, useRef } from "react";
import type { ReportData } from "@/lib/examLogic";
import { TYPE_MONDAI_MAP } from "@/lib/constants";

interface ReportModalProps {
  open: boolean;
  reportData: ReportData | null;
  examName: string;
  onClose: () => void;
  /** true → run grow-from-zero animation (use ngay sau khi nộp bài). false/undefined → render tĩnh. */
  animateOnOpen?: boolean;
  /** Target practice → render simpler report (no pass/fail, no thresholds). */
  isTarget?: boolean;
}

// ── Theme tokens ───────────────────────────────────────────────────
const TOKENS = {
  bg:        "#ffffff",
  bg2:       "#f7f6f3",
  text:      "#111827",
  textSec:   "#6B7280",
  textTer:   "#b5b2a8",
  border:    "#E5E7EB",
  trackGray: "#F1EFE8",
  passBg:    "#EAF3DE",
  passText:  "#27500A",
  failBg:    "#FCEBEB",
  failText:  "#791F1F",
  warnBg:    "#FCEBEB",
  warnText:  "#791F1F",
  primary:   "#534AB7",
  primaryBg: "#EEEDFE",
  warn:      "#D85A30",
};

const REPORT_MODAL_CSS = `
  #report-modal-overlay {
    overflow: hidden;
  }

  .report-modal-shell {
    background: #ffffff;
    border: 1px solid rgba(229, 231, 235, .92);
    border-radius: 26px;
    box-shadow: 0 24px 76px rgba(17, 24, 39, .14);
    color: #111827;
    font-size: 13px;
    max-height: none;
    max-width: 1120px;
    overflow: visible;
    padding: clamp(18px, 2.5vw, 34px) clamp(16px, 2.4vw, 30px) clamp(18px, 2.2vw, 28px);
    position: relative;
    transform: scale(var(--report-scale, 1));
    transform-origin: center center;
    transition: transform .16s ease;
    will-change: transform;
    width: min(95vw, 1120px);
  }

  .report-modal-shell.detail-open {
    max-height: min(94vh, calc(100dvh - 24px));
    overflow-x: hidden;
    overflow-y: auto;
  }

  .report-close-button {
    align-items: center;
    background: transparent;
    border: 0;
    color: #111827;
    cursor: pointer;
    display: inline-flex;
    font-size: 36px;
    height: 44px;
    justify-content: center;
    line-height: 1;
    padding: 0;
    position: absolute;
    right: 34px;
    top: 32px;
    width: 44px;
    z-index: 4;
  }

  .jlpt-report {
    color: #111827;
    min-width: 0;
  }

  .jlpt-report-header {
    align-items: center;
    display: flex;
    gap: 22px;
    justify-content: space-between;
    margin-bottom: clamp(18px, 3.2vw, 36px);
    padding: 0 42px 0 0;
  }

  .jlpt-report-heading {
    align-items: center;
    display: flex;
    gap: clamp(16px, 2.4vw, 28px);
    min-width: 0;
  }

  .jlpt-report-title-icon {
    align-items: center;
    background: linear-gradient(180deg, #F0EEFF 0%, #FBFAFF 100%);
    border-radius: 12px;
    box-shadow: 0 10px 22px rgba(83, 74, 183, .13);
    color: #534AB7;
    display: inline-flex;
    flex: 0 0 auto;
    height: clamp(46px, 4.8vw, 58px);
    justify-content: center;
    width: clamp(46px, 4.8vw, 58px);
  }

  .jlpt-report-title {
    color: #111827;
    font-size: clamp(26px, 2.35vw, 36px);
    font-weight: 900;
    letter-spacing: 0;
    line-height: 1.05;
    margin: 0 0 12px;
  }

  .jlpt-report-subtitle {
    color: #6B7280;
    font-size: clamp(15px, 1.4vw, 21px);
    font-weight: 650;
    line-height: 1.25;
    margin: 0;
  }

  .jlpt-report-status {
    align-items: center;
    background: var(--status-bg);
    border-radius: 999px;
    color: var(--status-text);
    display: inline-flex;
    flex: 0 0 auto;
    font-size: clamp(15px, 1.5vw, 18px);
    font-weight: 900;
    min-height: clamp(42px, 4.4vw, 52px);
    padding: 0 clamp(18px, 2.2vw, 26px);
    white-space: nowrap;
  }

  .jlpt-report-status-mark {
    font-size: 30px;
    font-weight: 500;
    line-height: 1;
  }

  .report-score-panel {
    background: linear-gradient(180deg, #FFFFFF 0%, #FFFFFF 100%);
    border: 1px solid rgba(229, 231, 235, .72);
    border-radius: 24px;
    box-shadow: 0 14px 38px rgba(17, 24, 39, .035);
    margin-bottom: 28px;
    overflow: hidden;
    padding: 42px 50px 36px;
    position: relative;
  }

  .report-score-bg-wrap {
    bottom: -20px;
    pointer-events: none;
    position: absolute;
    right: -18px;
    top: -20px;
    width: 58%;
    z-index: 0;
  }

  .report-score-bg {
    opacity: .48;
    object-fit: contain;
    object-position: right center;
  }

  .report-score-content {
    align-items: center;
    display: grid;
    gap: 46px;
    grid-template-columns: 300px 1px 340px minmax(360px, 1fr);
    position: relative;
    z-index: 1;
  }

  .report-score-hex-col {
    align-items: center;
    display: flex;
    justify-content: center;
    min-width: 0;
  }

  .report-score-hex {
    aspect-ratio: 180 / 210;
    filter:
      drop-shadow(0 18px 28px rgba(15, 23, 42, .10))
      drop-shadow(0 4px 10px rgba(15, 23, 42, .055));
    position: relative;
    transition: filter .2s ease, transform .2s ease;
    width: clamp(176px, 15vw, 214px);
  }

  .report-score-hex:hover {
    filter:
      drop-shadow(0 22px 34px rgba(15, 23, 42, .13))
      drop-shadow(0 7px 16px rgba(15, 23, 42, .075));
    transform: translateY(-2px);
  }

  .report-score-hex-glow {
    background:
      radial-gradient(circle at 50% 8%, rgba(255, 92, 103, .14), transparent 28%),
      radial-gradient(circle at 44% 50%, rgba(255, 255, 255, .95), transparent 48%);
    filter: blur(14px);
    inset: -22px -18px;
    opacity: .9;
    position: absolute;
    z-index: 0;
  }

  .report-score-hex-shell,
  .report-score-hex-surface {
    clip-path: polygon(50% 0%, 92% 25%, 92% 75%, 50% 100%, 8% 75%, 8% 25%);
    position: absolute;
  }

  .report-score-hex-shell {
    background:
      linear-gradient(145deg, rgba(255,255,255,.98) 0%, rgba(255,255,255,.72) 44%, rgba(242,244,248,.88) 100%);
    inset: 0;
    padding: 7px;
    z-index: 1;
  }

  .report-score-hex-shell::before {
    background:
      linear-gradient(145deg, rgba(255,255,255,.88), rgba(255,255,255,.18) 44%, rgba(224,228,238,.30)),
      radial-gradient(circle at 52% 4%, rgba(255, 89, 101, .24), transparent 10%);
    clip-path: inherit;
    content: "";
    inset: 0;
    opacity: .86;
    position: absolute;
    z-index: 0;
  }

  .report-score-hex-surface {
    background:
      radial-gradient(circle at 26% 16%, rgba(255,255,255,.96), rgba(255,255,255,.28) 34%, transparent 50%),
      linear-gradient(155deg, #FFFFFF 0%, #FAFAFD 42%, #F3F5F9 100%);
    box-shadow:
      inset 10px 12px 24px rgba(255,255,255,.78),
      inset -12px -14px 22px rgba(171, 180, 196, .14),
      inset 0 0 0 1px rgba(255,255,255,.78);
    inset: 8px;
    overflow: hidden;
    z-index: 1;
  }

  .report-score-hex-surface::before {
    background: linear-gradient(135deg, rgba(255,255,255,.96), rgba(255,255,255,0) 44%);
    content: "";
    height: 58%;
    left: 6%;
    opacity: .84;
    position: absolute;
    top: 5%;
    transform: rotate(-8deg);
    width: 62%;
  }

  .report-score-hex-surface::after {
    background: radial-gradient(circle at 50% 90%, rgba(144, 153, 170, .16), transparent 56%);
    content: "";
    inset: 0;
    position: absolute;
  }

  .report-score-dot {
    background: linear-gradient(145deg, #FF6D78 0%, var(--score-fill, #F4495E) 100%);
    border-radius: 999px;
    box-shadow:
      0 0 0 8px rgba(255, 255, 255, .86),
      0 6px 14px rgba(244, 73, 94, .22);
    height: clamp(15px, 1.3vw, 20px);
    left: 50%;
    position: absolute;
    top: -1px;
    transform: translateX(-50%);
    width: clamp(15px, 1.3vw, 20px);
    z-index: 3;
  }

  .report-score-hex-content {
    align-items: center;
    display: flex;
    flex-direction: column;
    inset: 0;
    justify-content: center;
    padding-top: 26px;
    position: absolute;
    z-index: 2;
  }

  .report-score-hex-value {
    color: #0F172A;
    font-family: Inter, -apple-system, BlinkMacSystemFont, "SF Pro Display", "Noto Sans JP", sans-serif;
    font-size: clamp(58px, 5vw, 76px);
    font-weight: 900;
    letter-spacing: 0;
    line-height: 1;
  }

  .report-score-hex-max {
    color: #111827;
    font-family: Inter, -apple-system, BlinkMacSystemFont, "SF Pro Display", "Noto Sans JP", sans-serif;
    font-size: clamp(20px, 1.8vw, 26px);
    font-weight: 800;
    line-height: 1;
    margin-top: 11px;
  }

  .report-score-hex-label {
    color: #111827;
    font-size: clamp(16px, 1.42vw, 21px);
    font-weight: 850;
    line-height: 1.3;
    margin-top: 13px;
    text-align: center;
  }

  .report-score-divider {
    background: #CBD5E1;
    height: 252px;
    justify-self: center;
    width: 1px;
  }

  .report-pass-block {
    min-width: 0;
  }

  .report-pass-label {
    color: #667085;
    font-size: 21px;
    font-weight: 750;
    line-height: 1.2;
    margin-bottom: 14px;
  }

  .report-pass-score {
    color: #0F172A;
    font-size: 46px;
    font-weight: 900;
    letter-spacing: 0;
    line-height: 1;
    margin-bottom: 22px;
  }

  .report-pass-score span {
    font-size: .75em;
  }

  .report-warning {
    align-items: flex-start;
    color: var(--status-text);
    display: inline-flex;
    font-size: 20px;
    font-weight: 900;
    gap: 12px;
    line-height: 1.35;
  }

  .report-warning svg {
    flex: 0 0 auto;
    margin-top: 3px;
  }

  .report-score-progress-area {
    align-self: end;
    min-width: 0;
    padding-top: 96px;
    position: relative;
  }

  .report-score-track {
    background: rgba(226, 232, 240, .88);
    border-radius: 999px;
    height: 8px;
    position: relative;
  }

  .report-score-fill {
    background: var(--score-fill);
    border-radius: inherit;
    height: 100%;
    left: 0;
    position: absolute;
    top: 0;
  }

  .report-score-current-dot {
    background: var(--score-fill);
    border-radius: 999px;
    box-shadow: 0 0 0 4px rgba(255,255,255,.92);
    height: 18px;
    position: absolute;
    top: 50%;
    transform: translate(-50%, -50%);
    width: 18px;
  }

  .report-score-marker {
    background: var(--score-fill);
    height: 58px;
    position: absolute;
    top: -20px;
    transform: translateX(-50%);
    width: 2px;
  }

  .report-score-marker::after {
    background: var(--score-fill);
    border-radius: 999px;
    box-shadow: 0 0 0 4px rgba(255,255,255,.92);
    content: "";
    height: 16px;
    left: 50%;
    position: absolute;
    top: 17px;
    transform: translateX(-50%);
    width: 16px;
  }

  .report-score-pass-label {
    color: #0F172A;
    font-size: 19px;
    font-weight: 850;
    position: absolute;
    top: -54px;
    transform: translateX(-50%);
    white-space: nowrap;
  }

  .report-score-axis {
    color: #111827;
    display: flex;
    font-size: 18px;
    font-weight: 750;
    justify-content: space-between;
    margin-top: 22px;
  }

  .report-score-axis-pass {
    color: #4B5563;
    font-size: 17px;
    font-weight: 750;
    left: var(--pass-pct);
    position: absolute;
    text-align: center;
    top: calc(100% + 18px);
    transform: translateX(-50%);
    white-space: nowrap;
  }

  .report-section-head {
    align-items: flex-end;
    display: flex;
    gap: 18px;
    justify-content: space-between;
    margin: 24px 0 24px;
  }

  .report-section-title {
    color: #111827;
    font-size: 28px;
    font-weight: 900;
    letter-spacing: 0;
    line-height: 1.2;
    margin: 0 0 10px;
  }

  .report-section-subtitle {
    color: #6B7280;
    font-size: 19px;
    font-weight: 600;
    line-height: 1.35;
    margin: 0;
  }

  .report-guide-button {
    align-items: center;
    background: #F0EDFF;
    border: 0;
    border-radius: 999px;
    color: #4F46E5;
    cursor: pointer;
    display: inline-flex;
    flex: 0 0 auto;
    font-family: 'Be Vietnam Pro','Noto Sans JP',sans-serif;
    font-size: 18px;
    font-weight: 850;
    gap: 10px;
    min-height: 48px;
    padding: 0 22px;
  }

  .report-guide-icon {
    align-items: center;
    border: 2px solid currentColor;
    border-radius: 999px;
    display: inline-flex;
    font-size: 14px;
    font-weight: 900;
    height: 22px;
    justify-content: center;
    line-height: 1;
    width: 22px;
  }

  .report-section-grid {
    display: grid;
    gap: 26px;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    margin-bottom: 44px;
  }

  .report-section-card {
    background: var(--section-card-bg);
    border: 1px solid var(--section-border);
    border-radius: 20px;
    box-shadow: 0 16px 36px rgba(17, 24, 39, .045);
    min-height: 292px;
    padding: 28px 30px 26px;
  }

  .report-section-card-head {
    align-items: flex-start;
    display: flex;
    gap: 24px;
    margin-bottom: 44px;
  }

  .report-section-icon {
    align-items: center;
    background: var(--section-icon-bg);
    border-radius: 14px;
    color: var(--section-color);
    display: inline-flex;
    flex: 0 0 auto;
    font-size: 38px;
    font-weight: 900;
    height: 74px;
    justify-content: center;
    line-height: 1;
    width: 74px;
  }

  .report-section-name {
    color: #111827;
    font-size: 23px;
    font-weight: 900;
    line-height: 1.2;
    margin: 6px 0 12px;
  }

  .report-section-romaji {
    color: #111827;
    font-size: 20px;
    font-weight: 650;
    line-height: 1.25;
    margin: 0;
  }

  .report-section-score-row {
    align-items: center;
    display: flex;
    gap: 10px;
    margin-bottom: 24px;
  }

  .report-section-score {
    color: #0F172A;
    font-size: 54px;
    font-weight: 900;
    line-height: 1;
  }

  .report-section-max {
    color: #111827;
    font-size: 25px;
    font-weight: 750;
  }

  .report-section-badge {
    background: var(--section-badge-bg);
    border-radius: 999px;
    color: var(--section-badge-text);
    font-size: 18px;
    font-weight: 900;
    margin-left: auto;
    padding: 11px 22px;
    white-space: nowrap;
  }

  .report-section-track {
    background: rgba(226, 232, 240, .92);
    border-radius: 999px;
    height: 7px;
    margin-bottom: 22px;
    overflow: visible;
    position: relative;
  }

  .report-section-fill {
    background: var(--section-fill);
    border-radius: inherit;
    height: 100%;
    left: 0;
    position: absolute;
    top: 0;
  }

  .report-section-marker {
    background: #111827;
    height: 18px;
    position: absolute;
    top: -5px;
    transform: translateX(-50%);
    width: 2px;
  }

  .report-section-meta {
    color: #6B7280;
    font-size: 19px;
    font-weight: 650;
    line-height: 1.35;
    margin: 0;
  }

  .report-mondai-toggle {
    align-items: center;
    background: #FFFFFF;
    border: 1.5px solid #FF6B35;
    border-radius: 14px;
    color: #F4511E;
    cursor: pointer;
    display: inline-flex;
    font-family: 'Be Vietnam Pro','Noto Sans JP',sans-serif;
    font-size: 26px;
    font-weight: 900;
    gap: 16px;
    justify-content: center;
    min-height: 92px;
    padding: 0 22px;
    transition: background .2s ease, box-shadow .2s ease, transform .2s ease;
    width: 100%;
  }

  .report-mondai-toggle:hover {
    background: #FFF5EF;
    box-shadow: 0 10px 24px rgba(244, 81, 30, .08);
  }

  .report-mondai-chevron {
    transition: transform .2s ease;
  }

  .report-mondai-chevron.is-open {
    transform: rotate(180deg);
  }

  @media (max-width: 1180px) {
    .report-score-content {
      gap: 30px;
      grid-template-columns: 240px 1px minmax(230px, .8fr) minmax(300px, 1fr);
    }

    .report-score-panel {
      padding: 34px 30px 34px;
    }

    .report-score-hex {
      width: 188px;
    }

    .report-section-grid {
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    }
  }

  @media (max-width: 920px) {
    .report-modal-shell {
      border-radius: 22px;
      padding: 28px 22px 30px;
      width: min(96vw, 760px);
    }

    .report-close-button {
      right: 20px;
      top: 20px;
    }

    .jlpt-report-header {
      align-items: flex-start;
      flex-direction: column;
      padding-right: 52px;
    }

    .jlpt-report-heading {
      gap: 16px;
    }

    .jlpt-report-title-icon {
      height: 48px;
      width: 48px;
    }

    .report-score-bg-wrap {
      opacity: .32;
      width: 72%;
    }

    .report-score-content {
      align-items: start;
      grid-template-columns: 1fr;
    }

    .report-score-divider {
      display: none;
    }

    .report-score-progress-area {
      padding-top: 56px;
      width: 100%;
    }

    .report-section-head {
      align-items: flex-start;
      flex-direction: column;
    }
  }

  @media (max-width: 640px) {
    .report-modal-shell {
      border-radius: 18px;
      max-height: 94vh;
      padding: 24px 16px 24px;
      width: 96vw;
    }

    .report-score-bg-wrap {
      display: none;
    }

    .report-score-panel {
      padding: 24px 16px 26px;
    }

    .report-score-hex {
      width: 172px;
    }

    .report-score-hex-value {
      font-size: 54px;
    }

    .report-pass-score {
      font-size: 38px;
    }

    .report-section-card {
      padding: 24px 22px;
    }

    .report-section-card-head {
      gap: 16px;
    }

    .report-section-icon {
      height: 58px;
      width: 58px;
      font-size: 30px;
    }

    .report-section-score {
      font-size: 46px;
    }

    .report-mondai-toggle {
      font-size: 20px;
      min-height: 74px;
    }
  }

  .simple-report-score-card {
    align-items: center;
    background: #FFFFFF;
    border: 1px solid #E8EAF1;
    border-radius: 16px;
    display: grid;
    gap: clamp(24px, 6vw, 96px);
    grid-template-columns: minmax(240px, 330px) minmax(360px, 1fr);
    min-height: clamp(220px, 27vh, 310px);
    margin-bottom: clamp(18px, 3vw, 32px);
    padding: clamp(22px, 4vw, 48px);
  }

  .simple-score-summary {
    min-width: 0;
  }

  .simple-score-label {
    color: #6B7280;
    font-size: clamp(19px, 1.8vw, 24px);
    font-weight: 700;
    line-height: 1.25;
    margin-bottom: clamp(12px, 2vw, 22px);
  }

  .simple-score-line {
    align-items: baseline;
    display: flex;
    gap: 14px;
    margin-bottom: clamp(18px, 3vw, 34px);
  }

  .simple-score-main {
    background: linear-gradient(180deg, #8277F5 0%, #5D4CE2 100%);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    font-size: clamp(48px, 6.2vw, 78px);
    font-weight: 900;
    line-height: 1;
  }

  .simple-score-denom {
    color: #6B7280;
    font-size: clamp(24px, 3vw, 38px);
    font-weight: 650;
    line-height: 1;
  }

  .simple-score-warning {
    align-items: center;
    color: #6B7280;
    display: flex;
    font-size: clamp(15px, 1.85vw, 24px);
    font-weight: 550;
    gap: 14px;
    line-height: 1.45;
  }

  .simple-score-warning strong {
    color: #9A1B1E;
    font-weight: 900;
  }

  .simple-warning-icon {
    align-items: center;
    background: #FFF7F5;
    border-radius: 8px;
    color: #F4511E;
    display: inline-flex;
    flex: 0 0 auto;
    height: clamp(26px, 3vw, 34px);
    justify-content: center;
    width: clamp(26px, 3vw, 34px);
  }

  .simple-score-progress-area {
    min-width: 0;
    padding-top: clamp(0px, 1.5vw, 18px);
  }

  .simple-pass-title {
    color: #6B7280;
    font-size: clamp(19px, 1.7vw, 23px);
    font-weight: 800;
    line-height: 1.25;
    margin: 0 0 clamp(22px, 3.3vw, 38px);
  }

  .simple-score-track {
    background: #E4E5EB;
    border-radius: 999px;
    height: clamp(12px, 1.5vw, 18px);
    position: relative;
  }

  .simple-score-fill {
    background: linear-gradient(90deg, #5B4ADD 0%, #7B6DF1 100%);
    border-radius: inherit;
    height: 100%;
    left: 0;
    min-width: 38px;
    position: absolute;
    top: 0;
    width: var(--score-pct);
  }

  .simple-score-pass-marker {
    border-left: 2px dashed #6C5CE7;
    height: clamp(38px, 4.6vw, 54px);
    left: var(--pass-pct);
    position: absolute;
    top: 0;
    transform: translateX(-50%);
  }

  .simple-score-axis {
    color: #6B7280;
    font-size: 18px;
    font-weight: 700;
    height: clamp(38px, 5vw, 58px);
    position: relative;
  }

  .simple-score-axis span {
    position: absolute;
    top: 20px;
    transform: translateX(-50%);
    white-space: nowrap;
  }

  .simple-score-axis .axis-start {
    left: 0;
    transform: none;
  }

  .simple-score-axis .axis-pass {
    color: #6C5CE7;
    left: var(--pass-pct);
  }

  .simple-score-axis .axis-end {
    right: 0;
    transform: none;
  }

  .simple-section-card {
    background: #FFFFFF;
    border: 1px solid #E8EAF1;
    border-radius: 16px;
    margin-bottom: 0;
    overflow: hidden;
  }

  .simple-section-header {
    align-items: center;
    display: flex;
    gap: 18px;
    justify-content: space-between;
    padding: clamp(18px, 2.6vw, 30px) clamp(22px, 3vw, 34px) clamp(12px, 1.8vw, 18px);
  }

  .simple-section-title {
    color: #111827;
    font-size: clamp(21px, 2.2vw, 27px);
    font-weight: 900;
    line-height: 1.2;
    margin: 0;
  }

  .simple-section-rows {
    padding: 0 clamp(22px, 3vw, 34px);
  }

  .simple-section-row {
    align-items: center;
    border-bottom: 1px solid #E8EAF1;
    display: grid;
    gap: clamp(14px, 2vw, 24px);
    grid-template-columns: 62px minmax(220px, 1fr) minmax(220px, 300px) 116px;
    min-height: clamp(76px, 10vh, 104px);
    padding: clamp(10px, 1.6vw, 18px) 0;
  }

  .simple-section-icon {
    align-items: center;
    background: var(--section-icon-bg);
    border-radius: 13px;
    color: var(--section-color);
    display: inline-flex;
    font-size: clamp(24px, 2.4vw, 30px);
    font-weight: 900;
    height: clamp(44px, 4.8vw, 56px);
    justify-content: center;
    line-height: 1;
    width: clamp(44px, 4.8vw, 56px);
  }

  .simple-section-name {
    color: #111827;
    font-size: clamp(18px, 1.6vw, 22px);
    font-weight: 900;
    line-height: 1.25;
    margin: 0 0 8px;
  }

  .simple-section-desc {
    color: #8A8FA3;
    font-size: clamp(15px, 1.3vw, 18px);
    font-weight: 600;
    line-height: 1.35;
    margin: 0;
  }

  .simple-section-metric {
    min-width: 0;
  }

  .simple-section-score {
    color: #0F172A;
    font-size: clamp(24px, 2.4vw, 32px);
    font-weight: 900;
    line-height: 1;
    margin-bottom: clamp(8px, 1.4vw, 16px);
    text-align: left;
  }

  .simple-section-score span {
    color: #6B7280;
    font-size: .72em;
    font-weight: 650;
  }

  .simple-section-track {
    background: #E4E5EB;
    border-radius: 999px;
    height: 8px;
    overflow: hidden;
    position: relative;
    width: 100%;
  }

  .simple-section-fill {
    background: linear-gradient(90deg, #5B4ADD 0%, #7B6DF1 100%);
    border-radius: inherit;
    height: 100%;
    left: 0;
    min-width: 22px;
    position: absolute;
    top: 0;
    width: var(--section-pct);
  }

  .simple-section-badge {
    background: var(--section-badge-bg);
    border-radius: 999px;
    color: var(--section-badge-text);
    font-size: clamp(14px, 1.35vw, 17px);
    font-weight: 900;
    justify-self: end;
    padding: clamp(8px, 1vw, 12px) clamp(16px, 2vw, 24px);
    white-space: nowrap;
  }

  .simple-detail-toggle {
    align-items: center;
    background: #FFFFFF;
    border: 0;
    color: #6C5CE7;
    cursor: pointer;
    display: inline-flex;
    font-family: 'Be Vietnam Pro','Noto Sans JP',sans-serif;
    font-size: clamp(17px, 1.8vw, 22px);
    font-weight: 800;
    gap: 18px;
    justify-content: center;
    min-height: clamp(56px, 7vh, 82px);
    width: 100%;
  }

  .simple-detail-toggle:hover {
    background: #FAFAFF;
  }

  .simple-detail-arrow {
    transition: transform .2s ease;
  }

  .simple-detail-arrow.is-open {
    transform: rotate(90deg);
  }

  .simple-mondai-panel {
    border-top: 1px solid #E8EAF1;
    padding: 18px 24px 24px;
  }

  @media (max-width: 1120px) {
    .simple-report-score-card {
      grid-template-columns: minmax(220px, 310px) minmax(330px, 1fr);
    }

    .simple-section-row {
      grid-template-columns: 60px minmax(210px, 1fr) minmax(210px, 290px) 116px;
    }
  }

  @media (max-width: 920px) {
    .simple-report-score-card {
      grid-template-columns: 1fr;
      min-height: 0;
      text-align: left;
    }

    .simple-score-progress-area {
      padding-top: 4px;
    }

    .simple-section-header {
      align-items: flex-start;
      flex-direction: column;
    }

    .simple-section-row {
      grid-template-columns: 64px minmax(0, 1fr);
    }

    .simple-section-metric,
    .simple-section-badge {
      grid-column: 2;
      justify-self: start;
      text-align: left;
      width: 100%;
    }
  }

  @media (max-height: 860px) and (min-width: 921px) {
    .report-modal-shell {
      border-radius: 22px;
      padding-top: 26px;
      padding-bottom: 24px;
    }

    .report-close-button {
      top: 22px;
    }

    .jlpt-report-header {
      margin-bottom: 22px;
    }

    .jlpt-report-title-icon {
      height: 46px;
      width: 46px;
    }

    .jlpt-report-title {
      font-size: 29px;
      margin-bottom: 6px;
    }

    .jlpt-report-subtitle {
      font-size: 16px;
    }

    .simple-report-score-card {
      min-height: 220px;
      margin-bottom: 22px;
      padding: 28px 44px;
    }

    .simple-score-main {
      font-size: 62px;
    }

    .simple-score-denom {
      font-size: 32px;
    }

    .simple-score-line {
      margin-bottom: 16px;
    }

    .simple-score-warning {
      font-size: 16px;
    }

    .simple-pass-title {
      font-size: 18px;
      margin-bottom: 20px;
    }

    .simple-score-axis span {
      top: 14px;
    }

    .simple-section-header {
      padding-top: 18px;
      padding-bottom: 10px;
    }

    .simple-section-row {
      min-height: 82px;
      padding: 9px 0;
    }

    .simple-section-icon {
      border-radius: 11px;
      font-size: 27px;
      height: 50px;
      width: 50px;
    }

    .simple-section-name {
      font-size: 18px;
      margin-bottom: 4px;
    }

    .simple-section-desc {
      font-size: 14px;
    }

    .simple-section-score {
      font-size: 25px;
      margin-bottom: 8px;
    }

    .simple-detail-toggle {
      min-height: 56px;
    }
  }

  @media (max-height: 720px) and (min-width: 921px) {
    .report-modal-shell {
      padding-top: 18px;
      padding-bottom: 18px;
    }

    .report-modal-shell.detail-open {
      max-height: calc(100dvh - 12px);
    }

    .jlpt-report-header {
      margin-bottom: 16px;
    }

    .simple-report-score-card {
      min-height: 190px;
      padding: 22px 38px;
    }

    .simple-section-row {
      min-height: 74px;
      padding: 7px 0;
    }

    .simple-detail-toggle {
      min-height: 50px;
    }
  }

  @media (max-width: 640px) {
    .simple-report-score-card {
      padding: 26px 18px;
    }

    .simple-section-header,
    .simple-section-rows {
      padding-left: 18px;
      padding-right: 18px;
    }

    .simple-section-row {
      gap: 14px;
      grid-template-columns: 54px minmax(0, 1fr);
      min-height: 104px;
    }

    .simple-section-icon {
      font-size: 28px;
      height: 52px;
      width: 52px;
    }

    .simple-detail-toggle {
      font-size: 18px;
      min-height: 70px;
    }
  }
`;

const SECTION_THEME: Record<string, { bg: string; card: string; text: string; fill: string; icon: string }> = {
  language:  { bg: "#E9E2FF", card: "#F7F2FF", text: "#4B38B6", fill: "#534AB7", icon: "字" },
  reading:   { bg: "#D9F5EC", card: "#F0FBF7", text: "#087D62", fill: "#1D9E75", icon: "読" },
  listening: { bg: "#DEEEFF", card: "#F3F8FF", text: "#1767A8", fill: "#185FA5", icon: "聴" },
};

const SECTION_LABEL: Record<string, { vi: string; sub: string }> = {
  language:  { vi: "Ngôn ngữ", sub: "(Moji – Goi – Bunpou)" },
  reading:   { vi: "Đọc hiểu", sub: "(Dokkai)" },
  listening: { vi: "Nghe hiểu", sub: "(Choukai)" },
};

const SECTION_DESC: Record<string, string> = {
  language: "Từ vựng • Hán tự • Ngữ pháp",
  reading: "Hiểu nội dung văn bản",
  listening: "Hiểu nội dung hội thoại, bài nói",
};

const SUBGROUP_LABEL: Record<string, { vi: string; romaji: string }> = {
  vocab:   { vi: "Ngôn ngữ", romaji: "Moji – Goi" },
  grammar: { vi: "Ngữ pháp", romaji: "Bunpou" },
  reading: { vi: "Đọc hiểu", romaji: "Dokkai" },
  listen:  { vi: "Nghe hiểu", romaji: "Choukai" },
};

const VI_LABELS: Record<string, string> = {
  kanji: "Đọc Kanji",
  hyouki: "Cách viết",
  bunmyaku: "Từ vựng theo ngữ cảnh",
  iikae: "Từ đồng nghĩa",
  yoho: "Cách dùng từ",
  bunpo1: "Chọn ngữ pháp",
  bunpo2: "Sắp xếp câu",
  bunsho: "Sắp xếp câu",
  togo: "Điền đoạn văn",
  tan: "Đoạn ngắn",
  chu: "Đoạn vừa",
  cho: "Đoạn dài",
  joho: "Tìm thông tin",
  shudai: "So sánh đoạn",
  listen_kadai: "Hiểu nhiệm vụ",
  listen_point: "Hiểu ý chính",
  listen_gaiyou: "Hiểu tổng quan",
  listen_hatsuwa: "Phát ngôn",
  listen_sokuji: "Phản ứng nhanh",
  listen_togo: "Hiểu tổng hợp",
};

function formatVnDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

// Convert "問題1: Kanji đọc" → "問1: Kanji đọc"
function shortMondai(name: string): string {
  return name.replace(/^問題(\d+):/, "問$1:");
}

export default function ReportModal({ open, reportData: d, examName, onClose, animateOnOpen, isTarget }: ReportModalProps) {
  const [showMondai, setShowMondai] = useState(false);
  const [viewMode, setViewMode] = useState<"grouped" | "flat">("grouped");
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [t, setT] = useState(1); // animation progress 0→1; default 1 = no animation
  const [reportScale, setReportScale] = useState(1);
  const shellRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    let raf = 0;
    const resetId = window.setTimeout(() => {
      setShowMondai(false);
      setViewMode("grouped");
      setCollapsedGroups({});
      if (!animateOnOpen) { setT(1); return; }
      setT(0);
      const start = performance.now();
      const dur = 900;
      const tick = (now: number) => {
        const x = Math.min(1, (now - start) / dur);
        const eased = 1 - Math.pow(1 - x, 3); // easeOutCubic
        setT(eased);
        if (x < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }, 0);
    return () => {
      window.clearTimeout(resetId);
      cancelAnimationFrame(raf);
    };
  }, [open, animateOnOpen]);

  useEffect(() => {
    if (!open) return;
    let raf = 0;
    let timer = 0;

    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const shell = shellRef.current;
        if (!shell) return;

        const margin = window.innerWidth < 640 ? 6 : 16;
        const availableW = Math.max(1, window.innerWidth - margin * 2);
        const availableH = Math.max(1, window.innerHeight - margin * 2);
        const naturalW = Math.max(1, shell.offsetWidth);
        const naturalH = Math.max(1, shell.offsetHeight);
        const next = showMondai
          ? Math.min(1, availableW / naturalW)
          : Math.min(1, availableW / naturalW, availableH / naturalH);
        const scaled = Math.max(0.2, Math.min(1, Number(next.toFixed(3))));

        setReportScale((prev) => (Math.abs(prev - scaled) < 0.004 ? prev : scaled));
      });
    };

    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (shellRef.current) observer?.observe(shellRef.current);
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    timer = window.setTimeout(measure, 0);
    measure();

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
    };
  }, [open, d, isTarget, showMondai, viewMode, collapsedGroups]);

  if (!open || !d) return null;

  const jlpt = d.jlpt;
  const bjt = d.bjt;
  const level = d.level;
  const today = formatVnDate(new Date());

  const modalShell = (children: React.ReactNode) => (
    <div
      className="modal-overlay active"
      id="report-modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className={`report-modal-shell${showMondai ? " detail-open" : ""}`}
        ref={shellRef}
        style={{ "--report-scale": reportScale } as React.CSSProperties}
      >
        <style>{REPORT_MODAL_CSS}</style>
        <button
          onClick={onClose}
          className="report-close-button"
          aria-label="Đóng"
        >×</button>
        {children}
      </div>
    </div>
  );

  if (!jlpt) {
    return modalShell(
      <div style={{ padding: "1rem 0" }}>
        <h2 style={{ margin: "0 0 6px 0", fontSize: 18, fontWeight: 600, color: TOKENS.text }}>Báo cáo năng lực</h2>
        <p style={{ margin: 0, fontSize: 13, color: TOKENS.textSec }}>{examName} · {today}</p>
        {bjt && (
          <div style={{ marginTop: 18, padding: 18, border: `1px solid ${TOKENS.border}`, borderRadius: 12, background: TOKENS.bg }}>
            <div style={{ fontSize: 13, color: TOKENS.textSec }}>BJT Score</div>
            <div style={{ fontSize: 32, fontWeight: 600, color: TOKENS.text, marginTop: 4 }}>
              {bjt.score} <span style={{ fontSize: 14, color: TOKENS.textSec }}>/ 800</span>
            </div>
            <div style={{ fontSize: 13, color: TOKENS.textSec, marginTop: 4 }}>
              Hạng <b style={{ color: TOKENS.text }}>{bjt.grade}</b> · {bjt.correct}/{bjt.total} câu đúng
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Target practice → simpler report ───────────────────────────
  if (isTarget) {
    const totalC = Object.values(d.stats).reduce((s, g) => s + (g?.c ?? 0), 0);
    const totalQ = Object.values(d.stats).reduce((s, g) => s + (g?.t ?? 0), 0);
    const wrongQ = Math.max(0, totalQ - totalC);
    const pctTarget = totalQ > 0 ? Math.round((totalC / totalQ) * 100) : 0;
    const animPct = pctTarget * t;
    const animCorrect = Math.round(totalC * t);
    const rTarget = 56;
    const circT = 2 * Math.PI * rTarget;
    const filledT = (Math.min(1, totalC / Math.max(1, totalQ)) * circT * t).toFixed(1);

    return modalShell(
      <div style={{ padding: "0.25rem 0", color: TOKENS.text }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 16 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10, background: TOKENS.primaryBg,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: TOKENS.primary,
          }}>
            <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
              <rect x="2" y="11" width="3.5" height="7" rx="1" />
              <rect x="8.25" y="6" width="3.5" height="12" rx="1" />
              <rect x="14.5" y="2" width="3.5" height="16" rx="1" />
            </svg>
          </div>
          <div>
            <h2 style={{ margin: "0 0 2px 0", fontSize: 17, fontWeight: 600 }}>Báo cáo Target Practice</h2>
            <p style={{ margin: 0, fontSize: 12.5, color: TOKENS.textSec }}>{examName} • {today}</p>
          </div>
        </div>

        {/* Score card */}
        <div style={{
          background: TOKENS.bg,
          border: `1px solid ${TOKENS.border}`,
          borderRadius: 14,
          padding: 22,
          display: "grid",
          gridTemplateColumns: "150px 1fr",
          gap: 22,
          alignItems: "center",
        }}>
          {/* Donut */}
          <div style={{ position: "relative", width: 140, height: 140, justifySelf: "center" }}>
            <svg viewBox="0 0 140 140" width="140" height="140" role="img" aria-label={`${animCorrect} đúng trên ${totalQ}`}>
              <circle cx="70" cy="70" r={rTarget} fill="none" stroke={TOKENS.trackGray} strokeWidth="14" />
              <circle
                cx="70" cy="70" r={rTarget} fill="none"
                stroke={TOKENS.primary} strokeWidth="14"
                strokeLinecap="round"
                strokeDasharray={`${filledT} ${(circT - Number(filledT)).toFixed(1)}`}
                transform="rotate(-90 70 70)"
              />
              <text x="70" y="74" textAnchor="middle" fontSize="32" fontWeight="700" fill={TOKENS.text}>{animCorrect}</text>
              <text x="70" y="92" textAnchor="middle" fontSize="11" fill={TOKENS.textSec}>/ {totalQ}</text>
            </svg>
          </div>

          {/* Stats */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <div style={{ fontSize: 13, color: TOKENS.textSec, marginBottom: 4 }}>Tỉ lệ đúng</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                <span style={{ fontSize: 32, fontWeight: 700, color: TOKENS.primary, lineHeight: 1 }}>{Math.round(animPct)}</span>
                <span style={{ fontSize: 14, color: TOKENS.textSec }}>%</span>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
              <div style={{ background: TOKENS.passBg, color: TOKENS.passText, borderRadius: 10, padding: "10px 12px", textAlign: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{animCorrect}</div>
                <div style={{ fontSize: 11, fontWeight: 600 }}>Đúng</div>
              </div>
              <div style={{ background: TOKENS.failBg, color: TOKENS.failText, borderRadius: 10, padding: "10px 12px", textAlign: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{Math.round(wrongQ * t)}</div>
                <div style={{ fontSize: 11, fontWeight: 600 }}>Sai</div>
              </div>
              <div style={{ background: TOKENS.bg2, color: TOKENS.text, borderRadius: 10, padding: "10px 12px", textAlign: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{totalQ}</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: TOKENS.textSec }}>Tổng câu</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── JLPT main view ─────────────────────────────────────────────
  const score = jlpt.totalScaled;
  const passScore = jlpt.minTotal;
  const max = jlpt.totalMax;
  const passed = jlpt.pass;
  const passPct = Math.min(100, (passScore / max) * 100);
  const scorePct = Math.min(100, (score / max) * 100);
  const shortage = Math.max(0, passScore - score);
  const excess = Math.max(0, score - passScore);

  const animScore = Math.round(score * t);
  const animScorePct = scorePct * t;
  const resultTone = passed
    ? { bg: "#EAF7EF", text: "#238552", fill: "#2A9E5F", soft: "#F0FAF5" }
    : { bg: "#FDEBED", text: "#D93445", fill: "#F4495E", soft: "#FFF4F5" };

  // Build mondai breakdown (grouped)
  const subgroupsOrder: string[] = [];
  const subgroupRows: Record<string, { type: string; m: number; name: string; viLabel: string; c: number; t: number }[]> = {};
  Object.entries(d.stats).forEach(([type, st]) => {
    if (!st || st.t === 0) return;
    const info = TYPE_MONDAI_MAP[type];
    if (!info) return;
    const sub = info.group;
    if (!subgroupRows[sub]) {
      subgroupRows[sub] = [];
      subgroupsOrder.push(sub);
    }
    subgroupRows[sub].push({
      type,
      m: info.mondai,
      name: shortMondai(info.name),
      viLabel: VI_LABELS[type] ?? "",
      c: st.c,
      t: st.t,
    });
  });
  subgroupsOrder.forEach((g) => subgroupRows[g].sort((a, b) => a.m - b.m));

  // Flat view: all rows sorted by mondai number
  const flatRows = subgroupsOrder.flatMap((g) => subgroupRows[g])
    .sort((a, b) => a.m - b.m);

  // Helper: header color of a subgroup (purple if pass, pink if poor)
  function subgroupHeaderTheme(sub: string) {
    const rows = subgroupRows[sub];
    const c = rows.reduce((s, x) => s + x.c, 0);
    const t = rows.reduce((s, x) => s + x.t, 0);
    const pct = t > 0 ? (c / t) * 100 : 0;
    if (pct < 50) return { bg: "#FDE9EB", text: TOKENS.failText };
    return { bg: TOKENS.primaryBg, text: TOKENS.primary };
  }

  function barColor(pct: number, fillColor: string): string {
    return pct < 50 ? TOKENS.warn : fillColor;
  }


  return modalShell(
    <div className="jlpt-report">
      <div className="jlpt-report-header">
        <div className="jlpt-report-heading">
          <div className="jlpt-report-title-icon">
            <svg width="28" height="28" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
              <rect x="2" y="11" width="3.5" height="7" rx="1" />
              <rect x="8.25" y="6" width="3.5" height="12" rx="1" />
              <rect x="14.5" y="2" width="3.5" height="16" rx="1" />
            </svg>
          </div>
          <div>
            <h2 className="jlpt-report-title">Báo cáo năng lực JLPT</h2>
            <p className="jlpt-report-subtitle">{examName} ・ Ngày thi: {today}</p>
          </div>
        </div>
        <span
          className="jlpt-report-status"
          style={{
            "--status-bg": resultTone.bg,
            "--status-text": resultTone.text,
          } as React.CSSProperties}
        >
          <span>{passed ? "Đã đậu" : "Chưa đậu"}</span>
        </span>
      </div>

      <section
        className="simple-report-score-card"
        style={{
          "--score-pct": `${animScorePct}%`,
          "--pass-pct": `${passPct}%`,
        } as React.CSSProperties}
      >
        <div className="simple-score-summary">
          <div className="simple-score-label">Tổng điểm</div>
          <div className="simple-score-line">
            <span className="simple-score-main">{animScore}</span>
            <span className="simple-score-denom">/{max}</span>
          </div>
          <div className="simple-score-warning">
            <span className="simple-warning-icon" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path d="M12 3.5 21 20H3L12 3.5Z" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" />
                <path d="M12 9v5.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <circle cx="12" cy="17.3" r="1.1" fill="currentColor" />
              </svg>
            </span>
            {!passed ? (
              <span>Còn thiếu <strong>{shortage} điểm</strong> để đạt {level}</span>
            ) : (
              <span>Vượt <strong>{excess} điểm</strong> so với mốc đậu {level}</span>
            )}
          </div>
        </div>

        <div className="simple-score-progress-area">
          <p className="simple-pass-title">Mốc đậu {level}: {passScore} điểm</p>
          <div className="simple-score-track">
            <div className="simple-score-fill" />
            <div className="simple-score-pass-marker" />
          </div>
          <div className="simple-score-axis">
            <span className="axis-start">0</span>
            <span className="axis-pass">{passScore}</span>
            <span className="axis-end">{max}</span>
          </div>
        </div>
      </section>

      <section className="simple-section-card">
        <div className="simple-section-header">
          <h3 className="simple-section-title">Kết quả các phần thi</h3>
          <button type="button" className="report-guide-button">
            <span aria-hidden="true" className="report-guide-icon">i</span>
            <span>Hướng dẫn tính điểm</span>
          </button>
        </div>

        <div className="simple-section-rows">
          {jlpt.order.map((sKey) => {
            const s = jlpt.sections[sKey];
            const theme = SECTION_THEME[sKey];
            const lab = SECTION_LABEL[sKey];
            if (!s || !theme || !lab) return null;
            const animScaled = Math.round(s.scaled * t);
            const sectionPct = Math.min(100, (s.scaled / s.max) * 100) * t;
            return (
              <div
                key={sKey}
                className="simple-section-row"
                style={{
                  "--section-icon-bg": theme.bg,
                  "--section-color": theme.text,
                  "--section-pct": `${sectionPct}%`,
                  "--section-badge-bg": s.pass ? TOKENS.passBg : TOKENS.failBg,
                  "--section-badge-text": s.pass ? TOKENS.passText : TOKENS.failText,
                } as React.CSSProperties}
              >
                <div className="simple-section-icon">{theme.icon}</div>
                <div>
                  <p className="simple-section-name">{lab.vi} {lab.sub}</p>
                  <p className="simple-section-desc">{SECTION_DESC[sKey]}</p>
                </div>
                <div className="simple-section-metric">
                  <div className="simple-section-score">{animScaled}<span>/{s.max}</span></div>
                  <div className="simple-section-track">
                    <div className="simple-section-fill" />
                  </div>
                </div>
                <div className="simple-section-badge">{s.pass ? "Đạt" : "Chưa đạt"}</div>
              </div>
            );
          })}
        </div>

        {subgroupsOrder.length > 0 && (
          <button
            type="button"
            onClick={() => setShowMondai((v) => !v)}
            className="simple-detail-toggle"
            aria-expanded={showMondai}
          >
            <span>Xem phân tích chi tiết</span>
            <svg
              className={`simple-detail-arrow${showMondai ? " is-open" : ""}`}
              width="26"
              height="26"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden
            >
              <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </section>

      {subgroupsOrder.length > 0 && (
        <>
          {showMondai && (
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
              <div style={{ display: "inline-flex", background: TOKENS.bg2, borderRadius: 999, padding: 3, gap: 2 }}>
                {(["grouped", "flat"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setViewMode(m)}
                    style={{
                      padding: "5px 14px", borderRadius: 999,
                      background: viewMode === m ? TOKENS.bg : "transparent",
                      color: viewMode === m ? TOKENS.text : TOKENS.textSec,
                      border: "none", cursor: "pointer",
                      fontSize: 12, fontWeight: 600,
                      fontFamily: "'Be Vietnam Pro','Noto Sans JP',sans-serif",
                      boxShadow: viewMode === m ? "0 1px 3px rgba(0,0,0,.08)" : "none",
                    }}
                  >{m === "grouped" ? "≡ Theo phần" : "☷ Theo thứ tự câu"}</button>
                ))}
              </div>
            </div>
          )}
          {showMondai && (
            <div style={{
              background: TOKENS.bg,
              border: `1px solid ${TOKENS.border}`,
              borderRadius: 14,
              overflow: "hidden",
            }}>
              {viewMode === "grouped" ? (
                subgroupsOrder.map((sub) => {
                  const lab = SUBGROUP_LABEL[sub] ?? { vi: sub, romaji: "" };
                  const theme = subgroupHeaderTheme(sub);
                  const rows = subgroupRows[sub];
                  const totalC = rows.reduce((s, r) => s + r.c, 0);
                  const totalT = rows.reduce((s, r) => s + r.t, 0);
                  const collapsed = collapsedGroups[sub];
                  return (
                    <div key={sub}>
                      <button
                        type="button"
                        onClick={() => setCollapsedGroups((g) => ({ ...g, [sub]: !g[sub] }))}
                        style={{
                          width: "100%",
                          background: theme.bg, color: theme.text,
                          padding: "10px 16px",
                          border: "none", cursor: "pointer",
                          display: "flex", alignItems: "center", justifyContent: "space-between",
                          fontSize: 12.5, fontWeight: 600,
                          fontFamily: "'Be Vietnam Pro','Noto Sans JP',sans-serif",
                        }}
                        aria-expanded={!collapsed}
                      >
                        <span>{lab.vi} ({lab.romaji}) • {totalC}/{totalT} câu đúng</span>
                        <span style={{
                          fontSize: 12, transition: "transform .2s",
                          transform: collapsed ? "rotate(0deg)" : "rotate(180deg)",
                        }}>⌃</span>
                      </button>
                      {!collapsed && rows.map((r) => {
                        const pct = r.t > 0 ? Math.round((r.c / r.t) * 100) : 0;
                        const fill = barColor(pct, theme.text === TOKENS.failText ? TOKENS.warn : TOKENS.primary);
                        return (
                          <div key={r.type} style={{
                            padding: "12px 16px",
                            borderBottom: `1px solid ${TOKENS.border}`,
                            display: "grid",
                            gridTemplateColumns: "1fr 80px 130px",
                            gap: 12,
                            alignItems: "center",
                            fontSize: 13,
                          }}>
                            <div>
                              <p style={{ margin: 0, fontWeight: 500 }}>{r.name}</p>
                              {r.viLabel && (
                                <p style={{ margin: 0, fontSize: 11, color: TOKENS.textSec }}>{r.viLabel}</p>
                              )}
                            </div>
                            <div style={{ fontSize: 12, color: TOKENS.textSec }}>{r.c}/{r.t} đúng</div>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <div style={{ flex: 1, height: 6, background: TOKENS.trackGray, borderRadius: 999 }}>
                                <div style={{ height: "100%", width: `${pct}%`, background: fill, borderRadius: 999 }} />
                              </div>
                              <span style={{ fontSize: 11, fontWeight: 600, minWidth: 32, textAlign: "right" }}>{pct}%</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })
              ) : (
                flatRows.map((r) => {
                  const pct = r.t > 0 ? Math.round((r.c / r.t) * 100) : 0;
                  const fill = barColor(pct, TOKENS.primary);
                  return (
                    <div key={r.type} style={{
                      padding: "12px 16px",
                      borderBottom: `1px solid ${TOKENS.border}`,
                      display: "grid",
                      gridTemplateColumns: "1fr 80px 130px",
                      gap: 12,
                      alignItems: "center",
                      fontSize: 13,
                    }}>
                      <div>
                        <p style={{ margin: 0, fontWeight: 500 }}>{r.name}</p>
                        {r.viLabel && (
                          <p style={{ margin: 0, fontSize: 11, color: TOKENS.textSec }}>{r.viLabel}</p>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: TOKENS.textSec }}>{r.c}/{r.t} đúng</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ flex: 1, height: 6, background: TOKENS.trackGray, borderRadius: 999 }}>
                          <div style={{ height: "100%", width: `${pct}%`, background: fill, borderRadius: 999 }} />
                        </div>
                        <span style={{ fontSize: 11, fontWeight: 600, minWidth: 32, textAlign: "right" }}>{pct}%</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </>
      )}

    </div>
  );
}

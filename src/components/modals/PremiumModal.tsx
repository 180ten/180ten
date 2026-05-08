"use client";
import { useState, useEffect } from "react";
import { sb } from "@/lib/supabase";

type PlanId = "free" | "3month" | "1year" | "lifetime";

interface PremiumModalProps {
  open: boolean;
  userEmail?: string;
  onClose: () => void;
}

const PLAN_CODE: Record<Exclude<PlanId, "free">, string> = {
  "3month":   "3m",
  "1year":    "1y",
  "lifetime": "lt",
};

const PLAN_PRICE: Record<Exclude<PlanId, "free">, number> = {
  "3month":   399000,
  "1year":    899000,
  "lifetime": 1890000,
};

/** Robust copy that works in non-secure contexts (custom localhost domains) */
async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch { /* fall through */ }
  }
  // Fallback: textarea + execCommand
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "0";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function CopyButton({ value, onCopied }: { value: string; onCopied?: (label: string) => void }) {
  const [copied, setCopied] = useState(false);
  const disabled = !value || value === "—";
  async function copy(e: React.MouseEvent) {
    e.stopPropagation();
    if (disabled) return;
    const ok = await copyToClipboard(value);
    if (ok) {
      setCopied(true);
      onCopied?.(value);
      setTimeout(() => setCopied(false), 1400);
    }
  }
  return (
    <button
      type="button"
      className={`pv2-copy-btn${copied ? " copied" : ""}`}
      onClick={copy}
      disabled={disabled}
      aria-label={copied ? "Đã sao chép" : "Sao chép"}
      title={copied ? "Đã sao chép" : "Sao chép"}
    >
      {copied ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="9" y="9" width="13" height="13" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}

export default function PremiumModal({ open, userEmail, onClose }: PremiumModalProps) {
  const [selectedPlan, setSelectedPlan] = useState<PlanId | null>(null);
  const [imgPreview, setImgPreview] = useState<string | null>(null);
  const [imgFile, setImgFile] = useState<File | null>(null);
  const [toast, setToast] = useState<{ title: string; sub?: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [qrLoading, setQrLoading] = useState(true);

  useEffect(() => {
    if (selectedPlan && selectedPlan !== "free") setQrLoading(true);
  }, [selectedPlan]);

  if (!open) return null;

  const showToast = (title: string, sub?: string, ms = 1800) => {
    setToast({ title, sub });
    setTimeout(() => setToast(null), ms);
  };

  const username = userEmail ? userEmail.split("@")[0] : "";
  const code = selectedPlan && selectedPlan !== "free" ? PLAN_CODE[selectedPlan] : "";
  const payContent = code && username ? `${code} ${username}` : "—";

  function handleImgChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) {
      showToast("Ảnh quá lớn", "Tối đa 5MB", 2400);
      return;
    }
    setImgFile(f);
    const reader = new FileReader();
    reader.onload = (ev) => setImgPreview(ev.target?.result as string);
    reader.readAsDataURL(f);
  }

  /** Race a promise against a timeout — never hangs forever */
  function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    return Promise.race([
      p,
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timeout sau ${ms}ms`)), ms)),
    ]);
  }

  async function handleSubmitPayment() {
    if (!imgFile || !selectedPlan || selectedPlan === "free" || submitting) return;
    setSubmitting(true);

    let screenshotUrl: string | null = null;
    let userId: string | null = null;

    // Lấy user (timeout 4s) — bắt buộc đăng nhập
    try {
      const r = await withTimeout(sb.auth.getUser(), 4000, "auth.getUser");
      userId = r.data.user?.id ?? null;
    } catch (e) {
      console.warn("[premium] auth.getUser failed:", e);
      setSubmitting(false);
      showToast("Lỗi xác thực", "Vui lòng đăng nhập lại rồi thử lại.", 3500);
      return;
    }
    if (!userId) {
      setSubmitting(false);
      showToast("Cần đăng nhập", "Vui lòng đăng nhập trước khi gửi yêu cầu thanh toán.", 4000);
      return;
    }

    // 1. Upload ảnh bill (timeout 10s)
    try {
      const ext = imgFile.name.split(".").pop() || "jpg";
      const path = `${userId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await withTimeout(
        sb.storage.from("payment-screenshots").upload(path, imgFile, { cacheControl: "3600", upsert: false }),
        10000,
        "storage.upload"
      );
      if (upErr) {
        console.error("[premium] storage upload failed:", upErr.message);
        setSubmitting(false);
        showToast("Lỗi tải ảnh lên", upErr.message, 4000);
        return;
      }
      const { data: pub } = sb.storage.from("payment-screenshots").getPublicUrl(path);
      screenshotUrl = pub.publicUrl;
    } catch (e) {
      const msg = (e as Error).message || "Lỗi không xác định";
      console.error("[premium] storage exception:", msg);
      setSubmitting(false);
      showToast("Lỗi tải ảnh", msg, 4000);
      return;
    }

    // 2. Ghi record vào bảng payment_requests (admin đọc bảng này)
    try {
      const insertPromise: Promise<{ error: { message: string } | null }> = Promise.resolve(
        sb.from("payment_requests").insert({
          user_id: userId,
          email: userEmail ?? null,
          plan: selectedPlan,
          note: payContent,
          screenshot: screenshotUrl,
          status: "pending",
        })
      );
      const { error: insErr } = await withTimeout(insertPromise, 6000, "insert");
      if (insErr) {
        console.error("[premium] insert failed:", insErr.message);
        setSubmitting(false);
        showToast("Lỗi gửi yêu cầu", insErr.message, 4000);
        return;
      }
    } catch (e) {
      const msg = (e as Error).message || "Lỗi không xác định";
      console.error("[premium] insert exception:", msg);
      setSubmitting(false);
      showToast("Lỗi gửi yêu cầu", msg, 4000);
      return;
    }

    setSubmitted(true);
    setSubmitting(false);
    showToast("Đã gửi xác nhận thanh toán!", "Chúng tôi sẽ xử lý trong 5 phút", 3500);
    setTimeout(() => onClose(), 2500);
  }

  return (
    <div className="premium-overlay active" id="premium-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="premium-modal-v2">
        {/* Header */}
        <div className="pv2-header">
          <h2>Nâng cấp tài khoản</h2>
          <p>Mở khóa toàn bộ đề thi và tính năng cao cấp</p>
        </div>

        {/* Plan cards */}
        <div className="pv2-cards">
          {/* Free */}
          <div className={`pv2-card pv2-free${selectedPlan === "free" ? " selected" : ""}`} onClick={() => setSelectedPlan("free")}>
            <div className="pv2-name">Trải nghiệm</div>
            <div className="pv2-price pv2-price-text">Miễn phí</div>
            <div className="pv2-sub">Dành cho người mới bắt đầu</div>
            <div className="pv2-icon-wrap pv2-icon-blue">
              <img src="/svg/gift.svg" alt="" aria-hidden width={36} height={36} />
            </div>
            <ul className="pv2-features">
              <li>25 đề thi</li>
              <li>25 bộ flashcard</li>
              <li>Giải thích tiếng Việt</li>
            </ul>
            <button type="button" className="pv2-btn pv2-btn-current" disabled>Hiện tại</button>
          </div>

          {/* 3 month — gold */}
          <div className={`pv2-card pv2-3m${selectedPlan === "3month" ? " selected" : ""}`} onClick={() => setSelectedPlan("3month")}>
            <div className="pv2-name">3 Tháng</div>
            <div className="pv2-price pv2-price-yellow">399.000<span>đ</span></div>
            <div className="pv2-old-price">649.000đ</div>
            <div className="pv2-sub">Tiết kiệm 38%</div>
            <div className="pv2-icon-wrap pv2-icon-yellow">
              <img src="/svg/gold.svg" alt="" aria-hidden width={36} height={36} />
            </div>
            <ul className="pv2-features">
              <li>Toàn bộ đề thi</li>
              <li>Toàn bộ flashcard</li>
              <li>Linh hoạt, tiết kiệm</li>
            </ul>
            <button type="button" className="pv2-btn pv2-btn-yellow">Chọn gói</button>
          </div>

          {/* 1 year — ruby red */}
          <div className={`pv2-card pv2-1y${selectedPlan === "1year" ? " selected" : ""}`} onClick={() => setSelectedPlan("1year")}>
            <div className="pv2-name">1 Năm</div>
            <div className="pv2-price pv2-price-red">899.000<span>đ</span></div>
            <div className="pv2-old-price">1.250.000đ</div>
            <div className="pv2-sub">Tiết kiệm 28%</div>
            <div className="pv2-icon-wrap pv2-icon-red">
              <img src="/svg/ruby.svg" alt="" aria-hidden width={36} height={36} />
            </div>
            <ul className="pv2-features">
              <li>Toàn bộ đề thi</li>
              <li>Toàn bộ flashcard</li>
              <li>Tính năng tương lai</li>
              <li>Viền đỏ ruby đặc biệt</li>
            </ul>
            <button type="button" className="pv2-btn pv2-btn-red">Chọn gói</button>
          </div>

          {/* Lifetime — diamond blue */}
          <div className={`pv2-card pv2-lt${selectedPlan === "lifetime" ? " selected" : ""}`} onClick={() => setSelectedPlan("lifetime")}>
            <span className="pv2-ribbon">BEST VALUE</span>
            <div className="pv2-name">Trọn đời</div>
            <div className="pv2-price pv2-price-blue">1.890.000<span>đ</span></div>
            <div className="pv2-old-price">3.299.000đ</div>
            <div className="pv2-sub">Trọn đời – Một lần duy nhất</div>
            <div className="pv2-icon-wrap pv2-icon-blue">
              <img src="/svg/diamond.svg" alt="" aria-hidden width={36} height={36} />
            </div>
            <ul className="pv2-features">
              <li>Toàn bộ đề thi</li>
              <li>Toàn bộ flashcard</li>
              <li>Tính năng tương lai</li>
              <li>Viền kim cương lấp lánh</li>
              <li>Trọn đời</li>
            </ul>
            <button type="button" className="pv2-btn pv2-btn-blue">Chọn gói</button>
          </div>
        </div>

        {/* Payment info */}
        <div className="pv2-payment">
          <div className="pv2-payment-title">
            <img src="/svg/payment.svg" alt="" aria-hidden width={20} height={20} />
            THÔNG TIN THANH TOÁN
          </div>
          <div className="pv2-payment-grid">
            <div className="pv2-payment-rows">
              <div className="pv2-pay-row pv2-pay-row-nocopy">
                <span className="pv2-pay-row-icon"><img src="/svg/row-bank.svg" alt="" aria-hidden /></span>
                <span className="pv2-pay-row-label">Ngân hàng</span>
                <span className="pv2-pay-row-value">
                  <img src="/svg/vietinbank.svg" alt="VietinBank" className="pv2-bank-logo" />
                </span>
              </div>
              <div className="pv2-pay-row">
                <span className="pv2-pay-row-icon"><img src="/svg/row-card.svg" alt="" aria-hidden /></span>
                <span className="pv2-pay-row-label">Số tài khoản</span>
                <span className="pv2-pay-row-value pv2-bank-account">0337490177</span>
                <CopyButton value="0337490177" onCopied={(v) => showToast("Đã sao chép", v)} />
              </div>
              <div className="pv2-pay-row">
                <span className="pv2-pay-row-icon"><img src="/svg/row-user.svg" alt="" aria-hidden /></span>
                <span className="pv2-pay-row-label">Chủ tài khoản</span>
                <span className="pv2-pay-row-value pv2-bank-holder">HOÀNG THỊ HIỀN MAI</span>
                <CopyButton value="HOÀNG THỊ HIỀN MAI" onCopied={(v) => showToast("Đã sao chép", v)} />
              </div>
              <div className="pv2-pay-row">
                <span className="pv2-pay-row-icon"><img src="/svg/dong.svg" alt="" aria-hidden /></span>
                <span className="pv2-pay-row-label">Số tiền</span>
                <span className="pv2-pay-row-value pv2-bank-account">
                  {selectedPlan && selectedPlan !== "free"
                    ? `${PLAN_PRICE[selectedPlan].toLocaleString("vi-VN")}đ`
                    : "—"}
                </span>
                {selectedPlan && selectedPlan !== "free" && (
                  <CopyButton value={String(PLAN_PRICE[selectedPlan])} onCopied={(v) => showToast("Đã sao chép", v)} />
                )}
              </div>
              <div className="pv2-pay-row">
                <span className="pv2-pay-row-icon"><img src="/svg/row-doc.svg" alt="" aria-hidden /></span>
                <span className="pv2-pay-row-label">Nội dung chuyển khoản</span>
                <span className="pv2-pay-row-value pv2-bank-content">{payContent}</span>
                <CopyButton value={payContent} onCopied={(v) => showToast("Đã sao chép", v)} />
              </div>
            </div>
            <div
              className="pv2-secure"
              style={
                selectedPlan && selectedPlan !== "free"
                  ? { background: "none", border: "none", padding: 0, minHeight: 0, textAlign: "center" }
                  : { textAlign: "center" }
              }
            >
              {selectedPlan && selectedPlan !== "free" ? (
                <div style={{ position: "relative", width: "100%", maxWidth: 320, margin: "0 auto" }}>
                  {qrLoading && <div className="qr-skeleton" aria-hidden />}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`https://img.vietqr.io/image/970415-0337490177-qr_only.png?amount=${PLAN_PRICE[selectedPlan]}&addInfo=${encodeURIComponent(payContent)}`}
                    alt="VietQR thanh toán"
                    onLoad={() => setQrLoading(false)}
                    onError={() => setQrLoading(false)}
                    style={{
                      display: qrLoading ? "none" : "block",
                      margin: "0 auto",
                      width: "100%",
                      maxWidth: 320,
                      height: "auto",
                      background: "#fff",
                      borderRadius: 8,
                      padding: 6,
                    }}
                  />
                </div>
              ) : (
                <>
                  <div className="pv2-secure-icon">
                    <img src="/svg/qr.svg" alt="" aria-hidden width={48} height={48} />
                  </div>
                  <div className="pv2-secure-head"><strong>Chọn gói để hiển thị QR</strong></div>
                  <p>Sau khi chọn gói, mã VietQR sẽ hiện ở đây để bạn quét và thanh toán nhanh.</p>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Upload section (only shown when paid plan selected) */}
        {selectedPlan && selectedPlan !== "free" && (
          <div className="pv2-upload-wrap">
            <div className="pv2-upload-head">
              <span className="pv2-upload-head-icon">
                <img src="/svg/upload-camera.svg" alt="" aria-hidden width={22} height={22} />
              </span>
              <div>
                <h4>Ảnh xác nhận thanh toán</h4>
                <p>Vui lòng tải lên ảnh bill chuyển khoản để chúng tôi xác nhận và xử lý đơn hàng của bạn.</p>
              </div>
            </div>
            <label className="pv2-upload-zone">
              <input type="file" accept="image/*" onChange={handleImgChange} />
              {!imgPreview ? (
                <>
                  <img src="/svg/upload-illust.svg" alt="" aria-hidden className="pv2-upload-illust" />
                  <div className="pv2-upload-title">Kéo thả ảnh vào đây hoặc click để chọn ảnh</div>
                  <div className="pv2-upload-sub">Hỗ trợ định dạng: JPG, PNG, JPEG (Tối đa 5MB)</div>
                </>
              ) : (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img className="pv2-upload-preview" src={imgPreview} alt="preview" />
              )}
            </label>
            <div className="pv2-upload-trust">
              <div className="pv2-upload-trust-item">
                <img src="/svg/upload-shield.svg" alt="" aria-hidden width={18} height={18} />
                <span>Thông tin được bảo mật tuyệt đối</span>
              </div>
              <div className="pv2-upload-trust-item">
                <img src="/svg/upload-clock.svg" alt="" aria-hidden width={18} height={18} />
                <span>Xử lý nhanh chóng trong 5 phút</span>
              </div>
              <div className="pv2-upload-trust-item">
                <img src="/svg/upload-check.svg" alt="" aria-hidden width={18} height={18} />
                <span>Xác nhận qua email sau khi xử lý</span>
              </div>
            </div>
            <button
              type="button"
              className="pv2-upload-submit"
              disabled={!imgPreview || submitting || submitted}
              onClick={handleSubmitPayment}
            >
              {submitting ? (
                <>
                  <svg width="20" height="20" viewBox="0 0 50 50" aria-hidden style={{ animation: "pv2-spin 0.8s linear infinite" }}>
                    <circle cx="25" cy="25" r="20" fill="none" stroke="rgba(255,255,255,.3)" strokeWidth="5" />
                    <path d="M25 5 a20 20 0 0 1 0 40" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" />
                  </svg>
                  Đang gửi...
                </>
              ) : submitted ? (
                <>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Đã gửi
                </>
              ) : (
                <>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <rect x="2" y="4" width="20" height="16" rx="2" />
                    <path d="m22 7-10 7L2 7" />
                  </svg>
                  Gửi xác nhận thanh toán
                </>
              )}
            </button>
          </div>
        )}

        <button onClick={onClose} className="pv2-close" aria-label="Đóng">×</button>
      </div>

      {toast && (
        <div className="pv2-toast" role="status" aria-live="polite">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span>{toast.title}</span>
          {toast.sub && <span className="pv2-toast-val">{toast.sub}</span>}
        </div>
      )}
    </div>
  );
}

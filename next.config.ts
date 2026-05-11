import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

// ── Security headers ────────────────────────────────────────────────────
// Defense-in-depth on top of the API-route fixes from Bước 1–5.
//
// CSP notes:
//   • 'unsafe-inline' on script-src is required by Next.js for its inline
//     bootstrap chunks. Tighten to nonce-based later (Next 15+ supports it
//     via middleware-set nonce — out of scope for this pass).
//   • 'unsafe-eval' is dev-only (Turbopack HMR needs it). Build fails in
//     prod without 'unsafe-inline' on style-src too because next/font and
//     inline `style={{...}}` props emit inline <style> tags.
//   • media-src needed for the listening-section audio served from R2.
//   • connect-src includes wss://*.supabase.co for realtime channels.
//   • frame-src has only Cloudflare Turnstile (captcha widget).
//
// X-XSS-Protection deliberately omitted — deprecated per MDN/OWASP.
const securityHeaders = [
  { key: "X-Frame-Options",        value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy",        value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy",     value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} https://challenges.cloudflare.com`,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob: https:",
      "media-src 'self' https: blob:",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
      "frame-src https://challenges.cloudflare.com",
      "object-src 'none'",
      "base-uri 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  // Cho phép truy cập dev server qua hostname tuỳ chỉnh
  // (vd: /etc/hosts trỏ 180ten.com → 127.0.0.1) mà không bị
  // Next.js chặn vì cross-origin trong dev mode.
  allowedDevOrigins: ["180ten.com", "180ten.com"],

  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;

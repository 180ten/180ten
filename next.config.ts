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
//
// Cross-origin / isolation headers (HSTS, COOP, COEP, CORP, X-PCDP):
//   • Strict-Transport-Security: 1y + includeSubDomains + preload. Once
//     this is live, downgrading is hard — only set when production has
//     fully migrated to HTTPS (true on Vercel).
//   • COOP "same-origin" can break window.open OAuth popups (Google
//     Sign-In etc). If we wire a popup-based OAuth later, switch to
//     "same-origin-allow-popups".
//   • COEP "require-corp" requires every cross-origin sub-resource to
//     send a Cross-Origin-Resource-Policy header allowing it. R2 audio
//     URLs may need their own CORP header — if the listening-section
//     audio fails to load after deploy, downgrade to "unsafe-none".
const securityHeaders = [
  { key: "X-Frame-Options",                  value: "DENY" },
  { key: "X-Content-Type-Options",           value: "nosniff" },
  { key: "Referrer-Policy",                  value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy",               value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security",        value: "max-age=31536000; includeSubDomains; preload" },
  { key: "Cross-Origin-Opener-Policy",       value: "same-origin" },
  { key: "Cross-Origin-Embedder-Policy",     value: "require-corp" },
  { key: "Cross-Origin-Resource-Policy",     value: "same-origin" },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
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

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cho phép truy cập dev server qua hostname tuỳ chỉnh
  // (vd: /etc/hosts trỏ 180ten.com → 127.0.0.1) mà không bị
  // Next.js chặn vì cross-origin trong dev mode.
  allowedDevOrigins: ["180ten.com", "180ten.com:3000"],
};

export default nextConfig;

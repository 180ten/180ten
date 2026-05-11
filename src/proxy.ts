// src/proxy.ts (Next.js 16 — was middleware.ts; the file convention was
// renamed to "proxy" in 16. See node_modules/next/dist/docs/.../proxy.md.)
//
// Per-IP sliding-window rate limit on all /api/exam/* and /api/admin/*
// requests. Backed by Upstash Redis (HTTP, edge-compatible).
//
// Limits:
//   exam : 15 req / 60 s   — interactive exam flow tolerates short bursts
//   admin: 60 req / 60 s   — admin tabs do bulk-upserts in chunks
//
// Failure mode: if Redis is unreachable we FAIL OPEN (log + allow). The
// alternative — refusing every request when our rate-limit backend is down —
// would be a self-DoS. Operators monitor the [proxy] error log line.
//
// Identity: x-forwarded-for ?? "unknown". On Vercel the first hop is the
// platform proxy, so the leftmost token is the real client IP.

import { NextRequest, NextResponse } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis }     from "@upstash/redis";

const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const limiters = {
  exam:  new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(15, "60 s") }),
  admin: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(60, "60 s") }),
};

export async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;

  // Exempt submit endpoints — these are the user's most important action
  // (saving the exam result), not an abuse-prone surface. Blocking them
  // with 429 cost real submissions in prod when the 15/60s exam limit
  // tripped. Grading is server-side anyway, so abuse here just wastes
  // the attacker's time.
  if (path.startsWith("/api/exam/submit-batch") || path.startsWith("/api/exam/submit-answer")) {
    return NextResponse.next();
  }

  const [limiter, group] =
    path.startsWith("/api/admin") ? [limiters.admin, "admin"] :
    path.startsWith("/api/exam")  ? [limiters.exam,  "exam"]  :
    [null, ""];
  if (!limiter) return NextResponse.next();

  const ip  = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  const key = `${group}:${ip}`;

  try {
    const { success, reset } = await limiter.limit(key);
    if (!success) {
      return new NextResponse("Too Many Requests", {
        status: 429,
        headers: { "Retry-After": String(Math.ceil((reset - Date.now()) / 1000)) },
      });
    }
  } catch (e) {
    console.error("[proxy] rate limit error, failing open:", e);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/exam/:path*", "/api/admin/:path*"],
};

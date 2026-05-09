// src/app/api/admin/revalidate-exam/route.ts
//
// POST /api/admin/revalidate-exam
//
// Body:    { examId: string }
// Headers: Authorization: Bearer <admin JWT>
//
// Invalidates the Next.js data-cache entry tagged `exam-${examId}` so the
// next call to /api/exam/<examId>/start re-fetches questions from Supabase.
// Called automatically by ComposeTab after upserting an exam, and by
// /api/admin/exams after publish/premium/delete actions.

import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { requireAdmin, adminErrorResponse } from "@/lib/supabase-admin";

interface Body {
  examId: string;
}

export async function POST(req: Request) {
  try {
    await requireAdmin(req);
    const body = (await req.json().catch(() => ({}))) as Partial<Body>;
    const examId = body.examId;
    if (!examId || typeof examId !== "string") {
      return NextResponse.json({ error: "examId required" }, { status: 400 });
    }
    revalidateTag(`exam-${examId}`, "max");
    return NextResponse.json({ ok: true, examId });
  } catch (e) {
    return adminErrorResponse(e);
  }
}

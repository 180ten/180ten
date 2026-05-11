-- Exam shuffle-seed sessions.
--
-- Why:
--   The shuffle seed used to grade an exam previously round-tripped through
--   the client (`guest_seed` field). A motivated attacker could loop the
--   submit-batch endpoint with a chosen seed and discover the canonical
--   correct index. Now the seed is generated and stored server-side, looked
--   up at submit time via the user's auth id (or an HttpOnly cookie token).
--
-- Schema:
--   - session_key  is sha256(`${identity}:${exam_id}:${SERVER_SEED_SECRET}`).
--                  We store only the hash; the raw identity stays opaque.
--   - seed         random uuid generated at /start, reused on subsequent
--                  /start hits within expires_at so reloads keep the same
--                  shuffle.
--   - expires_at   4-hour TTL. submit-batch rejects rows past this; cleanup
--                  via a periodic `delete from exam_sessions where
--                  expires_at < now();` cron (or run manually).
--
-- Access:
--   RLS enabled + all write/select revoked from anon + authenticated. Only
--   the service role (used by /api/exam/[id]/start and /api/exam/submit-*)
--   can read or write rows.

create table if not exists public.exam_sessions (
  id          uuid primary key default gen_random_uuid(),
  session_key text unique not null,
  seed        text not null,
  exam_id     uuid not null references public.exams(id) on delete cascade,
  created_at  timestamptz default now(),
  expires_at  timestamptz default (now() + interval '4 hours')
);

alter table public.exam_sessions enable row level security;
revoke all on public.exam_sessions from anon, authenticated;

create index if not exists exam_sessions_expires_at_idx on public.exam_sessions(expires_at);
create index if not exists exam_sessions_exam_id_idx    on public.exam_sessions(exam_id);

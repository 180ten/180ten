-- RPC: aggregate sum of time_spent_sec across all exam_results.
--
-- Used by the home-page hero banner to show "Giờ luyện tập" (total practice
-- hours across all learners). exam_results has owner-only RLS, so a direct
-- anon `select=time_spent_sec.sum()` returns 0. SECURITY DEFINER lets the
-- function read every row safely (it returns a single aggregated number, no
-- per-user data leaks).
--
-- Mirrors the existing get_total_users / get_total_exams RPCs the home page
-- already calls.

create or replace function public.get_total_practice_seconds()
returns bigint
language sql
security definer
set search_path = public
as $$
  select coalesce(sum(time_spent_sec), 0)::bigint
  from public.exam_results;
$$;

revoke all     on function public.get_total_practice_seconds() from public;
grant execute  on function public.get_total_practice_seconds() to anon, authenticated;

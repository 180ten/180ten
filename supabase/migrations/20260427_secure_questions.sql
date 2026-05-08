-- Migration: hide `correct` from non-admin clients.
-- Run in Supabase SQL Editor (or via supabase db push if using CLI).
--
-- Strategy:
--   • Create view `questions_client` that strips the `correct` key from `data`.
--     Uses a recursive helper because nested sub-questions (subQs/passages.questions/etc.)
--     also contain `correct` keys.
--   • Grant SELECT on the view to anon + authenticated.
--   • Revoke direct SELECT on `questions` from anon. (Authenticated still keeps direct
--     access per spec — tighten further in a follow-up by also revoking from authenticated
--     and switching admin reads to service role / RLS-only.)
--   • Add an RLS policy so admins can still SELECT directly when RLS is enabled.

-- ─────────────────────────────────────────────────────────────────────
-- 1) Recursive helper: strip a key from any depth in a jsonb tree
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.jsonb_strip_key(j jsonb, k text)
returns jsonb
language plpgsql
immutable
as $$
declare
  result jsonb;
  ki     text;
  i      int;
begin
  if j is null then
    return null;
  elsif jsonb_typeof(j) = 'object' then
    result := '{}'::jsonb;
    for ki in select * from jsonb_object_keys(j) loop
      if ki <> k then
        result := result || jsonb_build_object(ki, public.jsonb_strip_key(j -> ki, k));
      end if;
    end loop;
    return result;
  elsif jsonb_typeof(j) = 'array' then
    result := '[]'::jsonb;
    for i in 0 .. jsonb_array_length(j) - 1 loop
      result := result || jsonb_build_array(public.jsonb_strip_key(j -> i, k));
    end loop;
    return result;
  else
    return j;
  end if;
end
$$;

grant execute on function public.jsonb_strip_key(jsonb, text) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 2) Sanitised view — drop in `correct` at every depth
-- ─────────────────────────────────────────────────────────────────────
create or replace view public.questions_client as
select
  q.id,
  q.exam_id,
  q.type,
  q.level,
  q.order_index,
  public.jsonb_strip_key(q.data, 'correct') as data,
  q.created_at
from public.questions q;

-- ─────────────────────────────────────────────────────────────────────
-- 3) Permissions
-- ─────────────────────────────────────────────────────────────────────
grant select on public.questions_client to anon, authenticated;

-- Revoke direct read of the underlying table from anon
revoke select on public.questions from anon;

-- ─────────────────────────────────────────────────────────────────────
-- 4) Admins keep direct access (needed by /ad ComposeTab/ExamsTab)
--    Requires public.is_admin(uuid) created in earlier migration.
-- ─────────────────────────────────────────────────────────────────────
alter table public.questions enable row level security;
drop policy if exists "admin can read questions" on public.questions;
create policy "admin can read questions"
on public.questions for select
to authenticated
using (public.is_admin(auth.uid()));

-- Service role bypasses RLS automatically — used by
-- /api/exam/submit-answer to grade answers.

-- Migration: hide user_id (UUIDs) from leaderboard reads.   (vuln-0003)
-- Run in Supabase SQL Editor.
--
-- After this migration:
--   • anon CANNOT read leaderboard_weekly directly (RLS revoke + policy).
--   • authenticated reads only their OWN row directly (own UUID, no leak).
--   • Public top-10 must go through `leaderboard_public` view (no user_id).
--   • Self rank/xp must go through `get_my_weekly_rank()` RPC (no user_id sent).
--   • XP increment must go through `add_my_weekly_xp()` RPC (no user_id sent,
--     and the increment is atomic so concurrent submits don't lose XP).

-- ─────────────────────────────────────────────────────────────────────
-- 1) Public, sanitised view — NO user_id, NO email
-- ─────────────────────────────────────────────────────────────────────
create or replace view public.leaderboard_public as
  select
    coalesce(p.name, '—')                                                   as display_name,
    l.xp,
    l.week_start,
    row_number() over (partition by l.week_start order by l.xp desc)        as rank
  from public.leaderboard_weekly l
  join public.profiles p on l.user_id = p.id;

grant select on public.leaderboard_public to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 2) Lock down the underlying table
-- ─────────────────────────────────────────────────────────────────────
revoke select on public.leaderboard_weekly from anon;
alter table public.leaderboard_weekly enable row level security;

drop policy if exists "users read own leaderboard row"   on public.leaderboard_weekly;
drop policy if exists "users insert own leaderboard row" on public.leaderboard_weekly;
drop policy if exists "users update own leaderboard row" on public.leaderboard_weekly;

create policy "users read own leaderboard row"
on public.leaderboard_weekly for select
to authenticated
using (auth.uid() = user_id);

create policy "users insert own leaderboard row"
on public.leaderboard_weekly for insert
to authenticated
with check (auth.uid() = user_id);

create policy "users update own leaderboard row"
on public.leaderboard_weekly for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────
-- 3) RPC: get my own rank/xp for a given week — no user_id sent
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.get_my_weekly_rank(p_week_start date)
returns table(my_xp int, my_rank int, total int)
language sql
security definer
set search_path = public
stable
as $$
  with wk as (
    select user_id, xp, rank() over (order by xp desc) as rk
    from public.leaderboard_weekly
    where week_start = p_week_start
  )
  select
    coalesce((select xp::int from wk where user_id = auth.uid()), 0)  as my_xp,
    coalesce((select rk::int from wk where user_id = auth.uid()), 0)  as my_rank,
    (select count(*)::int from wk)                                    as total
$$;

grant execute on function public.get_my_weekly_rank(date) to authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 4) RPC: atomically add XP to caller's row for a given week
--    Replaces the previous read-then-upsert pattern (race-prone).
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.add_my_weekly_xp(p_week_start date, p_amount int)
returns int  -- new total xp
language plpgsql
security definer
set search_path = public
as $$
declare
  new_xp int;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if p_amount < 0 then
    raise exception 'amount must be >= 0';
  end if;

  insert into public.leaderboard_weekly (user_id, week_start, xp)
  values (auth.uid(), p_week_start, p_amount)
  on conflict (user_id, week_start)
  do update set xp = public.leaderboard_weekly.xp + excluded.xp
  returning xp into new_xp;

  return new_xp;
end
$$;

grant execute on function public.add_my_weekly_xp(date, int) to authenticated;

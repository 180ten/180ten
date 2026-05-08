-- Migration: harden two privileged RPCs with an admin authorization guard.
-- Run in Supabase SQL Editor.
--
-- Both functions are SECURITY DEFINER (run with the owner's rights, bypassing
-- RLS) so the admin guard at the top of each body is the *only* thing that
-- stops a regular user from invoking them. Without it, any logged-in user
-- could delete other users' accounts or approve their own payment.

-- ─────────────────────────────────────────────────────────────────────
-- 1) delete_user_by_admin(uuid)
--
-- Deletes a user — purges related rows in known FK-dependent tables, then
-- the profile row, then the auth.users row.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.delete_user_by_admin(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  ----------------------------------------------------------------------
  -- Admin authorization (this is THE security boundary)
  ----------------------------------------------------------------------
  if auth.uid() is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  if (select role from public.profiles where id = auth.uid()) != 'admin' then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  -- Defensive: don't let an admin nuke themselves through this RPC
  if target_user_id = auth.uid() then
    raise exception 'Cannot delete your own admin account';
  end if;

  ----------------------------------------------------------------------
  -- Cleanup: remove rows that reference this user (best-effort)
  ----------------------------------------------------------------------
  delete from public.exam_results       where user_id = target_user_id;
  delete from public.payment_requests   where user_id = target_user_id;
  delete from public.leaderboard_weekly where user_id = target_user_id;
  delete from public.anki_card_progress where user_id = target_user_id;
  delete from public.anki_decks         where user_id = target_user_id;
  delete from public.anki_folders       where user_id = target_user_id;
  delete from public.profiles           where id      = target_user_id;

  -- Finally remove from Supabase auth schema
  delete from auth.users                where id      = target_user_id;
end
$$;

revoke all     on function public.delete_user_by_admin(uuid) from public, anon;
grant execute on function public.delete_user_by_admin(uuid) to authenticated;


-- ─────────────────────────────────────────────────────────────────────
-- 2) approve_payment(uuid)
--
-- Approves a pending `payment_requests` row by:
--   • upgrading the requester's plan + expiry on `profiles`,
--   • marking the request as approved with reviewer/timestamp.
--
-- Plan/expiry rules (must match PaymentsTab.tsx):
--   • '1year'   → profile.plan = 'premium', expires = end of day +365
--   • '3month'  → profile.plan = '3month',  expires = end of day +90
--   • 'lifetime'→ profile.plan = 'lifetime', expires = null
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.approve_payment(req_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  req      public.payment_requests%rowtype;
  new_plan text;
  expires  timestamptz;
begin
  ----------------------------------------------------------------------
  -- Admin authorization
  ----------------------------------------------------------------------
  if auth.uid() is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  if (select role from public.profiles where id = auth.uid()) != 'admin' then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  ----------------------------------------------------------------------
  -- Load request
  ----------------------------------------------------------------------
  select * into req from public.payment_requests where id = req_id;
  if not found then
    raise exception 'Payment request not found: %', req_id;
  end if;
  if req.status <> 'pending' then
    raise exception 'Request already %, cannot re-approve', req.status;
  end if;

  ----------------------------------------------------------------------
  -- Compute plan + expiry
  ----------------------------------------------------------------------
  new_plan := case when req.plan = '1year' then 'premium' else req.plan end;
  expires := case
    when req.plan = '1year'   then date_trunc('day', now()) + interval '365 days' + interval '23 hours 59 minutes 59 seconds'
    when req.plan = '3month'  then date_trunc('day', now()) + interval '90 days'  + interval '23 hours 59 minutes 59 seconds'
    else null
  end;

  ----------------------------------------------------------------------
  -- Apply
  ----------------------------------------------------------------------
  update public.profiles
    set plan = new_plan,
        plan_expires_at = expires
    where id = req.user_id;

  update public.payment_requests
    set status      = 'approved',
        reviewed_at = now(),
        reviewed_by = coalesce((select email from auth.users where id = auth.uid()), 'admin')
    where id = req_id;
end
$$;

revoke all     on function public.approve_payment(uuid) from public, anon;
grant execute on function public.approve_payment(uuid) to authenticated;

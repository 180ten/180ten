-- Anti-account-sharing: active session tracking + anomaly events.
--
-- Why:
--   Free plan = 1 simultaneous device. Premium = 2. Logging in on a 3rd
--   device kicks the oldest. /api/session/register handles the bookkeeping
--   server-side (RLS blocks anon writes).
--
--   anomaly_events is a separate audit log for "suspicious" patterns
--   (rapid IP change, timezone jump, UA change). Surfaced to user via
--   email + future admin dashboard.
--
-- Cleanup (manual / cron later):
--   delete from public.user_sessions where last_active < now() - interval '30 days';
--   delete from public.anomaly_events where created_at < now() - interval '90 days';

create table if not exists public.user_sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  device_id    text not null,
  device_name  text,
  ip           text,
  last_active  timestamptz default now(),
  created_at   timestamptz default now()
);

alter table public.user_sessions enable row level security;

drop policy if exists "user reads own sessions" on public.user_sessions;
create policy "user reads own sessions"
  on public.user_sessions for select to authenticated
  using (auth.uid() = user_id);

revoke insert, update, delete on public.user_sessions from anon, authenticated;

create index if not exists user_sessions_user_id_idx     on public.user_sessions(user_id);
create index if not exists user_sessions_device_id_idx   on public.user_sessions(device_id);
create index if not exists user_sessions_last_active_idx on public.user_sessions(last_active);

create table if not exists public.anomaly_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  event_type  text not null,        -- 'ip_change' | 'timezone_change' | 'ua_change' | 'country_change'
  detail      jsonb,
  created_at  timestamptz default now()
);

alter table public.anomaly_events enable row level security;
revoke all on public.anomaly_events from anon, authenticated;

create index if not exists anomaly_events_user_id_idx    on public.anomaly_events(user_id);
create index if not exists anomaly_events_created_at_idx on public.anomaly_events(created_at);

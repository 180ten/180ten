-- Allow every authenticated user (and anon) to SELECT rows on
-- anki_decks / anki_folders that are marked is_admin = true. These are
-- the public template decks an admin uploads via /ad.
--
-- Without this, admin decks were invisible on the user-facing /Anki tab
-- because RLS only let users read rows owned by them.
--
-- Personal user decks remain owner-only; admins keep service-role for
-- mutations through /api/admin/anki.

-- ── anki_decks ──────────────────────────────────────────────
alter table public.anki_decks enable row level security;

drop policy if exists "anyone reads admin decks"     on public.anki_decks;
drop policy if exists "owner reads own decks"        on public.anki_decks;
drop policy if exists "owner writes own decks"       on public.anki_decks;

create policy "anyone reads admin decks"
  on public.anki_decks for select
  to anon, authenticated
  using (is_admin = true);

create policy "owner reads own decks"
  on public.anki_decks for select
  to authenticated
  using (auth.uid() = user_id);

create policy "owner writes own decks"
  on public.anki_decks for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── anki_folders ────────────────────────────────────────────
alter table public.anki_folders enable row level security;

drop policy if exists "anyone reads admin folders"   on public.anki_folders;
drop policy if exists "owner reads own folders"      on public.anki_folders;
drop policy if exists "owner writes own folders"     on public.anki_folders;

create policy "anyone reads admin folders"
  on public.anki_folders for select
  to anon, authenticated
  using (is_admin = true);

create policy "owner reads own folders"
  on public.anki_folders for select
  to authenticated
  using (auth.uid() = user_id);

create policy "owner writes own folders"
  on public.anki_folders for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

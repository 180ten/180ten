-- learned_tags: a small lookup of vocab/grammar surfaces admins have
-- explicitly tagged inside passages so the auto-track step can wrap
-- them automatically next time. Acts as a complement to
-- vocabulary_library + grammar_library — those are the canonical
-- dictionaries; this table just teaches auto-track to recognise
-- additional surface forms (e.g. an inflected variant or an
-- expression a curator has marked once already).
--
-- surface  : the literal text inside the 〖…〗 / 〔…〕 tag.
--            unique — same surface can't be both vocab and grammar.
-- tag_type : 'vocab'   for 〖…〗
--            'grammar' for 〔…〕
--
-- Admin-only. Service role does all reads/writes via /api/admin/
-- learned-tags + the auto-track route; learners never touch this table.

create table if not exists public.learned_tags (
  surface     text primary key,
  tag_type    text not null check (tag_type in ('vocab', 'grammar')),
  created_at  timestamptz not null default now()
);

alter table public.learned_tags enable row level security;
-- No policies declared on purpose — service role bypasses RLS, and
-- nobody else should be reading or writing this table.

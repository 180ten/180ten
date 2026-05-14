-- Add a `variants` array to vocabulary_library so a single canonical
-- entry (vd: 飲む) can be looked up by any conjugated/inflected form
-- the admin lists (飲んで, 飲みます, 飲まない, 飲める, …).
--
-- The lookup path in src/lib/vocabTag.ts first tries `.eq("word", …)`,
-- then falls back to `.contains("variants", [surface])`, so existing
-- rows (variants is an empty default) keep working with the canonical
-- form alone — only entries the admin actually fills the variant list
-- on get the broader matching.
--
-- GIN index makes the `?@>` containment check fast even on the full
-- vocabulary_library table.

alter table public.vocabulary_library
  add column if not exists variants text[] default '{}';

create index if not exists vocabulary_library_variants_idx
  on public.vocabulary_library using gin(variants);

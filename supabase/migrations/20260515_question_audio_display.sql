-- Rich-text rendering for the per-question audio script.
--
-- audio_display: optional HTML produced by the AudioDisplayEditor in
--                ComposeTab. When present, review mode renders this
--                instead of the inline-paragraph fallback assembled
--                from the timestamp rows in `audio_script`. Sanitized
--                with isomorphic-dompurify before insertion into the
--                DOM.
--
-- Independent of `audio_script` so admins can keep the timestamp
-- table for click-to-seek while overriding the visual layout.

alter table public.questions
  add column if not exists audio_display text;

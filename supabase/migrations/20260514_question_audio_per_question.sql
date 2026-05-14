-- Per-question audio override + transcript for listen mondai.
--
-- audio_url:    optional URL of an audio clip specific to this row.
--               Falls back to the existing data.audioUrl (legacy) and
--               then exam.audio_url (one-clip-per-exam) at render time.
--               Used in review mode so each parent listen question can
--               play its own segment.
--
-- audio_script: JSON-stringified array of { start, end, text }
--               (see src/lib/audioScript.ts AudioScriptLine). Hidden
--               while taking the exam; revealed under the audio bar
--               in review with click-to-seek behaviour.
--
-- Both columns are nullable / default empty so existing rows keep
-- working untouched.

alter table public.questions
  add column if not exists audio_url    text,
  add column if not exists audio_script text;

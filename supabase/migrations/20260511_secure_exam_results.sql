-- Secure exam_results: only the service role inserts, deduped by session_key.
--
-- Why:
--   Previously the client (anon/authenticated) inserted into exam_results
--   directly. With seed grading already moved server-side (Bước 3),
--   move the persistence too so a malicious client can't:
--     - inject arbitrary score_pct / report_data
--     - spam multiple rows for the same submission
--
-- Strategy:
--   - Revoke INSERT + UPDATE from anon + authenticated (SELECT remains —
--     owner-RLS already gates it).
--   - Add session_key column = sha256(identity:exam_id:SERVER_SEED_SECRET)
--     (same key used by exam_sessions). Server inserts with this key.
--   - Partial unique index on session_key WHERE NOT NULL: a retry of the
--     same submission gets a 23505 (duplicate key) which submit-batch
--     swallows so the user still sees results. Old rows with NULL key are
--     untouched (the `where` clause excludes them).
--
-- Cleanup of stale exam_sessions:
--   delete from public.exam_sessions where expires_at < now();

revoke insert, update on public.exam_results from anon, authenticated;

alter table public.exam_results
  add column if not exists session_key text;

create unique index if not exists exam_results_session_key_unique
  on public.exam_results(session_key)
  where session_key is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 006_realtime_publications
-- Enable Supabase Realtime on tables used for cross-device active timer sync.
--
-- HOW TO APPLY
-- ─────────────────────────────────────────────────────────────────────────────
-- Supabase Dashboard → SQL Editor → New Query → paste this file → Run
--
-- This is REQUIRED before Realtime cross-device sync will work.
-- Without it, the supabase_realtime publication will not broadcast changes from
-- calendar_days or work_sessions to subscriber channels.
--
-- This script is idempotent — safe to run more than once.
-- ─────────────────────────────────────────────────────────────────────────────

-- Add calendar_days to the Realtime publication.
-- Broadcasts INSERT / UPDATE / DELETE events to subscribers filtered by user_id.
alter publication supabase_realtime add table public.calendar_days;

-- Add work_sessions to the Realtime publication.
-- Broadcasts session open (end_ts = null) and close (end_ts set) events.
alter publication supabase_realtime add table public.work_sessions;


-- ─── Verification ────────────────────────────────────────────────────────────
-- After running, confirm both tables are in the publication:
--
--   select schemaname, tablename
--   from pg_publication_tables
--   where pubname = 'supabase_realtime'
--   and tablename in ('calendar_days', 'work_sessions');
--
-- Expected: 2 rows returned.
-- ─────────────────────────────────────────────────────────────────────────────

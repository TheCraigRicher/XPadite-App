-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 011_journal_folder_color
--
-- Adds a color to each user-created Library folder (hex string — either one
-- of the curated presets or a custom color from the picker). Additive column
-- on the existing journal_folders table from migration 010; no new table,
-- no RLS changes needed (existing policies already cover all columns).
--
-- HOW TO APPLY: same as 002_reminders.sql (Supabase Dashboard SQL Editor,
-- or `supabase db push`). Idempotent — safe to run more than once.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.journal_folders
  add column if not exists color text;

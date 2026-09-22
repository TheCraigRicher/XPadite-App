-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 009_user_custom_colors
--
-- Adds the user's reusable custom-color palette (Activity Manager's Custom
-- Color picker) to the existing per-user preferences row. One row per user
-- already exists here for is_dark/progress_color, so this is a column
-- addition, not a new table.
--
-- Removing a color from this palette must never touch any Activity that
-- already uses that color — Activity.color is stored independently on each
-- activity row and is never derived from this array.
--
-- HOW TO APPLY: same as 002_reminders.sql (Supabase Dashboard SQL Editor,
-- or `supabase db push`). Idempotent — safe to run more than once.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.user_preferences
  add column if not exists custom_colors text[] not null default '{}'::text[];

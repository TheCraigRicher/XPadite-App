-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 012_user_locale_preferences
--
-- Adds the user's Language & Region preference (Settings → Language & Region)
-- to the existing per-user preferences row. One row per user already exists
-- here for is_dark/progress_color/custom_colors, so this is a column
-- addition, not a new table.
--
-- Both columns are NULLABLE, and NULL is a meaningful value, not "unset by
-- accident": NULL means "Automatic" — detect from the browser/device at
-- read time (Intl.DateTimeFormat().resolvedOptions().timeZone for timezone,
-- navigator.language for language) — rather than persisting a device-specific
-- guess as if the user had chosen it. A non-null value means the user
-- explicitly overrode the automatic detection, and that choice is
-- authoritative until they change it again or reset it back to NULL/Automatic.
--
-- `timezone` stores a real IANA identifier (e.g. "America/Vancouver"), the
-- same convention already established for public.reminders.timezone in
-- migration 003 — never a raw UTC offset, since offsets are wrong across
-- daylight-saving transitions and IANA zones already encode those rules.
--
-- This column governs how XPadite PRESENTS and GROUPS existing timestamps
-- (e.g. which local calendar date a session belongs to) — it never rewrites
-- any stored timestamp. Changing it is a read-time/display-time concern only.
--
-- HOW TO APPLY: same as 009_user_custom_colors.sql (Supabase Dashboard SQL
-- Editor, or `supabase db push`). Idempotent — safe to run more than once.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.user_preferences
  add column if not exists language text,
  add column if not exists timezone text;

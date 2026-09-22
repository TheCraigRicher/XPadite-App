-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 008_reminder_notifications_enabled
--
-- Adds a per-reminder mute flag, independent of `is_active`.
--
--   is_active              = "does the user still want this reminder to exist /
--                             is it still pending" (also gates the once-off
--                             email cron in lib/reminder-processor.ts)
--   notifications_enabled  = "should future notifications be delivered for it"
--
-- Turning notifications off must NOT delete the reminder, its history, or
-- change is_active/next_run_at — it only stops future delivery (in-app,
-- browser, sound, and the email cron) until the user turns it back on.
--
-- HOW TO APPLY: same as 002_reminders.sql (Supabase Dashboard SQL Editor,
-- or `supabase db push`). Idempotent — safe to run more than once.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.reminders
  add column if not exists notifications_enabled boolean not null default true;

-- Cron query in lib/reminder-processor.ts filters on notifications_enabled too —
-- extend the existing due-email partial index to match.
drop index if exists reminders_due_email_idx;
create index if not exists reminders_due_email_idx
  on public.reminders (next_run_at)
  where is_active = true and email_enabled = true and notifications_enabled = true;

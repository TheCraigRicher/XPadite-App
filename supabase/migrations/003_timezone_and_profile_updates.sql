-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 003_timezone_and_profile_updates
--
-- 1. Adds a `timezone` column to public.reminders.
--    Stores the IANA timezone (e.g. "America/Vancouver") captured from the
--    browser at the moment the user saves a reminder. The reminder_time
--    ("HH:MM") is always in the user's local timezone; next_run_at is computed
--    by converting that local time to UTC using this column.
--
-- 2. Updates the handle_new_user() trigger so that it also saves full_name
--    from OAuth / signup metadata (Google display name, or the "Name" field
--    from the email signup form).
--
-- 3. Backfills full_name for existing users whose profile row has it NULL.
--
-- HOW TO APPLY
-- ─────────────────────────────────────────────────────────────────────────────
-- Supabase Dashboard → SQL Editor → New Query → paste this file → Run
-- This script is idempotent — safe to run more than once.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. Add timezone column to reminders ─────────────────────────────────────
-- Nullable — existing rows get NULL (treated as "unknown / server fallback").
-- New rows from the updated client always provide an explicit IANA timezone.

alter table public.reminders
  add column if not exists timezone text;


-- ─── 2. Update the new-user trigger to capture full_name ──────────────────────
-- The signup form passes full_name in signUp({ options: { data: { full_name } } })
-- which lands in auth.users.raw_user_meta_data.
-- Google OAuth stores the display name in raw_user_meta_data->>'name'.

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name'
    )
  )
  on conflict (id) do update
    set full_name = coalesce(
      excluded.full_name,
      profiles.full_name
    );
  return new;
end;
$$ language plpgsql security definer;


-- ─── 3. Backfill full_name for existing users ────────────────────────────────
-- One-time update — sets full_name on existing profile rows that have it NULL
-- by reading from auth.users.raw_user_meta_data.

update public.profiles p
set full_name = coalesce(
  u.raw_user_meta_data->>'full_name',
  u.raw_user_meta_data->>'name'
)
from auth.users u
where p.id = u.id
  and p.full_name is null
  and coalesce(
    u.raw_user_meta_data->>'full_name',
    u.raw_user_meta_data->>'name'
  ) is not null;


-- ─── Verification ─────────────────────────────────────────────────────────────
-- Confirm timezone column exists:
--   select column_name, data_type, is_nullable
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'reminders' and column_name = 'timezone';
--
-- Confirm full_name was backfilled:
--   select id, email, full_name from public.profiles limit 10;
-- ─────────────────────────────────────────────────────────────────────────────

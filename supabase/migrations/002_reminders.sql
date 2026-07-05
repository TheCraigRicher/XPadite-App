-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 002_reminders
-- Creates the public.reminders table used by the Xpadite reminder system.
--
-- HOW TO APPLY
-- ─────────────────────────────────────────────────────────────────────────────
-- Option A — Supabase Dashboard (recommended for first-time setup):
--   1. Open your project at https://supabase.com/dashboard
--   2. Go to SQL Editor → New Query
--   3. Paste this entire file and click Run
--
-- Option B — Supabase CLI:
--   supabase db push
--   (requires supabase/config.toml to be set up)
--
-- This script is idempotent — safe to run more than once.
-- ─────────────────────────────────────────────────────────────────────────────


-- ─── Table ───────────────────────────────────────────────────────────────────
--
-- Field names MUST match exactly what the application queries:
--   • lib/reminders.ts          (browser client CRUD)
--   • lib/reminder-processor.ts (server-side cron processor)
--   • AppContext.tsx             (reminder persistence via localStorage + Supabase sync)
--
-- next_run_at / last_sent_at are stored as Unix milliseconds (bigint) because
-- all JavaScript code uses Date.now(). Do NOT change these to timestamptz
-- without updating every query and comparison in the application code.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.reminders (

  -- Identity
  id                           uuid        not null default gen_random_uuid() primary key,
  user_id                      uuid        not null references auth.users(id) on delete cascade,

  -- Task linkage (tasks live in localStorage/calData, identified by id + date)
  task_id                      text        not null,
  date_key                     text        not null,   -- "YYYY-MM-DD" key from CalendarData
  task_text                    text        not null default '',

  -- Schedule settings
  reminder_time                text        not null,   -- "HH:MM" 24-hour local time string
  repeat_frequency             text        not null default 'once'
                                             check (repeat_frequency in ('once','daily','weekly','monthly','yearly')),

  -- Alert preferences
  sound_enabled                boolean     not null default false,
  browser_notification_enabled boolean     not null default false,
  email_enabled                boolean     not null default false,
  email_address                text        not null default '',

  -- Scheduling state (Unix milliseconds, NOT timestamptz)
  next_run_at                  bigint      not null,
  last_sent_at                 bigint,     -- null means never sent

  -- Status
  is_active                    boolean     not null default true,

  -- Audit
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now()

);


-- ─── Indexes ──────────────────────────────────────────────────────────────────

-- Primary cron query: "find all active email reminders that are due"
-- Used by lib/reminder-processor.ts: .eq('is_active',true).eq('email_enabled',true).lte('next_run_at',now)
create index if not exists reminders_due_email_idx
  on public.reminders (next_run_at)
  where is_active = true and email_enabled = true;

-- Frontend query: fetch active reminders for the current user
-- Used by lib/reminders.ts: fetchReminders() → .eq('is_active', true)
create index if not exists reminders_user_active_idx
  on public.reminders (user_id, created_at desc)
  where is_active = true;

-- General user lookup (includes inactive — for edit/history)
create index if not exists reminders_user_idx
  on public.reminders (user_id);


-- ─── updated_at trigger ───────────────────────────────────────────────────────
--
-- Automatically stamps updated_at on every UPDATE so the app never has to
-- manually set it (though the code also sets it explicitly as a safety net).

create or replace function public.handle_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Drop and recreate the trigger so this script stays idempotent
drop trigger if exists reminders_updated_at on public.reminders;

create trigger reminders_updated_at
  before update on public.reminders
  for each row
  execute function public.handle_updated_at();


-- ─── Row Level Security ───────────────────────────────────────────────────────
--
-- Users can only read and write their own reminders.
--
-- The Vercel Cron endpoint (lib/reminder-processor.ts) uses
-- SUPABASE_SERVICE_ROLE_KEY which bypasses RLS automatically — no special
-- policy is required for the service role.

alter table public.reminders enable row level security;

-- Drop existing policies before recreating (keeps the script idempotent)
drop policy if exists "Users manage own reminders"          on public.reminders;
drop policy if exists "users_select_own_reminders"          on public.reminders;
drop policy if exists "users_insert_own_reminders"          on public.reminders;
drop policy if exists "users_update_own_reminders"          on public.reminders;
drop policy if exists "users_delete_own_reminders"          on public.reminders;

-- SELECT: user can read their own rows
create policy "users_select_own_reminders"
  on public.reminders
  for select
  using (auth.uid() = user_id);

-- INSERT: user can create rows only for themselves
create policy "users_insert_own_reminders"
  on public.reminders
  for insert
  with check (auth.uid() = user_id);

-- UPDATE: user can modify their own rows
create policy "users_update_own_reminders"
  on public.reminders
  for update
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- DELETE: user can delete their own rows
create policy "users_delete_own_reminders"
  on public.reminders
  for delete
  using (auth.uid() = user_id);


-- ─── Verification ─────────────────────────────────────────────────────────────
-- After running, confirm with:
--
--   select table_name, row_security
--   from information_schema.tables
--   where table_schema = 'public' and table_name = 'reminders';
--
-- Expected: table_name=reminders, row_security=YES
-- ─────────────────────────────────────────────────────────────────────────────

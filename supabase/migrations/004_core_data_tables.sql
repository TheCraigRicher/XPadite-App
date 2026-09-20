-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 004_core_data_tables
-- Adds durable Supabase-backed tables for core XPadite user data.
--
-- HOW TO APPLY
-- ─────────────────────────────────────────────────────────────────────────────
-- Supabase Dashboard → SQL Editor → New Query → paste this file → Run
-- This script is idempotent — safe to run more than once.
--
-- IMPORTANT: This migration is ADDITIVE ONLY.
-- It does NOT touch existing tables or existing data.
-- Existing localStorage data on user devices is not affected.
-- ─────────────────────────────────────────────────────────────────────────────


-- ─── 1. calendar_days ────────────────────────────────────────────────────────
-- One row per user per date. Stores the full DayData object as JSONB.
-- JSONB preserves the exact existing CalendarData structure without transformation.
-- date_key format: "YYYY-MM-DD" (matches keys in the xp9d localStorage object).

create table if not exists public.calendar_days (
  id         uuid        not null default gen_random_uuid() primary key,
  user_id    uuid        not null references auth.users(id) on delete cascade,
  date_key   text        not null,
  day_data   jsonb       not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, date_key)
);

create index if not exists calendar_days_user_idx
  on public.calendar_days (user_id, date_key desc);

alter table public.calendar_days enable row level security;

drop policy if exists "users_select_own_calendar_days" on public.calendar_days;
drop policy if exists "users_insert_own_calendar_days" on public.calendar_days;
drop policy if exists "users_update_own_calendar_days" on public.calendar_days;
drop policy if exists "users_delete_own_calendar_days" on public.calendar_days;

create policy "users_select_own_calendar_days"
  on public.calendar_days for select
  using (auth.uid() = user_id);

create policy "users_insert_own_calendar_days"
  on public.calendar_days for insert
  with check (auth.uid() = user_id);

create policy "users_update_own_calendar_days"
  on public.calendar_days for update
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "users_delete_own_calendar_days"
  on public.calendar_days for delete
  using (auth.uid() = user_id);

-- updated_at trigger (reuses the function defined in migration 002)
drop trigger if exists calendar_days_updated_at on public.calendar_days;
create trigger calendar_days_updated_at
  before update on public.calendar_days
  for each row execute function public.handle_updated_at();


-- ─── 2. work_sessions ────────────────────────────────────────────────────────
-- One row per activity timer session. Matches the WorkSession type in types.ts.
-- session_id is the app-generated ID (matches the id field in WorkSession).
-- start_ts / end_ts are Unix milliseconds (matches existing JS code).

create table if not exists public.work_sessions (
  id         uuid        not null default gen_random_uuid() primary key,
  user_id    uuid        not null references auth.users(id) on delete cascade,
  session_id text        not null,
  act_id     text        not null,
  act_name   text        not null default '',
  act_color  text        not null default '',
  start_ts   bigint      not null,
  end_ts     bigint,
  date_key   text        not null,
  created_at timestamptz not null default now(),
  unique (user_id, session_id)
);

create index if not exists work_sessions_user_idx
  on public.work_sessions (user_id, start_ts desc);

alter table public.work_sessions enable row level security;

drop policy if exists "users_select_own_work_sessions" on public.work_sessions;
drop policy if exists "users_insert_own_work_sessions" on public.work_sessions;
drop policy if exists "users_update_own_work_sessions" on public.work_sessions;
drop policy if exists "users_delete_own_work_sessions" on public.work_sessions;

create policy "users_select_own_work_sessions"
  on public.work_sessions for select
  using (auth.uid() = user_id);

create policy "users_insert_own_work_sessions"
  on public.work_sessions for insert
  with check (auth.uid() = user_id);

create policy "users_update_own_work_sessions"
  on public.work_sessions for update
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "users_delete_own_work_sessions"
  on public.work_sessions for delete
  using (auth.uid() = user_id);


-- ─── 3. user_activities ──────────────────────────────────────────────────────
-- One row per user-defined activity. Matches the Activity type in types.ts.
-- activity_id is the app-generated ID (matches the id field in Activity).
-- sort_order preserves the user's ordering of activities.

create table if not exists public.user_activities (
  id                        uuid        not null default gen_random_uuid() primary key,
  user_id                   uuid        not null references auth.users(id) on delete cascade,
  activity_id               text        not null,
  name                      text        not null,
  color                     text        not null default '#7c3aed',
  emoji                     text,
  counts_toward_productivity boolean,
  sort_order                int         not null default 0,
  created_at                timestamptz not null default now(),
  unique (user_id, activity_id)
);

create index if not exists user_activities_user_idx
  on public.user_activities (user_id, sort_order asc);

alter table public.user_activities enable row level security;

drop policy if exists "users_select_own_activities" on public.user_activities;
drop policy if exists "users_insert_own_activities" on public.user_activities;
drop policy if exists "users_update_own_activities" on public.user_activities;
drop policy if exists "users_delete_own_activities" on public.user_activities;

create policy "users_select_own_activities"
  on public.user_activities for select
  using (auth.uid() = user_id);

create policy "users_insert_own_activities"
  on public.user_activities for insert
  with check (auth.uid() = user_id);

create policy "users_update_own_activities"
  on public.user_activities for update
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "users_delete_own_activities"
  on public.user_activities for delete
  using (auth.uid() = user_id);


-- ─── 4. user_preferences ────────────────────────────────────────────────────
-- One row per user. Stores theme and progress color preferences.
-- This fixes the bug where isDark was React-state-only (lost on page refresh).

create table if not exists public.user_preferences (
  user_id        uuid        not null references auth.users(id) on delete cascade primary key,
  is_dark        boolean     not null default false,
  progress_color text        not null default '#7c3aed',
  updated_at     timestamptz not null default now()
);

alter table public.user_preferences enable row level security;

drop policy if exists "users_select_own_preferences" on public.user_preferences;
drop policy if exists "users_insert_own_preferences" on public.user_preferences;
drop policy if exists "users_update_own_preferences" on public.user_preferences;

create policy "users_select_own_preferences"
  on public.user_preferences for select
  using (auth.uid() = user_id);

create policy "users_insert_own_preferences"
  on public.user_preferences for insert
  with check (auth.uid() = user_id);

create policy "users_update_own_preferences"
  on public.user_preferences for update
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop trigger if exists user_preferences_updated_at on public.user_preferences;
create trigger user_preferences_updated_at
  before update on public.user_preferences
  for each row execute function public.handle_updated_at();


-- ─── Verification ─────────────────────────────────────────────────────────────
-- After running, confirm all 4 tables exist and have RLS enabled:
--
--   select table_name, row_security
--   from information_schema.tables
--   where table_schema = 'public'
--     and table_name in ('calendar_days','work_sessions','user_activities','user_preferences');
--
-- Expected: all 4 rows with row_security = YES
-- ─────────────────────────────────────────────────────────────────────────────

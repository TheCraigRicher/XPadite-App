-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 022_schedule_events
-- v1.328 — persistent My Schedule events, deadline designation, saved locations.
--
-- HOW TO APPLY (NOT applied automatically — review first)
-- ─────────────────────────────────────────────────────────────────────────────
-- Supabase Dashboard → SQL Editor → New Query → paste this file → Run.
-- Idempotent: safe to run more than once.
--
-- ADDITIVE ONLY. No existing table, column, row or policy is changed or dropped:
--   • one NEW table  public.schedule_events
--   • two NEW nullable/defaulted columns on public.user_preferences
-- Until this is applied the app keeps working (the schedule falls back to its in-memory
-- preview and says saving is unavailable) — nothing else depends on it.
-- ─────────────────────────────────────────────────────────────────────────────


-- ─── 1. schedule_events ──────────────────────────────────────────────────────
-- One row per user-created scheduled event. start_at / end_at are absolute instants
-- (timestamptz), so a device in any timezone shows the same moment; the app converts
-- to local wall-clock time at the edge. An overnight event simply has an end_at on the
-- next calendar day — end_at is the ONE authoritative end (and, for a deadline, the
-- one authoritative due date/time; there is no separate due column to drift).
--
-- is_deadline         the "Set as Due Date" designation (independent of any task priority).
-- task_date_key       "YYYY-MM-DD" of the calendar day that holds this event's linked Task
--                     Manager task (null when there is none). The task itself lives where all
--                     tasks live — inside calendar_days.day_data.tasks — with the stable id
--                     'dl-' || event_id, so the link survives reloads and other devices.

create table if not exists public.schedule_events (
  id            uuid        not null default gen_random_uuid() primary key,
  user_id       uuid        not null references auth.users(id) on delete cascade,
  event_id      text        not null,
  title         text        not null,
  category      text        not null default 'meeting',
  start_at      timestamptz not null,
  end_at        timestamptz not null,
  location      text,
  meeting_url   text,
  notes         text,
  reminder_mins integer,
  recurrence    text        not null default 'none',
  is_deadline   boolean     not null default false,
  task_date_key text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, event_id),
  constraint schedule_events_end_after_start check (end_at > start_at),
  constraint schedule_events_title_len check (char_length(title) between 1 and 200),
  constraint schedule_events_recurrence_ok check (recurrence in ('none','daily','weekly','monthly'))
);

create index if not exists schedule_events_user_start_idx
  on public.schedule_events (user_id, start_at);

-- Fast "all my deadlines" lookup for the Calendar markers.
create index if not exists schedule_events_user_deadline_idx
  on public.schedule_events (user_id, end_at) where is_deadline;

alter table public.schedule_events enable row level security;

drop policy if exists "users_select_own_schedule_events" on public.schedule_events;
drop policy if exists "users_insert_own_schedule_events" on public.schedule_events;
drop policy if exists "users_update_own_schedule_events" on public.schedule_events;
drop policy if exists "users_delete_own_schedule_events" on public.schedule_events;

create policy "users_select_own_schedule_events"
  on public.schedule_events for select
  using (auth.uid() = user_id);

create policy "users_insert_own_schedule_events"
  on public.schedule_events for insert
  with check (auth.uid() = user_id);

create policy "users_update_own_schedule_events"
  on public.schedule_events for update
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "users_delete_own_schedule_events"
  on public.schedule_events for delete
  using (auth.uid() = user_id);

-- updated_at trigger (reuses the function defined in migration 002)
drop trigger if exists schedule_events_updated_at on public.schedule_events;
create trigger schedule_events_updated_at
  before update on public.schedule_events
  for each row execute function public.handle_updated_at();


-- ─── 2. user_preferences: saved locations + custom schedule categories ───────
-- Reuses the existing per-user preferences row (already RLS-protected, one row per user).
-- Both are small JSON arrays owned by that user; no global/shared list exists.

alter table public.user_preferences
  add column if not exists saved_locations jsonb not null default '[]'::jsonb;

alter table public.user_preferences
  add column if not exists schedule_categories jsonb not null default '[]'::jsonb;

-- NOTE: deliberately NOT added to the supabase_realtime publication — events load on
-- sign-in and on window focus, so this migration adds no realtime subscription or egress.

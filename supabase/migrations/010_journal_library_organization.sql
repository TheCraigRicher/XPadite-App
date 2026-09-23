-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 010_journal_library_organization
--
-- Adds user-owned Custom Labels and Custom Folders for the Planner/Journal
-- Library organization upgrade. These are definitions only (id/name/color) —
-- the actual document→label and document→folder relationships are NOT stored
-- here. They live inside the existing per-day JSON blob in
-- calendar_days.day_data.notes (as labelIds[]/folderId, alongside the
-- existing `title` field), so no schema change or migration was needed for
-- that part — it reuses the existing calendar_days architecture exactly.
--
-- Built-in categories (Important/Priority/Reflections/Planning/Goals) are
-- NOT rows here — they're fixed constants in the app, same as `title`s
-- default fallback. Only user-created custom labels/folders need rows.
--
-- HOW TO APPLY
-- ─────────────────────────────────────────────────────────────────────────────
-- Supabase Dashboard → SQL Editor → New Query → paste this file → Run
-- This script is idempotent — safe to run more than once.
--
-- IMPORTANT: This migration is ADDITIVE ONLY.
-- It does NOT touch existing tables or existing data.
-- ─────────────────────────────────────────────────────────────────────────────


-- ─── 1. journal_labels ───────────────────────────────────────────────────────
-- One row per user-created custom label. label_id is the app-generated ID.

create table if not exists public.journal_labels (
  id         uuid        not null default gen_random_uuid() primary key,
  user_id    uuid        not null references auth.users(id) on delete cascade,
  label_id   text        not null,
  name       text        not null,
  color      text        not null default 'purple',
  created_at timestamptz not null default now(),
  unique (user_id, label_id)
);

create index if not exists journal_labels_user_idx
  on public.journal_labels (user_id, created_at asc);

alter table public.journal_labels enable row level security;

drop policy if exists "users_select_own_journal_labels" on public.journal_labels;
drop policy if exists "users_insert_own_journal_labels" on public.journal_labels;
drop policy if exists "users_update_own_journal_labels" on public.journal_labels;
drop policy if exists "users_delete_own_journal_labels" on public.journal_labels;

create policy "users_select_own_journal_labels"
  on public.journal_labels for select
  using (auth.uid() = user_id);

create policy "users_insert_own_journal_labels"
  on public.journal_labels for insert
  with check (auth.uid() = user_id);

create policy "users_update_own_journal_labels"
  on public.journal_labels for update
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "users_delete_own_journal_labels"
  on public.journal_labels for delete
  using (auth.uid() = user_id);


-- ─── 2. journal_folders ──────────────────────────────────────────────────────
-- One row per user-created folder. folder_id is the app-generated ID.
-- Deleting a folder here only removes the folder definition — documents that
-- referenced it keep their own content untouched; the app clears their
-- folderId back to null (no cascade needed since the relationship lives in
-- calendar_days.day_data, not a foreign key).

create table if not exists public.journal_folders (
  id         uuid        not null default gen_random_uuid() primary key,
  user_id    uuid        not null references auth.users(id) on delete cascade,
  folder_id  text        not null,
  name       text        not null,
  created_at timestamptz not null default now(),
  unique (user_id, folder_id)
);

create index if not exists journal_folders_user_idx
  on public.journal_folders (user_id, created_at asc);

alter table public.journal_folders enable row level security;

drop policy if exists "users_select_own_journal_folders" on public.journal_folders;
drop policy if exists "users_insert_own_journal_folders" on public.journal_folders;
drop policy if exists "users_update_own_journal_folders" on public.journal_folders;
drop policy if exists "users_delete_own_journal_folders" on public.journal_folders;

create policy "users_select_own_journal_folders"
  on public.journal_folders for select
  using (auth.uid() = user_id);

create policy "users_insert_own_journal_folders"
  on public.journal_folders for insert
  with check (auth.uid() = user_id);

create policy "users_update_own_journal_folders"
  on public.journal_folders for update
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "users_delete_own_journal_folders"
  on public.journal_folders for delete
  using (auth.uid() = user_id);


-- ─── Verification ─────────────────────────────────────────────────────────────
-- After running, confirm both tables exist and have RLS enabled:
--
--   select table_name, row_security
--   from information_schema.tables
--   where table_schema = 'public'
--     and table_name in ('journal_labels','journal_folders');
--
-- Expected: both rows with row_security = YES
-- ─────────────────────────────────────────────────────────────────────────────

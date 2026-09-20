-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 005_gallery_items
-- Adds gallery_items table and Storage bucket policies for gallery images.
--
-- HOW TO APPLY
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Supabase Dashboard → SQL Editor → New Query → paste this file → Run
-- 2. BEFORE running this SQL, create the Storage bucket manually:
--    Dashboard → Storage → New Bucket
--      Name: gallery
--      Public: OFF (private)
--      File size limit: 10MB
-- This script is idempotent — safe to run more than once.
-- ─────────────────────────────────────────────────────────────────────────────


-- ─── 1. gallery_items ────────────────────────────────────────────────────────
-- One row per gallery item. Stores metadata; the image itself lives in the
-- 'gallery' Storage bucket at path gallery/{user_id}/{item_id}.jpg.
-- Legacy items (from xp9g localStorage, not yet migrated) have no storage_path.

create table if not exists public.gallery_items (
  id           uuid        not null default gen_random_uuid() primary key,
  user_id      uuid        not null references auth.users(id) on delete cascade,
  item_id      text        not null,
  type         text        not null default 'photo',
  title        text        not null default '',
  storage_path text,
  month        int,
  year         int,
  stats        jsonb,
  created_at   timestamptz not null default now(),
  unique (user_id, item_id)
);

create index if not exists gallery_items_user_idx
  on public.gallery_items (user_id, created_at desc);

alter table public.gallery_items enable row level security;

drop policy if exists "users_select_own_gallery_items" on public.gallery_items;
drop policy if exists "users_insert_own_gallery_items" on public.gallery_items;
drop policy if exists "users_update_own_gallery_items" on public.gallery_items;
drop policy if exists "users_delete_own_gallery_items" on public.gallery_items;

create policy "users_select_own_gallery_items"
  on public.gallery_items for select
  using (auth.uid() = user_id);

create policy "users_insert_own_gallery_items"
  on public.gallery_items for insert
  with check (auth.uid() = user_id);

create policy "users_update_own_gallery_items"
  on public.gallery_items for update
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "users_delete_own_gallery_items"
  on public.gallery_items for delete
  using (auth.uid() = user_id);


-- ─── 2. Storage bucket policies (gallery) ───────────────────────────────────
-- These policies assume the 'gallery' bucket already exists (create in Dashboard).
-- Path pattern: gallery/{user_id}/{item_id}.jpg
-- Auth UID is extracted from the first segment of the object path.

drop policy if exists "users_upload_own_gallery" on storage.objects;
drop policy if exists "users_read_own_gallery"   on storage.objects;
drop policy if exists "users_delete_own_gallery" on storage.objects;

create policy "users_upload_own_gallery"
  on storage.objects for insert
  with check (
    bucket_id = 'gallery'
    and auth.uid()::text = (string_to_array(name, '/'))[2]
  );

create policy "users_read_own_gallery"
  on storage.objects for select
  using (
    bucket_id = 'gallery'
    and auth.uid()::text = (string_to_array(name, '/'))[2]
  );

create policy "users_delete_own_gallery"
  on storage.objects for delete
  using (
    bucket_id = 'gallery'
    and auth.uid()::text = (string_to_array(name, '/'))[2]
  );


-- ─── Verification ─────────────────────────────────────────────────────────────
-- After running, confirm the table exists with RLS:
--
--   select table_name, row_security
--   from information_schema.tables
--   where table_schema = 'public' and table_name = 'gallery_items';
--
-- Expected: row_security = YES
-- ─────────────────────────────────────────────────────────────────────────────

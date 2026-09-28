-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 014_support_requests
-- Adds the support_requests table + Storage bucket policies backing the
-- Help & Feedback modal (Get Help / Report Problem / Feedback).
--
-- V1 scope: submit → store safely → notify via Resend → manual reply by
-- XPadite. No admin dashboard, ticket workflow, or update/delete path exists
-- yet, so only SELECT + INSERT policies are created (least privilege — a
-- policy for an operation nothing performs is dead surface, not safety).
--
-- HOW TO APPLY
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. BEFORE running this SQL, create the Storage bucket manually:
--    Dashboard → Storage → New Bucket
--      Name: support-attachments
--      Public: OFF (private)
--      File size limit: 5MB
-- 2. Supabase Dashboard → SQL Editor → New Query → paste this file → Run
-- This script is idempotent — safe to run more than once.
-- ─────────────────────────────────────────────────────────────────────────────


-- ─── 1. support_requests ─────────────────────────────────────────────────────
-- One row per Get Help / Report Problem / Feedback submission. Technical
-- metadata (device/browser/os/app version/current route) is captured
-- automatically server-side at submit time — never typed by the user.
-- attachment_path stores the Storage object path (not a signed URL, which
-- expires); a signed URL is minted on demand when someone needs to view it.

create table if not exists public.support_requests (
  id              uuid        not null default gen_random_uuid() primary key,
  user_id         uuid        not null references auth.users(id) on delete cascade,
  request_type    text        not null check (request_type in ('help', 'problem', 'feedback')),
  category        text,
  subject         text        not null,
  message         text        not null,
  attachment_path text,
  status          text        not null default 'new',
  user_email      text,
  app_version     text,
  device_type     text,
  browser         text,
  os              text,
  current_path    text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists support_requests_user_idx
  on public.support_requests (user_id, created_at desc);

alter table public.support_requests enable row level security;

drop policy if exists "users_select_own_support_requests" on public.support_requests;
drop policy if exists "users_insert_own_support_requests" on public.support_requests;

create policy "users_select_own_support_requests"
  on public.support_requests for select
  using (auth.uid() = user_id);

create policy "users_insert_own_support_requests"
  on public.support_requests for insert
  with check (auth.uid() = user_id);


-- ─── 2. Storage bucket policies (support-attachments) ───────────────────────
-- These policies assume the 'support-attachments' bucket already exists
-- (create in Dashboard). Path pattern: {user_id}/{filename}.
-- Auth UID is extracted from the first segment of the object path.

drop policy if exists "users_upload_own_support_attachments" on storage.objects;
drop policy if exists "users_read_own_support_attachments"   on storage.objects;
drop policy if exists "users_delete_own_support_attachments" on storage.objects;

create policy "users_upload_own_support_attachments"
  on storage.objects for insert
  with check (
    bucket_id = 'support-attachments'
    and auth.uid()::text = (string_to_array(name, '/'))[1]
  );

create policy "users_read_own_support_attachments"
  on storage.objects for select
  using (
    bucket_id = 'support-attachments'
    and auth.uid()::text = (string_to_array(name, '/'))[1]
  );

create policy "users_delete_own_support_attachments"
  on storage.objects for delete
  using (
    bucket_id = 'support-attachments'
    and auth.uid()::text = (string_to_array(name, '/'))[1]
  );


-- ─── Verification ─────────────────────────────────────────────────────────────
-- After running, confirm the table exists with RLS:
--
--   select table_name, row_security
--   from information_schema.tables
--   where table_schema = 'public' and table_name = 'support_requests';
--
-- Expected: row_security = YES
-- ─────────────────────────────────────────────────────────────────────────────

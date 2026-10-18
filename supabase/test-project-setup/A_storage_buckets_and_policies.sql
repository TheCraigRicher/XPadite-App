-- ─────────────────────────────────────────────────────────────────────────────
-- TEST PROJECT ONLY ("xpadite-test") — do NOT run on the production "xpadite" project.
-- Step A of the fresh-database installation (see docs/TEST_DATABASE_SETUP.md).
--
-- Why this file exists: the repository's migrations describe the three Storage buckets
-- only in comments ("create the bucket manually in the Dashboard") and contain NO policies
-- for the `avatars` bucket at all, although the App uses it (ProfileModal.tsx,
-- AppSidebar.tsx, app/api/account/delete/route.ts). On an empty project those must be
-- created explicitly. Everything below is derived from verified App usage:
--
--   avatars              path  {user_id}/avatar.{jpg|png|webp}   private, signed URLs,
--                        upload({ upsert: true }) → needs INSERT + UPDATE + SELECT, remove() → DELETE
--                        limit 5 MB (MAX_BYTES), types jpeg/png/webp (ALLOWED_TYPES)
--   gallery              path  gallery/{user_id}/{item_id}.jpg    private (policies: migration 005)
--                        limit 10 MB (per 005's comment)
--   support-attachments  path  {user_id}/{timestamp}_{rand}.{ext}  private (policies: migration 014)
--                        limit 5 MB, jpeg/png/webp/gif (app/api/support/submit/route.ts)
--
-- All buckets are PRIVATE. Idempotent — safe to run more than once.
-- Run order: any time after the project exists; before testing uploads.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. Buckets ──────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatars',             'avatars',             false,  5242880, array['image/jpeg','image/png','image/webp']),
  ('gallery',             'gallery',             false, 10485760, array['image/jpeg']),
  ('support-attachments', 'support-attachments', false,  5242880, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do nothing;

-- ─── 2. `avatars` policies (the only bucket whose policies are not in a migration) ─
-- Owner-only: the first path segment must equal the caller's user id.
drop policy if exists "users_upload_own_avatar" on storage.objects;
drop policy if exists "users_update_own_avatar" on storage.objects;
drop policy if exists "users_read_own_avatar"   on storage.objects;
drop policy if exists "users_delete_own_avatar" on storage.objects;

create policy "users_upload_own_avatar"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and auth.uid()::text = (string_to_array(name, '/'))[1]);

create policy "users_update_own_avatar"
  on storage.objects for update to authenticated
  using      (bucket_id = 'avatars' and auth.uid()::text = (string_to_array(name, '/'))[1])
  with check (bucket_id = 'avatars' and auth.uid()::text = (string_to_array(name, '/'))[1]);

create policy "users_read_own_avatar"
  on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and auth.uid()::text = (string_to_array(name, '/'))[1]);

create policy "users_delete_own_avatar"
  on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and auth.uid()::text = (string_to_array(name, '/'))[1]);

-- ─── Verification ────────────────────────────────────────────────────────────
--   select id, public, file_size_limit from storage.buckets order by id;
--     → avatars / gallery / support-attachments, all public = false
--   select policyname from pg_policies where schemaname='storage' and tablename='objects' order by 1;
--     → users_*_own_avatar (4), users_*_own_gallery (3), users_*_own_support_attachments (3),
--       plus billing_paywall_gallery_upload once 016 has been applied
-- ─────────────────────────────────────────────────────────────────────────────

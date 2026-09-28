-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 013_profile_display_name
--
-- Adds a genuine, account-level "display_name" column to public.profiles.
--
-- ROOT CAUSE this fixes: Display Name was NEVER actually written to Supabase.
-- ProfileModal.tsx only ever read/wrote `full_name` and `avatar_url` on this
-- table — "Display Name" existed purely as a value cached in each device's
-- own localStorage (xp9-profile). That's why it correctly showed a
-- previously-typed value on the device that saved it, and silently fell back
-- to the first name on every other device: there was no account-level record
-- of it anywhere for another device to read.
--
-- No new table needed — this is the existing per-user `profiles` row, which
-- already has RLS policies scoping SELECT/UPDATE to `auth.uid() = id`
-- (see 001_profiles.sql). A new nullable column doesn't require new policies.
--
-- HOW TO APPLY: Supabase Dashboard → SQL Editor → run this file. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.profiles
  add column if not exists display_name text;

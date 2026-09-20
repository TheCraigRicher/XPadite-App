-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 007_rls_missing_policies
-- Fills RLS policy gaps identified during the Phase 4 security audit.
--
-- HOW TO APPLY
-- ─────────────────────────────────────────────────────────────────────────────
-- Supabase Dashboard → SQL Editor → New Query → paste this file → Run
--
-- Safe to run more than once — each CREATE POLICY is guarded with IF NOT EXISTS.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── user_preferences: add missing DELETE policy ──────────────────────────────
-- The SELECT / INSERT / UPDATE policies existed; DELETE was absent.
-- Without it a user cannot remove their own preference row (e.g., on account deletion).
do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'user_preferences'
      and policyname = 'user_preferences_delete_own'
  ) then
    execute $pol$
      create policy user_preferences_delete_own
        on public.user_preferences
        for delete
        using (auth.uid() = user_id)
    $pol$;
  end if;
end $$;


-- ─── Verification ────────────────────────────────────────────────────────────
-- After running, confirm the DELETE policy exists:
--
--   select policyname, cmd
--   from pg_policies
--   where schemaname = 'public'
--     and tablename  = 'user_preferences';
--
-- Expected: rows for SELECT, INSERT, UPDATE, DELETE.
-- ─────────────────────────────────────────────────────────────────────────────

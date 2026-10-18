-- ─────────────────────────────────────────────────────────────────────────────
-- TEST PROJECT ONLY ("xpadite-test") — do NOT run on the production "xpadite" project.
-- Step B of the fresh-database installation (see docs/TEST_DATABASE_SETUP.md).
-- Run LAST: after migrations 001 → 016 have created every table.
--
-- Why: the new project has "Automatic table exposure" OFF, so tables created by the
-- migrations are NOT reachable through the Data API until privileges are granted
-- explicitly (the migrations contain no GRANTs — the original project relied on
-- Supabase's old default grants). Without this step every App query fails with
-- "permission denied for table …".
--
-- Security model — least privilege, RLS stays the real gatekeeper:
--   * anon              : NOTHING in public (every App table is per-user).
--   * authenticated     : only the operations the App's browser code performs, and RLS
--                         still restricts every row to auth.uid() (and 016 adds the paywall).
--   * billing_*         : authenticated may only SELECT their own rows (existing policies);
--                         NO insert/update/delete — entitlements are server-written only.
--   * billing_config / billing_webhook_events: no API-role access at all.
--   * service_role      : full access (server routes, cron, webhooks).
-- RLS is NOT disabled or relaxed anywhere. Idempotent — safe to run more than once.
-- ─────────────────────────────────────────────────────────────────────────────

grant usage on schema public to anon, authenticated, service_role;

-- Clean slate for the unauthenticated role.
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;

-- ─── authenticated: App data (browser-side reads/writes, always RLS-filtered) ────
grant select, update                 on public.profiles          to authenticated;  -- row is created by the signup trigger
grant select, insert, update, delete on public.calendar_days     to authenticated;
grant select, insert, update, delete on public.work_sessions     to authenticated;
grant select, insert, update, delete on public.user_activities   to authenticated;
grant select, insert, update, delete on public.user_preferences  to authenticated;
grant select, insert, update, delete on public.gallery_items     to authenticated;
grant select, insert, update, delete on public.journal_labels    to authenticated;
grant select, insert, update, delete on public.journal_folders   to authenticated;
grant select, insert, update, delete on public.reminders         to authenticated;
grant select, insert                 on public.support_requests  to authenticated;  -- no update/delete policy exists

-- ─── authenticated: billing (read own rows only) ─────────────────────────────────
grant select on public.billing_customers     to authenticated;
grant select on public.billing_subscriptions to authenticated;
grant select on public.billing_purchases     to authenticated;
revoke all   on public.billing_config, public.billing_webhook_events from authenticated;

-- ─── service_role: server-only operations ───────────────────────────────────────
grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- ─── Verification ────────────────────────────────────────────────────────────────
--   select grantee, table_name, string_agg(privilege_type, ',' order by privilege_type)
--     from information_schema.role_table_grants
--    where table_schema = 'public' and grantee in ('anon','authenticated')
--    group by 1,2 order by 1,2;
--   → no rows for anon; authenticated as listed above; none on billing_config / billing_webhook_events.
--   select tablename, rowsecurity from pg_tables where schemaname = 'public' order by 1;
--   → rowsecurity = true for all 15 tables.
-- ─────────────────────────────────────────────────────────────────────────────

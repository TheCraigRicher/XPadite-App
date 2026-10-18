# XPadite — Test database setup (`xpadite-test`)

Procedure for initialising the **empty, isolated** Supabase project `xpadite-test` (Canada Central) so Stripe test-mode billing can be tested.
Nothing in this file touches the production project `xpadite`. No secrets belong in this file.

**Status: NOT YET PERFORMED.** Every box below is unchecked until you run it and confirm the verification queries.

## What was verified before writing this (repository + isolated rehearsal)

- `supabase/migrations/` contains **001 → 016, no gaps**, in filename order. They apply cleanly, in order, to an empty Postgres (rehearsed in an in-memory
  PGlite database with Supabase-style stubs — **not** against any real Supabase project), and 015/016 re-apply cleanly.
- The migrations alone are **not enough** for an empty project that has *Automatic table exposure* off. Three prerequisites are not in the repository:

| # | Missing from the migrations | Consequence on an empty project | Provided by |
|---|---|---|---|
| 1 | The three Storage **buckets** (only mentioned in comments: "create manually in the Dashboard") | uploads fail: bucket not found | `supabase/test-project-setup/A_storage_buckets_and_policies.sql` |
| 2 | **`avatars` bucket policies** (the App uploads/reads/deletes `{user_id}/avatar.{ext}` with `upsert: true`; no migration defines any policy) | profile photos fail | same file (A) |
| 3 | **Data API grants** — the migrations contain no `GRANT`s; the original project relied on Supabase's old auto-grants | every query fails with `permission denied for table …` | `supabase/test-project-setup/B_data_api_grants.sql` |

- All 15 App tables enable RLS **inside their own migrations**, so "Automatic RLS: off" is safe. Any table added later must also enable RLS explicitly.
- Required extensions: **none**. The `supabase_realtime` publication (used by migration 006) exists on every new project.
- Not represented anywhere in the repo (so not reproducible, and not invented here): the production schema's *actual* state, any hand-made dashboard changes made on `xpadite`,
  seed data, and the Auth settings of `xpadite`.

## Migration inventory and dependencies

| File | Creates | Depends on |
|---|---|---|
| 001_profiles | `profiles`, RLS, `handle_new_user()` + trigger on `auth.users` | `auth.users` |
| 002_reminders | `reminders`, `handle_updated_at()`, RLS | auth |
| 003_timezone_and_profile_updates | `reminders.timezone`; replaces `handle_new_user()` (stores `full_name`) | 001, 002 |
| 004_core_data_tables | `calendar_days`, `work_sessions`, `user_activities`, `user_preferences`, RLS | 002 (`handle_updated_at`) |
| 005_gallery_items | `gallery_items`, RLS, **storage policies for `gallery`** | — (bucket not required to exist) |
| 006_realtime_publications | adds `calendar_days`, `work_sessions` to `supabase_realtime` | 004. **Not re-runnable** (errors if already a member — harmless) |
| 007_rls_missing_policies | `user_preferences` DELETE policy | 004 |
| 008 / 009 / 011 / 012 | extra columns (`reminders.notifications_enabled`, `user_preferences.custom_colors / language / timezone`, `journal_folders.color`) | 002 / 004 / 010 |
| 010_journal_library_organization | `journal_labels`, `journal_folders`, RLS | auth |
| 013_profile_display_name | `profiles.display_name` | 001 |
| 014_support_requests | `support_requests`, RLS, **storage policies for `support-attachments`** | — |
| **015_billing** | `billing_customers`, `billing_subscriptions`, `billing_purchases`, `billing_webhook_events`, RLS, old reserve function | auth |
| **016_billing_corrections** | `billing_config`, `billing_has_access()`, restrictive paywall policies on 7 tables + gallery uploads, `billing_reserve_offer_v2` (ambiguity fix included), `billing_confirm_purchase`, retention FKs (`ON DELETE SET NULL`), price-lock columns | 004, 005, 010, **015**, and the tables in 002/004/005/010 |

Order that works: **001 → 016 in numeric order, then A, then B.** (016 must follow 015; B must be last because it grants on tables the migrations create.)

## Manual setup sequence (Supabase Dashboard → project `xpadite-test`)

> Double-check the project name in the top-left switcher **before every step**. Never run these files on `xpadite`.

### Part 1 — Authentication (do first so signup works)
1. **Authentication → Sign In / Providers → Email**: Enabled; **Confirm email = ON**. Leave Google/Apple/etc. **OFF** (the App has no OAuth handlers yet).
2. **Authentication → URL Configuration**:
   - **Site URL**: `http://localhost:3000`
   - **Redirect URLs**: add `http://localhost:3000/**`. For phone/tablet testing over Wi-Fi also add your PC's address, e.g. `http://192.168.1.50:3000/**`
     (the App sends `emailRedirectTo = <page origin>/auth/callback`; an origin not on this list is rejected).
3. Leave the default email templates and the default SMTP (rate-limited — use a few real mailboxes or plus-addressed aliases such as `you+t1@…` for test users).

### Part 2 — SQL migrations (**SQL Editor → New query**, one file per run, in this order)
For each file: open it in VS Code, copy its entire contents, paste into a *new* query, **Run**. Accept the "destructive operation" confirmation on 016
(it contains `drop policy/function/constraint if exists`; nothing holds data yet).

| Run | File |
|---|---|
| 1–14 | `supabase/migrations/001_profiles.sql` … `014_support_requests.sql` (in numeric order) |
| 15 | `supabase/migrations/015_billing.sql` |
| 16 | `supabase/migrations/016_billing_corrections.sql` |
| 17 | `supabase/test-project-setup/A_storage_buckets_and_policies.sql` (creates the 3 private buckets + `avatars` policies) |
| 18 | `supabase/test-project-setup/B_data_api_grants.sql` (**last**) |

Each should end with "Success. No rows returned". If one fails, **stop and send me the exact error text** — do not skip ahead.

### Part 3 — Data API settings
4. **Project Settings → Data API**: Data API **enabled**; exposed schemas must include **`public`** (nothing else is needed). Leave *Automatic table exposure* and *Automatic RLS* **off** —
   file B grants only what the App needs, and RLS is enabled inside the migrations.
5. **Database → Replication / Publications**: confirm `supabase_realtime` lists `calendar_days` and `work_sessions` (from 006).

### Part 4 — Verification (SQL Editor; each query's expected result is stated)
```sql
-- 1) 15 tables, all with RLS
select count(*) as tables, bool_and(rowsecurity) as all_rls from pg_tables where schemaname='public';        -- 15 | true
-- 2) buckets: 3, all private
select id, public from storage.buckets order by id;                -- avatars / gallery / support-attachments, public = false
-- 3) anon has no access to App tables; billing tables are read-only for users
select grantee, table_name, string_agg(privilege_type, ',' order by privilege_type) as privs
  from information_schema.role_table_grants
 where table_schema='public' and grantee in ('anon','authenticated') group by 1,2 order by 1,2;
--    → no 'anon' rows; billing_customers/subscriptions/purchases = SELECT only; no billing_config / billing_webhook_events rows
-- 4) paywall + billing functions exist
select proname from pg_proc where pronamespace='public'::regnamespace and proname like 'billing_%' order by 1;
--    → billing_confirm_purchase, billing_has_access, billing_reserve_offer_v2   (NOT billing_reserve_offer)
-- 5) 14 paywall policies on tables + the storage one
select count(*) from pg_policies where policyname like 'billing_paywall%';                                      -- 15
-- 6) signup trigger present
select tgname from pg_trigger where tgname='on_auth_user_created';                                              -- 1 row
-- 7) fail-open default: billing_config is empty, so nobody is paywalled yet
select count(*) from public.billing_config;                                                                      -- 0
```
Then **Authentication → Users → Add user** is *not* needed — create test users by signing up in the App (this exercises email confirmation and the profile trigger).
After one signup: `select id, email, full_name from public.profiles;` should show that user.

### Part 5 — Point a local App at the test project **without touching production config**
6. **Project Settings → API**: copy the **Project URL**, the **anon (public)** key and the **service_role** key. Prefer the **Legacy API keys** tab: this App's code was written and
   is used with JWT-style keys; the newer `sb_publishable_…`/`sb_secret_…` keys have **not** been tested with this App.
7. Create a new file `xpadite-app/xpadite-app/.env.development.local` (git-ignored; **do not edit `.env.local`**). `next dev` reads it *before* `.env.local`, so it overrides
   production values for local development only, and deleting the file instantly reverts. `next start` and Vercel never read it.
```
NEXT_PUBLIC_SUPABASE_URL=https://<xpadite-test project ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<test project anon key>
SUPABASE_SERVICE_ROLE_KEY=<test project service_role key>
NEXT_PUBLIC_APP_URL=http://localhost:3000
CRON_SECRET=<any long random string>
# Deliberately NOT set here: RESEND_API_KEY / REMINDER_FROM_EMAIL (no real email from the test project),
# BILLING_LAUNCH_AT (unset = paywall off), all Stripe variables (added in the next stage with sk_test_ keys only).
```
Keep the service-role key out of screenshots, chat and git. Before starting `npm run dev`, confirm the URL in that file is the **test** project's.

## Security and compatibility notes

- **Grants vs RLS**: B grants only the operations the browser code performs; RLS still restricts every row to `auth.uid()`; `anon` gets nothing; users can only `SELECT` billing rows, so no one can
  grant themselves access; `billing_config` and `billing_webhook_events` are service-role only. RLS is not disabled or loosened anywhere.
- **Pre-existing gap (not changed)**: `gallery` has INSERT/SELECT/DELETE policies but **no UPDATE policy** (migration 005), while the App uploads with `upsert: true`. A first upload works; overwriting an
  existing object would be denied. This is how production is defined in the repo; flag it if gallery re-saves misbehave in testing.
- **Pre-existing gap (not changed)**: the 016 gallery paywall policy covers INSERT only; with no UPDATE policy there is nothing to bypass today.
- **Paywall is off by default**: until `billing_config.launch_at` is populated (the App writes it from `BILLING_LAUNCH_AT`), `billing_has_access()` returns true for everyone. Expired-trial tests
  later need a past launch date **in the test environment only**.
- **Rehearsal limits**: the PGlite rehearsal proves SQL logic and privilege behaviour, not Supabase specifics (real Auth service, Storage API, Realtime, SMTP, key types, dashboard-only settings),
  and it is single-connection, so the inventory advisory lock has not been exercised under true parallel load.
- **Default SMTP** is heavily rate-limited; confirmation emails may be delayed. Custom SMTP can be configured later if needed.
- **Never** copy production rows, users, or keys into this project.

## Next stages (not part of this document)
Stripe test-mode prices/webhook/portal (needs `sk_test_…` keys) → end-to-end test scenarios → production launch (requires your explicit authorisation).

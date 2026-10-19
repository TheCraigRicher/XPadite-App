# XPadite — Production migration runbook (billing prerequisites + billing)

**STATUS: PREPARED — NOT EXECUTED. Do not run anything until the owner gives explicit approval to start.**
Target: the **production** Supabase project (`zbnzaitowprrbmlzcejd`). Nothing in this file touches the test project `xpadite-test`.
No secrets belong in this file. Stripe LIVE billing and the paywall are **not** activated by anything below.

> **Revision (2026-10-18, after the 015 hardening review):** `015_billing.sql` now sets table privileges itself (section 5b) and its reservation function was corrected;
> `016_billing_corrections.sql` gained a `billing_config` privilege revoke, a one-allocation-per-customer guard in `billing_reserve_offer_v2`, and a duplicate-allocation guard in
> `billing_confirm_purchase`. The two SHA-256 values below were updated accordingly. The Step 8 hardening SQL remains valid and is now an idempotent safety net.
>
> **Revision 2 (privacy guard):** `billing_has_access()` (016) now only answers for the caller's own user id — an authenticated user can no longer ask whether _another_ user has
> paid access. The service role and direct database sessions (SQL Editor) are unaffected, so the Step 7 check below still works as written. Only the 016 hash changed
> (`16d8301a…ee5fb`); 015 is unchanged (`842b43e3…f1a5bd`). Execution order, rollback SQL and function signatures are unchanged.

## 0. Basis (confirmed from the owner's diagnostics, 2026-10-18)

| Fact                                                                                                                                                                                                                                                              | Evidence                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Production has exactly 7 public tables, all with RLS on                                                                                                                                                                                                           | D1                                                                                                |
| Migrations **001–008 and 013 are already effectively applied** (profiles incl. `display_name`; reminders incl. `timezone`, `notifications_enabled`; core tables; gallery; Realtime publication; `user_preferences` delete policy; signup + `updated_at` triggers) | columns, policies, indexes, triggers, publication                                                 |
| **Not applied:** 009, 010, 011, 012, 014, 015, 016                                                                                                                                                                                                                | `user_preferences` lacks `custom_colors/language/timezone`; no journal, support or billing tables |
| No `billing*` tables exist                                                                                                                                                                                                                                        | D2                                                                                                |
| Buckets `avatars` (private, 5 MB, jpeg/png/webp) and `gallery` (private) exist; **`support-attachments` does not**                                                                                                                                                | D5                                                                                                |
| 19 Storage objects, 1,884,286 bytes (avatars 1 / 459,060; gallery 18 / 1,425,226)                                                                                                                                                                                 | D6                                                                                                |
| One user (`email` provider, confirmed)                                                                                                                                                                                                                            | D7                                                                                                |
| Postgres 17 (default ACL shows the MAINTAIN privilege)                                                                                                                                                                                                            | default privileges                                                                                |
| `supabase_migrations.schema_migrations` does not exist                                                                                                                                                                                                            | D-history                                                                                         |
| Owner has: CSV exports of all 7 tables, all 19 Storage files, Supabase Pro scheduled backups (latest 2026-10-18 07:47 UTC)                                                                                                                                        | owner statement                                                                                   |

**Not run (do not run) on production:** `001`–`008`, `013`, `supabase/test-project-setup/A_*.sql`, `B_*.sql`, and never `supabase db push / reset / repair`
(no migration history exists, so those tools would try to replay everything and fail on 001).

**Still unknown (not blocking):** the bodies of `handle_new_user()` / `handle_updated_at()` — no step below modifies either. Save them for reference:

```sql
select proname, pg_get_functiondef(oid) from pg_proc
where pronamespace='public'::regnamespace and proname in ('handle_new_user','handle_updated_at') order by 1;
```

## 1. Pre-flight (all must be true before Step 0)

- [ ] Using the SQL Editor on the **production** project (check the project name in the top-left switcher).
- [ ] Nobody is using XPadite during the window (it has one user). Do not deploy app code during the window.
- [ ] Re-run the fingerprint query (section 5, query V1) **now** and confirm it still matches the baseline table in section 5. If it does not, stop — data changed since the diagnostics; re-baseline first.
- [ ] Verify each migration file is the reviewed one (SHA-256, PowerShell, run in `xpadite-app/xpadite-app/supabase/migrations`):

  ```powershell
  Get-FileHash -Algorithm SHA256 009_user_custom_colors.sql, 010_journal_library_organization.sql, 011_journal_folder_color.sql, 012_user_locale_preferences.sql, 014_support_requests.sql, 015_billing.sql, 016_billing_corrections.sql | Format-Table Hash, Path
  ```

  | File                                 | Expected SHA-256                                                   |
  | ------------------------------------ | ------------------------------------------------------------------ |
  | 009_user_custom_colors.sql           | `b351140d2e3a39c3c0a661eb0a78b74c5b97adfe6742d5ecffabeb5d4b6cbc0d` |
  | 010_journal_library_organization.sql | `9a736bbeec94e39f77bd1c68a777c256881e0f0a20068b2371f0c49cf61c39ff` |
  | 011_journal_folder_color.sql         | `2a99f169ebd61ed069a33912018ac621d05f37dd3cf621ff681f670add7be2b5` |
  | 012_user_locale_preferences.sql      | `3ff4e34a9676052b70d4b319cb2387c111533442c8ad764eedc5aaec992c3ee1` |
  | 014_support_requests.sql             | `b29371516aed1c1d10dec5fba487fda7813f4984a73db00406e58d9cbe52709c` |
  | 015_billing.sql                      | `842b43e3cfb772d7a7a62224e048c3c251389e17abf736d5892145e9c5f1a5bd` |
  | 016_billing_corrections.sql          | `16d8301a336b462ee5ebe5c7761c9dbf62ddab3990d25d116e158fa5118ee5fb` |

  If any hash differs, **stop** and have the file re-reviewed.

- [ ] `BILLING_LAUNCH_AT` is unset everywhere. No Stripe LIVE keys are configured. (Applying 016 is a no-op for access while `billing_config` is empty.)

## 2. Execution order

Rules: **one file per SQL Editor run**; paste the file's full contents unchanged; accept the "destructive operation" prompt on 016 (it only drops billing objects
it creates itself). Every file below is idempotent (`IF NOT EXISTS` / `DROP … IF EXISTS`), so re-running the _same_ file after fixing a cause is safe. Execution within a run
is not guaranteed to be a single transaction — after any error, use the step's check query to see what applied, and **stop and send the exact error text** before continuing.

| Step  | Action                                                                                                                                                                              | What it does                                                                                                                                                                                                                                                                   | Touches existing data?                                                                                                                             |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0** | Dashboard → Storage → **New bucket**: name `support-attachments` (exactly), **Public: OFF**, file size limit **5 MB**, allowed types `image/jpeg, image/png, image/webp, image/gif` | Creates the bucket 014's policies and the support form use                                                                                                                                                                                                                     | No                                                                                                                                                 |
| **1** | `009_user_custom_colors.sql`                                                                                                                                                        | `user_preferences.custom_colors text[] NOT NULL DEFAULT '{}'`                                                                                                                                                                                                                  | Adds a column only (existing row gets `{}`; no `updated_at` change)                                                                                |
| **2** | `010_journal_library_organization.sql`                                                                                                                                              | Creates `journal_labels`, `journal_folders`, RLS + 8 owner policies                                                                                                                                                                                                            | New tables only                                                                                                                                    |
| **3** | `011_journal_folder_color.sql`                                                                                                                                                      | `journal_folders.color`                                                                                                                                                                                                                                                        | New table only                                                                                                                                     |
| **4** | `012_user_locale_preferences.sql`                                                                                                                                                   | `user_preferences.language`, `.timezone` (nullable)                                                                                                                                                                                                                            | Adds columns only                                                                                                                                  |
| **5** | `014_support_requests.sql`                                                                                                                                                          | Creates `support_requests` + RLS + 2 policies, 3 `support-attachments` storage policies                                                                                                                                                                                        | New table / new policies                                                                                                                           |
| **6** | `015_billing.sql`                                                                                                                                                                   | `billing_customers`, `billing_subscriptions`, `billing_purchases`, `billing_webhook_events`, RLS, 3 select-own policies, `billing_reserve_offer` (replaced in Step 7)                                                                                                          | New tables/functions only                                                                                                                          |
| **7** | `016_billing_corrections.sql`                                                                                                                                                       | `billing_config`; reshapes only the (empty) billing tables; `billing_has_access`, `billing_reserve_offer_v2`, `billing_confirm_purchase`; 14 restrictive `billing_paywall_*` write policies on the 7 productivity tables + 1 on gallery uploads; drops `billing_reserve_offer` | Adds **restrictive policies** to existing tables. Inert while `billing_config` is empty (function returns true). Existing policies/rows unchanged. |
| **8** | Hardening SQL (section 3)                                                                                                                                                           | Removes default over-grants from the new billing tables/functions                                                                                                                                                                                                              | New objects only                                                                                                                                   |
| **9** | Section 5 verification                                                                                                                                                              | Proves nothing existing changed                                                                                                                                                                                                                                                | Read-only                                                                                                                                          |

**After each of Steps 1–7 run its check (section 4) before starting the next step.**

## 3. Billing permissions hardening SQL (Step 8 — run after 016)

Why: production's default privileges grant `anon` and `authenticated` ALL rights on every new table (`arwdDxtm`), including TRUNCATE, which RLS does not govern. This
reduces the new billing tables to least privilege. The browser never queries billing tables (only server routes using the service role do). Existing tables, project-wide
default privileges, and 010/014 tables (which match the existing tables' pattern) are intentionally **not** changed.

```sql
-- Server-only tables: no API-role access at all (service_role only)
revoke all on public.billing_config, public.billing_webhook_events from anon, authenticated;

-- User-readable tables: own rows via RLS, SELECT only, nothing for anon
revoke all on public.billing_customers, public.billing_subscriptions, public.billing_purchases from anon, authenticated;
grant select on public.billing_customers, public.billing_subscriptions, public.billing_purchases to authenticated;

-- service_role keeps full access (webhooks, checkout, status, account deletion)
grant all on public.billing_config, public.billing_webhook_events, public.billing_customers,
             public.billing_subscriptions, public.billing_purchases to service_role;
```

Function privileges need no further change: 015/016 already `REVOKE … FROM public, anon, authenticated` on the reserve/confirm functions and grant `EXECUTE` to
`service_role`; `billing_has_access` is revoked from `public, anon` and executable by `authenticated, service_role` (required — RLS policies call it).

## 4. Per-step checks (read-only)

```sql
-- After Step 0 (Dashboard) — bucket exists, private
select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'support-attachments';   -- 1 row, public = false

-- After Step 1
select column_name, data_type, column_default from information_schema.columns
where table_schema='public' and table_name='user_preferences' order by ordinal_position;          -- + custom_colors text[] default '{}'

-- After Step 2
select relname, relrowsecurity from pg_class where relnamespace='public'::regnamespace and relname in ('journal_labels','journal_folders');  -- both true
select tablename, count(*) from pg_policies where schemaname='public' and tablename in ('journal_labels','journal_folders') group by 1;      -- 4 each

-- After Step 3
select column_name from information_schema.columns where table_schema='public' and table_name='journal_folders' and column_name='color';   -- 1 row

-- After Step 4
select column_name from information_schema.columns where table_schema='public' and table_name='user_preferences' and column_name in ('language','timezone');  -- 2 rows

-- After Step 5
select relname, relrowsecurity from pg_class where relnamespace='public'::regnamespace and relname='support_requests';                     -- true
select policyname, cmd from pg_policies where tablename='support_requests' or policyname like 'users_%_own_support_attachments' order by 1;   -- 5 rows

-- After Step 6
select relname, relrowsecurity from pg_class where relnamespace='public'::regnamespace and relname like 'billing%' order by 1;            -- 4 rows, all true
select policyname from pg_policies where tablename like 'billing%' order by 1;                                                            -- 3 select-own policies
select proname from pg_proc where pronamespace='public'::regnamespace and proname like 'billing%';                                       -- billing_reserve_offer

-- After Step 7
select proname, pg_get_function_identity_arguments(oid) from pg_proc where pronamespace='public'::regnamespace and proname like 'billing%' order by 1;
--   billing_confirm_purchase(p_session_id text, p_user_id uuid, p_plan_key text, p_price_id text, p_payment_intent text, p_amount integer, p_currency text, p_cap integer, p_access_expires timestamp with time zone, p_final_status text)
--   billing_has_access(p_user uuid)
--   billing_reserve_offer_v2(p_user_id uuid, p_plan_key text, p_price_id text, p_cap integer, p_hold_mins integer)
--   (billing_reserve_offer must be GONE)
select count(*) as paywall_policies from pg_policies where policyname like 'billing_paywall%';                                            -- 15
select count(*) as billing_config_rows from public.billing_config;                                                                        -- 0  (paywall inactive)
select public.billing_has_access((select id from auth.users limit 1)) as has_access_while_unconfigured;                                   -- true (SQL Editor = direct session, allowed for any id)
select conname, confdeltype from pg_constraint where conname in ('billing_purchases_user_id_fkey','billing_subscriptions_user_id_fkey');   -- confdeltype = 'n' (SET NULL)
select indexname from pg_indexes where indexname = 'billing_purchases_one_pending_idx';                                                   -- 1 row

-- After Step 8 (hardening)
select grantee, table_name, string_agg(privilege_type, ',' order by privilege_type) as privs
from information_schema.role_table_grants
where table_schema='public' and table_name like 'billing%' and grantee in ('anon','authenticated','service_role') group by 1,2 order by 2,1;
--   anon: no rows | authenticated: SELECT on billing_customers/subscriptions/purchases only | service_role: all five tables
select has_function_privilege('anon', 'public.billing_has_access(uuid)', 'EXECUTE')          as anon_has_access_fn,        -- false
       has_function_privilege('authenticated', 'public.billing_has_access(uuid)', 'EXECUTE') as auth_has_access_fn,        -- true
       has_function_privilege('authenticated', 'public.billing_confirm_purchase(text,uuid,text,text,text,integer,text,integer,timestamptz,text)', 'EXECUTE') as auth_confirm,   -- false
       has_function_privilege('authenticated', 'public.billing_reserve_offer_v2(uuid,text,text,integer,integer)', 'EXECUTE') as auth_reserve,                                    -- false
       has_function_privilege('service_role',  'public.billing_confirm_purchase(text,uuid,text,text,text,integer,text,integer,timestamptz,text)', 'EXECUTE') as svc_confirm;   -- true
```

## 5. Final verification — nothing existing changed (Step 9)

**V1 — data fingerprints.** Expected output must match this baseline _exactly_ (recorded 2026-10-18 before migration):

| t                | count | md5                                |
| ---------------- | ----- | ---------------------------------- |
| calendar_days    | 65    | `b78ca515435f6e751838ed4316cd1759` |
| gallery_items    | 18    | `1ec478c774f2cc0455436a63138f0f88` |
| profiles         | 1     | `bd2c578747d0c69e93a201b046a416de` |
| reminders        | 19    | `e6a3f29c6a086e7cd3322415bb3571fa` |
| user_activities  | 9     | `d5b552e0b42aca0b29bd0178ffb2cdf9` |
| user_preferences | 1     | `9c129d36249a18f7607b5d44872f2223` |
| work_sessions    | 97    | `5570ac4a372e253d3ca28134865f3703` |

```sql
select 'calendar_days' t, count(*), md5(coalesce(string_agg(j,'|' order by j),'')) from (select to_jsonb(x)::text j from public.calendar_days x) s
union all select 'gallery_items', count(*), md5(coalesce(string_agg(j,'|' order by j),'')) from (select to_jsonb(x)::text j from public.gallery_items x) s
union all select 'profiles', count(*), md5(coalesce(string_agg(j,'|' order by j),'')) from (select to_jsonb(x)::text j from public.profiles x) s
union all select 'reminders', count(*), md5(coalesce(string_agg(j,'|' order by j),'')) from (select to_jsonb(x)::text j from public.reminders x) s
union all select 'user_activities', count(*), md5(coalesce(string_agg(j,'|' order by j),'')) from (select to_jsonb(x)::text j from public.user_activities x) s
union all select 'user_preferences', count(*), md5(coalesce(string_agg(j,'|' order by j),'')) from (select (to_jsonb(x) - 'custom_colors' - 'language' - 'timezone')::text j from public.user_preferences x) s
union all select 'work_sessions', count(*), md5(coalesce(string_agg(j,'|' order by j),'')) from (select to_jsonb(x)::text j from public.work_sessions x) s;
```

**V2 — Storage unchanged** (expect 2 buckets with files: avatars 1 / 459060, gallery 18 / 1425226 — total 19 / 1884286):

```sql
select bucket_id, count(*), sum((metadata->>'size')::bigint) as bytes from storage.objects group by 1 order by 1;
```

**V3 — existing policies, functions, triggers intact:**

```sql
-- original permissive policies on the 7 tables: expect 26 (+ the 15 new RESTRICTIVE ones are separate)
select count(*) as original_table_policies from pg_policies
where schemaname='public' and permissive='PERMISSIVE'
  and tablename in ('calendar_days','gallery_items','profiles','reminders','user_activities','user_preferences','work_sessions');          -- 26
-- original avatars + gallery storage policies: expect 7
select count(*) as original_storage_policies from pg_policies where schemaname='storage' and tablename='objects'
  and policyname in ('Read own avatar 1oj01fe_0','Users can delete own avatar','Users can update own avatar','Users can upload own avatar 1oj01fe_0',
                     'users_delete_own_gallery','users_read_own_gallery','users_upload_own_gallery');                                        -- 7
select proname from pg_proc where pronamespace='public'::regnamespace and proname in ('handle_new_user','handle_updated_at') order by 1;     -- both
select tgname from pg_trigger where not tgisinternal and tgname in ('on_auth_user_created','reminders_updated_at','calendar_days_updated_at','user_preferences_updated_at') order by 1;   -- 4
select relname, relrowsecurity from pg_class where relnamespace='public'::regnamespace and relkind='r' order by 1;                         -- 15 tables (7 original + 2 journal + support_requests + 5 billing), all true
select count(*) as users from auth.users;                                                                                                  -- 1
```

**V4 — App smoke test (owner, after V1–V3 pass):** sign in on the deployed app, open the calendar, a journal, Settings and Help; confirm existing data is visible and a change saves.
The app code that uses the new tables should be deployed **after** this runbook completes, with `BILLING_LAUNCH_AT` unset and no Stripe LIVE keys.

## 6. Rollback

Decide first: **additions in Steps 1–5 are harmless and the app already expects them — leave them in place** unless they themselves cause a problem. Rolling back the billing
layer (Steps 6–8) is safe only while the billing tables hold no real data (before launch). Order matters: 016 first, then 015.

**R0 — must return 0/0/0/0 before dropping anything**

```sql
select (select count(*) from public.billing_purchases) p, (select count(*) from public.billing_subscriptions) s,
       (select count(*) from public.billing_customers) c, (select count(*) from public.billing_webhook_events) e;
```

**R1 — undo Step 7 (016)** (signatures verified against `016_billing_corrections.sql` lines 90, 172, 224):

```sql
drop policy if exists billing_paywall_gallery_upload on storage.objects;
do $$ declare t text; begin
  foreach t in array array['calendar_days','work_sessions','user_activities','gallery_items','journal_labels','journal_folders','reminders'] loop
    execute format('drop policy if exists billing_paywall_insert on public.%I', t);
    execute format('drop policy if exists billing_paywall_update on public.%I', t);
  end loop; end $$;
drop function if exists public.billing_confirm_purchase(text, uuid, text, text, text, integer, text, integer, timestamptz, text);
drop function if exists public.billing_reserve_offer_v2(uuid, text, text, integer, integer);
drop function if exists public.billing_has_access(uuid);
drop table if exists public.billing_config;
```

**R2 — undo Step 6 (015) and 016's column additions** (those columns live on these tables; the old function signature is from `015_billing.sql` line 109):

```sql
drop table if exists public.billing_webhook_events, public.billing_purchases, public.billing_subscriptions, public.billing_customers;
drop function if exists public.billing_reserve_offer(uuid, text, text, integer, integer);   -- absent after 016; harmless if re-run
```

**R3 — verify the rollback:** V1 (identical fingerprints), V2, V3 (the original-policy counts of 26 and 7, functions and triggers), and
`select count(*) from pg_tables where schemaname='public' and tablename like 'billing%'` → 0.

**Not recommended unless a specific problem requires it, and only when empty/unused:**
`drop table public.support_requests` (+ its 3 `support-attachments` storage policies), `drop table public.journal_folders, public.journal_labels`,
`alter table public.user_preferences drop column custom_colors / language / timezone`, `alter table public.journal_folders drop column color`, and deleting the
`support-attachments` bucket in the Dashboard. Dropping the `user_preferences` columns destroys any value saved in them since Step 1/4.

**If a problem appears after billing launch (real billing rows exist): do NOT run R1/R2.** Set `BILLING_PAYWALL_DISABLED=true` in the app environment (opens access immediately;
the next billing sync writes `paywall_disabled=true` to the database), then fix forward.

**Last resort — full restore** from the scheduled backup (Dashboard → Database → Backups): replaces the whole database with its state at backup time (latest 2026-10-18 07:47 UTC),
causes downtime and **loses everything saved after that time**; Storage files are not restored (use the downloaded copies if any are missing).

## 7. Stop conditions

Stop and report (do not continue) if: a file hash differs · any SQL returns an error · a check returns a value other than expected · V1 differs by even one row/hash ·
Storage counts change · an existing policy/function/trigger is missing · anything touches `profiles`, `handle_new_user`, or `auth.users` unexpectedly.

## 8. Execution log (fill in when approved and run)

| Step                     | Date/time (UTC) | Result (OK / error text) | Check passed? |
| ------------------------ | --------------- | ------------------------ | ------------- |
| Pre-flight (V1 + hashes) |                 |                          |               |
| 0 bucket                 |                 |                          |               |
| 1 — 009                  |                 |                          |               |
| 2 — 010                  |                 |                          |               |
| 3 — 011                  |                 |                          |               |
| 4 — 012                  |                 |                          |               |
| 5 — 014                  |                 |                          |               |
| 6 — 015                  |                 |                          |               |
| 7 — 016                  |                 |                          |               |
| 8 — hardening            |                 |                          |               |
| 9 — V1–V3                |                 |                          |               |

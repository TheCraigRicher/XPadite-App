# v1.329 — My Schedule backend: Supabase validation (migrations 022 + 023 + 024)

**Status:** migrations 022, 023 and 024 were applied to the Production project (`xpadite`, ref `zbnzaitowprrbmlzcejd`, ca-central-1) by the founder through the SQL Editor
(each returned "Success. No rows returned"; 022 and the 024 objects were checked afterwards). **Never re-run 023 after 024** (023 holds the older versions of the functions);
if you ever need to re-run something, re-run 024. The two validation scripts below have been corrected and tested locally, but **have not been run against hosted Supabase yet**.
No secrets belong in this file.

| Migration | Adds |
|---|---|
| `022_schedule_events.sql` | `schedule_events` table (RLS), `user_preferences.saved_locations / schedule_categories` |
| `023_schedule_sync.sql` | event `rev` + `task_link`, atomic `schedule_apply`, `schedule_set_task_link`, privileges + paywall policies for `schedule_events` |
| `024_schedule_task_sync.sql` | `calendar_days.rev` (server-owned revision trigger), compare-and-swap `calendar_day_save`, `user_preferences.schedule_task_sync` (default OFF) + `schedule_set_sync`, `schedule_apply` v2 (`ev-` tasks, conversions, sub-task carrying) |

## The two validation scripts (Supabase SQL Editor)

| Query name | File | What it proves |
|---|---|---|
| **Production Validation 023 — My Schedule (Rollback)** | `023_schedule_validation.sql` | RLS + invoker functions + no anon/TRUNCATE; atomic event+task write; idempotent repeat; stale revision refused; user B cannot read/update/delete/insert-as/take over A; anon and user-less calls refused; event+task deleted together; **paywall refuses an expired account** (when billing currently denies a 40-day-old account) |
| **Production Validation 024 — Task Sync and CAS (Rollback)** | `024_schedule_task_sync_validation.sql` | server-owned `calendar_days.rev`; compare-and-swap (stale write refused, current doc returned, identical retry harmless); legacy writers still advance the revision; B cannot touch A's days/preference; sync preference defaults OFF and is per-user; ordinary → deadline task conversion keeps work; only `dl-`/`ev-` ids can be touched; anon refused |

### Why they are safe to run on Production (changed in v1.329)
* **They no longer pick existing accounts.** They create three synthetic identities *inside the statement* (random uuids, `@invalid.example` addresses). No mail is sent: the database does
  not send mail (GoTrue does, and it is not involved). The founder's account is never selected, read for its data, or modified.
* **One statement, no transaction to leave open.** Each file is a single `DO` block with no `BEGIN`/`COMMIT`/`ROLLBACK`. It **always ends by raising an error** — `XV001 "VALIDATION PASSED"`
  on success, `P0001 "CHECK … FAILED"` on failure — so the database always discards it. A half-selected run, a dropped connection or a failed check cannot leave anything open or committed.
* **No non-transactional side effects:** no DDL, no temp objects, no sequences (ids are random uuids), no `NOTIFY`/webhook, all role/JWT settings are transaction-local, Realtime publishes only
  committed changes.
* **Existing data is fingerprinted** (md5 over every row of `calendar_days`, `user_preferences`, `schedule_events` and a count of `auth.users`/`profiles`, excluding the synthetic accounts) at the start and
  the end; any difference fails the run.
* RLS is **really** exercised: the script switches to `authenticated` / `anon` (`SET LOCAL ROLE` + JWT claims) exactly as PostgREST does, instead of running as the editor's privileged role.
* The Production **billing policies are not touched, weakened or bypassed**. The synthetic accounts have access through the normal 10-minute "new account" grace; one separate expired synthetic
  account proves the paywall still blocks writes.

### How to run (one at a time, in this order)
1. **Read-only pre-check** (new query, run it first):
   ```sql
   select
     (select count(*) from auth.users)                                              as users,
     (select count(*) from public.calendar_days where date_key like '2099-%')        as rows_2099,
     (select count(*) from public.schedule_events)                                   as events,
     (select coalesce(string_agg(tgname, ', '), '(none besides the app trigger)')
        from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal) as triggers_on_auth_users,
     (select coalesce(string_agg(tgname, ', '), '(none)')
        from pg_trigger where tgrelid = 'public.profiles'::regclass and not tgisinternal) as triggers_on_profiles;
   ```
   Expect `rows_2099 = 0` and `events = 0`. **Read `triggers_on_auth_users`:** it should list only `on_auth_user_created` (the app's own profile trigger). If it lists anything else (a webhook / `pg_net` /
   dashboard-created trigger), STOP and ask the developer: a synthetic user insert would fire it inside the statement.
2. New query **Production Validation 023 — My Schedule (Rollback)** → paste the whole file → Run once (select nothing).
3. New query **Production Validation 024 — Task Sync and CAS (Rollback)** → same.
4. Run the pre-check again: `rows_2099`, `events` and `users` must be unchanged.

### Reading the result
| You see | Meaning |
|---|---|
| `ERROR: XV001 … VALIDATION PASSED - everything was rolled back, nothing was kept. Checks: 1 ok; 2 ok; …` | **Success.** (An error is used on purpose so nothing can be committed.) `6 skipped` means billing currently grants every account access — fine. |
| `ERROR: P0001 … CHECK nX FAILED: …` | A genuine failure. Nothing was kept. Send the whole message to the developer. |
| `permission denied` / `violates row-level security` at the very first insert into `auth.users` | The editor's role may not insert into `auth.users` here. Nothing was kept; send the message. |
| any other error | Nothing was kept; send the message. |

## What has and has not been verified
| Layer | How | Result |
|---|---|---|
| Migrations 022–024 + the real billing functions/policies (015, 016, 021), RLS, privileges, atomic + CAS functions, two-user isolation, stale-write protocol | **Real PostgreSQL engine** (PGlite) running the *actual migration files* 001→024 — `tests/schedule/scheduleSql.test.cjs` | pass |
| **Both corrected validation scripts** on a production-equivalent database (billing paywall ON, a "founder" with real-looking data on the same 2099 dates / event id, hosted-style `auth.users`, the real `handle_new_user` trigger): pass, leave every table byte-identical, leave no open transaction, run twice, run with only one real account, and **fail** on seeded defects — `tests/schedule/scheduleValidationScripts.test.cjs` | PGlite | pass |
| TypeScript reference semantics vs the real SQL function | ~550 generated scenarios compared | identical |
| The app in real Chrome against a fake Supabase backed by that same engine | Browser harness | see the v1.329 report |
| **Real Supabase** (PostgREST argument handling, hosted default privileges, GoTrue/JWT, realtime, dashboard-made triggers, the actual `auth.users` column set) | **Not performed.** The corrected scripts have never been run on hosted Supabase; the `auth.users` insert in particular is proven only against a Postgres model of that table. | **pending the founder** |

## Concurrency: what is and is not protected
* **Protected:** every write made by this version of the app — Task Manager, Planner/Journal, Clock-In, My Schedule (all funnel through one writer). A write names the revision it was based on; if the
  day moved on the server refuses it, the app merges three ways, and only asks when the *same field of the same task* changed differently (or delete vs edit). Nothing is saved for that day until the
  user chooses; a discarded version is kept on the device.
* **Not protectable until old app versions are gone:** older builds (and any browser tab still running one) write with a plain upsert that carries no revision. Their writes cannot be refused — but they
  do advance the revision, so every up-to-date device notices and merges on top. Closing the gap later needs a separate `SECURITY DEFINER` rework + `revoke insert, update on calendar_days from authenticated`
  (own security review; it would lock out any device that has not updated). Manual SQL-editor edits and the service role are likewise unprotected.

## Rollback
The app can be rolled back at any time (older versions ignore the new objects). The database changes are additive; if ever required, in order:
`drop function public.schedule_set_sync(boolean); drop function public.calendar_day_save(text,jsonb,integer); drop trigger calendar_days_bump_rev on public.calendar_days; drop function public.calendar_days_bump_rev();`
then (only to revert the atomic writes too) the 023 functions, and — only if confirmed empty/unwanted — `drop table public.schedule_events;`. Leave the new columns in place.

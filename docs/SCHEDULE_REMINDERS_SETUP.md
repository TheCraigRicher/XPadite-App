# My Schedule reminders — production setup (v1.356)

Deploying the code changes nothing by itself. Until the steps below are done, reminders appear only inside the open app (with the XPadite
chime) and the server job reports `not_configured` and sends nothing. **Do the steps in this order.** Every step can be undone (see "Undo").

## Step 0 — Deploy v1.356 (code only)
Nothing to configure. After deploy, My Schedule → ⋮ → **Reminders & sound** exists but says background reminders are "not switched on for
this XPadite yet" — that is the expected state until Steps 1–5.

## Step 1 — Check the Supabase extensions (read-only)
Supabase dashboard → your XPadite project → **Database → Extensions**: search `pg_cron` and `pg_net` and confirm both are listed
(you will enable them in Step 4). Or in **SQL Editor** run this read-only query — expect two rows:

```sql
select name, default_version from pg_available_extensions where name in ('pg_cron', 'pg_net');
```

If either is missing, stop and tell Claude — the scheduler design would need to change.

## Step 2 — Apply migration 027 (Supabase → SQL Editor)
1. **SQL Editor → New query.** Paste the entire contents of `supabase/migrations/027_schedule_reminders_push.sql`. Click **Run**.
   It is additive and idempotent (safe to run twice). It creates `push_subscriptions`, `reminder_deliveries`, one service-role-only function
   and three indexes. It changes no existing table, column or policy. It was validated on a real PostgreSQL engine (PGlite) — see
   `tests/schedule/scheduleSql027.test.cjs`.
2. Verify (read-only), all three must match:

```sql
-- expect: both rows, row_security = YES
select table_name, row_security from information_schema.tables
 where table_schema = 'public' and table_name in ('push_subscriptions','reminder_deliveries');

-- expect: 0  (no browser-facing policy at all)
select count(*) from pg_policies where tablename in ('push_subscriptions','reminder_deliveries');

-- expect: zero rows for anon / authenticated (no privileges on either table or the function)
select grantee, table_name, privilege_type from information_schema.role_table_grants
 where table_schema = 'public' and table_name in ('push_subscriptions','reminder_deliveries') and grantee in ('anon','authenticated');
```

## Step 3 — Vercel environment variables (Production)
Vercel dashboard → the **XPadite project → Settings → Environment Variables → Add**. Environment: **Production** (Preview optional). Add:

| Name | Value | Sensitive? |
|---|---|---|
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | the public key from `xpadite-vapid-keys-v1356.txt` | public by design |
| `VAPID_PRIVATE_KEY` | the private key from the same file | **yes — mark Sensitive** |
| `VAPID_SUBJECT` | `mailto:` + your contact email (e.g. `mailto:you@yourdomain.com`) | no |
| `CRON_SECRET` | a new long random string (generate below). Vercel's own daily cron automatically sends this variable too, so changing it is safe | **yes — mark Sensitive** |

`SUPABASE_SERVICE_ROLE_KEY` and the Supabase URL already exist (billing uses them) — leave them.

Generate a secret (PowerShell): `-join ((48..57 + 65..90 + 97..122) | Get-Random -Count 40 | ForEach-Object { [char]$_ })`

Then **Deployments → latest Production deployment → ⋯ → Redeploy** (variables are read at build/start; `NEXT_PUBLIC_…` only at build).
Confirm afterwards: open XPadite → My Schedule → ⋮ → Reminders & sound — the "not switched on" message should be gone and **Enable reminders**
should appear.

## Step 4 — Enable the extensions and store the secret (Supabase)
**Database → Extensions →** enable `pg_cron` and `pg_net` (or run `create extension if not exists pg_cron; create extension if not exists pg_net;`).
Then **SQL Editor** — store the SAME `CRON_SECRET` value in the Vault (replace the placeholder text only):

```sql
select vault.create_secret('PASTE-THE-SAME-CRON_SECRET-VALUE-HERE', 'xpadite_cron_secret');
```

## Step 5 — Turn the scheduler on (Supabase SQL Editor) — this is the live switch
Replace `YOUR-PRODUCTION-DOMAIN` (the site the app is served from, e.g. `x-padite-app.vercel.app` or your custom domain):

```sql
select cron.schedule(
  'xpadite-schedule-reminders',
  '* * * * *',
  $$
  select net.http_post(
    url     := 'https://YOUR-PRODUCTION-DOMAIN/api/schedule-reminders/run',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'xpadite_cron_secret')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
  $$
);
```

Verify (read-only), a minute or two later:

```sql
select jobname, schedule, active from cron.job where jobname = 'xpadite-schedule-reminders';                -- active = true
select status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;       -- status = succeeded
select status_code, left(content::text, 120) from net._http_response order by created desc limit 5;         -- 200, {"ok":true,...}
```

A `401` means the Vault secret differs from the Vercel `CRON_SECRET`; `503 not_configured` means the Vercel variables / redeploy (Step 3) are not in place.

## Step 6 — Controlled test (your own account only)
1. On each device: My Schedule → ⋮ → **Reminders & sound** → **Enable reminders** → allow notifications.
   (iPhone / iPad: first Share → Add to Home Screen, then open XPadite from the Home Screen.)
2. **Send test notification** — a system notification must appear (this proves the push path and the device settings).
3. **Test Reminder Sound** — the XPadite chime (this only proves in-app sound, not closed-app notifications).
4. Create an event 8 minutes from now with a **5 minutes before** reminder, close XPadite fully, and wait. Expect a notification at about T−5.
   Tap it: XPadite opens on that event.
5. Repeat with a custom reminder, with XPadite open (alert + chime, no second system notification), and on your phone with the screen locked.

## Undo / stop
- Stop the scheduler instantly: `select cron.unschedule('xpadite-schedule-reminders');`
- Turn a device off: Reminders & sound → **Turn off on this device**.
- Remove everything: `drop table public.reminder_deliveries; drop table public.push_subscriptions; drop function public.schedule_reminder_candidates(timestamptz, timestamptz); drop index if exists public.schedule_events_reminder_idx;` (nothing else depends on them).

## Operations notes
- **Cost:** no new service. About 43,000 short HTTP calls a month and a few tiny queries per call. Push delivery itself is free. Vercel Hobby allows
  1,000,000 function invocations a month and 300 s per function; Supabase documents pg_cron / pg_net with no extra charge beyond normal database use.
- **Timing/retries:** the job looks back 30 minutes for new reminders, retries a failed device (90 s apart, up to 4 attempts) while the reminder is under
  2 hours old and the event has not started more than 5 minutes ago, and never sends an edited or deleted event's old reminder.
- **Delivery states** are in `reminder_deliveries` (`sent` = the push service accepted it; it cannot prove the phone displayed it). Dead devices
  (browser data cleared, app uninstalled) are removed automatically when the push service answers 404/410.
- **Limits:** pg_net allows about 200 requests/s and keeps responses 6 hours (the table stays tiny at one call a minute); Supabase recommends no more
  than 8 cron jobs running at once.
- **Vercel plan note:** Vercel's Hobby terms restrict the plan to personal / non-commercial use. This is unrelated to reminders but worth a separate review.

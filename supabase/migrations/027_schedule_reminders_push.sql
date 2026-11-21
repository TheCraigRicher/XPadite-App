-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 027_schedule_reminders_push
-- v1.356 — My Schedule event reminders delivered as Web Push (works with XPadite closed).
--
-- HOW TO APPLY (NOT applied automatically — review first)
--   Supabase Dashboard → SQL Editor → New Query → paste this file → Run.   Idempotent: safe to run more than once.
--
-- ADDITIVE ONLY: two NEW tables, one NEW function, one NEW partial index. No existing table, column, row, policy or function is changed.
--   • until it is applied the app keeps working: reminders still pop up in the open app; the server job reports "not ready" and sends nothing.
--
-- SECURITY MODEL
--   • push_subscriptions and reminder_deliveries have RLS ENABLED and NO policies: the browser (anon / authenticated roles) can neither read nor
--     write them. A push subscription (endpoint + keys) is a capability to notify a device, so it is only ever touched by the server, which uses
--     the service role and takes the user id from a verified session. Users manage their devices through /api/push/* only.
--   • the candidates function is SECURITY DEFINER and executable by the service role only.
-- ─────────────────────────────────────────────────────────────────────────────


-- ─── 1. push_subscriptions: one row per browser/device that turned reminders on ────────────────
create table if not exists public.push_subscriptions (
  id            uuid        not null default gen_random_uuid() primary key,
  user_id       uuid        not null references auth.users(id) on delete cascade,
  endpoint      text        not null,
  p256dh        text        not null,
  auth          text        not null,
  user_agent    text,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  constraint push_subscriptions_endpoint_len check (char_length(endpoint) between 20 and 2048),
  constraint push_subscriptions_keys_len     check (char_length(p256dh) between 20 and 200 and char_length(auth) between 8 and 100)
);

-- An endpoint belongs to exactly one account at a time (a shared browser that signs in as someone else re-claims it; see /api/push/subscribe).
create unique index if not exists push_subscriptions_endpoint_key on public.push_subscriptions (endpoint);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;


-- ─── 2. reminder_deliveries: the idempotency + retry ledger ────────────────────────────────────
--   pending = claimed, attempt in flight   sent = the push service ACCEPTED it   failed = retry on a later run   gone = subscription removed
--   expired = no longer worth sending (event deleted / edited / already started / too old) — never retried
create table if not exists public.reminder_deliveries (
  id              uuid        not null default gen_random_uuid() primary key,
  user_id         uuid        not null references auth.users(id) on delete cascade,
  event_id        text        not null,
  occurrence_at   timestamptz not null,
  subscription_id uuid        not null references public.push_subscriptions(id) on delete cascade,
  status          text        not null default 'pending' check (status in ('pending','sent','failed','gone','expired')),
  attempts        integer     not null default 1 check (attempts between 1 and 20),
  claimed_at      timestamptz not null default now(),
  accepted_at     timestamptz,
  last_error      text,
  created_at      timestamptz not null default now(),
  -- the same event occurrence is never delivered twice to the same device
  unique (user_id, event_id, occurrence_at, subscription_id),
  -- deleting an event removes its delivery history (schedule_events has unique (user_id, event_id), migration 022)
  foreign key (user_id, event_id) references public.schedule_events (user_id, event_id) on delete cascade
);

create index if not exists reminder_deliveries_created_idx on public.reminder_deliveries (created_at);
-- the retry pass looks only at unfinished deliveries
create index if not exists reminder_deliveries_unfinished_idx on public.reminder_deliveries (created_at) where status in ('pending','failed');

alter table public.reminder_deliveries enable row level security;
revoke all on public.reminder_deliveries from anon, authenticated;


-- ─── 3. candidates: which events could be due in [p_lo, p_hi] ──────────────────────────────────
--   one-off events: exactly those whose fire time (start − reminder minutes) is in the window.
--   repeating events: every repeating event with a reminder (few); the job expands their occurrences in the account timezone.
create index if not exists schedule_events_reminder_idx on public.schedule_events (start_at) where reminder_mins is not null;

create or replace function public.schedule_reminder_candidates(p_lo timestamptz, p_hi timestamptz)
returns table (user_id uuid, event_id text, title text, start_at timestamptz, reminder_mins integer, recurrence text)
language sql
stable
security definer
set search_path = public
as $$
  select e.user_id, e.event_id, e.title, e.start_at, e.reminder_mins, e.recurrence
  from public.schedule_events e
  where e.reminder_mins is not null
    and (
      (e.recurrence = 'none'
         and e.start_at between p_lo + e.reminder_mins * interval '1 minute' and p_hi + e.reminder_mins * interval '1 minute')
      or
      (e.recurrence <> 'none'
         and e.start_at <= p_hi + e.reminder_mins * interval '1 minute')
    );
$$;

revoke all on function public.schedule_reminder_candidates(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.schedule_reminder_candidates(timestamptz, timestamptz) to service_role;


-- ─── Verification ───────────────────────────────────────────────────────────────────────────────
--   select table_name, row_security from information_schema.tables
--    where table_schema = 'public' and table_name in ('push_subscriptions','reminder_deliveries');          -- expect YES for both
--   select count(*) from pg_policies where tablename in ('push_subscriptions','reminder_deliveries');       -- expect 0 (no client access)
--   select * from public.schedule_reminder_candidates(now() - interval '30 minutes', now());                 -- as service role; usually 0 rows

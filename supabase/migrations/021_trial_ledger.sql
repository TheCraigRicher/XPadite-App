-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 021_trial_ledger   (v1.308 — no repeated free trials after account deletion)
--
-- Problem: deleting an account and signing up again with the same email created a brand-new user and a fresh 5-day trial.
--
-- Design (server-only; nothing here is readable or writable from the browser):
--   public.trial_ledger        identity_hash (keyed HMAC of the normalised VERIFIED email, computed by the app server —
--                              never the email itself) → first_trial_start. NO foreign key to auth.users, so it survives
--                              account deletion. retain_until = created + 24 months (privacy: not kept forever).
--   public.billing_trial_clock user_id → trial_start: this ACCOUNT's effective trial start (cascades with the account).
--                              Never changes once set, so changing the email address cannot restart a trial.
--   public.billing_register_trial(p_user, p_hash, p_activation)
--                              atomic: records the identity on first sight, then pins this account's clock to the ORIGINAL
--                              start. Concurrent calls cannot give two independent trials (unique key + ON CONFLICT).
--   public.billing_has_access  re-issued from 016 with ONE change: the trial start is the account's clock when present.
--
-- The trial END is still max(start, billing launch) + 5 days everywhere, so the existing launch grandfathering and the
-- 120-hour length are unchanged. Existing accounts keep working with no backfill (a missing clock row = the old
-- behaviour); the backfill (scripts/trial-ledger.mjs) only makes their identities remembered. Idempotent. One transaction.
-- NOT applied automatically — owner runs it in the SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- ─── 1. Tables ───────────────────────────────────────────────────────────────

create table if not exists public.trial_ledger (
  identity_hash     text        primary key check (identity_hash ~ '^[0-9a-f]{64}$'),
  first_trial_start timestamptz not null,
  created_at        timestamptz not null default now(),
  retain_until      timestamptz not null default (now() + interval '24 months')
);

create table if not exists public.billing_trial_clock (
  user_id     uuid        primary key references auth.users(id) on delete cascade,
  trial_start timestamptz not null,
  created_at  timestamptz not null default now()
);

alter table public.trial_ledger        enable row level security;
alter table public.billing_trial_clock enable row level security;   -- no policies: service role / definer functions only

-- Supabase grants ALL on new public tables to anon/authenticated by default: remove it.
revoke all on public.trial_ledger        from anon, authenticated;
revoke all on public.billing_trial_clock from anon, authenticated;
grant all on public.trial_ledger        to service_role;
grant all on public.billing_trial_clock to service_role;

-- ─── 2. Atomic registration ──────────────────────────────────────────────────

create or replace function public.billing_register_trial(p_user uuid, p_hash text, p_activation timestamptz)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start timestamptz;
  v_clock timestamptz;
begin
  if p_user is null or p_activation is null or p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_arguments' using errcode = '22023';
  end if;

  -- First sight of this identity: remember its start. A row that outlived its retention period is treated as unseen.
  insert into public.trial_ledger as l (identity_hash, first_trial_start)
  values (p_hash, p_activation)
  on conflict (identity_hash) do update
    set first_trial_start = excluded.first_trial_start,
        created_at        = now(),
        retain_until      = now() + interval '24 months'
    where l.retain_until < now();

  select first_trial_start into v_start from public.trial_ledger where identity_hash = p_hash;

  -- Pin THIS account to that start, once. Never moved afterwards (email changes cannot restart or shorten it).
  insert into public.billing_trial_clock (user_id, trial_start)
  values (p_user, v_start)
  on conflict (user_id) do nothing;

  select trial_start into v_clock from public.billing_trial_clock where user_id = p_user;
  return v_clock;
end;
$$;

revoke all on function public.billing_register_trial(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.billing_register_trial(uuid, text, timestamptz) to service_role;

-- ─── 3. Database paywall: use the account's trial clock ──────────────────────
-- Identical to 016's billing_has_access except for the two marked lines.

create or replace function public.billing_has_access(p_user uuid default auth.uid())
returns boolean
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_disabled   text;
  v_launch     timestamptz;
  v_activated  timestamptz;
  v_clock      timestamptz;
  v_claims_txt text := nullif(current_setting('request.jwt.claims', true), '');
  v_role_claim text := nullif(current_setting('request.jwt.claim.role', true), '');
  v_role       text;
begin
  if p_user is null then return false; end if;

  if p_user is distinct from auth.uid() then
    v_role := v_role_claim;
    if v_role is null and v_claims_txt is not null then
      begin
        v_role := v_claims_txt::jsonb ->> 'role';
      exception when others then
        v_role := null;                      -- unreadable claims → unprivileged (fail closed)
      end;
    end if;
    if not (coalesce(v_role, '') = 'service_role' or (v_claims_txt is null and v_role_claim is null)) then
      return false;
    end if;
  end if;

  select value into v_disabled from public.billing_config where key = 'paywall_disabled';
  if v_disabled = 'true' then return true; end if;

  begin
    select value::timestamptz into v_launch from public.billing_config where key = 'launch_at';
  exception when others then
    v_launch := null;
  end;
  if v_launch is null then return true; end if;

  if exists (select 1 from public.billing_purchases
              where user_id = p_user and status = 'paid'
                and (plan_key = 'ltd'
                     or (plan_key = '3year-pro' and access_expires_at > now()))) then
    return true;
  end if;

  if exists (select 1 from public.billing_subscriptions
              where user_id = p_user and status in ('active','trialing','past_due')) then
    return true;
  end if;

  select coalesce(email_confirmed_at, created_at) into v_activated from auth.users where id = p_user;
  if v_activated is null then return true; end if;

  select trial_start into v_clock from public.billing_trial_clock where user_id = p_user;   -- 021: account's pinned trial start
  v_activated := coalesce(v_clock, v_activated);                                             -- 021: (absent = the old behaviour)

  return now() < greatest(v_activated, v_launch) + interval '5 days';
end;
$$;

revoke all on function public.billing_has_access(uuid) from public, anon;
grant execute on function public.billing_has_access(uuid) to authenticated, service_role;

commit;

-- ─── Operations (SQL Editor, as needed) ──────────────────────────────────────
--   -- housekeeping: forget identities past their retention period (never touches accounts or user data)
--   delete from public.trial_ledger where retain_until < now();
--   -- privacy/erasure request for one email: use  node scripts/trial-ledger.mjs forget <email>  (computes the keyed hash)
--   -- support override for a legitimate customer: give their account a fresh clock
--   update public.billing_trial_clock set trial_start = now() where user_id = '<user id>';

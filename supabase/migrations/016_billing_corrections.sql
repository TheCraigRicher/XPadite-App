-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 016_billing_corrections
-- Incremental follow-up to 015_billing (015 is NOT modified).
--
--  1. billing_config           — server-synced launch date / kill switch used by RLS.
--  2. billing_has_access()     — DB mirror of the app's entitlement rules (paid or trial);
--                                a caller may only ask about THEMSELVES (service role / direct DB excepted).
--  3. RESTRICTIVE write policies on protected productivity tables + gallery uploads,
--     so an expired, unpaid user cannot bypass the paywall with direct Supabase calls.
--     Reads, DELETE, profiles, user_preferences (theme), support_requests, avatars,
--     billing tables and all service-role operations are untouched.
--  4. Limited-offer inventory: no more deleting earlier holds; atomic reserve + atomic
--     confirm (cap enforced under lock at payment confirmation, incl. fallback inserts).
--  5. Billing record retention: user_id → ON DELETE SET NULL on purchases/subscriptions
--     so payment records survive account deletion (customer mapping still cascades).
--  6. Early-adopter price-lock columns, refund/dispute/review columns.
--
-- HOW TO APPLY: Supabase Dashboard → SQL Editor → paste → Run. Idempotent.
-- Apply AFTER 015_billing.sql.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. Server-synced configuration ─────────────────────────────────────────
-- Written ONLY by the app server (service role) from BILLING_LAUNCH_AT /
-- BILLING_PAYWALL_DISABLED. If empty, the paywall is NOT enforced (fail-open).
create table if not exists public.billing_config (
  key        text primary key,
  value      text,
  updated_at timestamptz not null default now()
);
alter table public.billing_config enable row level security;  -- no policies: service role only
-- Least privilege (default privileges may otherwise give anon/authenticated ALL on a new table):
-- no API-role access at all; the server uses the service role.
revoke all on public.billing_config from anon, authenticated;
grant all on public.billing_config to service_role;

-- ─── 2. Purchases: retention, review and dispute columns ────────────────────
alter table public.billing_purchases alter column user_id drop not null;
alter table public.billing_purchases drop constraint if exists billing_purchases_user_id_fkey;
alter table public.billing_purchases
  add constraint billing_purchases_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete set null;

alter table public.billing_purchases
  add column if not exists needs_review    boolean not null default false,
  add column if not exists review_reason   text,
  add column if not exists dispute_id      text,
  add column if not exists dispute_status  text,
  add column if not exists refunded_at     timestamptz,
  add column if not exists user_deleted_at timestamptz;

-- status gains 'review' (paid at Stripe but inventory could not be granted).
-- 'disputed' now means a CONFIRMED LOST dispute (not merely opened).
do $$
declare c text;
begin
  select conname into c
    from pg_constraint
   where conrelid = 'public.billing_purchases'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%pending%';
  if c is not null then
    execute format('alter table public.billing_purchases drop constraint %I', c);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'billing_purchases_status_chk') then
    alter table public.billing_purchases
      add constraint billing_purchases_status_chk
      check (status in ('pending','paid','expired','refunded','disputed','review'));
  end if;
end $$;

-- At most one live hold per user per offer (stops parallel payable sessions).
create unique index if not exists billing_purchases_one_pending_idx
  on public.billing_purchases (user_id, plan_key)
  where status = 'pending';

-- ─── 3. Subscriptions: retention + early-adopter price lock ─────────────────
alter table public.billing_subscriptions alter column user_id drop not null;
alter table public.billing_subscriptions drop constraint if exists billing_subscriptions_user_id_fkey;
alter table public.billing_subscriptions
  add constraint billing_subscriptions_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete set null;

alter table public.billing_subscriptions
  add column if not exists early_adopter        boolean not null default false,
  add column if not exists locked_price_id      text,
  add column if not exists locked_amount_cents  integer,
  add column if not exists price_locked_until   timestamptz,
  add column if not exists user_deleted_at      timestamptz;

-- ─── 4. Access check (mirrors lib/billing/entitlement.ts) ───────────────────
-- Paid  : Lifetime paid · 3-Year paid & unexpired · subscription active/trialing/past_due.
-- Trial : now < greatest(email-confirmation time, launch_at) + 5 days.
-- Fail-open when launch_at is missing/invalid or the kill switch is on, so a
-- misconfiguration can never lock users out. (5 = TRIAL_DAYS in lib/billing/plans.ts.)
--
-- PRIVACY GUARD: this is SECURITY DEFINER (it must read billing tables that API roles cannot),
-- so a signed-in user could otherwise pass ANY user id and learn whether that person has access.
-- The caller's identity therefore has to match: p_user must equal auth.uid() (this is what every
-- RLS policy does — they call it with no argument), unless the caller is privileged:
--   * service_role (JWT role claim), or
--   * a direct database session with NO JWT claims at all (SQL Editor / migrations / admins —
--     API requests always carry claims, so an API user can never look like this).
-- Any other attempt to query someone else's id returns false, before any billing data is read,
-- so the answer reveals nothing. If the claims are present but unreadable the call fails closed.
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
    -- coalesce: a NULL role must evaluate to false, not NULL (NOT NULL would skip this guard)
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

  return now() < greatest(v_activated, v_launch) + interval '5 days';
end;
$$;

revoke all on function public.billing_has_access(uuid) from public, anon;
grant execute on function public.billing_has_access(uuid) to authenticated, service_role;

-- ─── 5. Server-side paywall: RESTRICTIVE write policies ─────────────────────
-- Restrictive policies are ANDed with the existing owner policies, so owner
-- checks are unchanged and only the extra access condition is added.
do $$
declare t text;
begin
  foreach t in array array[
    'calendar_days','work_sessions','user_activities',
    'gallery_items','journal_labels','journal_folders','reminders'
  ] loop
    execute format('drop policy if exists billing_paywall_insert on public.%I', t);
    execute format('drop policy if exists billing_paywall_update on public.%I', t);
    execute format(
      'create policy billing_paywall_insert on public.%I as restrictive for insert to authenticated with check ((select public.billing_has_access()))', t);
    execute format(
      'create policy billing_paywall_update on public.%I as restrictive for update to authenticated using ((select public.billing_has_access())) with check ((select public.billing_has_access()))', t);
  end loop;
end $$;

-- Gallery image uploads (only the 'gallery' bucket is restricted).
drop policy if exists billing_paywall_gallery_upload on storage.objects;
create policy billing_paywall_gallery_upload
  on storage.objects as restrictive for insert to authenticated
  with check (bucket_id <> 'gallery' or (select public.billing_has_access()));

-- ─── 6. Limited-offer inventory ─────────────────────────────────────────────
-- Replaces billing_reserve_offer (which deleted earlier holds while their
-- Stripe session stayed payable). Holds are never deleted by a newer checkout;
-- the app expires the old Stripe session first.
drop function if exists public.billing_reserve_offer(uuid, text, text, integer, integer);

-- A slot is taken by: paid, confirmed-lost-dispute ('disputed'), or a live hold.
-- refunded / expired / review rows do not hold a slot.
-- OUT columns are named hold_* so they cannot collide with billing_purchases columns
-- inside the function body (plpgsql would raise "column reference is ambiguous").
drop function if exists public.billing_reserve_offer_v2(uuid, text, text, integer, integer);
create or replace function public.billing_reserve_offer_v2(
  p_user_id   uuid,
  p_plan_key  text,
  p_price_id  text,
  p_cap       integer,
  p_hold_mins integer default 40
) returns table (hold_id uuid, hold_until timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_taken integer;
  v_id    uuid;
  v_until timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext('billing_offer_' || p_plan_key));

  -- Holds past their lifetime no longer protect a payable session (the app
  -- sets the Stripe session to expire well before reserved_until).
  update public.billing_purchases
     set status = 'expired', reserved_until = null, updated_at = now()
   where plan_key = p_plan_key and status = 'pending'
     and (reserved_until is null or reserved_until <= now());

  -- One allocation per customer: a customer who already owns this plan (paid, lost dispute,
  -- or paid-but-flagged 'review') cannot reserve another. Refunded / expired rows do not block.
  if exists (select 1 from public.billing_purchases
              where user_id = p_user_id and plan_key = p_plan_key
                and status in ('paid', 'disputed', 'review')) then
    raise exception 'already_owned';
  end if;

  -- A live hold is never deleted or replaced by a newer attempt (its Stripe session may
  -- still be payable); the caller retires the old session first.
  if exists (select 1 from public.billing_purchases
              where user_id = p_user_id and plan_key = p_plan_key and status = 'pending') then
    raise exception 'hold_exists';
  end if;

  select count(*) into v_taken
    from public.billing_purchases
   where plan_key = p_plan_key and status in ('paid', 'disputed', 'pending');

  if v_taken >= p_cap then
    return;  -- sold out → empty result
  end if;

  v_until := now() + make_interval(mins => p_hold_mins);
  insert into public.billing_purchases (user_id, plan_key, stripe_price_id, status, reserved_until)
  values (p_user_id, p_plan_key, p_price_id, 'pending', v_until)
  returning billing_purchases.id into v_id;

  return query select v_id, v_until;
end;
$$;

-- Atomic payment confirmation. The cap is enforced HERE, under the same lock,
-- including the late-payment (hold already released) and no-hold fallback paths.
-- If Stripe was paid but no slot is legitimately available the row is recorded
-- as status='review' + needs_review (never silently granted, never auto-refunded).
-- p_final_status lets the app record a payment that Stripe already shows as
-- refunded / lost-dispute at confirmation time, so it can never become active.
create or replace function public.billing_confirm_purchase(
  p_session_id     text,
  p_user_id        uuid,
  p_plan_key       text,
  p_price_id       text,
  p_payment_intent text,
  p_amount         integer,
  p_currency       text,
  p_cap            integer,
  p_access_expires timestamptz,
  p_final_status   text default 'paid'
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  r        public.billing_purchases%rowtype;
  v_uid    uuid;
  v_taken  integer;
  v_review text := null;
  v_exists boolean;
begin
  perform pg_advisory_xact_lock(hashtext('billing_offer_' || p_plan_key));

  if p_final_status not in ('paid', 'refunded', 'disputed') then
    raise exception 'invalid final status';
  end if;

  -- The user may have been deleted since checkout began.
  select u.id into v_uid from auth.users u where u.id = p_user_id;

  select * into r from public.billing_purchases
   where stripe_checkout_session_id = p_session_id for update;
  v_exists := found;  -- capture now: later SELECT INTOs overwrite FOUND

  if v_exists then
    if r.status in ('paid', 'refunded', 'disputed', 'review') then
      return 'already_' || r.status;
    end if;
  end if;

  if p_final_status = 'paid' then
    if v_uid is null then
      v_review := 'user_missing';
    elsif exists (select 1 from public.billing_purchases
                   where user_id = v_uid and plan_key = p_plan_key and id is distinct from r.id
                     and status in ('paid', 'disputed', 'review')) then
      -- Already owns this limited offer: paid at Stripe but NOT granted a second allocation,
      -- flagged for manual handling (never auto-refunded).
      v_review := 'duplicate_allocation';
    else
      select count(*) into v_taken
        from public.billing_purchases
       where plan_key = p_plan_key
         and status in ('paid', 'disputed', 'pending')
         and id is distinct from r.id;
      -- A live hold for THIS purchase already counted; only a released hold
      -- (status 'expired') or a missing row needs a fresh slot.
      if (not v_exists or r.status = 'expired') and v_taken >= p_cap then
        v_review := 'inventory_unavailable';
      end if;
    end if;
  end if;

  if v_exists then
    update public.billing_purchases set
      user_id = coalesce(v_uid, user_id),
      status = case when v_review is not null then 'review' else p_final_status end,
      needs_review = (v_review is not null),
      review_reason = v_review,
      stripe_payment_intent_id = p_payment_intent,
      amount_total = p_amount,
      currency = p_currency,
      granted_at = case when v_review is null and p_final_status = 'paid' then now() else granted_at end,
      access_expires_at = case when v_review is null and p_final_status = 'paid' then p_access_expires else null end,
      refunded_at = case when p_final_status = 'refunded' then now() else refunded_at end,
      reserved_until = null,
      updated_at = now()
     where id = r.id;
  else
    insert into public.billing_purchases (
      user_id, plan_key, stripe_price_id, stripe_checkout_session_id, stripe_payment_intent_id,
      status, needs_review, review_reason, amount_total, currency,
      granted_at, access_expires_at, refunded_at
    ) values (
      v_uid, p_plan_key, p_price_id, p_session_id, p_payment_intent,
      case when v_review is not null then 'review' else p_final_status end,
      (v_review is not null), v_review, p_amount, p_currency,
      case when v_review is null and p_final_status = 'paid' then now() end,
      case when v_review is null and p_final_status = 'paid' then p_access_expires end,
      case when p_final_status = 'refunded' then now() end
    );
  end if;

  return case when v_review is not null then 'review' else p_final_status end;
end;
$$;

revoke all on function public.billing_reserve_offer_v2(uuid, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.billing_confirm_purchase(text, uuid, text, text, text, integer, text, integer, timestamptz, text) from public, anon, authenticated;
grant execute on function public.billing_reserve_offer_v2(uuid, text, text, integer, integer) to service_role;
grant execute on function public.billing_confirm_purchase(text, uuid, text, text, text, integer, text, integer, timestamptz, text) to service_role;

-- ─── Verification ───────────────────────────────────────────────────────────
--   select policyname, tablename, cmd from pg_policies
--    where policyname like 'billing_paywall%';          -- 7 tables × 2 + storage
--   select public.billing_has_access('<some-user-uuid>');
-- ─────────────────────────────────────────────────────────────────────────────

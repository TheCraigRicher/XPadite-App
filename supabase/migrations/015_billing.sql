-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 015_billing
-- Stripe billing: customer mapping, subscriptions, one-time purchases
-- (3-Year / Lifetime), and webhook idempotency.
--
-- Additive only — no existing table is altered. The 5-day free trial keeps
-- using profiles.created_at (no new trial column).
--
-- SECURITY MODEL
--   * Every table has RLS enabled. Users may SELECT their own rows only.
--   * There are NO insert/update/delete policies: only the server (service-role
--     key, which bypasses RLS) can write billing data. A user can therefore
--     never grant themselves access from the browser.
--   * billing_webhook_events has no policies at all (service role only).
--   * No card data is stored — only Stripe IDs, statuses and dates.
--
-- HOW TO APPLY: Supabase Dashboard → SQL Editor → paste → Run. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. Stripe customer ↔ Supabase user ─────────────────────────────────────
create table if not exists public.billing_customers (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id text not null unique,
  created_at         timestamptz not null default now()
);

-- ─── 2. Subscriptions (Monthly / Yearly) ────────────────────────────────────
-- Mirrors Stripe state; rewritten from a fresh Stripe retrieve on every
-- relevant webhook, so retries / out-of-order delivery converge.
create table if not exists public.billing_subscriptions (
  stripe_subscription_id text primary key,
  user_id                uuid not null references auth.users(id) on delete cascade,
  stripe_customer_id     text not null,
  plan_key               text not null,
  stripe_price_id        text not null,
  status                 text not null,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null default false,
  canceled_at            timestamptz,
  synced_at              timestamptz not null default now()
);
create index if not exists billing_subscriptions_user_idx
  on public.billing_subscriptions (user_id);

-- ─── 3. One-time purchases (3-Year / Lifetime) ──────────────────────────────
-- A row is first created as 'pending' when checkout starts (this reserves one
-- of the limited spots), and becomes 'paid' only from a verified Stripe
-- webhook / server-side Stripe verification — never from the success URL.
--   status: pending | paid | expired | refunded | disputed
--   access_expires_at: NULL for lifetime.
create table if not exists public.billing_purchases (
  id                         uuid primary key default gen_random_uuid(),
  user_id                    uuid not null references auth.users(id) on delete cascade,
  plan_key                   text not null check (plan_key in ('3year-pro', 'ltd')),
  stripe_price_id            text not null,
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id   text,
  status                     text not null default 'pending'
                               check (status in ('pending','paid','expired','refunded','disputed')),
  reserved_until             timestamptz,
  amount_total               integer,
  currency                   text,
  granted_at                 timestamptz,
  access_expires_at          timestamptz,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);
create index if not exists billing_purchases_user_idx
  on public.billing_purchases (user_id);
create index if not exists billing_purchases_pi_idx
  on public.billing_purchases (stripe_payment_intent_id);
create index if not exists billing_purchases_plan_status_idx
  on public.billing_purchases (plan_key, status);

-- ─── 4. Webhook idempotency ─────────────────────────────────────────────────
create table if not exists public.billing_webhook_events (
  event_id     text primary key,
  event_type   text not null,
  status       text not null default 'processing'
                 check (status in ('processing','processed','failed')),
  error        text,
  received_at  timestamptz not null default now(),
  processed_at timestamptz
);

-- ─── 5. RLS ─────────────────────────────────────────────────────────────────
alter table public.billing_customers      enable row level security;
alter table public.billing_subscriptions  enable row level security;
alter table public.billing_purchases      enable row level security;
alter table public.billing_webhook_events enable row level security;

drop policy if exists "billing_customers_select_own"     on public.billing_customers;
drop policy if exists "billing_subscriptions_select_own" on public.billing_subscriptions;
drop policy if exists "billing_purchases_select_own"     on public.billing_purchases;

create policy "billing_customers_select_own"
  on public.billing_customers for select using (auth.uid() = user_id);
create policy "billing_subscriptions_select_own"
  on public.billing_subscriptions for select using (auth.uid() = user_id);
create policy "billing_purchases_select_own"
  on public.billing_purchases for select using (auth.uid() = user_id);

-- ─── 6. Atomic limited-offer reservation ────────────────────────────────────
-- Counts spots (paid purchases + unexpired pending reservations of OTHER
-- users) under an advisory lock so two simultaneous checkouts cannot both take
-- the last spot. Refunded / disputed / expired rows free their spot.
-- Returns the reservation id, or NULL if the offer is sold out.
-- Callable by the service role only.
create or replace function public.billing_reserve_offer(
  p_user_id   uuid,
  p_plan_key  text,
  p_price_id  text,
  p_cap       integer,
  p_hold_mins integer default 35
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_taken integer;
  v_id    uuid;
begin
  perform pg_advisory_xact_lock(hashtext('billing_offer_' || p_plan_key));

  -- Drop this user's own stale/pending hold for the same plan (retry case).
  delete from public.billing_purchases
   where user_id = p_user_id and plan_key = p_plan_key and status = 'pending';

  select count(*) into v_taken
    from public.billing_purchases
   where plan_key = p_plan_key
     and (status = 'paid'
          or (status = 'pending' and reserved_until > now()));

  if v_taken >= p_cap then
    return null;
  end if;

  insert into public.billing_purchases (user_id, plan_key, stripe_price_id, status, reserved_until)
  values (p_user_id, p_plan_key, p_price_id, 'pending', now() + make_interval(mins => p_hold_mins))
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.billing_reserve_offer(uuid, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.billing_reserve_offer(uuid, text, text, integer, integer) to service_role;

-- ─── Verification ───────────────────────────────────────────────────────────
--   select tablename, rowsecurity from pg_tables
--   where schemaname = 'public' and tablename like 'billing_%';
-- Expected: 4 rows, rowsecurity = true.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 018_analytics_consent   (XPadite App)
--
-- Stores each signed-in user's choice about optional PostHog product analytics so the SERVER can respect it —
-- including in Stripe webhooks, which carry no browser cookies and no session.
--
--   public.analytics_consent   one row per user; absent row = NOT consented (analytics off by default)
--
-- Security model (same pattern as the billing tables in 015)
--   * Row Level Security is ON with NO policies, and every table privilege is revoked from anon/authenticated.
--     The browser can therefore neither read nor write this table, and cannot touch another user's row.
--   * Only server code using the service-role key reads/writes it, and only through /api/analytics/consent, which
--     takes the user id from the verified session (never from the request body).
--   * Rows are deleted automatically when the account is deleted (on delete cascade).
--   * No personal data is stored: just the user id, a boolean and timestamps.
--
-- trial_event_reported_at: set once (server-side, atomically) when the trial-start analytics event has been sent, so
--   granting, withdrawing and re-granting consent can never produce a second event.
--
-- HOW TO APPLY: Supabase Dashboard → SQL Editor → paste → Run. Idempotent. The App works without it (server
--   analytics simply stay off until the table exists).
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.analytics_consent (
  user_id                 uuid        primary key references auth.users(id) on delete cascade,
  analytics               boolean     not null default false,
  decided_at              timestamptz not null default now(),
  trial_event_reported_at timestamptz
);

alter table public.analytics_consent enable row level security;
-- No policies on purpose: nobody but the service role can touch the table.

revoke all on public.analytics_consent from anon, authenticated;
grant all on public.analytics_consent to service_role;

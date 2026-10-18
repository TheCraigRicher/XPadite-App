# XPadite — Stripe Launch Readiness

Single source of truth for what remains before live payments. **DONE only with evidence.** A passing `tsc`/lint/build proves the code
compiles — it does not prove Stripe, Supabase, webhooks or real payments work. No secrets or customer data belong in this file.

Status key: **DONE** · **PENDING** · **BLOCKED** (cannot proceed until something else is done)
Last reviewed: 2026-10-17 (test-mode setup pass, after the Website → App purchase hand-off was added).

## 0. Status at a glance (2026-10-17 test-mode setup pass)

Four separate questions — do not read one as the other.

| Stage | State | Evidence |
|---|---|---|
| **Code implemented** | DONE | Checkout, portal, webhook, entitlements, hand-off, paywall, RLS migration all present. `tsc`, targeted eslint (billing/stripe files: 0 errors) and `next build` pass. |
| **Configuration completed** | **NOT STARTED** | `.env.local` has **no** Stripe variables and no `BILLING_LAUNCH_AT`. No Stripe CLI installed here. Migrations 015/016 are not confirmed applied to any database. |
| **Integration tested** | **PARTIAL — database logic only** | See "Tests actually executed" below. Nothing has run against Stripe or a real Supabase project. |
| **Production launch authorized** | NO | Not requested. Paywall stays off until `BILLING_LAUNCH_AT` is deliberately set. |

### Test project (added 2026-10-17, later pass)
- **Separate Supabase test project `xpadite-test` (Canada Central, Healthy) has been created by the owner** — reported by the owner, not verified from here. The production project `xpadite` is untouched.
- **Test database initialization: PENDING.** The project is reported empty. Procedure + SQL prepared: `docs/TEST_DATABASE_SETUP.md`, `supabase/test-project-setup/A_storage_buckets_and_policies.sql`, `supabase/test-project-setup/B_data_api_grants.sql`.
  Rehearsed only in an in-memory Postgres (49/49 checks, fresh install of migrations 001–016 + A + B with simulated "automatic exposure off"). **Not run against any Supabase project.**
- Missing-from-repo prerequisites found: Storage buckets, **`avatars` bucket policies**, Data API grants (see the setup doc).
- **Stripe test-mode setup: PENDING.** **End-to-end payment verification: PENDING.** **Production launch: NOT authorized.** `.env.local` was not changed; `BILLING_LAUNCH_AT` is not set anywhere.

### Environment classification
**UNKNOWN — treated as potentially production.** Exactly one Supabase project is configured (`.env.local` → ref `zbnzaitowprrbmlzcejd`), alongside real
Resend credentials and a reminders sender on `xpadite.com`. Nothing in the repo identifies it as a dedicated test project, there is no staging
configuration and no Vercel link. **No migration was applied and the project was not queried** (an attempt to read it with the service-role key was
blocked, correctly). Backup availability for that project is **unconfirmed** — check Supabase Dashboard → Database → Backups (PITR needs a paid plan).

### Tests actually executed (isolated in-memory Postgres via PGlite — no real database touched)
Migrations 001, 002, 004, 005, 010, 015, 016 applied to a stubbed Supabase shape; 016 re-applied (idempotent). 43/43 checks passed after one fix:
- **Defect found and fixed:** `billing_reserve_offer_v2` failed with `column reference "reserved_until" is ambiguous` (would have broken every 3-Year/Lifetime checkout). OUT columns renamed `hold_id` / `hold_until`; function dropped-and-recreated in 016; `checkout/route.ts` updated.
- Trial/launch logic: missing or invalid `launch_at` → access (fail-open); existing 30-day-old account gets a fresh 5-day trial from launch; new account after launch gets 5 days; kill switch grants access.
- RLS: expired user's INSERT/UPDATE on `calendar_days` and gallery upload are blocked; READ and DELETE still work; trial user can write; paid Lifetime keeps access; refunded Lifetime loses it. 15 `billing_paywall_*` policies present.
- Inventory (sequential): cap respected, hold survives a second attempt by the same user, sold-out refusal, 3-Year and Lifetime counted independently, duplicate confirm idempotent, no-hold fallback with a full cap → `review` (not granted), late payment on a released hold, refunded slot released, lost dispute keeps its slot, stale hold replaced.
- Retention: deleting the auth user keeps purchase + subscription rows (user_id nulled) and removes the customer mapping.
- HTTP (built app, no Stripe/Supabase writes): webhook with no or forged signature → 400; checkout, portal, billing status, account delete and AI chat when signed out → 401.

**Not covered by those tests:** true parallel concurrency (PGlite is single-connection — the advisory lock is untested under real contention), real RLS on the other five protected tables, webhook handling of genuine Stripe events, anything involving Stripe objects, email verification, the browser/PWA flow.

### Tests blocked, and why
All 17 scenarios in the task (signup/trial, the four Website-originated purchases, entitlement activation, cancelled checkout, duplicate webhook, cancellation, refunds, disputes, parallel inventory, expired-trial against real RLS, deletion with active subscription, portal, auth/plan preservation) are **BLOCKED** on: (1) no Stripe test keys/Prices/webhook secret/CLI, (2) no confirmed non-production Supabase project to apply 015/016 to.

### Next action required from the owner
Initialise `xpadite-test` by following `docs/TEST_DATABASE_SETUP.md` (Part 1 Auth → Part 2 SQL 001→016, A, B → Part 4 verification queries), then report the verification results.

## A. App implementation

| Item | Status | Owner | Evidence / next action |
|---|---|---|---|
| Stripe integration (checkout, portal, webhook, entitlements, 5-day trial, limited-offer holds) | PENDING | App | Code present (`app/api/stripe/*`, `lib/billing/*`) and read-reviewed. Never exercised against Stripe in this review. Verify in test mode (section C). |
| Consolidated billing corrections | PENDING | App + Supabase | `016_billing_corrections.sql` exists; a reservation-function defect was found and fixed in the 2026-10-17 pass and the migration passes an isolated Postgres test (section 0). Not applied to any real database. |
| Website → App purchase hand-off | PENDING | App | Implemented: `?plan=<key>` survives middleware redirects, signup, login, email verification (stored on the account as `pending_plan`), and `/app` auto-starts Checkout once (`lib/billing/intent.ts`, `PurchaseIntent` in `BillingContext.tsx`). Verified: `tsc`, eslint (0 errors), isolated production build, redirect behaviour via HTTP, unit tests of the intent helpers, signup/login render and carry only valid plans. **Not verified:** a real signed-in account going through to Stripe Checkout, email-verification path, duplicate-session guard in a browser. |
| Google / social sign-in | BLOCKED | App | Not implemented: the Google/Apple/Microsoft buttons have no handlers. The hand-off therefore only covers email + password. If OAuth is added later it must pass the plan the same way (validated `pending_plan` in metadata, or `/auth/callback?next=/app?plan=<key>` — `next` is now validated by `safeNext`). |
| Authentication & entitlement security | PENDING | App | Reviewed, see "Security notes" below. One defect fixed (open redirect in `/auth/callback`); checkout now also requires a verified email. Broader items listed below. |
| Trial-expiration enforcement | PENDING | App + Supabase | Server-side: `paywallResponse` on paid API routes, restrictive RLS write policies (016) on calendar/work/activities/gallery/labels/folders/reminders, gallery upload policy. Needs verification against a real expired test user (section B/C). |
| Account deletion + subscription cancellation | PENDING | App | `DELETE /api/account/delete` cancels Stripe subscriptions first and aborts if it cannot confirm. Untested against Stripe. |

## B. Supabase

| Item | Status | Owner | Evidence / next action |
|---|---|---|---|
| Migration `015_billing.sql` applied | PENDING | Owner | Run in SQL Editor on a **test project first**. Passes an isolated Postgres test (section 0). Additive only; includes `create table if not exists` + `drop policy if exists`; nothing destructive. |
| Migration `016_billing_corrections.sql` applied | PENDING | Owner | Run after 015. Re-run safe. Only destructive-looking statements: `drop function` of the replaced reserve functions and `drop constraint` of two billing-table constraints it re-creates — no data is deleted. With `BILLING_LAUNCH_AT` unset it changes no behaviour (database fails open). |
| RLS verification | PENDING | Owner | As an expired test user: reads work; inserts/updates on the paywalled tables fail; gallery upload fails; support requests still work. |
| Billing configuration + launch timestamp (`BILLING_LAUNCH_AT`) | PENDING | Owner | Unset = nobody is locked out (by design). Set only at launch (section F). |
| Email confirmation enabled | PENDING | Owner | The hand-off assumes sign-up requires email confirmation. Confirm the setting. No new redirect-URL allow-list entries are needed (no query strings are used in `emailRedirectTo`). |

## C. Stripe test mode

All PENDING — Owner (Stripe dashboard) unless noted. Nothing here was done or verified in this review.
- Four test-mode CAD Prices: Pro Monthly 10.00, Pro Yearly 89.99, 3-Year 199.00 (one-time), Lifetime 249.00 (one-time); IDs in `STRIPE_PRICE_PRO_MONTHLY / _PRO_YEARLY / _3YEAR / _LIFETIME`.
- Test secret key + webhook signing secret in the App environment (never in the Website).
- Webhook events to subscribe (from `app/api/stripe/webhook/route.ts`): `checkout.session.completed`, `.async_payment_succeeded`, `.async_payment_failed`, `.expired`; `customer.subscription.created/updated/deleted`; `invoice.paid`, `invoice.payment_failed`; `charge.refunded`; `charge.dispute.closed` (and optionally `charge.dispute.created`).
- Customer Portal configured (cancel at period end; update payment method).
- Tax: decide on `STRIPE_AUTOMATIC_TAX=true` and configure Stripe Tax / registrations.
- Test scenarios: new user buys each of the four plans; signed-in user buys; verification on another device; cancelled checkout; failed card; sold-out limited offer (message shown); already-Lifetime; already-subscribed; payment still processing when returning.
- Refund (full → revoke + release slot; partial → manual review) and dispute (opened ≠ revoke; lost = revoke; won = keep).
- Subscription renewal, cancellation (access kept to period end), past-due, and one-year price-guarantee recording.
- Limited-offer concurrency: many parallel checkouts for the last slots never oversell; each offer capped at 100 independently.

## D. Website coordination (Website project)

| Item | Status | Owner | Evidence / next action |
|---|---|---|---|
| Four direct-purchase CTAs wired | PENDING | Website | Wired behind a flag (`NEXT_PUBLIC_DIRECT_PURCHASE`, default OFF) to `<APP_URL>/signup?plan=<key>`; keys match the App allowlist. Not complete while the flag is off and the journey is untested end to end. |
| Correct App destination URL | PENDING | Website | `NEXT_PUBLIC_APP_URL` must be the production App domain (the fallback is `https://xpadite.app` — confirm it is live). |
| `NEXT_PUBLIC_DIRECT_PURCHASE` activation | BLOCKED | Website | Only after section A hand-off is tested in test mode. |
| Checkout legal disclosures, Privacy/FAQ/Terms launch wording | PENDING | Website | Switch `CHECKOUT_LIVE` in `lib/legal.tsx` at launch; review the remaining pre-launch phrases listed in the Website's `docs/STRIPE_HANDOFF.md`. |
| CA$ pricing, one-year early-adopter guarantee wording | DONE (Website) | Website | Reported done by the Website session; not re-verified here. |
| Actual Website production build | PENDING | Website | Verify in the Website project before launch. |

## E. Business and legal readiness

| Item | Status | Owner |
|---|---|---|
| Physical business address / supplier contact details (BC internet-sales rules) | PENDING | Owner — none is published |
| Tax registration and collection (GST/PST/other) | PENDING | Owner / accountant |
| Refund, cancellation, dispute disclosures (LTD non-refundable except where the law requires) | PENDING | Owner — Website wording updated; legal review outstanding |
| Account deletion + billing-record retention disclosures (no invented retention period) | PENDING | Owner — Website wording updated; confirm retention with accountant |
| Lawyer review of Terms / Privacy | PENDING | Owner |

## F. Production launch

All PENDING, in this order: (1) full test-mode pass (section C) → (2) production env vars (live key, live Prices, `NEXT_PUBLIC_APP_URL`) →
(3) live webhook endpoint + signing secret → (4) set the launch timestamp → (5) flip Website flags → (6) one small real purchase and refund →
(7) monitor webhook deliveries, `billing_*` rows and Stripe events for the first days → (8) PWA check: install on Android and iOS,
confirm sign-in, checkout return to the installed app, and that the service worker caches nothing sensitive (currently pass-through, no cache).

## Security notes from this review (read-only unless stated)

Fixed in this change
- `/auth/callback` used `next` unvalidated (`${origin}${next}`), allowing an open redirect such as `//evil.example`. It now accepts only plain `/app…` paths (`safeNext`).
- Checkout now rejects accounts without a confirmed email (403 `email_unverified`).

Reviewed, no defect found
- Webhook: signature verified with the raw body; event claims are idempotent (duplicate delivery returns early; handlers retry safely).
- `/api/stripe/checkout`, `/portal`, `/billing/status`: authenticate the caller; plan keys validated against the server allowlist; price and amount come from server env and are verified with Stripe (CAD, expected amount, mode).
- Checkout success URL grants nothing; access comes from the webhook / server-side Stripe verification.
- Trial/paywall: enforced server-side (API guard + restrictive RLS), not by the UI.
- Service worker is a pure network pass-through (no caches), so protected responses are not stored.
- The plan carried in the URL/metadata is only an allowlisted key that selects which Checkout to open. A user can edit their own metadata, but the worst case is opening a Checkout they must still pay for.

Not changed — report only
- Reads are intentionally not paywalled (data is preserved); `profiles`, `user_preferences` and the support-attachments bucket are not covered by the restrictive write policies. Confirm this is intended.
- Subscription checkout creates a new Stripe session per attempt (only capped offers retire older sessions). Harmless but can leave several open sessions; they expire on their own.
- In dev with `--hostname 0.0.0.0`, redirects built from `request.url` show `http://0.0.0.0:3000` (development only).
- No security can be called "impossible to bypass"; this is a review of the obvious paths, not a penetration test.

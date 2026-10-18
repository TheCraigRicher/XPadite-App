# XPadite — Stripe Launch Readiness

Single source of truth for what remains before live payments. **DONE only with evidence.** A passing `tsc`/lint/build proves the code
compiles — it does not prove Stripe, Supabase, webhooks or real payments work. No secrets or customer data belong in this file.

Status key: **DONE** · **PENDING** · **BLOCKED** (cannot proceed until something else is done)
Last reviewed: 2026-10-17 (after the Website → App purchase hand-off was added).

## A. App implementation

| Item | Status | Owner | Evidence / next action |
|---|---|---|---|
| Stripe integration (checkout, portal, webhook, entitlements, 5-day trial, limited-offer holds) | PENDING | App | Code present (`app/api/stripe/*`, `lib/billing/*`) and read-reviewed. Never exercised against Stripe in this review. Verify in test mode (section C). |
| Consolidated billing corrections | PENDING | App + Supabase | `016_billing_corrections.sql` exists in the repo. Not confirmed applied to any database. |
| Website → App purchase hand-off | PENDING | App | Implemented: `?plan=<key>` survives middleware redirects, signup, login, email verification (stored on the account as `pending_plan`), and `/app` auto-starts Checkout once (`lib/billing/intent.ts`, `PurchaseIntent` in `BillingContext.tsx`). Verified: `tsc`, eslint (0 errors), isolated production build, redirect behaviour via HTTP, unit tests of the intent helpers, signup/login render and carry only valid plans. **Not verified:** a real signed-in account going through to Stripe Checkout, email-verification path, duplicate-session guard in a browser. |
| Google / social sign-in | BLOCKED | App | Not implemented: the Google/Apple/Microsoft buttons have no handlers. The hand-off therefore only covers email + password. If OAuth is added later it must pass the plan the same way (validated `pending_plan` in metadata, or `/auth/callback?next=/app?plan=<key>` — `next` is now validated by `safeNext`). |
| Authentication & entitlement security | PENDING | App | Reviewed, see "Security notes" below. One defect fixed (open redirect in `/auth/callback`); checkout now also requires a verified email. Broader items listed below. |
| Trial-expiration enforcement | PENDING | App + Supabase | Server-side: `paywallResponse` on paid API routes, restrictive RLS write policies (016) on calendar/work/activities/gallery/labels/folders/reminders, gallery upload policy. Needs verification against a real expired test user (section B/C). |
| Account deletion + subscription cancellation | PENDING | App | `DELETE /api/account/delete` cancels Stripe subscriptions first and aborts if it cannot confirm. Untested against Stripe. |

## B. Supabase

| Item | Status | Owner | Evidence / next action |
|---|---|---|---|
| Migration `015_billing.sql` applied | PENDING | Owner | Run in SQL Editor (test project first). |
| Migration `016_billing_corrections.sql` applied | PENDING | Owner | Run after 015. |
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

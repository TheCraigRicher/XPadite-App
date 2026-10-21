# PostHog analytics — App

The App and the Website report to **one PostHog project** (US Cloud, `https://us.i.posthog.com`). Every event carries
`app_surface: "app"` (this repo) or `"website"` (the Website repo).

XPadite holds private tasks, journals and planning data, so this integration is **off by default**:

- Browser analytics start only after the user taps **Allow** in a small notice (`components/analytics/AnalyticsProvider.tsx`).
  "No thanks" is remembered; nothing is loaded or sent. The App had no consent system before this, so this notice is new.
- Without `NEXT_PUBLIC_POSTHOG_KEY` nothing runs and the notice is not shown.
- **Session Replay is disabled in the App** (it would record private content). Autocapture, heatmaps, dead/rage clicks, web
  vitals, exceptions, surveys, experiments and feature-flag requests are off in the SDK, whatever the PostHog dashboard says.

## Environment variables (Vercel → App project → Settings → Environment Variables)

| Variable | Value | Scope |
|---|---|---|
| `NEXT_PUBLIC_POSTHOG_KEY` | project token `phc_…` (PostHog → Settings → Project → General). Public ingestion token, not a private key. | Production + Preview |
| `NEXT_PUBLIC_POSTHOG_HOST` | `https://us.i.posthog.com` | Production + Preview |
| `POSTHOG_SERVER_EVENTS` | optional; set to `off` to disable the server-side events below | optional |
| `SUPABASE_SERVICE_ROLE_KEY` | already required by billing; also used (server-only) to read/write the consent table | existing |

`NEXT_PUBLIC_*` values are fixed into the build — redeploy after adding them. No private API key is used.

## Events

| Event | Source | Sent when | Properties |
|---|---|---|---|
| `app_page_viewed` | browser (consent) | each real route change (`/login`, `/signup`, `/app`, …) | `path` |
| `signup_completed` | browser (consent) | email sign-up accepted by Supabase (verification email sent) | `method: email`, `plan_id` (valid plan key only) |
| `signup_completed` | **server** | Google account, reported when the user opts in during their first trial days (see Consent) | `method: google` |
| `trial_started` | **server** | the user opts in within the trial length of activating their account; sent once, timestamped at the real activation time (the trial window starts at activation, see `lib/billing/entitlement.ts`) | `trial_days`, `paywall_enforced` |
| `plan_selected` | browser (consent) | a plan is chosen: Settings → Subscription Plan, or arriving from a Website `?plan=` link | `plan_id`, `source` (`settings`/`website_link`) |
| `checkout_started` | **server** | `/api/stripe/checkout` created the Stripe Checkout Session | `plan_id`, `mode` (`subscription`/`one_time`) |
| `purchase_completed` | **server** | verified Stripe webhook: `checkout.session.completed` / `async_payment_succeeded` with `payment_status = paid`, after the existing handler succeeded | `plan_id`, `mode`, `value`, `currency` |
| `subscription_cancelled` | **server** | verified `customer.subscription.updated` (cancel scheduled) or `.deleted` (ended) | `plan_id`, `cancellation_type` (`scheduled`/`ended`) |
| `core_feature_used` | browser (consent) | a meaningful action in a core feature, at most once per feature per 30 minutes | `feature_name` ∈ `calendar`, `activity_time_tracker`, `advanced_task_manager`, `mind_mapping_canvas`, `analytics_dashboard`, `journal_planner_editor` |

What counts as "meaningful": marking a calendar day's status; finishing a tracked activity session; adding a task; saving a
mind-map canvas; opening the analytics dashboard; saving a journal/planner entry. Never every click or keystroke.

### Billing events come from verified backend facts only
`purchase_completed` and `subscription_cancelled` are emitted from the signature-verified webhook **after** the existing
handler processed the event (`lib/analytics/billing.ts`). The checkout success page produces nothing. Duplicates: the webhook's
idempotency table skips an already-processed event id, and each PostHog event also carries a UUID derived from a stable Stripe
id (checkout session / subscription + event), so a redelivery under a new event id still maps to one event.
`subscription_cancelled` can fire twice for one subscription (scheduled, later ended) — filter on `cancellation_type`.

### Identity
Before sign-in PostHog uses an anonymous id. After sign-in the browser calls `identify` once per user with the **internal
Supabase user id only** (no email/name); server events use the same id. Sign-out resets the identity. If a visitor arrived
from the Website with consent there (`?xp_aid=…`), that id is kept and used as the anonymous id once the user taps Allow, so
the Website visit joins the sign-up when they are identified. (Email verification on another browser breaks that link.)

## Consent — applies to browser AND server events

Server events are sent only for a user who has affirmatively opted in. The choice is persisted per user in
`public.analytics_consent` (**migration `018_analytics_consent.sql`**, not applied automatically): no row = not consented.

- The table is service-role only (RLS on, no policies, all privileges revoked from anon/authenticated). The browser never
  reads or writes it directly; it talks to `/api/analytics/consent` (GET/POST), which takes the user id from the verified
  session, never from the request — so nobody can change another user's consent.
- `captureForUser` (`lib/analytics/server.ts`) checks the table before every server event. Stripe webhooks need no cookies:
  the user id comes from the verified Stripe event and consent is looked up from the table. A missing row, `false`, a missing
  table or any lookup error means **no event** (fails closed).
- Billing is never affected: events run after the response, swallow all errors, and consent has no role in checkout creation,
  payment confirmation, entitlements, trial, cancellation or webhook acknowledgement/deduplication.
- Browser ↔ server sync (`lib/analytics/consentSync.ts`): signed in with a local choice that differs from the server → the
  choice is pushed (so a decline/withdrawal reaches the server); signed in with no local choice but a server choice → adopted
  (another device). **Sign-out clears the local choice**, so the next person on a shared browser decides for themselves.
- Change your mind any time: **Settings → Usage Analytics** (switch). Turning it off stops browser and server events and erases the stored id.
- `trial_started` / Google `signup_completed` are reported only after the user opts in, once (atomic `trial_event_reported_at`
  claim), backdated to activation, and not for accounts activated longer ago than the trial length — so enabling analytics never
  back-fills history and a user who never opts in never produces them.

## Privacy safeguards

- Opt-in; declining or withdrawing erases PostHog's stored id and the Website hand-over id.
- No emails, names, phone numbers, task/journal text, notes, tokens or card data are ever sent. All URLs are stripped of query strings and fragments. IP is not recorded; server events disable GeoIP.
- Server events carry only the internal user id and business facts (plan key, mode, amount, currency).
- Replay disabled; no feature flags/surveys/experiments requested.
- Analytics code only observes: failures are swallowed and never change a request, the checkout, or the webhook response.

## PostHog insights to create (needs PostHog login — not done from code)

| Goal | Insight |
|---|---|
| Customer funnel | Funnel: `website_page_viewed` (website) → `trial_cta_clicked` → `signup_completed` → `trial_started` → `checkout_started` → `purchase_completed` (unique users, 30–60 day window) |
| Verified purchases by plan | Trends: `purchase_completed`, sum of `value`, breakdown `plan_id` |
| Subscription vs one-time | same insight, breakdown `mode` |
| Trial-to-paid | Funnel: `trial_started` → `purchase_completed` |
| Feature adoption | Trends: `core_feature_used`, unique users, breakdown `feature_name` |
| Returning users / retention | Retention: `app_page_viewed` (or `core_feature_used`), weekly |
| Engagement by feature | Stickiness/Lifecycle on `core_feature_used`, breakdown `feature_name` |

Every event now requires the user's opt-in, so all counts reflect only users who allowed analytics; billing and Stripe
records remain the source of truth for revenue.

## Owner actions before this is useful

1. Add the variables above in Vercel (Production and Preview) and redeploy.
2. **Apply migration `supabase/migrations/018_analytics_consent.sql`** (Supabase → SQL Editor → Run; idempotent) before expecting server-side events. Until it exists, server events simply stay off and nothing breaks.
3. The Website Privacy Policy now names PostHog and covers the App's analytics; give the App's own in-app policy link (if any) the same wording.
4. Build the insights above. Optional: in PostHog → Settings switch off Autocapture, Heatmaps, Web vitals and Session Replay.

## Not verified against real PostHog

Tested against a local stand-in for PostHog's ingestion endpoint and synthetic Stripe events. Receipt in the real project
must be confirmed on the first deployment with the key set. The checkout route's `checkout_started` and the callback's
`trial_started`/`signup_completed` hooks were verified by type-check, review and unit tests of their logic, not by a live
Stripe/Supabase round trip. Sign-out reset is verified by code review only.

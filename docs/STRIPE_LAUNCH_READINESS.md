# XPadite — Stripe Launch Readiness

Single source of truth for what remains before live payments. **DONE only with evidence.** A passing `tsc`/lint/build proves the code
compiles — it does not prove Stripe, Supabase, webhooks or real payments work. No secrets or customer data belong in this file.

Status key: **DONE** · **PENDING** · **BLOCKED** (cannot proceed until something else is done)
Last reviewed: 2026-10-19 (Sandbox edge-case billing tests executed; production migrations verified by the owner).

**Evidence key:** *Verified* = exercised or read in this project by Claude. *Owner-reported* = stated by the owner, not independently checkable from here.

## 0. Status at a glance (2026-10-19)

| Stage | State | Evidence |
|---|---|---|
| **Code implemented** | DONE | Checkout, portal, webhook, entitlements, hand-off, paywall, RLS migrations. `tsc`, eslint (billing files) and `next build` pass. |
| **Sandbox configuration** | DONE | Sandbox account `acct_1URex2FvPKlg0ley`, Supabase project `xpadite-test` initialised, four Sandbox Prices, webhook, **Customer Portal configuration created and verified (below)**. Owner-reported except the portal. |
| **Sandbox integration tested** | DONE except 4 items | Owner-reported: Checkout, webhook and entitlements pass for all four plans. Verified: portal, and the 36-check edge-case run below (cancellation, full/partial refund, disputes opened/lost/won, duplicate and out-of-order delivery). **Still untested:** the Settings button in a browser, real Checkout cancel/failed-card/past-due paths, true parallel checkouts for the last slots, and delivery by Stripe itself (the run re-signed real events and POSTed them locally). |
| **Production database** | DONE (owner-verified) | 009-014 applied; **015/016 verified by the owner's production SQL result** (exact evidence below). Paywall still inactive. |
| **LIVE Stripe configuration** | DONE (configuration) - LIVE payment path UNTESTED | Account, four prices, portal configuration and webhook endpoint verified read-only in LIVE; owner confirmed all eight Stripe variables set and redeployed (`cced022`, v1.297); the unsigned webhook probe now returns `400 Missing signature`. **Not yet tested:** signed webhook delivery, a LIVE payment and entitlement update (controlled LIVE transaction, Task #5). Open item outside configuration: Stripe Tax (see "Tax at Checkout"). Temporary secret file deleted. See "Final LIVE verification". |
| **Production launch authorized** | NO | Paywall stays off: `BILLING_LAUNCH_AT` is unset everywhere. |

### Sandbox Customer Portal - FIXED and verified (2026-10-19)
- **Cause:** `STRIPE_PORTAL_CONFIGURATION_ID` pointed at a configuration made in a different Stripe test account (`acct_1URewcFpjCSHmRED`). The App's Sandbox account (`acct_1URex2FvPKlg0ley`, verified from the API key) had **no** portal configuration.
- **Fix (owner-approved):** created ONE configuration in the Sandbox account: cancel at period end, no proration, cancellation reasons collected; payment-method update on; invoice history on; billing-information edit (name/email/address); **subscription updates (plan switching and quantity changes) OFF**. Only `STRIPE_PORTAL_CONFIGURATION_ID` in `.env.development.local` was changed (all other lines verified unchanged).
- **Verified:** the project's real `getVerifiedPortalConfigurationId()` accepts the new configuration; portal sessions were created for an existing Sandbox customer with a subscription and for another customer (one-time-buyer path), both using the verified configuration; offline tests confirm the verifier refuses plan-switching, immediate cancellation, inactive and wrong-mode configurations.
- **Code:** `lib/billing/stripe.ts` now also refuses a configuration that cancels immediately; Settings shows "Billing history" (not "Manage billing") for 3-Year/Lifetime holders. **Not browser-tested:** the Settings button in a signed-in browser.

### Production database - 015/016 VERIFIED (owner-provided SQL result, 2026-10-19)
Earlier repository records had said 015/016 were not applied; the owner then reported them complete and supplied the result of the read-only check below. Claude cannot query production, so this is **owner-verified evidence**, recorded exactly as reported:

| Check | Required | Reported |
|---|---|---|
| billing tables | 5 | 5 |
| billing functions | `billing_confirm_purchase`, `billing_has_access`, `billing_reserve_offer_v2` | 3 billing functions (matches; `billing_reserve_offer` gone) |
| paywall policies (`billing_paywall%`) | 15 | 15 |
| `has_access_privacy_guard` | true | true |
| `reserve_ownership_guard` | true | true |
| `confirm_duplicate_guard` | true | true |
| `authenticated_can_truncate` | false | false |
| `anon_reads_config` | false | false |

Conclusion: the current (hardened) versions of 015 and 016 are in production. **No further production migration is needed**; do not re-run runbook steps 6-8. The query used (kept for re-checks):
```sql
select
  (select count(*) from pg_tables where schemaname='public' and tablename like 'billing%')                                  as billing_tables,
  (select string_agg(proname, ', ' order by proname) from pg_proc where pronamespace='public'::regnamespace and proname like 'billing%') as billing_functions,
  (select count(*) from pg_policies where policyname like 'billing_paywall%')                                              as paywall_policies,
  pg_get_functiondef(to_regprocedure('public.billing_has_access(uuid)')) like '%request.jwt.claims%'                       as has_access_privacy_guard,
  pg_get_functiondef(to_regprocedure('public.billing_reserve_offer_v2(uuid,text,text,integer,integer)')) like '%already_owned%' as reserve_ownership_guard,
  pg_get_functiondef(to_regprocedure('public.billing_confirm_purchase(text,uuid,text,text,text,integer,text,integer,timestamptz,text)')) like '%duplicate_allocation%' as confirm_duplicate_guard,
  has_table_privilege('authenticated', to_regclass('public.billing_purchases'), 'TRUNCATE')                                as authenticated_can_truncate,
  has_table_privilege('anon', to_regclass('public.billing_config'), 'SELECT')                                              as anon_reads_config;
```
Not covered by that check (still worth a glance at launch): `billing_config` should still be empty / hold only NULL `launch_at`, and `BILLING_LAUNCH_AT` must remain unset until launch.

### Sandbox edge-case billing tests (executed 2026-10-19) - 36/36 passed in one clean run
**What was real:** Sandbox Stripe objects and events (customers, a test-clock subscription, PaymentIntents, refunds, disputes), the App's real `/api/stripe/webhook` route and handlers, and the `xpadite-test` Supabase database. Isolated throw-away users/customers were used; nothing existing was modified (a fingerprint of all pre-existing billing rows was identical before and after). **What was simulated (and is not a Stripe-delivery test):** no Stripe CLI or public URL exists here, so the real events were fetched from Stripe, re-signed with the real signing secret and POSTed to the local dev server; the one-time purchase rows were seeded through the app's own `billing_confirm_purchase` function because completing a Checkout Session needs a browser. The test records were removed afterwards. The harness is not in the repo.

| Scenario | Result | What was proven |
|---|---|---|
| A. Subscription cancel at period end | PASS (10 checks) | Monthly subscription created; early-adopter price lock recorded (locked price, ~1-year expiry); cancel-at-period-end event keeps status `active` with `cancel_at_period_end=true`; access stays valid until the period end; advancing a Stripe test clock past the period end produced a real `customer.subscription.deleted` and the entitlement lapsed. |
| B. Full refund (Lifetime) | PASS (7) | Purchase held one slot; real `charge.refunded` marks it `refunded`, revokes the entitlement and releases the slot (2 -> 1). |
| C. Partial refund (3-Year) | PASS (4) | Stays `paid`, not treated as a full refund; flagged `needs_review` / `partial_refund`; entitlement and slot untouched. |
| D1. Dispute opened | PASS (3) | Real dispute (`needs_response`) recorded on the purchase; access NOT revoked. |
| D2. Dispute lost | PASS (4) | Sandbox-simulated loss (`losing_evidence`) -> status `disputed`, entitlement revoked, slot stays consumed (documented policy). |
| D3. Dispute won | PASS (3) | Sandbox-simulated win (`winning_evidence`), events delivered out of order (closed before created) -> status stays `paid`, `dispute_status=won`, entitlement preserved. |
| E. Idempotency / consistency | PASS (5) | Duplicate deliveries of a subscription update, a full refund (twice) and a dispute-closed event were acknowledged as duplicates with no new rows, no changed rows and no extra slot release; one `billing_webhook_events` row per event; unrelated billing records unchanged. |

No billing defects were found, so no application code was changed for this task.

### Tests executed so far (isolated in-memory Postgres - no real database touched)
Latest suites against the current 015/016: security guard 29/29, 015+016 compatibility 20/20, privileges and reservation rules 56/56, RLS/billing logic 44/44, fresh install + test-project setup 49/49; `tsc` clean. Defects found and fixed by these: reservation-function ambiguity, over-broad default grants, missing one-allocation-per-customer rule, a checkout race that could leave a payable session without a hold, `billing_has_access()` cross-user disclosure (and a NULL-logic bug in the first version of its guard). **Not covered:** true parallel concurrency, real Stripe events (refund/dispute/cancel), real Supabase specifics, browser/PWA flow.

### LIVE Stripe configuration (Task #2) - portal configuration CREATED and verified; webhook prepared, not created (2026-10-19)
**Method:** Stripe CLI project `xpadite-live`, explicit `--live` on every request; the inspection used only `stripe get` (HTTP GET) and every returned object reported `livemode: true`. The only LIVE write so far is the single owner-approved portal configuration below. No other LIVE resource was created, modified or deleted; no key or secret was read or printed.

**Account - VERIFIED:** `acct_1URewcFpjCSHmRED` (name "Xpadite", country CA, default currency CAD, charges and payouts enabled). Note: this is the same account that also owns its own test mode, which is why the old portal configuration `bpc_1USPkEFpjCSHmRED` (made in that account's *test* mode) was never visible to the separate Sandbox account `acct_1URex2FvPKlg0ley`. The earlier brief's ID `acct_1URwFcpiCSHmRED` was a typo.

**Prices - VERIFIED (5 active; all CAD, livemode true):**
| Plan | Env variable | LIVE Price ID | Check |
|---|---|---|---|
| Pro Yearly | `STRIPE_PRICE_PRO_YEARLY` | `price_1URgQyFpjCSHmREDhhkBLaNP` | CA$89.99 / year, tax_behavior exclusive - OK |
| 3-Year Pro | `STRIPE_PRICE_3YEAR` | `price_1URgUsFpjCSHmREDYeLN2yTc` | CA$199.00 one-time, exclusive - OK |
| Lifetime Pro | `STRIPE_PRICE_LIFETIME` | `price_1URgX9FpjCSHmREDPp36Uj3B` | CA$249.00 one-time, exclusive - OK |
| Pro Monthly | `STRIPE_PRICE_PRO_MONTHLY` | `price_1URziZFpjCSHmRED0l1DwjcA` | CA$10.00 / month, exclusive - **owner-approved choice (2026-10-19)**; see the duplicate note below |

**Pro Monthly had two active CA$10.00 / month prices on two separate products, both named "XPadite Pro Monthly"; neither has any subscription. Owner decision: use `price_1URziZFpjCSHmRED0l1DwjcA`; the older duplicate is left untouched (not archived).**
- `price_1URziZFpjCSHmRED0l1DwjcA` - product `prod_VSvRJErfcNKWpF`, created 2026-10-18, **tax_behavior exclusive** (consistent with the other three prices), product tax code `txcd_10103100`.
- `price_1URgOXFpjCSHmRED3CaDxZkj` - product `prod_VSbbcPH5Dzx3eV`, created 2026-10-17, **tax_behavior unspecified** (Stripe rejects a price without a tax behavior when automatic tax is on).
- The App's own price check would accept either price, so the production environment variable is the only thing that selects one - it must be set to `price_1URziZFpjCSHmRED0l1DwjcA`. Archiving the older product/price is optional and needs separate approval.

**Webhook endpoints - NONE exist (count 0).** **Customer Portal configurations - none existed at inspection; one was created (below).** **Stripe Tax - status `pending`, head-office address not set** (default tax behavior exclusive). Consequence: leave `STRIPE_AUTOMATIC_TAX` unset until the "Tax at Checkout" prerequisites below are met. (An earlier note here claimed the flag would fail in the Sandbox; a Sandbox probe on 2026-10-19 showed the Sandbox ACCEPTS automatic tax while Stripe Tax is pending, so that claim was wrong. LIVE behaviour could not be tested without creating a LIVE Checkout session and remains unverified.)

**Production App URL - VERIFIED: `https://x-padite-app.vercel.app`** (see "Production App deployment" below). Intended LIVE webhook URL = `https://x-padite-app.vercel.app/api/stripe/webhook`. No custom domain is configured as far as can be verified.

**Events the App's webhook handles (verified from `app/api/stripe/webhook/route.ts`):** `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`, `charge.refunded`, `charge.dispute.closed` (required) and `charge.dispute.created` (optional, recording only). SDK pins API version `2026-09-30.endive`.

**Production environment variables:** still not verifiable (no deployment access). Needed: `STRIPE_SECRET_KEY` (live), the four `STRIPE_PRICE_*`, `STRIPE_WEBHOOK_SECRET` (from the new LIVE endpoint), `STRIPE_PORTAL_CONFIGURATION_ID` (from the new LIVE portal configuration), `NEXT_PUBLIC_APP_URL`. Leave `STRIPE_AUTOMATIC_TAX`, `BILLING_LAUNCH_AT`, `BILLING_PAYWALL_DISABLED` unset. A restricted `rk_live_` key needs: Checkout Sessions write, Customers write, Subscriptions write, Customer portal write, PaymentIntents read, Charges read, Disputes read, Invoices read, Prices read.

**LIVE Customer Portal configuration - CREATED and VERIFIED (owner-approved, 2026-10-19):** ID **`bpc_1USRrPFpjCSHmREDKdWPBgHL`** (livemode true, active, the account's only and default configuration). Read back from LIVE and compared with the tested Sandbox configuration: settings **identical**. Confirmed: cancellation at period end only, no immediate cancellation, no proration, cancellation reasons collected, payment-method updates on, billing-information (name/email/address) updates on, invoice history on, **plan switching and quantity changes disabled**. The App's own `getVerifiedPortalConfigurationId()` check was run against the LIVE configuration's data (offline stub, no key) and accepts it. Use it as `STRIPE_PORTAL_CONFIGURATION_ID` in the production environment (not yet set - production variables were not touched).

**LIVE webhook endpoint - CREATED and VERIFIED (owner-approved, 2026-10-19):** ID **`we_1USSUGFpjCSHmRED2tlHM5EF`**, account `acct_1URewcFpjCSHmRED`, `livemode: true`, status `enabled`, the only webhook endpoint on the account. Read back from Stripe: URL `https://x-padite-app.vercel.app/api/stripe/webhook`; API version `2026-09-30.endive`; description `XPadite App billing (LIVE)`; exactly the 12 approved events (no more, no fewer). The signing secret was NOT printed or documented: it was written once to the restricted (owner-only ACL), git-ignored file `.env.live-webhook-secret.local` in the App folder, which must be **deleted after the secret is copied into Vercel**. Configuration as created:
- URL: `https://x-padite-app.vercel.app/api/stripe/webhook` (verified publicly reachable; the endpoint URL can be edited later if a custom domain is adopted - the signing secret stays the same)
- API version: `2026-09-30.endive` (matches the SDK the App uses)
- Description: `XPadite App billing (LIVE)`
- Events (12): `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`, `charge.refunded`, `charge.dispute.closed`, `charge.dispute.created`
- Next: copy the secret from `.env.live-webhook-secret.local` into Vercel (Production, Sensitive) as `STRIPE_WEBHOOK_SECRET`, redeploy, then delete the file. If the file is lost, the secret can be revealed or rolled in Dashboard -> Developers -> Webhooks -> the endpoint (rolling invalidates the old one).
- Until `STRIPE_WEBHOOK_SECRET` is set in production, the deployed webhook answers `500 Webhook not configured` and Stripe will show failed deliveries/retries - harmless while no LIVE payment exists, but set it in the same change as the live key and prices.

**Re-check (later 2026-10-19), read-only:** the LIVE account is still `acct_1URewcFpjCSHmRED`; it still has **0 webhook endpoints** (nothing equivalent exists) and exactly one portal configuration (`bpc_1USRrPFpjCSHmREDKdWPBgHL`, livemode, active). The 12 events in the endpoint spec above match the cases in `app/api/stripe/webhook/route.ts` one-to-one. The production homepage redirect is deployed and was browser-verified by the owner.

**Vercel access - NOT available to Claude:** no Vercel CLI is installed, no Vercel login or token exists on this machine, and the repo has no `.vercel/` link. Production environment-variable names/values therefore cannot be inspected. Everything below is for the owner to do in the Vercel dashboard (Project `x-padite-app` -> Settings -> Environment Variables), **Environment = Production only**, secrets marked *Sensitive*:
| Variable | Value / source |
|---|---|
| `STRIPE_PRICE_PRO_MONTHLY` | `price_1URziZFpjCSHmRED0l1DwjcA` |
| `STRIPE_PRICE_PRO_YEARLY` | `price_1URgQyFpjCSHmREDhhkBLaNP` |
| `STRIPE_PRICE_3YEAR` | `price_1URgUsFpjCSHmREDYeLN2yTc` |
| `STRIPE_PRICE_LIFETIME` | `price_1URgX9FpjCSHmREDPp36Uj3B` |
| `STRIPE_PORTAL_CONFIGURATION_ID` | `bpc_1USRrPFpjCSHmREDKdWPBgHL` |
| `STRIPE_SECRET_KEY` (secret) | LIVE key from Stripe Dashboard -> Developers -> API keys (standard `sk_live_` or a restricted `rk_live_` with the permissions listed above). Do not reuse the CLI's key. |
| `STRIPE_WEBHOOK_SECRET` (secret) | the signing secret of the LIVE webhook endpoint, revealed once in the Dashboard after the endpoint exists |
| `NEXT_PUBLIC_APP_URL` | `https://x-padite-app.vercel.app` |
Leave `BILLING_LAUNCH_AT`, `BILLING_PAYWALL_DISABLED` and `STRIPE_AUTOMATIC_TAX` unset. Environment-variable changes only affect NEW deployments, so add all of them first and then **Redeploy** the latest production deployment once. **Note:** once a live `STRIPE_SECRET_KEY` and the prices are set, signed-in users can start real LIVE purchases from Settings (the Website purchase flag stays off, and the paywall stays inactive until `BILLING_LAUNCH_AT` is set); set the webhook secret in the same change so no payment can complete without being recorded.

**Still pending (not done):** decision on launching on the `vercel.app` URL vs. adding a custom App domain (changing it later means editing this endpoint's URL, `NEXT_PUBLIC_APP_URL` and the Supabase Auth URLs); setting the production environment variables and redeploying; Stripe Tax activation; optional archiving of the older duplicate Pro Monthly price/product; first small real purchase and refund.

### Production App deployment - discovery (2026-10-19, read-only)
**Existing Vercel App project: YES (confirmed through GitHub and live probes; project ID UNVERIFIED).**
- **Repository:** `https://github.com/TheCraigRicher/XPadite-App` (public), default branch `master`; the local `origin` matches. This is the App repo, separate from the Website.
- **Vercel project:** name `x-padite-app` in scope/team `the-craig-richer` (taken from the Vercel link on the latest commit's deployment status). There is no `.vercel/` folder locally, no Vercel CLI and no stored Vercel login, so the **project ID (`prj_...`)**, attached custom domains, deployment-protection settings and production environment-variable list are **UNVERIFIED** until Vercel access exists.
- **Git integration: ACTIVE.** GitHub's deployment records show `vercel[bot]` creating a **Production** deployment for every push to `master`; the 8 most recent (2026-10-08 to 2026-10-20) are listed, the latest being commit `af34811` (v1.296), state `success`, 2026-10-20 01:04 UTC. **Consequence: every push to `master` deploys straight to production** (the production site already contains the billing code).
- **Verified production URL: `https://x-padite-app.vercel.app`** (also the repo's GitHub `homepage`). Evidence it serves the App and not the Website: `GET /api/billing/status` -> `401 {"error":"Unauthorized"}` (App-specific); `GET /login` -> 200, title "XPadite"; `GET /api/stripe/webhook` -> 405 (route deployed); `Server: Vercel`. The control `https://www.xpadite.com` serves the Website (HTML for the same path).
- **Publicly reachable for Stripe:** an unsigned POST to the production webhook reached the app (HTTP 500 `{"error":"Webhook not configured"}`) - no Vercel auth wall on the production alias. Per-deployment URLs (`x-padite-*-the-craig-richer.vercel.app`) ARE protected by Vercel Authentication and must never be used for webhooks.
- **Observed production environment gap:** that same response means **`STRIPE_WEBHOOK_SECRET` is not set in the deployed production environment** (expected at this stage). Other production variables could not be observed.
- **Custom domain: none verified.** `xpadite.app`, `www.xpadite.app` and `app.xpadite.com` do **not resolve in DNS**; `xpadite.com` redirects to `www.xpadite.com` (the Website).
- **Side effects of this discovery:** none beyond read-only requests; the one unsigned `POST {}` to the production webhook was rejected before any processing (no secret configured) and wrote nothing.

- **Homepage defect found (2026-10-19) - fix prepared locally, NOT yet live:** `https://x-padite-app.vercel.app/` shows the default Next.js starter page because `app/page.tsx` was still the unmodified `create-next-app` file (the real App is at `/app`; nothing linked to `/`). Deployment settings are not at fault. The local fix makes `/` redirect to `/app` (a valid `?plan=` is preserved; signed-out visitors continue to `/login`). Verified locally on a production build (`/` -> `/app` -> `/login`, no starter text; `/login`, `/signup`, billing and Stripe routes unchanged; `tsc`/eslint/build clean). **Production is fixed only after this change is committed, pushed to `master` (which auto-deploys) and re-checked at the production URL.**

**Shortest safe path:** use `https://x-padite-app.vercel.app` for the LIVE webhook and `NEXT_PUBLIC_APP_URL` now (≈15 min). If you prefer a branded domain (e.g. an `app.` subdomain of `xpadite.com`), add it in Vercel and DNS BEFORE launch (≈20-30 min plus DNS propagation) and use it from the start - switching later means updating `NEXT_PUBLIC_APP_URL`, the Supabase Auth Site URL / redirect URLs, the Website's variable and the webhook endpoint URL.

### Final LIVE verification (read-only, 2026-10-19 evening) - Task #2
**1. LIVE Stripe webhook - PASS (independently verified, explicit `--live`):** account `acct_1URewcFpjCSHmRED` matches; endpoint `we_1USSUGFpjCSHmRED2tlHM5EF` is `livemode: true`, `enabled`, URL `https://x-padite-app.vercel.app/api/stripe/webhook`, API version `2026-09-30.endive`, exactly the 12 expected events; it is the account's only endpoint (no duplicates); the API read-back does not expose the signing secret. Nothing was created or modified.

**2. Production webhook probe - PASS:** one unsigned POST with a harmless body -> **HTTP 400 `{"error":"Missing signature"}`** (previously 500 `Webhook not configured`). The route checks for the signing secret *before* the signature header, so this proves the deployed environment now has a non-empty `STRIPE_WEBHOOK_SECRET` loaded and the route reaches signature validation. It does **not** prove the secret value is correct or that signed events are processed.

**3. Production App availability - PASS:** `https://x-padite-app.vercel.app` served by Vercel; `/` -> 307 `/app` -> 307 `/login` -> 200 "XPadite" (no starter page); `/?plan=ltd` keeps the plan; `/login`, `/signup` 200; `/api/billing/status` 401; `/api/stripe/webhook` GET 405. Latest production deployment per GitHub: commit `cced022` "v1.297 - Fix Production App Homepage Redirect and Preserve Plan Routing", state `success`.

**Evidence classes**
| Item | Class |
|---|---|
| LIVE account, 4 prices, portal configuration, webhook endpoint and its 12 events | Independently verified |
| Production deploy `cced022` live; homepage/login/signup routing; webhook route reaching signature validation (secret present) | Independently verified |
| All eight Stripe variables set in Vercel (`STRIPE_SECRET_KEY`, 4x `STRIPE_PRICE_*`, `STRIPE_PORTAL_CONFIGURATION_ID`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_APP_URL`) and the redeploy | Owner-confirmed (only the webhook secret's presence is independently inferable; Vercel is not inspectable from here) |
| Correct live secret key; correct Price IDs and portal ID as deployed; secret *value* matching the endpoint; signed event processing; entitlement creation; refund/dispute revocation in LIVE | **Requires the controlled LIVE transaction (Task #5)** |

**Unresolved / housekeeping:** (a) Stripe Tax is still `pending` with no head-office address; `STRIPE_AUTOMATIC_TAX` is unset, so no tax is calculated on LIVE sales until Tax is activated - a business decision before launch. (b) the temporary `.env.live-webhook-secret.local` was overwritten and **deleted on 2026-10-19** (never committed; no other env file was touched). (c) The duplicate older Pro Monthly price/product is untouched. (d) `BILLING_LAUNCH_AT` unset - paywall inactive; billing is not "activated".

**Task #2 (LIVE Stripe configuration): can be marked COMPLETE.** What remains is Task #5, the controlled LIVE payment test.


### Tax at Checkout (2026-10-19) - automatic tax is NOT ready to activate
**Current behaviour (verified):** Checkout adds **no tax** today. The only tax code in the App is `app/api/stripe/checkout/route.ts`: it sets `automatic_tax: { enabled: true }` and `customer_update: { address: 'auto', name: 'auto' }` **only if `STRIPE_AUTOMATIC_TAX === 'true'`** (billing address collection is already `auto`). The variable is not set in the repo env files and is not among the eight production variables the owner added, so LIVE customers pay exactly the listed price. No tax-related UI exists or was added; prices, Price IDs, billing logic and entitlements are unchanged.

**Pricing model is already correct (verified read-only in LIVE):** all four plan prices are `tax_behavior: exclusive` - Pro Monthly `price_1URziZ...` CA$10.00, Pro Yearly `price_1URgQy...` CA$89.99, 3-Year `price_1URgUs...` CA$199.00, Lifetime `price_1URgX9...` CA$249.00. When tax is calculated Stripe adds it on top (listed price + applicable tax = total). The account default tax behaviour is also `exclusive`.

**Stripe Tax state (verified in LIVE):** status **`pending`**, missing field **`head_office`** (no head-office address); **0 tax registrations**. Products carry tax code `txcd_10103100` ("SaaS - electronic download - personal use") while the account default is `txcd_10103000` ("SaaS - personal use"); XPadite is a web/PWA app, so `txcd_10103000` is probably the more accurate code - to be confirmed with the accountant; changing it is a LIVE product edit that needs approval.

**Minimum configuration for automatic tax to work, in order:**
1. *(owner, ~5 min)* Stripe Dashboard -> Tax -> add the **head-office address** (completes activation; a prerequisite Stripe reports as missing).
2. *(owner/accountant, days-weeks, not code)* Decide whether registration is required and, if so, **register** and add each registration under Tax -> Registrations. Stripe Tax calculates tax only in jurisdictions where a registration exists, and a seller generally may not charge GST/HST or PST without being registered. As an unregistered sole proprietor the owner may qualify as a small supplier for GST (a CRA threshold, currently CA$30,000 over four consecutive calendar quarters) - **but BC PST on software/SaaS and tax on customers outside BC/Canada must be confirmed with an accountant; this is not legal advice.**
3. *(owner, ~5 min)* Set `STRIPE_AUTOMATIC_TAX=true` in Vercel (Production) and redeploy. **No code change is needed.**
4. Run a small controlled LIVE test (Task #5) and confirm the Checkout total shows the tax line.
Stripe Tax is a paid Stripe service (per-transaction fees); enabling it needs owner approval.

**What was verified vs. not:** verified - code path, price tax behaviour, LIVE Stripe Tax status/registrations, and (Sandbox only) that Checkout accepts `automatic_tax` while Tax is pending. **Not verified** - how LIVE Checkout behaves with automatic tax before activation (not tested because it would require creating a LIVE Checkout session). **Decision: keep `STRIPE_AUTOMATIC_TAX` unset and all LIVE settings unchanged until steps 1-2 are done.** Website wording such as "plus applicable taxes" is a Website/legal item, not changed here.

### Remaining before LIVE (ordered, with realistic durations)
| # | Step | Who | Estimate |
|---|---|---|---|
| 1 | Settings "Manage billing" button in a signed-in browser against the Sandbox portal (the only portal check not done) | owner or Claude with a browser tool | 5 min |
| 2 | LIVE Stripe configuration (Task #2): **DONE** - account, prices, portal, webhook endpoint, production variables and redeploy all in place (see "Final LIVE verification"); housekeeping complete (temporary secret file deleted) | - | - |
| 3 | Production environment variables and deploy: **DONE per owner**; webhook secret presence independently confirmed (the deployed webhook now reaches signature validation) | - | - |
| 4 | Decide tax (see "Tax at Checkout"): Stripe Tax head-office address + registrations, then `STRIPE_AUTOMATIC_TAX`; GST/PST registration; BC business-address requirement; Website legal wording and `CHECKOUT_LIVE` | owner / accountant / Website session | days (not code) |
| 5 | **Controlled LIVE payment test (Task #5):** one small real purchase + refund (owner approval required) - the first time signed webhook delivery, LIVE checkout, entitlement activation and refund revocation are exercised end to end; confirm in the dashboard that deliveries to `we_1USSUGFpjCSHmRED2tlHM5EF` return 200 | owner + Claude | 30 min |
| 6 | Set `BILLING_LAUNCH_AT` (ISO with timezone) - the **last** step; then flip Website purchase flag | owner | 5 min |
| 7 | Monitor webhook deliveries, `billing_*` rows and Stripe events for the first days; PWA install check | owner | ongoing |

## A. App implementation

| Item | Status | Owner | Evidence / next action |
|---|---|---|---|
| Stripe integration (checkout, portal, webhook, entitlements, 5-day trial, limited-offer holds) | DONE (Sandbox) | App | Owner-reported: all four plans pass Checkout -> webhook -> entitlement. Verified 2026-10-19: portal, cancellation, full/partial refund, disputes, idempotency (36/36, section 0). Open: browser check of the Settings button, parallel last-slot checkouts. |
| Consolidated billing corrections | DONE | App + Supabase | Current 015/016 pass the isolated suites and are in production (owner-verified SQL result, section 0). |
| Website → App purchase hand-off | PENDING | App | Implemented: `?plan=<key>` survives middleware redirects, signup, login, email verification (stored on the account as `pending_plan`), and `/app` auto-starts Checkout once (`lib/billing/intent.ts`, `PurchaseIntent` in `BillingContext.tsx`). Verified: `tsc`, eslint (0 errors), isolated production build, redirect behaviour via HTTP, unit tests of the intent helpers, signup/login render and carry only valid plans. **Not verified:** a real signed-in account going through to Stripe Checkout, email-verification path, duplicate-session guard in a browser. |
| Google / social sign-in | BLOCKED | App | Not implemented: the Google/Apple/Microsoft buttons have no handlers. The hand-off therefore only covers email + password. If OAuth is added later it must pass the plan the same way (validated `pending_plan` in metadata, or `/auth/callback?next=/app?plan=<key>` — `next` is now validated by `safeNext`). |
| Authentication & entitlement security | PENDING | App | Reviewed, see "Security notes" below. One defect fixed (open redirect in `/auth/callback`); checkout now also requires a verified email. Broader items listed below. |
| Trial-expiration enforcement | PENDING | App + Supabase | Server-side: `paywallResponse` on paid API routes, restrictive RLS write policies (016) on calendar/work/activities/gallery/labels/folders/reminders, gallery upload policy. Needs verification against a real expired test user (section B/C). |
| Account deletion + subscription cancellation | PENDING | App | `DELETE /api/account/delete` cancels Stripe subscriptions first and aborts if it cannot confirm. Still untested against Stripe (needs a signed-in session; not part of the 2026-10-19 run). |

## B. Supabase

| Item | Status | Owner | Evidence / next action |
|---|---|---|---|
| Migration `015_billing.sql` applied | Test: DONE (owner-reported) / Production: **DONE (owner-verified)** | Owner | Evidence recorded in section 0. |
| Migration `016_billing_corrections.sql` applied | Test: DONE (owner-reported) / Production: **DONE (owner-verified)** | Owner | Evidence recorded in section 0. With `BILLING_LAUNCH_AT` unset it changes no behaviour (database fails open). |
| RLS verification | PENDING | Owner | As an expired test user: reads work; inserts/updates on the paywalled tables fail; gallery upload fails; support requests still work. |
| Billing configuration + launch timestamp (`BILLING_LAUNCH_AT`) | PENDING | Owner | Unset = nobody is locked out (by design). Set only at launch (section F). |
| Email confirmation enabled | PENDING | Owner | The hand-off assumes sign-up requires email confirmation. Confirm the setting. No new redirect-URL allow-list entries are needed (no query strings are used in `emailRedirectTo`). |

## C. Stripe test mode

Prices, key, webhook and the four plan flows are **owner-reported done**; the portal is **verified**. The scenarios below have not been exercised with real Stripe events.
- Four test-mode CAD Prices: Pro Monthly 10.00, Pro Yearly 89.99, 3-Year 199.00 (one-time), Lifetime 249.00 (one-time); IDs in `STRIPE_PRICE_PRO_MONTHLY / _PRO_YEARLY / _3YEAR / _LIFETIME`.
- Test secret key + webhook signing secret in the App environment (never in the Website).
- Webhook events to subscribe (from `app/api/stripe/webhook/route.ts`): `checkout.session.completed`, `.async_payment_succeeded`, `.async_payment_failed`, `.expired`; `customer.subscription.created/updated/deleted`; `invoice.paid`, `invoice.payment_failed`; `charge.refunded`; `charge.dispute.closed` (and optionally `charge.dispute.created`).
- Customer Portal configured (cancel at period end; update payment method) - **DONE and verified 2026-10-19** (Sandbox configuration created; verifier and portal sessions tested).
- Tax: decide on `STRIPE_AUTOMATIC_TAX=true` and configure Stripe Tax / registrations.
- Test scenarios: new user buys each of the four plans; signed-in user buys; verification on another device; cancelled checkout; failed card; sold-out limited offer (message shown); already-Lifetime; already-subscribed; payment still processing when returning.
- Refund (full → revoke + release slot; partial → manual review) and dispute (opened ≠ revoke; lost = revoke; won = keep) - **DONE 2026-10-19** with real Sandbox events (see section 0).
- Cancellation (access kept to period end) and one-year price-guarantee recording - **DONE 2026-10-19**. Still untested: renewal invoice, past-due / failed renewal payment.
- Limited-offer concurrency: many parallel checkouts for the last slots never oversell; each offer capped at 100 independently.

## D. Website coordination (Website project)

| Item | Status | Owner | Evidence / next action |
|---|---|---|---|
| Four direct-purchase CTAs wired | PENDING | Website | Wired behind a flag (`NEXT_PUBLIC_DIRECT_PURCHASE`, default OFF) to `<APP_URL>/signup?plan=<key>`; keys match the App allowlist. Not complete while the flag is off and the journey is untested end to end. |
| Correct App destination URL | PENDING | Website | `NEXT_PUBLIC_APP_URL` must be the production App URL: currently `https://x-padite-app.vercel.app` (verified). **The Website's built-in fallback `https://xpadite.app` does NOT resolve in DNS** (verified 2026-10-19), so the Website must set this variable explicitly or its purchase links would be dead. |
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

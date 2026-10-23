/**
 * Billing plan allowlist — the ONLY source of truth for which plans can be
 * purchased. Client-safe (contains no secrets): the browser sends a plan KEY,
 * and the server maps it to a Stripe Price ID read from env. Prices/amounts
 * are never accepted from the client.
 *
 * Premium V2 plans (premium-monthly / premium-yearly) are intentionally absent.
 *
 * v1.300 pricing: Pro 6-Month (CA$39.99 every 6 months) is new; Pro Yearly is CA$65 for NEW purchases; 3-Year Pro is
 * RETIRED for new purchases but its key stays so historical purchases, entitlements, refunds and disputes keep working.
 */

export const BILLING_PLAN_KEYS = ['pro-monthly', 'pro-6month', 'pro-yearly', '3year-pro', 'ltd'] as const
export type BillingPlanKey = (typeof BILLING_PLAN_KEYS)[number]

export interface BillingPlanDef {
  key: BillingPlanKey
  mode: 'subscription' | 'payment'
  /** Name of the server env var holding this plan's existing Stripe Price ID. */
  priceEnv: string
  /** Expected CAD amount in cents — used to verify the configured Price ID is the right one. */
  expectedAmountCents: number
  interval?: 'month' | 'year'
  /** Billing periods per interval for recurring plans (Pro 6-Month = 6 x month). Defaults to 1. */
  intervalCount?: number
  /**
   * No longer sold: new Checkout is refused, but the key (and its env price) stays so historical
   * purchases/entitlements, in-flight sessions, refunds and disputes continue to work.
   */
  retired?: boolean
  /**
   * Optional env var with comma-separated OLDER Price IDs of this plan (e.g. the previous CA$89.99 yearly).
   * Used ONLY to map existing subscriptions to the plan when syncing; never used to start a Checkout.
   */
  legacyPriceEnv?: string
  /** Limited-quantity offer cap (first N customers). */
  cap?: number
}

export const BILLING_CURRENCY = 'cad'
export const TRIAL_DAYS = 5
export const LIMITED_OFFER_CAP = 100

export const BILLING_PLANS: Record<BillingPlanKey, BillingPlanDef> = {
  'pro-monthly': { key: 'pro-monthly', mode: 'subscription', priceEnv: 'STRIPE_PRICE_PRO_MONTHLY', expectedAmountCents: 1000,  interval: 'month' },
  'pro-6month':  { key: 'pro-6month',  mode: 'subscription', priceEnv: 'STRIPE_PRICE_PRO_6MONTH',  expectedAmountCents: 3999,  interval: 'month', intervalCount: 6 },
  'pro-yearly':  { key: 'pro-yearly',  mode: 'subscription', priceEnv: 'STRIPE_PRICE_PRO_YEARLY',  expectedAmountCents: 6500,  interval: 'year',  legacyPriceEnv: 'STRIPE_PRICE_PRO_YEARLY_LEGACY' },
  '3year-pro':   { key: '3year-pro',   mode: 'payment',      priceEnv: 'STRIPE_PRICE_3YEAR',       expectedAmountCents: 19900, cap: LIMITED_OFFER_CAP, retired: true },
  'ltd':         { key: 'ltd',         mode: 'payment',      priceEnv: 'STRIPE_PRICE_LIFETIME',    expectedAmountCents: 24900, cap: LIMITED_OFFER_CAP },
}

export function isBillingPlanKey(v: unknown): v is BillingPlanKey {
  return typeof v === 'string' && (BILLING_PLAN_KEYS as readonly string[]).includes(v)
}

/** A plan that may start a NEW Checkout (a known plan that has not been retired). */
export function isPurchasablePlanKey(v: unknown): v is BillingPlanKey {
  return isBillingPlanKey(v) && !BILLING_PLANS[v].retired
}

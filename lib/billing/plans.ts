/**
 * Billing plan allowlist — the ONLY source of truth for which plans can be
 * purchased. Client-safe (contains no secrets): the browser sends a plan KEY,
 * and the server maps it to a Stripe Price ID read from env. Prices/amounts
 * are never accepted from the client.
 *
 * Premium V2 plans (premium-monthly / premium-yearly) are intentionally absent.
 */

export const BILLING_PLAN_KEYS = ['pro-monthly', 'pro-yearly', '3year-pro', 'ltd'] as const
export type BillingPlanKey = (typeof BILLING_PLAN_KEYS)[number]

export interface BillingPlanDef {
  key: BillingPlanKey
  mode: 'subscription' | 'payment'
  /** Name of the server env var holding this plan's existing Stripe Price ID. */
  priceEnv: string
  /** Expected CAD amount in cents — used to verify the configured Price ID is the right one. */
  expectedAmountCents: number
  interval?: 'month' | 'year'
  /** Limited-quantity offer cap (first N customers). */
  cap?: number
}

export const BILLING_CURRENCY = 'cad'
export const TRIAL_DAYS = 5
export const LIMITED_OFFER_CAP = 100

export const BILLING_PLANS: Record<BillingPlanKey, BillingPlanDef> = {
  'pro-monthly': { key: 'pro-monthly', mode: 'subscription', priceEnv: 'STRIPE_PRICE_PRO_MONTHLY', expectedAmountCents: 1000,  interval: 'month' },
  'pro-yearly':  { key: 'pro-yearly',  mode: 'subscription', priceEnv: 'STRIPE_PRICE_PRO_YEARLY',  expectedAmountCents: 8999,  interval: 'year' },
  '3year-pro':   { key: '3year-pro',   mode: 'payment',      priceEnv: 'STRIPE_PRICE_3YEAR',       expectedAmountCents: 19900, cap: LIMITED_OFFER_CAP },
  'ltd':         { key: 'ltd',         mode: 'payment',      priceEnv: 'STRIPE_PRICE_LIFETIME',    expectedAmountCents: 24900, cap: LIMITED_OFFER_CAP },
}

export function isBillingPlanKey(v: unknown): v is BillingPlanKey {
  return typeof v === 'string' && (BILLING_PLAN_KEYS as readonly string[]).includes(v)
}

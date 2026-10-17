import Stripe from 'stripe'
import { BILLING_CURRENCY, BILLING_PLANS, type BillingPlanKey } from './plans'

// Server-only module (reads STRIPE_SECRET_KEY). Never import from client components.

let cached: Stripe | null = null

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured')
  if (!cached) cached = new Stripe(key)
  return cached
}

/** true when the configured secret key is a live-mode key. */
export function isLiveKey(): boolean {
  return (process.env.STRIPE_SECRET_KEY ?? '').startsWith('sk_live_')
}

export function getPriceId(planKey: BillingPlanKey): string {
  const id = process.env[BILLING_PLANS[planKey].priceEnv]
  if (!id) throw new Error(`${BILLING_PLANS[planKey].priceEnv} is not configured`)
  return id
}

/** Reverse lookup: Stripe Price ID → our plan key (null for unknown/foreign prices). */
export function planKeyForPriceId(priceId: string): BillingPlanKey | null {
  for (const def of Object.values(BILLING_PLANS)) {
    if (process.env[def.priceEnv] === priceId) return def.key
  }
  return null
}

/**
 * Confirms the configured Price ID really is the expected XPadite price:
 * active, CAD, correct amount, correct recurring/one-time type, and in the
 * same live/test mode as the secret key (so test IDs cannot silently be mixed
 * with a live key, or vice versa).
 */
export async function verifyPlanPrice(planKey: BillingPlanKey): Promise<string> {
  const def = BILLING_PLANS[planKey]
  const priceId = getPriceId(planKey)
  const price = await getStripe().prices.retrieve(priceId)

  if (!price.active) throw new Error(`Price for ${planKey} is not active`)
  if (price.livemode !== isLiveKey()) throw new Error(`Price for ${planKey} is in a different Stripe mode than the API key`)
  if (price.currency !== BILLING_CURRENCY) throw new Error(`Price for ${planKey} is not CAD`)
  if (price.unit_amount !== def.expectedAmountCents) throw new Error(`Price for ${planKey} has an unexpected amount`)
  const isRecurring = price.type === 'recurring'
  if ((def.mode === 'subscription') !== isRecurring) throw new Error(`Price for ${planKey} has the wrong billing type`)
  if (def.interval && price.recurring?.interval !== def.interval) throw new Error(`Price for ${planKey} has the wrong interval`)
  return priceId
}

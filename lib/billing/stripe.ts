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

/**
 * Stripe mode of the configured secret key. Recognises standard (sk_) and
 * restricted (rk_) keys, live and test. Anything else is unsupported and fails
 * closed (null) rather than guessing a mode.
 */
export function stripeKeyMode(): 'live' | 'test' | null {
  const key = process.env.STRIPE_SECRET_KEY ?? ''
  if (/^(sk|rk)_live_/.test(key)) return 'live'
  if (/^(sk|rk)_test_/.test(key)) return 'test'
  return null
}

/** true when the configured secret key is a live-mode key (sk_live_ or rk_live_). */
export function isLiveKey(): boolean {
  return stripeKeyMode() === 'live'
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
  if (stripeKeyMode() === null) throw new Error('STRIPE_SECRET_KEY is not a supported Stripe key type')
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

let portalCheck: { id: string; at: number } | null = null

/**
 * Returns a Customer Portal configuration id that has plan switching/downgrades
 * DISABLED (cancellation and payment-method management remain allowed).
 * Uses STRIPE_PORTAL_CONFIGURATION_ID, or the account's default configuration,
 * and refuses (throws) if subscription updates are enabled — so unapproved
 * upgrade / proration / plan-switching workflows can never be exposed. This
 * only READS Stripe settings; it never changes them.
 */
export async function getVerifiedPortalConfigurationId(): Promise<string> {
  if (portalCheck && Date.now() - portalCheck.at < 5 * 60_000) return portalCheck.id
  const stripe = getStripe()
  const explicit = process.env.STRIPE_PORTAL_CONFIGURATION_ID
  const config = explicit
    ? await stripe.billingPortal.configurations.retrieve(explicit)
    : (await stripe.billingPortal.configurations.list({ is_default: true, limit: 1 })).data[0]
  if (!config) throw new Error('No Customer Portal configuration found — create one in the Stripe Dashboard')
  if (!config.active) throw new Error('Customer Portal configuration is not active')
  if (config.livemode !== isLiveKey()) throw new Error('Customer Portal configuration is in a different Stripe mode than the API key')
  if (config.features.subscription_update.enabled) {
    // Covers plan switching AND quantity changes (both are subscription updates).
    throw new Error('Customer Portal allows subscription switching — disable "Customers can switch plans" in the Dashboard')
  }
  const cancel = config.features.subscription_cancel
  if (cancel?.enabled && cancel.mode !== 'at_period_end') {
    // Immediate cancellation would cut off paid-for time and invite proration/refund handling we do not offer.
    throw new Error('Customer Portal must cancel subscriptions at the END of the billing period, not immediately')
  }
  portalCheck = { id: config.id, at: Date.now() }
  return config.id
}

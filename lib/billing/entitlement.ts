import type { SupabaseClient } from '@supabase/supabase-js'
import { TRIAL_DAYS, type BillingPlanKey } from './plans'
import type { BillingStatus } from './types'

const ACCESS_SUB_STATUSES = new Set(['active', 'trialing', 'past_due'])

/**
 * Computes the user's access from stored (webhook-verified) billing rows plus
 * the trial window (profiles.created_at + 5 days). The checkout success URL
 * never feeds into this — only rows written from verified Stripe state can
 * grant paid access.
 *
 * The best entitlement wins, so a repeat/duplicate purchase can never shorten
 * or remove another valid entitlement: lifetime > longest-running 3-year/subscription.
 */
export async function getBillingStatus(
  admin: SupabaseClient,
  userId: string,
  fallbackCreatedAt?: string,
): Promise<BillingStatus> {
  const nowMs = Date.now()

  const [profileRes, subsRes, purchasesRes, customerRes] = await Promise.all([
    admin.from('profiles').select('created_at').eq('id', userId).maybeSingle(),
    admin.from('billing_subscriptions').select('plan_key,status,current_period_end,cancel_at_period_end').eq('user_id', userId),
    admin.from('billing_purchases').select('plan_key,status,access_expires_at').eq('user_id', userId).eq('status', 'paid'),
    admin.from('billing_customers').select('stripe_customer_id').eq('user_id', userId).maybeSingle(),
  ])

  const createdAt = (profileRes.data as { created_at?: string } | null)?.created_at ?? fallbackCreatedAt ?? new Date(nowMs).toISOString()
  const trialEndsMs = new Date(createdAt).getTime() + TRIAL_DAYS * 86_400_000

  let lifetime = false
  let plan: BillingPlanKey | null = null
  let endsMs: number | null = null
  let pastDue = false
  let cancelAtPeriodEnd = false

  for (const p of (purchasesRes.data ?? []) as { plan_key: string; access_expires_at: string | null }[]) {
    if (p.plan_key === 'ltd') { lifetime = true; plan = 'ltd'; endsMs = null; break }
    if (p.plan_key === '3year-pro' && p.access_expires_at) {
      const e = new Date(p.access_expires_at).getTime()
      if (e > nowMs && (endsMs === null || e > endsMs)) { plan = '3year-pro'; endsMs = e }
    }
  }

  if (!lifetime) {
    for (const s of (subsRes.data ?? []) as { plan_key: string; status: string; current_period_end: string | null; cancel_at_period_end: boolean }[]) {
      if (!ACCESS_SUB_STATUSES.has(s.status)) continue
      const e = s.current_period_end ? new Date(s.current_period_end).getTime() : nowMs
      if (plan === null || endsMs === null || e > endsMs) {
        plan = s.plan_key as BillingPlanKey
        endsMs = e
        pastDue = s.status === 'past_due'
        cancelAtPeriodEnd = s.cancel_at_period_end
      }
    }
  }

  const paid = lifetime || plan !== null
  const inTrial = nowMs < trialEndsMs
  const paywallDisabled = process.env.BILLING_PAYWALL_DISABLED === 'true'
  const state: BillingStatus['state'] = paid ? 'paid' : inTrial ? 'trial' : 'expired'

  return {
    hasAccess: state !== 'expired' || paywallDisabled,
    state,
    plan,
    lifetime,
    accessEndsAt: !lifetime && endsMs ? new Date(endsMs).toISOString() : null,
    trialEndsAt: new Date(trialEndsMs).toISOString(),
    pastDue,
    cancelAtPeriodEnd,
    hasStripeCustomer: !!(customerRes.data as { stripe_customer_id?: string } | null)?.stripe_customer_id,
    paywallDisabled,
  }
}

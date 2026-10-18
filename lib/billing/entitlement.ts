import type { SupabaseClient, User } from '@supabase/supabase-js'
import { TRIAL_DAYS, type BillingPlanKey } from './plans'
import { getBillingLaunchAt, isPaywallDisabled } from './config'
import type { BillingStatus } from './types'

// Server-only. Keep in step with public.billing_has_access() in migration 016.

const ACCESS_SUB_STATUSES = new Set(['active', 'trialing', 'past_due'])

/** Verified account-activation time: email confirmation (also set for Google OAuth), else creation. */
export function activationTime(user: Pick<User, 'email_confirmed_at' | 'created_at'>): Date {
  return new Date(user.email_confirmed_at ?? user.created_at)
}

/**
 * Trial window: 5 days from max(account activation, billing launch). Existing
 * accounts therefore get a fresh trial starting at launch; new accounts start
 * at verified activation. Both timestamps are immutable, so repeat logins or
 * reinstalls never reset it. Returns null while no valid launch date exists.
 */
export function trialEndsAt(user: Pick<User, 'email_confirmed_at' | 'created_at'>): Date | null {
  const launch = getBillingLaunchAt()
  if (!launch) return null
  const start = Math.max(activationTime(user).getTime(), launch.getTime())
  return new Date(start + TRIAL_DAYS * 86_400_000)
}

/**
 * Computes the user's access from stored (webhook-verified) billing rows plus
 * the trial window. The checkout success URL never feeds into this — only rows
 * written from verified Stripe state can grant paid access.
 *
 * The best entitlement wins, so a repeat/duplicate purchase can never shorten
 * or remove another valid entitlement: lifetime > longest-running 3-year/subscription.
 */
export async function getBillingStatus(
  admin: SupabaseClient,
  user: Pick<User, 'id' | 'email_confirmed_at' | 'created_at'>,
): Promise<BillingStatus> {
  const nowMs = Date.now()

  const [subsRes, purchasesRes, customerRes] = await Promise.all([
    admin.from('billing_subscriptions').select('plan_key,status,current_period_end,cancel_at_period_end').eq('user_id', user.id),
    admin.from('billing_purchases').select('plan_key,status,access_expires_at').eq('user_id', user.id).eq('status', 'paid'),
    admin.from('billing_customers').select('stripe_customer_id').eq('user_id', user.id).maybeSingle(),
  ])

  const trialEnd = trialEndsAt(user)

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
  const enforcementActive = trialEnd !== null && !isPaywallDisabled()
  // Without an enforced paywall, unpaid users count as "in trial" (never locked out).
  const inTrial = !enforcementActive || nowMs < trialEnd!.getTime()
  const state: BillingStatus['state'] = paid ? 'paid' : inTrial ? 'trial' : 'expired'

  return {
    hasAccess: state !== 'expired',
    state,
    plan,
    lifetime,
    accessEndsAt: !lifetime && endsMs ? new Date(endsMs).toISOString() : null,
    trialEndsAt: trialEnd ? trialEnd.toISOString() : null,
    pastDue,
    cancelAtPeriodEnd,
    hasStripeCustomer: !!(customerRes.data as { stripe_customer_id?: string } | null)?.stripe_customer_id,
    enforcementActive,
  }
}

/**
 * Premium V2 AI entitlement. No Pro plan (Monthly/Yearly/3-Year/Lifetime) and
 * not the free trial confers AI access — Premium V2 is "coming soon" and is not
 * sold. Until it ships, only user ids explicitly listed in
 * AI_COACH_ALLOWED_USER_IDS (comma-separated; internal testing) pass. When
 * Premium V2 billing exists, its entitlement check belongs here.
 */
export function hasAiEntitlement(userId: string): boolean {
  const allowed = (process.env.AI_COACH_ALLOWED_USER_IDS ?? '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  return allowed.includes(userId.toLowerCase())
}

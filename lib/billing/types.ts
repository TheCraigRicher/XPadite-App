import type { BillingPlanKey } from './plans'

/** Server-computed billing/access status returned to the client. */
export interface BillingStatus {
  /** true = user may use paid productivity features right now. */
  hasAccess: boolean
  /** paid = active entitlement · trial = inside the 5-day trial · expired = neither. */
  state: 'paid' | 'trial' | 'expired'
  plan: BillingPlanKey | null
  lifetime: boolean
  /** End of paid access (period end / 3-year expiry); null for lifetime or no paid access. */
  accessEndsAt: string | null
  /** null until BILLING_LAUNCH_AT is configured (trials start at launch). */
  trialEndsAt: string | null
  pastDue: boolean
  cancelAtPeriodEnd: boolean
  hasStripeCustomer: boolean
  /** false when the launch date is unset/invalid or the kill switch is on — nobody is locked out. */
  enforcementActive: boolean
  /** Server time when this status was computed (status API only) — used to correct the device clock for countdowns. */
  serverNow?: string
}

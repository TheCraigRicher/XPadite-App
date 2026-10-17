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
  trialEndsAt: string
  pastDue: boolean
  cancelAtPeriodEnd: boolean
  hasStripeCustomer: boolean
  /** Kill switch (BILLING_PAYWALL_DISABLED=true) — access granted even when expired. */
  paywallDisabled: boolean
}

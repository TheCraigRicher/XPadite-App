// Billing conversion events for PostHog, derived ONLY from signature-verified Stripe webhook events that the existing
// handler has already processed successfully (see app/api/stripe/webhook/route.ts). The checkout success page never
// produces one. Server-only.
//
// Duplicates: the webhook's own idempotency table skips an event id that was already processed, and each event below
// also carries a UUID derived from a stable Stripe id (checkout session / subscription), so even a redelivery under a
// new event id (e.g. checkout.session.completed AND async_payment_succeeded) maps to one PostHog event.
//
// Properties are business facts only — plan key, mode, amount, currency. No email, name or card data.

import type Stripe from 'stripe'
import { isBillingPlanKey } from '@/lib/billing/plans'
import { captureForUser } from './server'

const userIdFrom = (meta: Stripe.Metadata | null | undefined, fallback?: string | null): string | null =>
  meta?.user_id || fallback || null

export async function trackBillingEvent(event: Stripe.Event): Promise<void> {
  try {
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        const s = event.data.object as Stripe.Checkout.Session
        if (s.payment_status !== 'paid') return // async payment still pending: the later success event reports it
        const userId = userIdFrom(s.metadata, s.client_reference_id)
        const plan = s.metadata?.plan_key
        if (!userId || !plan || !isBillingPlanKey(plan)) return
        await captureForUser(
          userId,
          'purchase_completed',
          {
            plan_id: plan,
            mode: s.mode === 'subscription' ? 'subscription' : 'one_time',
            value: typeof s.amount_total === 'number' ? s.amount_total / 100 : undefined,
            currency: s.currency?.toUpperCase(),
          },
          `purchase:${s.id}`,
        )
        return
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription
        const userId = userIdFrom(sub.metadata)
        if (!userId) return
        const plan = sub.metadata?.plan_key
        await captureForUser(
          userId,
          'subscription_cancelled',
          { plan_id: plan && isBillingPlanKey(plan) ? plan : undefined, cancellation_type: 'ended' },
          `sub-cancelled-ended:${sub.id}`,
        )
        return
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription
        const was = (event.data.previous_attributes as { cancel_at_period_end?: boolean } | undefined)?.cancel_at_period_end
        // Cancellation requested now; access continues until the period ends (the later `deleted` event is 'ended').
        if (!(sub.cancel_at_period_end && was === false)) return
        const userId = userIdFrom(sub.metadata)
        if (!userId) return
        const plan = sub.metadata?.plan_key
        await captureForUser(
          userId,
          'subscription_cancelled',
          { plan_id: plan && isBillingPlanKey(plan) ? plan : undefined, cancellation_type: 'scheduled' },
          `sub-cancelled-scheduled:${sub.id}:${event.id}`,
        )
        return
      }

      default:
        return
    }
  } catch {
    /* analytics must never affect webhook handling */
  }
}

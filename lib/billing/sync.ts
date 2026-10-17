import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import { BILLING_CURRENCY, BILLING_PLANS, isBillingPlanKey } from './plans'
import { getPriceId, getStripe, planKeyForPriceId } from './stripe'

// Server-only. All writes use the service-role client and are derived from
// Stripe-confirmed state (fresh API retrieves), so retries and out-of-order
// webhook delivery converge on the same result.

const iso = (unixSeconds: number | null | undefined) =>
  unixSeconds ? new Date(unixSeconds * 1000).toISOString() : null

const idOf = (v: string | { id: string } | null | undefined) => (typeof v === 'string' ? v : v?.id ?? null)

async function userIdForCustomer(admin: SupabaseClient, stripeCustomerId: string): Promise<string | null> {
  const { data } = await admin.from('billing_customers').select('user_id').eq('stripe_customer_id', stripeCustomerId).maybeSingle()
  return (data as { user_id?: string } | null)?.user_id ?? null
}

/** Re-reads the subscription from Stripe and mirrors it into billing_subscriptions. */
export async function syncSubscription(admin: SupabaseClient, subscriptionId: string): Promise<void> {
  const sub = await getStripe().subscriptions.retrieve(subscriptionId)
  const item = sub.items.data[0]
  const priceId = item?.price.id
  const planKey = priceId ? planKeyForPriceId(priceId) : null
  if (!item || !priceId || !planKey) {
    console.warn('[Billing] Ignoring subscription not matching a configured XPadite price:', sub.id)
    return
  }

  const customerId = idOf(sub.customer)
  if (!customerId) throw new Error(`Subscription ${sub.id} has no customer`)
  const userId = sub.metadata?.user_id || (await userIdForCustomer(admin, customerId))
  if (!userId) throw new Error(`Cannot resolve XPadite user for subscription ${sub.id}`)

  const { error } = await admin.from('billing_subscriptions').upsert({
    stripe_subscription_id: sub.id,
    user_id: userId,
    stripe_customer_id: customerId,
    plan_key: planKey,
    stripe_price_id: priceId,
    status: sub.status,
    current_period_end: iso(item.current_period_end),
    cancel_at_period_end: sub.cancel_at_period_end,
    canceled_at: iso(sub.canceled_at),
    synced_at: new Date().toISOString(),
  }, { onConflict: 'stripe_subscription_id' })
  if (error) throw new Error(`billing_subscriptions upsert failed: ${error.message}`)
}

/**
 * Verifies a Checkout Session with Stripe and, if genuinely paid, activates
 * the entitlement. Idempotent: safe from webhook retries, duplicate events
 * and the post-checkout reconcile call. Returns whether access was confirmed.
 */
export async function grantFromCheckoutSession(admin: SupabaseClient, sessionId: string): Promise<'granted' | 'unpaid' | 'ignored'> {
  const session = await getStripe().checkout.sessions.retrieve(sessionId, { expand: ['line_items'] })

  if (session.mode === 'subscription') {
    const subId = idOf(session.subscription as string | { id: string } | null)
    if (!subId) return 'unpaid'
    await syncSubscription(admin, subId)
    return 'granted'
  }
  if (session.mode !== 'payment') return 'ignored'
  if (session.payment_status !== 'paid') return 'unpaid'

  const planKey = session.metadata?.plan_key
  if (!isBillingPlanKey(planKey) || BILLING_PLANS[planKey].mode !== 'payment') return 'ignored'
  if (session.currency !== BILLING_CURRENCY) throw new Error(`Session ${session.id} is not CAD`)

  // The paid line item must be exactly the configured Price ID for this plan.
  const expectedPrice = getPriceId(planKey)
  const paidPrice = session.line_items?.data?.[0]?.price?.id
  if (paidPrice !== expectedPrice) throw new Error(`Session ${session.id} price does not match plan ${planKey}`)

  const userId = session.client_reference_id || session.metadata?.user_id
  if (!userId) throw new Error(`Session ${session.id} has no user reference`)
  const paymentIntentId = idOf(session.payment_intent as string | { id: string } | null)

  // Find the reservation made at checkout start; create a row if missing (they did pay).
  let { data: row } = await admin.from('billing_purchases').select('id,status').eq('stripe_checkout_session_id', session.id).maybeSingle()
  if (!row) {
    const ins = await admin.from('billing_purchases').insert({
      user_id: userId, plan_key: planKey, stripe_price_id: expectedPrice,
      stripe_checkout_session_id: session.id, status: 'pending',
    }).select('id,status').single()
    if (ins.error) throw new Error(`billing_purchases insert failed: ${ins.error.message}`)
    row = ins.data
  }
  const purchase = row as { id: string; status: string }
  if (purchase.status === 'paid' || purchase.status === 'refunded' || purchase.status === 'disputed') return 'granted'

  // Access window: 3-Year starts at purchase, or when an existing 3-Year ends
  // (stacking, so a repeat purchase never shortens existing access). Lifetime has no expiry.
  let accessExpiresAt: string | null = null
  if (planKey === '3year-pro') {
    const { data: others } = await admin.from('billing_purchases').select('access_expires_at')
      .eq('user_id', userId).eq('plan_key', '3year-pro').eq('status', 'paid').neq('id', purchase.id)
    const now = Date.now()
    const latest = ((others ?? []) as { access_expires_at: string | null }[])
      .reduce((m, o) => Math.max(m, o.access_expires_at ? new Date(o.access_expires_at).getTime() : 0), 0)
    const start = new Date(Math.max(now, latest))
    start.setUTCFullYear(start.getUTCFullYear() + 3)
    accessExpiresAt = start.toISOString()
  }

  // Conditional update guards against a concurrent duplicate event double-granting.
  const { error } = await admin.from('billing_purchases').update({
    status: 'paid',
    stripe_payment_intent_id: paymentIntentId,
    amount_total: session.amount_total,
    currency: session.currency,
    granted_at: new Date().toISOString(),
    access_expires_at: accessExpiresAt,
    reserved_until: null,
    updated_at: new Date().toISOString(),
  }).eq('id', purchase.id).in('status', ['pending', 'expired'])
  if (error) throw new Error(`billing_purchases grant failed: ${error.message}`)
  return 'granted'
}

/** Releases a pending reservation (abandoned / expired / async-failed checkout). */
export async function expireCheckoutSession(admin: SupabaseClient, sessionId: string): Promise<void> {
  await admin.from('billing_purchases').update({ status: 'expired', reserved_until: null, updated_at: new Date().toISOString() })
    .eq('stripe_checkout_session_id', sessionId).eq('status', 'pending')
}

/** Revokes a one-time purchase after a full refund or a dispute. */
export async function revokePurchaseByPaymentIntent(
  admin: SupabaseClient,
  paymentIntent: string | { id: string } | null | undefined,
  newStatus: 'refunded' | 'disputed',
): Promise<void> {
  const pi = idOf(paymentIntent)
  if (!pi) return
  await admin.from('billing_purchases').update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq('stripe_payment_intent_id', pi).eq('status', 'paid')
}

export function subscriptionIdFromInvoice(invoice: Stripe.Invoice): string | null {
  return idOf(invoice.parent?.subscription_details?.subscription as string | { id: string } | null | undefined)
}

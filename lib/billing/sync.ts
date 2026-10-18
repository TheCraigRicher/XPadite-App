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

const FK_VIOLATION = '23503'

async function userIdForCustomer(admin: SupabaseClient, stripeCustomerId: string): Promise<string | null> {
  const { data } = await admin.from('billing_customers').select('user_id').eq('stripe_customer_id', stripeCustomerId).maybeSingle()
  return (data as { user_id?: string } | null)?.user_id ?? null
}

// ─── Subscriptions ────────────────────────────────────────────────────────────

/**
 * Early-adopter price guarantee: a Pro Monthly/Yearly subscriber keeps the
 * price agreed at checkout for at least one year from the first qualifying
 * purchase. Stripe subscriptions stay on their original Price, and nothing in
 * this app migrates anyone to another Price — this records the guaranteed rate
 * and its expiry. Set once, on first sight of the subscription; never rewritten.
 * Optional EARLY_ADOPTER_OFFER_ENDS_AT (ISO) closes the offer window; unset =
 * every subscription qualifies. The guarantee does not apply to one-time plans.
 */
function earlyAdopterLock(sub: Stripe.Subscription, priceId: string, unitAmount: number | null) {
  const start = new Date(sub.start_date * 1000)
  const endsRaw = process.env.EARLY_ADOPTER_OFFER_ENDS_AT
  const endsAt = endsRaw ? new Date(endsRaw) : null
  const qualifies = !endsAt || Number.isNaN(endsAt.getTime()) || start.getTime() < endsAt.getTime()
  if (!qualifies) return { early_adopter: false }
  const until = new Date(start)
  until.setUTCFullYear(until.getUTCFullYear() + 1)
  return {
    early_adopter: true,
    locked_price_id: priceId,
    locked_amount_cents: unitAmount,
    price_locked_until: until.toISOString(),
  }
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

  const { data: existing } = await admin.from('billing_subscriptions')
    .select('user_id,locked_price_id,price_locked_until').eq('stripe_subscription_id', sub.id).maybeSingle()
  const prior = existing as { user_id: string | null; locked_price_id: string | null; price_locked_until: string | null } | null

  // The owning account may already be deleted — never make webhook handling depend on it.
  let userId: string | null = prior?.user_id ?? sub.metadata?.user_id ?? (await userIdForCustomer(admin, customerId))
  if (!userId && !prior) {
    console.warn('[Billing] Subscription has no resolvable XPadite user (account deleted?); recording without a user:', sub.id)
  }

  if (prior?.locked_price_id && prior.price_locked_until && new Date(prior.price_locked_until) > new Date() && prior.locked_price_id !== priceId) {
    console.warn(`[Billing] Price changed during the early-adopter guarantee period for ${sub.id} — review required`)
  }

  const base = {
    stripe_subscription_id: sub.id,
    stripe_customer_id: customerId,
    plan_key: planKey,
    stripe_price_id: priceId,
    status: sub.status,
    current_period_end: iso(item.current_period_end),
    cancel_at_period_end: sub.cancel_at_period_end,
    canceled_at: iso(sub.canceled_at),
    synced_at: new Date().toISOString(),
    ...(prior ? {} : earlyAdopterLock(sub, priceId, item.price.unit_amount)),
  }

  let { error } = await admin.from('billing_subscriptions').upsert({ ...base, user_id: userId }, { onConflict: 'stripe_subscription_id' })
  if (error?.code === FK_VIOLATION) {
    userId = null
    ;({ error } = await admin.from('billing_subscriptions').upsert(
      { ...base, user_id: null, user_deleted_at: new Date().toISOString() }, { onConflict: 'stripe_subscription_id' }))
  }
  if (error) throw new Error(`billing_subscriptions upsert failed: ${error.message}`)
}

/**
 * After a confirmed 3-Year or Lifetime purchase, stop any active subscription
 * from renewing — at period end, so the customer keeps the access they already
 * paid for. No proration, credit or refund is created. Idempotent.
 */
async function stopRecurringAfterLongTermPurchase(admin: SupabaseClient, userId: string): Promise<void> {
  const { data } = await admin.from('billing_subscriptions').select('stripe_subscription_id')
    .eq('user_id', userId).in('status', ['active', 'trialing', 'past_due']).eq('cancel_at_period_end', false)
  const stripe = getStripe()
  for (const row of (data ?? []) as { stripe_subscription_id: string }[]) {
    await stripe.subscriptions.update(row.stripe_subscription_id, { cancel_at_period_end: true })
    await syncSubscription(admin, row.stripe_subscription_id)
  }
}

// ─── One-time purchases ───────────────────────────────────────────────────────

/** What Stripe currently says about a one-time payment, so a refund/dispute that
 *  arrived before synchronisation can never become an active entitlement. */
async function paymentOutcome(paymentIntentId: string | null): Promise<{ status: 'paid' | 'refunded' | 'disputed'; partialRefund: boolean }> {
  if (!paymentIntentId) return { status: 'paid', partialRefund: false }
  const stripe = getStripe()
  const pi = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ['latest_charge'] })
  const charge = pi.latest_charge && typeof pi.latest_charge !== 'string' ? pi.latest_charge : null
  if (!charge) return { status: 'paid', partialRefund: false }
  if (charge.refunded) return { status: 'refunded', partialRefund: false }
  if (charge.disputed) {
    const disputes = await stripe.disputes.list({ charge: charge.id, limit: 5 })
    if (disputes.data.some(d => d.status === 'lost')) return { status: 'disputed', partialRefund: false }
  }
  return { status: 'paid', partialRefund: charge.amount_refunded > 0 }
}

export type GrantResult = 'granted' | 'unpaid' | 'ignored' | 'review' | 'revoked'

/**
 * Verifies a Checkout Session with Stripe and, if genuinely paid, activates the
 * entitlement. Idempotent: safe from webhook retries, duplicate events and the
 * post-checkout reconcile call.
 *
 * Limited offers: the 100-customer cap is enforced inside the database under a
 * lock (billing_confirm_purchase), including the late-payment and no-hold
 * fallback paths. If the payment succeeded but no slot can legitimately be
 * granted, the purchase is recorded as status 'review' (needs_review) — access
 * is NOT granted and NO refund is issued; it is flagged for manual handling.
 */
export async function grantFromCheckoutSession(admin: SupabaseClient, sessionId: string): Promise<GrantResult> {
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
  const plan = BILLING_PLANS[planKey]
  if (session.currency !== BILLING_CURRENCY) throw new Error(`Session ${session.id} is not CAD`)

  // The paid line item must be exactly the configured Price ID for this plan.
  const expectedPrice = getPriceId(planKey)
  const paidPrice = session.line_items?.data?.[0]?.price?.id
  if (paidPrice !== expectedPrice) throw new Error(`Session ${session.id} price does not match plan ${planKey}`)

  const userId = session.client_reference_id || session.metadata?.user_id
  if (!userId) throw new Error(`Session ${session.id} has no user reference`)
  const paymentIntentId = idOf(session.payment_intent as string | { id: string } | null)
  const outcome = await paymentOutcome(paymentIntentId)

  // 3-Year starts at purchase, or when an existing 3-Year ends (stacking), so a
  // repeat purchase never shortens existing access. Lifetime has no expiry.
  let accessExpiresAt: string | null = null
  if (planKey === '3year-pro' && outcome.status === 'paid') {
    const { data: others } = await admin.from('billing_purchases').select('access_expires_at')
      .eq('user_id', userId).eq('plan_key', '3year-pro').eq('status', 'paid')
    const latest = ((others ?? []) as { access_expires_at: string | null }[])
      .reduce((m, o) => Math.max(m, o.access_expires_at ? new Date(o.access_expires_at).getTime() : 0), 0)
    const start = new Date(Math.max(Date.now(), latest))
    start.setUTCFullYear(start.getUTCFullYear() + 3)
    accessExpiresAt = start.toISOString()
  }

  const { data: result, error } = await admin.rpc('billing_confirm_purchase', {
    p_session_id: session.id,
    p_user_id: userId,
    p_plan_key: planKey,
    p_price_id: expectedPrice,
    p_payment_intent: paymentIntentId,
    p_amount: session.amount_total,
    p_currency: session.currency,
    p_cap: plan.cap ?? 2147483647,
    p_access_expires: accessExpiresAt,
    p_final_status: outcome.status,
  })
  if (error) throw new Error(`billing_confirm_purchase failed: ${error.message}`)
  const verdict = String(result)

  if (verdict === 'review' || verdict === 'already_review') {
    console.error(`[Billing] ATTENTION: payment succeeded but ${planKey} could not be granted (session ${session.id}). Flagged needs_review; no access granted, no refund issued.`)
    return 'review'
  }
  if (verdict === 'refunded' || verdict === 'disputed' || verdict === 'already_refunded' || verdict === 'already_disputed') return 'revoked'

  // 'paid' or 'already_paid'
  if (outcome.partialRefund && paymentIntentId) await flagPartialRefund(admin, paymentIntentId)
  await stopRecurringAfterLongTermPurchase(admin, userId)
  return 'granted'
}

/** Releases a pending reservation (abandoned / expired / async-failed checkout). */
export async function expireCheckoutSession(admin: SupabaseClient, sessionId: string): Promise<void> {
  await admin.from('billing_purchases').update({ status: 'expired', reserved_until: null, updated_at: new Date().toISOString() })
    .eq('stripe_checkout_session_id', sessionId).eq('status', 'pending')
}

async function flagPartialRefund(admin: SupabaseClient, paymentIntentId: string): Promise<void> {
  await admin.from('billing_purchases').update({ needs_review: true, review_reason: 'partial_refund', updated_at: new Date().toISOString() })
    .eq('stripe_payment_intent_id', paymentIntentId).eq('status', 'paid')
}

/** Rows for a payment intent, including ones whose grant has not synchronised yet. */
async function sessionIdForPaymentIntent(paymentIntentId: string): Promise<string | null> {
  const list = await getStripe().checkout.sessions.list({ payment_intent: paymentIntentId, limit: 1 })
  return list.data[0]?.id ?? null
}

/**
 * Full refund → revoke the entitlement and release the limited-offer slot
 * (refunded rows no longer count toward the cap). Partial refund → flag for
 * manual review only; entitlement and inventory are untouched. Never issues refunds.
 */
export async function handleChargeRefunded(admin: SupabaseClient, charge: Stripe.Charge): Promise<void> {
  const pi = idOf(charge.payment_intent as string | { id: string } | null)
  if (!pi) return
  const now = new Date().toISOString()

  if (!charge.refunded) {
    await flagPartialRefund(admin, pi)
    return
  }
  await admin.from('billing_purchases').update({ status: 'refunded', needs_review: false, refunded_at: now, updated_at: now })
    .eq('stripe_payment_intent_id', pi).in('status', ['paid', 'review'])

  // Refund arrived before the grant synchronised: close the not-yet-granted row too,
  // so the later grant (which re-checks Stripe) cannot activate it.
  const sessionId = await sessionIdForPaymentIntent(pi)
  if (sessionId) {
    await admin.from('billing_purchases').update({ status: 'refunded', refunded_at: now, reserved_until: null, updated_at: now })
      .eq('stripe_checkout_session_id', sessionId).in('status', ['pending', 'expired'])
  }
}

/**
 * Dispute handling driven by Stripe's CURRENT dispute state (not the event type),
 * so duplicates and out-of-order delivery converge:
 *  - lost  → revoke the affected entitlement (one-time purchase → 'disputed';
 *            subscription → cancelled in Stripe so renewals stop).
 *  - won   → access is preserved; a previously revoked purchase is restored.
 *  - open / under review → recorded only. A newly opened dispute never revokes.
 * A lost dispute keeps its limited-offer slot consumed (no inventory release).
 */
export async function handleDispute(admin: SupabaseClient, disputeId: string): Promise<void> {
  const stripe = getStripe()
  const dispute = await stripe.disputes.retrieve(disputeId)
  let pi = idOf(dispute.payment_intent as string | { id: string } | null)
  if (!pi) {
    const charge = await stripe.charges.retrieve(idOf(dispute.charge as string | { id: string })!)
    pi = idOf(charge.payment_intent as string | { id: string } | null)
  }
  if (!pi) return
  const now = new Date().toISOString()

  const record = { dispute_id: dispute.id, dispute_status: dispute.status, updated_at: now }
  const { data: matched } = await admin.from('billing_purchases').update(record)
    .eq('stripe_payment_intent_id', pi).in('status', ['paid', 'review', 'disputed']).select('id,status')
  const isPurchase = (matched ?? []).length > 0

  if (dispute.status === 'lost') {
    if (isPurchase) {
      await admin.from('billing_purchases').update({ status: 'disputed', needs_review: false, updated_at: now })
        .eq('stripe_payment_intent_id', pi).in('status', ['paid', 'review'])
    } else {
      await cancelSubscriptionForPayment(admin, pi)
    }
    return
  }
  if (dispute.status === 'won' && isPurchase) {
    await admin.from('billing_purchases').update({ status: 'paid', updated_at: now })
      .eq('stripe_payment_intent_id', pi).eq('status', 'disputed').eq('dispute_id', dispute.id)
  }
}

async function cancelSubscriptionForPayment(admin: SupabaseClient, paymentIntentId: string): Promise<void> {
  const stripe = getStripe()
  const payments = await stripe.invoicePayments.list({ payment: { type: 'payment_intent', payment_intent: paymentIntentId }, limit: 1 })
  const invoiceId = idOf(payments.data[0]?.invoice as string | { id: string } | null | undefined)
  if (!invoiceId) return
  const subId = subscriptionIdFromInvoice(await stripe.invoices.retrieve(invoiceId))
  if (!subId) return
  await stripe.subscriptions.cancel(subId)
  await syncSubscription(admin, subId)
}

export function subscriptionIdFromInvoice(invoice: Stripe.Invoice): string | null {
  return idOf(invoice.parent?.subscription_details?.subscription as string | { id: string } | null | undefined)
}

// ─── Account deletion ─────────────────────────────────────────────────────────

/**
 * Stops all recurring billing and payable checkouts for a user before their
 * account is deleted. Throws (so the caller aborts deletion) if any Stripe
 * subscription cannot be confirmed cancelled. No customer record exists → no-op.
 * Immediate cancellation, no proration and no refund (none is owed automatically).
 */
export async function cancelBillingForAccountDeletion(admin: SupabaseClient, userId: string): Promise<void> {
  const { data } = await admin.from('billing_customers').select('stripe_customer_id').eq('user_id', userId).maybeSingle()
  const customerId = (data as { stripe_customer_id?: string } | null)?.stripe_customer_id
  if (!customerId) return

  const stripe = getStripe()

  const subs = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 100 })
  for (const s of subs.data) {
    if (s.status === 'canceled' || s.status === 'incomplete_expired') continue
    const cancelled = await stripe.subscriptions.cancel(s.id)
    if (cancelled.status !== 'canceled') throw new Error(`Subscription ${s.id} could not be confirmed cancelled`)
    await syncSubscription(admin, s.id)
  }

  // No payable checkout may outlive the account.
  const open = await stripe.checkout.sessions.list({ customer: customerId, status: 'open', limit: 100 })
  for (const sess of open.data) await stripe.checkout.sessions.expire(sess.id)
  await admin.from('billing_purchases').update({ status: 'expired', reserved_until: null, updated_at: new Date().toISOString() })
    .eq('user_id', userId).eq('status', 'pending')

  // Retain payment records (purchase/subscription rows keep Stripe IDs, amounts and
  // dates for tax, accounting and dispute purposes); mark them and let the FK
  // detach them from the soon-deleted auth user. The customer mapping is cascaded away.
  const stamp = new Date().toISOString()
  await admin.from('billing_purchases').update({ user_deleted_at: stamp }).eq('user_id', userId)
  await admin.from('billing_subscriptions').update({ user_deleted_at: stamp }).eq('user_id', userId)
}

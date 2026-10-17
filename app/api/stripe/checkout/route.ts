/**
 * POST /api/stripe/checkout  { planKey }  →  { url }
 *
 * Creates a server-side Stripe Checkout Session for one of the four V1 plans.
 *  - Caller must be an authenticated Supabase user (session cookie).
 *  - planKey is validated against a server allowlist; price IDs come from env
 *    and are verified against Stripe (CAD, expected amount/type, same mode as
 *    the API key). No price/amount is ever read from the client.
 *  - Limited offers (3-Year / Lifetime) reserve a spot atomically in Postgres.
 *  - Paid access is NOT granted here or by the success URL — only by the
 *    verified webhook / server-side Stripe verification (see lib/billing/sync.ts).
 */

import { NextRequest, NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/billing/admin'
import { getBillingStatus } from '@/lib/billing/entitlement'
import { BILLING_PLANS, isBillingPlanKey } from '@/lib/billing/plans'
import { getStripe, verifyPlanPrice } from '@/lib/billing/stripe'

function appBaseUrl(req: NextRequest): string {
  return (process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin).replace(/\/$/, '')
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { planKey?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  if (!isBillingPlanKey(body.planKey)) {
    return NextResponse.json({ error: 'Unknown or unavailable plan' }, { status: 400 })
  }
  const plan = BILLING_PLANS[body.planKey]

  let reservationId: string | null = null
  const admin = (() => { try { return createAdminClient() } catch { return null } })()
  if (!admin) return NextResponse.json({ error: 'Billing is not configured on the server.' }, { status: 500 })

  try {
    const stripe = getStripe()

    // Don't sell overlapping entitlements.
    const status = await getBillingStatus(admin, user.id, user.created_at)
    if (status.lifetime) {
      return NextResponse.json({ error: 'You already have Lifetime Pro.', code: 'already_lifetime' }, { status: 409 })
    }
    if (plan.mode === 'subscription') {
      const { data: activeSub } = await admin.from('billing_subscriptions').select('stripe_subscription_id')
        .eq('user_id', user.id).in('status', ['active', 'trialing', 'past_due']).limit(1)
      if (activeSub && activeSub.length > 0) {
        return NextResponse.json({ error: 'You already have an active subscription. Manage it from billing settings.', code: 'manage_billing' }, { status: 409 })
      }
    }

    // Verifies the configured Price ID (also fails closed on test/live mix-ups).
    const priceId = await verifyPlanPrice(plan.key)

    // Limited-quantity offers: atomic reservation under an advisory lock.
    if (plan.cap) {
      const { data, error } = await admin.rpc('billing_reserve_offer', {
        p_user_id: user.id, p_plan_key: plan.key, p_price_id: priceId, p_cap: plan.cap,
      })
      if (error) throw new Error(`reserve failed: ${error.message}`)
      if (!data) return NextResponse.json({ error: 'Sorry — this limited offer is sold out.', code: 'sold_out' }, { status: 409 })
      reservationId = data as string
    }

    // Reuse the Stripe customer for this user, or create exactly one.
    let customerId: string | null = null
    const { data: existing } = await admin.from('billing_customers').select('stripe_customer_id').eq('user_id', user.id).maybeSingle()
    customerId = (existing as { stripe_customer_id?: string } | null)?.stripe_customer_id ?? null
    if (!customerId) {
      const customer = await stripe.customers.create(
        { email: user.email ?? undefined, metadata: { user_id: user.id } },
        { idempotencyKey: `xpadite-customer-${user.id}` },
      )
      await admin.from('billing_customers').upsert({ user_id: user.id, stripe_customer_id: customer.id }, { onConflict: 'user_id', ignoreDuplicates: true })
      const { data: stored } = await admin.from('billing_customers').select('stripe_customer_id').eq('user_id', user.id).maybeSingle()
      customerId = (stored as { stripe_customer_id?: string } | null)?.stripe_customer_id ?? customer.id
    }

    const base = appBaseUrl(req)
    const metadata = { user_id: user.id, plan_key: plan.key }
    const params: Stripe.Checkout.SessionCreateParams = {
      mode: plan.mode,
      customer: customerId,
      client_reference_id: user.id,
      line_items: [{ price: priceId, quantity: 1 }],
      metadata,
      success_url: `${base}/app?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/app?checkout=cancelled`,
      expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
      billing_address_collection: 'auto',
    }
    if (plan.mode === 'subscription') {
      params.subscription_data = { metadata }
    } else {
      params.payment_intent_data = { metadata }
      params.invoice_creation = { enabled: true, invoice_data: { metadata } }
    }
    // Opt-in: use the account's existing Stripe Tax configuration.
    if (process.env.STRIPE_AUTOMATIC_TAX === 'true') {
      params.automatic_tax = { enabled: true }
      params.customer_update = { address: 'auto', name: 'auto' }
    }

    const session = await stripe.checkout.sessions.create(params)
    if (!session.url) throw new Error('Stripe returned no checkout URL')

    if (reservationId) {
      await admin.from('billing_purchases').update({ stripe_checkout_session_id: session.id, updated_at: new Date().toISOString() }).eq('id', reservationId)
    }
    return NextResponse.json({ url: session.url })
  } catch (err) {
    if (reservationId) await admin.from('billing_purchases').delete().eq('id', reservationId).eq('status', 'pending')
    console.error('[Stripe Checkout] Failed:', err instanceof Error ? err.message : 'unknown error')
    return NextResponse.json({ error: 'Could not start checkout. Please try again.' }, { status: 500 })
  }
}

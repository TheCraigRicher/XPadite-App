/**
 * POST /api/stripe/checkout  { planKey }  →  { url }
 *
 * Creates a server-side Stripe Checkout Session for one of the four V1 plans.
 *  - Caller must be an authenticated Supabase user (session cookie).
 *  - planKey is validated against a server allowlist; price IDs come from env
 *    and are verified against Stripe (CAD, expected amount/type, same mode as
 *    the API key). No price/amount is ever read from the client.
 *  - Limited offers (3-Year / Lifetime): inventory is held in Postgres BEFORE the
 *    Stripe session exists, and the session is set to expire before the hold
 *    does — so a payable session never exists without protected inventory.
 *    A user's previous payable session is expired in Stripe before a new hold
 *    is taken (holds are never deleted while their session could still be paid).
 *  - Paid access is NOT granted here or by the success URL — only by the
 *    verified webhook / server-side Stripe verification (see lib/billing/sync.ts).
 */

import { NextRequest, NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/billing/admin'
import { syncBillingConfig } from '@/lib/billing/config'
import { getBillingStatus } from '@/lib/billing/entitlement'
import { BILLING_PLANS, isBillingPlanKey } from '@/lib/billing/plans'
import { getStripe, verifyPlanPrice } from '@/lib/billing/stripe'

const HOLD_MINUTES = 40          // inventory hold lifetime
const SESSION_MARGIN_SECONDS = 300 // Checkout Session expires this long BEFORE the hold does
const STRIPE_MIN_SESSION_SECONDS = 30 * 60 + 30 // Stripe requires >= 30 min; keep a safety buffer
const IN_FLIGHT_MS = 2 * 60_000 // a hold with no Stripe session yet younger than this belongs to a request still creating it

function appBaseUrl(req: NextRequest): string {
  return (process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin).replace(/\/$/, '')
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Purchases need a verified email (Supabase normally cannot issue a session before this; belt and braces).
  if (!user.email_confirmed_at) {
    return NextResponse.json({ error: 'Please verify your email address before purchasing.', code: 'email_unverified' }, { status: 403 })
  }

  let body: { planKey?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  if (!isBillingPlanKey(body.planKey)) {
    return NextResponse.json({ error: 'Unknown or unavailable plan' }, { status: 400 })
  }
  const plan = BILLING_PLANS[body.planKey]

  const admin = (() => { try { return createAdminClient() } catch { return null } })()
  if (!admin) return NextResponse.json({ error: 'Billing is not configured on the server.' }, { status: 500 })

  let reservationId: string | null = null
  let sessionCreated: Stripe.Checkout.Session | null = null
  let sessionExpiresAt = Math.floor(Date.now() / 1000) + 31 * 60

  try {
    const stripe = getStripe()
    await syncBillingConfig(admin)

    // Don't sell overlapping entitlements.
    const status = await getBillingStatus(admin, user)
    if (status.lifetime) {
      return NextResponse.json({ error: 'You already have Lifetime Pro.', code: 'already_lifetime' }, { status: 409 })
    }
    const { data: activeSubs } = await admin.from('billing_subscriptions').select('stripe_subscription_id')
      .eq('user_id', user.id).in('status', ['active', 'trialing', 'past_due']).limit(1)
    const hasActiveSub = !!activeSubs && activeSubs.length > 0
    if (plan.mode === 'subscription' && hasActiveSub) {
      return NextResponse.json({ error: 'You already have an active subscription. Manage it from billing settings.', code: 'manage_billing' }, { status: 409 })
    }

    // Verifies the configured Price ID (also fails closed on test/live mix-ups).
    const priceId = await verifyPlanPrice(plan.key)

    // Limited offers: retire this user's earlier payable session BEFORE taking a new hold.
    if (plan.cap) {
      const { data: prior } = await admin.from('billing_purchases').select('id,stripe_checkout_session_id,created_at')
        .eq('user_id', user.id).eq('plan_key', plan.key).eq('status', 'pending')
      for (const row of (prior ?? []) as { id: string; stripe_checkout_session_id: string | null; created_at: string }[]) {
        if (!row.stripe_checkout_session_id && Date.now() - new Date(row.created_at).getTime() < IN_FLIGHT_MS) {
          // Another request from this user holds a slot and is still creating its Stripe session.
          // Do NOT release that hold: its session is about to become payable.
          return NextResponse.json({ error: 'A checkout is already being prepared. Please try again in a moment.', code: 'checkout_in_progress' }, { status: 409 })
        }
        if (row.stripe_checkout_session_id) {
          const old = await stripe.checkout.sessions.retrieve(row.stripe_checkout_session_id)
          if (old.status === 'complete') {
            // Paid moments ago; the webhook is about to confirm it. Do not start another.
            return NextResponse.json({ error: 'Your payment is still being confirmed. Please wait a moment.', code: 'payment_processing' }, { status: 409 })
          }
          if (old.status === 'open') await stripe.checkout.sessions.expire(old.id)
        }
        await admin.from('billing_purchases').update({ status: 'expired', reserved_until: null, updated_at: new Date().toISOString() })
          .eq('id', row.id).eq('status', 'pending')
      }

      const { data: held, error } = await admin.rpc('billing_reserve_offer_v2', {
        p_user_id: user.id, p_plan_key: plan.key, p_price_id: priceId, p_cap: plan.cap, p_hold_mins: HOLD_MINUTES,
      })
      if (error) {
        if (error.message?.includes('already_owned')) {
          return NextResponse.json({ error: 'You already own this limited offer.', code: 'already_owned' }, { status: 409 })
        }
        if (error.message?.includes('hold_exists')) {
          return NextResponse.json({ error: 'A checkout is already being prepared. Please try again in a moment.', code: 'checkout_in_progress' }, { status: 409 })
        }
        throw new Error(`reserve failed: ${error.message}`)
      }
      const hold = Array.isArray(held) ? held[0] : null
      if (!hold) return NextResponse.json({ error: 'Sorry — this limited offer is sold out.', code: 'sold_out' }, { status: 409 })
      reservationId = hold.hold_id as string

      sessionExpiresAt = Math.floor(new Date(hold.hold_until as string).getTime() / 1000) - SESSION_MARGIN_SECONDS
      if (sessionExpiresAt - Math.floor(Date.now() / 1000) < STRIPE_MIN_SESSION_SECONDS) {
        throw new Error('Hold lifetime too short for a Checkout Session') // hold is released in catch
      }
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
      expires_at: sessionExpiresAt,
      billing_address_collection: 'auto',
    }
    if (plan.mode === 'subscription') {
      params.subscription_data = { metadata }
    } else {
      params.payment_intent_data = { metadata }
      params.invoice_creation = { enabled: true, invoice_data: { metadata } }
      if (hasActiveSub) {
        // Be explicit that the existing subscription stops renewing (no refund/credit is created).
        params.custom_text = {
          submit: {
            message: 'Your current subscription will not renew after this purchase. You keep the access you have already paid for until the end of your current billing period.',
          },
        }
      }
    }
    // Opt-in: use the account's existing Stripe Tax configuration.
    if (process.env.STRIPE_AUTOMATIC_TAX === 'true') {
      params.automatic_tax = { enabled: true }
      params.customer_update = { address: 'auto', name: 'auto' }
    }

    const session = await stripe.checkout.sessions.create(params)
    sessionCreated = session
    if (!session.url) throw new Error('Stripe returned no checkout URL')

    if (reservationId) {
      const { data: linked, error } = await admin.from('billing_purchases')
        .update({ stripe_checkout_session_id: session.id, updated_at: new Date().toISOString() })
        .eq('id', reservationId).eq('status', 'pending').select('id')
      if (error || !linked || linked.length !== 1) {
        // The hold is no longer live — never hand out a payable session without one (the catch block expires it).
        throw new Error(`could not link session to a live reservation${error ? `: ${error.message}` : ''}`)
      }
    }
    return NextResponse.json({ url: session.url })
  } catch (err) {
    // Release the hold only when no payable session can exist for it.
    if (reservationId) {
      let sessionDead = !sessionCreated
      if (sessionCreated) {
        try { await getStripe().checkout.sessions.expire(sessionCreated.id); sessionDead = true } catch { /* keep the hold until it lapses */ }
      }
      if (sessionDead) await admin.from('billing_purchases').delete().eq('id', reservationId).eq('status', 'pending')
    }
    console.error('[Stripe Checkout] Failed:', err instanceof Error ? err.message : 'unknown error')
    return NextResponse.json({ error: 'Could not start checkout. Please try again.' }, { status: 500 })
  }
}

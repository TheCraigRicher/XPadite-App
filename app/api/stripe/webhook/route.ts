/**
 * POST /api/stripe/webhook — Stripe → XPadite billing events.
 *
 *  - Signature is verified against the RAW body (STRIPE_WEBHOOK_SECRET).
 *  - Idempotent: each event id is recorded in billing_webhook_events; a
 *    previously processed event is acknowledged without re-running.
 *  - Handlers re-read authoritative state from Stripe (not the event payload),
 *    so retries and out-of-order delivery converge.
 *  - A handler failure returns 500 so Stripe retries the delivery.
 *
 * Authenticated by Stripe's signature, not a user session — excluded from
 * login redirects because lib/supabase/middleware.ts only guards /app.
 */

import { NextRequest, NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { createAdminClient } from '@/lib/billing/admin'
import { getStripe } from '@/lib/billing/stripe'
import {
  expireCheckoutSession,
  grantFromCheckoutSession,
  revokePurchaseByPaymentIntent,
  subscriptionIdFromInvoice,
  syncSubscription,
} from '@/lib/billing/sync'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  const signature = req.headers.get('stripe-signature')
  if (!secret) {
    console.error('[Stripe Webhook] STRIPE_WEBHOOK_SECRET is not configured')
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 })
  }
  if (!signature) return NextResponse.json({ error: 'Missing signature' }, { status: 400 })

  const rawBody = await req.text()
  let event: Stripe.Event
  try {
    event = await getStripe().webhooks.constructEventAsync(rawBody, signature, secret)
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Idempotency: claim the event id; skip if already fully processed.
  const claim = await admin.from('billing_webhook_events').insert({ event_id: event.id, event_type: event.type })
  if (claim.error) {
    if (claim.error.code !== '23505') {
      console.error('[Stripe Webhook] Could not record event:', claim.error.message)
      return NextResponse.json({ error: 'Storage error' }, { status: 500 })
    }
    const { data: prior } = await admin.from('billing_webhook_events').select('status').eq('event_id', event.id).maybeSingle()
    if ((prior as { status?: string } | null)?.status === 'processed') {
      return NextResponse.json({ received: true, duplicate: true })
    }
    // 'processing' (crashed earlier) or 'failed' → fall through and retry; handlers are idempotent.
  }

  try {
    await handleEvent(admin, event)
    await admin.from('billing_webhook_events').update({ status: 'processed', error: null, processed_at: new Date().toISOString() }).eq('event_id', event.id)
    return NextResponse.json({ received: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    console.error(`[Stripe Webhook] ${event.type} failed:`, message)
    await admin.from('billing_webhook_events').update({ status: 'failed', error: message.slice(0, 500) }).eq('event_id', event.id)
    return NextResponse.json({ error: 'Handler failed' }, { status: 500 })
  }
}

async function handleEvent(admin: ReturnType<typeof createAdminClient>, event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      await grantFromCheckoutSession(admin, (event.data.object as Stripe.Checkout.Session).id)
      return

    case 'checkout.session.expired':
    case 'checkout.session.async_payment_failed':
      await expireCheckoutSession(admin, (event.data.object as Stripe.Checkout.Session).id)
      return

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      await syncSubscription(admin, (event.data.object as Stripe.Subscription).id)
      return

    case 'invoice.paid':
    case 'invoice.payment_failed': {
      const subId = subscriptionIdFromInvoice(event.data.object as Stripe.Invoice)
      if (subId) await syncSubscription(admin, subId)
      return
    }

    case 'charge.refunded': {
      const charge = event.data.object as Stripe.Charge
      // Only a full refund revokes a one-time purchase.
      if (charge.refunded) await revokePurchaseByPaymentIntent(admin, charge.payment_intent, 'refunded')
      return
    }

    case 'charge.dispute.created':
      await revokePurchaseByPaymentIntent(admin, (event.data.object as Stripe.Dispute).payment_intent, 'disputed')
      return

    default:
      return // Unhandled types are acknowledged.
  }
}

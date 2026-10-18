/**
 * POST /api/stripe/portal  →  { url }
 * Opens the Stripe Customer Portal for the signed-in user's own Stripe customer.
 * The customer id is looked up server-side from the verified session — never from the client.
 * Requires a Customer Portal configuration with "Customers can switch plans" OFF
 * (STRIPE_PORTAL_CONFIGURATION_ID, or the account default) — verified read-only before every session.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/billing/admin'
import { getStripe, getVerifiedPortalConfigurationId } from '@/lib/billing/stripe'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const admin = createAdminClient()
    const { data } = await admin.from('billing_customers').select('stripe_customer_id').eq('user_id', user.id).maybeSingle()
    const customerId = (data as { stripe_customer_id?: string } | null)?.stripe_customer_id
    if (!customerId) return NextResponse.json({ error: 'No billing account found yet.' }, { status: 404 })

    const base = (process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin).replace(/\/$/, '')
    // Refuses unless the portal configuration has plan switching disabled (cancel + payment-method management only).
    const configuration = await getVerifiedPortalConfigurationId()
    const session = await getStripe().billingPortal.sessions.create({ customer: customerId, return_url: `${base}/app`, configuration })
    return NextResponse.json({ url: session.url })
  } catch (err) {
    console.error('[Stripe Portal] Failed:', err instanceof Error ? err.message : 'unknown error')
    return NextResponse.json({ error: 'Could not open billing portal.' }, { status: 500 })
  }
}

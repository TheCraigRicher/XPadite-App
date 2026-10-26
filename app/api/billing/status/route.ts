/**
 * GET /api/billing/status[?session_id=cs_...]  →  BillingStatus
 *
 * Server-computed access status for the signed-in user. When the client has
 * just returned from Stripe Checkout it passes session_id: the server then
 * verifies that session with Stripe (belongs to this user, genuinely paid)
 * before activating — so access never depends on the success URL itself, and
 * a delayed webhook doesn't leave a paying customer locked out.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/billing/admin'
import { syncBillingConfig } from '@/lib/billing/config'
import { getBillingStatus } from '@/lib/billing/entitlement'
import { getStripe } from '@/lib/billing/stripe'
import { grantFromCheckoutSession } from '@/lib/billing/sync'
import { failureCode } from '@/lib/billing/diagnostics'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const admin = createAdminClient()
    await syncBillingConfig(admin)

    const sessionId = new URL(req.url).searchParams.get('session_id')
    if (sessionId && /^cs_[A-Za-z0-9_]+$/.test(sessionId)) {
      try {
        const session = await getStripe().checkout.sessions.retrieve(sessionId)
        // Only reconcile the caller's own checkout session.
        if (session.client_reference_id === user.id) {
          await grantFromCheckoutSession(admin, sessionId)
        }
      } catch (err) {
        console.error('[Billing] reconcile failed:', err instanceof Error ? err.message : 'unknown error')
      }
    }

    const status = await getBillingStatus(admin, user)
    // serverNow lets the browser correct a wrong device clock when it counts down the trial (additive; nothing else changes).
    return NextResponse.json({ ...status, serverNow: new Date().toISOString() }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    // Fixed codes only (e.g. project_mismatch, invalid_credentials, missing_table) — never keys, URLs or user data.
    const code = failureCode(err)
    console.error('[Billing] status failed:', code, err instanceof Error ? err.name : '')
    return NextResponse.json({ error: 'Could not load billing status.', code }, { status: 500 })
  }
}

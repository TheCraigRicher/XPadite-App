import { NextResponse } from 'next/server'
import type { User } from '@supabase/supabase-js'
import { createAdminClient } from './admin'
import { getBillingStatus } from './entitlement'

/**
 * For paid-only API routes: returns a 402 response if the (already
 * authenticated) user has neither an active entitlement nor trial time left,
 * otherwise null. Only a definite "expired" verdict blocks — a billing lookup
 * error is logged and does not lock a user out of their own functionality.
 */
export async function paywallResponse(user: User): Promise<NextResponse | null> {
  try {
    const status = await getBillingStatus(createAdminClient(), user.id, user.created_at)
    if (!status.hasAccess) {
      return NextResponse.json({ error: 'Your free trial has ended. Upgrade to continue.', code: 'trial_expired' }, { status: 402 })
    }
  } catch (err) {
    console.error('[Billing] paywall check failed:', err instanceof Error ? err.message : err)
  }
  return null
}

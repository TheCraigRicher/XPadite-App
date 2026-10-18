import { NextResponse } from 'next/server'
import type { User } from '@supabase/supabase-js'
import { createAdminClient } from './admin'
import { getBillingStatus, hasAiEntitlement } from './entitlement'
import { syncBillingConfig } from './config'

/**
 * For paid-only API routes: returns a 402 response if the (already
 * authenticated) user has neither an active entitlement nor trial time left,
 * otherwise null. Only a definite "expired" verdict blocks — a billing lookup
 * error is logged and does not lock a user out of their own functionality.
 */
export async function paywallResponse(user: User): Promise<NextResponse | null> {
  try {
    const admin = createAdminClient()
    await syncBillingConfig(admin)
    const status = await getBillingStatus(admin, user)
    if (!status.hasAccess) {
      return NextResponse.json({ error: 'Your free trial has ended. Upgrade to continue.', code: 'trial_expired' }, { status: 402 })
    }
  } catch (err) {
    console.error('[Billing] paywall check failed:', err instanceof Error ? err.message : err)
  }
  return null
}

/**
 * For AI Coach routes: AI is Premium V2 only. Neither the trial nor any Pro plan
 * grants it, so this fails closed (unlike paywallResponse) — it never depends on
 * UI flags. Returns 403 unless the user holds an AI entitlement.
 */
export function aiAccessResponse(user: User): NextResponse | null {
  if (hasAiEntitlement(user.id)) return null
  return NextResponse.json(
    { error: 'AI Coach is part of Premium, which is coming soon.', code: 'ai_premium_required' },
    { status: 403 },
  )
}

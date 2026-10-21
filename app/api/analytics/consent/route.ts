/**
 * GET  /api/analytics/consent            →  { analytics: boolean | null }   (null = this user has not chosen)
 * POST /api/analytics/consent { analytics: boolean }  →  { ok: true }
 *
 * Persists the signed-in user's choice about optional PostHog analytics (public.analytics_consent, migration 018) so
 * the server can respect it everywhere — including Stripe webhooks, which have no cookies or session.
 *
 *  - The user id ALWAYS comes from the verified session, never from the request, so nobody can change another
 *    user's consent. The table itself is service-role only (RLS on, no policies).
 *  - Absent row = not consented. Withdrawal is just POST { analytics: false }.
 *  - Trial start is reported only AFTER the user has opted in: when consent is granted within the trial length of
 *    activating the account, the event is sent once, timestamped at the real activation time. Older accounts are not
 *    back-filled, and a user who never opts in never produces it.
 *  - Nothing here touches billing, entitlements or authentication; failures only mean analytics stays off.
 */

import { NextRequest, NextResponse, after } from 'next/server'
import type { User } from '@supabase/supabase-js'
import { captureServer, serverEventsEnabled, withinTrialWindow } from '@/lib/analytics/server'
import { createAdminClient } from '@/lib/billing/admin'
import { getBillingLaunchAt, isPaywallDisabled } from '@/lib/billing/config'
import { TRIAL_DAYS } from '@/lib/billing/plans'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const admin = () => { try { return createAdminClient() } catch { return null } }

export async function GET() {
  const { data: { user } } = await (await createClient()).auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const db = admin()
  if (!db) return NextResponse.json({ error: 'Unavailable' }, { status: 503 })
  const { data, error } = await db.from('analytics_consent').select('analytics').eq('user_id', user.id).maybeSingle()
  if (error) return NextResponse.json({ error: 'Unavailable' }, { status: 503 })
  const analytics = (data as { analytics?: boolean } | null)?.analytics
  return NextResponse.json({ analytics: typeof analytics === 'boolean' ? analytics : null })
}

export async function POST(req: NextRequest) {
  const { data: { user } } = await (await createClient()).auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { analytics?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  if (typeof body.analytics !== 'boolean') return NextResponse.json({ error: 'analytics must be true or false' }, { status: 400 })

  const db = admin()
  if (!db) return NextResponse.json({ error: 'Unavailable' }, { status: 503 })
  const { error } = await db.from('analytics_consent')
    .upsert({ user_id: user.id, analytics: body.analytics, decided_at: new Date().toISOString() }, { onConflict: 'user_id' })
  if (error) return NextResponse.json({ error: 'Could not save' }, { status: 500 })

  if (body.analytics && serverEventsEnabled()) after(() => reportTrialStart(db, user))
  return NextResponse.json({ ok: true })
}

/** Reports trial_started (and Google signup_completed) once, after the user has opted in, backdated to activation. */
async function reportTrialStart(db: ReturnType<typeof createAdminClient>, user: User): Promise<void> {
  try {
    if (!withinTrialWindow(user)) return
    // Atomic claim: only one request can flip trial_event_reported_at from null, so the event cannot repeat.
    const { data: claimed } = await db.from('analytics_consent')
      .update({ trial_event_reported_at: new Date().toISOString() })
      .eq('user_id', user.id).eq('analytics', true).is('trial_event_reported_at', null).select('user_id')
    if (!claimed || claimed.length !== 1) return
    const activatedAt = new Date(user.email_confirmed_at as string)
    if (user.app_metadata?.provider === 'google') {
      await captureServer(user.id, 'signup_completed', { method: 'google' }, `signup-completed:${user.id}`, activatedAt)
    }
    await captureServer(
      user.id,
      'trial_started',
      { trial_days: TRIAL_DAYS, paywall_enforced: getBillingLaunchAt() !== null && !isPaywallDisabled() },
      `trial-started:${user.id}`,
      activatedAt,
    )
  } catch {
    /* analytics must never affect the request */
  }
}

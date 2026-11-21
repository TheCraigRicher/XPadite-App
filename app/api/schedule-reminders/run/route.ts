/**
 * /api/schedule-reminders/run — called about once a minute by Supabase pg_cron (via pg_net). See docs/SCHEDULE_REMINDERS_SETUP.md.
 *
 * Authorised ONLY by `Authorization: Bearer <CRON_SECRET>` (fails closed when the secret is not configured). Never callable by a signed-in user.
 * Does nothing (and says so) until the VAPID keys and migration 027 are in place. The response carries counts only — no user data.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/billing/admin'
import { isCronAuthorized } from '@/lib/push/guards'
import { makeSender } from '@/lib/push/send'
import { runScheduleReminders } from '@/lib/push/processor'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

async function handler(req: NextRequest): Promise<NextResponse> {
  if (!isCronAuthorized(req.headers.get('authorization'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const send = makeSender()
  if (!send) return NextResponse.json({ ok: false, error: 'not_configured' }, { status: 503 })
  try {
    const result = await runScheduleReminders({ admin: createAdminClient(), send })
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    // fixed codes only — never keys, URLs or user data
    console.error('[ScheduleReminders] run failed:', err instanceof Error ? err.message : 'unknown')
    return NextResponse.json({ ok: false, error: 'run_failed' }, { status: 500 })
  }
}

export const GET = handler
export const POST = handler

/**
 * /api/reminders/process — Vercel Cron endpoint
 *
 * Processes due email reminders once per invocation.
 * Secured by CRON_SECRET — Vercel sends this automatically as a header.
 *
 * ─── vercel.json configuration ───────────────────────────────────────────────
 *
 *   {
 *     "crons": [
 *       {
 *         "path": "/api/reminders/process",
 *         "schedule": "* * * * *"
 *       }
 *     ]
 *   }
 *
 *   "* * * * *"   = every minute  (most responsive; free plan allows every 60s)
 *   "0 * * * *"   = every hour    (suitable for non-time-critical reminders)
 *
 * ─── Required environment variables ──────────────────────────────────────────
 *
 *   CRON_SECRET               Random secret matching what vercel.json sends.
 *                             Vercel passes it as Authorization: Bearer <secret>
 *                             OR you can send it as x-cron-secret / ?secret=
 *
 *   SUPABASE_SERVICE_ROLE_KEY Service role key — bypasses RLS.
 *                             Found in Supabase → Project Settings → API.
 *                             NEVER expose this to the client.
 *
 *   NEXT_PUBLIC_SUPABASE_URL  Your Supabase project URL.
 *
 *   RESEND_API_KEY            From https://resend.com/api-keys
 *
 *   REMINDER_FROM_EMAIL       Sender address verified in Resend.
 *                             Example: "Xpadite <reminders@yourdomain.com>"
 *
 *   NEXT_PUBLIC_APP_URL       Your app's public URL, used in email CTA button.
 *                             Example: "https://xpadite.app"
 *                             Falls back to VERCEL_URL (auto-injected by Vercel).
 *
 * ─── Manual testing ───────────────────────────────────────────────────────────
 *
 *   curl "https://yourapp.vercel.app/api/reminders/process?secret=YOUR_CRON_SECRET"
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient }              from '@supabase/supabase-js'
import { processReminders }          from '@/lib/reminder-processor'

// ─── Auth ─────────────────────────────────────────────────────────────────────

/**
 * Vercel Cron sends:  Authorization: Bearer <CRON_SECRET>
 * Manual curl sends:  ?secret=<CRON_SECRET>  or  x-cron-secret: <CRON_SECRET>
 */
function isAuthorized(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.warn('[CronAuth] CRON_SECRET is not set — endpoint is unprotected')
    return true
  }

  const authHeader = req.headers.get('authorization') ?? ''
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''

  const headerSecret = req.headers.get('x-cron-secret') ?? ''
  const querySecret  = req.nextUrl.searchParams.get('secret') ?? ''

  return (
    bearerToken   === cronSecret ||
    headerSecret  === cronSecret ||
    querySecret   === cronSecret
  )
}

// ─── Handler ──────────────────────────────────────────────────────────────────

async function handler(req: NextRequest): Promise<NextResponse> {
  // 1. Auth check
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2. Validate required env vars
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceKey) {
    console.error('[Cron] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    return NextResponse.json(
      { error: 'Supabase service role not configured' },
      { status: 500 },
    )
  }

  // 3. Create service role client — bypasses RLS for batch processing
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // 4. Process reminders
  try {
    const result = await processReminders(supabase)

    console.log('[Cron] Reminder processing complete:', {
      ...result,
      timestamp: new Date().toISOString(),
    })

    return NextResponse.json({
      ok:        true,
      processed: result.processed,
      sent:      result.sent,
      errors:    result.errors,
      skipped:   result.skipped,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[Cron] Processing failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// Vercel Cron uses GET; allow POST for manual triggers via dashboard
export const GET  = handler
export const POST = handler

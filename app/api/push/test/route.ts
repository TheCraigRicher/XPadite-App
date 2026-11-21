/**
 * POST /api/push/test — sends ONE test notification to the SIGNED-IN user's own subscribed device(s). It never touches events, reminders or any
 * other user's devices, and writes nothing except removing a device the push service reports as gone.
 * Body (optional): { endpoint } to target only the browser that asked.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/billing/admin'
import { isAllowedPushEndpoint } from '@/lib/push/guards'
import { buildTestPayload } from '@/lib/push/payload'
import { makeSender } from '@/lib/push/send'

export const dynamic = 'force-dynamic'

const lastTest = new Map<string, number>()   // per-instance throttle: one test every 5 s per account

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const send = makeSender()
  if (!send) return NextResponse.json({ error: 'not_configured' }, { status: 503 })

  const now = Date.now()
  if (now - (lastTest.get(user.id) ?? 0) < 5000) return NextResponse.json({ error: 'too_fast' }, { status: 429 })
  lastTest.set(user.id, now)

  let endpoint: string | null = null
  try { const b = await req.json(); if (b && isAllowedPushEndpoint(b.endpoint)) endpoint = b.endpoint } catch { /* no body: all of the caller's devices */ }

  try {
    const admin = createAdminClient()
    let q = admin.from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('user_id', user.id)
    if (endpoint) q = q.eq('endpoint', endpoint)
    const { data: subs } = await q
    if (!subs || subs.length === 0) return NextResponse.json({ ok: false, error: 'no_device', sent: 0 }, { status: 404 })
    let sent = 0, failed = 0, removed = 0
    for (const s of subs as Array<{ id: string; endpoint: string; p256dh: string; auth: string }>) {
      const r = await send(s, buildTestPayload())
      if (r.ok) sent++
      else if (r.gone) { removed++; await admin.from('push_subscriptions').delete().eq('id', s.id) }
      else failed++
    }
    return NextResponse.json({ ok: sent > 0, sent, failed, removed })
  } catch {
    return NextResponse.json({ error: 'unavailable' }, { status: 503 })
  }
}

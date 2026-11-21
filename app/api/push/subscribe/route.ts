/**
 * /api/push/subscribe — a signed-in user's devices for Web Push reminders.
 *   GET    ?endpoint=…   → { configured, subscribed }   (is THIS browser registered for THIS account?)
 *   POST   { subscription } → registers / refreshes this browser for the signed-in account
 *   DELETE { endpoint }     → removes this browser (own devices only)
 *
 * The user id always comes from the verified session, never from the request. Subscription rows are not readable by the browser at all
 * (no RLS policies), so every read and write goes through here with the service role, scoped to the session's user.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/billing/admin'
import { MAX_DEVICES_PER_USER, isAllowedPushEndpoint, parseSubscription } from '@/lib/push/guards'
import { vapidEnv } from '@/lib/push/send'

export const dynamic = 'force-dynamic'

async function sessionUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

export async function GET(req: NextRequest) {
  const user = await sessionUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const endpoint = new URL(req.url).searchParams.get('endpoint')
  const configured = vapidEnv() !== null
  if (!endpoint || !isAllowedPushEndpoint(endpoint)) return NextResponse.json({ configured, subscribed: false }, { headers: { 'Cache-Control': 'no-store' } })
  try {
    const { data } = await createAdminClient().from('push_subscriptions').select('id').eq('user_id', user.id).eq('endpoint', endpoint).maybeSingle()
    return NextResponse.json({ configured, subscribed: !!data }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ configured, subscribed: false, error: 'unavailable' }, { status: 503 })
  }
}

export async function POST(req: NextRequest) {
  const user = await sessionUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!vapidEnv()) return NextResponse.json({ error: 'not_configured' }, { status: 503 })
  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad_request' }, { status: 400 }) }
  const sub = parseSubscription(body)
  if (!sub) return NextResponse.json({ error: 'bad_subscription' }, { status: 400 })
  const ua = (req.headers.get('user-agent') ?? '').slice(0, 200)
  try {
    const admin = createAdminClient()
    // An endpoint belongs to one account at a time: signing in as someone else on the same browser re-claims it (the old account stops receiving).
    const { error } = await admin.from('push_subscriptions').upsert(
      { user_id: user.id, endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth, user_agent: ua, last_seen_at: new Date().toISOString() },
      { onConflict: 'endpoint' },
    )
    if (error) return NextResponse.json({ error: 'save_failed' }, { status: 500 })
    // cap devices per account: drop the oldest beyond the limit
    const { data: all } = await admin.from('push_subscriptions').select('id, created_at').eq('user_id', user.id).order('created_at', { ascending: false })
    const extra = (all ?? []).slice(MAX_DEVICES_PER_USER).map(r => r.id as string)
    if (extra.length) await admin.from('push_subscriptions').delete().in('id', extra).eq('user_id', user.id)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'unavailable' }, { status: 503 })
  }
}

export async function DELETE(req: NextRequest) {
  const user = await sessionUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let body: { endpoint?: unknown } | null = null
  try { body = await req.json() } catch { /* handled below */ }
  if (!body || !isAllowedPushEndpoint(body.endpoint)) return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  try {
    await createAdminClient().from('push_subscriptions').delete().eq('user_id', user.id).eq('endpoint', body.endpoint)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'unavailable' }, { status: 503 })
  }
}

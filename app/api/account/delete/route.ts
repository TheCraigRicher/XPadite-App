/**
 * DELETE /api/account/delete — permanently deletes the CALLER's own account.
 *
 * Deleting an auth.users row requires the Supabase service-role key, which
 * must never reach the browser — so this always runs server-side. The user
 * to delete is never taken from the request body; it is derived from the
 * caller's own authenticated session (via lib/supabase/server.ts's
 * cookie-based client), so this endpoint can only ever delete the account
 * making the request.
 *
 * Every XPadite table that stores user data (profiles, calendar_days,
 * work_sessions, user_activities, user_preferences, gallery_items,
 * reminders, journal_labels, journal_folders) has its user_id column
 * declared `references auth.users(id) on delete cascade` — so deleting the
 * auth user here cascades through Postgres and removes all of it. Avatar
 * files in Supabase Storage are not covered by that cascade and are left in
 * place; this endpoint does not attempt to also erase Storage objects.
 *
 * Required env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * (same convention as app/api/reminders/process/route.ts).
 */

import { NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'

export async function DELETE() {
  // 1. Identify the caller from their own session cookie.
  const supabase = await createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2. Service-role client — only ever used server-side, never sent to the client.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    console.error('[Account Delete] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    return NextResponse.json({ error: 'Account deletion is not configured on the server.' }, { status: 500 })
  }
  const admin = createServiceClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // 3. Delete — id comes only from the verified session above.
  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id)
  if (deleteError) {
    console.error('[Account Delete] Failed:', deleteError)
    return NextResponse.json({ error: deleteError.message || 'Failed to delete account.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

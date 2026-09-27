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
 * auth user here cascades through Postgres and removes all of it.
 *
 * Avatar files in Supabase Storage are NOT covered by that cascade, so this
 * route resolves the caller's actual avatar path from their own `profiles`
 * row (trusted server-side read, never a path supplied by the client) and
 * removes it from the `avatars` bucket before deleting the auth user. A
 * missing/already-removed avatar, or an unexpected Storage error, is logged
 * and does not block the account deletion itself — losing one orphaned file
 * is a far smaller problem than refusing a legitimate delete request.
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

  // 3. Resolve and remove the avatar Storage object, if any — read scoped to
  // this verified user's own id, never a path from the request.
  const { data: profileRow } = await admin
    .from('profiles')
    .select('avatar_url')
    .eq('id', user.id)
    .maybeSingle()
  const avatarPath = (profileRow as { avatar_url?: string | null } | null)?.avatar_url
  if (avatarPath) {
    const { error: storageError } = await admin.storage.from('avatars').remove([avatarPath])
    if (storageError) {
      console.error('[Account Delete] Avatar storage cleanup failed (continuing with deletion):', storageError)
    }
  }

  // 4. Delete the auth user — id comes only from the verified session above.
  // Postgres cascade removes the rest of this user's rows automatically.
  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id)
  if (deleteError) {
    console.error('[Account Delete] Failed:', deleteError)
    return NextResponse.json({ error: deleteError.message || 'Failed to delete account.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

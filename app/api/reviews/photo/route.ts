/**
 * POST /api/reviews/photo — brings the PUBLIC copy of the caller's review photo in line with their saved consent.
 *
 *   consent ON  + avatar exists → 256x256 metadata-free WebP copy in the public `review-photos` bucket
 *   consent OFF (or no avatar)  → any public copy is deleted
 *
 * The user is ALWAYS the verified session user (never taken from the request). The consent itself is stored by the
 * database function submit_review() under auth.uid(); this route only reads it, so it cannot be used to publish
 * someone's photo without their saved consent. Service-role access is used server-side only: the avatar source path is
 * read from the caller's own profile row and must sit inside their own `<user id>/` folder.
 *
 * Every failure returns a fixed `code` (and logs only that code) so a configuration problem — missing/wrong-project key,
 * missing table, storage — can be told apart from "no review" or "no profile photo". Never keys, URLs or user data.
 */
import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/billing/admin'
import { classifyDbError, failureCode } from '@/lib/billing/diagnostics'
import {
  AVATAR_BUCKET, REVIEW_PHOTO_BUCKET, REVIEW_PHOTO_PATH_RE,
  isOwnAvatarPath, processReviewPhoto, reviewPhotoPath,
} from '@/lib/reviews/photo'

export const runtime = 'nodejs'

function fail(status: number, code: string) {
  console.error('[Review photo] failed:', code)
  return NextResponse.json({ ok: false, error: 'Could not update the photo', code }, { status })
}

export async function POST() {
  const supabase = await createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ ok: false, error: 'Unauthorized', code: 'unauthorized' }, { status: 401 })
  if (!user.email_confirmed_at) return NextResponse.json({ ok: false, error: 'Email not verified', code: 'email_not_verified' }, { status: 403 })

  let admin: SupabaseClient
  try { admin = createAdminClient() } catch (err) { return fail(503, `config_${failureCode(err)}`) }

  const { data: review, error: reviewError } = await admin
    .from('reviews')
    .select('id, show_profile_photo, profile_photo_path')
    .eq('user_id', user.id)
    .maybeSingle()
  // A query ERROR (wrong project, missing table, bad key) is not "no review".
  if (reviewError) return fail(503, `db_${classifyDbError(reviewError)}`)
  if (!review) return fail(404, 'review_not_found')

  const oldPath = typeof review.profile_photo_path === 'string' && REVIEW_PHOTO_PATH_RE.test(review.profile_photo_path) ? review.profile_photo_path : null

  async function clearPublicCopy(): Promise<boolean> {
    if (oldPath) {
      const { error } = await admin.storage.from(REVIEW_PHOTO_BUCKET).remove([oldPath])
      if (error) return false
    }
    const { error } = await admin.from('reviews').update({ profile_photo_path: null }).eq('id', review!.id).eq('user_id', user!.id)
    return !error
  }

  // Consent OFF → make sure nothing stays public.
  if (!review.show_profile_photo) {
    if (!(await clearPublicCopy())) return fail(500, 'clear_failed')
    return NextResponse.json({ ok: true, photo: false, reason: 'consent_off' })
  }

  // Consent ON → find the user's own avatar.
  const { data: profile, error: profileError } = await admin.from('profiles').select('avatar_url').eq('id', user.id).maybeSingle()
  if (profileError) return fail(503, `db_${classifyDbError(profileError)}`)
  const avatarPath = (profile as { avatar_url?: string | null } | null)?.avatar_url
  if (!isOwnAvatarPath(avatarPath, user.id)) {
    if (!(await clearPublicCopy())) return fail(500, 'clear_failed')
    // Saved, but there is nothing to show: the caller must be told (not "success"), so the user can add a photo.
    return NextResponse.json({ ok: true, photo: false, reason: 'no_avatar' })
  }

  const { data: blob, error: dlError } = await admin.storage.from(AVATAR_BUCKET).download(avatarPath)
  if (dlError || !blob) return fail(502, 'avatar_download')
  let webp: Buffer
  try { webp = await processReviewPhoto(Buffer.from(await blob.arrayBuffer())) } catch { return fail(422, 'avatar_unreadable') }
  const newPath = reviewPhotoPath(review.id)
  const { error: upError } = await admin.storage.from(REVIEW_PHOTO_BUCKET).upload(newPath, webp, { contentType: 'image/webp', upsert: false })
  if (upError) return fail(502, 'upload_failed')
  const { error: dbError } = await admin.from('reviews').update({ profile_photo_path: newPath }).eq('id', review.id).eq('user_id', user.id)
  if (dbError) {
    await admin.storage.from(REVIEW_PHOTO_BUCKET).remove([newPath])
    return fail(500, 'record_failed')
  }
  if (oldPath && oldPath !== newPath) await admin.storage.from(REVIEW_PHOTO_BUCKET).remove([oldPath])
  return NextResponse.json({ ok: true, photo: true })
}

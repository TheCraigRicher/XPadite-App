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
 */
import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/billing/admin'
import {
  AVATAR_BUCKET, REVIEW_PHOTO_BUCKET, REVIEW_PHOTO_PATH_RE,
  isOwnAvatarPath, processReviewPhoto, reviewPhotoPath,
} from '@/lib/reviews/photo'

export const runtime = 'nodejs'

export async function POST() {
  const supabase = await createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  if (!user.email_confirmed_at) return NextResponse.json({ ok: false, error: 'Email not verified' }, { status: 403 })

  let admin: SupabaseClient
  try { admin = createAdminClient() } catch { return NextResponse.json({ ok: false, error: 'Not configured' }, { status: 503 }) }

  const { data: review } = await admin
    .from('reviews')
    .select('id, show_profile_photo, profile_photo_path')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!review) return NextResponse.json({ ok: false, error: 'No review' }, { status: 404 })

  const oldPath = typeof review.profile_photo_path === 'string' && REVIEW_PHOTO_PATH_RE.test(review.profile_photo_path) ? review.profile_photo_path : null

  async function clearPublicCopy() {
    if (oldPath) await admin.storage.from(REVIEW_PHOTO_BUCKET).remove([oldPath])
    await admin.from('reviews').update({ profile_photo_path: null }).eq('id', review!.id).eq('user_id', user!.id)
  }

  // Consent OFF → make sure nothing stays public.
  if (!review.show_profile_photo) {
    await clearPublicCopy()
    return NextResponse.json({ ok: true, photo: false })
  }

  // Consent ON → find the user's own avatar.
  const { data: profile } = await admin.from('profiles').select('avatar_url').eq('id', user.id).maybeSingle()
  const avatarPath = (profile as { avatar_url?: string | null } | null)?.avatar_url
  if (!isOwnAvatarPath(avatarPath, user.id)) {
    await clearPublicCopy()
    return NextResponse.json({ ok: true, photo: false })     // no profile photo: the Website shows the initials avatar
  }

  try {
    const { data: blob, error: dlError } = await admin.storage.from(AVATAR_BUCKET).download(avatarPath)
    if (dlError || !blob) throw new Error('avatar_download')
    const webp = await processReviewPhoto(Buffer.from(await blob.arrayBuffer()))
    const newPath = reviewPhotoPath(review.id)
    const { error: upError } = await admin.storage.from(REVIEW_PHOTO_BUCKET).upload(newPath, webp, { contentType: 'image/webp', upsert: false })
    if (upError) throw new Error('upload')
    const { error: dbError } = await admin.from('reviews').update({ profile_photo_path: newPath }).eq('id', review.id).eq('user_id', user.id)
    if (dbError) {
      await admin.storage.from(REVIEW_PHOTO_BUCKET).remove([newPath])
      throw new Error('db')
    }
    if (oldPath && oldPath !== newPath) await admin.storage.from(REVIEW_PHOTO_BUCKET).remove([oldPath])
    return NextResponse.json({ ok: true, photo: true })
  } catch (err) {
    console.error('[Review photo] sync failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false, error: 'Could not update the photo' }, { status: 500 })
  }
}

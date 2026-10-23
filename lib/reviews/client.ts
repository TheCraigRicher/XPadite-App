// In-app Rate Us → the SAME shared reviews system the XPadite Website uses (migration 019_reviews.sql).
// There is no App-side API route on purpose: the only write path is the database function public.submit_review(),
// which runs as the signed-in user (auth.uid()), requires a verified email, screens the text, decides the status
// itself and rate-limits. Nothing here can set status, user id or "verified" — the client only sends the review.
import type { SupabaseClient } from '@supabase/supabase-js'

export const REVIEW_LIMITS = { titleMax: 100, professionMax: 60, bodyMin: 10, bodyMax: 2000 } as const

export interface ReviewInput {
  rating: number
  title?: string
  profession?: string
  /** Show the author's XPadite profile photo next to the public review. Omit to leave the saved choice unchanged. */
  showPhoto?: boolean
  body: string
}

export interface MyReview {
  id: string
  rating: number
  title: string | null
  profession: string | null
  /** Author's consent to show their profile photo publicly (absent until migration 020 is applied). */
  show_profile_photo?: boolean
  body: string
  display_name: string
  status: 'published' | 'pending' | 'rejected'
  updated_at: string
}

export type SubmitResult =
  /** photoSynced: true/false = the public photo copy was updated / the update failed; null = nothing to update. */
  | { ok: true; review: MyReview; held: boolean; photoSynced: boolean | null }
  | { ok: false; code: string; message: string }

/** Client-side check for fast feedback only — the database enforces the same rules and is the authority. */
export function validateReview(input: ReviewInput): string | null {
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) return 'Please choose a star rating from 1 to 5.'
  const body = (input.body ?? '').trim()
  if (body.length < REVIEW_LIMITS.bodyMin) return `Please write at least ${REVIEW_LIMITS.bodyMin} characters.`
  if (body.length > REVIEW_LIMITS.bodyMax) return `Your review is too long (max ${REVIEW_LIMITS.bodyMax} characters).`
  if ((input.title ?? '').trim().length > REVIEW_LIMITS.titleMax) return `The title is too long (max ${REVIEW_LIMITS.titleMax} characters).`
  if ((input.profession ?? '').trim().length > REVIEW_LIMITS.professionMax) return `The profession is too long (max ${REVIEW_LIMITS.professionMax} characters).`
  return null
}

/** Turns a database/PostgREST error into a calm, user-facing message plus a stable code. */
export function mapSubmitError(raw: { message?: string; code?: string } | null | undefined): { code: string; message: string } {
  const text = `${raw?.message ?? ''} ${raw?.code ?? ''}`
  if (/not_authenticated|JWT|401/i.test(text)) return { code: 'not_authenticated', message: 'Please sign in again to leave a review.' }
  if (/email_not_verified/i.test(text)) return { code: 'email_not_verified', message: 'Please verify your email address first — check your inbox for the confirmation link.' }
  if (/rate_limited/i.test(text)) return { code: 'rate_limited', message: 'You just saved a review — please wait a few seconds and try again.' }
  if (/invalid_rating/i.test(text)) return { code: 'invalid_rating', message: 'Please choose a star rating from 1 to 5.' }
  if (/invalid_title/i.test(text)) return { code: 'invalid_title', message: `The title is too long (max ${REVIEW_LIMITS.titleMax} characters).` }
  if (/invalid_profession/i.test(text)) return { code: 'invalid_profession', message: `The profession is too long (max ${REVIEW_LIMITS.professionMax} characters).` }
  if (/invalid_body/i.test(text)) return { code: 'invalid_body', message: `Your review must be ${REVIEW_LIMITS.bodyMin}–${REVIEW_LIMITS.bodyMax} characters.` }
  // Function/table missing (migration not applied yet) or any other failure.
  if (/PGRST202|PGRST205|42883|42P01|does not exist|schema cache/i.test(text)) return { code: 'unavailable', message: 'Reviews are not available yet. Please try again later.' }
  return { code: 'failed', message: 'Could not submit your review. Please try again.' }
}

export function isEligibleUser(user: { email_confirmed_at?: string | null } | null | undefined): 'ok' | 'signed_out' | 'unverified' {
  if (!user) return 'signed_out'
  return user.email_confirmed_at ? 'ok' : 'unverified'
}

export async function submitReview(supabase: SupabaseClient, input: ReviewInput): Promise<SubmitResult> {
  const invalid = validateReview(input)
  if (invalid) return { ok: false, code: 'invalid', message: invalid }
  const base = {
    p_rating: input.rating,
    p_title: input.title?.trim() || null,
    p_body: input.body.trim(),
    p_source: 'app',
    p_profession: input.profession?.trim() || null,
  }
  let { data, error } = await supabase.rpc('submit_review', input.showPhoto === undefined ? base : { ...base, p_show_photo: input.showPhoto })
  // Database not yet on migration 020 (no p_show_photo): save the review without the photo choice rather than failing.
  if (error && input.showPhoto !== undefined && /PGRST202|p_show_photo|submit_review/i.test(`${error.code ?? ''} ${error.message ?? ''}`)) {
    ;({ data, error } = await supabase.rpc('submit_review', base))
  }
  if (error || !data) return { ok: false, ...mapSubmitError(error) }
  const review = data as MyReview
  const photoSynced = input.showPhoto === undefined || review.show_profile_photo === undefined ? null : await syncReviewPhoto()
  return { ok: true, review, held: review.status !== 'published', photoSynced }
}

/** Asks the server to bring the public copy of the author's photo in line with their saved consent (copy, or delete). */
export async function syncReviewPhoto(): Promise<boolean> {
  try {
    const res = await fetch('/api/reviews/photo', { method: 'POST' })
    return res.ok
  } catch {
    return false
  }
}

/** The signed-in user's own review, if any (RLS returns only their row). Null when none or when reviews aren't set up yet. */
export async function fetchMyReview(supabase: SupabaseClient): Promise<MyReview | null> {
  const query = (cols: string) => supabase.from('reviews').select(cols).maybeSingle()
  let { data, error } = await query('id, rating, title, profession, show_profile_photo, body, display_name, status, updated_at')
  // Database not yet on migration 020: read without the photo column.
  if (error) ({ data, error } = await query('id, rating, title, profession, body, display_name, status, updated_at'))
  if (error || !data) return null
  return data as unknown as MyReview
}

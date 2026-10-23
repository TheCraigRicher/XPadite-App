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
  body: string
}

export interface MyReview {
  id: string
  rating: number
  title: string | null
  profession: string | null
  body: string
  display_name: string
  status: 'published' | 'pending' | 'rejected'
  updated_at: string
}

export type SubmitResult =
  | { ok: true; review: MyReview; held: boolean }
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
  const { data, error } = await supabase.rpc('submit_review', {
    p_rating: input.rating,
    p_title: input.title?.trim() || null,
    p_body: input.body.trim(),
    p_source: 'app',
    p_profession: input.profession?.trim() || null,
  })
  if (error || !data) return { ok: false, ...mapSubmitError(error) }
  const review = data as MyReview
  return { ok: true, review, held: review.status !== 'published' }
}

/** The signed-in user's own review, if any (RLS returns only their row). Null when none or when reviews aren't set up yet. */
export async function fetchMyReview(supabase: SupabaseClient): Promise<MyReview | null> {
  const { data, error } = await supabase
    .from('reviews')
    .select('id, rating, title, profession, body, display_name, status, updated_at')
    .maybeSingle()
  if (error || !data) return null
  return data as MyReview
}

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Service-role Supabase client. Server-only — bypasses RLS, so it must only be
 * used with a user id taken from a verified session or a verified Stripe event.
 * Never import this from a client component.
 */
export function createAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase service-role is not configured')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

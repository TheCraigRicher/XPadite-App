import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { adminConfigError } from './diagnostics'

/**
 * Service-role Supabase client. Server-only — bypasses RLS, so it must only be
 * used with a user id taken from a verified session or a verified Stripe event.
 * Never import this from a client component.
 *
 * Throws AdminConfigError (with a fixed, secret-free code) when the environment is missing or wrong — including a key
 * issued for a different Supabase project than NEXT_PUBLIC_SUPABASE_URL — instead of letting every query fail silently.
 */
export function createAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const problem = adminConfigError(url, key)
  if (problem) throw problem
  return createClient(url!, key!, { auth: { persistSession: false, autoRefreshToken: false } })
}

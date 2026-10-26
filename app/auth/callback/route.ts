import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'
import { parsePlan, planQuery, safeNext } from '@/lib/billing/intent'
import { createAdminClient } from '@/lib/billing/admin'
import { failureCode } from '@/lib/billing/diagnostics'
import { registerTrialIdentity } from '@/lib/billing/trialIdentity'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  // Same-origin /app paths only (was unvalidated: `//evil.com` could have been used as an open redirect).
  const next = safeNext(searchParams.get('next'))
  // Keep a plan chosen on the Website across a failed attempt, so the retry from /login still carries it.
  const plan = parsePlan(new URL(next, 'http://localhost').searchParams.get('plan'))
  const toLogin = (message: string) => NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(message)}${planQuery(plan).replace('?', '&')}`)

  // Google (or any provider) reports a refusal/cancel as ?error=access_denied — not a failure of ours.
  const providerError = searchParams.get('error')
  if (providerError) {
    return toLogin(providerError === 'access_denied' ? 'Google sign-in was cancelled. You can try again or use your email and password.' : 'Google sign-in could not be completed. Please try again.')
  }

  if (code) {
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          },
        },
      }
    )

    const { data, error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      // Write full_name to profiles on every successful auth exchange.
      // This covers email-signup confirmation AND Google OAuth sign-in.
      // After exchangeCodeForSession the client has the session in memory,
      // so the authenticated UPDATE respects RLS (auth.uid() = id).
      const user = data.user
      // Remember this person's trial identity the moment their email is verified (best effort: never blocks sign-in; the
      // billing status check records it again and is the one that enforces).
      if (user) {
        try { await registerTrialIdentity(createAdminClient(), user) } catch (err) { console.error('[Trial] identity not recorded at sign-in:', failureCode(err)) }
      }
      if (user) {
        const fullName =
          (user.user_metadata?.full_name as string | null | undefined) ||
          (user.user_metadata?.name as string | null | undefined) ||
          null

        if (fullName?.trim()) {
          // Only set if the column is still null — never overwrite an existing name.
          await supabase
            .from('profiles')
            .update({ full_name: fullName.trim() })
            .eq('id', user.id)
            .is('full_name', null)
        }
      }

      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return toLogin('This sign-in link is invalid or has expired. Please try again.')
}

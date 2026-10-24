'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { planQuery } from '@/lib/billing/intent'
import type { BillingPlanKey } from '@/lib/billing/plans'

const GoogleIcon = () => (
  <svg viewBox="0 0 24 24" className="w-4 h-4 flex-shrink-0">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
  </svg>
)

// Google is the only social sign-in. It serves BOTH new registration and returning login: Supabase creates the account on
// first use and signs the same account in afterwards (matching verified emails link to the existing account, so a paid
// email/password account keeps its profile and subscription). The browser is sent to Google (PKCE) and comes back to
// /auth/callback, which exchanges the code for a session and forwards into /app (keeping a plan chosen on the Website).
async function googleEnabled(): Promise<boolean | null> {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !key) return null
    const res = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } })
    if (!res.ok) return null
    const body = (await res.json()) as { external?: { google?: boolean } }
    return typeof body.external?.google === 'boolean' ? body.external.google : null
  } catch {
    return null
  }
}

export function SocialLoginButtons({ plan = null, mode = 'login' }: { plan?: BillingPlanKey | null; mode?: 'login' | 'signup' }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Coming back with the browser's Back button from Google's page would otherwise leave the button stuck on "Redirecting…".
  useEffect(() => {
    const reset = (e: PageTransitionEvent) => { if (e.persisted) setBusy(false) }
    window.addEventListener('pageshow', reset)
    return () => window.removeEventListener('pageshow', reset)
  }, [])

  async function continueWithGoogle() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      // If Google is not switched on for this project, Supabase would show a raw JSON error page. Check first (public
      // settings endpoint, anon key only) and explain instead. A failed check just proceeds.
      const enabled = await googleEnabled()
      if (enabled === false) {
        setError('Google sign-in is not available yet. Please use your email and password.')
        setBusy(false)
        return
      }
      const next = `/app${planQuery(plan)}`
      const { error: oauthError } = await createClient().auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
          queryParams: { prompt: 'select_account' },
        },
      })
      if (oauthError) {
        setError('Google sign-in is unavailable right now. Please use your email and password instead.')
        setBusy(false)
      }
      // On success the browser is already navigating to Google.
    } catch {
      setError('Could not reach Google sign-in. Check your connection and try again.')
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="relative flex items-center gap-3">
        <div className="flex-1 h-px bg-gray-200" />
        <span className="text-xs text-gray-400 font-medium whitespace-nowrap">or continue with</span>
        <div className="flex-1 h-px bg-gray-200" />
      </div>

      <button
        type="button"
        onClick={continueWithGoogle}
        disabled={busy}
        aria-label="Continue with Google"
        className="
          w-full flex items-center justify-center gap-2 h-11 rounded-xl
          border border-gray-200 bg-white
          hover:bg-gray-50 hover:border-gray-300 hover:shadow-sm
          active:scale-[0.99] disabled:opacity-70 disabled:cursor-wait
          transition-all duration-150
          text-gray-700 text-sm font-medium
        "
      >
        <GoogleIcon />
        <span>{busy ? 'Redirecting to Google…' : 'Continue with Google'}</span>
      </button>

      {error && <p role="alert" className="text-xs text-red-600 text-center">{error}</p>}

      {mode === 'signup' && (
        <p className="text-[11px] text-gray-400 text-center leading-snug">
          By continuing with Google you agree to the{' '}
          <Link href="https://www.xpadite.com/terms" target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-600">Terms and Conditions</Link>.
        </p>
      )}
    </div>
  )
}

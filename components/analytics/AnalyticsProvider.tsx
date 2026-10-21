'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useRef, useSyncExternalStore } from 'react'
import {
  analyticsConfigured,
  identifyUser,
  rememberWebsiteVisitorId,
  resetIdentity,
  startAnalytics,
  stopAnalytics,
  trackPageView,
} from '@/lib/analytics/client'
import { clearConsent, getConsentSnapshot, getServerConsentSnapshot, saveConsent, subscribeConsent } from '@/lib/analytics/consent'
import { forgetSyncState, syncConsent } from '@/lib/analytics/consentSync'
import { createClient } from '@/lib/supabase/client'

// Mounted once in the root layout. Runs product analytics only after the user has chosen "Allow" in the notice below
// (off by default — see lib/analytics/consent.ts). Does nothing at all when no PostHog key is configured.
export function AnalyticsProvider() {
  const consent = useSyncExternalStore(subscribeConsent, getConsentSnapshot, getServerConsentSnapshot)
  const allowed = analyticsConfigured && Boolean(consent?.analytics)
  const pathname = usePathname()
  const lastPath = useRef<string | null>(null)
  // false while server-rendering/hydrating, true afterwards — keeps the notice out of the server HTML.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  )

  // A visitor id handed over by the Website link (?xp_aid=…) is kept so the visit can be tied to the sign-up.
  useEffect(() => {
    if (analyticsConfigured) rememberWebsiteVisitorId()
  }, [])

  useEffect(() => {
    if (allowed) startAnalytics()
    else {
      stopAnalytics(consent !== null) // erase stored identity only once the user has declined/withdrawn
      lastPath.current = null
    }
  }, [allowed, consent])

  // One page view per actual navigation (not per re-render).
  useEffect(() => {
    if (!allowed || lastPath.current === pathname) return
    lastPath.current = pathname
    trackPageView(pathname)
  }, [allowed, pathname])

  // Follows the existing Supabase session. Always listening (when configured) so a decline or withdrawal made while
  // signed in still reaches the server, which needs the user's persisted choice for events it sends itself.
  //  - signed in : reconcile the choice with the server copy; identify (internal id only) if analytics is allowed
  //  - signed out: reset identity, forget the previous person's choice so the next person decides for themselves
  const userIdRef = useRef<string | null>(null)
  const allowedRef = useRef(false)
  useEffect(() => {
    allowedRef.current = allowed
  }, [allowed])
  useEffect(() => {
    if (!analyticsConfigured) return
    const supabase = createClient()
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      const id = session?.user?.id ?? null
      userIdRef.current = id
      if (id) {
        setTimeout(() => void syncConsent(), 0) // never call out from inside the auth callback itself
        if (allowedRef.current) identifyUser(id)
      } else if (event === 'SIGNED_OUT') {
        resetIdentity()
        forgetSyncState()
        clearConsent()
        stopAnalytics(true)
      }
    })
    return () => data.subscription.unsubscribe()
  }, [])
  useEffect(() => {
    if (allowed && userIdRef.current) identifyUser(userIdRef.current)
  }, [allowed])
  useEffect(() => {
    if (analyticsConfigured && userIdRef.current) void syncConsent() // the choice changed while signed in
  }, [consent])

  if (!mounted || !analyticsConfigured || consent !== null) return null

  return (
    <div
      role="region"
      aria-label="Analytics choice"
      style={{
        position: 'fixed',
        left: 16,
        right: 16,
        bottom: 'calc(16px + env(safe-area-inset-bottom))',
        zIndex: 9990,
        maxWidth: 380,
        padding: '14px 16px',
        borderRadius: 14,
        background: '#ffffff',
        color: '#1f2937',
        border: '1px solid #ddd6fe',
        boxShadow: '0 10px 30px rgba(76, 29, 149, 0.25)',
        fontSize: 13,
        lineHeight: 1.45,
      }}
    >
      <p style={{ margin: 0 }}>
        <strong>Help improve XPadite?</strong> Allow anonymous usage analytics (which features are used). We never
        record your tasks, journal, notes, email or payment details. You can say no — XPadite works the same.
      </p>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button
          type="button"
          onClick={() => saveConsent(true)}
          style={{ flex: 1, padding: '8px 12px', borderRadius: 10, border: 0, background: '#7c3aed', color: '#fff', fontWeight: 600, cursor: 'pointer' }}
        >
          Allow
        </button>
        <button
          type="button"
          onClick={() => saveConsent(false)}
          style={{ flex: 1, padding: '8px 12px', borderRadius: 10, border: '1px solid #c4b5fd', background: '#fff', color: '#5b21b6', fontWeight: 600, cursor: 'pointer' }}
        >
          No thanks
        </button>
      </div>
    </div>
  )
}

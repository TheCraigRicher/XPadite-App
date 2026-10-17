'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useApp } from './AppContext'
import type { BillingStatus } from '@/lib/billing/types'
import type { BillingPlanKey } from '@/lib/billing/plans'

// ─── Context ──────────────────────────────────────────────────────────────────
// Client view of the SERVER-computed billing status (/api/billing/status).
// The browser never decides access itself — this only mirrors the server's
// verdict for UI purposes; paid-only server routes enforce it independently.

interface BillingCtx {
  status: BillingStatus | null
  refresh: (sessionId?: string) => Promise<BillingStatus | null>
  /** Starts Stripe Checkout for a plan. Resolves with an error message, or null once redirecting. */
  startCheckout: (planKey: BillingPlanKey) => Promise<string | null>
  /** Opens the Stripe Customer Portal. Resolves with an error message, or null once redirecting. */
  openPortal: () => Promise<string | null>
}

const Ctx = createContext<BillingCtx | null>(null)

/** Safe outside the provider (returns null) so shared components never crash. */
export function useBilling(): BillingCtx | null {
  return useContext(Ctx)
}

const PLAN_LABELS: Record<BillingPlanKey, string> = {
  'pro-monthly': 'Pro Monthly',
  'pro-yearly': 'Pro Yearly',
  '3year-pro': '3-Year Pro',
  'ltd': 'Lifetime Pro',
}

export function planLabel(key: BillingPlanKey | null): string {
  return key ? PLAN_LABELS[key] : 'Free'
}

export function daysLeft(iso: string): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000))
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

/** One-line plan description for headers/cards. */
export function describeStatus(s: BillingStatus | null): { title: string; detail: string } {
  if (!s) return { title: 'XPadite', detail: 'Loading plan…' }
  if (s.state === 'paid') {
    const title = planLabel(s.plan)
    if (s.lifetime) return { title, detail: 'Lifetime access' }
    if (s.pastDue) return { title, detail: 'Payment failed — please update your payment method' }
    if (s.accessEndsAt) {
      const verb = s.plan === '3year-pro' ? 'Access until' : s.cancelAtPeriodEnd ? 'Ends' : 'Renews'
      return { title, detail: `${verb} ${fmtDate(s.accessEndsAt)}` }
    }
    return { title, detail: 'Active' }
  }
  if (s.state === 'trial') {
    const d = daysLeft(s.trialEndsAt)
    return { title: 'Free Trial', detail: `${d} day${d === 1 ? '' : 's'} left` }
  }
  return { title: 'Trial ended', detail: 'Choose a plan to continue' }
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function BillingProvider({ children }: { children: ReactNode }) {
  const { setToast } = useApp()
  const [status, setStatus] = useState<BillingStatus | null>(null)
  const handledReturn = useRef(false)

  const refresh = useCallback(async (sessionId?: string) => {
    try {
      const qs = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : ''
      const res = await fetch(`/api/billing/status${qs}`, { cache: 'no-store' })
      if (!res.ok) return null
      const next = (await res.json()) as BillingStatus
      setStatus(next)
      return next
    } catch {
      return null // network blip — keep the last known status
    }
  }, [])

  // Initial load, plus re-check whenever the app regains focus (covers returning
  // from Stripe in another browser tab / the installed PWA after paying).
  useEffect(() => {
    const t = setTimeout(() => { void refresh() }, 0)
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearTimeout(t); document.removeEventListener('visibilitychange', onVisible) }
  }, [refresh])

  // Returning from Stripe Checkout: /app?checkout=success&session_id=cs_...
  // The URL alone grants nothing — the server verifies the session with Stripe.
  useEffect(() => {
    if (handledReturn.current) return
    const params = new URLSearchParams(window.location.search)
    const outcome = params.get('checkout')
    if (!outcome) return
    handledReturn.current = true

    const clean = () => window.history.replaceState(null, '', window.location.pathname)

    if (outcome === 'cancelled') {
      clean()
      setToast('~Checkout cancelled\nNo payment was taken.')
      return
    }
    if (outcome === 'success') {
      const sessionId = params.get('session_id') ?? undefined
      clean()
      void (async () => {
        // The webhook may land a moment after the redirect — poll briefly.
        for (let i = 0; i < 8; i++) {
          const s = await refresh(sessionId)
          if (s?.state === 'paid') {
            setToast(`~Payment confirmed\n${planLabel(s.plan)} is now active.`)
            return
          }
          await new Promise(r => setTimeout(r, 2000))
        }
        setToast('~Payment processing\nYour plan will activate as soon as Stripe confirms it.')
      })()
    }
  }, [refresh, setToast])

  const startCheckout = useCallback(async (planKey: BillingPlanKey) => {
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planKey }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.url) return (data.error as string) || 'Could not start checkout. Please try again.'
      // Full-page navigation to Stripe-hosted Checkout (works in mobile browsers
      // and the installed PWA); Stripe returns to /app via the server-set success_url.
      window.location.assign(data.url as string)
      return null
    } catch {
      return 'Network error — please try again.'
    }
  }, [])

  const openPortal = useCallback(async () => {
    try {
      const res = await fetch('/api/stripe/portal', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.url) return (data.error as string) || 'Could not open billing portal.'
      window.location.assign(data.url as string)
      return null
    } catch {
      return 'Network error — please try again.'
    }
  }, [])

  const value = useMemo(() => ({ status, refresh, startCheckout, openPortal }), [status, refresh, startCheckout, openPortal])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

// ─── Settings → Subscription Plan summary ─────────────────────────────────────

export function BillingSummary({ isDark }: { isDark: boolean }) {
  const billing = useBilling()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!billing?.status) return null
  const s = billing.status
  const { title, detail } = describeStatus(s)
  const warn = s.state === 'expired' || s.pastDue

  return (
    <div style={{
      marginBottom: 14, padding: '12px 14px', borderRadius: 14,
      background: isDark ? 'rgba(124,58,237,0.10)' : 'rgba(124,58,237,0.06)',
      border: `1px solid ${warn ? 'rgba(239,68,68,0.45)' : 'rgba(124,58,237,0.20)'}`,
      display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
    }}>
      <div style={{ flex: 1, minWidth: 140 }}>
        <p style={{ fontSize: 11, fontWeight: 600, opacity: 0.6, color: isDark ? '#fff' : '#111827' }}>Current plan</p>
        <p style={{ fontSize: 14, fontWeight: 700, color: isDark ? '#fff' : '#111827' }}>{title}</p>
        <p style={{ fontSize: 11.5, color: warn ? '#ef4444' : isDark ? 'rgba(255,255,255,0.6)' : '#6b7280' }}>{detail}</p>
        {error && <p style={{ fontSize: 11, color: '#ef4444', marginTop: 4 }}>{error}</p>}
      </div>
      {s.hasStripeCustomer && (
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true); setError(null)
            const err = await billing.openPortal()
            if (err) { setError(err); setBusy(false) }
          }}
          style={{
            padding: '8px 14px', borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: busy ? 'wait' : 'pointer',
            color: 'white', border: 'none', background: 'linear-gradient(135deg, #9146FF 0%, #5D20BF 100%)',
            opacity: busy ? 0.7 : 1,
          }}
        >
          {busy ? 'Opening…' : 'Manage billing'}
        </button>
      )}
    </div>
  )
}

// ─── Trial-expired gate ───────────────────────────────────────────────────────
// Covers the productivity UI (below Settings z-60 / Profile z-70 so both stay
// fully usable on top). It is never a dead end: plans, Profile (with sign-out)
// are one tap away, and all user data is preserved untouched.

export function TrialExpiredGate({ onViewPlans, onOpenProfile }: { onViewPlans: () => void; onOpenProfile: () => void }) {
  const billing = useBilling()
  const s = billing?.status
  if (!s || s.hasAccess) return null

  return (
    <div
      className="fixed inset-x-0 top-0 bottom-14 sm:bottom-0 z-[55] flex items-center justify-center p-4"
      style={{ background: 'var(--xp-bg)', overflowY: 'auto' }}
      role="dialog"
      aria-label="Free trial ended"
    >
      <div style={{
        width: '100%', maxWidth: 440, borderRadius: 24, padding: '28px 24px', textAlign: 'center',
        background: 'var(--xp-bg2, var(--xp-bg))', border: '1px solid rgba(124,58,237,0.25)',
        boxShadow: '0 24px 70px rgba(124,58,237,0.20)',
      }}>
        <div style={{ fontSize: 40, marginBottom: 8 }}>⏳</div>
        <h2 style={{ fontSize: 20, fontWeight: 800, color: 'var(--xp-txt)', marginBottom: 8 }}>Your free trial has ended</h2>
        <p style={{ fontSize: 13.5, lineHeight: 1.55, color: 'var(--xp-txt2)', marginBottom: 20 }}>
          Your 5-day trial is over. All of your tasks, journals and data are safe —
          choose an XPadite Pro plan to pick up exactly where you left off.
        </p>
        <button
          onClick={onViewPlans}
          style={{
            width: '100%', padding: '14px 20px', borderRadius: 14, border: 'none', cursor: 'pointer',
            color: 'white', fontSize: 14.5, fontWeight: 700,
            background: 'linear-gradient(135deg, #9146FF 0%, #5D20BF 100%)',
            boxShadow: '0 4px 20px rgba(145,70,255,0.44)',
          }}
        >
          View plans &amp; upgrade
        </button>
        <button
          onClick={onOpenProfile}
          style={{
            width: '100%', marginTop: 10, padding: '12px 20px', borderRadius: 14, cursor: 'pointer',
            fontSize: 13, fontWeight: 600, color: 'var(--xp-txt)', background: 'transparent',
            border: '1px solid rgba(124,58,237,0.25)',
          }}
        >
          Account &amp; Profile
        </button>
      </div>
    </div>
  )
}

'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useApp } from './AppContext'
import type { BillingStatus } from '@/lib/billing/types'
import { isPurchasablePlanKey, type BillingPlanKey } from '@/lib/billing/plans'
import { parsePlan } from '@/lib/billing/intent'
import { track } from '@/lib/analytics/client'

// ─── Context ──────────────────────────────────────────────────────────────────
// Client view of the SERVER-computed billing status (/api/billing/status).
// The browser never decides access itself — this only mirrors the server's
// verdict for UI purposes; paid-only server routes enforce it independently.

interface BillingCtx {
  status: BillingStatus | null
  /** Set when the plan could NOT be determined (server/database problem) and there is no earlier answer. null = fine or still loading. */
  statusError: string | null
  /** Server time minus device time (ms), measured at the last status refresh. Add it to Date.now() for "server now". */
  clockOffsetMs: number
  refresh: (sessionId?: string) => Promise<BillingStatus | null>
  /** Starts Stripe Checkout for a plan. Resolves with an error message, or null once redirecting. */
  startCheckout: (planKey: BillingPlanKey, source?: 'settings' | 'website_link') => Promise<string | null>
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
  'pro-6month': 'Pro 6-Month',
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
    if (!s.trialEndsAt) return { title: 'Free Trial', detail: '5 days, starting at launch' }
    const d = daysLeft(s.trialEndsAt)
    return { title: 'Free Trial', detail: `${d} day${d === 1 ? '' : 's'} left` }
  }
  return { title: 'Trial ended', detail: 'Choose a plan to continue' }
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function BillingProvider({ children }: { children: ReactNode }) {
  const { setToast } = useApp()
  const [status, setStatus] = useState<BillingStatus | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [clockOffsetMs, setClockOffsetMs] = useState(0)
  const handledReturn = useRef(false)

  const refresh = useCallback(async (sessionId?: string) => {
    try {
      const qs = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : ''
      const res = await fetch(`/api/billing/status${qs}`, { cache: 'no-store' })
      if (!res.ok) {
        // The plan could not be determined — say so. Never fall back to "free"; a previous good answer is kept.
        const body = (await res.json().catch(() => null)) as { code?: string } | null
        setStatusError(body?.code ?? `http_${res.status}`)
        return null
      }
      const next = (await res.json()) as BillingStatus
      setStatus(next)
      setStatusError(null)
      const serverMs = next.serverNow ? Date.parse(next.serverNow) : NaN
      if (Number.isFinite(serverMs)) setClockOffsetMs(serverMs - Date.now())
      return next
    } catch {
      setStatusError('network')
      return null // network blip — keep the last known status
    }
  }, [])

  // Initial load, plus re-check whenever the app regains focus (covers returning
  // from Stripe in another browser tab / the installed PWA after paying).
  // A failed first check (e.g. the session cookie not ready yet) is retried a few times instead of leaving the plan
  // unknown until the user happens to refocus the window.
  useEffect(() => {
    let cancelled = false
    const t = setTimeout(async () => {
      for (let i = 0; i < 4 && !cancelled; i++) {
        if (await refresh()) return
        await new Promise(r => setTimeout(r, 1500 * (i + 1)))
      }
    }, 0)
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { cancelled = true; clearTimeout(t); document.removeEventListener('visibilitychange', onVisible) }
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

  const startCheckout = useCallback(async (planKey: BillingPlanKey, source: 'settings' | 'website_link' = 'settings') => {
    track('plan_selected', { plan_id: planKey, source }) // analytics: a plan chosen (no-op without consent)
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

  const value = useMemo(() => ({ status, statusError, clockOffsetMs, refresh, startCheckout, openPortal }), [status, statusError, clockOffsetMs, refresh, startCheckout, openPortal])
  return (
    <Ctx.Provider value={value}>
      {children}
      <PurchaseIntent />
    </Ctx.Provider>
  )
}

// ─── Website purchase hand-off ────────────────────────────────────────────────
// A visitor who picked a plan on the Website arrives as /app?plan=<key> (the plan survives sign-up, email
// verification and sign-in — see lib/billing/intent.ts). Once signed in and the SERVER-computed billing status has
// loaded, this starts the Stripe Checkout for that plan. It never grants access (only the webhook / server-side
// Stripe verification does), and it never trusts the URL for anything but choosing which allowlisted Checkout to open.

const INTENT_GUARD_KEY = 'xp-checkout-intent'
const INTENT_GUARD_MS = 2 * 60 * 1000 // a refresh/back within this window never opens a second Checkout for the same plan

function PurchaseIntent() {
  const { setToast } = useApp()
  const billing = useBilling()
  const raw = useRef<string | null | undefined>(undefined) // undefined = URL not read yet
  const done = useRef(false)

  // Read the plan once, then strip it from the address bar so a refresh cannot re-trigger it.
  useEffect(() => {
    if (raw.current !== undefined) return
    const params = new URLSearchParams(window.location.search)
    raw.current = params.get('plan')
    if (params.has('plan')) {
      params.delete('plan')
      const qs = params.toString()
      window.history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : ''))
    }
  }, [])

  const status = billing?.status ?? null
  const startCheckout = billing?.startCheckout
  useEffect(() => {
    if (done.current || raw.current === undefined || raw.current === null || !status || !startCheckout) return
    done.current = true
    const plan = parsePlan(raw.current)
    if (!plan) {
      setToast(`~That plan link is not valid
Choose a plan from Settings → Subscription Plan.`)
      return
    }

    // Already-owned / overlapping situations: say so instead of opening a Checkout that cannot help.
    if (status.lifetime) {
      setToast(`~You already have Lifetime Pro
Nothing more to buy — enjoy XPadite!`)
      return
    }
    const isSubPlan = plan === 'pro-monthly' || plan === 'pro-6month' || plan === 'pro-yearly'
    if (status.state === 'paid' && status.plan === plan && isSubPlan) {
      setToast(`~You're already on ${planLabel(plan)}
Manage it from Settings → Subscription Plan.`)
      return
    }
    if (status.state === 'paid' && status.plan === '3year-pro' && plan === '3year-pro') {
      setToast(`~You already have 3-Year Pro
Your access is active.`)
      return
    }

    // Retired offers (3-Year Pro) are no longer sold; the server would refuse anyway, so say so plainly.
    if (!isPurchasablePlanKey(plan)) {
      setToast(`~That plan is no longer offered
Choose a plan from Settings → Subscription Plan.`)
      return
    }

    // Duplicate-session guard (refresh, back button, StrictMode remount, double redirect).
    try {
      const prev = JSON.parse(sessionStorage.getItem(INTENT_GUARD_KEY) || 'null') as { plan?: string; at?: number } | null
      if (prev?.plan === plan && typeof prev.at === 'number' && Date.now() - prev.at < INTENT_GUARD_MS) return
      sessionStorage.setItem(INTENT_GUARD_KEY, JSON.stringify({ plan, at: Date.now() }))
    } catch { /* storage blocked: the URL was already stripped, so a refresh still cannot repeat this */ }

    setToast(`~Opening secure checkout
${planLabel(plan)} — taking you to Stripe…`)
    void startCheckout(plan, 'website_link').then((err) => {
      if (!err) return // redirecting to Stripe
      try { sessionStorage.removeItem(INTENT_GUARD_KEY) } catch { /* ignore */ }
      // Server messages are already user-friendly (sold out, already subscribed, in progress, …).
      setToast(`~Couldn't start checkout
${err}`)
    })
  }, [status, startCheckout, setToast])

  return null
}

// ─── Settings → Subscription Plan summary ─────────────────────────────────────

export function BillingSummary({ isDark }: { isDark: boolean }) {
  const billing = useBilling()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The plan could not be determined: say so (with a retry) — never present a paying customer as Free / Trial.
  if (billing && !billing.status && billing.statusError) {
    return (
      <div style={{
        marginBottom: 14, padding: '12px 14px', borderRadius: 14,
        background: isDark ? 'rgba(124,58,237,0.10)' : 'rgba(124,58,237,0.06)',
        border: '1px solid rgba(239,68,68,0.45)',
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
      }}>
        <div style={{ flex: 1, minWidth: 140 }}>
          <p style={{ fontSize: 11, fontWeight: 600, opacity: 0.6, color: isDark ? '#fff' : '#111827' }}>Current plan</p>
          <p style={{ fontSize: 14, fontWeight: 700, color: isDark ? '#fff' : '#111827' }}>Plan unavailable</p>
          <p style={{ fontSize: 11.5, color: '#ef4444' }}>We couldn&apos;t load your subscription. Your plan has not changed.</p>
        </div>
        <button
          disabled={busy}
          onClick={async () => { setBusy(true); await billing.refresh(); setBusy(false) }}
          style={{
            padding: '8px 14px', borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: busy ? 'wait' : 'pointer',
            color: 'white', border: 'none', background: 'linear-gradient(135deg, #9146FF 0%, #5D20BF 100%)', opacity: busy ? 0.7 : 1,
          }}
        >{busy ? 'Retrying…' : 'Retry'}</button>
      </div>
    )
  }
  if (!billing?.status) return null
  const s = billing.status
  const { title, detail } = describeStatus(s)
  const warn = s.state === 'expired' || s.pastDue
  // 3-Year / Lifetime are one-time purchases: nothing to cancel, the portal only offers invoices and payment details.
  const oneTime = s.plan === '3year-pro' || s.plan === 'ltd'

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
          {busy ? 'Opening…' : oneTime ? 'Billing history' : 'Manage billing'}
        </button>
      )}
    </div>
  )
}

// ─── Trial-expired gate ───────────────────────────────────────────────────────
// Covers the productivity UI (below Settings z-60 / Profile z-70 so both stay
// fully usable on top). It is never a dead end: plans, Profile (with sign-out)
// are one tap away, and all user data is preserved untouched.

export function TrialExpiredGate({ onViewPlans, onOpenProfile, onOpenHelp, priceLine }: {
  onViewPlans: () => void
  onOpenProfile: () => void
  onOpenHelp: () => void
  /** One-line CA$ price summary built from PLAN_CONFIGS by the caller. */
  priceLine?: string
}) {
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
        {priceLine && (
          <p style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--xp-txt2)', marginBottom: 18, fontWeight: 600 }}>{priceLine}</p>
        )}
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
        <button
          onClick={onOpenHelp}
          style={{
            width: '100%', marginTop: 10, padding: '12px 20px', borderRadius: 14, cursor: 'pointer',
            fontSize: 13, fontWeight: 600, color: 'var(--xp-txt)', background: 'transparent',
            border: '1px solid rgba(124,58,237,0.25)',
          }}
        >
          Help &amp; Support
        </button>
      </div>
    </div>
  )
}

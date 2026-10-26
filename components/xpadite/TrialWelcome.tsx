'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useApp } from './AppContext'
import { useBilling } from './BillingContext'
import { claimWelcome, formatTrialEnd, welcomeEligible, welcomeMetaKey } from '@/lib/billing/trialReminder'

// First-time welcome for a trial that has JUST begun. It only READS the existing billing status (no second trial clock):
// the expiry shown is the server's trialEndsAt. Shown once per account (this device + user_metadata for every device), never
// to paid/expired users or to accounts whose trial began more than a day ago. Hidden — not consumed — while any other
// modal/screen is open, so it never interrupts work. Reuses the app's existing confetti keyframes (xp-confetti).

const COLORS = ['#f97316', '#7c3aed', '#22d3ee', '#4ade80', '#fbbf24', '#f472b6', '#a78bfa', '#34d399', '#fb7185', '#60a5fa']

function WelcomeConfetti({ onDone }: { onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 2800); return () => clearTimeout(t) }, [onDone])
  // Two bursts from the upper corners plus one from the centre — larger and slower than the small task-complete pop.
  const [particles] = useState(() => Array.from({ length: 60 }, (_, i) => {
    const origin = i % 3 // 0 left, 1 right, 2 centre
    const base = origin === 0 ? -35 : origin === 1 ? -145 : -90
    const angle = ((base + (Math.random() * 90 - 45)) * Math.PI) / 180
    const dist = 140 + Math.random() * 260
    return {
      left: origin === 0 ? '12%' : origin === 1 ? '88%' : '50%', top: origin === 2 ? '38%' : '22%',
      color: COLORS[i % COLORS.length], tx: Math.cos(angle) * dist, ty: Math.sin(angle) * dist + 220, rot: Math.random() * 720 - 360,
      size: 5 + Math.random() * 6, delay: Math.random() * 0.25, rect: i % 3 !== 0, dur: 1.9 + Math.random() * 0.8,
    }
  }))
  return (
    <div aria-hidden="true" style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 9999, overflow: 'hidden' }}>
      {particles.map((p, i) => (
        <div key={i} style={{
          position: 'absolute', left: p.left, top: p.top, width: p.size, height: p.rect ? p.size * 2.2 : p.size,
          borderRadius: p.rect ? 2 : '50%', background: p.color,
          ['--tx' as string]: `${p.tx}px`, ['--ty' as string]: `${p.ty}px`, ['--rot' as string]: `${p.rot}deg`,
          animation: `xp-confetti ${p.dur}s ${p.delay}s cubic-bezier(0.2,0.8,0.4,1) forwards`,
        } as React.CSSProperties} />
      ))}
    </div>
  )
}

export function TrialWelcome({ suppressed, onVisibleChange }: { suppressed: boolean; onVisibleChange?: (visible: boolean) => void }) {
  const billing = useBilling()
  const { effectiveTimezone } = useApp()
  const status = billing?.status
  const offset = billing?.clockOffsetMs ?? 0
  const [nowMs] = useState(() => Date.now())
  const eligible = welcomeEligible(status, nowMs + offset)
  const [shown, setShown] = useState(false)
  const [confetti, setConfetti] = useState(false)
  const decided = useRef(false)

  useEffect(() => {
    if (!eligible || suppressed || decided.current) return
    decided.current = true
    ;(async () => {
      try {
        const supabase = createClient()
        const { data } = await supabase.auth.getUser()
        const user = data.user
        if (!user) { decided.current = false; return }
        const stamp = new Date().toISOString()
        let storage: Storage | null = null
        try { storage = window.localStorage } catch { /* blocked */ }
        if (!claimWelcome(user.id, user.user_metadata as Record<string, unknown> | undefined, storage, stamp)) return   // already shown once
        void supabase.auth.updateUser({ data: { [welcomeMetaKey]: stamp } })   // best effort; the local marker already holds
        setShown(true)
        const calm = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
        if (!calm) setConfetti(true)
      } catch { decided.current = false /* a welcome is a nicety — never disturb the app */ }
    })()
  }, [eligible, suppressed])

  const visible = shown && eligible && !suppressed && !!status?.trialEndsAt
  useEffect(() => { onVisibleChange?.(visible) }, [visible, onVisibleChange])

  const burst = confetti ? <WelcomeConfetti onDone={() => setConfetti(false)} /> : null
  if (!visible || !status?.trialEndsAt) return burst

  const ends = formatTrialEnd(status.trialEndsAt, effectiveTimezone)
  return (
    <>
      {burst}
      <div
        role="dialog"
        aria-label="Welcome to XPadite"
        className="fixed left-1/2 top-1/2 z-[46] w-[calc(100%-32px)] max-w-[440px]"
        style={{ transform: 'translate(-50%, -50%)', maxHeight: 'calc(100% - 32px)', overflowY: 'auto' }}
      >
        <div style={{
          position: 'relative', padding: '26px 22px 22px', borderRadius: 24, textAlign: 'center',
          background: 'var(--xp-bg2, var(--xp-bg))', border: '1px solid rgba(124,58,237,0.30)',
          boxShadow: '0 28px 80px rgba(124,58,237,0.30)',
        }}>
          <button
            onClick={() => setShown(false)}
            aria-label="Close welcome"
            style={{ position: 'absolute', top: 10, right: 10, width: 28, height: 28, borderRadius: 8, border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--xp-txt3)', fontSize: 18, lineHeight: 1 }}
          >×</button>
          <h2 style={{ fontSize: 19, fontWeight: 800, color: 'var(--xp-txt)', lineHeight: 1.25, marginBottom: 8 }}>
            🎉 Welcome to XPadite! Your 5-Day Free Trial Has Begun!
          </h2>
          <p style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--xp-txt)', marginBottom: 10 }}>
            Your journey toward greater productivity starts today!
          </p>
          <p style={{ fontSize: 12.5, lineHeight: 1.55, color: 'var(--xp-txt2)', marginBottom: 12 }}>
            Enjoy five days of full access to XPadite&apos;s powerful productivity ecosystem. Explore, plan, track your progress, and make every day count.
          </p>
          <p style={{ fontSize: 13, fontWeight: 700, color: '#7c3aed', marginBottom: 12 }}>
            Your free trial ends on {ends}.
          </p>
          <p style={{ fontSize: 11.5, lineHeight: 1.5, color: 'var(--xp-txt3)', marginBottom: 18 }}>
            Your progress and saved work will remain securely associated with your account after the trial ends. Upgrade anytime to continue your journey.
          </p>
          <button
            onClick={() => setShown(false)}
            style={{
              width: '100%', padding: '13px 20px', borderRadius: 14, border: 'none', cursor: 'pointer', color: 'white', fontSize: 14.5, fontWeight: 700,
              background: 'linear-gradient(135deg, #9146FF 0%, #5D20BF 100%)', boxShadow: '0 4px 20px rgba(145,70,255,0.44)',
            }}
          >Let&apos;s Get Started! 🚀</button>
        </div>
      </div>
    </>
  )
}

'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useBilling } from './BillingContext'
import { claimReminder, reminderCopy, reminderFor, reminderMetaKey, type ReminderStage } from '@/lib/billing/trialReminder'

// Friendly Day 3 / 4 / 5 reminder for users who are inside their free trial. It only ever READS the existing billing
// status (no second trial clock) and its Upgrade button opens the existing plans screen (Settings → Stripe Checkout).
//
//  • Each stage is shown at most once per account: it is recorded the moment it is displayed, in localStorage (this
//    device) and in the account's user_metadata (every device).
//  • `suppressed` (any modal/overlay/other screen open) hides it without consuming it — it returns when the user is free.
//  • Never shown to paid users, after the trial ended (the expired-trial paywall owns that), or while enforcement is off.
export function TrialReminderBanner({ suppressed, onUpgrade }: { suppressed: boolean; onUpgrade: () => void }) {
  const billing = useBilling()
  const status = billing?.status
  const offset = billing?.clockOffsetMs ?? 0
  const [nowMs, setNowMs] = useState(() => Date.now())          // re-evaluated each minute (stage changes, hours left)
  const [shown, setShown] = useState<ReminderStage | null>(null)
  const decided = useRef<Set<ReminderStage>>(new Set())        // stages already decided on in this session

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])

  const reminder = reminderFor(status, nowMs + offset)
  const eligible = reminder !== null
  const stage = reminder?.stage ?? null

  useEffect(() => {
    if (stage === null) return
    if (decided.current.has(stage)) return
    decided.current.add(stage)
    let cancelled = false
    ;(async () => {
      try {
        const supabase = createClient()
        const { data } = await supabase.auth.getUser()
        const user = data.user
        if (!user || cancelled) return
        const stamp = new Date().toISOString()
        let storage: Storage | null = null
        try { storage = window.localStorage } catch { /* blocked */ }
        if (!claimReminder(user.id, user.user_metadata as Record<string, unknown> | undefined, storage, stage, stamp)) return   // already shown once
        void supabase.auth.updateUser({ data: { [reminderMetaKey(stage)]: stamp } })   // best effort; the local marker already holds
        if (!cancelled) setShown(stage)
      } catch { /* a reminder is a nicety — never disturb the app */ }
    })()
    return () => { cancelled = true }
  }, [stage])

  // The trial moved on to another stage (or ended / was paid for) while a banner was up.
  const live = shown !== null && stage === shown && eligible
  if (!live || suppressed || !reminder) return null

  const { title, body } = reminderCopy(reminder)
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed left-1/2 top-3 z-[45] w-[calc(100%-24px)] max-w-[460px]"
      style={{ transform: 'translateX(-50%)' }}
    >
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 16,
        background: 'var(--xp-bg2, var(--xp-bg))', border: '1px solid rgba(124,58,237,0.30)',
        boxShadow: '0 12px 40px rgba(124,58,237,0.22)',
      }}>
        <div style={{ fontSize: 22, flexShrink: 0 }} aria-hidden="true">{reminder.stage === 5 ? '⏳' : '✨'}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--xp-txt)', lineHeight: 1.25 }}>{title}</p>
          <p style={{ fontSize: 11.5, lineHeight: 1.4, color: 'var(--xp-txt2)', marginTop: 2 }}>{body}</p>
        </div>
        <button
          onClick={() => { setShown(null); onUpgrade() }}
          style={{
            flexShrink: 0, padding: '8px 14px', borderRadius: 10, border: 'none', cursor: 'pointer',
            color: 'white', fontSize: 12, fontWeight: 700, background: 'linear-gradient(135deg, #9146FF 0%, #5D20BF 100%)',
            boxShadow: '0 3px 14px rgba(145,70,255,0.40)',
          }}
        >Upgrade</button>
        <button
          onClick={() => setShown(null)}
          aria-label="Dismiss reminder"
          style={{ flexShrink: 0, width: 26, height: 26, borderRadius: 8, border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--xp-txt3)', fontSize: 16, lineHeight: 1 }}
        >×</button>
      </div>
    </div>
  )
}

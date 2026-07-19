'use client'

import { useState } from 'react'
import { useApp } from './AppContext'
import { computeNextRunAt } from '@/lib/reminders'
import type { Reminder, RepeatFrequency } from './types'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const FREQUENCIES: { value: RepeatFrequency; label: string }[] = [
  { value: 'once',    label: 'Once'    },
  { value: 'daily',   label: 'Daily'   },
  { value: 'weekly',  label: 'Weekly'  },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly',  label: 'Yearly'  },
]

// ─── Props ───────────────────────────────────────────────────────────────────

interface ReminderModalProps {
  taskId: string
  dateKey: string
  taskText: string
  existingReminder: Reminder | null
  onClose: () => void
  onSaved?: () => void
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ReminderModal({
  taskId,
  dateKey,
  taskText,
  existingReminder,
  onClose,
  onSaved,
}: ReminderModalProps) {
  const { upsertReminderCtx, removeReminderCtx, userEmail, isDark } = useApp()

  const existing = existingReminder

  const [time, setTime] = useState(existing?.reminderTime ?? '09:00')
  const [frequency, setFrequency] = useState<RepeatFrequency>(existing?.repeatFrequency ?? 'once')
  const [soundOn, setSoundOn] = useState(existing?.soundEnabled ?? false)
  const [browserOn, setBrowserOn] = useState(existing?.browserNotificationEnabled ?? false)
  const [emailOn, setEmailOn] = useState(existing?.emailEnabled ?? false)
  const [emailAddr, setEmailAddr] = useState(existing?.emailAddress ?? userEmail)
  const [permDenied, setPermDenied] = useState(false)
  const [saving, setSaving] = useState(false)

  async function handleBrowserToggle() {
    if (browserOn) {
      setBrowserOn(false)
      setPermDenied(false)
      return
    }
    if (typeof Notification === 'undefined') return
    if (Notification.permission === 'granted') {
      setBrowserOn(true)
    } else if (Notification.permission === 'default') {
      const result = await Notification.requestPermission()
      if (result === 'granted') {
        setBrowserOn(true)
        setPermDenied(false)
      } else {
        setPermDenied(true)
      }
    } else {
      setPermDenied(true)
    }
  }

  async function handleSave() {
    setSaving(true)
    const timezone = typeof Intl !== 'undefined'
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : undefined
    const nextRunAt = computeNextRunAt(time, frequency, Date.now(), timezone)
    await upsertReminderCtx({
      ...(existing?.id ? { id: existing.id } : {}),
      taskId,
      dateKey,
      taskText,
      reminderTime: time,
      repeatFrequency: frequency,
      soundEnabled: soundOn,
      browserNotificationEnabled: browserOn,
      emailEnabled: emailOn,
      emailAddress: emailOn ? emailAddr : '',
      isActive: true,
      nextRunAt,
      lastSentAt: null,
      localFiredAt: null,
      timezone,
    })
    setSaving(false)
    onSaved?.()
    onClose()
  }

  async function handleRemove() {
    if (!existing) return
    await removeReminderCtx(existing.id)
    onClose()
  }

  const card: React.CSSProperties = {
    background: 'var(--xp-card)',
    border: '0.5px solid var(--xp-bdr2)',
    borderRadius: 20,
    padding: '24px 24px 20px',
    width: '100%',
    maxWidth: 400,
    boxShadow: '0 24px 80px rgba(0,0,0,0.45)',
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
  }

  const label: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.06em',
    color: 'var(--xp-txt3)',
    textTransform: 'uppercase',
    marginBottom: 6,
  }

  const toggle = (active: boolean) => ({
    position: 'relative' as const,
    width: 40,
    height: 22,
    borderRadius: 11,
    background: active ? '#7c3aed' : (isDark ? 'rgba(255,255,255,0.1)' : '#d1d5db'),
    border: `0.5px solid ${active ? 'rgba(167,139,250,0.35)' : 'var(--xp-bdr2)'}`,
    cursor: 'pointer',
    transition: 'background 0.2s',
    flexShrink: 0,
  })

  const toggleThumb = (active: boolean) => ({
    position: 'absolute' as const,
    top: 3,
    left: active ? 21 : 3,
    width: 16,
    height: 16,
    borderRadius: '50%',
    background: 'white',
    transition: 'left 0.2s',
    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
  })

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-[200] px-4"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={e => e.stopPropagation()}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={card}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--xp-txt)', marginBottom: 3 }}>
              🔔 Set Reminder
            </div>
            <div
              style={{
                fontSize: 11,
                color: 'var(--xp-txt3)',
                maxWidth: 280,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {taskText}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ color: 'var(--xp-txt3)', fontSize: 18, lineHeight: 1, flexShrink: 0, marginTop: 2 }}
          >
            ×
          </button>
        </div>

        {/* Time picker */}
        <div>
          <div style={label}>Reminder Time</div>
          <input
            type="time"
            value={time}
            onChange={e => setTime(e.target.value)}
            style={{
              width: '100%',
              padding: '9px 12px',
              borderRadius: 10,
              border: '1px solid var(--xp-bdr2)',
              background: 'var(--xp-bg2)',
              color: 'var(--xp-txt)',
              fontSize: 14,
              fontWeight: 600,
              outline: 'none',
            }}
          />
        </div>

        {/* Frequency selector */}
        <div>
          <div style={label}>Repeat</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {FREQUENCIES.map(f => {
              const active = frequency === f.value
              return (
                <button
                  key={f.value}
                  onClick={() => setFrequency(f.value)}
                  style={{
                    padding: '5px 12px',
                    borderRadius: 20,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    background: active ? 'linear-gradient(135deg, #6d28d9, #7c3aed)' : 'var(--xp-bg2)',
                    color: active ? 'white' : 'var(--xp-txt2)',
                    border: `0.5px solid ${active ? 'rgba(167,139,250,0.4)' : 'var(--xp-bdr2)'}`,
                    transition: 'all 0.15s',
                  }}
                >
                  {f.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Alert toggles */}
        <div>
          <div style={label}>Alerts</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

            {/* Sound */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13, color: 'var(--xp-txt)' }}>🔊 Sound alert</span>
              <div style={toggle(soundOn)} onClick={() => setSoundOn(v => !v)}>
                <div style={toggleThumb(soundOn)} />
              </div>
            </div>

            {/* Browser notification */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, color: 'var(--xp-txt)' }}>🔔 Browser notification</span>
                <div style={toggle(browserOn)} onClick={handleBrowserToggle}>
                  <div style={toggleThumb(browserOn)} />
                </div>
              </div>
              {permDenied && (
                <p style={{ fontSize: 10, color: '#f59e0b', marginTop: 4 }}>
                  Permission denied — enable notifications in browser settings.
                </p>
              )}
            </div>

            {/* Email */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, color: 'var(--xp-txt)' }}>📧 Email reminder</span>
                <div style={toggle(emailOn)} onClick={() => setEmailOn(v => !v)}>
                  <div style={toggleThumb(emailOn)} />
                </div>
              </div>
              {emailOn && (
                <input
                  type="email"
                  value={emailAddr}
                  onChange={e => setEmailAddr(e.target.value)}
                  placeholder="your@email.com"
                  style={{
                    marginTop: 6,
                    width: '100%',
                    padding: '7px 10px',
                    borderRadius: 8,
                    border: '1px solid var(--xp-bdr2)',
                    background: 'var(--xp-bg2)',
                    color: 'var(--xp-txt)',
                    fontSize: 12,
                    outline: 'none',
                  }}
                />
              )}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
          {existing && (
            <button
              onClick={handleRemove}
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: '#ef4444',
                padding: '8px 14px',
                borderRadius: 10,
                border: '0.5px solid rgba(239,68,68,0.3)',
                background: 'rgba(239,68,68,0.06)',
                cursor: 'pointer',
              }}
            >
              Remove
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button
            onClick={onClose}
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--xp-txt2)',
              padding: '8px 14px',
              borderRadius: 10,
              border: '0.5px solid var(--xp-bdr2)',
              background: 'transparent',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: 'white',
              padding: '8px 18px',
              borderRadius: 10,
              background: 'linear-gradient(135deg, #6d28d9, #7c3aed)',
              border: '0.5px solid rgba(167,139,250,0.35)',
              cursor: saving ? 'not-allowed' : 'pointer',
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? 'Saving…' : 'Save Reminder'}
          </button>
        </div>
      </div>
    </div>
  )
}

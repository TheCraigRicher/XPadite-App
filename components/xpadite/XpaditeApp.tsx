'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { useApp, AppProvider } from './AppContext'
import { AppHeader } from './AppHeader'
import { AppSidebar } from './AppSidebar'
import { ActivityBar } from './ActivityBar'
import { StatsRow } from './StatsRow'
import { LegendRow } from './LegendRow'
import { CalendarSection } from './CalendarSection'
import { DayModal } from './DayModal'
import { MonthZoomModal } from './MonthZoomModal'
import { MonthFullPage } from './MonthFullPage'
import { DayDashboardModal } from './DayDashboardModal'
import { YearlyDashboardModal } from './YearlyDashboardModal'
import { GalleryModal } from './GalleryModal'
import { SettingsModal } from './SettingsModal'
import { MobileBottomNav } from './MobileBottomNav'
import { ProfileModal } from './ProfileModal'
import { ActivityManagerModal } from './ActivityManagerModal'
import { dateKey } from './utils'
import type { MobileTab } from './MobileBottomNav'

interface XpaditeAppProps {
  email: string
}

// ─── QOTD data ────────────────────────────────────────────────────────────────

const QOTD_LIST = [
  { quote: "The secret of getting ahead is getting started.", author: "Mark Twain" },
  { quote: "Small steps every day compound into extraordinary results.", author: "Xpadite" },
  { quote: "It always seems impossible until it's done.", author: "Nelson Mandela" },
  { quote: "Don't watch the clock; do what it does. Keep going.", author: "Sam Levenson" },
  { quote: "The future depends on what you do today.", author: "Mahatma Gandhi" },
  { quote: "Success is not final, failure is not fatal — it's the courage to continue that counts.", author: "Winston Churchill" },
  { quote: "Focus on being productive instead of busy.", author: "Anonymous" },
  { quote: "Excellence is not an act, but a habit.", author: "Aristotle" },
  { quote: "You don't have to be great to start, but you have to start to be great.", author: "Zig Ziglar" },
  { quote: "Consistency is the foundation of achievement.", author: "Xpadite" },
  { quote: "The discipline you maintain today builds the life you want tomorrow.", author: "Xpadite" },
  { quote: "Push yourself, because no one else is going to do it for you.", author: "Anonymous" },
  { quote: "Great things never come from comfort zones.", author: "Anonymous" },
  { quote: "Your limitation is only your imagination.", author: "Anonymous" },
  { quote: "One productive day at a time — that's how it's built.", author: "Xpadite" },
  { quote: "The only way to do great work is to love what you do.", author: "Steve Jobs" },
  { quote: "Dream it. Wish it. Do it.", author: "Anonymous" },
]

// Deterministic per calendar day: same day → same quote
const _qotdToday = (() => {
  const d = new Date()
  const key = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()
  return QOTD_LIST[key % QOTD_LIST.length]
})()

// ─── Motivation Modal ─────────────────────────────────────────────────────────

const MOTIVATION_QUOTES = [
  { quote: 'The secret of getting ahead is getting started.', author: 'Mark Twain' },
  { quote: "It always seems impossible until it's done.", author: 'Nelson Mandela' },
  { quote: "Don't watch the clock; do what it does. Keep going.", author: 'Sam Levenson' },
  { quote: 'The future depends on what you do today.', author: 'Mahatma Gandhi' },
  { quote: 'Success is not final, failure is not fatal.', author: 'Winston Churchill' },
  { quote: 'Small steps every day compound into extraordinary results.', author: 'Xpadite' },
]

function MotivationModal({ onClose }: { onClose: () => void }) {
  const idx = useMemo(() => Math.floor(Math.random() * MOTIVATION_QUOTES.length), [])
  const { quote, author } = MOTIVATION_QUOTES[idx]

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={onClose}>
      <div
        className="w-full max-w-[360px] rounded-2xl p-7 shadow-2xl text-center"
        style={{ background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="text-4xl mb-4">✨</div>
        <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--xp-txt)' }}>Daily Motivation</h2>
        <blockquote className="text-sm italic leading-relaxed mb-2" style={{ color: 'var(--xp-txt2)' }}>
          &ldquo;{quote}&rdquo;
        </blockquote>
        <p className="text-xs mb-6" style={{ color: 'var(--xp-txt3)' }}>— {author}</p>
        <p className="text-[10px] px-3 py-1.5 rounded-full inline-block mb-6" style={{ background: 'var(--xp-bg3)', color: 'var(--xp-txt3)' }}>
          🤖 AI-powered personalized motivation coming soon
        </p>
        <div>
          <button onClick={onClose} className="px-7 py-2 rounded-full text-sm font-medium text-white transition-opacity hover:opacity-80" style={{ background: '#7c3aed' }}>
            Let&apos;s Go 🚀
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function Toast({ message, exiting, onDismiss }: { message: string; exiting: boolean; onDismiss: () => void }) {
  const isInfo = message.startsWith('~')
  const clean = isInfo ? message.slice(1) : message
  const nl = clean.indexOf('\n')
  const title = nl >= 0 ? clean.slice(0, nl) : undefined
  const body  = nl >= 0 ? clean.slice(nl + 1) : clean

  return (
    <div
      className={exiting ? 'xp-toast-out' : ''}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        padding: '12px 16px',
        borderRadius: 14,
        minWidth: 240,
        maxWidth: 320,
        boxShadow: '0 8px 32px rgba(0,0,0,0.30)',
        background: isInfo ? 'linear-gradient(135deg, #6d28d9 0%, #7c3aed 100%)' : '#1e1030',
        border: `0.5px solid ${isInfo ? 'rgba(167,139,250,0.4)' : 'rgba(255,255,255,0.12)'}`,
        animation: exiting ? undefined : 'toast-in 0.25s ease-out',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        {title && (
          <div style={{ fontSize: 12, fontWeight: 700, color: 'white', marginBottom: 3, lineHeight: 1.3 }}>
            {title}
          </div>
        )}
        <div style={{ fontSize: 12, color: isInfo ? 'rgba(255,255,255,0.82)' : '#e8e8f0', lineHeight: 1.45 }}>
          {body}
        </div>
      </div>
      <button
        onClick={onDismiss}
        style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', flexShrink: 0, marginTop: 1, lineHeight: 1 }}
        className="hover:opacity-100 transition-opacity"
      >
        ✕
      </button>
    </div>
  )
}

// ─── Reminder sound (Web Audio API — no audio file needed) ───────────────────

function playReminderSound() {
  try {
    const Ctx = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const play = (freq: number, start: number) => {
      const osc  = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, ctx.currentTime + start)
      gain.gain.setValueAtTime(0, ctx.currentTime + start)
      gain.gain.linearRampToValueAtTime(0.22, ctx.currentTime + start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + 0.45)
      osc.start(ctx.currentTime + start)
      osc.stop(ctx.currentTime + start + 0.45)
    }
    play(880,  0)
    play(1100, 0.18)
    play(1320, 0.36)
    setTimeout(() => ctx.close(), 1400)
  } catch {}
}

// ─── Reminder checker (polls every 30s, fires in-app + browser + sound) ──────

function ReminderChecker() {
  const { reminders, fireReminderCtx, setToast } = useApp()

  const remindersRef = useRef(reminders)
  remindersRef.current = reminders
  const fireRef = useRef(fireReminderCtx)
  fireRef.current = fireReminderCtx
  const toastRef = useRef(setToast)
  toastRef.current = setToast

  const firedRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    function check() {
      const now = Date.now()
      remindersRef.current.forEach(r => {
        if (!r.isActive) return
        if (r.repeatFrequency === 'once' && r.localFiredAt !== null) return
        if (r.nextRunAt > now) return
        const key = `${r.id}:${r.nextRunAt}`
        if (firedRef.current.has(key)) return
        firedRef.current.add(key)
        toastRef.current(`~🔔 Reminder: ${r.taskText}\nTime to start your task.`)
        if (r.browserNotificationEnabled && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          new Notification(`🔔 ${r.taskText}`, { body: 'Time to start your task.', icon: '/favicon.ico' })
        }
        if (r.soundEnabled) playReminderSound()
        fireRef.current(r.id)
      })
    }
    check()
    const id = setInterval(check, 30_000)
    return () => clearInterval(id)
  }, [])

  return null
}

// ─── Mobile Tasks View ────────────────────────────────────────────────────────

function MobileTasksView({ onOpenDay }: { onOpenDay: (key: string, month: number, day: number) => void }) {
  const { calData, updateDay } = useApp()
  const today = new Date()
  const key = dateKey(today.getFullYear(), today.getMonth(), today.getDate())
  const dayData = calData[key]
  const tasks = dayData?.tasks ?? []
  const done = tasks.filter(t => t.done).length

  function toggleTask(taskId: string) {
    updateDay(key, prev => ({
      ...prev,
      tasks: prev.tasks.map(t => t.id === taskId ? { ...t, done: !t.done } : t),
    }))
  }

  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

  return (
    <div className="flex flex-col flex-1" style={{ minHeight: 0 }}>
      {/* Header */}
      <div className="px-4 pt-4 pb-3 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold" style={{ color: 'var(--xp-txt)' }}>Today&apos;s Tasks</h2>
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--xp-txt3)' }}>
            {today.getDate()} {months[today.getMonth()]} · {done}/{tasks.length} complete
          </p>
        </div>
        <button
          onClick={() => onOpenDay(key, today.getMonth(), today.getDate())}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-white transition-opacity hover:opacity-85"
          style={{ background: '#7c3aed' }}
        >
          + Add Task
        </button>
      </div>

      {/* Progress bar */}
      {tasks.length > 0 && (
        <div className="px-4 mb-3">
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--xp-bg3)' }}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${Math.round((done / tasks.length) * 100)}%`, background: 'linear-gradient(90deg, #7c3aed, #a78bfa)' }}
            />
          </div>
          <p className="text-[10px] mt-1 text-right" style={{ color: 'var(--xp-txt3)' }}>
            {Math.round((done / tasks.length) * 100)}% complete
          </p>
        </div>
      )}

      {/* Task list */}
      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">
        {tasks.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center py-16 text-center"
          >
            <div className="text-4xl mb-3">✅</div>
            <p className="text-sm font-medium" style={{ color: 'var(--xp-txt)' }}>No tasks for today</p>
            <p className="text-[11px] mt-1" style={{ color: 'var(--xp-txt3)' }}>Tap &ldquo;Add Task&rdquo; to get started</p>
            <button
              onClick={() => onOpenDay(key, today.getMonth(), today.getDate())}
              className="mt-4 px-5 py-2 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-85"
              style={{ background: '#7c3aed' }}
            >
              Open Day
            </button>
          </div>
        ) : (
          tasks.map((task, i) => (
            <div
              key={task.id}
              className="flex items-center gap-3 px-3.5 py-3 rounded-xl transition-all duration-150"
              style={{
                background: task.done ? 'rgba(22,163,74,0.06)' : 'var(--xp-bg3)',
                border: `0.5px solid ${task.done ? 'rgba(22,163,74,0.2)' : 'var(--xp-bdr)'}`,
              }}
            >
              {/* Checkbox */}
              <button
                onClick={() => toggleTask(task.id)}
                className="w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center transition-all duration-150"
                style={{
                  background: task.done ? '#16a34a' : 'transparent',
                  border: `1.5px solid ${task.done ? '#16a34a' : 'rgba(124,58,237,0.4)'}`,
                }}
              >
                {task.done && <span className="text-white text-[10px] font-bold">✓</span>}
              </button>

              {/* Task text */}
              <span
                className="flex-1 text-sm leading-snug"
                style={{
                  color: task.done ? 'var(--xp-txt3)' : 'var(--xp-txt)',
                  textDecoration: task.done ? 'line-through' : 'none',
                  opacity: task.done ? 0.6 : 1,
                }}
              >
                {i + 1}. {task.text}
              </span>

              {/* Milestone badge */}
              {task.milestone && (
                <span className="text-xs flex-shrink-0">🏆</span>
              )}
            </div>
          ))
        )}
      </div>

      {/* Footer: open full day */}
      {tasks.length > 0 && (
        <div className="px-4 pb-4 pt-1">
          <button
            onClick={() => onOpenDay(key, today.getMonth(), today.getDate())}
            className="w-full py-2.5 rounded-xl text-sm font-medium transition-opacity hover:opacity-75"
            style={{ background: 'var(--xp-bg3)', color: 'var(--xp-txt2)', border: '0.5px solid var(--xp-bdr2)' }}
          >
            Open Full Day View →
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Mobile AI Coach View ─────────────────────────────────────────────────────

function MobileAICoachView() {
  return (
    <div className="flex flex-col items-center justify-center flex-1 px-6 py-12 text-center">
      <div
        className="w-20 h-20 rounded-2xl flex items-center justify-center mb-5 mx-auto"
        style={{ background: 'linear-gradient(135deg, #4c1d95, #7c3aed)', boxShadow: '0 8px 32px rgba(124,58,237,0.35)' }}
      >
        <span className="text-4xl">🤖</span>
      </div>
      <h2 className="text-lg font-bold mb-2" style={{ color: 'var(--xp-txt)' }}>AI Coach</h2>
      <p className="text-sm leading-relaxed mb-6" style={{ color: 'var(--xp-txt2)', maxWidth: 280 }}>
        Your personal AI productivity coach. Get insights, build habits, and crush your goals with personalized guidance.
      </p>

      <div className="w-full max-w-[320px] space-y-3 mb-8">
        {[
          { icon: '🎯', label: 'Goal Setting with AI',      soon: false },
          { icon: '📅', label: 'AI Weekly Plans',            soon: true  },
          { icon: '📊', label: 'Personalized Insights',      soon: true  },
          { icon: '💡', label: 'Habit Recommendations',      soon: true  },
          { icon: '🏆', label: 'Accountability Reviews',     soon: true  },
        ].map(f => (
          <div
            key={f.label}
            className="flex items-center gap-3 px-4 py-3 rounded-xl text-left"
            style={{
              background: 'var(--xp-bg3)',
              border: '0.5px solid var(--xp-bdr)',
              opacity: f.soon ? 0.65 : 1,
            }}
          >
            <span className="text-lg w-6 text-center">{f.icon}</span>
            <span className="flex-1 text-sm" style={{ color: 'var(--xp-txt)' }}>{f.label}</span>
            {f.soon ? (
              <span
                className="text-[9px] font-bold px-2 py-0.5 rounded-full"
                style={{ background: 'rgba(124,58,237,0.12)', color: '#a78bfa', letterSpacing: '0.06em' }}
              >
                SOON
              </span>
            ) : (
              <span
                className="text-[9px] font-bold px-2 py-0.5 rounded-full"
                style={{ background: 'rgba(22,163,74,0.12)', color: '#22c55e', letterSpacing: '0.06em' }}
              >
                FREE
              </span>
            )}
          </div>
        ))}
      </div>

      <p className="text-[11px]" style={{ color: 'var(--xp-txt3)' }}>
        🔒 Premium unlocks full AI Coach experience
      </p>
    </div>
  )
}

// ─── Mobile More View ─────────────────────────────────────────────────────────

function MobileMoreView({ onGallery, onSettings }: { onGallery: () => void; onSettings: () => void }) {
  const items = [
    { icon: '🖼️', label: 'Gallery',        subtitle: 'Your shared progress cards',  action: onGallery  },
    { icon: '⚙️', label: 'Settings',       subtitle: 'App preferences & color',      action: onSettings },
    { icon: '❓', label: 'Help & Feedback', subtitle: 'Get support or share ideas',   action: undefined  },
  ]

  return (
    <div className="px-4 py-4 space-y-2">
      <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--xp-txt)' }}>More</h2>
      {items.map(item => (
        <button
          key={item.label}
          onClick={item.action}
          className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl text-left transition-all duration-150 hover:opacity-80"
          style={{ background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr)' }}
        >
          <span className="text-xl w-7 text-center">{item.icon}</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium" style={{ color: 'var(--xp-txt)' }}>{item.label}</p>
            <p className="text-[11px] mt-0.5" style={{ color: 'var(--xp-txt3)' }}>{item.subtitle}</p>
          </div>
          <span style={{ color: 'var(--xp-txt3)', fontSize: 12 }}>›</span>
        </button>
      ))}
    </div>
  )
}

// ─── ThemedApp ────────────────────────────────────────────────────────────────

interface ModalDay { key: string; month: number; day: number }

function ThemedApp(_props: XpaditeAppProps) {
  const { isDark, toast, setToast } = useApp()

  const [toastExiting, setToastExiting]             = useState(false)
  const [modalDay, setModalDay]                     = useState<ModalDay | null>(null)
  const [dashboardDay, setDashboardDay]             = useState<ModalDay | null>(null)
  const [zoomedMonth, setZoomedMonth]               = useState<number | null>(null)
  const [fullPageMonth, setFullPageMonth]           = useState<number | null>(null)
  const [motivationOpen, setMotivationOpen]         = useState(false)
  const [yearlyOpen, setYearlyOpen]                 = useState(false)
  const [galleryOpen, setGalleryOpen]               = useState(false)
  const [settingsOpen, setSettingsOpen]             = useState(false)
  const [profileOpen, setProfileOpen]               = useState(false)
  const [activityManagerOpen, setActivityManagerOpen] = useState(false)

  // ── Mobile tab ────────────────────────────────────────────────────────────────
  const [mobileTab, setMobileTab] = useState<MobileTab>('overview')

  // When Analytics tab selected → auto-open yearly modal
  useEffect(() => {
    if (mobileTab === 'analytics') setYearlyOpen(true)
  }, [mobileTab])

  function handleYearlyClose() {
    setYearlyOpen(false)
    if (mobileTab === 'analytics') setMobileTab('overview')
  }

  // ── Mobile collapsible stats ──────────────────────────────────────────────────
  const [statsCollapsed, setStatsCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem('xp-stats-collapsed') === 'true'
  })

  function toggleStats() {
    const next = !statsCollapsed
    setStatsCollapsed(next)
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('xp-stats-collapsed', String(next))
    }
  }

  // ── QOTD banner ───────────────────────────────────────────────────────────────
  const [qotdIn, setQotdIn] = useState(false)
  const qotdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (qotdTimerRef.current) clearTimeout(qotdTimerRef.current) }, [])

  useEffect(() => {
    if (!qotdIn) return
    function onDocClick() {
      if (qotdTimerRef.current) { clearTimeout(qotdTimerRef.current); qotdTimerRef.current = null }
      setQotdIn(false)
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [qotdIn])

  function triggerQotd() {
    if (qotdTimerRef.current) { clearTimeout(qotdTimerRef.current); qotdTimerRef.current = null }
    setQotdIn(true)
    qotdTimerRef.current = setTimeout(() => setQotdIn(false), 7000)
  }

  // ── Auto-dismiss toast with fade-out ──────────────────────────────────────────
  useEffect(() => {
    if (!toast) { setToastExiting(false); return }
    setToastExiting(false)
    const t1 = setTimeout(() => setToastExiting(true), 2700)
    const t2 = setTimeout(() => setToast(null), 3000)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [toast, setToast])

  // ── Helpers ───────────────────────────────────────────────────────────────────
  function openDayModal(key: string, month: number, day: number) {
    setModalDay({ key, month, day })
    if (mobileTab === 'tasks') setMobileTab('overview')
  }

  return (
    <div
      className={isDark ? 'xp-dark' : 'xp-light'}
      style={{
        minHeight: '100vh',
        background: 'var(--xp-bg)',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <ReminderChecker />
      <AppSidebar
        onGallery={() => setGalleryOpen(true)}
        onSettings={() => setSettingsOpen(true)}
        onAnalytics={() => setYearlyOpen(true)}
        onMotivate={() => setMotivationOpen(true)}
        onQotd={triggerQotd}
        onProfile={() => setProfileOpen(true)}
        onActivities={() => setActivityManagerOpen(true)}
      />

      {/* QOTD banner */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          overflow: 'hidden',
          maxHeight: qotdIn ? '44px' : '0px',
          opacity: qotdIn ? 1 : 0,
          transition: 'max-height 300ms ease, opacity 250ms ease',
          willChange: 'max-height, opacity',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            background: 'linear-gradient(90deg, #4c1d95 0%, #5b21b6 50%, #4c1d95 100%)',
            padding: '9px 24px',
            textAlign: 'center',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          <span style={{ fontSize: 10, color: 'rgba(216,180,254,0.7)', fontWeight: 600, letterSpacing: '0.08em', marginRight: 8 }}>
            QUOTE OF THE DAY
          </span>
          <span style={{ fontSize: 11.5, color: 'white', fontStyle: 'italic', fontWeight: 400 }}>
            &ldquo;{_qotdToday.quote}&rdquo;
          </span>
          <span style={{ fontSize: 10, color: 'rgba(216,180,254,0.55)', marginLeft: 8 }}>
            — {_qotdToday.author}
          </span>
        </div>
      </div>

      {/* Header */}
      <AppHeader
        onYearDash={() => setYearlyOpen(true)}
        onMotivate={() => setMotivationOpen(true)}
      />

      {/* ── MAIN CONTENT ─────────────────────────────────────────────────── */}
      <div
        className="xp-main-content"
        style={{ maxWidth: 1360, width: '100%', margin: '0 auto', paddingLeft: 16, paddingRight: 16, flex: 1, display: 'flex', flexDirection: 'column' }}
      >
        {/* ActivityBar — always shown (add/edit/remove hidden on mobile via CSS) */}
        <ActivityBar onQotdTrigger={triggerQotd} />

        {/* ── Overview / Calendar view (always shown on desktop; shown on 'overview' tab on mobile) */}
        <main
          className={mobileTab === 'overview' || mobileTab === 'analytics' ? '' : 'hidden sm:flex'}
          style={{ flex: 1, display: mobileTab === 'overview' || mobileTab === 'analytics' ? 'flex' : undefined, flexDirection: 'column' }}
        >
          {/* Mobile collapsible stats toggle */}
          <div className="sm:hidden flex items-center gap-2 py-2 px-1">
            <button
              onClick={toggleStats}
              className="flex items-center gap-2 transition-opacity hover:opacity-70"
              aria-label={statsCollapsed ? 'Expand statistics' : 'Collapse statistics'}
            >
              <span
                style={{
                  display: 'inline-block',
                  fontSize: 11,
                  fontWeight: 700,
                  color: 'var(--xp-acc)',
                  transform: statsCollapsed ? 'rotate(0deg)' : 'rotate(90deg)',
                  transition: 'transform 220ms ease',
                  lineHeight: 1,
                }}
              >
                ▶
              </span>
              <span className="text-[11px] font-medium" style={{ color: 'var(--xp-txt3)' }}>
                Statistics
              </span>
            </button>
          </div>

          {/* Stats + Legend — collapsible on mobile, always visible on desktop */}
          <div
            className="xp-stats-collapse"
            style={{
              overflow: 'hidden',
              maxHeight: statsCollapsed ? 0 : 480,
              opacity: statsCollapsed ? 0 : 1,
              transition: 'max-height 260ms ease-in-out, opacity 200ms ease',
            }}
          >
            <StatsRow />
            <LegendRow />
          </div>

          {/* Calendar */}
          <CalendarSection
            onDayDoubleClick={(key, month, day) => setModalDay({ key, month, day })}
            onMonthZoom={month => setFullPageMonth(month)}
            activeMonth={fullPageMonth}
          />
        </main>

        {/* ── Tasks tab (mobile only) */}
        {mobileTab === 'tasks' && (
          <div className="flex flex-col flex-1 sm:hidden" style={{ minHeight: 0 }}>
            <MobileTasksView onOpenDay={openDayModal} />
          </div>
        )}

        {/* ── AI Coach tab (mobile only) */}
        {mobileTab === 'ai-coach' && (
          <div className="flex flex-col flex-1 sm:hidden">
            <MobileAICoachView />
          </div>
        )}

        {/* ── More tab (mobile only) */}
        {mobileTab === 'more' && (
          <div className="flex flex-col flex-1 sm:hidden">
            <MobileMoreView
              onGallery={() => setGalleryOpen(true)}
              onSettings={() => setSettingsOpen(true)}
            />
          </div>
        )}
      </div>

      {/* ── Bottom nav (mobile only) */}
      <MobileBottomNav
        activeTab={mobileTab}
        onTabChange={tab => {
          setMobileTab(tab)
          // Analytics tab immediately opens the yearly modal
          if (tab === 'analytics') setYearlyOpen(true)
        }}
      />

      {/* ── Overlays / Modals ─────────────────────────────────────────────── */}

      {fullPageMonth !== null && (
        <MonthFullPage
          month={fullPageMonth}
          onClose={() => setFullPageMonth(null)}
          onMonthDashboard={month => setZoomedMonth(month)}
          onDayDoubleClick={(key, month, day) => setModalDay({ key, month, day })}
        />
      )}

      {modalDay && (
        <DayModal
          dateKey={modalDay.key}
          month={modalDay.month}
          day={modalDay.day}
          onClose={() => setModalDay(null)}
          onDashboard={() => { setDashboardDay(modalDay); setModalDay(null) }}
        />
      )}

      {dashboardDay && (
        <DayDashboardModal
          dateKey={dashboardDay.key}
          month={dashboardDay.month}
          day={dashboardDay.day}
          onClose={() => setDashboardDay(null)}
          onBack={() => { setModalDay(dashboardDay); setDashboardDay(null) }}
        />
      )}

      {zoomedMonth !== null && (
        <MonthZoomModal
          month={zoomedMonth}
          onClose={() => setZoomedMonth(null)}
          onDayDoubleClick={(key, month, day) => { setZoomedMonth(null); setModalDay({ key, month, day }) }}
        />
      )}

      {yearlyOpen && <YearlyDashboardModal onClose={handleYearlyClose} />}

      {motivationOpen && <MotivationModal onClose={() => setMotivationOpen(false)} />}

      {galleryOpen && <GalleryModal onClose={() => setGalleryOpen(false)} />}

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}

      {profileOpen && <ProfileModal onClose={() => setProfileOpen(false)} />}

      {activityManagerOpen && <ActivityManagerModal onClose={() => setActivityManagerOpen(false)} />}

      {/* Toast — above bottom nav on mobile */}
      {toast && (
        <div className="xp-toast-wrapper" style={{ position: 'fixed', right: 16, zIndex: 200 }}>
          <Toast
            message={toast}
            exiting={toastExiting}
            onDismiss={() => { setToastExiting(true); setTimeout(() => setToast(null), 300) }}
          />
        </div>
      )}
    </div>
  )
}

// ─── Public export ────────────────────────────────────────────────────────────

export function XpaditeApp({ email }: XpaditeAppProps) {
  return (
    <AppProvider email={email}>
      <ThemedApp email={email} />
    </AppProvider>
  )
}

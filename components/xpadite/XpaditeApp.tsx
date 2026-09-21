'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { useApp, AppProvider } from './AppContext'
import { AppHeader } from './AppHeader'
import { AppSidebar } from './AppSidebar'
import { ActivityButtons } from './ActivityBar'
import { StatsRow } from './StatsRow'
import { LegendRow } from './LegendRow'
import { CalendarSection } from './CalendarSection'
import { DayModal } from './DayModal'
import { MonthZoomModal } from './MonthZoomModal'
import { MonthFullPage } from './MonthFullPage'
import { DayDashboardModal } from './DayDashboardModal'
import { AnalyticsPage } from './AnalyticsPage'
import { AICoachPage } from './AICoachPage'
import { JournalWorkspaceModal } from './JournalWorkspaceModal'
import { NotificationsModal } from './NotificationsModal'
import { GalleryModal } from './GalleryModal'
import { SettingsModal } from './SettingsModal'
import { MobileBottomNav } from './MobileBottomNav'
import { ProfileModal } from './ProfileModal'
import { ActivityManagerModal } from './ActivityManagerModal'
import { dateKey, todayKey, APP_YEAR } from './utils'
import { YearShareModal } from './YearProgressShare'
import type { MobileTab } from './MobileBottomNav'
import type { XpaditeNotification } from './NotificationsModal'
import { loadStoredNotifications, saveStoredNotifications } from './NotificationsModal'
import type { DayData, WorkSession } from './types'

interface XpaditeAppProps {
  email: string
}

// ─── QOTD data ────────────────────────────────────────────────────────────────

const QOTD_LIST = [
  { quote: "Success is the sum of small efforts, repeated day in and day out.", author: "Robert Collier" },
  { quote: "The secret of getting ahead is getting started.", author: "Mark Twain" },
  { quote: "Well done is better than well said.", author: "Benjamin Franklin" },
  { quote: "Great things are done by a series of small things brought together.", author: "Vincent van Gogh" },
  { quote: "It always seems impossible until it's done.", author: "Nelson Mandela" },
  { quote: "The future depends on what you do today.", author: "Mahatma Gandhi" },
  { quote: "You miss 100% of the shots you don't take.", author: "Wayne Gretzky" },
  { quote: "Action is the foundational key to all success.", author: "Pablo Picasso" },
  { quote: "If opportunity doesn't knock, build a door.", author: "Milton Berle" },
  { quote: "The way to get started is to quit talking and begin doing.", author: "Walt Disney" },
  { quote: "A year from now you may wish you had started today.", author: "Karen Lamb" },
  { quote: "Don't watch the clock; do what it does. Keep going.", author: "Sam Levenson" },
  { quote: "Start where you are. Use what you have. Do what you can.", author: "Arthur Ashe" },
  { quote: "Nothing will work unless you do.", author: "Maya Angelou" },
  { quote: "You don't have to see the whole staircase, just take the first step.", author: "Martin Luther King Jr." },
  { quote: "Energy and persistence conquer all things.", author: "Benjamin Franklin" },
  { quote: "The only way to do great work is to love what you do.", author: "Steve Jobs" },
  { quote: "Quality is not an act, it is a habit.", author: "Aristotle" },
  { quote: "The successful warrior is the average man, with laser-like focus.", author: "Bruce Lee" },
  { quote: "Concentrate all your thoughts upon the work in hand.", author: "Alexander Graham Bell" },
  { quote: "Lost time is never found again.", author: "Benjamin Franklin" },
  { quote: "The bad news is time flies. The good news is you're the pilot.", author: "Michael Altshuler" },
  { quote: "Either you run the day or the day runs you.", author: "Jim Rohn" },
  { quote: "Success usually comes to those who are too busy to be looking for it.", author: "Henry David Thoreau" },
  { quote: "Do what you can, with what you have, where you are.", author: "Theodore Roosevelt" },
  { quote: "You may delay, but time will not.", author: "Benjamin Franklin" },
  { quote: "What you do today can improve all your tomorrows.", author: "Ralph Marston" },
  { quote: "Setting goals is the first step in turning the invisible into the visible.", author: "Tony Robbins" },
  { quote: "A goal properly set is halfway reached.", author: "Zig Ziglar" },
  { quote: "Dream big. Start small. Act now.", author: "Robin Sharma" },
  { quote: "Success is walking from failure to failure with no loss of enthusiasm.", author: "Winston Churchill" },
  { quote: "Our greatest glory is not in never falling, but in rising every time we fall.", author: "Confucius" },
  { quote: "Fall seven times and stand up eight.", author: "Japanese proverb" },
  { quote: "Difficulties strengthen the mind, as labor does the body.", author: "Seneca" },
  { quote: "He who has a why to live can bear almost any how.", author: "Friedrich Nietzsche" },
  { quote: "Do not pray for an easy life; pray for the strength to endure a difficult one.", author: "Bruce Lee" },
  { quote: "Persistence guarantees that results are inevitable.", author: "Paramahansa Yogananda" },
  { quote: "The harder the conflict, the greater the triumph.", author: "George Washington" },
  { quote: "Success is not final, failure is not fatal: it is the courage to continue that counts.", author: "Winston Churchill" },
  { quote: "Turn your wounds into wisdom.", author: "Oprah Winfrey" },
  { quote: "Ideas are easy. Execution is everything.", author: "John Doerr" },
  { quote: "If you really look closely, most overnight successes took a long time.", author: "Steve Jobs" },
  { quote: "Move fast and break things.", author: "Mark Zuckerberg" },
  { quote: "Don't worry about failure; you only have to be right once.", author: "Drew Houston" },
  { quote: "Make every detail perfect and limit the number of details to perfect.", author: "Jack Dorsey" },
  { quote: "We are what we repeatedly do. Excellence, then, is not an act, but a habit.", author: "Will Durant" },
  { quote: "Chase the vision, not the money; the money will end up following you.", author: "Tony Hsieh" },
  { quote: "Stay hungry. Stay foolish.", author: "Steve Jobs" },
  { quote: "Risk more than others think is safe. Dream more than others think is practical.", author: "Howard Schultz" },
  { quote: "Success doesn't come from what you do occasionally. It comes from what you do consistently.", author: "Marie Forleo" },
  { quote: "A plan becomes powerful the moment you act on it.", author: "XPadite" },
  { quote: "Protect your focus. Your future is being built inside it.", author: "XPadite" },
  { quote: "You don't need a perfect day. You need a productive next hour.", author: "XPadite" },
  { quote: "Small progress still moves the finish line closer.", author: "XPadite" },
  { quote: "Your calendar shows your intentions. Your actions reveal your priorities.", author: "XPadite" },
  { quote: "Stop waiting for momentum. Create it.", author: "XPadite" },
  { quote: "Track the work. Learn from it. Improve tomorrow.", author: "XPadite" },
  { quote: "Big goals are completed one focused session at a time.", author: "XPadite" },
  { quote: "Make today count toward something bigger.", author: "XPadite" },
  { quote: "Plan it. Start it. Finish it. XPadite it.", author: "XPadite" },
  // Unique existing XPadite quotes retained from prior collection
  { quote: "Small steps every day compound into extraordinary results.", author: "XPadite" },
  { quote: "Focus on being productive instead of busy.", author: "Anonymous" },
  { quote: "Excellence is not an act, but a habit.", author: "Aristotle" },
  { quote: "You don't have to be great to start, but you have to start to be great.", author: "Zig Ziglar" },
  { quote: "Consistency is the foundation of achievement.", author: "XPadite" },
  { quote: "The discipline you maintain today builds the life you want tomorrow.", author: "XPadite" },
  { quote: "Push yourself, because no one else is going to do it for you.", author: "Anonymous" },
  { quote: "Great things never come from comfort zones.", author: "Anonymous" },
  { quote: "Your limitation is only your imagination.", author: "Anonymous" },
  { quote: "One productive day at a time — that's how it's built.", author: "XPadite" },
  { quote: "Dream it. Wish it. Do it.", author: "Anonymous" },
]

// Deterministic per local calendar day → same quote all day, advances at local midnight
function getQotdForDate(date: Date) {
  const key = date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate()
  return QOTD_LIST[key % QOTD_LIST.length]
}

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
        background: isInfo ? 'rgba(124,58,237,0.86)' : 'rgba(109,40,217,0.85)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        border: '0.5px solid rgba(167,139,250,0.32)',
        boxShadow: '3px 8px 14px rgba(109,40,217,0.28), 5px 14px 30px rgba(109,40,217,0.14), 2px 6px 48px rgba(88,28,135,0.07)',
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

// ─── Missing-Time Reminder helpers ───────────────────────────────────────────

function computeTotalFocusMs(dayData: DayData, daySessions: WorkSession[]): number {
  let ms = 0
  for (const task of dayData.tasks ?? []) {
    for (const s of task.sessions ?? []) {
      if (s.endTs != null) ms += s.endTs - s.startTs
    }
  }
  for (const s of daySessions) {
    if (s.endTs != null) ms += s.endTs - s.startTs
  }
  return ms
}

function mtrId(key: string): string {
  return `mtr-${key}`
}

// ─── Missing-Time Reminder checker ───────────────────────────────────────────

function MissingTimeChecker() {
  const { calData, sessions } = useApp()

  const calDataRef = useRef(calData)
  calDataRef.current = calData
  const sessionsRef = useRef(sessions)
  sessionsRef.current = sessions

  // Auto-resolve when focus time is added while the app is open
  useEffect(() => {
    const key = todayKey()
    const dayData = calData[key]
    if (!dayData) return
    const focusMs = computeTotalFocusMs(dayData, sessions.filter(s => s.dateKey === key))
    if (focusMs <= 0) return
    const id = mtrId(key)
    const stored = loadStoredNotifications()
    const existing = stored.find(n => n.id === id)
    if (!existing) return
    if (existing.lifecycle === 'dismissed' || existing.lifecycle === 'resolved') return
    saveStoredNotifications(
      stored.map(n => n.id === id ? { ...n, lifecycle: 'resolved' as const, read: true } : n),
    )
  }, [calData, sessions])

  // Scheduled checker: 8 PM trigger + 10 AM snooze follow-up
  useEffect(() => {
    function check() {
      const now = new Date()
      const hour = now.getHours()
      const is8PM  = hour === 20
      const is10AM = hour === 10
      if (!is8PM && !is10AM) return

      const key = dateKey(now.getFullYear(), now.getMonth(), now.getDate())
      const dayData = calDataRef.current[key]
      const hasStatus = !!(dayData && (dayData.productive || dayData.hyper || dayData.milestone || dayData.goal))

      const id = mtrId(key)
      const stored = loadStoredNotifications()
      const existing = stored.find(n => n.id === id)

      // Auto-resolve if qualifying status was removed
      if (!hasStatus) {
        if (existing && existing.lifecycle !== 'dismissed' && existing.lifecycle !== 'resolved') {
          saveStoredNotifications(
            stored.map(n => n.id === id ? { ...n, lifecycle: 'resolved' as const, read: true } : n),
          )
        }
        return
      }

      const focusMs = computeTotalFocusMs(
        dayData,
        sessionsRef.current.filter(s => s.dateKey === key),
      )

      // Auto-resolve if time was recorded
      if (focusMs > 0) {
        if (existing && existing.lifecycle !== 'dismissed' && existing.lifecycle !== 'resolved') {
          saveStoredNotifications(
            stored.map(n => n.id === id ? { ...n, lifecycle: 'resolved' as const, read: true } : n),
          )
        }
        return
      }

      // Handle existing notification
      if (existing) {
        if (existing.lifecycle === 'dismissed' || existing.lifecycle === 'resolved') return
        if (existing.lifecycle === 'snoozed') {
          // Re-activate only at 10 AM on the follow-up day
          if (!is10AM) return
          if (existing.snoozeUntil && now.getTime() < existing.snoozeUntil) return
          saveStoredNotifications(
            stored.map(n => n.id === id ? {
              ...n,
              lifecycle: 'active' as const,
              read: false,
              timestamp: Date.now(),
              // Final follow-up: no snooze action
              actions: [
                { label: '+ Add Time', actionType: 'add-time', payload: { dateKey: key } },
                { label: 'Dismiss', actionType: 'dismiss', payload: {} },
              ],
            } : n),
          )
          return
        }
        // Already active — no duplicate
        return
      }

      // Create new notification only at 8 PM
      if (!is8PM) return

      const statusLabel =
        dayData.hyper      ? 'Hyper-Productive' :
        dayData.milestone  ? 'Milestone'         :
        dayData.goal       ? 'Goal Day'          :
                             'Productive'

      const newNotif: XpaditeNotification = {
        id,
        title: 'No Focus Time Recorded',
        message: `You marked today as ${statusLabel} but haven't logged any focus time. Add time to keep your progress accurate.`,
        timestamp: Date.now(),
        read: false,
        category: 'missed-task',
        tags: ['Today'],
        actions: [
          { label: '+ Add Time',      actionType: 'add-time',        payload: { dateKey: key } },
          { label: 'Remind Tomorrow', actionType: 'snooze-tomorrow', payload: { dateKey: key } },
          { label: 'Dismiss',         actionType: 'dismiss',         payload: {} },
        ],
        lifecycle: 'active',
        snoozeUntil: null,
        snoozeCount: 0,
        targetDateKey: key,
      }
      saveStoredNotifications([...stored, newNotif])
    }

    check()
    const id = setInterval(check, 60_000)
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

interface ModalDay { key: string; month: number; day: number; skipAnim?: boolean }

function ThemedApp(_props: XpaditeAppProps) {
  const { isDark, toast, setToast, legendVisible } = useApp()

  const [toastExiting, setToastExiting]             = useState(false)
  const [modalDay, setModalDay]                     = useState<ModalDay | null>(null)
  const [dashboardDay, setDashboardDay]             = useState<ModalDay | null>(null)
  const [zoomedMonth, setZoomedMonth]               = useState<number | null>(null)
  const [fullPageMonth, setFullPageMonth]           = useState<number | null>(null)
  const [motivationOpen, setMotivationOpen]             = useState(false)
  const [analyticsOpen, setAnalyticsOpen]               = useState(false)
  const [aiCoachOpen, setAICoachOpen]                   = useState(false)
  const [aiCoachMotivate, setAICoachMotivate]           = useState(false)
  const [galleryOpen, setGalleryOpen]                   = useState(false)
  const [yearShareOpen, setYearShareOpen]               = useState(false)
  const [settingsOpen, setSettingsOpen]                 = useState(false)
  const [profileOpen, setProfileOpen]                   = useState(false)
  const [activityManagerOpen, setActivityManagerOpen]   = useState(false)
  const [journalNotesOpen, setJournalNotesOpen]         = useState(false)
  const [notificationsOpen, setNotificationsOpen]       = useState(false)

  // ── Mobile tab ────────────────────────────────────────────────────────────────
  const [mobileTab, setMobileTab] = useState<MobileTab>('calendar')

  // ── Mobile nav guard (unsaved changes protection) ─────────────────────────────
  const modalDirtyRef                = useRef(false)
  const plannerDirtyRef              = useRef(false)
  const [navGuardOpen, setNavGuardOpen]         = useState(false)
  const [navGuardSource, setNavGuardSource]     = useState<'tasks' | 'planner'>('tasks')
  const pendingNavRef                = useRef<(() => void) | null>(null)
  const [dayModalCloseIntent, setDayModalCloseIntent]     = useState<'save' | 'discard' | null>(null)
  const [plannerCloseIntent, setPlannerCloseIntent]       = useState<'save' | 'discard' | null>(null)

  function executeNav(tab: MobileTab) {
    setDashboardDay(null)
    if (tab === 'calendar') {
      setFullPageMonth(null)
      setMobileTab('calendar')
    } else if (tab === 'tasks') {
      // Close any tab overlay (planner, analytics, ai-coach) in the same batch as opening DayModal
      // React 18 batches these so no intermediate render with transparent DayModal backdrop
      setMobileTab('calendar')
      const today = new Date()
      setModalDay({ key: dateKey(today.getFullYear(), today.getMonth(), today.getDate()), month: today.getMonth(), day: today.getDate(), skipAnim: true })
    } else {
      setMobileTab(tab)
    }
  }

  function handleMobileNav(tab: MobileTab) {
    if (modalDay && modalDirtyRef.current) {
      pendingNavRef.current = () => executeNav(tab)
      setNavGuardSource('tasks')
      setNavGuardOpen(true)
      return
    }
    if (mobileTab === 'planner' && plannerDirtyRef.current) {
      pendingNavRef.current = () => executeNav(tab)
      setNavGuardSource('planner')
      setNavGuardOpen(true)
      return
    }
    if (modalDay) setModalDay(null)
    executeNav(tab)
  }

  function navGuardSave() {
    setNavGuardOpen(false)
    if (navGuardSource === 'planner') {
      setPlannerCloseIntent('save')
    } else {
      setDayModalCloseIntent('save')
    }
  }

  function navGuardDiscard() {
    setNavGuardOpen(false)
    if (navGuardSource === 'planner') {
      setPlannerCloseIntent('discard')
    } else {
      setDayModalCloseIntent('discard')
    }
  }

  function navGuardCancel() {
    setNavGuardOpen(false)
    pendingNavRef.current = null
  }

  function handleAnalyticsClose() {
    setAnalyticsOpen(false)
    if (mobileTab === 'analytics') setMobileTab('calendar')
  }

  function handleAICoachClose() {
    setAICoachOpen(false)
    setAICoachMotivate(false)
    if (mobileTab === 'ai-coach') setMobileTab('calendar')
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
  const [qotdToday, setQotdToday] = useState(() => getQotdForDate(new Date()))
  const [qotdIn, setQotdIn] = useState(false)
  // Drives the translateY slide-up on the inner content; opacity is never animated
  const [qotdExiting, setQotdExiting] = useState(false)
  const qotdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const qotdExitRef  = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Advance quote at local midnight without requiring a page refresh
  useEffect(() => {
    let id: ReturnType<typeof setTimeout>
    function scheduleNext() {
      const now = new Date()
      const msUntilMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime()
      id = setTimeout(() => {
        setQotdToday(getQotdForDate(new Date()))
        scheduleNext()
      }, msUntilMidnight)
    }
    scheduleNext()
    return () => clearTimeout(id)
  }, [])

  // Mobile pan-once scroll state
  const qotdInnerRef     = useRef<HTMLDivElement>(null)
  const qotdTrackRef     = useRef<HTMLDivElement>(null)
  const qotdScrollTimer  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [qotdTranslate,  setQotdTranslate]  = useState(0)
  const [qotdTransDur,   setQotdTransDur]   = useState(0)
  const [qotdTransActive,setQotdTransActive]= useState(false)

  useEffect(() => () => {
    if (qotdTimerRef.current)    clearTimeout(qotdTimerRef.current)
    if (qotdExitRef.current)     clearTimeout(qotdExitRef.current)
    if (qotdScrollTimer.current) clearTimeout(qotdScrollTimer.current)
  }, [])

  // Reset scroll + exit state when banner hides; start mobile pan when it shows
  useEffect(() => {
    if (!qotdIn) {
      if (qotdScrollTimer.current) { clearTimeout(qotdScrollTimer.current); qotdScrollTimer.current = null }
      setQotdTranslate(0)
      setQotdTransDur(0)
      setQotdTransActive(false)
      // Reset slide-up after the outer height collapses (200 ms transition)
      const rid = setTimeout(() => setQotdExiting(false), 250)
      return () => clearTimeout(rid)
    }
    // Wait for 300 ms slide-in + 500 ms reading pause before measuring
    qotdScrollTimer.current = setTimeout(() => {
      if (window.innerWidth > 768) return  // desktop: unchanged
      const inner = qotdInnerRef.current
      const track = qotdTrackRef.current
      if (!inner || !track) return
      // inner padding is 9px 24px → 48 px total horizontal; subtract to get true content-area overflow
      const overflow = Math.max(0, track.offsetWidth - (inner.clientWidth - 48))
      if (overflow <= 4) return  // fits — nothing to do
      const scrollMs = Math.max(2000, (overflow / 55) * 1000)
      setQotdTransDur(scrollMs)
      setQotdTranslate(-overflow)
      setQotdTransActive(true)
      // Reschedule dismiss: after scroll completes + 1.5 s end pause
      if (qotdTimerRef.current) { clearTimeout(qotdTimerRef.current); qotdTimerRef.current = null }
      qotdTimerRef.current = setTimeout(() => { dismissQotd() }, scrollMs + 1500) // eslint-disable-line
    }, 800)
    return () => { if (qotdScrollTimer.current) { clearTimeout(qotdScrollTimer.current); qotdScrollTimer.current = null } }
  }, [qotdIn]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!qotdIn) return
    function onDocClick() { dismissQotd() } // eslint-disable-line
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [qotdIn]) // eslint-disable-line react-hooks/exhaustive-deps

  // Phase 1: translateY(-100%) slides inner up (280 ms, opacity stays 1).
  // Phase 2: 290 ms later, qotdIn→false collapses the outer height (200 ms).
  // The outer's purple background fills any gap during the slide — no white flash.
  function dismissQotd() {
    if (qotdTimerRef.current) { clearTimeout(qotdTimerRef.current); qotdTimerRef.current = null }
    if (qotdExitRef.current)  { clearTimeout(qotdExitRef.current);  qotdExitRef.current = null }
    setQotdExiting(true)
    qotdExitRef.current = setTimeout(() => { setQotdIn(false); qotdExitRef.current = null }, 470)
  }

  function triggerQotd() {
    if (qotdTimerRef.current) { clearTimeout(qotdTimerRef.current); qotdTimerRef.current = null }
    if (qotdExitRef.current)  { clearTimeout(qotdExitRef.current);  qotdExitRef.current = null }
    setQotdExiting(false)  // snap inner to position 0 before outer expands
    setQotdIn(true)
    qotdTimerRef.current = setTimeout(() => { dismissQotd() }, 7000) // eslint-disable-line
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
    if (mobileTab === 'tasks') setMobileTab('calendar')
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
      <MissingTimeChecker />
      <AppSidebar
        onGallery={() => setGalleryOpen(true)}
        onSettings={() => setSettingsOpen(true)}
        onAnalytics={() => setAnalyticsOpen(true)}
        onMotivate={() => { setAICoachMotivate(true); setAICoachOpen(true) }}
        onQotd={triggerQotd}
        onProfile={() => setProfileOpen(true)}
        onActivities={() => setActivityManagerOpen(true)}
        onAICoach={() => setAICoachOpen(true)}
        onTasks={() => handleMobileNav('tasks')}
        onJournalNotes={() => {
          // On mobile: switch to the polished Planner tab (same as bottom-nav Planner)
          // On desktop/tablet: open the JournalNotesModal overlay
          if (typeof window !== 'undefined' && window.innerWidth < 640) {
            handleMobileNav('planner')
          } else {
            setJournalNotesOpen(true)
          }
        }}
        onNotifications={() => setNotificationsOpen(true)}
      />

      {/* QOTD banner */}
      {/* Seat: controls layout height. overflow:hidden during open (clips bar in), visible during exit (lets bar slide freely with no top-edge clip) */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'relative',
          overflow: qotdExiting ? 'visible' : 'hidden',
          maxHeight: (qotdIn && !qotdExiting) ? '44px' : '0px',
          transition: (qotdIn && !qotdExiting) ? 'max-height 300ms ease' : 'max-height 450ms cubic-bezier(0.4, 0, 0.2, 1)',
          background: 'linear-gradient(90deg, #4c1d95 0%, #5b21b6 50%, #4c1d95 100%)',
          flexShrink: 0,
        }}
      >
        {/* Visual unit: position:absolute so it is never clipped by the seat during exit. translateY moves the ENTIRE bar + label + quote + author as one rigid piece. */}
        <div
          style={{
            position: 'absolute',
            top: 0, left: 0, right: 0, height: '44px', zIndex: 21,
            background: 'linear-gradient(90deg, #4c1d95 0%, #5b21b6 50%, #4c1d95 100%)',
            transform: qotdExiting ? 'translateY(-100%)' : 'translateY(0)',
            transition: 'transform 450ms cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        >
          {/* Scroll viewport: clips translateX overflow only */}
          <div
            ref={qotdInnerRef}
            style={{
              padding: '9px 24px',
              textAlign: 'center',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
            }}
          >
            {/* Track: translateX only for mobile long-quote scroll */}
            <div
              ref={qotdTrackRef}
              style={{
                display: 'inline-block',
                whiteSpace: 'nowrap',
                transform: `translateX(${qotdTranslate}px)`,
                transition: qotdTransActive ? `transform ${qotdTransDur}ms ease-in-out` : 'none',
                willChange: qotdTransActive ? 'transform' : 'auto',
              }}
            >
              <span style={{ fontSize: 10, color: 'rgba(216,180,254,0.7)', fontWeight: 600, letterSpacing: '0.08em', marginRight: 8 }}>
                QUOTE OF THE DAY
              </span>
              <span style={{ fontSize: 11.5, color: 'white', fontStyle: 'italic', fontWeight: 400 }}>
                &ldquo;{qotdToday.quote}&rdquo;
              </span>
              <span style={{ fontSize: 10, color: 'rgba(216,180,254,0.55)', marginLeft: 8 }}>
                — {qotdToday.author}
              </span>
            </div>
          </div>
        </div>
        {/* Spacer: gives the seat its 44px height so the absolute visual unit is contained during display */}
        <div style={{ height: '44px' }} />
      </div>

      {/* Header */}
      <AppHeader
        onAnalytics={() => setAnalyticsOpen(true)}
        onAICoach={() => setAICoachOpen(true)}
      />

      {/* +/-/edit buttons — centered strip just below navbar — desktop only */}
      <div className="hidden sm:block">
        <ActivityButtons />
      </div>

      {/* ── MAIN CONTENT ─────────────────────────────────────────────────── */}
      <div
        className="xp-main-content px-2 sm:px-4"
        style={{ maxWidth: 1360, width: '100%', margin: '0 auto', flex: 1, display: 'flex', flexDirection: 'column' }}
      >
        {/* ── Overview / Calendar view (always shown on desktop; shown on 'overview' tab on mobile) */}
        <main
          className={mobileTab === 'calendar' ? '' : 'hidden sm:flex'}
          style={{ flex: 1, display: mobileTab === 'calendar' ? 'flex' : undefined, flexDirection: 'column' }}
        >
          {/* Stats + Legend — chevron button controls on all screen sizes */}
          <div
            style={{
              overflow: legendVisible ? 'visible' : 'hidden',
              maxHeight: legendVisible ? 480 : 0,
              opacity: legendVisible ? 1 : 0,
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
            onShareYear={() => setYearShareOpen(true)}
          />
        </main>

        {/* ── Tasks tab (mobile only) */}
        {mobileTab === 'tasks' && (
          <div className="flex flex-col flex-1 sm:hidden" style={{ minHeight: 0 }}>
            <MobileTasksView onOpenDay={openDayModal} />
          </div>
        )}

        {/* ── Mobile Analytics tab — inline, nav persistent */}
        {mobileTab === 'analytics' && (
          <div
            className="sm:hidden"
            style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 56, zIndex: 49, transform: 'translateZ(0)', overflow: 'hidden' }}
          >
            <AnalyticsPage onClose={() => setMobileTab('calendar')} />
          </div>
        )}

        {/* ── Mobile Planner tab — inline, nav persistent */}
        {mobileTab === 'planner' && (
          <div className="sm:hidden">
            <JournalWorkspaceModal
              onClose={() => {
                setMobileTab('calendar')
                setPlannerCloseIntent(null)
                const pending = pendingNavRef.current
                if (pending) {
                  pendingNavRef.current = null
                  pending()
                }
              }}
              mobileNavSpace
              onDirtyChange={dirty => { plannerDirtyRef.current = dirty }}
              closeIntent={plannerCloseIntent}
            />
          </div>
        )}

        {/* ── Mobile AI Coach tab — inline, nav persistent */}
        {mobileTab === 'ai-coach' && (
          <div
            className="sm:hidden"
            style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 56, zIndex: 49, transform: 'translateZ(0)', overflow: 'hidden' }}
          >
            <AICoachPage onClose={() => setMobileTab('calendar')} startWithMotivate={false} showBackButton={false} />
          </div>
        )}
      </div>

      {/* ── Bottom nav (mobile only) */}
      <MobileBottomNav
        activeTab={mobileTab}
        onTabChange={handleMobileNav}
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
          skipEntryAnimation={modalDay.skipAnim}
          onClose={() => {
            setModalDay(null)
            setDayModalCloseIntent(null)
            const pending = pendingNavRef.current
            if (pending) {
              pendingNavRef.current = null
              pending()
            }
          }}
          onDashboard={() => {
            if (modalDirtyRef.current) {
              const day = modalDay
              pendingNavRef.current = () => setDashboardDay(day)
              setNavGuardSource('tasks')
              setNavGuardOpen(true)
            } else {
              setDashboardDay(modalDay)
            }
          }}
          onDirtyChange={(dirty) => { modalDirtyRef.current = dirty }}
          closeIntent={dayModalCloseIntent}
        />
      )}

      {dashboardDay && (
        <DayDashboardModal
          dateKey={dashboardDay.key}
          month={dashboardDay.month}
          day={dashboardDay.day}
          onClose={() => setDashboardDay(null)}
          onBack={() => setDashboardDay(null)}
        />
      )}

      {zoomedMonth !== null && (
        <MonthZoomModal
          month={zoomedMonth}
          onClose={() => setZoomedMonth(null)}
          onDayDoubleClick={(key, month, day) => { setZoomedMonth(null); setModalDay({ key, month, day }) }}
        />
      )}

      {analyticsOpen && <AnalyticsPage onClose={handleAnalyticsClose} />}

      {aiCoachOpen && <AICoachPage onClose={handleAICoachClose} startWithMotivate={aiCoachMotivate} />}

      {motivationOpen && <MotivationModal onClose={() => setMotivationOpen(false)} />}

      {galleryOpen && <GalleryModal onClose={() => setGalleryOpen(false)} />}

      {yearShareOpen && <YearShareModal year={APP_YEAR} onClose={() => setYearShareOpen(false)} />}

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}

      {profileOpen && <ProfileModal onClose={() => setProfileOpen(false)} />}

      {activityManagerOpen && <ActivityManagerModal onClose={() => setActivityManagerOpen(false)} />}

      {journalNotesOpen && <JournalWorkspaceModal onClose={() => setJournalNotesOpen(false)} />}

      {notificationsOpen && (
        <NotificationsModal
          onClose={() => setNotificationsOpen(false)}
          onAction={(actionType, notif) => {
            if (actionType === 'add-time') {
              const dKey = notif.targetDateKey ?? todayKey()
              const parts = dKey.split('-')
              const month = parseInt(parts[1], 10) - 1  // 0-indexed
              const day   = parseInt(parts[2], 10)
              setModalDay({ key: dKey, month, day })
              setNotificationsOpen(false)
            }
          }}
        />
      )}

      {/* Mobile nav guard dialog — unsaved changes protection */}
      {navGuardOpen && (
        <div
          className="sm:hidden"
          style={{ position: 'fixed', inset: 0, zIndex: 70, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', background: 'rgba(0,0,0,0.60)' }}
        >
          <div
            style={{
              width: '100%',
              margin: '0 12px 72px',
              borderRadius: 16,
              overflow: 'hidden',
              background: isDark ? '#1a1025' : '#ffffff',
              border: isDark ? '0.5px solid rgba(124,58,237,0.22)' : '0.5px solid rgba(0,0,0,0.10)',
              boxShadow: '0 20px 50px rgba(0,0,0,0.45)',
            }}
          >
            <div style={{ padding: '20px 20px 12px', textAlign: 'center' }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--xp-txt)', margin: 0 }}>Unsaved Changes</p>
              <p style={{ fontSize: 11, color: 'var(--xp-txt3)', marginTop: 6, marginBottom: 0 }}>
                You have unsaved changes in your {navGuardSource === 'planner' ? 'Planner' : 'Task Manager'}.
              </p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 16px 20px' }}>
              <button onClick={navGuardSave} style={{ width: '100%', padding: '10px 16px', borderRadius: 10, background: '#7c3aed', color: '#ffffff', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                Save &amp; Continue
              </button>
              <button onClick={navGuardDiscard} style={{ width: '100%', padding: '10px 16px', borderRadius: 10, background: isDark ? 'rgba(239,68,68,0.10)' : 'rgba(239,68,68,0.06)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.22)', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>
                Exit Without Saving
              </button>
              <button onClick={navGuardCancel} style={{ width: '100%', padding: '10px 16px', borderRadius: 10, background: 'transparent', color: 'var(--xp-txt2)', border: '1px solid var(--xp-bdr2)', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

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

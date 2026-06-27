'use client'

import { useState, useEffect, useMemo } from 'react'
import { useApp, AppProvider } from './AppContext'
import { getDayOfYear } from './utils'
import { AppHeader } from './AppHeader'
import { AppSidebar } from './AppSidebar'
import { ActivityBar } from './ActivityBar'
import { StatsRow } from './StatsRow'
import { LegendRow } from './LegendRow'
import { CalendarSection } from './CalendarSection'
import { DayModal } from './DayModal'
import { MonthZoomModal } from './MonthZoomModal'

interface XpaditeAppProps {
  email: string
}

// ─── Quote of the Day ─────────────────────────────────────────────────────────

const DAILY_QUOTES = [
  "The secret of getting ahead is getting started.",
  "Small steps every day compound into extraordinary results.",
  "It always seems impossible until it's done.",
  "Don't watch the clock; do what it does. Keep going.",
  "The future depends on what you do today.",
  "Success is not final, failure is not fatal — it's the courage to continue that counts.",
  "You don't have to be great to start, but you have to start to be great.",
  "Focus on being productive instead of busy.",
  "Excellence is not an act, but a habit.",
  "The only way to do great work is to love what you do.",
  "Your limitation is only your imagination.",
  "Push yourself, because no one else is going to do it for you.",
  "Great things never come from comfort zones.",
  "Dream it. Wish it. Do it.",
  "Consistency is the foundation of achievement.",
  "One productive day at a time — that's how it's built.",
  "The discipline you maintain today builds the life you want tomorrow.",
]

function QuoteBar() {
  const dayOfYear = useMemo(() => getDayOfYear(), [])
  const quote = DAILY_QUOTES[dayOfYear % DAILY_QUOTES.length]

  return (
    <div
      style={{
        background: 'linear-gradient(90deg, #4c1d95 0%, #5b21b6 50%, #4c1d95 100%)',
        padding: '8px 20px',
        textAlign: 'center',
      }}
    >
      <span style={{ fontSize: 11, color: 'rgba(216,180,254,0.7)', fontWeight: 500, letterSpacing: '0.06em', marginRight: 6 }}>
        QUOTE OF THE DAY
      </span>
      <span style={{ fontSize: 11.5, color: 'white', fontStyle: 'italic', fontWeight: 400 }}>
        &ldquo;{quote}&rdquo;
      </span>
    </div>
  )
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

function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div
      className="flex items-center gap-3 px-4 py-3 rounded-xl shadow-2xl text-sm max-w-xs"
      style={{
        background: '#1e1030',
        color: '#e8e8f0',
        border: '0.5px solid rgba(255,255,255,0.12)',
        animation: 'toast-in 0.25s ease-out',
      }}
    >
      <span className="flex-1 text-[13px] leading-snug">{message}</span>
      <button onClick={onDismiss} className="text-xs opacity-50 hover:opacity-100 transition-opacity flex-shrink-0">✕</button>
    </div>
  )
}

// ─── ThemedApp ────────────────────────────────────────────────────────────────

interface ModalDay { key: string; month: number; day: number }

function ThemedApp({ email: _email }: XpaditeAppProps) {
  const { isDark, toast, setToast } = useApp()
  const [modalDay, setModalDay] = useState<ModalDay | null>(null)
  const [zoomedMonth, setZoomedMonth] = useState<number | null>(null)
  const [motivationOpen, setMotivationOpen] = useState(false)

  // Auto-dismiss toast
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2800)
    return () => clearTimeout(t)
  }, [toast, setToast])

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
      <AppSidebar />

      {/* Daily quote bar */}
      <QuoteBar />

      {/* Header (two-row: logo + controls) */}
      <AppHeader
        onYearDash={() => {}}
        onMotivate={() => setMotivationOpen(true)}
      />

      {/* Centered content */}
      <div style={{ maxWidth: 1360, width: '100%', margin: '0 auto', padding: '0 16px', flex: 1, display: 'flex', flexDirection: 'column' }}>
        <ActivityBar />
        <main style={{ flex: 1 }}>
          <StatsRow />
          <LegendRow />
          <CalendarSection
            onDayDoubleClick={(key, month, day) => setModalDay({ key, month, day })}
            onMonthZoom={month => setZoomedMonth(month)}
            onMonthDashboard={month => setZoomedMonth(month)}
          />
        </main>
      </div>

      {/* DayModal */}
      {modalDay && (
        <DayModal
          dateKey={modalDay.key}
          month={modalDay.month}
          day={modalDay.day}
          onClose={() => setModalDay(null)}
        />
      )}

      {/* Month Zoom Modal */}
      {zoomedMonth !== null && (
        <MonthZoomModal
          month={zoomedMonth}
          onClose={() => setZoomedMonth(null)}
          onDayDoubleClick={(key, month, day) => { setZoomedMonth(null); setModalDay({ key, month, day }) }}
        />
      )}

      {/* Motivation modal */}
      {motivationOpen && <MotivationModal onClose={() => setMotivationOpen(false)} />}

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 200 }}>
          <Toast message={toast} onDismiss={() => setToast(null)} />
        </div>
      )}
    </div>
  )
}

// ─── Public export ────────────────────────────────────────────────────────────

export function XpaditeApp({ email }: XpaditeAppProps) {
  return (
    <AppProvider>
      <ThemedApp email={email} />
    </AppProvider>
  )
}

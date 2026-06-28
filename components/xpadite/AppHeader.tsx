'use client'

import { useEffect, useState } from 'react'
import { useApp } from './AppContext'
import { XpaditeLogo } from '@/components/auth/XpaditeLogo'
import { formatHMS, todayKey } from './utils'

const BurgerIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
    <line x1="3" y1="6" x2="21" y2="6" strokeLinecap="round" />
    <line x1="3" y1="12" x2="21" y2="12" strokeLinecap="round" />
    <line x1="3" y1="18" x2="21" y2="18" strokeLinecap="round" />
  </svg>
)

const PlayIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3">
    <polygon points="5 3 19 12 5 21 5 3" />
  </svg>
)

const StopIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3">
    <rect x="4" y="4" width="16" height="16" rx="2" />
  </svg>
)

const SunIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-3 h-3">
    <circle cx="12" cy="12" r="4" />
    <line x1="12" y1="2" x2="12" y2="5" strokeLinecap="round" />
    <line x1="12" y1="19" x2="12" y2="22" strokeLinecap="round" />
    <line x1="4.22" y1="4.22" x2="6.34" y2="6.34" strokeLinecap="round" />
    <line x1="17.66" y1="17.66" x2="19.78" y2="19.78" strokeLinecap="round" />
    <line x1="2" y1="12" x2="5" y2="12" strokeLinecap="round" />
    <line x1="19" y1="12" x2="22" y2="12" strokeLinecap="round" />
    <line x1="4.22" y1="19.78" x2="6.34" y2="17.66" strokeLinecap="round" />
    <line x1="17.66" y1="6.34" x2="19.78" y2="4.22" strokeLinecap="round" />
  </svg>
)

const MoonIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
)

interface AppHeaderProps {
  onYearDash: () => void
  onMotivate: () => void
}

export function AppHeader({ onYearDash, onMotivate }: AppHeaderProps) {
  const {
    isDark, setIsDark,
    activeSession, setActiveSession,
    activeTaskTimer, setActiveTaskTimer,
    addSession,
    activities, selectedActId,
    setSidebarOpen,
    updateDay,
  } = useApp()

  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  function clockIn() {
    if (activeSession) return
    const act = activities.find(a => a.id === selectedActId) ?? activities[0]
    if (!act) return
    setActiveSession({
      id: 's' + Date.now(),
      actId: act.id,
      actName: act.name,
      actColor: act.color,
      startTs: Date.now(),
      dateKey: todayKey(),
    })
  }

  function clockOut() {
    if (!activeSession) return
    addSession({ ...activeSession, endTs: Date.now() })
    setActiveSession(null)
    if (activeTaskTimer) {
      const endTs = Date.now()
      updateDay(activeTaskTimer.dateKey, prev => ({
        ...prev,
        tasks: prev.tasks.map(t => {
          if (t.id !== activeTaskTimer.taskId) return t
          const sessions = (t.sessions ?? []).map(s =>
            s.endTs === null ? { ...s, endTs } : s
          )
          return { ...t, timerEnd: endTs, sessions }
        }),
      }))
      setActiveTaskTimer(null)
    }
  }

  const elapsed = activeSession ? now - activeSession.startTs : 0
  const taskElapsed = activeTaskTimer ? now - activeTaskTimer.startTs : 0

  return (
    <header style={{ background: 'var(--xp-hdr)', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>
      {/* Row 1: Logo icon, centered, slightly larger */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '10px 16px 6px' }}>
        <XpaditeLogo variant="light" size={32} />
      </div>

      {/* Row 2: Controls (left) | Active Task (center) | Actions (right) */}
      <div
        style={{
          maxWidth: 1360,
          margin: '0 auto',
          padding: '0 16px 8px',
          display: 'grid',
          gridTemplateColumns: '1fr auto 1fr',
          alignItems: 'center',
          gap: 8,
        }}
      >
        {/* LEFT: session controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-1.5 rounded-md transition-colors hover:bg-white/10 flex-shrink-0"
            style={{ color: 'rgba(255,255,255,0.7)' }}
            aria-label="Open menu"
          >
            <BurgerIcon />
          </button>

          <div className="w-px h-4 flex-shrink-0" style={{ background: 'rgba(255,255,255,0.12)' }} />

          <span
            className="text-xs font-mono px-2 py-1 rounded-md flex-shrink-0"
            style={{
              background: activeSession ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.07)',
              color: activeSession ? '#86efac' : 'rgba(255,255,255,0.4)',
              border: `0.5px solid ${activeSession ? 'rgba(34,197,94,0.3)' : 'rgba(255,255,255,0.08)'}`,
            }}
          >
            {formatHMS(elapsed)}
          </span>

          <button
            onClick={clockIn}
            disabled={!!activeSession}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-white transition-all duration-150 disabled:opacity-35 disabled:cursor-not-allowed flex-shrink-0"
            style={{ background: 'rgba(22,163,74,0.85)' }}
          >
            <PlayIcon /> Clock In
          </button>

          <button
            onClick={clockOut}
            disabled={!activeSession}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-white transition-all duration-150 disabled:opacity-35 disabled:cursor-not-allowed flex-shrink-0"
            style={{ background: 'rgba(185,28,28,0.85)' }}
          >
            <StopIcon /> Clock Out
          </button>

          {activeSession && (
            <span className="text-[11px] truncate hidden sm:block" style={{ color: '#93c5fd', maxWidth: 100 }}>
              ● {activeSession.actName}
            </span>
          )}
        </div>

        {/* CENTER: Active task indicator — always visible */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '4px 16px',
            borderRadius: 20,
            background: activeTaskTimer ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.04)',
            border: `0.5px solid ${activeTaskTimer ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.05)'}`,
            whiteSpace: 'nowrap',
          }}
        >
          {activeTaskTimer ? (
            <>
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: '#ef4444',
                  display: 'inline-block',
                  flexShrink: 0,
                  animation: 'xp-blink 1.4s ease-in-out infinite',
                }}
              />
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontWeight: 700, letterSpacing: '0.08em' }}>
                ACTIVE
              </span>
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)', fontWeight: 600 }}>
                Task {activeTaskTimer.taskIndex + 1}
              </span>
              <span
                style={{
                  fontSize: 10,
                  color: '#93c5fd',
                  maxWidth: 200,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {activeTaskTimer.taskText}
              </span>
              <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#86efac', fontWeight: 700 }}>
                {formatHMS(taskElapsed)}
              </span>
            </>
          ) : (
            <>
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: 'rgba(255,255,255,0.2)',
                  display: 'inline-block',
                  flexShrink: 0,
                }}
              />
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', fontWeight: 500 }}>
                No Active Task
              </span>
            </>
          )}
        </div>

        {/* RIGHT: action buttons */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
          {/* 🔥 Motivate Me — purple */}
          <button
            onClick={onMotivate}
            className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-white transition-all duration-150 hover:opacity-85 hover:scale-105 flex-shrink-0"
            style={{ background: '#7c3aed', border: '0.5px solid rgba(167,139,250,0.35)' }}
          >
            🔥 Motivate Me
          </button>

          {/* 📊 Yearly */}
          <button
            onClick={onYearDash}
            className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all duration-150 hover:bg-white/10 flex-shrink-0"
            style={{ color: 'rgba(255,255,255,0.65)', border: '0.5px solid rgba(255,255,255,0.12)' }}
          >
            📊 Yearly
          </button>

          {/* Sun / pill / Moon toggle */}
          <button
            onClick={() => setIsDark(!isDark)}
            aria-label="Toggle dark mode"
            className="flex items-center gap-1.5 flex-shrink-0"
          >
            <span style={{ color: isDark ? 'rgba(255,255,255,0.3)' : '#fbbf24', transition: 'color 0.25s' }}>
              <SunIcon />
            </span>
            <div
              className="relative rounded-full transition-colors duration-300"
              style={{
                width: 36,
                height: 20,
                background: isDark ? '#4f46e5' : 'rgba(255,255,255,0.2)',
                border: '0.5px solid rgba(255,255,255,0.2)',
              }}
            >
              <div
                className="absolute top-[2px] w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-300"
                style={{ transform: isDark ? 'translateX(18px)' : 'translateX(2px)' }}
              />
            </div>
            <span style={{ color: isDark ? '#a78bfa' : 'rgba(255,255,255,0.3)', transition: 'color 0.25s' }}>
              <MoonIcon />
            </span>
          </button>
        </div>
      </div>
    </header>
  )
}

'use client'

import { useEffect, useState } from 'react'
import { useApp } from './AppContext'
import { XpaditeLogo } from '@/components/auth/XpaditeLogo'
import { formatHMS, todayKey } from './utils'
import type { Task } from './types'

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
  onAnalytics: () => void
  onMotivate: () => void
}

export function AppHeader({ onAnalytics, onMotivate }: AppHeaderProps) {
  const {
    isDark, setIsDark,
    activeSession, setActiveSession,
    activeTaskTimer, setActiveTaskTimer,
    addSession,
    activities, selectedActId,
    setSidebarOpen,
    updateDay,
    setToast,
  } = useApp()

  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  function clockIn() {
    if (activeSession) {
      setToast('~Active session in progress\nPlease clock out of your current task before starting another.')
      return
    }
    const act = activities.find(a => a.id === selectedActId) ?? activities[0]
    if (!act) return
    const startTs    = Date.now()
    const workSessId = 's' + startTs
    const taskSessId = 'tsci-' + startTs
    const taskId     = 'tci-' + startTs
    const dk         = todayKey()
    const newTask: Task = {
      id: taskId,
      text: '',
      done: false,
      journal: '',
      timerStart: startTs,
      timerEnd: null,
      actId: act.id,
      sessions: [{ id: taskSessId, startTs, endTs: null, note: '', tags: [] }],
      linkedSessionId: workSessId,
    }
    updateDay(dk, prev => ({ ...prev, tasks: [...prev.tasks, newTask] }))
    setActiveTaskTimer({ taskId, dateKey: dk, sessionId: taskSessId, startTs, taskText: '', taskIndex: 0 })
    setActiveSession({
      id: workSessId,
      actId: act.id,
      actName: (act.emoji ? act.emoji + ' ' : '') + act.name,
      actColor: act.color,
      startTs,
      dateKey: dk,
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

  // Theme toggle — shared between mobile and desktop
  const ThemeToggle = (
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
  )

  return (
    <header
      className="sticky top-0 z-20"
      style={{ background: 'var(--xp-hdr)', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}
    >
      {/* ── MOBILE HEADER (< sm / 640px) — ITR 3: row 1 nav + row 2 controls ─── */}
      <div className="flex sm:hidden flex-col">
        {/* Row 1: Burger (left) | Logo (absolutely centered) | Theme toggle (right) */}
        <div className="relative flex items-center px-4" style={{ paddingTop: 10, paddingBottom: 8 }}>
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-1.5 rounded-md transition-colors hover:bg-white/10 flex-shrink-0"
            style={{ color: 'rgba(255,255,255,0.7)', position: 'relative', zIndex: 1 }}
            aria-label="Open menu"
          >
            <BurgerIcon />
          </button>

          {/* Logo centered — absolute so burger/toggle widths don't shift it */}
          <div style={{ position: 'absolute', left: 0, right: 0, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
            <XpaditeLogo variant="light" size={28} />
          </div>

          {/* Theme toggle — sun + pill + moon */}
          <button
            onClick={() => setIsDark(!isDark)}
            aria-label="Toggle dark mode"
            className="flex items-center gap-1.5 flex-shrink-0"
            style={{ marginLeft: 'auto', position: 'relative', zIndex: 1 }}
          >
            <span style={{ color: isDark ? 'rgba(255,255,255,0.3)' : '#fbbf24', transition: 'color 0.25s', display: 'flex', alignItems: 'center' }}>
              <SunIcon />
            </span>
            <div
              className="relative rounded-full transition-colors duration-300"
              style={{
                width: 30,
                height: 17,
                background: isDark ? '#4f46e5' : 'rgba(255,255,255,0.2)',
                border: '0.5px solid rgba(255,255,255,0.2)',
              }}
            >
              <div
                className="absolute top-[2px] w-[13px] h-[13px] rounded-full bg-white shadow-sm transition-transform duration-300"
                style={{ transform: isDark ? 'translateX(15px)' : 'translateX(2px)' }}
              />
            </div>
            <span style={{ color: isDark ? '#a78bfa' : 'rgba(255,255,255,0.3)', transition: 'color 0.25s', display: 'flex', alignItems: 'center' }}>
              <MoonIcon />
            </span>
          </button>
        </div>

        {/* Row 2: Clock In | Active-session status | Clock Out — all same height */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 12px 10px',
            borderTop: '0.5px solid rgba(255,255,255,0.07)',
          }}
        >
          {/* Clock In */}
          <button
            onClick={clockIn}
            disabled={!!activeSession}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '7px 12px',
              borderRadius: 8,
              background: 'rgba(22,163,74,0.85)',
              color: 'white',
              fontSize: 11,
              fontWeight: 700,
              flexShrink: 0,
              opacity: activeSession ? 0.35 : 1,
              cursor: activeSession ? 'not-allowed' : 'pointer',
              border: 'none',
              transition: 'opacity 150ms ease',
            }}
            aria-label="Clock In"
          >
            <PlayIcon />
            <span>Clock In</span>
          </button>

          {/* Status capsule */}
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '7px 10px',
              borderRadius: 8,
              background: activeSession ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.04)',
              border: `0.5px solid ${activeSession ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.06)'}`,
              minWidth: 0,
              overflow: 'hidden',
            }}
          >
            {activeSession ? (
              <>
                <span style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: '#ef4444', flexShrink: 0,
                  animation: 'xp-blink 1.4s ease-in-out infinite',
                  display: 'inline-block',
                }} />
                <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', fontWeight: 700, letterSpacing: '0.08em', flexShrink: 0 }}>
                  ACTIVE
                </span>
                <span style={{
                  fontSize: 10, fontWeight: 600, flex: 1,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  color: activeTaskTimer ? '#93c5fd' : (activeSession.actColor ?? '#a78bfa'),
                }}>
                  {activeTaskTimer ? activeTaskTimer.taskText : activeSession.actName}
                </span>
                <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#86efac', fontWeight: 700, flexShrink: 0 }}>
                  {formatHMS(activeTaskTimer ? taskElapsed : elapsed)}
                </span>
              </>
            ) : (
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.28)', fontWeight: 500 }}>No active task</span>
            )}
          </div>

          {/* Clock Out */}
          <button
            onClick={clockOut}
            disabled={!activeSession}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '7px 12px',
              borderRadius: 8,
              background: 'rgba(185,28,28,0.85)',
              color: 'white',
              fontSize: 11,
              fontWeight: 700,
              flexShrink: 0,
              opacity: activeSession ? 1 : 0.35,
              cursor: activeSession ? 'pointer' : 'not-allowed',
              border: 'none',
              transition: 'opacity 150ms ease',
            }}
            aria-label="Clock Out"
          >
            <StopIcon />
            <span>Clock Out</span>
          </button>
        </div>
      </div>

      {/* ── DESKTOP HEADER (sm+ / ≥ 640px) — original two-row layout ─────────── */}
      <div className="hidden sm:block">
        {/* Row 1: Logo icon, centered */}
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
              className="inline-flex text-xs font-mono px-2 py-1 rounded-md flex-shrink-0"
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
              <PlayIcon /> <span>Clock In</span>
            </button>

            <button
              onClick={clockOut}
              disabled={!activeSession}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-white transition-all duration-150 disabled:opacity-35 disabled:cursor-not-allowed flex-shrink-0"
              style={{ background: 'rgba(185,28,28,0.85)' }}
            >
              <StopIcon /> <span>Clock Out</span>
            </button>

            {activeSession && (
              <span className="text-[11px] truncate" style={{ color: '#93c5fd', maxWidth: 100 }}>
                ● {activeSession.actName}
              </span>
            )}
          </div>

          {/* CENTER: Active task / session indicator */}
          <div
            className="flex items-center"
            style={{
              gap: 8,
              padding: '4px 16px',
              borderRadius: 20,
              background: (activeTaskTimer || activeSession) ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.04)',
              border: `0.5px solid ${(activeTaskTimer || activeSession) ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.05)'}`,
              whiteSpace: 'nowrap',
            }}
          >
            {activeTaskTimer ? (
              <>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#ef4444', display: 'inline-block', flexShrink: 0, animation: 'xp-blink 1.4s ease-in-out infinite' }} />
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontWeight: 700, letterSpacing: '0.08em' }}>ACTIVE</span>
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)', fontWeight: 600 }}>Task {activeTaskTimer.taskIndex + 1}</span>
                <span style={{ fontSize: 10, color: '#93c5fd', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{activeTaskTimer.taskText}</span>
                <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#86efac', fontWeight: 700 }}>{formatHMS(taskElapsed)}</span>
              </>
            ) : activeSession ? (
              <>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#ef4444', display: 'inline-block', flexShrink: 0, animation: 'xp-blink 1.4s ease-in-out infinite' }} />
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontWeight: 700, letterSpacing: '0.08em' }}>ACTIVE</span>
                <span style={{ fontSize: 10, color: activeSession.actColor, fontWeight: 600, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>{activeSession.actName}</span>
                <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#86efac', fontWeight: 700 }}>{formatHMS(elapsed)}</span>
              </>
            ) : (
              <>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'rgba(255,255,255,0.2)', display: 'inline-block', flexShrink: 0 }} />
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', fontWeight: 500 }}>No Active Task</span>
              </>
            )}
          </div>

          {/* RIGHT: action buttons */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
            <button
              onClick={onMotivate}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-white transition-all duration-150 hover:opacity-85 hover:scale-105 flex-shrink-0"
              style={{ background: '#7c3aed', border: '0.5px solid rgba(167,139,250,0.35)' }}
            >
              Motivate Me 🔥
            </button>

            <button
              onClick={onAnalytics}
              className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all duration-150 hover:bg-white/10 flex-shrink-0"
              style={{ color: 'rgba(255,255,255,0.65)', border: '0.5px solid rgba(255,255,255,0.12)' }}
            >
              📈 Analytics
            </button>

            {ThemeToggle}
          </div>
        </div>
      </div>
    </header>
  )
}

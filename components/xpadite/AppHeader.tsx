'use client'

import { useEffect, useState } from 'react'
import { useApp } from './AppContext'
import { XpaditeLogo } from '@/components/auth/XpaditeLogo'
import { formatHMS, todayKey } from './utils'
import { ActivityDropdown } from './ActivityBar'
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


interface AppHeaderProps {
  onAnalytics: () => void
  onAICoach?: () => void
}

export function AppHeader({ onAnalytics, onAICoach }: AppHeaderProps) {
  const {
    isDark, setIsDark,
    calendarClean, setCalendarClean,
    activeSession, setActiveSession,
    activeTaskTimer, setActiveTaskTimer,
    addSession,
    activities, selectedActId,
    setSidebarOpen,
    updateDay,
    setToast,
    effectiveTimezone,
  } = useApp()

  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  function clockIn() {
    if (activeSession || activeTaskTimer) {
      setToast('~An active task is already running.\nClock out first to start a new timer.')
      return
    }
    const act = activities.find(a => a.id === selectedActId) ?? activities[0]
    if (!act) return
    const startTs    = Date.now()
    const workSessId = 's' + startTs
    const taskSessId = 'tsci-' + startTs
    const taskId     = 'tci-' + startTs
    const dk         = todayKey(effectiveTimezone)
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

  // Clock-In tasks have taskText === '' (set by clockIn(), distinct from Task Manager timers).
  // A Clock-In Realtime event may arrive via calendar_days before work_sessions fires,
  // so derive the global-session state from both to keep both buttons immediately correct.
  const isClockedIn = !!(activeSession || (activeTaskTimer && activeTaskTimer.taskText === ''))

  const ThemeToggle = (
    <button
      onClick={() => setCalendarClean(!calendarClean)}
      aria-label={calendarClean ? 'Switch to filled calendar view' : 'Switch to clean calendar view'}
      className="flex items-center flex-shrink-0"
    >
      <div
        className="relative rounded-full transition-colors duration-300"
        style={{
          width: 42,
          height: 20,
          background: calendarClean ? 'rgba(255,255,255,0.2)' : '#7c3aed',
          border: '0.5px solid rgba(255,255,255,0.2)',
        }}
      >
        <div
          className="absolute top-[2px] w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-300"
          style={{ transform: calendarClean ? 'translateX(24px)' : 'translateX(2px)' }}
        />
      </div>
    </button>
  )

  // The active-session capsule content (shared between mobile and desktop active state)
  // activeTaskTimer.taskText === '' means Calendar Clock In → show activity name
  // activeTaskTimer.taskText !== '' means Task Manager → show task name (always has fallback "Task N")
  const ActiveCapsuleContent = activeTaskTimer ? (
    <>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#ef4444', display: 'inline-block', flexShrink: 0, animation: 'xp-blink 1.4s ease-in-out infinite' }} />
      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontWeight: 700, letterSpacing: '0.08em' }}>ACTIVE</span>
      <span style={{
        fontSize: 10,
        color: activeTaskTimer.taskText ? '#93c5fd' : (activeSession?.actColor ?? '#a78bfa'),
        fontWeight: 600,
        flex: 1,
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {activeTaskTimer.taskText || activeSession?.actName || ''}
      </span>
      <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#86efac', fontWeight: 700 }}>{formatHMS(taskElapsed)}</span>
    </>
  ) : activeSession ? (
    <>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#ef4444', display: 'inline-block', flexShrink: 0, animation: 'xp-blink 1.4s ease-in-out infinite' }} />
      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontWeight: 700, letterSpacing: '0.08em' }}>ACTIVE</span>
      <span style={{ fontSize: 10, color: activeSession.actColor, fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activeSession.actName}</span>
      <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#86efac', fontWeight: 700 }}>{formatHMS(elapsed)}</span>
    </>
  ) : null

  const isActive = !!(activeTaskTimer || activeSession)

  return (
    <>
      <header
        className="sticky top-0 z-20"
        style={{ background: 'var(--xp-hdr)', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}
      >
        {/* ── MOBILE HEADER (< sm / 640px) ─────────────────────────────────── */}
        <div className="flex sm:hidden flex-col">
          {/* Row 1: Burger | Logo (centered) | Theme toggle */}
          <div className="relative flex items-center px-4" style={{ paddingTop: 10, paddingBottom: 8 }}>
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-1.5 rounded-md transition-colors hover:bg-white/10 flex-shrink-0"
              style={{ color: 'rgba(255,255,255,0.7)', position: 'relative', zIndex: 1 }}
              aria-label="Open menu"
            >
              <BurgerIcon />
            </button>

            <div style={{ position: 'absolute', left: 0, right: 0, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
              <XpaditeLogo variant="light" size={28} />
            </div>

            <button
              onClick={() => setCalendarClean(!calendarClean)}
              aria-label={calendarClean ? 'Switch to filled calendar view' : 'Switch to clean calendar view'}
              className="flex items-center flex-shrink-0"
              style={{ marginLeft: 'auto', position: 'relative', zIndex: 1 }}
            >
              <div
                className="relative rounded-full transition-colors duration-300"
                style={{
                  width: 36,
                  height: 17,
                  background: calendarClean ? 'rgba(255,255,255,0.2)' : '#7c3aed',
                  border: '0.5px solid rgba(255,255,255,0.2)',
                }}
              >
                <div
                  className="absolute top-[2px] w-[13px] h-[13px] rounded-full bg-white shadow-sm transition-transform duration-300"
                  style={{ transform: calendarClean ? 'translateX(21px)' : 'translateX(2px)' }}
                />
              </div>
            </button>
          </div>

          {/* Row 2: Clock In | Status capsule (dropdown or active) | Clock Out */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 12px 10px',
              borderTop: '0.5px solid rgba(255,255,255,0.07)',
            }}
          >
            {/* Clock In — smaller padding on mobile to free space for capsule */}
            <button
              onClick={clockIn}
              disabled={isClockedIn}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '5px 9px', borderRadius: 8,
                background: 'rgba(22,163,74,0.85)', color: 'white',
                fontSize: 10, fontWeight: 700, flexShrink: 0,
                opacity: isClockedIn ? 0.35 : 1,
                cursor: isClockedIn ? 'not-allowed' : 'pointer',
                border: 'none', transition: 'opacity 150ms ease',
              }}
              aria-label="Clock In"
            >
              <PlayIcon />
              <span>Clock In</span>
            </button>

            {/* Status capsule — stable height regardless of active/idle state */}
            <div
              style={{
                flex: 1, display: 'flex', alignItems: 'center', gap: 5,
                padding: '4px 8px',
                height: 30,
                borderRadius: 8,
                background: isActive ? 'rgba(255,255,255,0.07)' : 'transparent',
                border: `0.5px solid ${isActive ? 'rgba(255,255,255,0.12)' : 'transparent'}`,
                minWidth: 0,
                overflow: isActive ? 'hidden' : 'visible',
              }}
            >
              {isActive ? (
                ActiveCapsuleContent
              ) : (
                <ActivityDropdown fullWidth />
              )}
            </div>

            {/* Clock Out — smaller padding on mobile to free space for capsule */}
            <button
              onClick={clockOut}
              disabled={!isClockedIn}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '5px 9px', borderRadius: 8,
                background: 'rgba(185,28,28,0.85)', color: 'white',
                fontSize: 10, fontWeight: 700, flexShrink: 0,
                opacity: isClockedIn ? 1 : 0.35,
                cursor: isClockedIn ? 'pointer' : 'not-allowed',
                border: 'none', transition: 'opacity 150ms ease',
              }}
              aria-label="Clock Out"
            >
              <StopIcon />
              <span>Clock Out</span>
            </button>
          </div>
        </div>

        {/* ── DESKTOP HEADER (sm+ / ≥ 640px) ──────────────────────────────── */}
        <div className="hidden sm:block">
          {/* Row 1: Logo icon, centered */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '10px 16px 6px' }}>
            <XpaditeLogo variant="light" size={32} />
          </div>

          {/* Row 2: Controls (left) | Clock In + capsule + Clock Out (center) | Toggle (right) */}
          <div
            style={{
              maxWidth: 1360,
              margin: '0 auto',
              padding: '0 16px 6px',
              display: 'grid',
              gridTemplateColumns: '1fr auto 1fr',
              alignItems: 'center',
              gap: 8,
            }}
          >
            {/* LEFT: burger only */}
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <button
                onClick={() => setSidebarOpen(true)}
                className="p-1.5 rounded-md transition-colors hover:bg-white/10 flex-shrink-0"
                style={{ color: 'rgba(255,255,255,0.7)' }}
                aria-label="Open menu"
              >
                <BurgerIcon />
              </button>
            </div>

            {/* CENTER: Clock In + (dropdown or active capsule) + Clock Out */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <button
                onClick={clockIn}
                disabled={isClockedIn}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-white transition-all duration-150 disabled:opacity-35 disabled:cursor-not-allowed flex-shrink-0"
                style={{ background: 'rgba(22,163,74,0.85)' }}
              >
                <PlayIcon /> <span>Clock In</span>
              </button>

              {/* Fixed-width capsule wrapper — same width regardless of activity/task name */}
              <div style={{ width: 285, flexShrink: 0 }}>
                {isActive ? (
                  <div
                    className="flex items-center"
                    style={{
                      gap: 8,
                      padding: '4px 16px',
                      borderRadius: 20,
                      background: 'rgba(0,0,0,0.25)',
                      border: '0.5px solid rgba(255,255,255,0.08)',
                      width: '100%',
                      overflow: 'hidden',
                    }}
                  >
                    {ActiveCapsuleContent}
                  </div>
                ) : (
                  <ActivityDropdown fullWidth />
                )}
              </div>

              <button
                onClick={clockOut}
                disabled={!isClockedIn}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-white transition-all duration-150 disabled:opacity-35 disabled:cursor-not-allowed flex-shrink-0"
                style={{ background: 'rgba(185,28,28,0.85)' }}
              >
                <StopIcon /> <span>Clock Out</span>
              </button>
            </div>

            {/* RIGHT: toggle */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
              {ThemeToggle}
            </div>
          </div>

        </div>
      </header>
    </>
  )
}

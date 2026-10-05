'use client'

// ── 🎯 Goal Manager — V1 front-end preview ────────────────────────────────────
// Static preview of the V2 feature, built from the "Goal Manager Modal - Design
// ITR 1" reference. No data, persistence, or real goal/deadline/calendar logic:
// every interactive control routes to ONE shared Coming Soon dialog.

import { useEffect, useState } from 'react'
import { useLockBodyScroll } from './useLockBodyScroll'

const PURPLE = '#7c3aed'
const PURPLE_DEEP = '#5b21b6'
const LAVENDER = '#a78bfa'

const CHECKPOINTS = [
  { key: 'A', label: 'Started', done: true, dateNote: 'Sept 3, 2026 10:00 AM' },
  { key: 'B', label: 'Win 1',   done: true },
  { key: 'C', label: 'Win 2',   done: false },
  { key: 'D', label: 'Win 3',   done: false },
] as const

// ─── Shared primitives ────────────────────────────────────────────────────────

function CheckMark({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={PURPLE} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

// XPadite target — concentric purple rings, deliberately NO arrow.
function BullseyeIcon({ size = 48 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
      <circle cx="24" cy="24" r="21" stroke={PURPLE} strokeWidth="3.5" />
      <circle cx="24" cy="24" r="12" stroke={PURPLE} strokeWidth="3.5" />
      <circle cx="24" cy="24" r="4.5" fill={PURPLE} />
    </svg>
  )
}

// ─── Coming Soon (one shared V2 dialog for every reserved interaction) ─────────

function GoalManagerComingSoon({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[320px] rounded-2xl p-6 text-center"
        style={{ background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)', boxShadow: '0 24px 60px rgba(0,0,0,0.35)' }}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Goal Manager coming in V2"
      >
        <div className="text-3xl mb-3" aria-hidden="true">🎯</div>
        <h3 className="text-sm font-bold mb-2" style={{ color: 'var(--xp-txt)' }}>Goal Manager — Coming in V2</h3>
        <p className="text-[11.5px] leading-relaxed mb-4" style={{ color: 'var(--xp-txt2)' }}>
          Turn your ambitions into structured goals with checkpoints, wins, deadlines, task checklists, and a visual journey from start to achievement.
        </p>
        <span className="inline-block text-[9px] font-bold px-3 py-1 rounded-full mb-5" style={{ background: `linear-gradient(135deg, ${PURPLE}, #6366f1)`, color: 'white', letterSpacing: '0.06em' }}>
          COMING SOON IN XPADITE V2 🚀
        </span>
        <div>
          <button onClick={onClose} className="px-6 py-2 rounded-full text-[11px] font-semibold transition-opacity hover:opacity-75" style={{ background: 'var(--xp-bg3)', color: 'var(--xp-txt2)', border: '0.5px solid var(--xp-bdr2)' }}>
            OK
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Journey (Started → Win 1 → Win 2 → Win 3 → Deadline) ─────────────────────

function JourneyNode({ letter, done, size = 48 }: { letter: string; done: boolean; size?: number }) {
  return (
    <div
      className="flex items-center justify-center rounded-full flex-shrink-0 relative"
      style={{
        width: size, height: size,
        background: done ? PURPLE : 'var(--xp-card)',
        border: done ? 'none' : `3px solid ${PURPLE}`,
        color: done ? '#ffffff' : PURPLE,
        fontSize: size < 48 ? 16 : 19, fontWeight: 600,
        boxShadow: done ? '0 4px 14px rgba(124,58,237,0.35)' : 'none',
      }}
    >
      {letter}
    </div>
  )
}

// Thicker, filled ✔ with pointed/tapered ends — mobile journey only.
function CheckTick({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d="M1.6 12.7 L4.6 9.7 L9.5 14.6 L19.4 4.7 L22.4 7.7 L9.5 20.6 Z" fill={PURPLE} />
    </svg>
  )
}

function Journey({ onV2 }: { onV2: () => void }) {
  const labels = ['Started', 'Win 1', 'Win 2', 'Win 3', 'Deadline']

  return (
    <>
      {/* Desktop/tablet — one horizontal row, aligned with the cards below */}
      <div className="hidden sm:block relative">
        {/* Purple progress line from A through B, fading toward C */}
        <div
          className="absolute rounded-full"
          style={{
            top: 'calc(50% + 14px)', height: 6, transform: 'translateY(-50%)',
            left: '10%', right: '50%',
            background: `linear-gradient(90deg, ${LAVENDER} 0%, #c084fc 55%, rgba(192,132,252,0.35) 100%)`,
          }}
        />
        <div className="grid grid-cols-5 relative">
          {labels.map((label, i) => {
            const cp = CHECKPOINTS[i]
            const done = cp ? cp.done : false
            return (
              <div key={label} className="flex flex-col items-center gap-2 cursor-pointer" onClick={onV2}>
                <span className="text-[15px] font-semibold" style={{ color: 'var(--xp-txt)' }}>{label}</span>
                <div className="h-4 flex items-end justify-center">{done && <CheckMark size={16} />}</div>
                {cp ? <JourneyNode letter={cp.key} done={cp.done} /> : <BullseyeIcon size={48} />}
              </div>
            )
          })}
        </div>
      </div>

      {/* Mobile — the same horizontal journey, scaled to fit the screen width.
          Layout bands: label 20px, check 18px, node 40px → node centre at 58px,
          where the progress line runs through every circle's centre. */}
      <div className="sm:hidden relative">
        <div className="absolute rounded-full" style={{ top: 58, left: '10%', right: '10%', height: 6, transform: 'translateY(-50%)', background: 'var(--xp-bdr2)' }} />
        <div className="absolute rounded-full" style={{ top: 58, left: '10%', width: '20%', height: 6, transform: 'translateY(-50%)', background: `linear-gradient(90deg, ${LAVENDER}, #c084fc)` }} />
        <div className="grid grid-cols-5 relative">
          {labels.map((label, i) => {
            const cp = CHECKPOINTS[i]
            const done = cp ? cp.done : false
            return (
              <div key={label} className="flex flex-col items-center cursor-pointer min-w-0" onClick={onV2}>
                <span className="h-5 leading-5 text-[10.5px] font-semibold whitespace-nowrap" style={{ color: 'var(--xp-txt)' }}>{label}</span>
                <div className="h-[18px] flex items-end justify-center">{done && <CheckTick size={13} />}</div>
                {cp ? <JourneyNode letter={cp.key} done={cp.done} size={40} /> : <BullseyeIcon size={40} />}
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}

// ─── Controls ─────────────────────────────────────────────────────────────────

function NumberControl({ label, value, onV2 }: { label: string; value: number; onV2: () => void }) {
  return (
    <button
      onClick={onV2}
      className="flex items-center justify-between sm:justify-start gap-2 sm:gap-3 w-full sm:w-auto px-2.5 py-1.5 sm:px-3 sm:py-2 rounded-xl transition-all hover:opacity-85 active:scale-[0.98]"
      style={{ border: '1.5px solid var(--xp-bdr2)', background: 'var(--xp-card)', color: 'var(--xp-txt)', cursor: 'pointer' }}
    >
      <span className="text-[11px] sm:text-[12.5px] font-medium text-left leading-tight">{label}</span>
      <span className="flex items-center justify-center rounded-md text-[12.5px] font-semibold" style={{ minWidth: 30, height: 26, border: '1px solid var(--xp-bdr2)', background: 'var(--xp-bg3)' }}>
        {value}
      </span>
      <span className="flex flex-col leading-none" style={{ color: 'var(--xp-txt3)', fontSize: 8 }} aria-hidden="true">
        <span>▲</span><span>▼</span>
      </span>
    </button>
  )
}

function PurplePill({ children, onV2 }: { children: React.ReactNode; onV2: () => void }) {
  return (
    <button
      onClick={onV2}
      className="w-full sm:w-auto px-3 py-2 sm:px-5 sm:py-2.5 rounded-full text-[11px] sm:text-[12.5px] leading-tight font-semibold text-white text-center sm:whitespace-nowrap transition-all hover:opacity-90 active:scale-[0.97]"
      style={{ background: PURPLE, boxShadow: '0 4px 14px rgba(124,58,237,0.25)', cursor: 'pointer' }}
    >
      {children}
    </button>
  )
}

// ─── Checkpoint / task cards ──────────────────────────────────────────────────

interface CardTask { text: string; checked: boolean }

// Mobile: compact, taller-than-wide tiles (4 per row). sm+ keeps the full card.
function CheckpointCard({ title, tasks, footer, onV2 }: { title: string; tasks?: CardTask[]; footer?: string; onV2: () => void }) {
  return (
    <div className="rounded-2xl flex flex-col min-h-[124px] sm:min-h-[150px] min-w-0" style={{ border: `2px solid ${PURPLE}`, background: 'var(--xp-card)', boxShadow: '0 2px 10px rgba(124,58,237,0.08)' }}>
      <button onClick={onV2} className="flex items-start gap-1 sm:gap-2 px-1.5 pt-2 pb-1 sm:px-3 sm:pt-3 sm:pb-2 text-left min-w-0" style={{ cursor: 'pointer' }}>
        <span className="text-[8px] sm:text-[12px] leading-[14px] sm:leading-[18px] flex-shrink-0" style={{ color: PURPLE }}>▼</span>
        <span className="text-[9.5px] sm:text-[12.5px] font-semibold leading-tight sm:leading-snug min-w-0" style={{ color: 'var(--xp-txt)' }}>{title}</span>
      </button>

      {tasks && (
        <div className="flex flex-col gap-1.5 sm:gap-2 px-1.5 pb-1.5 sm:px-3 sm:pb-2 min-w-0">
          {tasks.map(t => (
            <button key={t.text} onClick={onV2} className="flex items-center gap-1 sm:gap-2.5 text-left min-w-0 transition-opacity hover:opacity-80" style={{ cursor: 'pointer' }}>
              <span
                className="flex items-center justify-center rounded-[3px] sm:rounded-[4px] flex-shrink-0 w-3 h-3 sm:w-4 sm:h-4 border-[1.5px] sm:border-2"
                style={{ borderColor: PURPLE, background: t.checked ? PURPLE : 'transparent' }}
              >
                {t.checked && <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeLinecap="round" strokeLinejoin="round" className="w-[7px] h-[7px] sm:w-2.5 sm:h-2.5 [stroke-width:4] sm:[stroke-width:3.5]"><polyline points="20 6 9 17 4 12" /></svg>}
              </span>
              <span className="text-[8.5px] sm:text-[12px] truncate min-w-0" style={{ color: 'var(--xp-txt)' }}>{t.text}</span>
            </button>
          ))}
        </div>
      )}

      {footer && <p className="mt-auto px-1.5 pb-1.5 pt-1 sm:px-3 sm:pb-3 sm:pt-2 text-[7.5px] sm:text-[10.5px] leading-tight" style={{ color: 'var(--xp-txt3)' }}>{footer}</p>}
    </div>
  )
}

// ─── Timeline (static two-month preview) ──────────────────────────────────────

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

// Preview range: Sept 3 → Oct 7, 2026. Static data only.
function inStartMonthRange(day: number) { return day >= 3 }
function inEndMonthRange(day: number) { return day <= 7 }

function MonthGrid({ month, daysInMonth, firstWeekday, tone, onV2 }: {
  month: string; daysInMonth: number; firstWeekday: number; tone: 'start' | 'end'; onV2: () => void
}) {
  const cells: (number | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  const inRange = (d: number) => tone === 'start' ? inStartMonthRange(d) : inEndMonthRange(d)
  const isStart = (d: number) => tone === 'start' && d === 3
  const isDeadline = (d: number) => tone === 'end' && d === 7
  const isToday = (d: number) => tone === 'end' && d === 4

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={onV2}
        className="self-center px-2 py-1 sm:px-4 sm:py-1.5 rounded-lg text-[9px] sm:text-[12px] leading-tight transition-opacity hover:opacity-85"
        style={{ border: '1px solid var(--xp-bdr2)', background: 'var(--xp-card)', color: 'var(--xp-txt2)', cursor: 'pointer' }}
      >
        {tone === 'start' ? 'Start' : 'End'} Month - <strong style={{ color: 'var(--xp-txt)' }}>{month}</strong>
      </button>

      <div className="grid grid-cols-7 text-center">
        {WEEKDAYS.map(w => (
          <span key={w} className="text-[7.5px] sm:text-[10px] font-semibold py-0.5 sm:py-1" style={{ color: w === 'Su' ? '#f97316' : 'var(--xp-txt3)' }}>{w}</span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-y-1">
        {cells.map((d, idx) => {
          if (d === null) return <div key={idx} />
          const band = inRange(d)
          return (
            <button
              key={idx}
              onClick={onV2}
              className="relative flex items-center justify-center text-[9px] sm:text-[11px] font-medium h-6 sm:h-8 min-w-0"
              style={{
                background: band && !isStart(d) && !isDeadline(d) ? 'rgba(124,58,237,0.18)' : 'transparent',
                color: band ? 'var(--xp-txt)' : 'var(--xp-txt3)',
                cursor: 'pointer',
              }}
            >
              {isStart(d) && <span className="absolute w-5 h-5 sm:w-7 sm:h-7 rounded-full" style={{ background: PURPLE }} />}
              {isStart(d) && <span className="relative text-white font-bold">{d}</span>}
              {isDeadline(d) && <span className="sm:hidden"><BullseyeIcon size={18} /></span>}
              {isDeadline(d) && <span className="hidden sm:inline"><BullseyeIcon size={26} /></span>}
              {isDeadline(d) && <span className="absolute text-[8px] font-bold" style={{ color: PURPLE }}>{d}</span>}
              {isToday(d) && <span className="absolute w-5 h-5 sm:w-7 sm:h-7 rounded-full" style={{ border: `1.5px solid ${LAVENDER}` }} />}
              {!isStart(d) && !isDeadline(d) && <span className="relative">{d}</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function Timeline({ onV2 }: { onV2: () => void }) {
  return (
    // Mobile drops the outer outline and shows both months side by side.
    <div className="rounded-2xl p-0 sm:p-5 border-0 sm:border-2" style={{ borderColor: PURPLE, background: 'var(--xp-card)' }}>
      <h3 className="text-center text-[15px] sm:text-[18px] font-semibold mb-3 sm:mb-4" style={{ color: 'var(--xp-txt)' }}>Timeline</h3>
      <div className="grid grid-cols-2 sm:grid-cols-1 md:grid-cols-2 gap-2 sm:gap-4">
        <div className="rounded-xl sm:rounded-2xl p-1.5 sm:p-4 min-w-0" style={{ border: '1px solid var(--xp-bdr2)', background: 'var(--xp-card)' }}>
          <MonthGrid month="September" daysInMonth={30} firstWeekday={2} tone="start" onV2={onV2} />
        </div>
        <div className="rounded-xl sm:rounded-2xl p-1.5 sm:p-4 min-w-0" style={{ border: '1px solid rgba(124,58,237,0.18)', background: 'rgba(124,58,237,0.04)' }}>
          <MonthGrid month="October" daysInMonth={31} firstWeekday={4} tone="end" onV2={onV2} />
        </div>
      </div>
    </div>
  )
}

// ─── Modal ────────────────────────────────────────────────────────────────────

export function GoalManagerModal({ onClose }: { onClose: () => void }) {
  useLockBodyScroll()
  const [v2Open, setV2Open] = useState(false)
  const openV2 = () => setV2Open(true)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (v2Open) { setV2Open(false); return }
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, v2Open])

  return (
    <>
      <div
        className="fixed inset-x-0 top-0 bottom-14 sm:inset-0 z-50 flex flex-col sm:flex-row sm:items-start sm:justify-center sm:overflow-y-auto sm:p-3 sm:pt-4"
        style={{ background: 'rgba(0,0,0,0.55)' }}
        onClick={onClose}
      >
        <div
          className="flex flex-col w-full h-full sm:h-auto sm:rounded-2xl sm:shadow-2xl overflow-hidden sm:max-w-[640px] lg:max-w-[1296px] sm:mb-6"
          style={{ background: 'var(--xp-bg)', border: '0.5px solid var(--xp-bdr2)', boxShadow: '0 20px 50px rgba(0,0,0,0.12)' }}
          onClick={e => e.stopPropagation()}
        >
          {/* Signature purple header — same treatment as Analytics */}
          <div
            className="flex-shrink-0 flex items-center justify-between gap-3 px-4 sm:px-6 py-3.5 sm:py-4"
            style={{ background: `linear-gradient(135deg, ${PURPLE} 0%, ${PURPLE_DEEP} 100%)` }}
          >
            <h2 className="text-[17px] sm:text-[20px] font-extrabold leading-tight" style={{ color: '#ffffff' }}>🎯 Goal Manager</h2>
            <button
              onClick={onClose}
              aria-label="Close Goal Manager"
              className="flex items-center justify-center rounded-full flex-shrink-0 transition-opacity hover:opacity-75"
              style={{ width: 30, height: 30, background: 'rgba(255,255,255,0.18)', color: '#ffffff', border: 'none', cursor: 'pointer' }}
            >
              ✕
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 flex flex-col gap-6">
            {/* 2 · Goal progression */}
            <Journey onV2={openV2} />

            {/* 3 · Controls */}
            {/* Mobile: 2×2 grid (each pill sits under its matching control). Desktop: unchanged row. */}
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-row sm:items-center sm:justify-between sm:gap-3">
              <div className="contents sm:flex sm:flex-wrap sm:gap-3">
                <NumberControl label="Checkpoints" value={5} onV2={openV2} />
                <NumberControl label="Tasks' Checklist" value={5} onV2={openV2} />
              </div>
              <div className="contents sm:flex sm:flex-wrap sm:gap-3">
                <PurplePill onV2={openV2}>Set a Deadline</PurplePill>
                <PurplePill onV2={openV2}>Set Goals With AI Coach</PurplePill>
              </div>
            </div>

            {/* 4 · Checkpoint / task cards — one per journey column on desktop */}
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-5">
              <CheckpointCard
                title="Tasks' Checklist"
                tasks={[
                  { text: 'Task 1 - xyz', checked: true },
                  { text: 'Task 2 - xyz', checked: true },
                  { text: 'Task 3 - xyz', checked: true },
                ]}
                footer="Sept 3, 2026 10:00 AM"
                onV2={openV2}
              />
              <CheckpointCard title="Tasks' Checklist" onV2={openV2} />
              <CheckpointCard title="Tasks' Checklist" onV2={openV2} />
              <CheckpointCard title="Tasks' Checklist" onV2={openV2} />
              <CheckpointCard
                title="Checklist of Accomplishments"
                tasks={[
                  { text: 'Task 1 - xyz', checked: true },
                  { text: 'Task 2 - xyz', checked: false },
                  { text: 'Task 3 - xyz', checked: false },
                  { text: 'Task 4 - xyz', checked: false },
                  { text: 'Task 5 - xyz', checked: false },
                ]}
                onV2={openV2}
              />
            </div>

            {/* 5 · Timeline */}
            <Timeline onV2={openV2} />
          </div>
        </div>
      </div>

      {v2Open && <GoalManagerComingSoon onClose={() => setV2Open(false)} />}
    </>
  )
}

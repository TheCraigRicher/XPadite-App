'use client'

// ── 🎯 Goal Manager — V1 front-end preview ────────────────────────────────────
// Static preview of the V2 feature, built from the "Goal Manager Modal - Design
// ITR 1" reference. No data, persistence, or real goal/deadline/calendar logic:
// every interactive control routes to ONE shared Coming Soon dialog. The only
// local UI state is checklist-card expand/collapse.

import { useEffect, useState } from 'react'
import { useLockBodyScroll } from './useLockBodyScroll'

const PURPLE = '#7c3aed'
const PURPLE_DEEP = '#5b21b6'
const LAVENDER = '#a78bfa'

const FLOW_CSS = '@media (prefers-reduced-motion: no-preference){@keyframes xp-gm-flow{from{background-position:-120% 0}to{background-position:220% 0}}}'

const CHECKPOINTS = [
  { key: 'A', label: 'Started', done: true },
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

// Thicker, filled ✔ with pointed/tapered ends — mobile journey only.
function CheckTick({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d="M1.6 12.7 L4.6 9.7 L9.5 14.6 L19.4 4.7 L22.4 7.7 L9.5 20.6 Z" fill={PURPLE} />
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

// Journey Deadline target. The rings are unfilled, so a backing disc sized just
// inside the outer ring masks the rail: the rail reads as tucked under the
// target and ends on its curved outer edge, never showing inside it.
function DeadlineBullseye({ size }: { size: number }) {
  const back = size * (43 / 48)
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <div className="absolute rounded-full" style={{ width: back, height: back, left: (size - back) / 2, top: (size - back) / 2, background: 'var(--xp-card)' }} />
      <div className="absolute inset-0"><BullseyeIcon size={size} /></div>
    </div>
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

// The connector spans centre-of-A to centre-of-Deadline (80% of the row, the
// checkpoints sit at 10/30/50/70/90%). A→B is completed; B→C is the WIP segment,
// stopping halfway toward C and fading out at its leading edge. `top` is the
// exact vertical centre of the circles.
const TRACK_B = '25%'     // B sits 25% along the track
const TRACK_WIP = '37.5%' // halfway from B (25%) toward C (50%)

function ProgressTrack({ top, thickness }: { top: number; thickness: number }) {
  return (
    <>
      <style>{FLOW_CSS}</style>
      <div
        className="absolute overflow-hidden rounded-full pointer-events-none"
        style={{ top, left: '10%', right: '10%', height: thickness, transform: 'translateY(-50%)', background: 'rgba(167,139,250,0.22)' }}
      >
        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: TRACK_B, background: `linear-gradient(90deg, ${LAVENDER}, #c084fc)` }} />
        <div
          className="absolute inset-y-0"
          style={{
            left: TRACK_B, width: `calc(${TRACK_WIP} - ${TRACK_B})`,
            background: 'linear-gradient(90deg, #c084fc 0%, rgba(192,132,252,0.55) 55%, rgba(192,132,252,0) 100%)',
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.55) 50%, transparent 100%)',
            backgroundSize: '45% 100%', backgroundRepeat: 'no-repeat',
            animation: 'xp-gm-flow 2.8s linear infinite', opacity: 0.75,
          }}
        />
      </div>
    </>
  )
}

function Journey({ onV2 }: { onV2: () => void }) {
  const labels = ['Started', 'Win 1', 'Win 2', 'Win 3', 'Deadline']

  return (
    <>
      {/* Desktop/tablet — label 24px + check 20px + node 48px → circle centre at 68px */}
      <div className="hidden sm:block relative">
        <ProgressTrack top={68} thickness={20} />
        <div className="grid grid-cols-5 relative">
          {labels.map((label, i) => {
            const cp = CHECKPOINTS[i]
            const done = cp ? cp.done : false
            return (
              <div key={label} className="flex flex-col items-center cursor-pointer" onClick={onV2}>
                <div className="h-6 flex items-center">
                  <span className="text-[15px] font-semibold" style={{ color: 'var(--xp-txt)' }}>{label}</span>
                </div>
                <div className="h-5 flex items-end justify-center">{done && <CheckMark size={16} />}</div>
                {cp ? <JourneyNode letter={cp.key} done={cp.done} /> : <DeadlineBullseye size={48} />}
              </div>
            )
          })}
        </div>
      </div>

      {/* Mobile — label 20px + check 18px + node 40px → circle centre at 58px */}
      <div className="sm:hidden relative">
        <ProgressTrack top={58} thickness={17} />
        <div className="grid grid-cols-5 relative">
          {labels.map((label, i) => {
            const cp = CHECKPOINTS[i]
            const done = cp ? cp.done : false
            return (
              <div key={label} className="flex flex-col items-center cursor-pointer min-w-0" onClick={onV2}>
                <span className="h-5 leading-5 text-[10.5px] font-semibold whitespace-nowrap" style={{ color: 'var(--xp-txt)' }}>{label}</span>
                <div className="h-[18px] flex items-end justify-center">{done && <CheckTick size={13} />}</div>
                {cp ? <JourneyNode letter={cp.key} done={cp.done} size={40} /> : <DeadlineBullseye size={40} />}
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

// The card body opens/closes via the purple triangle only (stopPropagation keeps
// that separate from the card click, which opens the V2 Coming Soon dialog).
function CheckpointCard({ title, tasks, footer, onV2 }: { title: string; tasks?: CardTask[]; footer?: string; onV2: () => void }) {
  const [open, setOpen] = useState(true)

  return (
    // self-start: the card keeps its own height instead of stretching to the row,
    // so a collapsed card shrinks to just its header bar.
    <div
      onClick={onV2}
      className="self-start rounded-2xl flex flex-col min-w-0 overflow-hidden cursor-pointer"
      style={{ border: `2px solid ${PURPLE}`, background: 'var(--xp-card)', boxShadow: '0 2px 10px rgba(124,58,237,0.08)' }}
    >
      <div className="flex items-start gap-1 sm:gap-2 px-1.5 pt-2 pb-1 sm:px-3 sm:pt-3 sm:pb-2 min-w-0">
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? 'Collapse checklist' : 'Expand checklist'}
          onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
          className="flex-shrink-0 leading-none"
          style={{ cursor: 'pointer', background: 'none', border: 'none', padding: 0, color: PURPLE }}
        >
          <span
            className="inline-block text-[8px] sm:text-[12px] leading-[14px] sm:leading-[18px]"
            style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 220ms ease' }}
          >▼</span>
        </button>
        <span
          className="text-[8.5px] sm:text-[12.5px] font-semibold leading-tight sm:leading-snug min-w-0 line-clamp-2 [overflow-wrap:anywhere]"
          style={{ color: 'var(--xp-txt)' }}
        >
          {title}
        </span>
      </div>

      {/* Every expanded card shares one fixed preview height (sized to the first
          populated card). Anything taller is clipped, never grows the card. */}
      <div className="grid" style={{ gridTemplateRows: open ? '1fr' : '0fr', transition: 'grid-template-rows 240ms ease-out' }}>
        <div className="min-h-0 overflow-hidden">
          <div className="h-[96px] sm:h-[146px] flex flex-col overflow-hidden">
          {tasks && (
            <div className="flex flex-col gap-1.5 sm:gap-2 px-1.5 pb-1.5 sm:px-3 sm:pb-2 min-w-0">
              {tasks.map(t => (
                <div key={t.text} className="flex items-center gap-1 sm:gap-2.5 min-w-0">
                  <span
                    className="flex items-center justify-center rounded-[3px] sm:rounded-[4px] flex-shrink-0 w-3 h-3 sm:w-4 sm:h-4 border-[1.5px] sm:border-2"
                    style={{ borderColor: PURPLE, background: t.checked ? PURPLE : 'transparent' }}
                  >
                    {t.checked && <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeLinecap="round" strokeLinejoin="round" className="w-[7px] h-[7px] sm:w-2.5 sm:h-2.5 [stroke-width:4] sm:[stroke-width:3.5]"><polyline points="20 6 9 17 4 12" /></svg>}
                  </span>
                  <span className="text-[8.5px] sm:text-[12px] truncate min-w-0" style={{ color: 'var(--xp-txt)' }}>{t.text}</span>
                </div>
              ))}
            </div>
          )}

          {footer && <p className="mt-auto px-1.5 pb-1.5 pt-1 sm:px-3 sm:pb-3 sm:pt-2 text-[7.5px] sm:text-[10.5px] leading-tight" style={{ color: 'var(--xp-txt3)' }}>{footer}</p>}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Timeline (static two-month preview) ──────────────────────────────────────

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

// How far the range bands stop short of the outer date-column edges.
const INSET_CSS = '.gm-inset{--gm-inset:4px}@media (min-width:640px){.gm-inset{--gm-inset:10px}}'

// Preview range: Sept 3 → Oct 7, 2026. Static data only.
function inStartMonthRange(day: number) { return day >= 3 }
function inEndMonthRange(day: number) { return day <= 7 }

// Deadline target (Image 2): solid purple outer ring → white gap → solid purple
// middle ring → white gap → solid purple centre holding the date in white.
// Built from stacked discs; every radius is a fraction of the target size D.
function DeadlineTarget({ D, date, fontSize }: { D: number; date: number; fontSize: number }) {
  const R = D / 2
  const s = D / 30 // 30px is the desktop reference size
  const t = 2.5 * s // ring thickness
  const g = 1.5 * s // white gap
  const disc = (r: number, bg: string) => (
    <span
      className="absolute rounded-full"
      style={{ width: r * 2, height: r * 2, left: R - r, top: R - r, background: bg }}
    />
  )
  return (
    <span className="absolute" style={{ width: D, height: D, left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}>
      {disc(R, PURPLE)}
      {disc(R - t, 'var(--xp-card)')}
      {disc(R - t - g, PURPLE)}
      {disc(R - 2 * t - g, 'var(--xp-card)')}
      {disc(R - 2 * t - 2 * g, PURPLE)}
      <span
        className="absolute inset-0 flex items-center justify-center font-bold text-white"
        style={{ fontSize, lineHeight: 1 }}
      >
        {date}
      </span>
    </span>
  )
}

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

  const weeks: (number | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))

  // Horizontal extent of a week's range band, as % of the 7-column row.
  // Ends at a marker → centre of that column; otherwise the column boundary,
  // pulled in by --gm-inset so the band stays inside the date grid.
  function bandFor(week: (number | null)[]): { left: string; right: string } | null {
    const hits = week.map((d, i) => (d !== null && inRange(d) ? i : -1)).filter(i => i >= 0)
    if (hits.length === 0) return null
    const colW = 100 / 7
    const first = hits[0], last = hits[hits.length - 1]
    const startsAtMarker = isStart(week[first]!)
    const endsAtMarker = isDeadline(week[last]!)
    const left = startsAtMarker ? `${first * colW + colW / 2}%` : `calc(${first * colW}% + var(--gm-inset))`
    const right = endsAtMarker ? `${100 - (last * colW + colW / 2)}%` : `calc(${100 - (last + 1) * colW}% + var(--gm-inset))`
    return { left, right }
  }

  return (
    <div className="flex flex-col gap-2">
      <style>{INSET_CSS}</style>
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

      <div className="flex flex-col gap-1 gm-inset">
        {weeks.map((week, wi) => {
          const seg = bandFor(week)
          return (
            <div key={wi} className="relative grid grid-cols-7">
              {/* One band per week, clipped to that week's first/last date
                  columns (inset from the grid edges); it starts/ends at a marker's
                  centre when the range begins or ends there. */}
              {seg && (
                <span
                  aria-hidden="true"
                  className="absolute top-1/2 -translate-y-1/2 h-4 sm:h-[22px] pointer-events-none"
                  style={{ background: 'rgba(167,139,250,0.5)', left: seg.left, right: seg.right }}
                />
              )}

              {week.map((d, idx) => {
                if (d === null) return <div key={idx} />
                const band = inRange(d)
                return (
                  <button
                    key={idx}
                    onClick={onV2}
                    className="relative flex items-center justify-center text-[9px] sm:text-[11px] font-medium h-6 sm:h-8 min-w-0"
                    style={{ color: band ? 'var(--xp-txt)' : 'var(--xp-txt3)', cursor: 'pointer' }}
                  >
                    {isStart(d) && <span className="absolute w-5 h-5 sm:w-7 sm:h-7 rounded-full" style={{ background: PURPLE }} />}
                    {isStart(d) && <span className="relative text-white font-bold">{d}</span>}

                    {/* Deadline target — the band ends beneath it (Image 2). */}
                    {isDeadline(d) && <span className="sm:hidden contents"><DeadlineTarget D={22} date={d} fontSize={6.5} /></span>}
                    {isDeadline(d) && <span className="hidden sm:contents"><DeadlineTarget D={30} date={d} fontSize={9} /></span>}

                    {!isStart(d) && !isDeadline(d) && <span className="relative">{d}</span>}
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Timeline({ onV2 }: { onV2: () => void }) {
  // Mobile drops the outer outline and shows both months side by side.
  return (
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
            <h2 style={{ fontSize: 18, fontWeight: 700, color: 'white', letterSpacing: '-0.02em', lineHeight: 1.2 }}>🎯 Goal Manager</h2>
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

            {/* 3 · Controls — mobile 2×2 grid, desktop single row */}
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-row sm:items-center sm:justify-between sm:gap-3">
              <div className="contents sm:flex sm:flex-wrap sm:gap-3">
                <NumberControl label="Add Checkpoints" value={5} onV2={openV2} />
                <NumberControl label="Add Tasks" value={5} onV2={openV2} />
              </div>
              <div className="contents sm:flex sm:flex-wrap sm:gap-3">
                <PurplePill onV2={openV2}>Set a Deadline</PurplePill>
                <PurplePill onV2={openV2}>🤖 Set Goals With AI Coach</PurplePill>
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

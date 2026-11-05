'use client'

// ── My Schedule › Today — dark mini calendar ────────────────────────────────
// Compact month calendar on XPadite's dark panel. The signature purple triangle collapses it to just the week that holds
// the selected date (more room for the agenda) and expands it again — the selected date never changes by toggling.
// Out-of-month days in the first/last row are real dates (dimmed), so a collapsed week that straddles two months is exact.

import { useMemo } from 'react'
import { isSameLocalDay, monthWeeks, monthYearLabel, startOfMonth, weekRowIndex } from './scheduleLogic'
import type { WeekStart } from './scheduleLogic'

export const MINI_ROW_PX = 36
const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S']   // Sunday-first; rotated when the week starts on Monday

interface Props {
  /** Month shown while expanded. */
  viewMonth: Date
  onViewMonthChange: (month: Date) => void
  selected: Date
  onSelect: (day: Date) => void
  today: Date
  /** Days that have at least one event (shown brighter). */
  hasEvents: (day: Date) => boolean
  expanded: boolean
  /** When provided, the triangle toggle is shown (phones). */
  onToggle?: () => void
  /** 0 = weeks start on Sunday (default), 1 = Monday. */
  weekStart?: WeekStart
}

export function ScheduleMiniCalendar({ viewMonth, onViewMonthChange, selected, onSelect, today, hasEvents, expanded, onToggle, weekStart = 0 }: Props) {
  // Collapsed: always the month of the selected date, scrolled to its week. Expanded: the month being browsed.
  const month = expanded ? startOfMonth(viewMonth) : startOfMonth(selected)
  const weeks = useMemo(() => monthWeeks(month, weekStart), [month, weekStart])
  const selRow = Math.max(0, weekRowIndex(month, selected, weekStart))
  const shownRows = expanded ? weeks.length : 1
  const offsetRows = expanded ? 0 : selRow

  function step(delta: number) {
    if (expanded) onViewMonthChange(new Date(month.getFullYear(), month.getMonth() + delta, 1))
    else onSelect(new Date(selected.getFullYear(), selected.getMonth(), selected.getDate() + delta * 7))   // collapsed arrows move by a week
  }

  const arrow = (dir: 'prev' | 'next') => (
    <button type="button" onClick={() => step(dir === 'prev' ? -1 : 1)} aria-label={expanded ? (dir === 'prev' ? 'Previous month' : 'Next month') : (dir === 'prev' ? 'Previous week' : 'Next week')}
      className="flex items-center justify-center" style={{ width: 28, height: 28, color: '#8b5cf6' }}>
      <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true">{dir === 'prev' ? <path d="M16 5v14L6 12Z" /> : <path d="M8 5v14l10-7Z" />}</svg>
    </button>
  )

  return (
    <div className="flex-shrink-0" style={{ background: '#1a1d2e', borderRadius: 14, padding: '8px 10px 6px', color: '#e5e7eb', border: '0.5px solid rgba(139,92,246,0.25)' }}>
      <div className="flex items-center justify-between" style={{ minHeight: 30 }}>
        <div className="flex items-center gap-1 mx-auto" style={{ marginLeft: onToggle ? 0 : 'auto' }}>
          {arrow('prev')}
          <span className="text-[13px] font-semibold text-center whitespace-nowrap" style={{ minWidth: 130 }} aria-live="polite">{monthYearLabel(month)}</span>
          {arrow('next')}
        </div>
        {onToggle && (
          <button type="button" onClick={onToggle} aria-expanded={expanded} aria-label={expanded ? 'Collapse calendar to one week' : 'Expand calendar to full month'}
            className="flex items-center justify-center flex-shrink-0" style={{ width: 30, height: 30, color: '#a78bfa' }}>
            <span aria-hidden="true" style={{ display: 'inline-block', fontSize: 11, lineHeight: 1, transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 220ms cubic-bezier(0.4,0,0.2,1)' }}>▶</span>
          </button>
        )}
      </div>

      <div className="grid grid-cols-7 text-center" style={{ marginTop: 2 }} aria-hidden="true">
        {[...DOW.slice(weekStart), ...DOW.slice(0, weekStart)].map((d, i) => <span key={i} className="text-[10.5px] font-semibold" style={{ color: '#6b7280', lineHeight: '20px' }}>{d}</span>)}
      </div>

      {/* The viewport is exactly N rows tall; the month grid slides inside it, so expand/collapse animates smoothly. */}
      <div data-testid="mini-cal-viewport" style={{ height: shownRows * MINI_ROW_PX, overflow: 'hidden', transition: 'height 240ms cubic-bezier(0.4,0,0.2,1)' }}>
        <div role="grid" aria-label={monthYearLabel(month)} style={{ transform: `translateY(${-offsetRows * MINI_ROW_PX}px)`, transition: 'transform 240ms cubic-bezier(0.4,0,0.2,1)' }}>
          {weeks.map((row, r) => (
            <div key={r} role="row" className="grid grid-cols-7" style={{ height: MINI_ROW_PX }}>
              {row.map(d => {
                const inMonth = d.getMonth() === month.getMonth()
                const isSel = isSameLocalDay(d, selected)
                const isToday = isSameLocalDay(d, today)
                const busy = hasEvents(d)
                const hidden = !expanded && r !== selRow
                return (
                  <button key={d.getTime()} type="button" role="gridcell" tabIndex={hidden ? -1 : 0} aria-selected={isSel} aria-hidden={hidden}
                    aria-label={d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) + (busy ? ', has events' : '')}
                    onClick={() => onSelect(new Date(d.getFullYear(), d.getMonth(), d.getDate()))}
                    className="flex items-center justify-center" style={{ height: MINI_ROW_PX }}>
                    <span className="flex items-center justify-center text-[13px]"
                      style={{
                        width: 30, height: 30, borderRadius: '50%',
                        background: isSel ? '#7c3aed' : 'transparent',
                        color: isSel ? '#fff' : !inMonth ? '#4b5563' : busy ? '#ffffff' : '#6b7280',
                        fontWeight: busy || isSel ? 700 : 400,
                        boxShadow: isToday && !isSel ? 'inset 0 0 0 1.5px #8b5cf6' : 'none',
                        opacity: !inMonth && !isSel ? 0.75 : 1,
                      }}>
                      {d.getDate()}
                    </span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

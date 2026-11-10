'use client'

// ── My Schedule — Month View grid + day list ────────────────────────────────────────────────────────────────────
// Presentation only. The events, filters, selection, Add/Edit/Delete and conflict rules all stay in MeetingsModal /
// MyScheduleView; this file draws a month of the SAME (already filtered) events and reports taps back to its owner.

import { useLayoutEffect, useRef, useState } from 'react'
import { clockLabel, isPastEvent, longDateLabel, timeRangeLabel } from './scheduleLogic'
import type { ScheduleEvent, WeekStart } from './scheduleLogic'
import { useSchedule } from './scheduleContext'
import { chipCapacity, multiDayPosition } from './scheduleMonth'
import type { MonthCell } from './scheduleMonth'
import { SheetFrame, useIsPhone, useSheetEscape, useSheetPhase } from './ScheduleSheet'
import { iconBtn } from './ScheduleParts'

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const MIN_ROW_PX = 64

/** Red flag for a deadline ("Set as Due Date") event — the same glyph and colour the week view uses on its cards. */
function DeadlineFlag({ size }: { size: number }) {
  return (
    <svg data-testid="month-deadline-flag" viewBox="0 0 24 24" width={size} height={size} fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true" className="flex-shrink-0" style={{ color: '#dc2626' }}>
      <path d="M5 21V4M5 4h11l-2 4 2 4H5" />
    </svg>
  )
}

/** "9:00 AM" → "9a", "2:30 PM" → "2:30p" (24-hour times are left alone) — keeps the title readable in a narrow chip. */
export function compactClock(label: string): string {
  return label.replace(/:00(?= ?[AP]M)/i, '').replace(/ ?AM$/i, 'a').replace(/ ?PM$/i, 'p')
}

function Chip({ ev, cell, phone, selected, now, onOpen }: { ev: ScheduleEvent; cell: MonthCell; phone: boolean; selected: boolean; now: number; onOpen: (ev: ScheduleEvent) => void }) {
  const { meta, fmt } = useSchedule()
  const cat = meta(ev.category)
  const pos = multiDayPosition(ev, cell.date)
  const past = isPastEvent(ev, now)
  const showTime = !phone && !pos.fromEarlier
  const marks = `${pos.fromEarlier ? '◂ ' : ''}${showTime ? compactClock(clockLabel(ev.startAt, fmt)) + ' ' : ''}`
  return (
    <button
      type="button"
      data-testid="month-chip" data-event-id={ev.id}
      onClick={e => { e.stopPropagation(); onOpen(ev) }}
      onDoubleClick={e => e.stopPropagation()}
      title={`${ev.title} · ${timeRangeLabel(ev.startAt, ev.endAt, fmt)}`}
      aria-label={`${ev.title}, ${timeRangeLabel(ev.startAt, ev.endAt, fmt)}${ev.isDeadline ? ', deadline' : ''}${ev.recurrence && ev.recurrence !== 'none' ? ', repeats ' + ev.recurrence : ''}${ev.isCancelled ? ', cancelled' : ''}`}
      aria-pressed={selected}
      className="xp-mo-chip w-full text-left flex items-center gap-0.5 min-w-0"
      style={{
        height: phone ? 14 : 18, padding: phone ? '0 2px' : '0 4px', background: cat.bg, color: cat.text,
        borderLeft: `${phone ? 2 : 3}px solid ${cat.edge}`,
        borderTopLeftRadius: pos.fromEarlier ? 0 : 4, borderBottomLeftRadius: pos.fromEarlier ? 0 : 4,
        borderTopRightRadius: pos.intoLater ? 0 : 4, borderBottomRightRadius: pos.intoLater ? 0 : 4,
        outline: selected ? '2px solid #7c3aed' : 'none', outlineOffset: 0,
        opacity: ev.isCancelled ? 0.6 : past ? 0.82 : 1, fontSize: phone ? 9 : 11, lineHeight: 1,
      }}
    >
      <span className="truncate font-semibold" data-past={past ? 'true' : undefined} style={{ textDecoration: ev.isCancelled || past ? 'line-through' : 'none', ...(past && !ev.isCancelled ? { textDecorationThickness: '1px' } : null) }}>
        {marks}{ev.title}
      </span>
      {ev.isDeadline && <DeadlineFlag size={phone ? 8 : 10} />}
      {!phone && ev.recurrence && ev.recurrence !== 'none' && <span aria-hidden="true" className="flex-shrink-0" style={{ opacity: 0.75 }}>↻</span>}
      {!phone && pos.intoLater && <span aria-hidden="true" className="flex-shrink-0" style={{ opacity: 0.75 }}>▸</span>}
    </button>
  )
}

export function MonthGrid({ weeks, weekStart, selectedDay, selectedId, now, onCell, onEvent, onMore, style }: {
  weeks: MonthCell[][]
  weekStart: WeekStart
  selectedDay: Date | null
  selectedId: string | null
  now: number
  onCell: (cell: MonthCell) => void
  onEvent: (ev: ScheduleEvent) => void
  onMore: (cell: MonthCell) => void
  style?: React.CSSProperties
}) {
  const phone = useIsPhone()
  const bodyRef = useRef<HTMLDivElement>(null)
  const [rowPx, setRowPx] = useState(MIN_ROW_PX)
  const rows = weeks.length

  useLayoutEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const measure = () => setRowPx(Math.max(MIN_ROW_PX, el.clientHeight / rows))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [rows])

  const chipH = phone ? 14 : 18
  const headH = phone ? 22 : 26
  const fits = (rowPx - headH - 3) / (chipH + 2)
  const names = Array.from({ length: 7 }, (_, i) => (weekStart + i) % 7)
  const selKey = selectedDay ? `${selectedDay.getFullYear()}-${selectedDay.getMonth()}-${selectedDay.getDate()}` : ''

  return (
    <div className="flex flex-col h-full min-h-0" role="grid" aria-label="Month calendar" data-testid="month-grid" style={style}>
      <style>{`
        .xp-mo-cell:focus-visible, .xp-mo-chip:focus-visible, .xp-mo-more:focus-visible { outline: 2px solid #7c3aed; outline-offset: -2px; }
        .xp-mo-cell { transition: background-color 120ms ease; }
        @media (hover: hover) { .xp-mo-cell:hover { background: rgba(124,58,237,0.06); } }
        @media (prefers-reduced-motion: reduce) { .xp-mo-cell { transition: none; } }
      `}</style>
      <div className="grid flex-shrink-0" role="row" style={{ gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', borderBottom: '1px solid var(--xp-bdr2)', background: 'var(--xp-card)' }}>
        {names.map((d, i) => (
          <div key={i} role="columnheader" aria-label={DAY_NAMES[d]} data-testid="month-weekday" className="text-center font-bold text-[10.5px] sm:text-[12px]" style={{ padding: '7px 0', color: 'var(--xp-txt2)' }}>
            <span className="min-[420px]:hidden">{DAY_INITIALS[d]}</span><span className="hidden min-[420px]:inline">{DAY_NAMES[d]}</span>
          </div>
        ))}
      </div>
      <div ref={bodyRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden" style={{ overscrollBehavior: 'contain' }} data-testid="month-body">
        <div className="grid" style={{ gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gridTemplateRows: `repeat(${rows}, minmax(${MIN_ROW_PX}px, 1fr))`, minHeight: '100%' }}>
          {weeks.flat().map((cell, idx) => {
            const { shown, more } = chipCapacity(cell.events.length, fits)
            const sel = selKey === `${cell.date.getFullYear()}-${cell.date.getMonth()}-${cell.date.getDate()}`
            const label = `${longDateLabel(cell.date.getTime())}${cell.isToday ? ', today' : ''}, ${cell.events.length === 0 ? 'no events' : cell.events.length + (cell.events.length === 1 ? ' event' : ' events')}`
            return (
              <div
                key={cell.key} role="gridcell" tabIndex={0} aria-label={label} aria-selected={sel}
                data-testid="month-cell" data-date={cell.key} data-in-month={cell.inMonth ? 'true' : 'false'} data-today={cell.isToday ? 'true' : 'false'} data-past={cell.isPast ? 'true' : 'false'} data-count={cell.events.length}
                onClick={() => onCell(cell)}
                onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); onCell(cell) } }}
                className="xp-mo-cell min-w-0 min-h-0 overflow-hidden flex flex-col cursor-pointer"
                style={{
                  padding: phone ? '2px 1px 1px' : '3px 4px 2px',
                  borderRight: idx % 7 === 6 ? 'none' : '0.5px solid var(--xp-bdr)', borderBottom: '0.5px solid var(--xp-bdr)',
                  background: sel ? 'rgba(124,58,237,0.10)' : cell.inMonth ? 'transparent' : 'var(--xp-bg3)',
                  boxShadow: sel ? 'inset 0 0 0 1.5px #7c3aed' : 'none',
                }}
              >
                {/* The date number is its own tap target (touch browsers snap a tap to the nearest button, so it must be one, or a tap on it lands on the chip below). */}
                <button type="button" tabIndex={-1} aria-hidden="true" data-testid="month-date" onClick={e => { e.stopPropagation(); onCell(cell) }} className="flex items-center justify-center sm:justify-start flex-shrink-0 w-full" style={{ height: headH - 4 }}>
                  <span
                    className="inline-flex items-center justify-center font-semibold"
                    style={{
                      minWidth: phone ? 18 : 22, height: phone ? 18 : 22, padding: '0 3px', borderRadius: 11, fontSize: phone ? 10.5 : 12,
                      background: cell.isToday ? '#7c3aed' : 'transparent', color: cell.isToday ? '#ffffff' : cell.inMonth ? 'var(--xp-txt)' : 'var(--xp-txt3)',
                      opacity: cell.isPast ? (cell.inMonth ? 0.66 : 0.5) : cell.inMonth || cell.isToday ? 1 : 0.7,
                    }}
                  >{cell.date.getDate()}</span>
                </button>
                <div className="flex flex-col min-h-0" style={{ gap: 2, opacity: cell.isPast ? (cell.inMonth ? 0.72 : 0.5) : cell.inMonth ? 1 : 0.6 }}>
                  {cell.events.slice(0, shown).map(ev => (
                    <Chip key={ev.id} ev={ev} cell={cell} phone={phone} selected={selectedId === ev.id} now={now} onOpen={onEvent} />
                  ))}
                  {more > 0 && (
                    <button
                      type="button" data-testid="month-more" onClick={e => { e.stopPropagation(); onMore(cell) }} onDoubleClick={e => e.stopPropagation()}
                      aria-label={`${more} more ${more === 1 ? 'event' : 'events'} on ${longDateLabel(cell.date.getTime())}. Open the day list`}
                      className="xp-mo-more text-left font-semibold"
                      style={{ height: chipH, padding: phone ? '0 2px' : '0 4px', fontSize: phone ? 9 : 11, lineHeight: 1, color: '#7c3aed', borderRadius: 4 }}
                    >+{more}{phone ? '' : ' more'}</button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/** The expanded list of one date's events (the "+N more" / tapped-date target). Uses the shared bottom-sheet / dialog frame. */
export function MonthDaySheet({ day, events, now, open, onClose, onPick, onAdd }: {
  day: Date | null; events: ScheduleEvent[]; now: number; open: boolean; onClose: () => void; onPick: (ev: ScheduleEvent) => void; onAdd: (day: Date) => void
}) {
  const phone = useIsPhone()
  const { meta, fmt } = useSchedule()
  const { mounted, visible } = useSheetPhase(open, phone)
  useSheetEscape(open, onClose)
  // keep showing the last date while the sheet slides out (the owner clears `day` on close)
  const [lastDay, setLastDay] = useState<Date | null>(null)
  if (day && day !== lastDay) setLastDay(day)
  const shownDay = day ?? lastDay
  if (!mounted || !shownDay) return null
  return (
    <SheetFrame phone={phone} visible={visible} variant="sheet" label={`Events on ${longDateLabel(shownDay.getTime())}`} onClose={onClose} desktopClass="sm:max-w-[420px]">
      <div className="flex items-center justify-between gap-2 flex-shrink-0" style={{ padding: '8px 16px 8px' }}>
        <div className="min-w-0">
          <p className="text-[14px] font-bold truncate" style={{ color: 'var(--xp-txt)' }} data-testid="day-sheet-title">{longDateLabel(shownDay.getTime())}</p>
          <p className="text-[11px]" style={{ color: 'var(--xp-txt3)' }}>{events.length === 0 ? 'No events' : `${events.length} event${events.length === 1 ? '' : 's'}`}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close day list" style={{ ...iconBtn, width: 28, height: 28 }}>
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" strokeLinecap="round" /><line x1="6" y1="6" x2="18" y2="18" strokeLinecap="round" /></svg>
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1.5" style={{ padding: '0 16px 10px', overscrollBehavior: 'contain' }} data-testid="day-sheet-list">
        {events.length === 0 && <p className="text-[12.5px] py-3 text-center" style={{ color: 'var(--xp-txt3)' }}>Nothing scheduled on this day.</p>}
        {events.map(ev => {
          const cat = meta(ev.category)
          return (
            <button key={ev.id} type="button" data-testid="day-sheet-row" data-event-id={ev.id} onClick={() => onPick(ev)} className="w-full text-left"
              style={{ padding: '8px 10px', borderRadius: 10, background: 'var(--xp-bg3)', borderLeft: `4px solid ${cat.edge}` }}>
              <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--xp-txt)', textDecoration: ev.isCancelled || isPastEvent(ev, now) ? 'line-through' : 'none', ...(isPastEvent(ev, now) && !ev.isCancelled ? { textDecorationThickness: '1px' } : null) }}>{ev.title}</p>
              <p className="text-[11.5px] truncate" style={{ color: 'var(--xp-txt3)' }}>
                {timeRangeLabel(ev.startAt, ev.endAt, fmt)} · {cat.label}{ev.isDeadline ? ' · Deadline' : ''}{ev.recurrence && ev.recurrence !== 'none' ? ` · ↻ ${ev.recurrence}` : ''}{ev.sourceLabel ? ` · ${ev.sourceLabel}` : ''}
              </p>
            </button>
          )
        })}
      </div>
      <div className="flex-shrink-0" style={{ padding: '4px 16px 14px' }}>
        <button type="button" onClick={() => onAdd(shownDay)} data-testid="day-sheet-add" className="w-full text-[13px] font-semibold text-white" style={{ padding: '10px 12px', borderRadius: 10, background: '#7c3aed' }}>
          + Add event on this day
        </button>
      </div>
    </SheetFrame>
  )
}

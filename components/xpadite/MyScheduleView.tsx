'use client'

// ── My Schedule — weekly scheduler ──────────────────────────────────────────
// Body of the "My Schedule" tab inside MeetingsModal. Renders a seven-column, 24-hour weekly grid plus (desktop/large
// tablet) a right-hand Upcoming / Selected Event / Color Categories sidebar that fills the grid's height. Smaller screens
// get the same grid with the selected event in a bottom sheet. XPadite events + read-only synced meetings only — nothing
// here is persisted; the Add/Edit/Delete dialogs and every rule (conflicts, moves) live outside this file
// (ScheduleParts, scheduleEngine) so Today and My Schedule share one implementation.
//
// Interactions: tap an empty slot → "+ Add" (tap/click it, or double-click/double-tap the slot, to open the Add form);
// drag an XPadite event (mouse drag, or long-press on touch) to reschedule it — validated against every other event.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  addDays, clockLabel, filterScheduleEvents, hourLabel, isSameLocalDay, layoutDayEvents, monthYearLabel,
  monthYearShort, shiftMonth, shortDayLabel, splitFilter, startOfDay, timeRangeLabel, weekDays, weekRangeLabel, weekRangeShort,
} from './scheduleLogic'
import type { CombinedFilter, ScheduleCategoryId, ScheduleEvent } from './scheduleLogic'
import {
  SLOT_MINUTES, canDuplicate, dragBlockReason, isDoubleTap, minutesFromOffset, planMove, snapMinutes,
} from './scheduleEngine'
import type { MovePlan, TapRecord } from './scheduleEngine'
import { useSchedule } from './scheduleContext'
import { isFilterActive } from './scheduleEngine'
import type { FilterState } from './scheduleEngine'
import { ActiveSearchChip, FilterIconButton, FilterSheet, SearchPanel, SlideDown, useIsPhone } from './ScheduleMobile'
import { MonthDaySheet, MonthGrid } from './ScheduleMonthGrid'
import { buildMonthGrid, monthDayEvents } from './scheduleMonth'
import type { MonthCell } from './scheduleMonth'
import { Chevron, EmptyDetails, EventDetails, EventSheet, FilterSelect, LAYER_ATTR, iconBtn } from './ScheduleParts'

// ── Layout constants ────────────────────────────────────────────────────────

const HOUR_PX = 56
const INITIAL_SCROLL_HOUR = 5
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
// The time column is narrower on phones (--xp-sch-tc, see the <style> block) so the seven day columns get the room.
// Phone navigation: label slots are reserved at the widest label ("Nov 30–Dec 6" / "Sep 2026"), so the boxes never resize or shift between dates.
const NAV_WEEK_EM = 6.6
const NAV_MONTH_EM = 4.7
const NAV_MONTH_FULL_EM = 8.6   // Month View shows the full month name in the slot the week range uses
const GRID_COLS = 'var(--xp-sch-tc) repeat(7, minmax(0, 1fr))'
const DRAG_THRESHOLD_PX = 5        // mouse: movement before a press becomes a drag
const LONG_PRESS_MS = 450          // touch: hold this long (without moving) to pick an event up
const LONG_PRESS_SLOP_PX = 10      // touch: moving more than this first means "scroll", so the pick-up is cancelled

// ── Small pieces ────────────────────────────────────────────────────────────

function NavGroup({ label, shortLabel, onPrev, onNext, prevLabel, nextLabel, minWidth, compact, labelEm }: { label: string; shortLabel?: string; onPrev: () => void; onNext: () => void; prevLabel: string; nextLabel: string; minWidth: number; compact?: boolean; labelEm?: number }) {
  if (compact) {
    // Phones: the same rounded-square arrows, tightened so month, week, Today and Filter share one row down to 320px.
    return (
      <div className="flex items-center justify-between gap-px min-[361px]:gap-1 p-px min-[361px]:p-[2px] flex-shrink-0" data-testid="nav-group" style={{ borderRadius: 10, background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr)' }}>
        <button type="button" onClick={onPrev} aria-label={prevLabel} className="xp-nav-sq" style={{ ...iconBtn, width: undefined, height: undefined, background: 'var(--xp-card)' }}><Chevron dir="left" /></button>
        <span className="text-[11px] min-[361px]:text-[12px] font-semibold text-center whitespace-nowrap overflow-hidden" style={{ color: 'var(--xp-txt)', minWidth, ...(labelEm ? { width: `${labelEm}em`, flexShrink: 0 } : null) }} aria-live="polite" aria-label={label} data-testid="nav-label">{shortLabel ?? label}</span>
        <button type="button" onClick={onNext} aria-label={nextLabel} className="xp-nav-sq" style={{ ...iconBtn, width: undefined, height: undefined, background: 'var(--xp-card)' }}><Chevron dir="right" /></button>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-1 sm:gap-1.5" style={{ padding: 3, borderRadius: 10, background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr)' }}>
      <button type="button" onClick={onPrev} aria-label={prevLabel} style={{ ...iconBtn, width: 26, height: 26, background: 'var(--xp-card)' }}><Chevron dir="left" /></button>
      <span className="text-[12px] sm:text-[12.5px] font-semibold text-center whitespace-nowrap" style={{ color: 'var(--xp-txt)', minWidth }} aria-live="polite" aria-label={label}>
        {shortLabel ? <><span className="sm:hidden">{shortLabel}</span><span className="hidden sm:inline">{label}</span></> : label}
      </span>
      <button type="button" onClick={onNext} aria-label={nextLabel} style={{ ...iconBtn, width: 26, height: 26, background: 'var(--xp-card)' }}><Chevron dir="right" /></button>
    </div>
  )
}

function CategoryChecklist({ hidden, onToggle }: { hidden: ScheduleCategoryId[]; onToggle: (id: ScheduleCategoryId) => void }) {
  const { categories } = useSchedule()
  return (
    <ul className="flex flex-col gap-2" role="group" aria-label="Show categories">
      {categories.map(c => {
        const on = !hidden.includes(c.id)
        return (
          <li key={c.id}>
            <label className="flex items-center gap-2.5 cursor-pointer text-[12.5px]" style={{ color: 'var(--xp-txt)' }}>
              <input type="checkbox" checked={on} onChange={() => onToggle(c.id)} className="sr-only peer" />
              <span aria-hidden="true" className="flex items-center justify-center flex-shrink-0" style={{ width: 17, height: 17, borderRadius: 5, background: on ? '#7c3aed' : 'transparent', border: `1.5px solid ${on ? '#7c3aed' : 'var(--xp-bdr2)'}` }}>
                {on && <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="white" strokeWidth="3.4"><polyline points="5 12.5 10 17.5 19 7.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
              </span>
              <span aria-hidden="true" className="flex-shrink-0" style={{ width: 28, height: 12, borderRadius: 6, background: c.bg, border: `1px solid ${c.edge}`, opacity: on ? 1 : 0.45 }} />
              <span className="min-w-0 truncate" style={{ opacity: on ? 1 : 0.6 }}>{c.label}</span>
            </label>
          </li>
        )
      })}
    </ul>
  )
}

/** Sidebar card. `grow` > 0 gives it a proportional share of the sidebar's height (never below `minHeight`); its body scrolls on its own when the content is longer. */
function Card({ title, right, children, grow = 0, minHeight = 0, maxHeight, testId }: { title: string; right?: React.ReactNode; children: React.ReactNode; grow?: number; minHeight?: number; maxHeight?: string; testId?: string }) {
  return (
    <section data-testid={testId} className="flex flex-col min-h-0" style={{ flex: grow > 0 ? `${grow} 1 0%` : '0 1 auto', minHeight, maxHeight, background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)', borderRadius: 14, padding: '12px 13px' }}>
      <div className="flex items-center justify-between gap-2 mb-2.5 flex-shrink-0">
        <h3 className="text-[13.5px] font-bold" style={{ color: 'var(--xp-txt)' }}>{title}</h3>
        {right}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col" style={{ overscrollBehavior: 'contain' }}>{children}</div>
    </section>
  )
}

// ── Weekly grid ─────────────────────────────────────────────────────────────

function EventBlock({ p, dayStart, selected, dragging, onSelect, onPress }: {
  p: ReturnType<typeof layoutDayEvents>[number]
  dayStart: number
  selected: boolean
  dragging: boolean
  onSelect: () => void
  onPress: (e: React.PointerEvent<HTMLButtonElement>, startMin: number, dayStart: number) => void
}) {
  const { meta, fmt } = useSchedule()
  const { event: ev } = p
  const cat = meta(ev.category)
  const movable = !dragBlockReason(ev)
  const heightPx = Math.max(((p.endMin - p.startMin) / 60) * HOUR_PX - 2, 14)
  const showTime = heightPx >= 40 && p.lanes <= 2
  const showPlace = heightPx >= 72 && p.lanes === 1 && !!ev.location
  return (
    <button
      type="button"
      data-event-id={ev.id}
      data-movable={movable ? 'true' : 'false'}
      onClick={e => { e.stopPropagation(); onSelect() }}
      onPointerDown={e => onPress(e, p.startMin, dayStart)}
      onDragStart={e => e.preventDefault()}   // a text selection elsewhere must not turn the press into the browser's own drag-and-drop
      onContextMenu={e => { if ((e.nativeEvent as PointerEvent).pointerType === 'touch') e.preventDefault() }}
      aria-label={`${ev.title}, ${timeRangeLabel(ev.startAt, ev.endAt, fmt)}${ev.isCancelled ? ', cancelled' : ''}`}
      aria-pressed={selected}
      className={`xp-sch-ev${p.lanes > 1 ? ' xp-sch-ev-narrow' : ''} absolute text-left overflow-hidden`}
      style={{
        top: (p.startMin / 60) * HOUR_PX + 1,
        height: heightPx,
        left: `calc(${(p.lane / p.lanes) * 100}% + 1px)`,
        width: `calc(${100 / p.lanes}% - 2px)`,
        background: cat.bg, color: cat.text,
        borderLeft: `3px solid ${cat.edge}`, borderRadius: 6,
        outline: selected ? '2px solid #7c3aed' : 'none', outlineOffset: 0,
        boxShadow: selected ? '0 3px 10px rgba(124,58,237,0.35)' : '0 1px 2px rgba(0,0,0,0.08)',
        zIndex: selected ? 3 : 2,
        opacity: dragging ? 0.35 : ev.isCancelled ? 0.6 : 1,
        cursor: movable ? 'grab' : 'pointer',
      }}
    >
      <span className="xp-sch-ev-title block font-bold" style={{ textDecoration: ev.isCancelled ? 'line-through' : 'none' }}>{ev.title}</span>
      {ev.readOnly && heightPx >= 30 && (
        <svg data-testid="readonly-lock" viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="2.6" aria-hidden="true" className="absolute" style={{ top: 3, right: 3, opacity: 0.7 }}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" strokeLinecap="round" /></svg>
      )}
      {showTime && <span className="xp-sch-ev-sub block truncate">{timeRangeLabel(ev.startAt, ev.endAt, fmt)}</span>}
      {showPlace && <span className="xp-sch-ev-sub hidden sm:block truncate">📍 {ev.location}</span>}
    </button>
  )
}

interface DragSession {
  ev: ScheduleEvent
  pointerId: number
  touch: boolean
  startX: number; startY: number
  x: number; y: number
  /** Minutes between the event's top edge and where it was grabbed. */
  grabMin: number
  active: boolean
  timer: number | null
  raf: number | null
  plan: MovePlan | null
  finish: (commit: boolean) => void
}

interface DragView { id: string; dayIdx: number | null; startMin: number; plan: MovePlan }

// ── Root ────────────────────────────────────────────────────────────────────

export interface MyScheduleViewProps {
  /** Everything on the calendar: events made in XPadite plus read-only synced meetings (already converted). */
  events: ScheduleEvent[]
  /** The single combined dropdown (All / a category / Google Calendar / Outlook) — owned by the modal so Today uses it too. */
  filter: CombinedFilter
  onFilterChange: (v: CombinedFilter) => void
  /** Categories switched off with the legend checkboxes. */
  hidden: ScheduleCategoryId[]
  onToggleCategory: (id: ScheduleCategoryId) => void
  now: number
  /** Set by the modal after an event is added/edited/moved so this view jumps to it. */
  focus: { id: string; at: number; nonce: number; quiet?: boolean } | null
  onEdit: (ev: ScheduleEvent) => void
  onDelete: (ev: ScheduleEvent) => void
  onDuplicate: (ev: ScheduleEvent) => void
  /** Tells the modal which day its add button should default to. */
  onActiveDayChange: (day: Date) => void
  /** Reports which event is selected (the modal's menu needs it for Duplicate). */
  onSelectionChange: (id: string | null) => void
  /** Open the Add form for an empty slot (the modal fills in the default duration and checks conflicts on save). */
  onAddAt: (day: Date, startMin: number) => void
  /** A validated drop. The modal re-checks the move and applies it. */
  onMove: (ev: ScheduleEvent, startAt: number) => void
  /** Short user-facing message (invalid drop, read-only event…). */
  onNotice: (message: string) => void
  /** The search text (owned by the modal so the phone menu, the phone search bar and the tablet/desktop field share one query). */
  query: string
  onQueryChange: (q: string) => void
  /** Phone only: which slide-down panel is open under the toolbar's second row. `nonce` changes each time one is opened. */
  panel: { kind: 'search' | 'filter' | null; nonce: number }
  onPanelChange: (kind: 'search' | 'filter' | null) => void
  /** Calendars switched off in the phone Filter sheet ('xpadite' | 'google' | 'microsoft'). */
  hiddenSources: string[]
  onApplyFilter: (s: FilterState) => void
  /** 'week' (default) = the weekly time grid; 'month' = the Month View. Both share this component's date, selection and the modal's filters. */
  mode?: 'week' | 'month'
  /** The date being browsed and the tapped date. Owned by the modal so they survive switching to the Today tab and back. */
  anchor: Date
  onAnchorChange: React.Dispatch<React.SetStateAction<Date>>
  selectedDay: Date | null
  onSelectedDayChange: React.Dispatch<React.SetStateAction<Date | null>>
}

export function MyScheduleView({ events, filter, onFilterChange, hidden, onToggleCategory, now, focus, onEdit, onDelete, onDuplicate, onActiveDayChange, onSelectionChange, onAddAt, onMove, onNotice, query, onQueryChange, panel, onPanelChange, hiddenSources, onApplyFilter, mode = 'week', anchor, onAnchorChange: setAnchor, selectedDay, onSelectedDayChange: setSelectedDay }: MyScheduleViewProps) {
  const { categories, prefs, fmt } = useSchedule()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const phone = useIsPhone()
  const [filterOpen, setFilterOpen] = useState(false)
  const [edges, setEdges] = useState({ up: false, down: true })
  const [seenFocus, setSeenFocus] = useState(focus?.nonce ?? 0)
  const [slot, setSlot] = useState<{ day: number; min: number } | null>(null)
  // The details bottom sheet (below lg) opens when an event is tapped — not after a drag-drop, so the result stays visible.
  const [sheetOpen, setSheetOpen] = useState(false)
  const [drag, setDrag] = useState<DragView | null>(null)
  // Month View: the date whose expanded day list is open (null = closed).
  const [daySheet, setDaySheet] = useState<Date | null>(null)
  const month = mode === 'month'

  // Jump to an event the modal just added/edited (adjusting state during render — no effect needed).
  if (focus && focus.nonce !== seenFocus) {
    setSeenFocus(focus.nonce)
    setSelectedId(focus.id)
    setSheetOpen(!focus.quiet)
    setAnchor(startOfDay(new Date(focus.at)))
    setSelectedDay(startOfDay(new Date(focus.at)))
    setSlot(null)
  }

  const scrollerRef = useRef<HTMLDivElement>(null)
  const phoneToolbarRef = useRef<HTMLDivElement>(null)
  // Phones: the Filter sheet covers only what is below the toolbar (header + both rows stay clear), so it needs the toolbar's bottom edge.
  const [sheetTop, setSheetTop] = useState(0)
  const bodyRef = useRef<HTMLDivElement>(null)
  const timeColRef = useRef<HTMLDivElement>(null)
  const filterRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragSession | null>(null)
  const suppressClickRef = useRef(false)
  const lastTapRef = useRef<TapRecord | null>(null)

  const days = useMemo(() => weekDays(anchor, prefs.weekStart), [anchor, prefs.weekStart])
  const parts = splitFilter(filter)
  const visible = useMemo(
    () => filterScheduleEvents(events, { query, category: parts.category, source: parts.source, hidden, hiddenSources, categories }),
    [events, query, parts.category, parts.source, hidden, hiddenSources, categories],
  )
  const layouts = useMemo(() => days.map(d => layoutDayEvents(visible, d)), [days, visible])
  const selected = useMemo(() => events.find(e => e.id === selectedId) ?? null, [events, selectedId])
  const upcoming = useMemo(
    () => visible.filter(e => !e.isCancelled && e.endAt >= now).sort((a, b) => a.startAt - b.startAt),
    [visible, now],
  )
  const today = new Date(now)
  const todayIdx = days.findIndex(d => isSameLocalDay(d, today))
  const nowMin = today.getHours() * 60 + today.getMinutes()

  // The modal's single add button defaults to the day the user tapped, else today if it's in view, else the first day shown.
  const monthWeeksGrid = useMemo(() => buildMonthGrid(month ? visible : [], anchor, new Date(now), prefs.weekStart), [month, visible, anchor, now, prefs.weekStart])
  const addPool = month ? monthWeeksGrid.flat().filter(c => c.inMonth).map(c => c.date) : days
  const defaultAddDay = selectedDay && addPool.some(d => isSameLocalDay(d, selectedDay))
    ? selectedDay
    : (addPool.find(d => isSameLocalDay(d, today)) ?? addPool[0])
  const defaultAddKey = defaultAddDay.getTime()
  useEffect(() => { onActiveDayChange(new Date(defaultAddKey)) }, [defaultAddKey, onActiveDayChange])
  useEffect(() => { onSelectionChange(selectedId) }, [selectedId, onSelectionChange])

  // Open scrolled to 5 AM (midnight is one scroll up; the rest of the day is below).
  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    el.scrollTop = INITIAL_SCROLL_HOUR * HOUR_PX
    updateEdges()
  }, [mode])

  function updateEdges() {
    const el = scrollerRef.current
    if (!el) return
    const up = el.scrollTop > 6
    const down = el.scrollTop + el.clientHeight < el.scrollHeight - 6
    setEdges(prev => (prev.up === up && prev.down === down ? prev : { up, down }))
  }

  useEffect(() => {
    if (!filterOpen) return
    function onDown(e: MouseEvent) { if (filterRef.current && !filterRef.current.contains(e.target as Node)) setFilterOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [filterOpen])

  useEffect(() => {
    const el = phoneToolbarRef.current
    if (!el) return
    const measure = () => setSheetTop(el.offsetTop + el.offsetHeight)
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [phone])

  // The latest props for the window-level drag listeners (they outlive a render).
  const latest = useRef({ events, days, fmt, onMove, onNotice })
  useEffect(() => { latest.current = { events, days, fmt, onMove, onNotice } })

  // Once a touch drag has begun the page must not scroll: a non-passive touchmove that cancels itself while dragging.
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    function block(e: TouchEvent) { if (dragRef.current?.active && e.cancelable) e.preventDefault() }
    el.addEventListener('touchmove', block, { passive: false })
    return () => el.removeEventListener('touchmove', block)
  }, [mode])

  function goToDate(d: Date) { setAnchor(startOfDay(d)) }

  function selectEvent(ev: ScheduleEvent) {
    if (suppressClickRef.current) return
    setSelectedId(ev.id)
    setSheetOpen(true)
    setSelectedDay(startOfDay(new Date(ev.startAt)))
    setSlot(null)
  }

  // ── Month View: tapping a date / "+N more" opens the day list; an empty date on tablet/desktop opens the Add form directly ──
  function onMonthCell(cell: MonthCell) {
    setSelectedDay(cell.date)
    setSlot(null)
    if (phone || cell.events.length > 0) setDaySheet(cell.date)
    else onAddAt(cell.date, 9 * 60)
  }
  function onMonthMore(cell: MonthCell) { setSelectedDay(cell.date); setDaySheet(cell.date) }
  function onMonthEvent(ev: ScheduleEvent) { setDaySheet(null); selectEvent(ev) }

  // ── Empty slot: tap → highlight + "+ Add"; second tap on it (or double-click) → Add form ──

  function slotFromEvent(e: React.MouseEvent<HTMLElement>): number {
    const top = e.currentTarget.getBoundingClientRect().top
    return minutesFromOffset(e.clientY - top, HOUR_PX, SLOT_MINUTES)
  }

  function onColumnClick(e: React.MouseEvent<HTMLElement>, d: Date) {
    if (suppressClickRef.current) return
    const min = slotFromEvent(e)
    const key = `${d.getTime()}:${min}`
    if (isDoubleTap(lastTapRef.current, key, Date.now())) {
      lastTapRef.current = null
      setSlot(null)
      onAddAt(d, min)
      return
    }
    lastTapRef.current = { key, at: Date.now() }
    setSlot({ day: d.getTime(), min })
  }

  function onColumnKey(e: React.KeyboardEvent<HTMLElement>, d: Date) {
    if (e.target !== e.currentTarget) return
    const cur = slot && slot.day === d.getTime() ? slot.min : null
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const base = cur ?? (e.key === 'ArrowDown' ? 9 * 60 - SLOT_MINUTES : 9 * 60 + SLOT_MINUTES)
      const min = Math.min(Math.max(base + (e.key === 'ArrowDown' ? SLOT_MINUTES : -SLOT_MINUTES), 0), 24 * 60 - SLOT_MINUTES)
      setSlot({ day: d.getTime(), min })
      const sc = scrollerRef.current
      if (sc) {
        const y = (min / 60) * HOUR_PX
        if (y < sc.scrollTop) sc.scrollTop = Math.max(0, y - 8)
        else if (y + 28 > sc.scrollTop + sc.clientHeight - 56) sc.scrollTop = y + 28 - sc.clientHeight + 64
      }
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (cur === null) setSlot({ day: d.getTime(), min: 9 * 60 })
      else { setSlot(null); onAddAt(d, cur) }
    }
  }

  // ── Drag & drop ──

  function updateTarget(s: DragSession) {
    const body = bodyRef.current, tc = timeColRef.current, sc = scrollerRef.current
    if (!body || !tc || !sc) return
    const { days: dys, events: evs, fmt: f } = latest.current
    const r = body.getBoundingClientRect(), sr = sc.getBoundingClientRect()
    const colsLeft = r.left + tc.offsetWidth
    const colW = (r.width - tc.offsetWidth) / 7
    const idx = Math.floor((s.x - colsLeft) / colW)
    const inside = idx >= 0 && idx <= 6 && s.y >= sr.top && s.y <= sr.bottom
    const raw = ((s.y - r.top) / HOUR_PX) * 60 - s.grabMin
    const plan: MovePlan = inside
      ? planMove(s.ev, dys[idx], raw, evs, f)
      : { ok: false, startAt: s.ev.startAt, endAt: s.ev.endAt, block: 'range', conflicts: [], message: 'Drop the event inside the calendar.' }
    s.plan = plan
    setDrag({ id: s.ev.id, dayIdx: inside ? idx : null, startMin: snapMinutes(raw), plan })
  }

  function startDragPress(e: React.PointerEvent<HTMLButtonElement>, startMin: number, dayStart: number) {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if (dragRef.current) return
    const body = bodyRef.current
    if (!body) return
    const evId = e.currentTarget.dataset.eventId
    const ev = events.find(x => x.id === evId)
    if (!ev) return
    const evTopMin = ev.startAt >= dayStart ? startMin : (ev.startAt - dayStart) / 60_000   // overnight events: this slice isn't the start
    const s: DragSession = {
      ev, pointerId: e.pointerId, touch: e.pointerType !== 'mouse',
      startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY,
      grabMin: ((e.clientY - body.getBoundingClientRect().top) / HOUR_PX) * 60 - evTopMin,
      active: false, timer: null, raf: null, plan: null, finish: () => {},
    }

    const activate = () => {
      const blocked = dragBlockReason(s.ev)
      if (blocked) { latest.current.onNotice(blocked.message); s.finish(false); return }
      s.active = true
      if (s.touch && typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(12) } catch { /* optional */ } }
      updateTarget(s)
      const loop = () => {            // scroll the grid while the pointer rests near its top/bottom edge
        const sc = scrollerRef.current
        if (!sc || !s.active) return
        const sr = sc.getBoundingClientRect()
        const topEdge = sr.top + 84, bottomEdge = sr.bottom - 34
        const dy = s.y < topEdge ? -Math.min(16, (topEdge - s.y) / 4 + 2) : s.y > bottomEdge ? Math.min(16, (s.y - bottomEdge) / 4 + 2) : 0
        if (dy !== 0) { sc.scrollTop += dy; updateTarget(s) }
        s.raf = requestAnimationFrame(loop)
      }
      s.raf = requestAnimationFrame(loop)
    }

    const onMoveEvt = (pe: PointerEvent) => {
      if (pe.pointerId !== s.pointerId) return
      s.x = pe.clientX; s.y = pe.clientY
      if (!s.active) {
        const dist = Math.hypot(s.x - s.startX, s.y - s.startY)
        if (s.touch) { if (dist > LONG_PRESS_SLOP_PX) s.finish(false) }          // the finger moved first → ordinary scroll
        else if (dist > DRAG_THRESHOLD_PX) activate()
        return
      }
      updateTarget(s)
    }
    const onUp = (pe: PointerEvent) => { if (pe.pointerId === s.pointerId) s.finish(true) }
    const onCancel = (pe: PointerEvent) => { if (pe.pointerId === s.pointerId) s.finish(false) }
    const onKey = (ke: KeyboardEvent) => { if (ke.key === 'Escape') s.finish(false) }

    s.finish = (commit: boolean) => {
      window.removeEventListener('pointermove', onMoveEvt)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('keydown', onKey)
      if (s.timer !== null) window.clearTimeout(s.timer)
      if (s.raf !== null) cancelAnimationFrame(s.raf)
      const wasActive = s.active
      s.active = false
      dragRef.current = null
      setDrag(null)
      if (!wasActive) return
      suppressClickRef.current = true
      window.setTimeout(() => { suppressClickRef.current = false }, 80)
      if (commit && s.plan) {
        if (s.plan.ok) latest.current.onMove(s.ev, s.plan.startAt)
        else if (s.plan.message) latest.current.onNotice(s.plan.message)
      }
    }

    dragRef.current = s
    window.addEventListener('pointermove', onMoveEvt)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('keydown', onKey)
    if (s.touch) s.timer = window.setTimeout(() => { s.timer = null; if (dragRef.current === s && !s.active) activate() }, LONG_PRESS_MS)
  }

  const dragEv = drag ? events.find(e => e.id === drag.id) ?? null : null
  const dragDur = dragEv ? dragEv.endAt - dragEv.startAt : 0

  return (
    <>
      <style>{`
        .xp-sch-root { --xp-sch-tc: 36px; }
        .xp-sch-ev { padding: 2px 3px; line-height: 1.12; cursor: pointer; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; touch-action: manipulation; }
        .xp-sch-ev-title { font-size: 9px; overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 4; overflow-wrap: break-word; }
        .xp-sch-ev-sub { font-size: 8px; opacity: .82; margin-top: 1px; }
        .xp-nav-sq { width: 22px; height: 28px; position: relative; flex-shrink: 0; }
        .xp-nav-sq::after { content: ''; position: absolute; inset: -7px -2px; }   /* tap area ≈ 26×42 */
        @media (min-width: 361px) { .xp-nav-sq { width: 28px; height: 30px; } }
        .xp-sch-col { touch-action: manipulation; user-select: none; -webkit-user-select: none; }
        .xp-sch-col:focus-visible { outline: 2px solid #7c3aed; outline-offset: -2px; }
        @media (min-width: 640px) {
          .xp-sch-root { --xp-sch-tc: 46px; }
          .xp-sch-ev { padding: 4px 6px; }
          .xp-sch-ev-title { font-size: 11.5px; -webkit-line-clamp: 3; }
          .xp-sch-ev-sub { font-size: 10px; }
          .xp-sch-ev-narrow { padding: 3px 4px; }
          .xp-sch-ev-narrow .xp-sch-ev-title { font-size: 10.5px; }
        }
        .xp-sch-slide { display: grid; grid-template-rows: 0fr; transition: grid-template-rows 220ms cubic-bezier(0.4, 0, 0.2, 1), opacity 180ms ease; opacity: 0; }
        .xp-sch-slide[data-open='true'] { grid-template-rows: 1fr; opacity: 1; }
        .xp-sch-slide-inner { min-height: 0; overflow: hidden; }
        .xp-sch-slide input[type='search']::-webkit-search-cancel-button { -webkit-appearance: none; appearance: none; display: none; }   /* our own clear button is the only ✕ */
        @media (prefers-reduced-motion: reduce) { .xp-sch-slide { transition: none; } .xp-sch-sheet { animation: none; } }
        @keyframes xp-sch-sheet-in { from { transform: translateY(24px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
        .xp-sch-sheet { animation: xp-sch-sheet-in 170ms ease-out; }
        .xp-sch-day:focus-visible, .xp-sch-ev:focus-visible { outline: 2px solid #7c3aed; outline-offset: 1px; }
      `}</style>

      <div className="xp-sch-root relative flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className="flex-1 min-h-0 flex">
          {/* ── Main column ── */}
          <div className="flex-1 min-w-0 min-h-0 flex flex-col pl-2 sm:pl-4 pr-2 sm:pr-4 lg:pr-3">
            {/* Phones: two compact rows; Search and Filter slide down from under row two. Tablet/desktop keep the toolbar below. */}
            {phone ? (
              <div ref={phoneToolbarRef}>
                <div className="flex items-center justify-between gap-0.5 min-[361px]:gap-1 pb-2 flex-shrink-0" data-testid="toolbar-row2">
                  <NavGroup compact labelEm={month ? NAV_MONTH_FULL_EM : NAV_MONTH_EM} label={monthYearLabel(anchor)} shortLabel={month ? undefined : monthYearShort(anchor)} minWidth={0} prevLabel="Previous month" nextLabel="Next month"
                    onPrev={() => setAnchor(a => shiftMonth(a, -1))} onNext={() => setAnchor(a => shiftMonth(a, 1))} />
                  {!month && <NavGroup compact labelEm={NAV_WEEK_EM} label={weekRangeLabel(anchor, prefs.weekStart)} shortLabel={weekRangeShort(anchor, prefs.weekStart)} minWidth={0} prevLabel="Previous week" nextLabel="Next week"
                    onPrev={() => setAnchor(a => addDays(a, -7))} onNext={() => setAnchor(a => addDays(a, 7))} />}
                  <button type="button" onClick={() => { goToDate(new Date()); setSelectedDay(startOfDay(new Date())) }} data-testid="today-btn"
                    className="text-[11.5px] min-[361px]:text-[12px] font-semibold flex-shrink-0 px-1 min-[361px]:px-2" style={{ paddingTop: 6, paddingBottom: 6, borderRadius: 8, color: '#7c3aed', background: 'rgba(124,58,237,0.10)', border: '0.5px solid rgba(124,58,237,0.28)' }}>
                    Today
                  </button>
                  <FilterIconButton active={isFilterActive({ filter, hidden, hiddenSources })} open={panel.kind === 'filter'} onClick={() => onPanelChange(panel.kind === 'filter' ? null : 'filter')} />
                </div>
                <SlideDown open={panel.kind === 'search'} onEscape={() => onPanelChange(null)}>
                  <SearchPanel query={query} onChange={onQueryChange} onClose={() => onPanelChange(null)} open={panel.kind === 'search'} focusNonce={panel.nonce} />
                </SlideDown>
                {query.trim() && panel.kind !== 'search' && (
                  <ActiveSearchChip query={query.trim()} onOpen={() => onPanelChange('search')} onClear={() => onQueryChange('')} />
                )}
              </div>
            ) : (
              <>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-2 pb-2.5 flex-shrink-0">
              <NavGroup label={monthYearLabel(anchor)} shortLabel={monthYearShort(anchor)} minWidth={64} prevLabel="Previous month" nextLabel="Next month"
                onPrev={() => setAnchor(a => shiftMonth(a, -1))} onNext={() => setAnchor(a => shiftMonth(a, 1))} />
              {!month && <NavGroup label={weekRangeLabel(anchor, prefs.weekStart)} minWidth={92} prevLabel="Previous week" nextLabel="Next week"
                onPrev={() => setAnchor(a => addDays(a, -7))} onNext={() => setAnchor(a => addDays(a, 7))} />}
              <button type="button" onClick={() => { goToDate(new Date()); setSelectedDay(startOfDay(new Date())) }}
                className="text-[12px] font-semibold" style={{ padding: '6px 9px', borderRadius: 8, color: '#7c3aed', background: 'rgba(124,58,237,0.10)', border: '0.5px solid rgba(124,58,237,0.28)' }}>
                Today
              </button>

              <div className="flex items-center gap-2 flex-1 min-w-[280px]">
                <label className="relative flex-1 min-w-0">
                  <span className="sr-only">Search events</span>
                  <input
                    type="search" value={query} onChange={e => onQueryChange(e.target.value)} placeholder="Search events, classes, meetings…"
                    className="w-full text-[12.5px]"
                    style={{ padding: '7px 30px 7px 11px', borderRadius: 10, background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr2)', color: 'var(--xp-txt)', outline: 'none', fontSize: 16 }}
                  />
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="var(--xp-txt3)" strokeWidth="2" className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" strokeLinecap="round" /></svg>
                </label>

                {/* One combined filter: All · the categories · Google Calendar · Outlook */}
                <FilterSelect value={filter} onChange={onFilterChange} className="w-[74px] sm:w-[132px]" />

                {/* Compact legend control (below lg the legend sidebar is hidden) */}
                <div ref={filterRef} className="relative lg:hidden flex-shrink-0">
                  <button type="button" onClick={() => setFilterOpen(o => !o)} aria-label="Show or hide categories" aria-expanded={filterOpen} style={{ ...iconBtn, width: 34, height: 34, borderRadius: 10, color: hidden.length ? '#7c3aed' : 'var(--xp-txt2)' }}>
                    <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M3 5h18l-7 8.5V20l-4-2v-4.5Z" /></svg>
                    {hidden.length > 0 && <span aria-hidden="true" className="absolute -top-1 -right-1 text-[9px] font-bold text-white flex items-center justify-center" style={{ width: 15, height: 15, borderRadius: '50%', background: '#7c3aed' }}>{hidden.length}</span>}
                  </button>
                  {filterOpen && (
                    <div className="absolute right-0 z-20 overflow-y-auto" style={{ top: 'calc(100% + 6px)', width: 232, maxHeight: 320, background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)', borderRadius: 12, padding: 12, boxShadow: '0 14px 36px rgba(0,0,0,0.25)' }}>
                      <p className="text-[11px] font-bold uppercase mb-2" style={{ color: 'var(--xp-txt3)', letterSpacing: '0.06em' }}>Show categories</p>
                      <CategoryChecklist hidden={hidden} onToggle={onToggleCategory} />
                    </div>
                  )}
                </div>
              </div>
            </div>

              </>
            )}

            {/* Grid */}
            {month ? (
              <div className="relative flex-1 min-h-0" style={{ border: '1px solid rgba(124,58,237,0.45)', borderRadius: 14, background: 'var(--xp-card)', overflow: 'hidden' }} data-testid="month-view">
                <MonthGrid weeks={monthWeeksGrid} weekStart={prefs.weekStart} selectedDay={selectedDay} selectedId={selectedId} onCell={onMonthCell} onEvent={onMonthEvent} onMore={onMonthMore} />
              </div>
            ) : (
            <div className="relative flex-1 min-h-0" style={{ border: '1px solid rgba(124,58,237,0.45)', borderRadius: 14, background: 'var(--xp-card)', overflow: 'hidden' }} data-testid="schedule-grid">
              <div ref={scrollerRef} onScroll={updateEdges} className="h-full overflow-y-auto overflow-x-hidden" style={{ overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch', cursor: drag ? 'grabbing' : undefined, userSelect: drag ? 'none' : undefined }} data-testid="schedule-scroller">
                {/* Sticky weekday header — same column template as the body, so columns line up exactly */}
                <div className="sticky top-0 z-10" style={{ display: 'grid', gridTemplateColumns: GRID_COLS, background: 'var(--xp-card)', borderBottom: '1px solid var(--xp-bdr2)' }}>
                  <div className="flex items-end justify-center pb-1.5 text-[10px] sm:text-[11px] font-semibold" style={{ color: 'var(--xp-txt3)' }}>Time</div>
                  {days.map((d, i) => {
                    const isToday = i === todayIdx
                    const isSel = !!selectedDay && isSameLocalDay(d, selectedDay)
                    const isDrop = !!drag && drag.dayIdx === i
                    return (
                      <button key={d.getTime()} type="button" onClick={() => setSelectedDay(startOfDay(d))} aria-pressed={isSel}
                        aria-label={`${d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}${isToday ? ', today' : ''}`}
                        className="xp-sch-day flex flex-col items-center min-w-0 py-1.5"
                        style={{ borderLeft: '1px solid var(--xp-bdr)', background: isDrop ? (drag.plan.ok ? 'rgba(22,163,74,0.16)' : 'rgba(220,38,38,0.14)') : isToday ? 'rgba(124,58,237,0.10)' : 'transparent' }}>
                        <span className="text-[11px] sm:text-[13px] font-bold" style={{ color: isToday ? '#7c3aed' : 'var(--xp-txt)' }}>{DAY_NAMES[d.getDay()]}</span>
                        <span className="text-[9px] sm:text-[10.5px] font-semibold whitespace-nowrap mt-0.5"
                          style={{ padding: '1px 5px', borderRadius: 6, background: isToday ? '#7c3aed' : isSel ? 'rgba(124,58,237,0.18)' : 'var(--xp-bg3)', color: isToday ? '#fff' : isSel ? '#7c3aed' : 'var(--xp-txt3)' }}>
                          {shortDayLabel(d)}
                        </span>
                      </button>
                    )
                  })}
                </div>

                {/* 24-hour body */}
                <div ref={bodyRef} style={{ display: 'grid', gridTemplateColumns: GRID_COLS, height: 24 * HOUR_PX, position: 'relative' }}>
                  <div ref={timeColRef} className="relative" aria-hidden="true">
                    {Array.from({ length: 24 }, (_, h) => (
                      <span key={h} className="absolute right-1.5 text-[9.5px] sm:text-[11px] whitespace-nowrap" style={{ top: h * HOUR_PX + 4, color: 'var(--xp-txt3)' }}>{hourLabel(h, fmt)}</span>
                    ))}
                  </div>
                  {days.map((d, i) => {
                    const isSel = !!selectedDay && isSameLocalDay(d, selectedDay)
                    const dayStart = startOfDay(d).getTime()
                    const slotHere = slot && isSameLocalDay(new Date(slot.day), d) ? slot : null
                    const ghost = drag && drag.dayIdx === i ? drag : null
                    const ghostCat = ghost && dragEv ? categories.find(c => c.id === dragEv.category) : null
                    return (
                      <div key={d.getTime()} className="xp-sch-col relative min-w-0" data-day={d.getDay()} data-testid={`day-col-${i}`}
                        role="group" tabIndex={0}
                        aria-label={`${d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} time slots. Use the up and down arrow keys to choose a time, then Enter to add an event.`}
                        onClick={e => onColumnClick(e, d)} onKeyDown={e => onColumnKey(e, d)}
                        style={{
                          borderLeft: '1px solid var(--xp-bdr)',
                          background: `repeating-linear-gradient(to bottom, transparent 0, transparent ${HOUR_PX - 1}px, var(--xp-bdr) ${HOUR_PX - 1}px, var(--xp-bdr) ${HOUR_PX}px), ${ghost ? (ghost.plan.ok ? 'rgba(22,163,74,0.07)' : 'rgba(220,38,38,0.06)') : i === todayIdx ? 'rgba(124,58,237,0.05)' : isSel ? 'rgba(124,58,237,0.03)' : 'transparent'}`,
                        }}>
                        {slotHere && (
                          <div data-testid="slot-highlight" className="absolute left-0 right-0 flex items-center justify-center"
                            style={{ top: (slotHere.min / 60) * HOUR_PX, height: (SLOT_MINUTES / 60) * HOUR_PX, background: 'rgba(124,58,237,0.16)', border: '1.5px dashed #7c3aed', borderRadius: 6, zIndex: 1 }}>
                            <button type="button" data-testid="slot-add"
                              onClick={e => { e.stopPropagation(); lastTapRef.current = null; setSlot(null); onAddAt(d, slotHere.min) }}
                              aria-label={`Add event on ${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} at ${clockLabel(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, slotHere.min).getTime(), fmt)}`}
                              className="text-[10px] sm:text-[11px] font-bold text-white whitespace-nowrap" style={{ padding: '1px 7px', borderRadius: 6, background: '#7c3aed', lineHeight: '16px' }}>
                              + Add
                            </button>
                          </div>
                        )}
                        {layouts[i].map(p => (
                          <EventBlock key={`${p.event.id}-${d.getDate()}`} p={p} dayStart={dayStart} selected={p.event.id === selectedId} dragging={drag?.id === p.event.id}
                            onSelect={() => selectEvent(p.event)} onPress={startDragPress} />
                        ))}
                        {ghost && dragEv && (
                          <div {...{ [LAYER_ATTR]: '' }} data-testid="drag-ghost" data-valid={ghost.plan.ok ? 'true' : 'false'} aria-hidden="true" className="absolute pointer-events-none overflow-hidden"
                            style={{
                              top: (ghost.startMin / 60) * HOUR_PX, height: Math.max((dragDur / 60_000 / 60) * HOUR_PX, 14), left: 2, right: 2, zIndex: 6, borderRadius: 6, padding: '2px 4px',
                              background: ghost.plan.ok || ghost.plan.unchanged ? (ghostCat?.bg ?? '#e4d4fb') : 'rgba(220,38,38,0.22)',
                              border: `2px dashed ${ghost.plan.ok || ghost.plan.unchanged ? '#16a34a' : '#dc2626'}`,
                              color: ghost.plan.ok || ghost.plan.unchanged ? (ghostCat?.text ?? '#4c1d95') : '#991b1b', opacity: 0.92,
                              boxShadow: '0 6px 16px rgba(0,0,0,0.22)',
                            }}>
                            <span className="block text-[10px] sm:text-[11px] font-bold truncate">{dragEv.title}</span>
                          </div>
                        )}
                        {i === todayIdx && (
                          <div aria-hidden="true" className="absolute left-0 right-0 pointer-events-none" style={{ top: (nowMin / 60) * HOUR_PX, height: 0, borderTop: '2px solid #ef4444', zIndex: 4 }}>
                            <span style={{ position: 'absolute', left: -4, top: -5, width: 8, height: 8, borderRadius: '50%', background: '#ef4444' }} />
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Live drag status: where it will land, or exactly why it can't */}
              {drag && dragEv && (
                <div role="status" aria-live="polite" data-testid="drag-status" data-valid={drag.plan.ok ? 'true' : 'false'} className="absolute left-1/2 pointer-events-none text-center"
                  style={{ top: 56, transform: 'translateX(-50%)', zIndex: 12, maxWidth: '92%', padding: '6px 11px', borderRadius: 10, fontSize: 11.5, fontWeight: 600, boxShadow: '0 8px 22px rgba(0,0,0,0.28)',
                    background: drag.plan.ok ? '#15803d' : drag.plan.unchanged ? '#4b5563' : '#b91c1c', color: '#fff' }}>
                  {drag.plan.ok
                    ? `Move to ${new Date(drag.plan.startAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · ${timeRangeLabel(drag.plan.startAt, drag.plan.endAt, fmt)}`
                    : drag.plan.unchanged ? 'Original position' : drag.plan.message}
                </div>
              )}

              {/* Subtle "more hours" hints — never intercept touches */}
              {edges.up && (
                <div aria-hidden="true" className="absolute left-0 right-0 flex justify-center pointer-events-none" style={{ top: 46, height: 22, background: 'linear-gradient(to bottom, var(--xp-card), transparent)', color: '#7c3aed', zIndex: 11 }}>
                  <Chevron dir="up" />
                </div>
              )}
              {edges.down && (
                <div aria-hidden="true" className="absolute left-0 right-0 bottom-0 flex items-end justify-center pointer-events-none" style={{ height: 24, background: 'linear-gradient(to top, var(--xp-card), transparent)', color: '#7c3aed', zIndex: 11 }}>
                  <Chevron dir="down" />
                </div>
              )}
            </div>
            )}
          </div>

          {/* ── Sidebar (large screens): same top and bottom edges as the calendar ── */}
          <aside className="hidden lg:flex flex-col gap-3 w-[296px] flex-shrink-0 min-h-0 overflow-y-auto pr-4" style={{ overscrollBehavior: 'contain' }} aria-label="Schedule details" data-testid="schedule-sidebar">
            <Card title={`Upcoming (${upcoming.length})`} grow={1} minHeight={120} testId="card-upcoming">
              {upcoming.length === 0 ? (
                <p className="text-[12px] py-2" style={{ color: 'var(--xp-txt3)' }}>Nothing coming up.</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {upcoming.map(ev => (
                    <li key={ev.id}>
                      <UpcomingRow ev={ev} onPick={() => { selectEvent(ev); goToDate(new Date(ev.startAt)) }} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="Selected Event" grow={1.25} minHeight={150} testId="card-selected">
              {selected
                ? <EventDetails ev={selected} onEdit={() => onEdit(selected)} onDelete={() => onDelete(selected)} onDuplicate={canDuplicate(selected) ? () => onDuplicate(selected) : undefined} />
                : <EmptyDetails />}
            </Card>

            <Card title="Color Categories" maxHeight="42%" testId="card-categories">
              <CategoryChecklist hidden={hidden} onToggle={onToggleCategory} />
            </Card>
          </aside>
        </div>

        {phone && (
          <div className="absolute left-0 right-0 bottom-0 pointer-events-none" style={{ top: sheetTop }}>
            <div className="absolute inset-0 pointer-events-auto" style={{ pointerEvents: 'none' }}>
              <FilterSheet open={panel.kind === 'filter'} filter={filter} hidden={hidden} hiddenSources={hiddenSources}
                onApply={st => { onApplyFilter(st); onPanelChange(null) }} onClose={() => onPanelChange(null)} />
            </div>
          </div>
        )}

        <div className="flex-shrink-0 px-2 sm:px-4 pb-3 pt-1.5">
          {visible.length === 0 && (
            <p className="text-center text-[11.5px] pb-1" style={{ color: 'var(--xp-txt3)' }}>No events match your search or filters.</p>
          )}
          <p className="text-[10.5px]" style={{ color: 'var(--xp-txt3)' }}>Preview — sample events; anything you add, move or change isn’t saved yet.</p>
        </div>
      </div>

      {month && (
        <MonthDaySheet day={daySheet} open={!!daySheet} events={daySheet ? monthDayEvents(visible, daySheet) : []} onClose={() => setDaySheet(null)}
          onPick={onMonthEvent} onAdd={d => { setDaySheet(null); onAddAt(d, 9 * 60) }} />
      )}

      {/* Details bottom sheet (below lg; the sidebar shows them on large screens) */}
      {selected && sheetOpen && !drag && (
        <EventSheet ev={selected} onClose={() => { setSheetOpen(false); setSelectedId(null) }} onEdit={() => onEdit(selected)} onDelete={() => onDelete(selected)} onDuplicate={canDuplicate(selected) ? () => onDuplicate(selected) : undefined} />
      )}
    </>
  )
}

function UpcomingRow({ ev, onPick }: { ev: ScheduleEvent; onPick: () => void }) {
  const { meta, fmt } = useSchedule()
  const cat = meta(ev.category)
  return (
    <button type="button" onClick={onPick} className="w-full text-left"
      style={{ padding: '7px 9px', borderRadius: 9, background: 'var(--xp-bg3)', borderLeft: `3px solid ${cat.edge}` }}>
      <p className="text-[12.5px] font-semibold truncate" style={{ color: 'var(--xp-txt)' }}>{ev.title}</p>
      <p className="text-[11px] truncate" style={{ color: 'var(--xp-txt3)' }}>{new Date(ev.startAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · {clockLabel(ev.startAt, fmt)}</p>
    </button>
  )
}

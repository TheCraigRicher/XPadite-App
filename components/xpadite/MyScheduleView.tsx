'use client'

// ── My Schedule — weekly scheduler ──────────────────────────────────────────
// Body of the "My Schedule" tab inside MeetingsModal. Renders a seven-column, 24-hour weekly grid plus (desktop/large
// tablet) a right-hand Upcoming / Selected Event / Color Categories sidebar. Smaller screens get the same grid with the
// selected event in a bottom sheet. XPadite events + read-only synced meetings only — nothing here is persisted, and the
// Add/Edit/Delete dialogs live in the modal (ScheduleParts) so Today and My Schedule share one implementation.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  SCHEDULE_CATEGORIES,
  addDays, categoryMeta, clockLabel, filterScheduleEvents, hourLabel, isSameLocalDay, layoutDayEvents, monthYearLabel,
  monthYearShort, shiftMonth, shortDayLabel, splitFilter, startOfDay, timeRangeLabel, weekDays, weekRangeLabel,
} from './scheduleLogic'
import type { CombinedFilter, ScheduleCategoryId, ScheduleEvent } from './scheduleLogic'
import { Chevron, EmptyDetails, EventDetails, EventSheet, FilterSelect, iconBtn } from './ScheduleParts'

// ── Layout constants ────────────────────────────────────────────────────────

const HOUR_PX = 56
const INITIAL_SCROLL_HOUR = 5
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
// The time column is narrower on phones (--xp-sch-tc, see the <style> block) so the seven day columns get the room.
const GRID_COLS = 'var(--xp-sch-tc) repeat(7, minmax(0, 1fr))'

// ── Small pieces ────────────────────────────────────────────────────────────

function NavGroup({ label, shortLabel, onPrev, onNext, prevLabel, nextLabel, minWidth }: { label: string; shortLabel?: string; onPrev: () => void; onNext: () => void; prevLabel: string; nextLabel: string; minWidth: number }) {
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
  return (
    <ul className="flex flex-col gap-2" role="group" aria-label="Show categories">
      {SCHEDULE_CATEGORIES.map(c => {
        const on = !hidden.includes(c.id)
        return (
          <li key={c.id}>
            <label className="flex items-center gap-2.5 cursor-pointer text-[12.5px]" style={{ color: 'var(--xp-txt)' }}>
              <input type="checkbox" checked={on} onChange={() => onToggle(c.id)} className="sr-only peer" />
              <span aria-hidden="true" className="flex items-center justify-center flex-shrink-0" style={{ width: 17, height: 17, borderRadius: 5, background: on ? '#7c3aed' : 'transparent', border: `1.5px solid ${on ? '#7c3aed' : 'var(--xp-bdr2)'}` }}>
                {on && <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="white" strokeWidth="3.4"><polyline points="5 12.5 10 17.5 19 7.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
              </span>
              <span aria-hidden="true" style={{ width: 28, height: 12, borderRadius: 6, background: c.bg, border: `1px solid ${c.edge}`, opacity: on ? 1 : 0.45 }} />
              <span style={{ opacity: on ? 1 : 0.6 }}>{c.label}</span>
            </label>
          </li>
        )
      })}
    </ul>
  )
}

function Card({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex-shrink-0" style={{ background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)', borderRadius: 14, padding: '12px 13px' }}>
      <div className="flex items-center justify-between gap-2 mb-2.5 flex-shrink-0">
        <h3 className="text-[13.5px] font-bold" style={{ color: 'var(--xp-txt)' }}>{title}</h3>
        {right}
      </div>
      {children}
    </section>
  )
}

// ── Weekly grid ─────────────────────────────────────────────────────────────

function EventBlock({ p, selected, onSelect }: { p: ReturnType<typeof layoutDayEvents>[number]; selected: boolean; onSelect: () => void }) {
  const { event: ev } = p
  const cat = categoryMeta(ev.category)
  const heightPx = Math.max(((p.endMin - p.startMin) / 60) * HOUR_PX - 2, 14)
  const showTime = heightPx >= 40 && p.lanes <= 2
  const showPlace = heightPx >= 72 && p.lanes === 1 && !!ev.location
  return (
    <button
      type="button"
      onClick={e => { e.stopPropagation(); onSelect() }}
      aria-label={`${ev.title}, ${timeRangeLabel(ev.startAt, ev.endAt)}${ev.isCancelled ? ', cancelled' : ''}`}
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
        opacity: ev.isCancelled ? 0.6 : 1,
      }}
    >
      <span className="xp-sch-ev-title block font-bold" style={{ textDecoration: ev.isCancelled ? 'line-through' : 'none' }}>{ev.title}</span>
      {showTime && <span className="xp-sch-ev-sub block truncate">{timeRangeLabel(ev.startAt, ev.endAt)}</span>}
      {showPlace && <span className="xp-sch-ev-sub hidden sm:block truncate">📍 {ev.location}</span>}
    </button>
  )
}

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
  /** Set by the modal after an event is added/edited so this view jumps to it. */
  focus: { id: string; at: number; nonce: number } | null
  onEdit: (ev: ScheduleEvent) => void
  onDelete: (ev: ScheduleEvent) => void
  /** Tells the modal which day its add button should default to. */
  onActiveDayChange: (day: Date) => void
}

export function MyScheduleView({ events, filter, onFilterChange, hidden, onToggleCategory, now, focus, onEdit, onDelete, onActiveDayChange }: MyScheduleViewProps) {
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()))
  const [selectedDay, setSelectedDay] = useState<Date | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [filterOpen, setFilterOpen] = useState(false)
  const [showAllUpcoming, setShowAllUpcoming] = useState(false)
  const [edges, setEdges] = useState({ up: false, down: true })
  const [seenFocus, setSeenFocus] = useState(focus?.nonce ?? 0)

  // Jump to an event the modal just added/edited (adjusting state during render — no effect needed).
  if (focus && focus.nonce !== seenFocus) {
    setSeenFocus(focus.nonce)
    setSelectedId(focus.id)
    setAnchor(startOfDay(new Date(focus.at)))
    setSelectedDay(startOfDay(new Date(focus.at)))
  }

  const scrollerRef = useRef<HTMLDivElement>(null)
  const filterRef = useRef<HTMLDivElement>(null)

  const days = useMemo(() => weekDays(anchor), [anchor])
  const parts = splitFilter(filter)
  const visible = useMemo(
    () => filterScheduleEvents(events, { query, category: parts.category, source: parts.source, hidden }),
    [events, query, parts.category, parts.source, hidden],
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
  const defaultAddDay = selectedDay && days.some(d => isSameLocalDay(d, selectedDay))
    ? selectedDay
    : (days.find(d => isSameLocalDay(d, today)) ?? days[0])
  const defaultAddKey = defaultAddDay.getTime()
  useEffect(() => { onActiveDayChange(new Date(defaultAddKey)) }, [defaultAddKey, onActiveDayChange])

  // Open scrolled to 5 AM (midnight is one scroll up; the rest of the day is below).
  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    el.scrollTop = INITIAL_SCROLL_HOUR * HOUR_PX
    updateEdges()
  }, [])

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

  function goToDate(d: Date) { setAnchor(startOfDay(d)) }

  function selectEvent(ev: ScheduleEvent) {
    setSelectedId(ev.id)
    setSelectedDay(startOfDay(new Date(ev.startAt)))
  }

  return (
    <>
      <style>{`
        .xp-sch-root { --xp-sch-tc: 36px; }
        .xp-sch-ev { padding: 2px 3px; line-height: 1.12; cursor: pointer; }
        .xp-sch-ev-title { font-size: 9px; overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 4; overflow-wrap: break-word; }
        .xp-sch-ev-sub { font-size: 8px; opacity: .82; margin-top: 1px; }
        @media (min-width: 640px) {
          .xp-sch-root { --xp-sch-tc: 46px; }
          .xp-sch-ev { padding: 4px 6px; }
          .xp-sch-ev-title { font-size: 11.5px; -webkit-line-clamp: 3; }
          .xp-sch-ev-sub { font-size: 10px; }
          .xp-sch-ev-narrow { padding: 3px 4px; }
          .xp-sch-ev-narrow .xp-sch-ev-title { font-size: 10.5px; }
        }
        @keyframes xp-sch-sheet-in { from { transform: translateY(24px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
        .xp-sch-sheet { animation: xp-sch-sheet-in 170ms ease-out; }
        .xp-sch-day:focus-visible, .xp-sch-ev:focus-visible { outline: 2px solid #7c3aed; outline-offset: 1px; }
      `}</style>

      <div className="xp-sch-root flex-1 min-h-0 flex overflow-hidden">
        {/* ── Main column ── */}
        <div className="flex-1 min-w-0 min-h-0 flex flex-col px-2 sm:px-4 pb-3">
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-2 pb-2.5 flex-shrink-0">
            <NavGroup label={monthYearLabel(anchor)} shortLabel={monthYearShort(anchor)} minWidth={64} prevLabel="Previous month" nextLabel="Next month"
              onPrev={() => setAnchor(a => shiftMonth(a, -1))} onNext={() => setAnchor(a => shiftMonth(a, 1))} />
            <NavGroup label={weekRangeLabel(anchor)} minWidth={92} prevLabel="Previous week" nextLabel="Next week"
              onPrev={() => setAnchor(a => addDays(a, -7))} onNext={() => setAnchor(a => addDays(a, 7))} />
            <button type="button" onClick={() => { goToDate(new Date()); setSelectedDay(startOfDay(new Date())) }}
              className="text-[12px] font-semibold" style={{ padding: '6px 9px', borderRadius: 8, color: '#7c3aed', background: 'rgba(124,58,237,0.10)', border: '0.5px solid rgba(124,58,237,0.28)' }}>
              Today
            </button>

            <div className="flex items-center gap-2 flex-1 min-w-[280px]">
              <label className="relative flex-1 min-w-0">
                <span className="sr-only">Search events</span>
                <input
                  type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search events, classes, meetings…"
                  className="w-full text-[12.5px]"
                  style={{ padding: '7px 30px 7px 11px', borderRadius: 10, background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr2)', color: 'var(--xp-txt)', outline: 'none', fontSize: 16 }}
                />
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="var(--xp-txt3)" strokeWidth="2" className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" strokeLinecap="round" /></svg>
              </label>

              {/* One combined filter: All · the six categories · Google Calendar · Outlook */}
              <FilterSelect value={filter} onChange={onFilterChange} className="w-[74px] sm:w-[132px]" />

              {/* Compact legend control (below lg the legend sidebar is hidden) */}
              <div ref={filterRef} className="relative lg:hidden flex-shrink-0">
                <button type="button" onClick={() => setFilterOpen(o => !o)} aria-label="Show or hide categories" aria-expanded={filterOpen} style={{ ...iconBtn, width: 34, height: 34, borderRadius: 10, color: hidden.length ? '#7c3aed' : 'var(--xp-txt2)' }}>
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M3 5h18l-7 8.5V20l-4-2v-4.5Z" /></svg>
                  {hidden.length > 0 && <span aria-hidden="true" className="absolute -top-1 -right-1 text-[9px] font-bold text-white flex items-center justify-center" style={{ width: 15, height: 15, borderRadius: '50%', background: '#7c3aed' }}>{hidden.length}</span>}
                </button>
                {filterOpen && (
                  <div className="absolute right-0 z-20" style={{ top: 'calc(100% + 6px)', width: 232, background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)', borderRadius: 12, padding: 12, boxShadow: '0 14px 36px rgba(0,0,0,0.25)' }}>
                    <p className="text-[11px] font-bold uppercase mb-2" style={{ color: 'var(--xp-txt3)', letterSpacing: '0.06em' }}>Show categories</p>
                    <CategoryChecklist hidden={hidden} onToggle={onToggleCategory} />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Grid */}
          <div className="relative flex-1 min-h-0" style={{ border: '1px solid rgba(124,58,237,0.45)', borderRadius: 14, background: 'var(--xp-card)', overflow: 'hidden' }}>
            <div ref={scrollerRef} onScroll={updateEdges} className="h-full overflow-y-auto overflow-x-hidden" style={{ overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' }} data-testid="schedule-scroller">
              {/* Sticky weekday header — same column template as the body, so columns line up exactly */}
              <div className="sticky top-0 z-10" style={{ display: 'grid', gridTemplateColumns: GRID_COLS, background: 'var(--xp-card)', borderBottom: '1px solid var(--xp-bdr2)' }}>
                <div className="flex items-end justify-center pb-1.5 text-[10px] sm:text-[11px] font-semibold" style={{ color: 'var(--xp-txt3)' }}>Time</div>
                {days.map((d, i) => {
                  const isToday = i === todayIdx
                  const isSel = !!selectedDay && isSameLocalDay(d, selectedDay)
                  return (
                    <button key={d.getTime()} type="button" onClick={() => setSelectedDay(startOfDay(d))} aria-pressed={isSel}
                      aria-label={`${d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}${isToday ? ', today' : ''}`}
                      className="xp-sch-day flex flex-col items-center min-w-0 py-1.5"
                      style={{ borderLeft: '1px solid var(--xp-bdr)', background: isToday ? 'rgba(124,58,237,0.10)' : 'transparent' }}>
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
              <div style={{ display: 'grid', gridTemplateColumns: GRID_COLS, height: 24 * HOUR_PX, position: 'relative' }}>
                <div className="relative" aria-hidden="true">
                  {Array.from({ length: 24 }, (_, h) => (
                    <span key={h} className="absolute right-1.5 text-[9.5px] sm:text-[11px] whitespace-nowrap" style={{ top: h * HOUR_PX + 4, color: 'var(--xp-txt3)' }}>{hourLabel(h)}</span>
                  ))}
                </div>
                {days.map((d, i) => {
                  const isSel = !!selectedDay && isSameLocalDay(d, selectedDay)
                  return (
                    <div key={d.getTime()} className="relative min-w-0" data-day={d.getDay()}
                      style={{
                        borderLeft: '1px solid var(--xp-bdr)',
                        background: `repeating-linear-gradient(to bottom, transparent 0, transparent ${HOUR_PX - 1}px, var(--xp-bdr) ${HOUR_PX - 1}px, var(--xp-bdr) ${HOUR_PX}px), ${i === todayIdx ? 'rgba(124,58,237,0.05)' : isSel ? 'rgba(124,58,237,0.03)' : 'transparent'}`,
                      }}>
                      {layouts[i].map(p => (
                        <EventBlock key={`${p.event.id}-${d.getDate()}`} p={p} selected={p.event.id === selectedId} onSelect={() => selectEvent(p.event)} />
                      ))}
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

          {visible.length === 0 && (
            <p className="text-center text-[11.5px] pt-2 flex-shrink-0" style={{ color: 'var(--xp-txt3)' }}>No events match your search or filters.</p>
          )}
          <p className="text-[10.5px] pt-1.5 flex-shrink-0" style={{ color: 'var(--xp-txt3)' }}>Preview — sample events; anything you add isn’t saved yet.</p>
        </div>

        {/* ── Sidebar (large screens) ── */}
        <aside className="hidden lg:flex flex-col gap-3 w-[296px] flex-shrink-0 min-h-0 overflow-y-auto pr-4 pb-3" style={{ overscrollBehavior: 'contain' }} aria-label="Schedule details">
          <Card title={`Upcoming (${upcoming.length})`} right={upcoming.length > 3 ? (
            <button type="button" onClick={() => setShowAllUpcoming(v => !v)} aria-expanded={showAllUpcoming} className="text-[11.5px] font-semibold" style={{ color: '#7c3aed' }}>{showAllUpcoming ? 'Show Less' : 'View All'}</button>
          ) : undefined}>
            {upcoming.length === 0 ? (
              <p className="text-[12px] py-2" style={{ color: 'var(--xp-txt3)' }}>Nothing coming up.</p>
            ) : (
              <ul className="flex flex-col gap-1.5 overflow-y-auto" style={{ maxHeight: showAllUpcoming ? 280 : undefined, overscrollBehavior: 'contain' }}>
                {(showAllUpcoming ? upcoming : upcoming.slice(0, 3)).map(ev => {
                  const cat = categoryMeta(ev.category)
                  return (
                    <li key={ev.id}>
                      <button type="button" onClick={() => { selectEvent(ev); goToDate(new Date(ev.startAt)) }} className="w-full text-left"
                        style={{ padding: '7px 9px', borderRadius: 9, background: 'var(--xp-bg3)', borderLeft: `3px solid ${cat.edge}` }}>
                        <p className="text-[12.5px] font-semibold truncate" style={{ color: 'var(--xp-txt)' }}>{ev.title}</p>
                        <p className="text-[11px] truncate" style={{ color: 'var(--xp-txt3)' }}>{new Date(ev.startAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · {clockLabel(ev.startAt)}</p>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>

          <Card title="Selected Event">
            {selected ? <EventDetails ev={selected} onEdit={() => onEdit(selected)} onDelete={() => onDelete(selected)} /> : <EmptyDetails />}
          </Card>

          <Card title="Color Categories">
            <CategoryChecklist hidden={hidden} onToggle={onToggleCategory} />
          </Card>
        </aside>
      </div>

      {/* Details bottom sheet (below lg; the sidebar shows them on large screens) */}
      {selected && (
        <EventSheet ev={selected} onClose={() => setSelectedId(null)} onEdit={() => onEdit(selected)} onDelete={() => onDelete(selected)} />
      )}
    </>
  )
}

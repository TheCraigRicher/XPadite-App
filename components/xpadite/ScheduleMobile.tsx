'use client'

// ── My Schedule — phone-only toolbar pieces ─────────────────────────────────
// Phones (< 640px) get a compact two-row toolbar: tabs/Add/menu, then ◀ month ▶ ◀ week ▶ Today Filter. Search is one full-width bar
// that slides down from beneath row two (pushing the calendar). Filter is a bottom sheet that slides UP over the lower part of the
// calendar (the calendar does not move). Tablets and desktops do not use any of this (see useIsPhone). Frontend only.

import { useEffect, useRef, useState } from 'react'
import { FILTER_SOURCES, NO_FILTER, isFilterActive, toCheckboxState, toggleCategoryVisible, toggleSourceVisible } from './scheduleEngine'
import type { FilterState } from './scheduleEngine'
import type { CombinedFilter, ScheduleCategoryId } from './scheduleLogic'
import { iconBtn } from './ScheduleParts'
import { LAYER_ATTR, SheetFrame, useSheetEscape, useSheetPhase } from './ScheduleSheet'
import { useSchedule } from './scheduleContext'

export { PHONE_QUERY, useIsPhone } from './ScheduleSheet'

export function FilterIconButton({ active, open, onClick }: { active: boolean; open: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label="Filter events" aria-expanded={open} aria-controls="xp-sch-panel" data-testid="filter-icon"
      className="relative flex-shrink-0 w-[30px] min-[361px]:w-8" style={{ ...iconBtn, width: undefined, height: 34, borderRadius: 10, color: active || open ? '#7c3aed' : 'var(--xp-txt2)', borderColor: open ? 'rgba(124,58,237,0.5)' : undefined }}>
      <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M3 5h18l-7 8.5V20l-4-2v-4.5Z" /></svg>
      {active && <span data-testid="filter-active-dot" aria-label="Filters are on" className="absolute" style={{ top: -3, right: -3, width: 10, height: 10, borderRadius: '50%', background: '#7c3aed', border: '2px solid var(--xp-card)' }} />}
    </button>
  )
}

// ── The shared slide-down area ──────────────────────────────────────────────

/** The Search bar's area: height animates 0 → content (grid-rows trick) so the calendar below is pushed down and pulled back up; closed content is inert. */
export function SlideDown({ open, children, onEscape }: { open: boolean; children: React.ReactNode; onEscape: () => void }) {
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onEscape() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onEscape])
  return (
    <div id="xp-sch-panel" data-testid="slide-panel" data-open={open ? 'true' : 'false'} className="xp-sch-slide flex-shrink-0"
      aria-hidden={!open} inert={!open} {...(open ? { [LAYER_ATTR]: '' } : {})}>
      <div className="xp-sch-slide-inner">{children}</div>
    </div>
  )
}

export function SearchPanel({ query, onChange, onClose, open, focusNonce }: { query: string; onChange: (q: string) => void; onClose: () => void; open: boolean; focusNonce: number }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { if (open) ref.current?.focus({ preventScroll: true }) }, [open, focusNonce])   // only when opened on purpose
  return (
    <div className="flex items-center gap-2 pb-2.5" data-testid="search-panel">
      <label className="relative flex-1 min-w-0">
        <span className="sr-only">Search events</span>
        <input ref={ref} type="search" value={query} onChange={e => onChange(e.target.value)} placeholder="Search events, classes, meetings…"
          enterKeyHint="search" className="w-full"
          style={{ padding: '9px 36px 9px 12px', borderRadius: 10, background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr2)', color: 'var(--xp-txt)', outline: 'none', fontSize: 16 }} />
        {query && (
          <button type="button" onClick={() => { onChange(''); ref.current?.focus({ preventScroll: true }) }} aria-label="Clear search" data-testid="search-clear"
            className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center justify-center" style={{ width: 30, height: 30, color: 'var(--xp-txt3)' }}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" strokeLinecap="round" /><line x1="6" y1="6" x2="18" y2="18" strokeLinecap="round" /></svg>
          </button>
        )}
      </label>
      <button type="button" onClick={onClose} className="text-[13px] font-semibold flex-shrink-0" style={{ padding: '9px 12px', borderRadius: 10, color: '#7c3aed' }}>Done</button>
    </div>
  )
}

/** One checkbox row: purple box, then a swatch (categories) or nothing (calendars), then the name — same look as the desktop Color Categories. */
function CheckRow({ on, onToggle, label, swatch }: { on: boolean; onToggle: () => void; label: string; swatch?: { bg: string; edge: string } }) {
  return (
    <li>
      <label className="flex items-center gap-3 cursor-pointer text-[14px]" style={{ color: 'var(--xp-txt)', minHeight: 40 }}>
        <input type="checkbox" checked={on} onChange={onToggle} className="sr-only peer" />
        <span aria-hidden="true" className="flex items-center justify-center flex-shrink-0 peer-focus-visible:ring-2 peer-focus-visible:ring-purple-500" style={{ width: 20, height: 20, borderRadius: 6, background: on ? '#7c3aed' : 'transparent', border: `1.5px solid ${on ? '#7c3aed' : 'var(--xp-bdr2)'}` }}>
          {on && <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="white" strokeWidth="3.4"><polyline points="5 12.5 10 17.5 19 7.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
        </span>
        {swatch && <span aria-hidden="true" className="flex-shrink-0" style={{ width: 30, height: 13, borderRadius: 7, background: swatch.bg, border: `1px solid ${swatch.edge}`, opacity: on ? 1 : 0.45 }} />}
        <span className="min-w-0 truncate" style={{ opacity: on ? 1 : 0.6 }}>{label}</span>
      </label>
    </li>
  )
}

interface FilterSheetProps { open: boolean; filter: CombinedFilter; hidden: ScheduleCategoryId[]; hiddenSources: string[]; onApply: (s: FilterState) => void; onClose: () => void }

/** The Filter bottom sheet (phones). Keep rendering with open={false} so it can slide back down; it unmounts (draft discarded) afterwards. */
export function FilterSheet(props: FilterSheetProps) {
  const { mounted, visible } = useSheetPhase(props.open, true)
  if (!mounted) return null
  return <FilterSheetInner {...props} visible={visible} />
}

/**
 * Checkbox lists of categories and calendars, edited as a DRAFT: Reset only resets the draft, Cancel / backdrop / swipe / Esc discard it,
 * Apply commits it (filter + hidden categories + hidden calendars) and closes the sheet.
 */
function FilterSheetInner({ filter, hidden, hiddenSources, onApply, onClose, visible }: FilterSheetProps & { visible: boolean }) {
  const { categories } = useSchedule()
  const [draft, setDraft] = useState<FilterState>(() => toCheckboxState({ filter, hidden, hiddenSources }, categories.map(c => c.id)))
  useSheetEscape(visible, onClose)
  const heading: React.CSSProperties = { color: 'var(--xp-txt3)', letterSpacing: '0.06em' }
  return (
    <SheetFrame phone visible={visible} variant="sheet" label="Filter events" onClose={onClose} zClass="z-30">
      <div data-testid="filter-panel" className="flex flex-col min-h-0 flex-1 px-4 pb-3">
        <div className="flex items-center justify-between flex-shrink-0 pb-1.5">
          <h3 className="text-[15px] font-bold" style={{ color: 'var(--xp-txt)' }}>Filter events {isFilterActive(draft) && <span className="text-[11px] font-semibold" style={{ color: '#7c3aed' }}>· on</span>}</h3>
          <button type="button" onClick={() => setDraft(NO_FILTER)} data-testid="filter-reset" className="text-[12.5px] font-semibold"
            style={{ padding: '5px 12px', borderRadius: 999, background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)', color: 'var(--xp-txt)' }}>Reset</button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto pb-2" style={{ overscrollBehavior: 'contain' }} data-testid="filter-scroll">
          <h4 className="text-[11px] font-bold uppercase mt-1 mb-0.5" style={heading}>Color Categories</h4>
          <ul className="flex flex-col" role="group" aria-label="Color Categories">
            {categories.map(c => <CheckRow key={c.id} on={!draft.hidden.includes(c.id)} onToggle={() => setDraft(d => toggleCategoryVisible(d, c.id))} label={c.label} swatch={c} />)}
          </ul>
          <h4 className="text-[11px] font-bold uppercase mt-3 mb-0.5" style={heading}>Calendars</h4>
          <ul className="flex flex-col" role="group" aria-label="Calendars">
            {FILTER_SOURCES.map(x => <CheckRow key={x.id} on={!draft.hiddenSources.includes(x.id)} onToggle={() => setDraft(d => toggleSourceVisible(d, x.id))} label={x.label} />)}
          </ul>
        </div>
        <div className="flex gap-2 flex-shrink-0 pt-2" style={{ borderTop: '0.5px solid var(--xp-bdr)' }}>
          <button type="button" onClick={onClose} data-testid="filter-cancel" className="flex-1 text-[13px] font-medium"
            style={{ padding: '11px 12px', borderRadius: 10, background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)', color: 'var(--xp-txt2)' }}>Cancel</button>
          <button type="button" onClick={() => onApply(draft)} data-testid="filter-apply" className="flex-1 text-[13px] font-semibold text-white"
            style={{ padding: '11px 12px', borderRadius: 10, background: '#7c3aed' }}>Apply</button>
        </div>
      </div>
    </SheetFrame>
  )
}

/** Shown under row two while a search is active but its panel is closed, so hidden events are never a mystery. */
export function ActiveSearchChip({ query, onOpen, onClear }: { query: string; onOpen: () => void; onClear: () => void }) {
  return (
    <div data-testid="search-active" className="flex items-center gap-1 pb-2 flex-shrink-0">
      <button type="button" onClick={onOpen} className="flex items-center gap-1.5 min-w-0 text-[11.5px] font-semibold" aria-label={`Search active: ${query}. Edit search`}
        style={{ padding: '4px 10px', borderRadius: 999, background: 'rgba(124,58,237,0.12)', border: '0.5px solid rgba(124,58,237,0.35)', color: '#7c3aed', maxWidth: '100%' }}>
        <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" strokeLinecap="round" /></svg>
        <span className="truncate">“{query}”</span>
      </button>
      <button type="button" onClick={onClear} aria-label="Clear search" data-testid="search-active-clear" className="text-[11.5px] font-semibold" style={{ padding: '4px 8px', color: 'var(--xp-txt3)' }}>Clear</button>
    </div>
  )
}

'use client'

// ── My Schedule — phone-only toolbar pieces ─────────────────────────────────
// Phones (< 640px) get a compact two-row toolbar: tabs/Add/menu, then ◀ month ▶ ◀ week ▶ Today Filter. Search and Filter live in ONE
// full-width panel that slides down from beneath row two (never a sheet or popover) and pushes the calendar down. Tablets and
// desktops do not use any of this (see useIsPhone) and keep their existing toolbar. Frontend only — nothing is persisted.

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { NO_FILTER, isFilterActive, selectFilter, toggleHiddenCategory } from './scheduleEngine'
import type { FilterState } from './scheduleEngine'
import { filterOptions } from './scheduleLogic'
import type { CombinedFilter, ScheduleCategoryId } from './scheduleLogic'
import { LAYER_ATTR, iconBtn } from './ScheduleParts'
import { useSchedule } from './scheduleContext'

/** The phone breakpoint: below Tailwind's `sm` (640px). Tablets in portrait (≥ 640px) are NOT phones. */
export const PHONE_QUERY = '(max-width: 639px)'

function subscribePhone(cb: () => void) {
  const mq = window.matchMedia(PHONE_QUERY)
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}

export function useIsPhone(): boolean {
  return useSyncExternalStore(subscribePhone, () => window.matchMedia(PHONE_QUERY).matches, () => false)
}

// ── Purple triangle navigation ──────────────────────────────────────────────

function Triangle({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true">
      {dir === 'left' ? <path d="M17 4v16L5 12Z" /> : <path d="M7 4v16l12-8Z" />}
    </svg>
  )
}

/** ◀ label ▶ — compact XPadite purple triangles (no button chrome); each target is still 28×36px so it stays easy to tap. */
export function TriangleNav({ label, onPrev, onNext, prevLabel, nextLabel }: { label: string; onPrev: () => void; onNext: () => void; prevLabel: string; nextLabel: string }) {
  const tri: React.CSSProperties = { width: 24, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#7c3aed', flexShrink: 0, touchAction: 'manipulation' }
  return (
    <div className="flex items-center min-w-0" data-testid="tri-nav">
      <button type="button" onClick={onPrev} aria-label={prevLabel} style={tri}><Triangle dir="left" /></button>
      <span className="text-[11.5px] min-[361px]:text-[12px] font-semibold text-center whitespace-nowrap" style={{ color: 'var(--xp-txt)' }} aria-live="polite">{label}</span>
      <button type="button" onClick={onNext} aria-label={nextLabel} style={tri}><Triangle dir="right" /></button>
    </div>
  )
}

export function FilterIconButton({ active, open, onClick }: { active: boolean; open: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label="Filter events" aria-expanded={open} aria-controls="xp-sch-panel" data-testid="filter-icon"
      className="relative flex-shrink-0" style={{ ...iconBtn, width: 34, height: 34, borderRadius: 10, color: active || open ? '#7c3aed' : 'var(--xp-txt2)', borderColor: open ? 'rgba(124,58,237,0.5)' : undefined }}>
      <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M3 5h18l-7 8.5V20l-4-2v-4.5Z" /></svg>
      {active && <span data-testid="filter-active-dot" aria-label="Filters are on" className="absolute" style={{ top: -3, right: -3, width: 10, height: 10, borderRadius: '50%', background: '#7c3aed', border: '2px solid var(--xp-card)' }} />}
    </button>
  )
}

// ── The shared slide-down area ──────────────────────────────────────────────

/** Height animates 0 → content (grid-rows trick) so the calendar below is pushed down and pulled back up; closed content is inert. */
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

function Chip({ on, onClick, children, role = 'radio' }: { on: boolean; onClick: () => void; children: React.ReactNode; role?: 'radio' | 'checkbox' }) {
  return (
    <button type="button" role={role} aria-checked={on} onClick={onClick} className="inline-flex items-center gap-1.5 text-[12.5px]"
      style={{ padding: '7px 11px', borderRadius: 999, minHeight: 34, background: on ? 'rgba(124,58,237,0.14)' : 'var(--xp-bg3)', border: `1.5px solid ${on ? '#7c3aed' : 'var(--xp-bdr2)'}`, color: on ? '#7c3aed' : 'var(--xp-txt)', fontWeight: on ? 700 : 500 }}>
      {children}
    </button>
  )
}

/** What to show (All / a category / Google Calendar / Outlook) and which categories are visible — one draft, committed by Apply. */
export function FilterPanel({ filter, hidden, onApply, onReset, onClose }: { filter: CombinedFilter; hidden: ScheduleCategoryId[]; onApply: (s: FilterState) => void; onReset: () => void; onClose: () => void }) {
  const { categories } = useSchedule()
  const [draft, setDraft] = useState<FilterState>({ filter, hidden })
  const dirty = draft.filter !== filter || draft.hidden.length !== hidden.length || draft.hidden.some(h => !hidden.includes(h))
  const heading: React.CSSProperties = { color: 'var(--xp-txt3)', letterSpacing: '0.06em' }
  return (
    <div data-testid="filter-panel" className="flex flex-col pb-2.5" style={{ maxHeight: 'min(58dvh, 400px)' }}>
      <div className="flex items-center justify-between flex-shrink-0 pb-1.5">
        <h3 className="text-[13.5px] font-bold" style={{ color: 'var(--xp-txt)' }}>Filter events {isFilterActive(draft) && <span className="text-[11px] font-semibold" style={{ color: '#7c3aed' }}>· on</span>}</h3>
        <button type="button" onClick={onClose} className="text-[13px] font-semibold" style={{ padding: '4px 8px', color: 'var(--xp-txt2)' }}>Close</button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3 pb-2" style={{ overscrollBehavior: 'contain' }} data-testid="filter-scroll">
        <div>
          <p className="text-[10.5px] font-bold uppercase mb-1.5" style={heading}>Show</p>
          <div role="radiogroup" aria-label="Show" className="flex flex-wrap gap-1.5">
            {filterOptions(categories).map(o => {
              const cat = categories.find(c => c.id === o.value)
              return (
                <Chip key={o.value} on={draft.filter === o.value} onClick={() => setDraft(d => selectFilter(d, o.value))}>
                  {cat && <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 3, background: cat.bg, border: `1.5px solid ${cat.edge}` }} />}
                  {o.label}
                </Chip>
              )
            })}
          </div>
        </div>
        <div>
          <p className="text-[10.5px] font-bold uppercase mb-1.5" style={heading}>Visible categories</p>
          <div role="group" aria-label="Visible categories" className="flex flex-wrap gap-1.5">
            {categories.map(c => {
              const on = !draft.hidden.includes(c.id)
              return (
                <Chip key={c.id} role="checkbox" on={on} onClick={() => setDraft(d => toggleHiddenCategory(d, c.id))}>
                  <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 3, background: c.bg, border: `1.5px solid ${c.edge}`, opacity: on ? 1 : 0.4 }} />
                  {c.label}
                </Chip>
              )
            })}
          </div>
        </div>
      </div>
      <div className="flex gap-2 flex-shrink-0 pt-1.5">
        <button type="button" onClick={() => { setDraft(NO_FILTER); onReset() }} data-testid="filter-reset" className="flex-1 text-[13px] font-medium"
          style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr2)', color: 'var(--xp-txt)' }}>Reset</button>
        <button type="button" onClick={() => onApply(draft)} data-testid="filter-apply" aria-disabled={!dirty} className="flex-1 text-[13px] font-semibold text-white"
          style={{ padding: '10px 12px', borderRadius: 10, background: '#7c3aed', opacity: dirty ? 1 : 0.7 }}>Apply</button>
      </div>
    </div>
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

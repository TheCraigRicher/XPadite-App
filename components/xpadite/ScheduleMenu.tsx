'use client'

// ── My Schedule — the schedule's own hamburger menu (beside "+ Add Event") ───
// Not XPadite's main burger menu. Three approved actions only: Manage Categories, Duplicate Event, Schedule Preferences.
// Frontend only; the dialogs it opens keep their changes in memory and say so.

import { useEffect, useRef, useState } from 'react'
import { LAYER_ATTR, iconBtn } from './ScheduleParts'

export interface ScheduleMenuProps {
  /** Phones only (the modal passes these only there): the two extra entries that open the slide-down panels. */
  onSearch?: () => void
  onFilter?: () => void
  onManageCategories: () => void
  onDuplicate: () => void
  onPreferences: () => void
  /** Opens the "Sync with Task Manager" settings dialog. */
  onSync: () => void
  /** Duplicate is only available for a selected XPadite event; otherwise this explains why it is off. */
  duplicateHint: string | null
}

export function ScheduleMenu({ onSearch, onFilter, onManageCategories, onDuplicate, onPreferences, onSync, duplicateHint }: ScheduleMenuProps) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const firstRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    firstRef.current?.focus()
    function onDown(e: MouseEvent | TouchEvent) { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false) }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    window.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('touchstart', onDown); window.removeEventListener('keydown', onKey) }
  }, [open])

  const duplicateOff = duplicateHint !== null
  const item = 'w-full text-left flex flex-col gap-0.5 text-[13px] font-medium'
  const itemStyle: React.CSSProperties = { padding: '9px 12px', borderRadius: 9, color: 'var(--xp-txt)' }

  return (
    <div ref={wrapRef} className="relative flex-shrink-0" {...(open ? { [LAYER_ATTR]: '' } : {})}>
      <button
        type="button" onClick={() => setOpen(o => !o)} aria-label="Schedule menu" aria-haspopup="menu" aria-expanded={open}
        data-testid="schedule-menu-button"
        style={{ ...iconBtn, width: 34, height: 34, borderRadius: 10, color: open ? '#7c3aed' : 'var(--xp-txt2)' }}
      >
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
      </button>
      {open && (
        <div role="menu" aria-label="Schedule menu" data-testid="schedule-menu" className="absolute right-0 z-40"
          style={{ top: 'calc(100% + 6px)', width: 250, background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)', borderRadius: 13, padding: 5, boxShadow: '0 16px 40px rgba(0,0,0,0.3)' }}>
          {onSearch && (
            <button ref={firstRef} type="button" role="menuitem" className={item} style={itemStyle} onClick={() => { setOpen(false); onSearch() }}>Search Events</button>
          )}
          {onFilter && (
            <button type="button" role="menuitem" className={item} style={itemStyle} onClick={() => { setOpen(false); onFilter() }}>Filter Events</button>
          )}
          <button ref={onSearch ? undefined : firstRef} type="button" role="menuitem" className={item} style={itemStyle} onClick={() => { setOpen(false); onManageCategories() }}>
            Manage Categories
          </button>
          <button
            type="button" role="menuitem" aria-disabled={duplicateOff} className={item}
            style={{ ...itemStyle, opacity: duplicateOff ? 0.55 : 1, cursor: duplicateOff ? 'not-allowed' : 'pointer' }}
            onClick={() => { if (duplicateOff) return; setOpen(false); onDuplicate() }}
          >
            Duplicate Event
            {duplicateOff && <span className="text-[11px] font-normal leading-snug" style={{ color: 'var(--xp-txt3)' }}>{duplicateHint}</span>}
          </button>
          <button type="button" role="menuitem" className={item} style={itemStyle} onClick={() => { setOpen(false); onPreferences() }}>
            Schedule Preferences
          </button>
          <button type="button" role="menuitem" data-testid="menu-sync-task-manager" className="w-full text-left flex items-center gap-2 text-[13px] font-medium" style={itemStyle} onClick={() => { setOpen(false); onSync() }}>
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#7c3aed" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-shrink-0">
              <path d="M20 11a8 8 0 0 0-14.3-4.6L4 8" /><path d="M4 4v4h4" /><path d="M4 13a8 8 0 0 0 14.3 4.6L20 16" /><path d="M20 20v-4h-4" />
            </svg>
            Sync with Task Manager
          </button>
        </div>
      )}
    </div>
  )
}

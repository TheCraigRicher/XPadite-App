'use client'

// ── My Schedule — month picker dropdown ─────────────────────────────────────────────────────────────────────────
// Opens under the month navigation box (Week and Month views). Presentation only: it reports the chosen year + month to
// its owner, which applies it with the same anchor state the previous/next arrows use. Nothing is stored.

import { useEffect, useRef, useState } from 'react'
import { LAYER_ATTR } from './ScheduleParts'

export const MONTH_NAMES_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH_NAMES_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const MIN_YEAR = 1900, MAX_YEAR = 2200

function YearArrow({ dir, onClick, disabled }: { dir: 'left' | 'right'; onClick: () => void; disabled: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={dir === 'left' ? 'Previous year' : 'Next year'} data-testid={dir === 'left' ? 'mp-prev-year' : 'mp-next-year'}
      className="flex items-center justify-center flex-shrink-0 xp-mp-btn"
      style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)', color: 'var(--xp-txt2)', opacity: disabled ? 0.4 : 1 }}>
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={dir === 'left' ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6'} /></svg>
    </button>
  )
}

/** `current` is the month the calendar is showing (highlighted when its year is the one in view). */
export function MonthPicker({ current, onPick, onClose }: { current: Date; onPick: (year: number, month: number) => void; onClose: (refocus: boolean) => void }) {
  const [year, setYear] = useState(current.getFullYear())
  const rootRef = useRef<HTMLDivElement>(null)
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([])
  const curIdx = year === current.getFullYear() ? current.getMonth() : -1
  const [focusIdx, setFocusIdx] = useState(current.getMonth())

  useEffect(() => { btnRefs.current[current.getMonth()]?.focus() }, [current])

  useEffect(() => {
    function onDown(e: Event) {
      const t = e.target as HTMLElement | null
      if (!t || rootRef.current?.contains(t) || t.closest('[data-mp-label]')) return    // the label toggles itself
      onClose(false)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') { e.preventDefault(); onClose(true) } }
    document.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', onDown, true); window.removeEventListener('keydown', onKey) }
  }, [onClose])

  function move(i: number) { const n = Math.max(0, Math.min(11, i)); setFocusIdx(n); btnRefs.current[n]?.focus() }
  function onGridKey(e: React.KeyboardEvent, i: number) {
    const k = e.key
    const next = k === 'ArrowRight' ? i + 1 : k === 'ArrowLeft' ? i - 1 : k === 'ArrowDown' ? i + 3 : k === 'ArrowUp' ? i - 3 : k === 'Home' ? 0 : k === 'End' ? 11 : null
    if (next !== null) { e.preventDefault(); move(next) }
  }

  return (
    <div
      ref={rootRef} {...{ [LAYER_ATTR]: '' }} role="dialog" aria-label="Choose month" data-testid="month-picker"
      className="xp-mp-pop absolute z-30"
      style={{ top: 'calc(100% + 6px)', left: 0, width: 232, maxWidth: 'calc(100vw - 16px)', background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)', borderRadius: 14, padding: 10, boxShadow: '0 14px 36px rgba(0,0,0,0.25)' }}
    >
      <style>{`
        .xp-mp-pop { animation: xp-mp-in 150ms ease-out; transform-origin: top left; }
        @keyframes xp-mp-in { from { opacity: 0; transform: translateY(-6px) } to { opacity: 1; transform: translateY(0) } }
        .xp-mp-btn:focus-visible, .xp-mp-month:focus-visible { outline: 2px solid #7c3aed; outline-offset: 1px; }
        @media (hover: hover) { .xp-mp-month:not([aria-pressed='true']):hover { background: rgba(124,58,237,0.12); } }
        @media (prefers-reduced-motion: reduce) { .xp-mp-pop { animation: none; } }
      `}</style>
      <div className="flex items-center justify-between mb-2">
        <YearArrow dir="left" onClick={() => setYear(y => y - 1)} disabled={year <= MIN_YEAR} />
        <span className="text-[13px] font-bold" style={{ color: 'var(--xp-txt)' }} aria-live="polite" data-testid="mp-year">{year}</span>
        <YearArrow dir="right" onClick={() => setYear(y => y + 1)} disabled={year >= MAX_YEAR} />
      </div>
      <div className="grid grid-cols-3 gap-1" role="group" aria-label={`Months of ${year}`}>
        {MONTH_NAMES_SHORT.map((m, i) => {
          const sel = i === curIdx
          return (
            <button
              key={m} type="button" ref={el => { btnRefs.current[i] = el }} data-testid="mp-month" data-month={i} aria-pressed={sel} aria-label={`${MONTH_NAMES_LONG[i]} ${year}`}
              tabIndex={i === focusIdx ? 0 : -1} onFocus={() => setFocusIdx(i)} onKeyDown={e => onGridKey(e, i)}
              onClick={() => onPick(year, i)}
              className="xp-mp-month text-[12.5px]"
              style={{ padding: '9px 0', borderRadius: 9, fontWeight: sel ? 700 : 500, background: sel ? '#7c3aed' : 'var(--xp-bg3)', color: sel ? '#ffffff' : 'var(--xp-txt)' }}
            >{m}</button>
          )
        })}
      </div>
    </div>
  )
}

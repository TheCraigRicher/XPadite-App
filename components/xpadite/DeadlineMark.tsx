'use client'

// ── Calendar deadline marker (v1.345) ────────────────────────────────────────────────────────────────────────────────
// ONE marker per date cell, drawn in the same slot the productive circle uses (the day number sits INSIDE a rounded square), so it can never float
// beside a cell or stack on another indicator. Which state shows is decided by deadlineIndex.markerState (overdue → upcoming → completed):
//   upcoming   soft red square (unchanged look)
//   overdue    light mode: black square, white number · dark mode: white square, black number
//   completed  green square, white number, with a purple check on a translucent lavender disc overlapping the top-right edge (reference image 8)

import type { CSSProperties } from 'react'
import type { DueState } from './dueStatus'

export { deadlineTitle } from './deadlineIndex'

const UPCOMING = { light: { bg: 'rgba(239,68,68,0.18)', border: 'rgba(220,38,38,0.50)', fg: '#991b1b' }, dark: { bg: 'rgba(248,113,113,0.24)', border: 'rgba(248,113,113,0.55)', fg: '#fecaca' } }
const OVERDUE = { light: { bg: '#111111', border: '#111111', fg: '#ffffff' }, dark: { bg: '#ffffff', border: '#ffffff', fg: '#000000' } }
const COMPLETED = { bg: '#16a34a', border: 'rgba(21,128,61,0.95)', fg: '#ffffff' }

/** Style for the day-number container (replaces the circle's look; the number stays inside it). `today` keeps today's ring on the SAME element. */
export function deadlineMarkerStyle(state: DueState, isDark: boolean, today = false): CSSProperties {
  const t = state === 'completed' ? COMPLETED : state === 'overdue' ? (isDark ? OVERDUE.dark : OVERDUE.light) : (isDark ? UPCOMING.dark : UPCOMING.light)
  return {
    background: t.bg, border: `1px solid ${t.border}`, borderRadius: '26%', color: t.fg, fontSize: '9px', fontWeight: 600,
    ...(today ? { outline: '1.5px solid var(--xp-acc)', outlineOffset: '1.5px' } : null),
  }
}

/** The purple check + translucent lavender backing, overlapping the marker's top-right edge. Render INSIDE the (positioned) marker element. */
export function CompletedBadge() {
  return (
    <span data-testid="deadline-check" aria-hidden="true"
      style={{ position: 'absolute', top: '-30%', right: '-30%', width: '58%', height: '58%', borderRadius: '50%', background: 'rgba(167,139,250,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', zIndex: 2 }}>
      <svg viewBox="0 0 24 24" width="88%" height="88%" fill="none" stroke="#7c3aed" strokeWidth="3.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 12.5 9.5 18 20 6" /></svg>
    </span>
  )
}

'use client'

// ── Calendar deadline marker (v1.328) ────────────────────────────────────────────────────────────────────────────────
// A soft, translucent red rounded square. Two placements, chosen per day cell so it NEVER sits on top of another indicator:
//   • "square"  — a plain day (no productive circle, no today ring, no fire/trophy/target): the day's number sits inside a
//                 rounded-square container (same slot the productive circle uses), so the date stays perfectly readable.
//   • "corner"  — every other day: a small dedicated rounded square in the cell's top-right corner, clear of the centred
//                 number/circle/emoji and of the horizontal streak connector (which only runs through the vertical middle).
// One marker per day however many deadlines fall on it (the tooltip lists them; the Day view holds one task per deadline).

import type { CSSProperties } from 'react'
import type { ScheduleEvent } from './scheduleLogic'

const LIGHT = { bg: 'rgba(239,68,68,0.18)', border: 'rgba(220,38,38,0.50)', fg: '#991b1b' }
const DARK  = { bg: 'rgba(248,113,113,0.24)', border: 'rgba(248,113,113,0.55)', fg: '#fecaca' }
const tone = (isDark: boolean) => (isDark ? DARK : LIGHT)

/** Tooltip text: "1 deadline: Title" / "3 deadlines: A, B, C". */
export function deadlineTitle(events: Pick<ScheduleEvent, 'title'>[]): string {
  const names = events.map(e => e.title).join(', ')
  return `${events.length} ${events.length === 1 ? 'deadline' : 'deadlines'}: ${names}`
}

/** Style for the day-number container on a plain day (replaces the circle's look; the number stays inside it). */
export function deadlineSquareStyle(isDark: boolean): CSSProperties {
  const t = tone(isDark)
  return { background: t.bg, border: `1px solid ${t.border}`, borderRadius: '26%', color: t.fg, fontSize: '9px', fontWeight: 600 }
}

/** The corner marker, for days that already carry another indicator. Decorative: the cell's own title/aria carries the text. */
export function DeadlineCorner({ events, isDark, pos = 'tr', size = 'md' }: { events: Pick<ScheduleEvent, 'title'>[]; isDark: boolean; pos?: 'tr' | 'br'; size?: 'md' | 'sm' }) {
  if (events.length === 0) return null
  const t = tone(isDark)
  return (
    <span
      className="xp-dl-corner" data-testid="deadline-corner" data-count={events.length} data-dark={isDark ? 'true' : 'false'} data-pos={pos} data-size={size} aria-hidden="true"
      style={{ borderRadius: '28%', background: t.bg, border: `1px solid ${t.border}`, zIndex: 0 /* beneath every existing indicator: if a tiny cell ever forces contact, the achievement visual stays intact on top */, pointerEvents: 'none' }}
    />
  )
}

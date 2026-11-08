// ── My Schedule — Month View logic (pure; no React, no persistence) ─────────────────────────────────────────────
// Month View is another representation of the SAME events the week view and Today tab use. Nothing here stores, fetches
// or changes events — it only decides which events fall on which date cell, and in what order.

import { addDays, daySlice, isSameLocalDay, monthWeeks, startOfDay, startOfMonth } from './scheduleLogic'
import type { ScheduleEvent, WeekStart } from './scheduleLogic'

export type ScheduleViewKey = 'schedule' | 'today' | 'month'
export const VIEW_PREF_KEY = 'xp-schedule-view'
const VIEW_KEYS: ScheduleViewKey[] = ['schedule', 'today', 'month']

/** Never fewer than five week rows (a short February would otherwise leave a hole), never more than six. */
export const MIN_MONTH_ROWS = 5

/** The weeks shown for `month`: every row is seven real dates, padded with the neighbouring months' days. */
export function monthGridWeeks(month: Date, weekStart: WeekStart = 0): Date[][] {
  const weeks = monthWeeks(month, weekStart)
  while (weeks.length < MIN_MONTH_ROWS) {
    const prev = weeks[weeks.length - 1]
    weeks.push(Array.from({ length: 7 }, (_, c) => addDays(prev[0], 7 + c)))
  }
  return weeks
}

/** Events on one date, chronological (an event that began on an earlier date sorts as if it started at midnight), one entry per event. */
export function monthDayEvents(events: ScheduleEvent[], day: Date): ScheduleEvent[] {
  const dayStart = startOfDay(day).getTime()
  return events
    .filter(e => daySlice(e, day) !== null)
    .sort((a, b) => Math.max(a.startAt, dayStart) - Math.max(b.startAt, dayStart) || a.startAt - b.startAt || a.endAt - b.endAt || a.id.localeCompare(b.id))
}

/** Where `ev` sits relative to `day`: starts here / continues from an earlier day / continues on to a later day. */
export function multiDayPosition(ev: ScheduleEvent, day: Date): { fromEarlier: boolean; intoLater: boolean } {
  const dayStart = startOfDay(day).getTime()
  const dayEnd = addDays(day, 1).getTime()
  return { fromEarlier: ev.startAt < dayStart, intoLater: ev.endAt > dayEnd }
}

export interface MonthCell {
  date: Date
  key: string                 // local YYYY-MM-DD
  inMonth: boolean
  isToday: boolean
  events: ScheduleEvent[]
}

export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** The whole grid: rows of cells, each with that date's (already filtered) events. */
export function buildMonthGrid(events: ScheduleEvent[], month: Date, today: Date, weekStart: WeekStart = 0): MonthCell[][] {
  const m = startOfMonth(month)
  return monthGridWeeks(m, weekStart).map(row => row.map(date => ({
    date, key: dateKey(date), inMonth: date.getMonth() === m.getMonth() && date.getFullYear() === m.getFullYear(),
    isToday: isSameLocalDay(date, today), events: monthDayEvents(events, date),
  })))
}

/** How many chips fit in a cell: when events overflow, one slot is given to the "+N more" row. Always shows at least one event. */
export function chipCapacity(total: number, fits: number): { shown: number; more: number } {
  const f = Math.max(1, Math.floor(fits))
  if (total <= f) return { shown: total, more: 0 }
  const shown = Math.max(1, f - 1)
  return { shown, more: total - shown }
}

/** Month navigation: keep the month's first day, so Jan 31 → Feb never skips a month and years roll over cleanly. */
export function shiftMonthStart(month: Date, delta: number): Date {
  return new Date(month.getFullYear(), month.getMonth() + delta, 1)
}

/** Parse a stored view preference defensively. */
export function parseViewPref(raw: unknown): ScheduleViewKey | null {
  return typeof raw === 'string' && (VIEW_KEYS as string[]).includes(raw) ? (raw as ScheduleViewKey) : null
}

export function readViewPref(): ScheduleViewKey | null {
  try { return parseViewPref(window.localStorage.getItem(VIEW_PREF_KEY)) } catch { return null }
}
export function writeViewPref(v: ScheduleViewKey): void {
  try { window.localStorage.setItem(VIEW_PREF_KEY, v) } catch { /* private mode / blocked storage: just don't remember */ }
}

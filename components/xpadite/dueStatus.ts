// ── Due-date status (v1.345) ─────────────────────────────────────────────────────────────────────────────────────────
// ONE pure calculation for every module (calendars, Day view, My Schedule, Task Manager popup), so no two screens can disagree.
// Nothing here is stored: the state is always derived from the due instant, whether the deadline is done, and when it was completed.
//
//   upcoming   — not done, the due instant is still ahead                    "Upcoming" / "Due today"
//   overdue    — not done, the due instant has passed                        "Overdue" / "Overdue · 3 days"
//   completed  — done; early / on time / late is judged from the REAL completion instant   "Completed · 2 days early", "Completed on time", "Completed · 2 days late"
//
// Day counts are calendar-day differences in the user's selected timezone (never 24h blocks, so daylight saving can not shift a label).
// A completion without a recorded instant (completed before v1.345) is shown as plain "Completed": no timestamp is ever invented.

export type DueState = 'upcoming' | 'overdue' | 'completed'
export type DueTiming = 'early' | 'on-time' | 'late' | 'unknown'

/** Stored on an event row when a deadline was completed but the moment was never recorded (done before v1.345): "completed", time unknown. Never shown as a time. */
export const COMPLETED_UNKNOWN = -1

export interface DueSubject { dueAt: number; done: boolean; completedAt?: number | null }
export interface DueInfo {
  state: DueState
  /** Short chip text. */
  label: string
  /** Completed only: how it compares with the deadline. */
  timing?: DueTiming
  /** Whole calendar days early / late / overdue (0 when same day). */
  days: number
  /** Not done and the due day is today. */
  dueToday?: boolean
}

/** A task's own due date (tasks that are not My Schedule deadlines). `time` is a wall-clock "HH:MM" in the selected timezone. */
export interface TaskDue { date: string; time?: string | null; dateOnly: boolean }

const DAY = 86_400_000
const dtfCache = new Map<string, Intl.DateTimeFormat>()
function dtf(tz: string, kind: 'date' | 'parts'): Intl.DateTimeFormat {
  const k = kind + '|' + tz
  let f = dtfCache.get(k)
  if (!f) {
    f = kind === 'date'
      ? new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
      : new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    dtfCache.set(k, f)
  }
  return f
}
const safeTz = (tz: string): string => { try { dtf(tz, 'date'); return tz } catch { return 'UTC' } }

/** "YYYY-MM-DD" of an instant as it reads in `tz`. */
export function dayKeyInTz(ms: number, tz: string): string {
  const parts = dtf(safeTz(tz), 'date').formatToParts(new Date(ms))
  const g = (t: string) => parts.find(p => p.type === t)?.value ?? '00'
  return `${g('year')}-${g('month')}-${g('day')}`
}

export function offsetAt(ms: number, tz: string): number {
  const parts = dtf(tz, 'parts').formatToParts(new Date(ms))
  const g = (t: string) => Number(parts.find(p => p.type === t)?.value ?? 0)
  const asUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second'))
  return asUtc - Math.floor(ms / 1000) * 1000
}

export function addDaysKey(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

/** Whole calendar days from key `a` to key `b` (b − a). */
export function dayDiff(a: string, b: string): number {
  const [ya, ma, da] = a.split('-').map(Number), [yb, mb, db] = b.split('-').map(Number)
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / DAY)
}

/** The instant at which the wall clock in `tz` reads `date` + `hhmm` (DST-safe: re-checks the offset at the guess). */
export function zonedInstant(date: string, hhmm: string, tz: string): number {
  const z = safeTz(tz)
  const [y, m, d] = date.split('-').map(Number)
  const [h, mi] = (/^\d{1,2}:\d{2}$/.test(hhmm) ? hhmm : '00:00').split(':').map(Number)
  const guess = Date.UTC(y, m - 1, d, h, mi, 0, 0)
  const t1 = guess - offsetAt(guess, z)
  return guess - offsetAt(t1, z)
}

/** The last millisecond of a calendar day in `tz` (a date-only deadline stays valid through the end of its date). */
export function endOfDayInstant(date: string, tz: string): number {
  return zonedInstant(addDaysKey(date, 1), '00:00', tz) - 1
}

/** The due instant of a task's own due date. */
export function taskDueInstant(due: TaskDue, tz: string): number {
  return due.dateOnly || !due.time ? endOfDayInstant(due.date, tz) : zonedInstant(due.date, due.time, tz)
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

/** The one status calculation. `now` and every day boundary use the selected timezone `tz`. */
export function dueInfo(s: DueSubject, now: number, tz: string): DueInfo {
  const dueDay = dayKeyInTz(s.dueAt, tz)
  if (s.done) {
    const c = s.completedAt
    if (typeof c !== 'number' || !Number.isFinite(c)) return { state: 'completed', label: 'Completed', timing: 'unknown', days: 0 }
    const doneDay = dayKeyInTz(c, tz)
    if (c <= s.dueAt) {
      const d = dayDiff(doneDay, dueDay)
      return d === 0 ? { state: 'completed', label: 'Completed on time', timing: 'on-time', days: 0 }
        : { state: 'completed', label: `Completed · ${plural(d, 'day')} early`, timing: 'early', days: d }
    }
    const d = dayDiff(dueDay, doneDay)
    return d > 0 ? { state: 'completed', label: `Completed · ${plural(d, 'day')} late`, timing: 'late', days: d }
      : { state: 'completed', label: 'Completed late', timing: 'late', days: 0 }
  }
  const today = dayKeyInTz(now, tz)
  if (now > s.dueAt) {
    const d = dayDiff(dueDay, today)
    return { state: 'overdue', label: d > 0 ? `Overdue · ${plural(d, 'day')}` : 'Overdue', days: Math.max(0, d) }
  }
  return today === dueDay ? { state: 'upcoming', label: 'Due today', days: 0, dueToday: true } : { state: 'upcoming', label: 'Upcoming', days: 0 }
}

/** The fields a task gets when it becomes done / not done: the REAL completion instant on completion, cleared on reopening. Spread it into the task. */
export function completionPatch(nextDone: boolean, now: number = Date.now()): { done: boolean; completedAt: number | null } {
  return nextDone ? { done: true, completedAt: now } : { done: false, completedAt: null }
}

/** "Fri, Nov 13, 2026" — the day an instant falls on in `tz`. */
export function formatDueDate(ms: number, tz: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: safeTz(tz), weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(ms))
}
/** "6:00 PM" / "18:00" — the clock time of an instant in `tz`. */
export function formatDueTime(ms: number, tz: string, hour12 = true): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: safeTz(tz), hour: hour12 ? 'numeric' : '2-digit', minute: '2-digit', hourCycle: hour12 ? 'h12' : 'h23' }).format(new Date(ms))
}

/** "Thu, Nov 12, 2026" for a plain calendar date key (no timezone involved: the key IS the date). */
export function formatDayKey(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(Date.UTC(y, m - 1, d)))
}

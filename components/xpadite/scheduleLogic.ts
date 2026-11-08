// ── My Schedule — pure date / layout / validation helpers (frontend V1) ─────
// No React, no storage, no network: everything here is deterministic so it can be unit-tested directly
// (tests/schedule/scheduleLogic.test.cjs). Events are plain objects; nothing in this file persists them.

import type { XpaditeMeeting } from './meetingsMockData'

/** The six built-in ids, plus any custom category id (custom ids are generated and never collide with these). */
export type DefaultCategoryId = 'lecture' | 'meeting' | 'assignment' | 'study' | 'personal' | 'other'
export type ScheduleCategoryId = string
export type ScheduleRecurrence = 'none' | 'daily' | 'weekly' | 'monthly'
export type ScheduleSource = 'google' | 'microsoft'

export interface ScheduleEvent {
  id: string
  title: string
  category: ScheduleCategoryId
  /** Epoch ms */
  startAt: number
  /** Epoch ms */
  endAt: number
  location?: string
  meetingUrl?: string
  notes?: string
  /** Minutes before the start, 0 = at start time, null/undefined = no reminder. */
  reminderMins?: number | null
  recurrence?: ScheduleRecurrence
  /** Synced from an external calendar — can be viewed but not edited/deleted here. */
  readOnly?: boolean
  /** Shown for read-only events, e.g. "Google Calendar". */
  sourceLabel?: string
  /** Which connected calendar a synced event came from (undefined for events made in XPadite). */
  source?: ScheduleSource
  isCancelled?: boolean
  /**
   * v1.328 — the event is also a deadline. The due date/time is NOT stored separately: it is always this event's own endAt
   * (the authoritative end instant), so editing the end moves the deadline and nothing can drift.
   */
  isDeadline?: boolean
  /** v1.328: 'detached' = the user removed this deadline's Task Manager task on purpose (the deadline itself stays). */
  taskLink?: 'linked' | 'detached'
}

export interface ScheduleCategory {
  id: ScheduleCategoryId
  label: string
  /** Pastel fill, accent edge and readable text colour — identical on the grid, legend and detail panel. */
  bg: string
  edge: string
  text: string
  /** The six originals - protected from rename / recolour / delete. */
  builtIn?: boolean
}

export const SCHEDULE_CATEGORIES: ScheduleCategory[] = [
  { id: 'lecture',    label: 'Lecture / Class',   bg: '#e4d4fb', edge: '#a78bfa', text: '#4c1d95', builtIn: true },
  { id: 'meeting',    label: 'Meeting',           bg: '#bff5d9', edge: '#34d399', text: '#065f46', builtIn: true },
  { id: 'assignment', label: 'Assignment / Test', bg: '#fbd3ea', edge: '#f472b6', text: '#831843', builtIn: true },
  { id: 'study',      label: 'Study / Focus',     bg: '#c3e2fb', edge: '#60a5fa', text: '#1e3a8a', builtIn: true },
  { id: 'personal',   label: 'Personal',          bg: '#fbf6a8', edge: '#e0b81a', text: '#713f12', builtIn: true },
  { id: 'other',      label: 'Other',             bg: '#fddbae', edge: '#fb923c', text: '#7c2d12', builtIn: true },
]

/** Looks `id` up in `list` (default: the six built-ins); an unknown id falls back to Other so nothing is ever unstyled. */
export function categoryMeta(id: ScheduleCategoryId, list: ScheduleCategory[] = SCHEDULE_CATEGORIES): ScheduleCategory {
  return list.find(c => c.id === id) ?? SCHEDULE_CATEGORIES[SCHEDULE_CATEGORIES.length - 1]
}

// -- Preferences (frontend-only, in memory) ---------------------------------

export type TimeFormat = '12h' | '24h'
export type WeekStart = 0 | 1   // 0 = Sunday, 1 = Monday

export interface SchedulePrefs {
  defaultDurationMins: number
  weekStart: WeekStart
  timeFormat: TimeFormat
}

export const DEFAULT_PREFS: SchedulePrefs = { defaultDurationMins: 60, weekStart: 0, timeFormat: '12h' }
export const DURATION_CHOICES = [15, 30, 45, 60, 90, 120]

/** Coerces anything into a valid prefs object (unknown / out-of-range values fall back to the defaults). */
export function sanitizePrefs(p: Partial<SchedulePrefs> | null | undefined): SchedulePrefs {
  const dur = p?.defaultDurationMins
  return {
    defaultDurationMins: typeof dur === 'number' && DURATION_CHOICES.includes(dur) ? dur : DEFAULT_PREFS.defaultDurationMins,
    weekStart: p?.weekStart === 1 ? 1 : 0,
    timeFormat: p?.timeFormat === '24h' ? '24h' : '12h',
  }
}

export const REMINDER_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: 'No reminder' },
  { value: 0,    label: 'At start time' },
  { value: 5,    label: '5 minutes before' },
  { value: 10,   label: '10 minutes before' },
  { value: 15,   label: '15 minutes before' },
  { value: 30,   label: '30 minutes before' },
  { value: 60,   label: '1 hour before' },
  { value: 1440, label: '1 day before' },
]

export const RECURRENCE_OPTIONS: { value: ScheduleRecurrence; label: string }[] = [
  { value: 'none',    label: 'Does not repeat' },
  { value: 'daily',   label: 'Every day' },
  { value: 'weekly',  label: 'Every week' },
  { value: 'monthly', label: 'Every month' },
]

export function reminderLabel(mins: number | null | undefined): string | null {
  if (mins === null || mins === undefined) return null
  return REMINDER_OPTIONS.find(o => o.value === mins)?.label ?? `${mins} minutes before`
}

export function recurrenceLabel(r: ScheduleRecurrence | undefined): string | null {
  if (!r || r === 'none') return null
  return RECURRENCE_OPTIONS.find(o => o.value === r)?.label ?? null
}

// ── Dates ───────────────────────────────────────────────────────────────────

export const DAY_MINUTES = 24 * 60
export const MINUTE_MS = 60_000

export function isSameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/** Local midnight of the given date (new object). */
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/** The first day of the week (Sunday, or Monday when `weekStart` is 1) on/before `d`, at local midnight. Calendar arithmetic, so month/year/DST boundaries are exact. */
export function startOfWeek(d: Date, weekStart: WeekStart = 0): Date {
  const back = (d.getDay() - weekStart + 7) % 7
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - back)
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
}

/** The seven days of the week containing `anchor` (Sun → Sat, or Mon → Sun). */
export function weekDays(anchor: Date, weekStart: WeekStart = 0): Date[] {
  const s = startOfWeek(anchor, weekStart)
  return Array.from({ length: 7 }, (_, i) => addDays(s, i))
}

/** Same day-of-month in the previous/next month, clamped to that month's length (Jan 31 + 1 → Feb 28/29). */
export function shiftMonth(d: Date, delta: number): Date {
  const target = new Date(d.getFullYear(), d.getMonth() + delta, 1)
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  return new Date(target.getFullYear(), target.getMonth(), Math.min(d.getDate(), last))
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export function monthYearLabel(d: Date): string {
  return `${MONTH_LONG[d.getMonth()]} ${d.getFullYear()}`
}

/** Compact form for phones: "Nov 2026". */
export function monthYearShort(d: Date): string {
  return `${MONTH_SHORT[d.getMonth()]} ${d.getFullYear()}`
}

/** "Nov 1 – Nov 7", "Oct 25 – Oct 31" or, across a year end, "Dec 27, 2026 – Jan 2, 2027". */
/** Phone-width form: "Nov 1–7", "Oct 25–Nov 1", "Dec 27–Jan 2" (the year is left out; the month label beside it carries it). */
export function weekRangeShort(anchor: Date, weekStart: WeekStart = 0): string {
  const days = weekDays(anchor, weekStart)
  const a = days[0], b = days[6]
  return a.getMonth() === b.getMonth()
    ? `${MONTH_SHORT[a.getMonth()]} ${a.getDate()}–${b.getDate()}`
    : `${MONTH_SHORT[a.getMonth()]} ${a.getDate()}–${MONTH_SHORT[b.getMonth()]} ${b.getDate()}`
}

export function weekRangeLabel(anchor: Date, weekStart: WeekStart = 0): string {
  const days = weekDays(anchor, weekStart)
  const a = days[0], b = days[6]
  if (a.getFullYear() !== b.getFullYear()) {
    return `${MONTH_SHORT[a.getMonth()]} ${a.getDate()}, ${a.getFullYear()} – ${MONTH_SHORT[b.getMonth()]} ${b.getDate()}, ${b.getFullYear()}`
  }
  return `${MONTH_SHORT[a.getMonth()]} ${a.getDate()} – ${MONTH_SHORT[b.getMonth()]} ${b.getDate()}`
}

export function shortDayLabel(d: Date): string {
  return `${MONTH_SHORT[d.getMonth()]} ${d.getDate()}`
}

/** 0 → "12 AM", 5 → "5 AM", 12 → "12 PM", 23 → "11 PM" (or "00:00" … "23:00" in 24-hour time). */
export function hourLabel(h: number, fmt?: TimeFormat | number): string {
  const hh = ((h % 24) + 24) % 24
  if (fmt === '24h') return `${String(hh).padStart(2, '0')}:00`
  const suffix = hh < 12 ? 'AM' : 'PM'
  const h12 = hh % 12 === 0 ? 12 : hh % 12
  return `${h12} ${suffix}`
}

export function clockLabel(ts: number, fmt?: TimeFormat | number): string {
  const d = new Date(ts)
  const h = d.getHours(), m = d.getMinutes()
  if (fmt === '24h') return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

export function timeRangeLabel(startAt: number, endAt: number, fmt?: TimeFormat): string {
  return `${clockLabel(startAt, fmt)} – ${clockLabel(endAt, fmt)}`
}

export function durationLabel(startAt: number, endAt: number): string {
  const mins = Math.max(0, Math.round((endAt - startAt) / MINUTE_MS))
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60), m = mins % 60
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`
}

export function longDateLabel(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

// ── Grid layout ─────────────────────────────────────────────────────────────

/** Visual height floor so a 15-minute event is still a tappable block. */
export const MIN_BLOCK_MINUTES = 20

export interface PositionedEvent {
  event: ScheduleEvent
  /** Minutes from midnight at the top / bottom edge of this day's slice of the event. */
  startMin: number
  endMin: number
  /** Side-by-side lane inside its overlap cluster, and how many lanes that cluster has. */
  lane: number
  lanes: number
}

function wallMinutes(ts: number): number {
  const d = new Date(ts)
  return d.getHours() * 60 + d.getMinutes()
}

/**
 * Slice of `ev` that falls on `day`, in minutes from that day's midnight — or null when it doesn't touch the day.
 * Events running past midnight are clipped to each day they cover (so they render on both days).
 */
export function daySlice(ev: ScheduleEvent, day: Date): { startMin: number; endMin: number } | null {
  if (!(ev.endAt > ev.startAt)) return null
  const dayStart = startOfDay(day).getTime()
  const dayEnd = addDays(day, 1).getTime()
  if (ev.endAt <= dayStart || ev.startAt >= dayEnd) return null
  const startMin = ev.startAt >= dayStart ? wallMinutes(ev.startAt) : 0
  const endMin = ev.endAt <= dayEnd ? (ev.endAt === dayEnd ? DAY_MINUTES : wallMinutes(ev.endAt)) : DAY_MINUTES
  return { startMin, endMin: Math.max(endMin, startMin + 1) }
}

/**
 * Positions one day's events and assigns side-by-side lanes so overlapping events never cover each other.
 * Events are grouped into clusters of transitively overlapping events; each cluster shares one lane count.
 */
export function layoutDayEvents(events: ScheduleEvent[], day: Date): PositionedEvent[] {
  const slices = events
    .map(event => ({ event, s: daySlice(event, day) }))
    .filter((x): x is { event: ScheduleEvent; s: { startMin: number; endMin: number } } => x.s !== null)
    .map(x => ({
      event: x.event,
      startMin: x.s.startMin,
      // the block is drawn at least MIN_BLOCK_MINUTES tall, so overlap is judged on that drawn height
      endMin: Math.min(DAY_MINUTES, Math.max(x.s.endMin, x.s.startMin + MIN_BLOCK_MINUTES)),
    }))
    .sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin || a.event.id.localeCompare(b.event.id))

  const out: PositionedEvent[] = []
  let cluster: PositionedEvent[] = []
  let clusterEnd = -1
  let laneEnds: number[] = []

  const flush = () => {
    const lanes = Math.max(1, laneEnds.length)
    for (const p of cluster) { p.lanes = lanes; out.push(p) }
    cluster = []; laneEnds = []; clusterEnd = -1
  }

  for (const s of slices) {
    if (cluster.length > 0 && s.startMin >= clusterEnd) flush()
    let lane = laneEnds.findIndex(end => end <= s.startMin)
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(s.endMin) } else laneEnds[lane] = s.endMin
    cluster.push({ event: s.event, startMin: s.startMin, endMin: s.endMin, lane, lanes: 1 })
    clusterEnd = Math.max(clusterEnd, s.endMin)
  }
  if (cluster.length > 0) flush()
  return out
}

// ── Filtering ───────────────────────────────────────────────────────────────

/** The single combined filter dropdown: All, one of the six categories, or (at the bottom) one connected calendar. */
export type CombinedFilter = string   // 'all' | a category id (built-in or custom) | 'google' | 'microsoft'

export const FILTER_OPTIONS: { value: CombinedFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  ...SCHEDULE_CATEGORIES.map(c => ({ value: c.id as CombinedFilter, label: c.label })),
  { value: 'google', label: 'Google Calendar' },
  { value: 'microsoft', label: 'Outlook' },
]

/** The dropdown options for the current category list (built-ins, then custom ones), with the connected calendars last. */
export function filterOptions(categories: ScheduleCategory[]): { value: CombinedFilter; label: string }[] {
  return [
    { value: 'all', label: 'All' },
    ...categories.map(c => ({ value: c.id as CombinedFilter, label: c.label })),
    { value: 'google', label: 'Google Calendar' },
    { value: 'microsoft', label: 'Outlook' },
  ]
}

/** Splits the combined dropdown value into the two independent tests filterScheduleEvents applies. */
export function splitFilter(v: CombinedFilter): { category: ScheduleCategoryId | 'all'; source: ScheduleSource | 'all' } {
  if (v === 'google' || v === 'microsoft') return { category: 'all', source: v }
  return { category: v, source: 'all' }
}

export interface ScheduleFilters {
  query: string
  /** A single category chosen in the dropdown, or 'all'. */
  category: ScheduleCategoryId | 'all'
  /** A single connected calendar chosen in the dropdown, or 'all'. Events made in XPadite have no source. */
  source?: ScheduleSource | 'all'
  /** Categories switched off with the legend checkboxes (hides blocks; never deletes events). */
  hidden: ScheduleCategoryId[]
  /** Calendars switched off in the phone Filter sheet: 'xpadite' (events made here), 'google', 'microsoft'. Hides blocks; never deletes events. */
  hiddenSources?: string[]
  /** Category list used to make category names searchable (default: the six built-ins). */
  categories?: ScheduleCategory[]
}

export function filterScheduleEvents(events: ScheduleEvent[], f: ScheduleFilters): ScheduleEvent[] {
  const q = f.query.trim().toLowerCase()
  return events.filter(ev => {
    if (f.category !== 'all' && ev.category !== f.category) return false
    if (f.source && f.source !== 'all' && ev.source !== f.source) return false
    if (f.hidden.includes(ev.category)) return false
    if (f.hiddenSources && f.hiddenSources.length > 0 && f.hiddenSources.includes(ev.source ?? 'xpadite')) return false
    if (!q) return true
    const hay = `${ev.title} ${ev.location ?? ''} ${ev.notes ?? ''} ${categoryMeta(ev.category, f.categories).label}`.toLowerCase()
    return hay.includes(q)
  })
}

/** A synced meeting as a read-only "Meeting" schedule event (id prefixed so it can never collide with an XPadite event). */
export function meetingToScheduleEvent(m: XpaditeMeeting): ScheduleEvent {
  return {
    id: `meeting:${m.id}`,
    title: m.title,
    category: 'meeting',
    startAt: m.startAt,
    endAt: m.endAt,
    meetingUrl: m.meetingUrl ?? undefined,
    notes: m.notes || undefined,
    readOnly: true,
    sourceLabel: m.calendarSource,
    source: m.provider,
    isCancelled: m.isCancelled,
  }
}

// ── Day agenda / mini calendar ──────────────────────────────────────────────

/** Events that touch `day`, earliest first. */
export function eventsOnDay(events: ScheduleEvent[], day: Date): ScheduleEvent[] {
  return events.filter(e => daySlice(e, day) !== null).sort((a, b) => a.startAt - b.startAt || a.endAt - b.endAt)
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

/**
 * Rows of seven real dates (Sun → Sat) covering `month`, including the leading/trailing days of the neighbouring months so
 * every row — including the first and last — is a genuine week.
 */
export function monthWeeks(month: Date, weekStart: WeekStart = 0): Date[][] {
  const first = startOfMonth(month)
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0)
  const start = startOfWeek(first, weekStart)
  const rows = Math.ceil((((first.getDay() - weekStart + 7) % 7) + last.getDate()) / 7)
  return Array.from({ length: rows }, (_, r) => Array.from({ length: 7 }, (_, c) => addDays(start, r * 7 + c)))
}

/** Index of the row of `monthWeeks(month)` that contains `day` (the collapsed mini calendar shows exactly this row), or -1. */
export function weekRowIndex(month: Date, day: Date, weekStart: WeekStart = 0): number {
  return monthWeeks(month, weekStart).findIndex(row => row.some(d => isSameLocalDay(d, day)))
}

// ── Links ───────────────────────────────────────────────────────────────────

/** Returns a normalised http(s) URL, or null. Anything else (javascript:, data:, bare text) is rejected. */
export function safeHttpUrl(raw: string | undefined | null): string | null {
  const s = (raw ?? '').trim()
  if (!s) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`
  try {
    const u = new URL(withScheme)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    if (!u.hostname.includes('.')) return null
    return u.toString()
  } catch { return null }
}

export function meetingLinkLabel(url: string): string {
  let host = ''
  try { host = new URL(url).hostname.replace(/^www\./, '') } catch { return url }
  if (host.endsWith('meet.google.com')) return 'Google Meet'
  if (host.endsWith('zoom.us')) return 'Zoom'
  if (host.endsWith('teams.microsoft.com') || host.endsWith('teams.live.com')) return 'Microsoft Teams'
  return host
}

// ── Add / Edit form ─────────────────────────────────────────────────────────

export interface ScheduleFormValues {
  title: string
  /** Start date, YYYY-MM-DD */
  date: string
  /** End date, YYYY-MM-DD. Equal to `date` for same-day events; the next day (or later) for events that run past midnight. */
  endDate: string
  /** HH:MM (24h) */
  start: string
  end: string
  category: ScheduleCategoryId
  location: string
  meetingUrl: string
  notes: string
  reminderMins: number | null
  recurrence: ScheduleRecurrence
  /** "Set as Due Date" pill: the end date/time above is the due date/time. */
  isDeadline?: boolean
}

export type ScheduleFormErrors = Partial<Record<'title' | 'date' | 'endDate' | 'start' | 'end' | 'meetingUrl', string>>

/** The longest single event the form accepts (guards against a mistyped end date). */
export const MAX_EVENT_DAYS = 7

const pad2 = (n: number) => String(n).padStart(2, '0')

export function toDateInput(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

export function toTimeInput(ts: number): string {
  const d = new Date(ts)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/** Local timestamp for a YYYY-MM-DD + HH:MM pair, or null when either is malformed / not a real date. */
export function parseLocal(date: string, time: string): number | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  const tm = /^(\d{2}):(\d{2})$/.exec(time)
  if (!dm || !tm) return null
  const y = +dm[1], mo = +dm[2], d = +dm[3], h = +tm[1], mi = +tm[2]
  if (h > 23 || mi > 59) return null
  const dt = new Date(y, mo - 1, d, h, mi)
  // reject rollovers such as 2026-02-31
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null
  // reject a wall-clock time that does not exist (the hour skipped when clocks spring forward) instead of silently shifting it
  if (dt.getHours() !== h || dt.getMinutes() !== mi) return null
  return dt.getTime()
}

export function validateScheduleForm(v: ScheduleFormValues): ScheduleFormErrors {
  const errors: ScheduleFormErrors = {}
  if (!v.title.trim()) errors.title = 'Give your event a title.'
  const endDate = v.endDate || v.date
  const startOk = parseLocal(v.date, v.start)
  const endOk = parseLocal(endDate, v.end)
  if (!v.date || parseLocal(v.date, '00:00') === null) errors.date = 'Choose a valid date.'
  if (v.endDate && parseLocal(v.endDate, '00:00') === null) errors.endDate = 'Choose a valid end date.'
  if (!v.start || (!errors.date && startOk === null)) errors.start = 'Choose a start time.'
  if (!v.end || (!errors.endDate && !errors.date && endOk === null)) errors.end = 'Choose an end time.'
  if (!errors.date && !errors.endDate && !errors.start && !errors.end && startOk !== null && endOk !== null) {
    if (endOk <= startOk) {
      errors.end = endDate === v.date
        ? 'End time must be after the start time. If it finishes on another day, use \u201cEnds on a different day\u201d.'
        : 'The end must be after the start.'
    } else if (endOk - startOk > MAX_EVENT_DAYS * DAY_MINUTES * MINUTE_MS) {
      errors.endDate = `Events can be at most ${MAX_EVENT_DAYS} days long.`
    }
  }
  if (v.meetingUrl.trim() && !safeHttpUrl(v.meetingUrl)) errors.meetingUrl = 'Enter a valid link, e.g. https://meet.google.com/abc-defg-hij'
  return errors
}

export function formToEventFields(v: ScheduleFormValues): Omit<ScheduleEvent, 'id'> {
  const startAt = parseLocal(v.date, v.start) as number
  const endAt = parseLocal(v.endDate || v.date, v.end) as number
  const url = safeHttpUrl(v.meetingUrl)
  return {
    title: v.title.trim(),
    category: v.category,
    startAt, endAt,
    location: v.location.trim() || undefined,
    meetingUrl: url ?? undefined,
    notes: v.notes.trim() || undefined,
    reminderMins: v.reminderMins,
    recurrence: v.recurrence,
    isDeadline: v.isDeadline ? true : undefined,
  }
}

export function eventToForm(ev: ScheduleEvent): ScheduleFormValues {
  return {
    title: ev.title,
    date: toDateInput(ev.startAt),
    endDate: toDateInput(ev.endAt),
    start: toTimeInput(ev.startAt),
    end: toTimeInput(ev.endAt),
    category: ev.category,
    location: ev.location ?? '',
    meetingUrl: ev.meetingUrl ?? '',
    notes: ev.notes ?? '',
    reminderMins: ev.reminderMins ?? null,
    recurrence: ev.recurrence ?? 'none',
    isDeadline: ev.isDeadline ? true : false,
  }
}

/** A blank Add form starting at `startMin` (minutes from midnight) and lasting `durationMins`, ending no later than 23:59 the same day. */
export function blankFormAt(day: Date, startMin: number, durationMins = DEFAULT_PREFS.defaultDurationMins): ScheduleFormValues {
  const sMin = Math.min(Math.max(0, Math.round(startMin)), 24 * 60 - 2)
  const eMin = Math.min(sMin + Math.max(1, durationMins), 24 * 60 - 1)
  const s = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, sMin)
  const e = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, eMin)
  return {
    title: '', date: toDateInput(s.getTime()), endDate: toDateInput(s.getTime()), start: toTimeInput(s.getTime()), end: toTimeInput(e.getTime()),
    category: 'meeting', location: '', meetingUrl: '', notes: '', reminderMins: null, recurrence: 'none', isDeadline: false,
  }
}

/** The Add button's default: `requestedHour` (9 AM), pulled earlier when the default block would not fit before midnight. */
export function blankForm(day: Date, requestedHour = 9, durationMins = DEFAULT_PREFS.defaultDurationMins): ScheduleFormValues {
  const latestStart = Math.floor((24 * 60 - 1 - Math.max(1, durationMins)) / 15) * 15
  return blankFormAt(day, Math.min(Math.max(requestedHour, 0) * 60, Math.max(0, latestStart)), durationMins)
}

// -- Saved locations (v1.328) -------------------------------------------------------------------------------------

export const MAX_SAVED_LOCATIONS = 50

/** Comparison key: trimmed, inner whitespace collapsed, case-insensitive. "Room  204" and "room 204" are the same place. */
export function normalizeLocation(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase()
}

export type SaveLocationStatus = 'added' | 'empty' | 'duplicate' | 'full'

/** Adds `raw` to the saved list (never mutates). Empty / duplicate / over-limit entries leave the list unchanged and say why. */
export function addSavedLocation(list: string[], raw: string): { list: string[]; status: SaveLocationStatus; value: string } {
  const value = raw.trim().replace(/\s+/g, ' ').slice(0, 120)
  if (!value) return { list, status: 'empty', value }
  const key = normalizeLocation(value)
  if (list.some(l => normalizeLocation(l) === key)) return { list, status: 'duplicate', value }
  if (list.length >= MAX_SAVED_LOCATIONS) return { list, status: 'full', value }
  return { list: [...list, value], status: 'added', value }
}

/** Removes one saved location. Scheduled events keep their own copy of the text, so none are touched. */
export function removeSavedLocation(list: string[], value: string): string[] {
  const key = normalizeLocation(value)
  return list.filter(l => normalizeLocation(l) !== key)
}

/** Coerces whatever was stored into a clean, de-duplicated list of strings. */
export function sanitizeSavedLocations(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  let out: string[] = []
  for (const r of raw) if (typeof r === 'string') out = addSavedLocation(out, r).list
  return out
}

// -- Time text (24-hour values in the form, shown in the user's chosen format) ----------------------------------

/** "14:30" → "2:30 PM" (12h) or "14:30" (24h). Anything that is not HH:MM gives ''. */
export function formatTimeValue(hhmm: string, fmt: TimeFormat = '12h'): string {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm)
  if (!m) return ''
  const h = +m[1], mi = +m[2]
  if (h > 23 || mi > 59) return ''
  if (fmt === '24h') return `${m[1]}:${m[2]}`
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`
}

/**
 * Reads what a person types into a time field: "2:30 pm", "2pm", "14:30", "1430", "9", "930a". Returns 24-hour "HH:MM", or null.
 * Without am/pm the number is read as 24-hour time ("9" = 09:00, "14" = 14:00).
 */
export function parseTimeText(raw: string): string | null {
  const s = raw.trim().toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ')
  const m = /^(\d{1,2})(?::?(\d{2}))?\s?(a|p|am|pm)?$/.exec(s)
  if (!m) return null
  let h = +m[1]
  const mi = m[2] ? +m[2] : 0
  if (mi > 59) return null
  if (m[3]) {
    if (h < 1 || h > 12) return null
    h = h % 12 + (m[3][0] === 'p' ? 12 : 0)
  } else if (h > 23) return null
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`
}

/** Every `stepMin` minutes of the day as "HH:MM" (suggestions for the time fields). */
export function timeOptions(stepMin = 15): string[] {
  const out: string[] = []
  for (let m = 0; m < DAY_MINUTES; m += stepMin) out.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`)
  return out
}

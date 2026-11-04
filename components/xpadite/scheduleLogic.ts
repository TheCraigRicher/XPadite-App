// ── My Schedule — pure date / layout / validation helpers (frontend V1) ─────
// No React, no storage, no network: everything here is deterministic so it can be unit-tested directly
// (tests/schedule/scheduleLogic.test.cjs). Events are plain objects; nothing in this file persists them.

export type ScheduleCategoryId = 'lecture' | 'meeting' | 'assignment' | 'study' | 'personal' | 'other'
export type ScheduleRecurrence = 'none' | 'daily' | 'weekly' | 'monthly'

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
  isCancelled?: boolean
}

export interface ScheduleCategory {
  id: ScheduleCategoryId
  label: string
  /** Pastel fill, accent edge and readable text colour — identical on the grid, legend and detail panel. */
  bg: string
  edge: string
  text: string
}

export const SCHEDULE_CATEGORIES: ScheduleCategory[] = [
  { id: 'lecture',    label: 'Lecture / Class',   bg: '#e4d4fb', edge: '#a78bfa', text: '#4c1d95' },
  { id: 'meeting',    label: 'Meeting',           bg: '#bff5d9', edge: '#34d399', text: '#065f46' },
  { id: 'assignment', label: 'Assignment / Test', bg: '#fbd3ea', edge: '#f472b6', text: '#831843' },
  { id: 'study',      label: 'Study / Focus',     bg: '#c3e2fb', edge: '#60a5fa', text: '#1e3a8a' },
  { id: 'personal',   label: 'Personal',          bg: '#fbf6a8', edge: '#e0b81a', text: '#713f12' },
  { id: 'other',      label: 'Other',             bg: '#fddbae', edge: '#fb923c', text: '#7c2d12' },
]

export function categoryMeta(id: ScheduleCategoryId): ScheduleCategory {
  return SCHEDULE_CATEGORIES.find(c => c.id === id) ?? SCHEDULE_CATEGORIES[SCHEDULE_CATEGORIES.length - 1]
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

/** The Sunday on/before `d`, at local midnight. Uses calendar arithmetic, so month/year/DST boundaries are exact. */
export function startOfWeek(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay())
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
}

/** The seven days (Sun → Sat) of the week containing `anchor`. */
export function weekDays(anchor: Date): Date[] {
  const s = startOfWeek(anchor)
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
export function weekRangeLabel(anchor: Date): string {
  const days = weekDays(anchor)
  const a = days[0], b = days[6]
  if (a.getFullYear() !== b.getFullYear()) {
    return `${MONTH_SHORT[a.getMonth()]} ${a.getDate()}, ${a.getFullYear()} – ${MONTH_SHORT[b.getMonth()]} ${b.getDate()}, ${b.getFullYear()}`
  }
  return `${MONTH_SHORT[a.getMonth()]} ${a.getDate()} – ${MONTH_SHORT[b.getMonth()]} ${b.getDate()}`
}

export function shortDayLabel(d: Date): string {
  return `${MONTH_SHORT[d.getMonth()]} ${d.getDate()}`
}

/** 0 → "12 AM", 5 → "5 AM", 12 → "12 PM", 23 → "11 PM". */
export function hourLabel(h: number): string {
  const hh = ((h % 24) + 24) % 24
  const suffix = hh < 12 ? 'AM' : 'PM'
  const h12 = hh % 12 === 0 ? 12 : hh % 12
  return `${h12} ${suffix}`
}

export function clockLabel(ts: number): string {
  const d = new Date(ts)
  const h = d.getHours(), m = d.getMinutes()
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

export function timeRangeLabel(startAt: number, endAt: number): string {
  return `${clockLabel(startAt)} – ${clockLabel(endAt)}`
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

export interface ScheduleFilters {
  query: string
  /** A single category chosen in the toolbar dropdown, or 'all'. */
  category: ScheduleCategoryId | 'all'
  /** Categories switched off with the legend checkboxes (hides blocks; never deletes events). */
  hidden: ScheduleCategoryId[]
}

export function filterScheduleEvents(events: ScheduleEvent[], f: ScheduleFilters): ScheduleEvent[] {
  const q = f.query.trim().toLowerCase()
  return events.filter(ev => {
    if (f.category !== 'all' && ev.category !== f.category) return false
    if (f.hidden.includes(ev.category)) return false
    if (!q) return true
    const hay = `${ev.title} ${ev.location ?? ''} ${ev.notes ?? ''} ${categoryMeta(ev.category).label}`.toLowerCase()
    return hay.includes(q)
  })
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
  /** YYYY-MM-DD */
  date: string
  /** HH:MM (24h) */
  start: string
  end: string
  category: ScheduleCategoryId
  location: string
  meetingUrl: string
  notes: string
  reminderMins: number | null
  recurrence: ScheduleRecurrence
}

export type ScheduleFormErrors = Partial<Record<'title' | 'date' | 'start' | 'end' | 'meetingUrl', string>>

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
  return dt.getTime()
}

export function validateScheduleForm(v: ScheduleFormValues): ScheduleFormErrors {
  const errors: ScheduleFormErrors = {}
  if (!v.title.trim()) errors.title = 'Give your event a title.'
  const startOk = parseLocal(v.date, v.start)
  const endOk = parseLocal(v.date, v.end)
  if (!v.date || parseLocal(v.date, '00:00') === null) errors.date = 'Choose a valid date.'
  if (!v.start || (!errors.date && startOk === null)) errors.start = 'Choose a start time.'
  if (!v.end || (!errors.date && endOk === null)) errors.end = 'Choose an end time.'
  if (!errors.date && !errors.start && !errors.end && startOk !== null && endOk !== null && endOk <= startOk) {
    errors.end = 'End time must be after the start time.'
  }
  if (v.meetingUrl.trim() && !safeHttpUrl(v.meetingUrl)) errors.meetingUrl = 'Enter a valid link, e.g. https://meet.google.com/abc-defg-hij'
  return errors
}

export function formToEventFields(v: ScheduleFormValues): Omit<ScheduleEvent, 'id'> {
  const startAt = parseLocal(v.date, v.start) as number
  const endAt = parseLocal(v.date, v.end) as number
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
  }
}

export function eventToForm(ev: ScheduleEvent): ScheduleFormValues {
  return {
    title: ev.title,
    date: toDateInput(ev.startAt),
    start: toTimeInput(ev.startAt),
    end: toTimeInput(ev.endAt),
    category: ev.category,
    location: ev.location ?? '',
    meetingUrl: ev.meetingUrl ?? '',
    notes: ev.notes ?? '',
    reminderMins: ev.reminderMins ?? null,
    recurrence: ev.recurrence ?? 'none',
  }
}

export function blankForm(day: Date, requestedHour = 9): ScheduleFormValues {
  const startHour = Math.min(Math.max(requestedHour, 0), 22)   // the default 1-hour block must end by 11 PM, same day
  const s = new Date(day.getFullYear(), day.getMonth(), day.getDate(), startHour)
  const e = new Date(day.getFullYear(), day.getMonth(), day.getDate(), startHour + 1)
  return {
    title: '', date: toDateInput(s.getTime()), start: toTimeInput(s.getTime()), end: toTimeInput(e.getTime()),
    category: 'meeting', location: '', meetingUrl: '', notes: '', reminderMins: null, recurrence: 'none',
  }
}

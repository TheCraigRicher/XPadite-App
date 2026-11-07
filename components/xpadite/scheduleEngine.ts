// ── My Schedule — conflict / move / slot / category rules (frontend, pure) ──
// No React, no storage, no network. Everything the interactive calendar decides (can this event go here? what time did the
// user click? is that category name taken?) lives here so it can be unit-tested directly and reused unchanged when events
// are persisted later. All times are epoch milliseconds, so events crossing midnight or a DST change compare exactly.

import {
  SCHEDULE_CATEGORIES, addDays, clockLabel, eventToForm, parseLocal, startOfDay, longDateLabel, toDateInput, toTimeInput,
} from './scheduleLogic'
import type { ScheduleCategory, ScheduleCategoryId, ScheduleEvent, ScheduleFormValues, TimeFormat } from './scheduleLogic'

export const SLOT_MINUTES = 60       // empty-slot click resolution: one whole hour cell
export const SNAP_MINUTES = 15       // drag-and-drop snapping
export const DOUBLE_TAP_MS = 400
const DAY_MIN = 24 * 60
const MINUTE_MS = 60_000

// ── Conflicts ───────────────────────────────────────────────────────────────

/** Standard half-open interval overlap: sharing only an end/start boundary is NOT a conflict. */
export function intervalsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && aEnd > bStart
}

export interface ConflictCandidate {
  startAt: number
  endAt: number
  /** The event being edited / moved — never conflicts with itself. */
  excludeId?: string
}

/** Every existing event (XPadite and synced) whose time overlaps the candidate. Cancelled and zero-length events occupy no time. */
export function findConflicts(c: ConflictCandidate, events: ScheduleEvent[]): ScheduleEvent[] {
  if (!(c.endAt > c.startAt)) return []
  return events
    .filter(e => e.id !== c.excludeId && !e.isCancelled && e.endAt > e.startAt && intervalsOverlap(c.startAt, c.endAt, e.startAt, e.endAt))
    .sort((a, b) => a.startAt - b.startAt || a.endAt - b.endAt)
}

function occupiedLabel(e: ScheduleEvent, candidateStart: number, fmt: TimeFormat): string {
  const sameDay = (x: number, y: number) => startOfDay(new Date(x)).getTime() === startOfDay(new Date(y)).getTime()
  if (sameDay(e.startAt, candidateStart) && sameDay(e.startAt, e.endAt - 1)) {
    return `from ${clockLabel(e.startAt, fmt)} to ${clockLabel(e.endAt, fmt)}`
  }
  return `from ${longDateLabel(e.startAt)}, ${clockLabel(e.startAt, fmt)} to ${longDateLabel(e.endAt)}, ${clockLabel(e.endAt, fmt)}`
}

/** "You already have 'X' scheduled from 9:00 AM to 10:45 AM. Please select another available time." (null when there is no conflict). */
export function conflictMessage(conflicts: ScheduleEvent[], candidateStart: number, fmt: TimeFormat = '12h'): string | null {
  if (conflicts.length === 0) return null
  const first = conflicts[0]
  const from = first.sourceLabel ? ` (${first.sourceLabel})` : ''
  const more = conflicts.length > 1 ? ` ${conflicts.length - 1} other event${conflicts.length > 2 ? 's' : ''} also overlap${conflicts.length > 2 ? '' : 's'} this time.` : ''
  return `You already have '${first.title}'${from} scheduled ${occupiedLabel(first, candidateStart, fmt)}.${more} Please select another available time.`
}

/**
 * Conflict message for the Add / Edit / Duplicate form, or null when the times are fine (or not yet valid).
 * `original` is the event's saved time when editing: an edit that leaves the time untouched is never blocked, so existing
 * overlapping sample/imported data stays editable (title, notes, category…) until its time is actually changed.
 */
export function formConflict(
  v: Pick<ScheduleFormValues, 'date' | 'start' | 'end'> & { endDate?: string },
  events: ScheduleEvent[],
  opts: { excludeId?: string; original?: { startAt: number; endAt: number }; fmt?: TimeFormat } = {},
): string | null {
  const startAt = parseLocal(v.date, v.start), endAt = parseLocal(v.endDate || v.date, v.end)
  if (startAt === null || endAt === null || endAt <= startAt) return null
  if (opts.original && opts.original.startAt === startAt && opts.original.endAt === endAt) return null
  return conflictMessage(findConflicts({ startAt, endAt, excludeId: opts.excludeId }, events), startAt, opts.fmt)
}

// ── Form helpers ────────────────────────────────────────────────────────────

/**
 * Applies a change to date/start while keeping the current length: moving the start moves the end with it. A same-day event
 * stays on its day (the end is held at 23:59 rather than silently rolling into tomorrow); an event that already runs past
 * midnight keeps its exact duration, with the end date following. Lengths are epoch milliseconds, so DST never skews them.
 */
export function withStartChange(v: ScheduleFormValues, patch: Partial<Pick<ScheduleFormValues, 'date' | 'start'>>): ScheduleFormValues {
  const next = { ...v, ...patch }
  const oldEndDate = v.endDate || v.date
  const multiDay = oldEndDate !== v.date
  const oldS = parseLocal(v.date, v.start), oldE = parseLocal(oldEndDate, v.end)
  const newS = parseLocal(next.date, next.start)
  // can't compute a length (a field is blank/invalid): at least keep a same-day event's end date following its start date
  if (oldS === null || oldE === null || oldE <= oldS || newS === null) return multiDay ? next : { ...next, endDate: next.date }
  const dur = oldE - oldS
  let newE = newS + dur
  if (!multiDay) {
    const d = new Date(newS)
    newE = Math.min(newE, new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59).getTime())
    if (newE <= newS) return { ...next, endDate: next.date }
  }
  return { ...next, end: toTimeInput(newE), endDate: toDateInput(newE) }
}

/** Edit-mode date change: the end date moves with the start date (same day stays same day; an overnight event keeps its day span). */
export function withDateChange(v: ScheduleFormValues, date: string): ScheduleFormValues {
  const a = parseLocal(v.date, '00:00'), b = parseLocal(v.endDate || v.date, '00:00'), n = parseLocal(date, '00:00')
  if (a === null || b === null || n === null) return { ...v, date, endDate: (v.endDate || v.date) === v.date ? date : v.endDate }
  const spanDays = Math.round((b - a) / (24 * 60 * MINUTE_MS))
  return { ...v, date, endDate: toDateInput(addDays(startOfDay(new Date(n)), spanDays).getTime()) }
}

/** First free start (15-minute grid) at or after `fromStart` where `durationMs` fits on one day without overlap, searching a week ahead. */
export function nextFreeStart(events: ScheduleEvent[], fromStart: number, durationMs: number, excludeId?: string, allowOvernight = false): number | null {
  const step = SNAP_MINUTES * MINUTE_MS
  let t = Math.ceil(fromStart / step) * step
  const limit = fromStart + 7 * 24 * 60 * MINUTE_MS
  for (; t < limit; t += step) {
    const nextMidnight = addDays(startOfDay(new Date(t)), 1).getTime()
    if (!allowOvernight && t + durationMs > nextMidnight) continue   // keep a same-day copy on one day
    if (findConflicts({ startAt: t, endAt: t + durationMs, excludeId }, events).length === 0) return t
  }
  return null
}

/**
 * Add-form values for duplicating `ev`: title, category, location, link, notes, reminder, repeat and duration are carried over.
 * The date/start default to the first free slot at/after the original's end, so the copy does not start in conflict;
 * the end is recalculated from the original duration. Nothing external (id, source, read-only flag) is copied.
 */
export function duplicateFormValues(ev: ScheduleEvent, events: ScheduleEvent[]): ScheduleFormValues {
  const base = eventToForm(ev)
  const durationMs = Math.max(MINUTE_MS, ev.endAt - ev.startAt)
  const overnight = toDateInput(ev.startAt) !== toDateInput(ev.endAt - 1)       // an event that runs past midnight stays one
  const start = nextFreeStart(events, ev.endAt, durationMs, ev.id, overnight) ?? ev.startAt
  const s = new Date(start)
  let end = start + durationMs
  if (!overnight) end = Math.min(end, new Date(s.getFullYear(), s.getMonth(), s.getDate(), 23, 59).getTime())
  if (end <= start) end = start + MINUTE_MS
  return { ...base, date: toDateInput(start), start: toTimeInput(start), endDate: toDateInput(end), end: toTimeInput(end) }
}

/** Only events made in XPadite can be duplicated (never a synced Google/Outlook event or anything carrying an external id). */
export function canDuplicate(ev: ScheduleEvent | null | undefined): boolean {
  return !!ev && !ev.readOnly && !ev.source
}

// ── Empty-slot click / double-tap ───────────────────────────────────────────

/** Minutes from midnight for a vertical offset inside the 24-hour body, floored to `step` and kept inside the day. */
export function minutesFromOffset(offsetPx: number, hourPx: number, step = SLOT_MINUTES): number {
  if (!Number.isFinite(offsetPx) || hourPx <= 0) return 0
  const raw = (offsetPx / hourPx) * 60
  return Math.min(Math.max(Math.floor(raw / step) * step, 0), DAY_MIN - step)
}

export interface TapRecord { key: string; at: number }

/** True when this tap lands on the same slot as the previous one within the double-tap window (mouse double-click or touch double-tap). */
export function isDoubleTap(prev: TapRecord | null, key: string, now: number, windowMs = DOUBLE_TAP_MS): boolean {
  return !!prev && prev.key === key && now - prev.at <= windowMs && now >= prev.at
}

// ── Drag & drop ─────────────────────────────────────────────────────────────

export type MoveBlock = 'readonly' | 'recurring' | 'range' | 'conflict'

export interface MovePlan {
  ok: boolean
  startAt: number
  endAt: number
  /** Why the move is refused (undefined when ok, or when the event simply stayed where it was). */
  block?: MoveBlock
  conflicts: ScheduleEvent[]
  message: string | null
  /** True when the drop lands exactly where the event already is. */
  unchanged?: boolean
}

export function dragBlockReason(ev: ScheduleEvent): { block: MoveBlock; message: string } | null {
  if (ev.readOnly || ev.source) {
    return { block: 'readonly', message: `Events synced from ${ev.sourceLabel ?? 'your calendar'} are read-only and can't be moved here.` }
  }
  if (ev.recurrence && ev.recurrence !== 'none') {
    return { block: 'recurring', message: "Repeating events can't be dragged yet — use Edit to change this event." }
  }
  return null
}

export function snapMinutes(min: number, step = SNAP_MINUTES): number {
  return Math.round(min / step) * step
}

/**
 * Where would `ev` land if its top edge were dropped at `rawStartMin` minutes on `day`? Snaps to 15 minutes, keeps the exact
 * duration, and checks the whole new interval against every other event. Nothing else is ever moved.
 */
export function planMove(ev: ScheduleEvent, day: Date, rawStartMin: number, events: ScheduleEvent[], fmt: TimeFormat = '12h'): MovePlan {
  const duration = ev.endAt - ev.startAt
  const blocked = dragBlockReason(ev)
  if (blocked) return { ok: false, startAt: ev.startAt, endAt: ev.endAt, block: blocked.block, conflicts: [], message: blocked.message }
  const snapped = snapMinutes(rawStartMin)
  if (!(duration > 0) || snapped < 0 || snapped > DAY_MIN - SNAP_MINUTES) {
    return { ok: false, startAt: ev.startAt, endAt: ev.endAt, block: 'range', conflicts: [], message: 'Drop the event inside the calendar.' }
  }
  const startAt = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, snapped).getTime()
  const endAt = startAt + duration
  if (startAt === ev.startAt) return { ok: false, unchanged: true, startAt, endAt, conflicts: [], message: null }
  const conflicts = findConflicts({ startAt, endAt, excludeId: ev.id }, events)
  if (conflicts.length > 0) return { ok: false, startAt, endAt, block: 'conflict', conflicts, message: conflictMessage(conflicts, startAt, fmt) }
  return { ok: true, startAt, endAt, conflicts: [], message: null }
}

// ── Categories ──────────────────────────────────────────────────────────────

export const CATEGORY_NAME_MAX = 30

/** Trim, NFKC-normalise and collapse internal whitespace. */
export function normalizeCategoryName(name: string): string {
  return name.normalize('NFKC').replace(/\s+/g, ' ').trim()
}

/** Comparison key: case-insensitive and ignoring spacing around slashes, so "study/focus" collides with "Study / Focus". */
export function categoryNameKey(name: string): string {
  return normalizeCategoryName(name).toLowerCase().replace(/\s*\/\s*/g, '/')
}

export function validateCategoryName(name: string, categories: ScheduleCategory[], excludeId?: string): string | null {
  const n = normalizeCategoryName(name)
  if (!n) return 'Give the category a name.'
  if (n.length > CATEGORY_NAME_MAX) return `Keep the name to ${CATEGORY_NAME_MAX} characters or fewer.`
  const key = categoryNameKey(n)
  if (categories.some(c => c.id !== excludeId && categoryNameKey(c.label) === key)) return 'A category with that name already exists.'
  return null
}

/** Soft pastel palette for new categories (lavender, mint, blush, baby blue, peach, pale yellow, coral, turquoise, lilac, sage). */
export const CATEGORY_SWATCHES = [
  '#b8a4f5', '#6fd6a8', '#f4a3c4', '#7fbdf2', '#f7b58a',
  '#f0d96a', '#f48c8c', '#5fd3d0', '#d19be6', '#9bbf9a',
]

export function isHexColor(s: string): boolean { return /^#[0-9a-fA-F]{6}$/.test(s) }

function mix(hex: string, other: number, t: number): string {
  const n = parseInt(hex.slice(1), 16)
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(c => Math.round(c * (1 - t) + other * t))
  return '#' + ch.map(c => c.toString(16).padStart(2, '0')).join('')
}

/** Pastel fill, accent edge and readable dark text from one chosen colour — the same three-part scheme as the built-ins. */
export function categoryColors(hex: string): { bg: string; edge: string; text: string } {
  const edge = hex.toLowerCase()
  return { bg: mix(edge, 255, 0.74), edge, text: mix(edge, 0, 0.66) }
}

export type CategoryResult = { ok: true; categories: ScheduleCategory[]; category?: ScheduleCategory } | { ok: false; error: string }

const BUILT_IN_MSG = "The six built-in categories can't be changed."

export function addCategory(categories: ScheduleCategory[], name: string, hex: string, id: string): CategoryResult {
  const err = validateCategoryName(name, categories)
  if (err) return { ok: false, error: err }
  if (!isHexColor(hex)) return { ok: false, error: 'Choose a colour.' }
  if (categories.some(c => c.id === id)) return { ok: false, error: 'Could not create the category — try again.' }
  const colorTaken = categories.find(c => c.edge.toLowerCase() === hex.toLowerCase())
  if (colorTaken) return { ok: false, error: `That colour is already used by “${colorTaken.label}” — pick a different one.` }
  const category: ScheduleCategory = { id, label: normalizeCategoryName(name), ...categoryColors(hex) }
  return { ok: true, categories: [...categories, category], category }
}

export function renameCategory(categories: ScheduleCategory[], id: string, name: string): CategoryResult {
  const cat = categories.find(c => c.id === id)
  if (!cat) return { ok: false, error: 'That category no longer exists.' }
  if (cat.builtIn) return { ok: false, error: BUILT_IN_MSG }
  const err = validateCategoryName(name, categories, id)
  if (err) return { ok: false, error: err }
  return { ok: true, categories: categories.map(c => (c.id === id ? { ...c, label: normalizeCategoryName(name) } : c)) }
}

export function recolorCategory(categories: ScheduleCategory[], id: string, hex: string): CategoryResult {
  const cat = categories.find(c => c.id === id)
  if (!cat) return { ok: false, error: 'That category no longer exists.' }
  if (cat.builtIn) return { ok: false, error: BUILT_IN_MSG }
  if (!isHexColor(hex)) return { ok: false, error: 'Choose a colour.' }
  const taken = categories.find(c => c.id !== id && c.edge.toLowerCase() === hex.toLowerCase())
  if (taken) return { ok: false, error: `That colour is already used by “${taken.label}” — pick a different one.` }
  return { ok: true, categories: categories.map(c => (c.id === id ? { ...c, ...categoryColors(hex) } : c)) }
}

export function categoryUsage(events: ScheduleEvent[], id: ScheduleCategoryId): number {
  return events.filter(e => e.category === id).length
}

export type DeleteCategoryResult =
  | { ok: true; categories: ScheduleCategory[]; events: ScheduleEvent[]; reassigned: number }
  | { ok: false; error: string }

/** Deletes a custom category. If events use it, a different, existing category must be named to receive them — never orphaned. */
export function deleteCategory(categories: ScheduleCategory[], events: ScheduleEvent[], id: string, replacementId?: string): DeleteCategoryResult {
  const cat = categories.find(c => c.id === id)
  if (!cat) return { ok: false, error: 'That category no longer exists.' }
  if (cat.builtIn) return { ok: false, error: BUILT_IN_MSG }
  const used = categoryUsage(events, id)
  if (used > 0) {
    if (!replacementId || replacementId === id || !categories.some(c => c.id === replacementId)) {
      return { ok: false, error: 'Choose a replacement category for the events that use it.' }
    }
  }
  return {
    ok: true,
    categories: categories.filter(c => c.id !== id),
    events: used > 0 ? events.map(e => (e.category === id ? { ...e, category: replacementId as string } : e)) : events,
    reassigned: used,
  }
}

export const BUILT_IN_CATEGORIES = SCHEDULE_CATEGORIES


// -- Phone filter sheet: one draft of (which categories show, which calendars show) -----------------------------

export interface FilterState { filter: string; hidden: string[]; hiddenSources: string[] }
export const NO_FILTER: FilterState = { filter: 'all', hidden: [], hiddenSources: [] }

/** The calendars the sheet can switch on/off. Events created in XPadite have no external source. */
export const FILTER_SOURCES: { id: string; label: string }[] = [
  { id: 'xpadite', label: 'XPadite events' },
  { id: 'google', label: 'Google Calendar' },
  { id: 'microsoft', label: 'Outlook' },
]

/** True when anything narrows the calendar (a category/calendar chosen, or any category / calendar switched off). */
export function isFilterActive(s: FilterState): boolean { return s.filter !== 'all' || s.hidden.length > 0 || s.hiddenSources.length > 0 }

/**
 * The checkbox view of the applied filter. The tablet/desktop dropdown is single-choice ("only Study", "only Google"); that choice
 * is shown here as the equivalent checkboxes so nothing is lost when the same state is opened on a phone.
 */
export function toCheckboxState(s: FilterState, allCategoryIds: string[]): FilterState {
  const isSource = FILTER_SOURCES.some(x => x.id === s.filter)
  if (s.filter === 'all') return { filter: 'all', hidden: [...s.hidden], hiddenSources: [...s.hiddenSources] }
  if (isSource) return { filter: 'all', hidden: [...s.hidden], hiddenSources: FILTER_SOURCES.map(x => x.id).filter(id => id !== s.filter) }
  return { filter: 'all', hidden: allCategoryIds.filter(id => id !== s.filter), hiddenSources: [...s.hiddenSources] }
}

export function toggleCategoryVisible(s: FilterState, id: string): FilterState {
  return { ...s, hidden: s.hidden.includes(id) ? s.hidden.filter(x => x !== id) : [...s.hidden, id] }
}

export function toggleSourceVisible(s: FilterState, id: string): FilterState {
  return { ...s, hiddenSources: s.hiddenSources.includes(id) ? s.hiddenSources.filter(x => x !== id) : [...s.hiddenSources, id] }
}

/** Choose what to show. A category that was switched off is switched back on, so the choice can never show nothing. */
export function selectFilter(s: FilterState, value: string): FilterState {
  return { ...s, filter: value, hidden: s.hidden.filter(id => id !== value) }
}

/** Show/hide one category. Hiding the category that is currently chosen resets the choice to All. */
export function toggleHiddenCategory(s: FilterState, id: string): FilterState {
  const hidden = s.hidden.includes(id) ? s.hidden.filter(x => x !== id) : [...s.hidden, id]
  return { ...s, filter: !s.hidden.includes(id) && s.filter === id ? 'all' : s.filter, hidden }
}

// ── Deadline index (v1.345) ──────────────────────────────────────────────────────────────────────────────────────────
// Everything the calendars, Day view and popups need to know about deadlines, DERIVED from the two places they live — nothing is stored per day:
//   • My Schedule deadline events (isDeadline; the due instant is the event's end). Completion = the linked Task Manager task ('dl-<eventId>') when it exists
//     (the task is the authority), otherwise the event's own completedAt (a deadline whose task the user removed).
//   • Ordinary tasks that carry their own `due` date.
// Pure (no React, storage or network): unit-tested in tests/due/*.test.cjs.

import type { CalendarData, Task } from './types'
import type { ScheduleEvent } from './scheduleLogic'
import { dateKeyOf, linkedTaskId } from './deadlineLink'
import { dayKeyInTz, dueInfo, taskDueInstant, type DueInfo, type DueState } from './dueStatus'
import { needsAck, validAck, type AckOutcome } from './deadlineAck'

export interface DeadlineItem {
  /** event id or task id (unique per item). */
  id: string
  source: 'event' | 'task'
  title: string
  /** The calendar day the marker belongs on ("YYYY-MM-DD") — the same day placement as before v1.345. */
  dayKey: string
  dueAt: number
  dateOnly: boolean
  /** The calendar day the deadline INSTANT falls on in the account timezone. Differs from dayKey only for a legacy deadline whose assigned date was stored under another timezone. */
  dueDay: string
  /** dayKey !== dueDay: show both (assigned calendar date vs. deadline time) instead of silently re-dating the deadline. */
  dateMismatch: boolean
  /** The timezone the status and times are read in (the account timezone). */
  tz: string
  done: boolean
  completedAt: number | null
  info: DueInfo
  /** v1.361: the user's applicable answer (met / missed) and whether the "Did you meet the deadline…?" question should be shown now */
  ack: AckOutcome | null
  needsAck: boolean
  eventId?: string
  /** The Task Manager task that carries this deadline's completion (when there is one) and the day it lives on. */
  taskId?: string
  taskDateKey?: string
}

type Ev = ScheduleEvent & { taskDateKey?: string | null }

/** info + the applicable answer + whether to ask, for one deadline (the answer is read from the day its marker sits on). */
function ackFields(cal: CalendarData, dayKey: string, id: string, dueAt: number, done: boolean, completedAt: number | null, now: number, tz: string): { info: DueInfo; ack: AckOutcome | null; needsAck: boolean } {
  const ack = validAck(cal[dayKey]?.deadlineAcks?.[id], dueAt, done)
  return { info: dueInfo({ dueAt, done, completedAt, outcome: ack }, now, tz), ack, needsAck: needsAck(done, dueAt, now, ack) }
}

function linkedTask(cal: CalendarData, ev: Ev, dayKey: string): { task: Task; key: string } | null {
  const id = linkedTaskId(ev.id, 'deadline')
  for (const key of [ev.taskDateKey, dayKey]) {
    if (!key) continue
    const t = cal[key]?.tasks?.find(x => x.id === id)
    if (t) return { task: t, key }
  }
  return null
}

/** Every deadline, grouped by the day its marker sits on, soonest first. */
export function buildDeadlineItems(events: Ev[], cal: CalendarData, tz: string, now: number): Record<string, DeadlineItem[]> {
  const out: Record<string, DeadlineItem[]> = {}
  const push = (it: DeadlineItem) => { (out[it.dayKey] ??= []).push(it) }
  for (const ev of events) {
    if (!ev.isDeadline || ev.isCancelled) continue
    const computedDay = dateKeyOf(ev.endAt)         // in the account timezone (zdate.ts)
    const lt = linkedTask(cal, ev, computedDay)
    // ANCHORED: the day is where the task really sits, else the day the event row recorded, else (never anchored) the account-timezone day of the end.
    // It is never re-derived from the device, so every device agrees and nothing moves when a timezone changes.
    const dayKey = lt ? lt.key : (ev.taskDateKey ?? computedDay)
    const dueDay = dayKeyInTz(ev.endAt, tz)
    const done = lt ? !!lt.task.done : typeof ev.completedAt === 'number'      // no linked task: the event row records it (COMPLETED_UNKNOWN = done, time never recorded)
    const completedAt = lt ? (lt.task.done && typeof lt.task.completedAt === 'number' ? lt.task.completedAt : null) : (typeof ev.completedAt === 'number' && ev.completedAt > 0 ? ev.completedAt : null)
    push({ id: ev.id, source: 'event', title: ev.title, dayKey, dueAt: ev.endAt, dateOnly: false, dueDay, dateMismatch: dayKey !== dueDay, tz, done, completedAt, ...ackFields(cal, dayKey, ev.id, ev.endAt, done, completedAt, now, tz), eventId: ev.id, taskId: lt?.task.id, taskDateKey: lt?.key })
  }
  for (const [key, day] of Object.entries(cal)) {
    for (const t of day.tasks ?? []) {
      if (!t.due || t.sourceEventId || !/^\d{4}-\d{2}-\d{2}$/.test(t.due.date)) continue
      const dueAt = taskDueInstant(t.due, tz)
      const completedAt = t.done && typeof t.completedAt === 'number' ? t.completedAt : null
      push({ id: t.id, source: 'task', title: t.text, dayKey: t.due.date, dueAt, dateOnly: !!t.due.dateOnly, dueDay: t.due.date, dateMismatch: false, tz, done: !!t.done, completedAt, ...ackFields(cal, t.due.date, t.id, dueAt, !!t.done, completedAt, now, tz), taskId: t.id, taskDateKey: key })
    }
  }
  for (const k of Object.keys(out)) out[k].sort((a, b) => a.dueAt - b.dueAt)
  return out
}

let last: { cal: CalendarData; events: Ev[]; tz: string; bucket: number; out: Record<string, DeadlineItem[]> } | null = null
/** Same as buildDeadlineItems, shared by every calendar cell of one render (one scan, not one per cell). Status refreshes every 30 s. */
export function deadlineIndex(events: Ev[], cal: CalendarData, tz: string, now: number): Record<string, DeadlineItem[]> {
  const bucket = Math.floor(now / 30_000)
  if (last && last.cal === cal && last.events === events && last.tz === tz && last.bucket === bucket) return last.out
  const out = buildDeadlineItems(events, cal, tz, now)
  last = { cal, events, tz, bucket, out }
  return out
}

/**
 * Which single marker a calendar cell shows (never two):
 *   Normal calendar        overdue → upcoming → completed
 *   Productivity calendar  upcoming only (overdue and completed live in the Normal calendar), and only when no productivity marker owns the day —
 *                          the caller decides that, this just answers "what would the deadline marker be".
 */
export function markerState(items: DeadlineItem[] | undefined, normal: boolean): DueState | null {
  if (!items || items.length === 0) return null
  const has = (s: DueState) => items.some(i => i.info.state === s)
  if (normal) return has('overdue') ? 'overdue' : has('upcoming') ? 'upcoming' : has('completed') ? 'completed' : null
  return has('upcoming') ? 'upcoming' : null
}

/** Tooltip / aria text: "2 deadlines: A — Overdue · 3 days; B — Upcoming". */
export function deadlineTitle(items: DeadlineItem[]): string {
  return `${items.length} ${items.length === 1 ? 'deadline' : 'deadlines'}: ${items.map(i => `${i.title} — ${i.info.label}`).join('; ')}`
}

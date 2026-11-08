// ── Event → Calendar → Task Manager linking (v1.328) ─────────────────────────────────────────────────────────────────
// Pure functions only (no React, storage or network) so every rule is unit-tested in tests/schedule/*.test.cjs.
//
// ONE source of truth: the schedule event (id, title, startAt, endAt, isDeadline, taskLink). Everything else derives from it or points at its id:
//   • Calendar markers  — derived on the fly from the events (deadlineDayMap); nothing is stored per day.
//   • Task Manager task — a real Task in calendar_days.day_data.tasks, `sourceEventId` = the event, with a STABLE id of one of two kinds:
//        'dl-<eventId>'  DEADLINE task  — event is "Set as Due Date"  → lives on the END date, shown with the urgent (red) styling;
//        'ev-<eventId>'  EVENT task     — ordinary event while the user's "Sync with Task Manager" switch is ON → lives on the START date, normal styling.
//     An event has AT MOST ONE of them. Toggling the deadline flag converts the task (re-keys it, keeping every piece of user work).
//     Tasks are matched by id, never by title.
//   • Per-event opt-out: taskLink 'detached' = the user deleted the task on purpose: no task of either kind is wanted until they restore it.
//   • The due / scheduled times are NOT copied onto the task — the popup reads the event through sourceEventId.
//
// HOW TASK CHANGES ARE APPLIED: a plan is a short list of TaskOps sent to the database function schedule_apply (migrations 023/024), which applies
// each BY TASK ID to the CURRENT server copy of the day under a row lock, together with the event write, in one transaction. `applyOpsLocal` is the
// same semantics in TypeScript (reference + test double, parity-tested against the real SQL). `reconcileDeadlines` repairs any drift.

import type { DayData, Task } from './types'
import type { ScheduleEvent } from './scheduleLogic'

const pad2 = (n: number) => String(n).padStart(2, '0')

/** Local calendar day of an instant, "YYYY-MM-DD" (the key calendar_days uses). */
export function dateKeyOf(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

export type LinkKind = 'deadline' | 'event'
const PREFIX: Record<LinkKind, string> = { deadline: 'dl-', event: 'ev-' }

/** The linked task's stable id for an event ('dl-…' deadline by default, 'ev-…' for an ordinary synced event). */
export function linkedTaskId(eventId: string, kind: LinkKind = 'deadline'): string { return PREFIX[kind] + eventId }

/** Which kind of linked task this is (null = an ordinary user task, or an unlinked leftover). */
export function linkKindOf(t: Pick<Task, 'id' | 'sourceEventId'>): LinkKind | null {
  if (!t.sourceEventId) return null
  return t.id.startsWith('dl-') ? 'deadline' : t.id.startsWith('ev-') ? 'event' : null
}
export const isDeadlineTask = (t: Pick<Task, 'id' | 'sourceEventId'>): boolean => linkKindOf(t) === 'deadline'
export const isEventTask = (t: Pick<Task, 'id' | 'sourceEventId'>): boolean => linkKindOf(t) === 'event'

export type DueStatus = 'overdue' | 'today' | 'upcoming'

/** Overdue = the due instant has passed; Due Today = still ahead on today's date; Upcoming = a later day. */
export function dueStatus(dueAt: number, now: number): DueStatus {
  if (dueAt < now) return 'overdue'
  return dateKeyOf(dueAt) === dateKeyOf(now) ? 'today' : 'upcoming'
}

export const DUE_LABEL: Record<DueStatus, string> = { overdue: 'Overdue', today: 'Due Today', upcoming: 'Upcoming' }

/** Deadline events grouped by the local day they fall due (end instant). Cancelled events are ignored. */
export function deadlineDayMap(events: ScheduleEvent[]): Record<string, ScheduleEvent[]> {
  const out: Record<string, ScheduleEvent[]> = {}
  for (const e of events) {
    if (!e.isDeadline || e.isCancelled) continue
    const k = dateKeyOf(e.endAt)
    ;(out[k] ??= []).push(e)
  }
  for (const k of Object.keys(out)) out[k].sort((a, b) => a.endAt - b.endAt)
  return out
}

/** A task that holds user work must never be deleted automatically: finished, timed, noted, attached or still running. */
export function taskHasProgress(t: Task, all: Task[]): boolean {
  return t.done || t.sessions.length > 0 || !!t.journal?.trim() || !!t.noteDone || t.timerStart !== null
    || (t.attachments?.length ?? 0) > 0 || all.some(o => o.parentTaskId === t.id)
}

/** One change to a linked task, applied by id on the server's current copy of the day (see schedule_apply, migration 024). */
export type TaskOp =
  | { kind: 'upsert'; date_key: string; task_id: string; event_id: string; task: Task }
  | { kind: 'move'; date_key: string; from_key: string; task_id: string; from_task_id?: string; event_id: string; task: Task }
  | { kind: 'remove'; date_key: string; task_id: string }
  | { kind: 'unlink'; date_key: string; task_id: string }

/** Where the user wants the Task Manager representation: 'linked' (default) or 'detached' (user removed it / opted out; the event stays). */
export type TaskLink = 'linked' | 'detached'

type PlanEvent = Pick<ScheduleEvent, 'title' | 'endAt' | 'isDeadline'> & { startAt?: number }

/**
 * Which task (if any) an event should have right now:
 *   detached → none;  due-date event → deadline task;  ordinary event while the user's sync switch is ON → event task;  otherwise none.
 */
export function wantedKind(next: Pick<PlanEvent, 'isDeadline'> | null, taskLink: TaskLink, syncOn: boolean): LinkKind | null {
  if (!next || taskLink === 'detached') return null
  if (next.isDeadline) return 'deadline'
  return syncOn ? 'event' : null
}

/** The calendar day a task of this kind belongs on: a deadline on its END date, an ordinary synced event on its START date. */
export function taskDayFor(next: PlanEvent, kind: LinkKind): string {
  return dateKeyOf(kind === 'deadline' ? next.endAt : (next.startAt ?? next.endAt))
}

export interface DeadlineSyncPlan {
  /** The operations to send to the server — the real thing. */
  ops: TaskOp[]
  /** Where the linked task now lives ("YYYY-MM-DD") or null when none — stored on the event row (task_date_key). */
  taskDateKey: string | null
  /** What happened, for tests / messages. */
  outcome: 'created' | 'updated' | 'moved' | 'removed' | 'unlinked' | 'none'
  /** False when the task already matches the event exactly (reconcile skips those). */
  changed: boolean
  /** Which kind of task the event should have after this plan (null = none). */
  kind: LinkKind | null
}

interface Copy { id: string; key: string; task: Task; day: DayData }

/** Every copy of an event's linked task(s) in the calendar, either kind, recorded/target days first (a moved/duplicated task is still found). */
export function findCopies(cal: Record<string, DayData>, eventId: string, prevKey: string | null, targetKey: string | null): Copy[] {
  const ids = [linkedTaskId(eventId, 'deadline'), linkedTaskId(eventId, 'event')]
  const order = [prevKey, targetKey, ...Object.keys(cal).sort()].filter((k, i, a): k is string => !!k && a.indexOf(k) === i && !!cal[k])
  const out: Copy[] = []
  for (const key of order) for (const t of cal[key].tasks ?? []) if (ids.includes(t.id)) out.push({ id: t.id, key, task: t, day: cal[key] })
  return out
}

/** Back-compat helper: every day holding the DEADLINE task of an event. */
export function findTaskKeys(cal: Record<string, DayData>, tid: string, prevKey: string | null, targetKey: string | null): string[] {
  const has = (k: string) => (cal[k]?.tasks ?? []).some(t => t.id === tid)
  const first = [prevKey, targetKey].filter((k, i, a): k is string => !!k && a.indexOf(k) === i && has(k))
  return [...first, ...Object.keys(cal).filter(k => !first.includes(k) && has(k)).sort()]
}

/**
 * Works out the Task Manager changes for one event save/removal. `next` is the event as saved (null = event deleted); `prevTaskDateKey` is
 * where its task lived before (event row's task_date_key); `taskLink` the user's per-event choice; `syncOn` the user's global switch.
 * Idempotent: running the same plan twice yields the same calendar. Never plans two tasks for one event.
 */
export function planDeadlineSync(
  cal: Record<string, DayData>,
  eventId: string,
  next: PlanEvent | null,
  prevTaskDateKey: string | null,
  defaultActId: string,
  makeId?: (kind: LinkKind) => string,
  taskLink: TaskLink = 'linked',
  syncOn = false,
): DeadlineSyncPlan {
  const kind = wantedKind(next, taskLink, syncOn)
  const targetKey = kind && next ? taskDayFor(next, kind) : null
  const wantedId = kind ? (makeId ? makeId(kind) : linkedTaskId(eventId, kind)) : null

  const copies = findCopies(cal, eventId, prevTaskDateKey, targetKey)
  // several copies (two devices, a stale overwrite, a converted kind): the one holding the user's work wins, then the wanted id, then the due day
  const score = (c: Copy) => (taskHasProgress(c.task, c.day.tasks) ? 4 : 0) + (c.id === wantedId ? 2 : 0) + (c.key === targetKey ? 1 : 0)
  let primary: Copy | null = null
  for (const c of copies) if (!primary || score(c) > score(primary)) primary = c
  const others = copies.filter(c => c !== primary)

  if (!kind || !wantedId || !targetKey) {
    if (!primary) return { ops: [], taskDateKey: null, outcome: 'none', changed: false, kind: null }
    const extraOps: TaskOp[] = others.map(c => ({ kind: 'remove', date_key: c.key, task_id: c.id }))
    if (taskHasProgress(primary.task, primary.day.tasks)) {
      return { ops: [{ kind: 'unlink', date_key: primary.key, task_id: primary.id }, ...extraOps], taskDateKey: null, outcome: 'unlinked', changed: !!primary.task.sourceEventId || extraOps.length > 0, kind: null }
    }
    return { ops: [{ kind: 'remove', date_key: primary.key, task_id: primary.id }, ...extraOps], taskDateKey: null, outcome: 'removed', changed: true, kind: null }
  }

  const title = (next as PlanEvent).title
  const fresh: Task = { id: wantedId, text: title, done: false, journal: '', timerStart: null, timerEnd: null, actId: defaultActId, sessions: [], sourceEventId: eventId }
  if (!primary) {
    return { ops: [{ kind: 'upsert', date_key: targetKey, task_id: wantedId, event_id: eventId, task: fresh }], taskDateKey: targetKey, outcome: 'created', changed: true, kind }
  }
  const updated: Task = { ...primary.task, id: wantedId, text: title, sourceEventId: eventId }
  if (primary.id === wantedId && primary.key === targetKey) {
    const extraOps: TaskOp[] = others.map(c => ({ kind: 'remove', date_key: c.key, task_id: c.id }))
    const changed = primary.task.text !== title || primary.task.sourceEventId !== eventId || extraOps.length > 0
    return { ops: [{ kind: 'upsert', date_key: targetKey, task_id: wantedId, event_id: eventId, task: updated }, ...extraOps], taskDateKey: targetKey, outcome: 'updated', changed, kind }
  }
  // the day and/or the kind changed: carry the SAME task (sessions, notes, completion, sub-tasks) to the right day under the right id.
  // A copy already sitting at the destination under the wanted id is consumed BY the move (it keeps whichever holds the work).
  const extraOps: TaskOp[] = others.filter(c => !(c.key === targetKey && c.id === wantedId)).map(c => ({ kind: 'remove', date_key: c.key, task_id: c.id }))
  const move: TaskOp = { kind: 'move', date_key: targetKey, from_key: primary.key, task_id: wantedId, ...(primary.id !== wantedId ? { from_task_id: primary.id } : null), event_id: eventId, task: updated }
  return { ops: [move, ...extraOps], taskDateKey: targetKey, outcome: 'moved', changed: true, kind }
}

// ── Reference implementation of the server's op semantics (schedule_apply) ────────────────────────────────────────
// Used by the browser-test fake backend and cross-checked against the REAL SQL function in tests/schedule/scheduleSql.test.cjs.

const stripLink = (t: Task): Task => { const c = { ...t }; delete c.sourceEventId; return c }
const okId = (id: string) => id.startsWith('dl-') || id.startsWith('ev-')

/** Applies ops to a calendar the way schedule_apply does on the server's current copy; returns only the days that changed. */
export function applyOpsLocal(cal: Record<string, DayData>, ops: TaskOp[]): Record<string, DayData> {
  const work: Record<string, DayData> = {}
  const changed: Record<string, DayData> = {}
  const get = (k: string): DayData | undefined => work[k] ?? cal[k]
  const set = (k: string, d: DayData) => { work[k] = d; changed[k] = d }
  const empty = (): DayData => ({ productive: false, hyper: false, notes: '', tasks: [], journal: '' })
  for (const op of ops) {
    const fid = op.kind === 'move' ? (op.from_task_id ?? op.task_id) : op.task_id
    if (!okId(op.task_id) || !okId(fid)) throw new Error('bad_op')
    if (op.kind === 'move') {
      if (op.from_key === op.date_key && fid === op.task_id) throw new Error('bad_op')
      let moved: Task | null = null
      const kids: Task[] = []
      const from = get(op.from_key)
      if (from) {
        const kept: Task[] = []
        for (const t of from.tasks ?? []) {
          if (t.id === fid) { if (!moved) moved = t }
          else if (t.parentTaskId === fid) kids.push(t)
          else kept.push(t)
        }
        set(op.from_key, { ...from, tasks: kept })
      }
      const to = get(op.date_key) ?? empty()
      const tasks = to.tasks ?? []
      const out: Task[] = []; let seen = false
      for (const t of tasks) {
        if (t.id === op.task_id) {
          if (seen) continue
          const base = moved && !taskHasProgress(t, tasks) && taskHasProgress(moved, [...tasks, ...kids]) ? moved : t
          out.push({ ...base, id: op.task_id, text: op.task.text, sourceEventId: op.event_id }); seen = true
        } else if (!kids.some(k => k.id === t.id)) out.push(t)
      }
      if (!seen) out.push({ ...(moved ?? { ...op.task, id: op.task_id }), id: op.task_id, text: op.task.text, sourceEventId: op.event_id })
      for (const k of kids) out.push({ ...k, parentTaskId: op.task_id })
      set(op.date_key, { ...to, tasks: out })
      continue
    }
    let day = get(op.date_key)
    if (!day) { if (op.kind !== 'upsert') continue; day = empty() }
    const tasks = day.tasks ?? []
    const out: Task[] = []; let seen = false
    for (const t of tasks) {
      if (t.id !== op.task_id) { out.push(t); continue }
      if (op.kind === 'upsert') { if (!seen) { out.push({ ...t, text: op.task.text, sourceEventId: op.event_id }); seen = true } }
      else if (op.kind === 'unlink') out.push(stripLink(t))
      else if (taskHasProgress(t, tasks)) out.push(stripLink(t))
    }
    if (op.kind === 'upsert' && !seen) out.push({ ...op.task, id: op.task_id, sourceEventId: op.event_id })
    set(op.date_key, { ...day, tasks: out })
  }
  return changed
}

// ── Reconciliation: make the Task Manager agree with the schedule, safely, whenever data loads ───────────────────────

export interface ReconcileItem { eventId: string; ops: TaskOp[]; taskDateKey: string | null; reason: string }

type ReconEvent = PlanEvent & { id: string; taskDateKey?: string | null; taskLink?: TaskLink }

/**
 * Compares every persisted event with the calendar's tasks and returns the minimal ops that repair drift:
 *   • should have a task (deadline, or ordinary while sync is ON, and not opted out) but has none / it is on the wrong day / wrong kind /
 *     stale title / duplicated → create / move / convert / rename / drop extras;
 *   • should NOT have one (sync OFF, no longer a deadline, user opt-out, deleted event) → removed (kept and unlinked when it holds work);
 *   • an opted-out ('detached') event is NEVER recreated, whatever the global switch does.
 * Pure and idempotent: once the ops are applied a second pass returns nothing.
 */
export function reconcileDeadlines(cal: Record<string, DayData>, events: ReconEvent[], defaultActId: string, syncOn = false): ReconcileItem[] {
  const out: ReconcileItem[] = []
  const byId = new Map(events.map(e => [e.id, e]))
  for (const e of events) {
    const plan = planDeadlineSync(cal, e.id, e, e.taskDateKey ?? null, defaultActId, undefined, e.taskLink ?? 'linked', syncOn)
    if (plan.ops.length === 0 || !plan.changed) continue
    out.push({ eventId: e.id, ops: plan.ops, taskDateKey: plan.taskDateKey, reason: plan.outcome })
  }
  // orphans: a task still pointing at an event that no longer exists
  const seen = new Set<string>()
  for (const [key, day] of Object.entries(cal)) {
    for (const t of day.tasks ?? []) {
      if (!t.sourceEventId || byId.has(t.sourceEventId) || !okId(t.id)) continue
      const sig = `${key}|${t.id}`
      if (seen.has(sig)) continue
      seen.add(sig)
      out.push({ eventId: t.sourceEventId, ops: [{ kind: 'remove', date_key: key, task_id: t.id }], taskDateKey: null, reason: 'orphan' })
    }
  }
  return out
}

/** Splits reconcile items into server calls of at most `max` ops (the function's limit), never splitting one event's ops. */
export function batchItems(items: ReconcileItem[], max = 6): ReconcileItem[][] {
  const batches: ReconcileItem[][] = []; let cur: ReconcileItem[] = []; let n = 0
  for (const it of items) {
    if (n + it.ops.length > max && cur.length) { batches.push(cur); cur = []; n = 0 }
    cur.push(it); n += it.ops.length
  }
  if (cur.length) batches.push(cur)
  return batches
}

/** Every day key an op list touches (these days' pending local edits must reach the server before the ops run). */
export function opKeys(ops: TaskOp[]): string[] {
  const s = new Set<string>()
  for (const o of ops) { s.add(o.date_key); if (o.kind === 'move') s.add(o.from_key) }
  return [...s]
}

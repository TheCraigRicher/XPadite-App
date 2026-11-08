// ── Three-way merge of a calendar day document (v1.328, stale-write protection) ─────────────────────────────────────
// Pure (no React / network): unit-tested in tests/schedule/scheduleConcurrency.test.cjs.
//
// WHY: the database refuses a day write that was based on an out-of-date revision (calendar_day_save). The refused device then holds three versions:
//   base   — the document this device last synced from the server (what its edits were made on top of)
//   mine   — the document with this device's unsynced edits
//   theirs — the server's current document (changes made elsewhere in the meantime)
// A change is only ever TAKEN from the side that made it; two different changes to different tasks / different fields are both kept.
// If BOTH sides changed the SAME field of the SAME task (or day field) to DIFFERENT values, or one side deleted a task the other edited,
// correctness can not be established, so NOTHING is guessed: the conflict is reported and the user chooses.
//
// Merge units: the day's own fields (notes, journal, flags…), each task by its id, each task field, and — inside a task — sessions and
// attachments by their ids (so a timer session started on one device and a note typed on another both survive). Task order is merged too.

import type { DayData, Task } from './types'

export interface MergeConflict {
  scope: 'day' | 'task' | 'order'
  /** human-readable, e.g. "Task “Report” — notes" */
  label: string
  taskId?: string
  field?: string
}
export interface MergeResult {
  /** The merged document. Where there are conflicts it holds MY value for the conflicting spots (never used unless the user keeps mine). */
  doc: DayData
  conflicts: MergeConflict[]
}

type J = unknown
const isObj = (v: J): v is Record<string, J> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Canonical JSON: key order and undefined values do not matter. */
function canon(v: J): string {
  if (v === undefined) return 'u'
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']'
  if (isObj(v)) return '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}'
  return JSON.stringify(v)
}
export const sameJson = (a: J, b: J): boolean => canon(a) === canon(b)
/** True when two day documents hold exactly the same content. */
export const sameDoc = (a: DayData | null | undefined, b: DayData | null | undefined): boolean => sameJson(a ?? null, b ?? null)

const isIdArray = (v: J): v is Record<string, J>[] => Array.isArray(v) && v.length > 0 && v.every(x => isObj(x) && typeof x.id === 'string')
/** Tasks written by the schedule sync ('dl-' deadline, 'ev-' event): the event is their source of truth for title and link. */
const managed = (id: string) => id.startsWith('dl-') || id.startsWith('ev-')

interface Ctx { conflicts: MergeConflict[]; scope: 'day' | 'task'; taskId?: string; taskLabel?: string; managedTask?: boolean }

function conflict(ctx: Ctx, field: string): void {
  ctx.conflicts.push(ctx.scope === 'task'
    ? { scope: 'task', taskId: ctx.taskId, field, label: `Task “${ctx.taskLabel ?? ctx.taskId}” — ${field}` }
    : { scope: 'day', field, label: `Day — ${field}` })
}

/** Generic three-way merge of one value. undefined = absent. */
function mergeValue(b: J, m: J, t: J, ctx: Ctx, field: string): J {
  if (sameJson(m, t)) return m
  if (sameJson(m, b)) return t          // only they changed it
  if (sameJson(t, b)) return m          // only I changed it
  if (isObj(m) && isObj(t) && (b === undefined || isObj(b))) return mergeObj(isObj(b) ? b : undefined, m, t, ctx, field)
  if (isIdArray(m) && isIdArray(t) && (b === undefined || Array.isArray(b))) return mergeById(Array.isArray(b) ? (b as Record<string, J>[]) : [], m, t, ctx, field)
  if (ctx.managedTask && (field === 'text' || field === 'sourceEventId')) return t   // the event decides
  conflict(ctx, field)
  return m
}

function mergeObj(b: Record<string, J> | undefined, m: Record<string, J>, t: Record<string, J>, ctx: Ctx, path: string, skip: string[] = []): Record<string, J> {
  const out: Record<string, J> = {}
  const keys = new Set([...Object.keys(m), ...Object.keys(t), ...Object.keys(b ?? {})])
  for (const k of keys) {
    if (skip.includes(k)) continue
    const v = mergeValue(b?.[k], m[k], t[k], ctx, path && path !== 'task' ? `${path}.${k}` : k)
    if (v !== undefined) out[k] = v
  }
  return out
}

/** Lists of objects that carry an `id` (sessions, attachments): merged element by element. Order: theirs first, then my additions. */
function mergeById(b: Record<string, J>[], m: Record<string, J>[], t: Record<string, J>[], ctx: Ctx, field: string): Record<string, J>[] {
  const find = (list: Record<string, J>[], id: string) => list.find(x => x.id === id)
  const ids = [...t.map(x => x.id as string), ...m.map(x => x.id as string).filter(id => !find(t, id))]
  const out: Record<string, J>[] = []
  for (const id of ids) {
    const bi = find(b, id), mi = find(m, id), ti = find(t, id)
    if (mi && ti) { out.push(mergeValue(bi, mi, ti, ctx, `${field}[${id}]`) as Record<string, J>); continue }
    if (mi && !ti) {                                     // I have it, they do not
      if (!bi) out.push(mi)                              //   I added it
      else if (sameJson(mi, bi)) continue                //   they deleted it, I did not touch it → deleted
      else { conflict(ctx, `${field}[${id}] (deleted elsewhere, edited here)`); out.push(mi) }
    } else if (ti && !mi) {
      if (!bi) out.push(ti)                              //   they added it
      else if (sameJson(ti, bi)) continue                //   I deleted it, they did not touch it → deleted
      else { conflict(ctx, `${field}[${id}] (deleted here, edited elsewhere)`); out.push(ti) }
    }
  }
  return out
}

const eqArr = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i])

/** Inserts each id of `add` (taken in `source` order) right after its nearest predecessor in `source` that is already in `order`. */
function insertAfterPredecessor(order: string[], source: string[], add: string[]): string[] {
  const out = [...order]
  for (const id of source.filter(x => add.includes(x))) {
    let at = 0
    for (let i = source.indexOf(id) - 1; i >= 0; i--) { const p = out.indexOf(source[i]); if (p >= 0) { at = p + 1; break } }
    out.splice(at, 0, id)
  }
  return out
}

function mergeTasks(b: Task[], m: Task[], t: Task[], conflicts: MergeConflict[]): Task[] {
  const find = (list: Task[], id: string) => list.find(x => x.id === id)
  const label = (tk: Task) => tk.text || tk.id
  const kept = new Map<string, Task>()
  const mergeOne = (bi: Task | undefined, mi: Task, ti: Task): Task => {
    const ctx: Ctx = { conflicts, scope: 'task', taskId: mi.id, taskLabel: label(ti), managedTask: managed(mi.id) }
    if (!bi && managed(mi.id)) return ti                  // both sides created the same schedule-managed task: the server's copy is the truth
    return mergeObj(bi as unknown as Record<string, J> | undefined, mi as unknown as Record<string, J>, ti as unknown as Record<string, J>, ctx, 'task') as unknown as Task
  }
  const ids = new Set([...b.map(x => x.id), ...m.map(x => x.id), ...t.map(x => x.id)])
  for (const id of ids) {
    const bi = find(b, id), mi = find(m, id), ti = find(t, id)
    if (mi && ti) { kept.set(id, mergeOne(bi, mi, ti)); continue }
    if (mi && !ti) {
      if (!bi) kept.set(id, mi)
      else if (!sameJson(mi, bi)) { conflicts.push({ scope: 'task', taskId: id, field: 'deleted', label: `Task “${label(mi)}” — deleted on the other device, changed here` }); kept.set(id, mi) }
    } else if (ti && !mi) {
      if (!bi) kept.set(id, ti)
      else if (!sameJson(ti, bi)) { conflicts.push({ scope: 'task', taskId: id, field: 'deleted', label: `Task “${label(ti)}” — deleted here, changed on the other device` }); kept.set(id, ti) }
    }
  }
  // order
  const bo = b.map(x => x.id), mo = m.map(x => x.id).filter(id => kept.has(id)), to = t.map(x => x.id).filter(id => kept.has(id))
  const core = (list: string[]) => list.filter(id => bo.includes(id) && mo.includes(id) && to.includes(id))
  const baseCore = core(bo), mineCore = core(mo), theirCore = core(to)
  const mineMoved = !eqArr(mineCore, baseCore), theirsMoved = !eqArr(theirCore, baseCore)
  let order: string[]
  if (mineMoved && theirsMoved && !eqArr(mineCore, theirCore)) {
    conflicts.push({ scope: 'order', label: 'Task order — reordered differently on both devices' })
    order = insertAfterPredecessor(mo, to, to.filter(id => !mo.includes(id)))
  } else if (mineMoved && !theirsMoved) {
    order = insertAfterPredecessor(mo, to, to.filter(id => !mo.includes(id)))
  } else {
    order = insertAfterPredecessor(to, mo, mo.filter(id => !to.includes(id)))
  }
  return order.filter(id => kept.has(id)).map(id => kept.get(id) as Task)
}

/**
 * Three-way merge of a day. `base` null = this device has no record of the version it started from: only an exact match merges cleanly.
 * Inputs are never mutated.
 */
export function mergeDay(base: DayData | null, mine: DayData, theirs: DayData): MergeResult {
  if (sameDoc(mine, theirs)) return { doc: mine, conflicts: [] }
  if (base === null) {
    return { doc: mine, conflicts: [{ scope: 'day', label: 'This day was changed on another device, and this device has no record of the version it started from.' }] }
  }
  const conflicts: MergeConflict[] = []
  const rest = (d: DayData) => { const { tasks: _t, ...r } = d; void _t; return r as Record<string, J> }
  const ctx: Ctx = { conflicts, scope: 'day' }
  const dayFields = mergeObj(rest(base), rest(mine), rest(theirs), ctx, '')
  const tasks = mergeTasks(base.tasks ?? [], mine.tasks ?? [], theirs.tasks ?? [], conflicts)
  return { doc: { ...(dayFields as unknown as DayData), tasks }, conflicts }
}

import { createClient } from '@/lib/supabase/client'
import type { ScheduleEvent, ScheduleCategory, ScheduleRecurrence } from '@/components/xpadite/scheduleLogic'
import { sanitizeSavedLocations } from '@/components/xpadite/scheduleLogic'
import type { TaskOp, TaskLink } from '@/components/xpadite/deadlineLink'
import type { DayData } from '@/components/xpadite/types'

type Supabase = ReturnType<typeof createClient>

// ── My Schedule persistence (v1.328) ─────────────────────────────────────────
// Tables come from supabase/migrations/022_schedule_events.sql. Every read/write is scoped to the signed-in user
// (and RLS enforces it again on the server). Times are stored as absolute instants (timestamptz) and converted to
// epoch milliseconds / local wall-clock at the edge.

export interface ScheduleEventRow {
  event_id: string
  title: string
  category: string
  start_at: string
  end_at: string
  location: string | null
  meeting_url: string | null
  notes: string | null
  reminder_mins: number | null
  recurrence: string
  is_deadline: boolean
  task_date_key: string | null
  rev?: number
  task_link?: string
}

/** A persisted event plus where its linked task lives, its revision (optimistic concurrency) and the Task Manager choice. */
export type StoredScheduleEvent = ScheduleEvent & { taskDateKey?: string | null; rev?: number; taskLink?: TaskLink }

const RECURRENCES: ScheduleRecurrence[] = ['none', 'daily', 'weekly', 'monthly']

export function rowToEvent(r: ScheduleEventRow): StoredScheduleEvent {
  return {
    id: r.event_id,
    title: r.title,
    category: r.category,
    startAt: new Date(r.start_at).getTime(),
    endAt: new Date(r.end_at).getTime(),
    location: r.location ?? undefined,
    meetingUrl: r.meeting_url ?? undefined,
    notes: r.notes ?? undefined,
    reminderMins: r.reminder_mins,
    recurrence: (RECURRENCES as string[]).includes(r.recurrence) ? (r.recurrence as ScheduleRecurrence) : 'none',
    isDeadline: r.is_deadline ? true : undefined,
    taskDateKey: r.task_date_key,
    rev: typeof r.rev === 'number' ? r.rev : undefined,
    taskLink: r.task_link === 'detached' ? 'detached' : 'linked',
  }
}

export function eventToRow(userId: string, e: StoredScheduleEvent): Omit<ScheduleEventRow, 'rev' | 'task_link'> & { user_id: string } {
  return {
    user_id: userId,
    event_id: e.id,
    title: e.title,
    category: e.category,
    start_at: new Date(e.startAt).toISOString(),
    end_at: new Date(e.endAt).toISOString(),
    location: e.location ?? null,
    meeting_url: e.meetingUrl ?? null,
    notes: e.notes ?? null,
    reminder_mins: e.reminderMins ?? null,
    recurrence: e.recurrence ?? 'none',
    is_deadline: !!e.isDeadline,
    task_date_key: e.taskDateKey ?? null,
  }
}

const COLS = 'event_id, title, category, start_at, end_at, location, meeting_url, notes, reminder_mins, recurrence, is_deadline, task_date_key, rev, task_link'

export async function fetchScheduleEvents(supabase: Supabase, userId: string): Promise<StoredScheduleEvent[]> {
  const { data, error } = await supabase.from('schedule_events').select(COLS).eq('user_id', userId).order('start_at', { ascending: true })
  if (error) throw error
  return (data ?? []).map(r => rowToEvent(r as ScheduleEventRow))
}

// ── Atomic writes: schedule_apply / schedule_set_task_link (migration 023) ───────────────────────────────────────

/** Another tab/device saved this event first (stale revision). Nothing was written. */
export class ScheduleConflictError extends Error { constructor() { super('schedule_conflict') } }
/** The 023 functions are not installed on this database. Nothing was written. */
export class ScheduleSetupError extends Error { constructor(m = 'schedule_setup') { super(m) } }

interface RpcErr { code?: string; message?: string }
function classify(error: RpcErr): Error {
  const code = error.code ?? '', msg = error.message ?? ''
  if (code === 'XS409' || /schedule_conflict/.test(msg)) return new ScheduleConflictError()
  if (code === 'PGRST202' || code === '42883' || /Could not find the function|does not exist/i.test(msg)) return new ScheduleSetupError()
  return Object.assign(new Error(msg || 'request failed'), { code })
}

export interface ApplyResult { rev: number | null; days: Record<string, DayData>; revs: Record<string, number> }

/**
 * One transaction on the server: the event upsert / delete AND the linked-task ops commit together or not at all. Task ops are applied
 * by task id to the server's CURRENT copy of each day, so nothing else in the day is touched. Throws (writing nothing) on any failure.
 */
export async function applyScheduleChange(
  supabase: Supabase,
  args: { userId: string; event?: StoredScheduleEvent & { setTaskLink?: TaskLink }; deleteEventId?: string; expectedRev?: number | null; ops: TaskOp[] },
): Promise<ApplyResult> {
  let payload: Record<string, unknown> | null = null
  if (args.event) {
    const { user_id: _u, ...row } = eventToRow(args.userId, args.event); void _u
    payload = { ...row, ...(args.event.setTaskLink ? { task_link: args.event.setTaskLink } : null) }
  }
  const { data, error } = await supabase.rpc('schedule_apply', {
    p_event: payload, p_delete_event_id: args.deleteEventId ?? null, p_expected_rev: args.expectedRev ?? null, p_ops: args.ops,
  })
  if (error) throw classify(error)
  const r = (data ?? {}) as { rev?: number | null; days?: Record<string, DayData>; revs?: Record<string, number> }
  return { rev: r.rev ?? null, days: r.days ?? {}, revs: r.revs ?? {} }
}

/** Records "removed from Task Manager" ('detached') or "restored" ('linked') on the event. Returns the new revision (null = no such event). */
export async function setScheduleTaskLink(supabase: Supabase, eventId: string, link: TaskLink): Promise<number | null> {
  const { data, error } = await supabase.rpc('schedule_set_task_link', { p_event_id: eventId, p_link: link })
  if (error) throw classify(error)
  return (data as number | null) ?? null
}

/** The user's "Sync with Task Manager" switch (migration 024). Throws when it can not be read/written. */
export async function fetchScheduleSyncPref(supabase: Supabase, userId: string): Promise<boolean> {
  const { data, error } = await supabase.from('user_preferences').select('schedule_task_sync').eq('user_id', userId).maybeSingle()
  if (error) throw error
  return !!data?.schedule_task_sync
}
export async function setScheduleSyncPref(supabase: Supabase, enabled: boolean): Promise<boolean> {
  const { data, error } = await supabase.rpc('schedule_set_sync', { p_enabled: enabled })
  if (error) throw classify(error)
  return !!data
}

// ── Saved locations + custom categories (user_preferences, per user) ─────────

export interface ScheduleExtras { savedLocations: string[]; categories: ScheduleCategory[] }

export async function fetchScheduleExtras(supabase: Supabase, userId: string): Promise<ScheduleExtras> {
  const { data, error } = await supabase.from('user_preferences').select('saved_locations, schedule_categories').eq('user_id', userId).maybeSingle()
  if (error) throw error
  const cats = Array.isArray(data?.schedule_categories) ? (data?.schedule_categories as ScheduleCategory[]) : []
  return {
    savedLocations: sanitizeSavedLocations(data?.saved_locations),
    categories: cats.filter(c => c && typeof c.id === 'string' && typeof c.label === 'string' && !c.builtIn),
  }
}

export async function saveScheduleExtras(supabase: Supabase, userId: string, patch: Partial<ScheduleExtras>): Promise<void> {
  const row: Record<string, unknown> = { user_id: userId }
  if (patch.savedLocations) row.saved_locations = patch.savedLocations
  if (patch.categories) row.schedule_categories = patch.categories.filter(c => !c.builtIn)
  const { error } = await supabase.from('user_preferences').upsert(row, { onConflict: 'user_id' })
  if (error) throw error
}

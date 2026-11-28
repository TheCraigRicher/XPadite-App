'use client'

// ── Deadline hooks (v1.345) ──────────────────────────────────────────────────────────────────────────────────────────
// useDeadlines()        every deadline by day (derived from My Schedule events + tasks with a due date), refreshed every 30 s so a deadline that
//                       passes turns Overdue by itself.
// useDeadlineActions()  complete / reopen a deadline and set / clear a task's own due date. Completion always goes where it is authoritative:
//                       the linked Task Manager task when there is one, otherwise the event row.

import { useCallback, useEffect, useState } from 'react'
import { useApp } from './AppContext'
import { deadlineIndex, type DeadlineItem } from './deadlineIndex'
import { completionPatch, type TaskDue } from './dueStatus'
import { withAck, type AckOutcome } from './deadlineAck'

export function useDeadlines(): Record<string, DeadlineItem[]> {
  const { calData, scheduleEvents, effectiveTimezone } = useApp()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(id)
  }, [])
  const index = deadlineIndex(scheduleEvents, calData, effectiveTimezone, now)
  // v1.361: also refresh at the very moment the next not-yet-reached deadline comes due, so Overdue and the question appear on time without faster polling
  useEffect(() => {
    let next = Infinity
    for (const items of Object.values(index)) for (const it of items) if (!it.done && it.dueAt > now && it.dueAt < next) next = it.dueAt
    if (!Number.isFinite(next)) return
    const t = window.setTimeout(() => setNow(Date.now()), Math.min(next - now + 400, 2_000_000_000))
    return () => window.clearTimeout(t)
  }, [index, now])
  return index
}

/** One deadline by event id (null when it is not a deadline / not found). */
export function useEventDeadline(eventId: string | undefined): DeadlineItem | null {
  const all = useDeadlines()
  if (!eventId) return null
  for (const items of Object.values(all)) for (const it of items) if (it.source === 'event' && it.eventId === eventId) return it
  return null
}

export function useDeadlineActions() {
  const { updateDay, setDeadlineCompleted, setToast } = useApp()

  /** Marks a deadline complete (done = true) or reopens it (done = false). */
  const setDone = useCallback(async (item: DeadlineItem, done: boolean): Promise<boolean> => {
    try {
      if (item.taskId && item.taskDateKey) {
        const patch = completionPatch(done)
        const tid = item.taskId
        updateDay(item.taskDateKey, prev => ({ ...prev, tasks: prev.tasks.map(t => (t.id === tid ? { ...t, ...patch } : t)) }))
        return true
      }
      if (item.source === 'event' && item.eventId) { await setDeadlineCompleted(item.eventId, done ? Date.now() : null); return true }
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Could not save the change.')
    }
    return false
  }, [updateDay, setDeadlineCompleted, setToast])

  /**
   * Records the user's answer to "Did you meet the deadline…?". Yes completes the deadline through the SAME path as the checkbox / Mark Complete (so the task,
   * its green state, My Schedule, analytics and the real completion instant all behave exactly as before) and then records the answer; No only records the
   * answer — the task stays open and unchecked. Nothing is recorded unless the completion itself succeeded.
   */
  const acknowledge = useCallback(async (item: DeadlineItem, outcome: AckOutcome): Promise<boolean> => {
    if (outcome === 'met' && !item.done) { if (!(await setDone(item, true))) return false }
    const ack = { dueAt: item.dueAt, outcome, at: Date.now() }
    updateDay(item.dayKey, prev => withAck(prev, item.id, ack))
    return true
  }, [setDone, updateDay])

  /** Sets (due) or clears (null) a task's OWN due date. Never used for My Schedule deadline tasks — their due date belongs to the event. */
  const setTaskDue = useCallback((dateKey: string, taskId: string, due: TaskDue | null) => {
    updateDay(dateKey, prev => ({
      ...prev,
      tasks: prev.tasks.map(t => {
        if (t.id !== taskId || t.sourceEventId) return t
        if (due) return { ...t, due }
        const rest = { ...t }; delete rest.due
        return rest
      }),
    }))
  }, [updateDay])

  return { setDone, setTaskDue, acknowledge }
}

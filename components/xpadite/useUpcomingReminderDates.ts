'use client'

import { useMemo, useState, useEffect } from 'react'
import type { Reminder, CalendarData } from './types'

/** Local "YYYY-MM-DD" string for the current moment in the browser's timezone. */
function localTodayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Milliseconds from now until the next local midnight (+1 ms buffer). */
function msUntilMidnight(): number {
  const now = new Date()
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0)
  return midnight.getTime() - now.getTime() + 1
}

/**
 * Returns the calendar date key where a reminder's ring should appear, or null.
 *
 * Calendar date source:
 *   'once'   → r.dateKey (the task's calendar date). nextRunAt is NOT used because
 *               ReminderModal computes it via computeNextRunAt(time,'once',Date.now()),
 *               which starts from the current moment — not the task's date — and may
 *               land on a completely different calendar day.
 *   recurring → local date of r.nextRunAt, which fireReminderCtx advances after each
 *               occurrence fires, so it always tracks the next upcoming day correctly.
 *
 * A ring is shown only while ALL of the following are true:
 *   1. r.isActive — reminder is enabled
 *   2. ringKey >= todayKey — the ring date has not yet ended (expiry at local midnight)
 *   3. The task exists in calData at r.dateKey
 *   4. The task is not done (task.done === false)
 */
function ringDateKey(
  r: Reminder,
  calData: CalendarData,
  todayKey: string,
  now: number,
): string | null {
  if (!r.isActive) return null

  let key: string
  if (r.repeatFrequency === 'once') {
    key = r.dateKey
  } else {
    if (r.nextRunAt <= now) return null
    const dt = new Date(r.nextRunAt)
    key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
  }

  // Ring disappears automatically when the calendar day ends
  if (key < todayKey) return null

  // Task must exist at its calendar date and must not be completed.
  // For recurring reminders the task still lives at r.dateKey (the original task date).
  const task = calData[r.dateKey]?.tasks?.find(t => t.id === r.taskId)
  if (!task || task.done) return null

  if (process.env.NODE_ENV === 'development') {
    console.debug('[ReminderRing] ring assigned', {
      reminderId: r.id,
      taskId: r.taskId,
      taskDateKey: r.dateKey,
      repeatFrequency: r.repeatFrequency,
      nextRunAt: r.nextRunAt,
      nextRunAtLocal: new Date(r.nextRunAt).toLocaleString(),
      isActive: r.isActive,
      ringKey: key,
      todayKey,
      taskDone: task.done,
    })
  }

  return key
}

/**
 * Returns Map<"YYYY-MM-DD", count> of calendar dates that should show a red reminder ring.
 *
 * A date is included only when the reminder is active, its linked task exists and is
 * unfinished, and the ring date has not yet ended (rings clear at local midnight).
 *
 * Recalculates on: reminders/calData change, tab visibility change, local midnight.
 * Uses a single shared midnight timer — no per-reminder timers.
 */
export function useUpcomingReminderDates(
  reminders: Reminder[],
  calData: CalendarData,
): Map<string, number> {
  const [tick, setTick] = useState(0)

  // Retick when the tab regains visibility (catches midnight while tab was hidden)
  useEffect(() => {
    function onVisibility() {
      if (document.visibilityState === 'visible') setTick(t => t + 1)
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  // Single timer that fires at the next local midnight, clearing any expired rings
  useEffect(() => {
    const id = setTimeout(() => setTick(t => t + 1), msUntilMidnight())
    return () => clearTimeout(id)
  }, [tick]) // re-arms after every tick so it always targets the next midnight

  return useMemo(() => {
    const now = Date.now()
    const todayKey = localTodayKey()
    const map = new Map<string, number>()
    for (const r of reminders) {
      const key = ringDateKey(r, calData, todayKey, now)
      if (!key) continue
      map.set(key, (map.get(key) ?? 0) + 1)
    }
    return map
  }, [reminders, calData, tick])
}

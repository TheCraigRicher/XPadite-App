'use client'

// ── My Schedule — shared categories + preferences (React context) ───────────
// The modal owns the (in-memory) custom categories and preferences and provides them here, so every piece of the schedule UI
// (grid, legend, forms, details, Today agenda) reads one source and updates immediately. Nothing here is stored.

import { createContext, useContext } from 'react'
import { DEFAULT_PREFS, SCHEDULE_CATEGORIES, categoryMeta } from './scheduleLogic'
import type { ScheduleCategory, ScheduleCategoryId, SchedulePrefs } from './scheduleLogic'

export interface ScheduleContextValue {
  categories: ScheduleCategory[]
  prefs: SchedulePrefs
  /** Re-creates a deadline's Task Manager task after the user removed it (Event Details button). */
  restoreTask?: (eventId: string) => void
  /** The user's "Sync with Task Manager" switch (saved per user). */
  taskSync?: boolean
}

export const ScheduleContext = createContext<ScheduleContextValue>({ categories: SCHEDULE_CATEGORIES, prefs: DEFAULT_PREFS })

export function useSchedule() {
  const { categories, prefs, restoreTask, taskSync } = useContext(ScheduleContext)
  return {
    categories,
    prefs,
    restoreTask,
    taskSync: !!taskSync,
    fmt: prefs.timeFormat,
    meta: (id: ScheduleCategoryId) => categoryMeta(id, categories),
  }
}

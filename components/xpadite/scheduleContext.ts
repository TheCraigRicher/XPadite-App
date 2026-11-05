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
}

export const ScheduleContext = createContext<ScheduleContextValue>({ categories: SCHEDULE_CATEGORIES, prefs: DEFAULT_PREFS })

export function useSchedule() {
  const { categories, prefs } = useContext(ScheduleContext)
  return {
    categories,
    prefs,
    fmt: prefs.timeFormat,
    meta: (id: ScheduleCategoryId) => categoryMeta(id, categories),
  }
}

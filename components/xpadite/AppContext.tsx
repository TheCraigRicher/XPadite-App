'use client'

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import type { CalendarData, WorkSession, Activity, ActiveSession, DayData, ActiveTaskTimer } from './types'

const DEFAULT_ACTIVITIES: Activity[] = [
  { id: 'a1', name: 'Work', color: '#7c3aed' },
  { id: 'a2', name: 'Workout', color: '#16a34a' },
  { id: 'a3', name: 'Learning', color: '#0891b2' },
  { id: 'a4', name: 'Coding', color: '#6366f1' },
  { id: 'a5', name: 'Personal', color: '#d97706' },
  { id: 'a-meal', name: '🍽 Meal', color: '#f59e0b' },
  { id: 'a-break', name: '☕ Break', color: '#64748b' },
]

// Built-in activities that should always exist even for users with existing saved data
const BUILTIN_EXTRAS: Activity[] = [
  { id: 'a-meal', name: '🍽 Meal', color: '#f59e0b' },
  { id: 'a-break', name: '☕ Break', color: '#64748b' },
]

export const EMPTY_DAY: DayData = {
  productive: false,
  hyper: false,
  notes: '',
  tasks: [],
  journal: '',
}

interface AppContextValue {
  calData: CalendarData
  updateDay: (key: string, updater: (prev: DayData) => DayData) => void
  sessions: WorkSession[]
  addSession: (s: WorkSession) => void
  activities: Activity[]
  addActivity: (a: Activity) => void
  removeActivity: (id: string) => void
  updateActivity: (id: string, patch: Partial<Activity>) => void
  selectedActId: string
  setSelectedActId: (id: string) => void
  isDark: boolean
  setIsDark: (v: boolean) => void
  activeSession: ActiveSession | null
  setActiveSession: (s: ActiveSession | null) => void
  activeTaskTimer: ActiveTaskTimer | null
  setActiveTaskTimer: (t: ActiveTaskTimer | null) => void
  removingMode: boolean
  setRemovingMode: (v: boolean) => void
  sidebarOpen: boolean
  setSidebarOpen: (v: boolean) => void
  toast: string | null
  setToast: (msg: string | null) => void
}

const AppContext = createContext<AppContextValue | null>(null)

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be inside AppProvider')
  return ctx
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [calData, setCalData] = useState<CalendarData>({})
  const [sessions, setSessions] = useState<WorkSession[]>([])
  const [activities, setActivitiesState] = useState<Activity[]>(DEFAULT_ACTIVITIES)
  const [selectedActId, setSelectedActId] = useState<string>(DEFAULT_ACTIVITIES[0].id)
  const [isDark, setIsDark] = useState(false)
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null)
  const [activeTaskTimer, setActiveTaskTimer] = useState<ActiveTaskTimer | null>(null)
  const [removingMode, setRemovingMode] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    try {
      const d = localStorage.getItem('xp9d')
      if (d) {
        const parsed = JSON.parse(d) as CalendarData
        // Migrate: ensure all tasks have sessions array
        Object.values(parsed).forEach(day => {
          day.tasks?.forEach(task => {
            if (!Array.isArray(task.sessions)) task.sessions = []
          })
        })
        setCalData(parsed)
      }
    } catch {}
    try {
      const s = localStorage.getItem('xp9s')
      if (s) setSessions(JSON.parse(s))
    } catch {}
    try {
      const a = localStorage.getItem('xp9a')
      if (a) {
        const parsed: Activity[] = JSON.parse(a)
        // Ensure built-in activities always exist
        BUILTIN_EXTRAS.forEach(b => {
          if (!parsed.some(act => act.id === b.id)) parsed.push(b)
        })
        if (parsed.length) {
          setActivitiesState(parsed)
          setSelectedActId(parsed[0].id)
        }
      }
    } catch {}
    setHydrated(true)
  }, [])

  const updateDay = useCallback((key: string, updater: (prev: DayData) => DayData) => {
    setCalData(prev => {
      const current = prev[key] ?? { ...EMPTY_DAY }
      const next = { ...prev, [key]: updater(current) }
      try { localStorage.setItem('xp9d', JSON.stringify(next)) } catch {}
      return next
    })
  }, [])

  const addSession = useCallback((s: WorkSession) => {
    setSessions(prev => {
      const next = [...prev, s]
      try { localStorage.setItem('xp9s', JSON.stringify(next)) } catch {}
      return next
    })
  }, [])

  const addActivity = useCallback((a: Activity) => {
    setActivitiesState(prev => {
      const next = [...prev, a]
      try { localStorage.setItem('xp9a', JSON.stringify(next)) } catch {}
      return next
    })
  }, [])

  const updateActivity = useCallback((id: string, patch: Partial<Activity>) => {
    setActivitiesState(prev => {
      const next = prev.map(a => a.id === id ? { ...a, ...patch } : a)
      try { localStorage.setItem('xp9a', JSON.stringify(next)) } catch {}
      return next
    })
  }, [])

  const removeActivity = useCallback((id: string) => {
    setActivitiesState(prev => {
      const next = prev.filter(a => a.id !== id)
      try { localStorage.setItem('xp9a', JSON.stringify(next)) } catch {}
      return next
    })
    setSelectedActId(prev => {
      if (prev === id) {
        const remaining = activities.filter(a => a.id !== id)
        return remaining[0]?.id ?? DEFAULT_ACTIVITIES[0].id
      }
      return prev
    })
  }, [activities])

  if (!hydrated) return null

  return (
    <AppContext.Provider value={{
      calData, updateDay,
      sessions, addSession,
      activities, addActivity, removeActivity, updateActivity,
      selectedActId, setSelectedActId,
      isDark, setIsDark,
      activeSession, setActiveSession,
      activeTaskTimer, setActiveTaskTimer,
      removingMode, setRemovingMode,
      sidebarOpen, setSidebarOpen,
      toast, setToast,
    }}>
      {children}
    </AppContext.Provider>
  )
}

'use client'

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import type { CalendarData, WorkSession, Activity, ActiveSession, DayData, ActiveTaskTimer, Reminder } from './types'
import {
  upsertReminder as supabaseUpsertReminder,
  deleteReminder as supabaseDeleteReminder,
  patchReminder as supabasePatchReminder,
  computeNextRunAt,
} from '@/lib/reminders'
import { createClient } from '@/lib/supabase/client'

const DEFAULT_ACTIVITIES: Activity[] = [
  { id: 'a1', name: 'Work', color: '#7c3aed' },
  { id: 'a2', name: 'Workout', color: '#16a34a' },
  { id: 'a3', name: 'Learning', color: '#0891b2' },
  { id: 'a4', name: 'Coding', color: '#6366f1' },
  { id: 'a5', name: 'Personal', color: '#d97706' },
  { id: 'a-meal', name: '🍽 Meal', color: '#f59e0b' },
  { id: 'a-break', name: '☕ Break', color: '#64748b' },
]

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

function makeReminderId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // RFC 4122 v4 UUID fallback for environments where crypto.randomUUID is unavailable
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

// Persist reminders to localStorage and return the new array for use in setState
function persistReminders(next: Reminder[]): Reminder[] {
  try { localStorage.setItem('xp9r', JSON.stringify(next)) } catch {}
  return next
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
  // Reminders
  reminders: Reminder[]
  userEmail: string
  upsertReminderCtx: (r: Omit<Reminder, 'id'> & { id?: string }) => Promise<Reminder | null>
  removeReminderCtx: (id: string) => Promise<void>
  fireReminderCtx: (id: string) => Promise<void>
}

const AppContext = createContext<AppContextValue | null>(null)

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be inside AppProvider')
  return ctx
}

export function AppProvider({ children, email = '' }: { children: React.ReactNode; email?: string }) {
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

  const [reminders, setReminders] = useState<Reminder[]>([])
  const [userId, setUserId] = useState('')
  const userEmail = email

  // Stable refs so callbacks never close over stale values
  const remindersRef = useRef(reminders)
  remindersRef.current = reminders
  const userIdRef = useRef(userId)
  userIdRef.current = userId

  // ─── Load from localStorage on mount ────────────────────────────────────────

  useEffect(() => {
    try {
      const d = localStorage.getItem('xp9d')
      if (d) {
        const parsed = JSON.parse(d) as CalendarData
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
        BUILTIN_EXTRAS.forEach(b => {
          if (!parsed.some(act => act.id === b.id)) parsed.push(b)
        })
        if (parsed.length) {
          setActivitiesState(parsed)
          setSelectedActId(parsed[0].id)
        }
      }
    } catch {}
    try {
      // Reminders primary store is localStorage — loaded here, persisted here
      const r = localStorage.getItem('xp9r')
      if (r) setReminders(JSON.parse(r) as Reminder[])
    } catch {}
    setHydrated(true)
  }, [])

  // Fetch Supabase userId for background sync (does NOT overwrite reminders)
  useEffect(() => {
    if (!hydrated) return
    createClient().auth.getUser().then(({ data }) => {
      if (data.user) setUserId(data.user.id)
    }).catch(() => {})
  }, [hydrated])

  // ─── Core data mutations ─────────────────────────────────────────────────────

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

  // ─── Reminder CRUD (localStorage-primary, Supabase background sync) ──────────

  const upsertReminderCtx = useCallback(async (
    reminder: Omit<Reminder, 'id'> & { id?: string },
  ): Promise<Reminder | null> => {
    const id = reminder.id ?? makeReminderId()
    const saved: Reminder = { ...reminder, id }

    // Compute next array from stable ref (no stale closure risk)
    const current = remindersRef.current
    const idx = current.findIndex(r => r.id === id)
    const next = idx >= 0
      ? current.map(r => r.id === id ? saved : r)
      : [...current, saved]

    // Write to localStorage synchronously BEFORE React state update
    // This ensures persistence even if the component unmounts between clicks
    persistReminders(next)
    setReminders(next)

    // Background Supabase sync — fetch user fresh so we never rely on stale cached userId
    ;(async () => {
      try {
        let uid = userIdRef.current
        if (!uid) {
          const { data, error: authError } = await createClient().auth.getUser()
          if (authError) {
            console.error('[Reminders] Auth error fetching user:', authError.message)
            return
          }
          if (!data.user) {
            console.warn('[Reminders] No authenticated user — Supabase sync skipped (localStorage saved)')
            return
          }
          uid = data.user.id
          setUserId(uid)
        }
        console.log(
          `[Reminders] Upserting id=${saved.id}` +
          ` isActive=${saved.isActive}` +
          ` nextRunAt=${saved.nextRunAt} (${new Date(saved.nextRunAt).toISOString()})` +
          ` lastSentAt=${saved.lastSentAt}`,
        )
        const result = await supabaseUpsertReminder(saved, uid)
        if (!result) {
          console.error('[Reminders] Supabase upsert returned null — check RLS policies and id column type')
        }
      } catch (err) {
        console.error('[Reminders] Supabase sync threw:', err)
      }
    })()

    return saved
  }, [])

  const removeReminderCtx = useCallback(async (id: string): Promise<void> => {
    const next = remindersRef.current.filter(r => r.id !== id)
    persistReminders(next)
    setReminders(next)
    const uid = userIdRef.current
    if (uid) supabaseDeleteReminder(id).catch(() => {})
  }, [])

  // Called by ReminderChecker when an in-app/sound/browser alert fires.
  // isActive is NEVER changed here — it means "user wants this reminder".
  // localFiredAt is the local-only flag that prevents the checker from double-firing.
  const fireReminderCtx = useCallback(async (id: string): Promise<void> => {
    const reminder = remindersRef.current.find(r => r.id === id)
    if (!reminder) return

    const isOnce = reminder.repeatFrequency === 'once'
    const now = Date.now()
    // Repeating: advance nextRunAt so checker naturally skips until next period.
    // Once: keep nextRunAt unchanged — localFiredAt is the gate against re-firing.
    const nextRunAt = isOnce
      ? reminder.nextRunAt
      : computeNextRunAt(reminder.reminderTime, reminder.repeatFrequency, Date.now(), reminder.timezone)

    // Update local state:
    //   localFiredAt = now  → ReminderChecker skips this reminder after page refresh
    //   isActive stays TRUE → reminder is user-enabled; Supabase cron needs is_active=true
    //   nextRunAt advances  → repeating reminders naturally skip until next period
    const next = remindersRef.current.map(r =>
      r.id === id ? { ...r, localFiredAt: now, nextRunAt } : r,
    )
    persistReminders(next)
    setReminders(next)

    // Supabase sync — three cases:
    //   1. Once + email enabled  → NO patch at all. Cron finds is_active=true, sends email,
    //                              then sets is_active=false. Patching here races the cron.
    //   2. Once + no email       → Deactivate in Supabase now; no backend will process this row.
    //   3. Repeating (any)       → Advance nextRunAt only; is_active stays true.
    const uid = userIdRef.current
    if (uid) {
      if (isOnce && reminder.emailEnabled) {
        console.log(
          `[Reminders] Local alert fired id=${id} (once+email)` +
          ` — is_active preserved=true for email cron, no Supabase patch`,
        )
        // No Supabase patch — intentional
      } else if (isOnce && !reminder.emailEnabled) {
        console.log(`[Reminders] Local alert fired id=${id} (once, no email) — deactivating in Supabase`)
        supabasePatchReminder(id, { isActive: false, nextRunAt, lastSentAt: now }).catch(err => {
          console.error('[Reminders] fireReminderCtx deactivate patch error:', err)
        })
      } else {
        console.log(
          `[Reminders] Local alert fired id=${id} (repeating)` +
          ` — advancing nextRunAt=${new Date(nextRunAt).toISOString()} in Supabase`,
        )
        supabasePatchReminder(id, { nextRunAt }).catch(err => {
          console.error('[Reminders] fireReminderCtx advance patch error:', err)
        })
      }
    }
  }, [])

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
      reminders, userEmail,
      upsertReminderCtx, removeReminderCtx, fireReminderCtx,
    }}>
      {children}
    </AppContext.Provider>
  )
}

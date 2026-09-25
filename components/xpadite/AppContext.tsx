'use client'

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import type { CalendarData, WorkSession, Activity, ActiveSession, DayData, ActiveTaskTimer, Reminder, JournalLabel, JournalFolder } from './types'
import { normalizeHexColor, todayKey } from './utils'
import {
  upsertReminder as supabaseUpsertReminder,
  deleteReminder as supabaseDeleteReminder,
  patchReminder as supabasePatchReminder,
  fetchReminders as supabaseFetchReminders,
  computeNextRunAt,
} from '@/lib/reminders'
import { createClient } from '@/lib/supabase/client'
import {
  fetchCalendarDays,
  fetchCalendarDay,
  upsertDayData,
  fetchWorkSessions,
  fetchOpenWorkSessions,
  upsertWorkSession,
  fetchUserActivities,
  upsertAllActivities,
  deleteUserActivity,
  fetchUserPreferences,
  upsertUserPreferences,
  fetchJournalLabels,
  upsertAllJournalLabels,
  deleteJournalLabel,
  fetchJournalFolders,
  upsertAllJournalFolders,
  deleteJournalFolder,
} from '@/lib/supabase/core-data'

const DEFAULT_ACTIVITIES: Activity[] = [
  { id: 'a1',      name: 'Work',                 color: '#7c3aed' },
  { id: 'a2',      name: 'Workout',              color: '#16a34a' },
  { id: 'a3',      name: 'Learning',             color: '#0891b2' },
  { id: 'a4',      name: 'Coding',               color: '#6366f1' },
  { id: 'a5',      name: 'Personal',             color: '#d97706' },
  { id: 'a-meal',  name: '🍽 Meal',              color: '#f59e0b', countsTowardProductivity: false },
  { id: 'a-break', name: '☕ Break',             color: '#64748b', countsTowardProductivity: false },
  { id: 'a-plan',  name: 'Planning/Journaling',  color: '#22c55e', countsTowardProductivity: true },
]

// These are always present — injected/updated on every localStorage load so they can never be removed.
// On update: only countsTowardProductivity is forced so user color/name customisations are preserved.
const BUILTIN_EXTRAS: Activity[] = [
  { id: 'a-meal',  name: '🍽 Meal',              color: '#f59e0b', countsTowardProductivity: false },
  { id: 'a-break', name: '☕ Break',             color: '#64748b', countsTowardProductivity: false },
  { id: 'a-plan',  name: 'Planning/Journaling',  color: '#22c55e', countsTowardProductivity: true },
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
  calendarClean: boolean
  setCalendarClean: (v: boolean) => void
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
  progressColor: string
  setProgressColor: (c: string) => void
  customColors: string[]
  addCustomColor: (hex: string) => boolean
  removeCustomColor: (hex: string) => void
  legendVisible: boolean
  setLegendVisible: (v: boolean) => void
  // Journal Library organization
  journalLabels: JournalLabel[]
  addJournalLabel: (l: JournalLabel) => void
  removeJournalLabel: (id: string) => void
  journalFolders: JournalFolder[]
  addJournalFolder: (f: JournalFolder) => void
  removeJournalFolder: (id: string) => void
  // Reminders
  reminders: Reminder[]
  userEmail: string
  upsertReminderCtx: (r: Omit<Reminder, 'id'> & { id?: string }) => Promise<Reminder | null>
  removeReminderCtx: (id: string) => Promise<void>
  fireReminderCtx: (id: string) => Promise<void>
  setReminderNotificationsEnabled: (id: string, enabled: boolean) => Promise<void>
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
  const [isDark, setIsDarkRaw] = useState(false)
  const [calendarClean, setCalendarClean] = useState(false)
  const [activeSession, setActiveSessionRaw] = useState<ActiveSession | null>(null)
  const [activeTaskTimer, setActiveTaskTimerRaw] = useState<ActiveTaskTimer | null>(null)
  const [removingMode, setRemovingMode] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [progressColor, setProgressColorRaw] = useState<string>('#7c3aed')
  const [customColors, setCustomColorsRaw] = useState<string[]>([])
  const [legendVisible, setLegendVisible] = useState(false)
  const [journalLabels, setJournalLabelsState] = useState<JournalLabel[]>([])
  const [journalFolders, setJournalFoldersState] = useState<JournalFolder[]>([])
  const [hydrated, setHydrated] = useState(false)

  const [reminders, setReminders] = useState<Reminder[]>([])
  const [userId, setUserId] = useState('')
  const userEmail = email

  // Stable refs so callbacks never close over stale values
  const remindersRef = useRef(reminders)
  remindersRef.current = reminders
  const userIdRef = useRef(userId)
  userIdRef.current = userId
  const activitiesRef = useRef(activities)
  activitiesRef.current = activities
  const journalLabelsRef = useRef(journalLabels)
  journalLabelsRef.current = journalLabels
  const journalFoldersRef = useRef(journalFolders)
  journalFoldersRef.current = journalFolders
  const activeTaskTimerRef = useRef(activeTaskTimer)
  activeTaskTimerRef.current = activeTaskTimer
  const activeSessionRef = useRef(activeSession)
  activeSessionRef.current = activeSession

  // Per-dateKey debounce timers for Supabase day upserts (1 second idle = flush)
  const pendingDaySyncTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  // Latest DayData awaiting sync for each dateKey (written synchronously, read by timer)
  const pendingDaySyncDataRef = useRef<Map<string, DayData>>(new Map())

  // ─── Load from localStorage on mount ────────────────────────────────────────

  useEffect(() => {
    try {
      const d = localStorage.getItem('xp9d')
      if (d) {
        const parsed = JSON.parse(d) as CalendarData
        Object.values(parsed).forEach(day => {
          // Guard legacy entries that pre-date the tasks field
          if (!Array.isArray(day.tasks)) day.tasks = []
          day.tasks.forEach(task => {
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
          const idx = parsed.findIndex(act => act.id === b.id)
          if (idx === -1) {
            parsed.push(b)
          } else {
            // Force productivity classification while preserving user's color/name choices
            parsed[idx] = { ...parsed[idx], countsTowardProductivity: b.countsTowardProductivity }
          }
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
    try {
      const pc = localStorage.getItem('xp-progress-color')
      if (pc) setProgressColorRaw(pc)
    } catch {}
    try {
      const cc = localStorage.getItem('xp-custom-colors')
      if (cc) setCustomColorsRaw(JSON.parse(cc) as string[])
    } catch {}
    try {
      const jl = localStorage.getItem('xp9jl')
      if (jl) setJournalLabelsState(JSON.parse(jl) as JournalLabel[])
    } catch {}
    try {
      const jf = localStorage.getItem('xp9jf')
      if (jf) setJournalFoldersState(JSON.parse(jf) as JournalFolder[])
    } catch {}
    try {
      // Theme is now persisted — load from localStorage so it survives page refreshes
      const theme = localStorage.getItem('xp-theme')
      if (theme !== null) setIsDarkRaw(theme === 'true')
    } catch {}
    // Restore active clock-in session so page refresh doesn't lose an in-progress timer
    try {
      const as = localStorage.getItem('xp9-active-session')
      if (as) setActiveSessionRaw(JSON.parse(as) as ActiveSession)
    } catch {}
    try {
      const att = localStorage.getItem('xp9-active-task-timer')
      if (att) setActiveTaskTimerRaw(JSON.parse(att) as ActiveTaskTimer)
    } catch {}
    setHydrated(true)
  }, [])

  // ─── Resolve Supabase user ID after hydration ────────────────────────────────

  useEffect(() => {
    if (!hydrated) return
    createClient().auth.getUser().then(({ data }) => {
      if (data.user) setUserId(data.user.id)
    }).catch(() => {})
  }, [hydrated])

  // ─── Initial Supabase data fetch ─────────────────────────────────────────────
  // Runs once per session when the user ID becomes available.
  // SAFETY: if Supabase returns empty data for a table, we keep the existing
  // localStorage state untouched — this protects pre-migration desktop data.

  useEffect(() => {
    if (!userId) return
    const supabase = createClient()

    Promise.all([
      fetchCalendarDays(supabase, userId),
      fetchWorkSessions(supabase, userId),
      fetchUserActivities(supabase, userId),
      fetchUserPreferences(supabase, userId),
      supabaseFetchReminders(),
      fetchJournalLabels(supabase, userId),
      fetchJournalFolders(supabase, userId),
    ]).then(([sbCalData, sbSessions, sbActivities, sbPrefs, sbReminders, sbJournalLabels, sbJournalFolders]) => {

      // Calendar days: merge if Supabase has rows; Supabase data wins per date key.
      // Skip days that have a pending local write to avoid a race between a fast
      // user edit (debounce not yet fired) and the hydration network response.
      if (Object.keys(sbCalData).length > 0) {
        setCalData(prev => {
          const merged = { ...prev }
          for (const [key, dayData] of Object.entries(sbCalData)) {
            if (!pendingDaySyncTimersRef.current.has(key)) {
              merged[key] = dayData
            }
          }
          try { localStorage.setItem('xp9d', JSON.stringify(merged)) } catch {}
          return merged
        })
      }

      // Work sessions: merge if Supabase has rows; Supabase wins per session id
      if (sbSessions.length > 0) {
        setSessions(prev => {
          const byId = new Map(prev.map(s => [s.id, s]))
          for (const s of sbSessions) byId.set(s.id, s)
          const merged = Array.from(byId.values()).sort((a, b) => a.startTs - b.startTs)
          try { localStorage.setItem('xp9s', JSON.stringify(merged)) } catch {}
          return merged
        })

        // Reconstruct activeSession for cross-device restore.
        // The canonical indicator is a work_sessions row with endTs === null.
        const openSession = sbSessions.find(s => s.endTs === null)
        const localActive = activeSessionRef.current
        if (openSession) {
          if (localActive?.id !== openSession.id) {
            setActiveSessionRaw(openSession)
            try { localStorage.setItem('xp9-active-session', JSON.stringify(openSession)) } catch {}
          }
        } else if (localActive) {
          // Supabase has sessions but none open → stale local active session
          setActiveSessionRaw(null)
          try { localStorage.removeItem('xp9-active-session') } catch {}
        }
      }

      // Activities: replace if Supabase has rows; enforce builtin extras
      if (sbActivities.length > 0) {
        const withBuiltins = [...sbActivities]
        BUILTIN_EXTRAS.forEach(b => {
          const idx = withBuiltins.findIndex(a => a.id === b.id)
          if (idx === -1) withBuiltins.push(b)
          else withBuiltins[idx] = { ...withBuiltins[idx], countsTowardProductivity: b.countsTowardProductivity }
        })
        setActivitiesState(withBuiltins)
        try { localStorage.setItem('xp9a', JSON.stringify(withBuiltins)) } catch {}
      }

      // Preferences: apply if Supabase row exists (Supabase is the cross-device truth)
      if (sbPrefs) {
        setIsDarkRaw(sbPrefs.isDark)
        try { localStorage.setItem('xp-theme', String(sbPrefs.isDark)) } catch {}
        if (sbPrefs.progressColor) {
          setProgressColorRaw(sbPrefs.progressColor)
          try { localStorage.setItem('xp-progress-color', sbPrefs.progressColor) } catch {}
        }
        setCustomColorsRaw(sbPrefs.customColors)
        try { localStorage.setItem('xp-custom-colors', JSON.stringify(sbPrefs.customColors)) } catch {}
      }

      // Journal labels/folders: replace if Supabase has rows (cross-device truth)
      if (sbJournalLabels.length > 0) {
        setJournalLabelsState(sbJournalLabels)
        try { localStorage.setItem('xp9jl', JSON.stringify(sbJournalLabels)) } catch {}
      }
      if (sbJournalFolders.length > 0) {
        setJournalFoldersState(sbJournalFolders)
        try { localStorage.setItem('xp9jf', JSON.stringify(sbJournalFolders)) } catch {}
      }

      // Reminders: merge local + Supabase; Supabase wins per id; keep local-only entries
      if (sbReminders.length > 0) {
        setReminders(prev => {
          const byId = new Map(prev.map(r => [r.id, r]))
          for (const r of sbReminders) {
            // Preserve localFiredAt from local copy (never stored in Supabase)
            byId.set(r.id, { ...r, localFiredAt: byId.get(r.id)?.localFiredAt ?? null })
          }
          const merged = Array.from(byId.values())
          try { localStorage.setItem('xp9r', JSON.stringify(merged)) } catch {}
          return merged
        })
      }

      // Active task timer: reconstruct from Supabase for cross-device restore.
      // The canonical running-timer indicator in Supabase is a task session with endTs === null
      // inside calendar_days.day_data.tasks. localStorage is the same-device fast path;
      // Supabase is the durable cross-device source of truth.
      if (Object.keys(sbCalData).length > 0) {
        // Scan Supabase calendar data for a task with an open session
        let sbTimer: ActiveTaskTimer | null = null
        for (const [dayKey, dayData] of Object.entries(sbCalData)) {
          if (sbTimer) break
          const tasks = dayData.tasks ?? []
          for (let i = 0; i < tasks.length; i++) {
            const runningSess = (tasks[i].sessions ?? []).find(s => s.endTs === null)
            if (runningSess) {
              sbTimer = {
                taskId:    tasks[i].id,
                dateKey:   dayKey,
                sessionId: runningSess.id,
                startTs:   runningSess.startTs,
                taskText:  tasks[i].text || `Task ${i + 1}`,
                taskIndex: i,
              }
              break
            }
          }
        }
        // localTimer is what this device already knows (set from localStorage during mount)
        const localTimer = activeTaskTimerRef.current
        if (sbTimer) {
          const sameTimer =
            localTimer?.taskId    === sbTimer.taskId &&
            localTimer?.sessionId === sbTimer.sessionId
          if (!sameTimer) {
            // Cross-device restore: Supabase has a running timer this device doesn't know about
            setActiveTaskTimerRaw(sbTimer)
            try { localStorage.setItem('xp9-active-task-timer', JSON.stringify(sbTimer)) } catch {}
          }
          // Same-device: localStorage already restored correctly; nothing to do
        } else if (localTimer) {
          // Supabase has calendar data but no running task session → local timer is stale
          setActiveTaskTimerRaw(null)
          try { localStorage.removeItem('xp9-active-task-timer') } catch {}
        }
      }

    }).catch(err => {
      console.error('[XPadite] Supabase initial fetch error:', err)
    })
  }, [userId])

  // ─── Active-session reconciliation (focus/visibility + reconnect fallback) ───
  // Realtime is the primary sync mechanism, but it can miss events across a
  // temporary network drop, browser tab throttling, or mobile backgrounding.
  // This re-derives BOTH activeSession and activeTaskTimer, and corrects local
  // state in either direction — clearing a stale "running" timer this device
  // didn't hear stop, or reconstructing one it missed the start of.
  //
  // EGRESS FIX: this used to call fetchWorkSessions/fetchCalendarDays — the
  // SAME full-table queries the one-time initial-load hydration uses — on
  // every focus/visibility/online event. Those events fire constantly (every
  // tab switch, phone unlock, app switch), so every one of them was
  // re-downloading the user's ENTIRE calendar_days history (including any
  // embedded attachment/journal image data) and entire work_sessions history.
  // Reconciliation only ever needs "is a session/timer currently open," so it
  // now uses two narrow, targeted queries instead:
  //   - fetchOpenWorkSessions: only rows with end_ts IS NULL, only the columns
  //     needed to reconstruct one (never completed historical sessions).
  //   - fetchCalendarDay: a single row, by exact date_key, never the whole
  //     table. A live task timer can only be running against "today" (it's an
  //     open-ended session that started now) or, if this device already has
  //     one running, the exact date it already knows about — both are known
  //     values, so no scan of every day is ever needed to find it.
  // No Supabase writes happen here, only reads, so it's still safe to run as
  // often as focus/visibility events actually fire (never on a timer).
  const reconcileActiveSession = useCallback(async () => {
    const uid = userIdRef.current
    if (!uid) return
    const supabase = createClient()
    try {
      const localTimer = activeTaskTimerRef.current
      const datesToCheck = Array.from(new Set([todayKey(), ...(localTimer ? [localTimer.dateKey] : [])]))

      const [openSessions, dayRows] = await Promise.all([
        fetchOpenWorkSessions(supabase, uid),
        Promise.all(datesToCheck.map(async dateKey => ({ dateKey, dayData: await fetchCalendarDay(supabase, uid, dateKey) }))),
      ])

      // activeSession ← authoritative open work_sessions row (end_ts IS NULL)
      const openSession = openSessions[0] ?? null
      const localActive = activeSessionRef.current
      if (openSession) {
        if (localActive?.id !== openSession.id) {
          setActiveSessionRaw(openSession)
          try { localStorage.setItem('xp9-active-session', JSON.stringify(openSession)) } catch {}
        }
      } else if (localActive) {
        setActiveSessionRaw(null)
        try { localStorage.removeItem('xp9-active-session') } catch {}
      }

      // activeTaskTimer ← authoritative running task session (endTs === null),
      // scanning only the 1-2 targeted day rows fetched above.
      let sbTimer: ActiveTaskTimer | null = null
      for (const { dateKey, dayData } of dayRows) {
        if (sbTimer || !dayData) continue
        const tasks = dayData.tasks ?? []
        for (let i = 0; i < tasks.length; i++) {
          const runningSess = (tasks[i].sessions ?? []).find(s => s.endTs === null)
          if (runningSess) {
            sbTimer = {
              taskId: tasks[i].id, dateKey, sessionId: runningSess.id,
              startTs: runningSess.startTs, taskText: tasks[i].text, taskIndex: i,
            }
            break
          }
        }
      }
      const sameTimer = !!sbTimer && localTimer?.taskId === sbTimer.taskId && localTimer?.sessionId === sbTimer.sessionId
      if (sbTimer && !sameTimer) {
        setActiveTaskTimerRaw(sbTimer)
        try { localStorage.setItem('xp9-active-task-timer', JSON.stringify(sbTimer)) } catch {}
      } else if (!sbTimer && localTimer && datesToCheck.includes(localTimer.dateKey)) {
        // Only clear the local timer if we actually checked its date and found
        // it gone — never clear it based on dates we didn't look at.
        setActiveTaskTimerRaw(null)
        try { localStorage.removeItem('xp9-active-task-timer') } catch {}
      }
    } catch (err) {
      console.error('[XPadite] Active session reconciliation error:', err)
    }
  }, [])

  useEffect(() => {
    if (!userId) return
    function onFocusOrVisible() {
      if (document.visibilityState === 'hidden') return
      reconcileActiveSession()
    }
    document.addEventListener('visibilitychange', onFocusOrVisible)
    window.addEventListener('focus', onFocusOrVisible)
    window.addEventListener('online', onFocusOrVisible)
    return () => {
      document.removeEventListener('visibilitychange', onFocusOrVisible)
      window.removeEventListener('focus', onFocusOrVisible)
      window.removeEventListener('online', onFocusOrVisible)
    }
  }, [userId, reconcileActiveSession])

  // ─── Supabase Realtime: cross-device active timer sync ───────────────────────
  // Subscribes to postgres_changes on calendar_days and work_sessions for the
  // authenticated user. On remote changes, reconciles activeTaskTimer and
  // activeSession without triggering any Supabase writes (no feedback loop).
  //
  // REQUIRES: both tables must be in the supabase_realtime publication.
  // Apply migration 006_realtime_publications.sql in Supabase Dashboard → SQL Editor.
  useEffect(() => {
    if (!userId) return
    const supabase = createClient()

    const channel = supabase
      .channel(`xp-realtime-${userId}`)

      // ── calendar_days changes ────────────────────────────────────────────────
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'calendar_days', filter: `user_id=eq.${userId}` },
        (payload) => {
          if (payload.eventType === 'DELETE') return
          const row = payload.new as { date_key?: string; day_data?: DayData }
          if (!row.date_key || !row.day_data) return

          const dateKey = row.date_key
          const dayData  = row.day_data

          // Accept remote calData only when we have no pending local write for this date.
          // This prevents echoes of our own debounce writes from clobbering optimistic state.
          if (!pendingDaySyncTimersRef.current.has(dateKey)) {
            setCalData(prev => {
              const next = { ...prev, [dateKey]: dayData }
              try { localStorage.setItem('xp9d', JSON.stringify(next)) } catch {}
              return next
            })
          }

          // Reconcile active task timer (always — timer state must be cross-device accurate)
          const tasks = dayData.tasks ?? []
          let remoteTimer: ActiveTaskTimer | null = null
          let remoteTimerTaskIdx = -1
          for (let i = 0; i < tasks.length; i++) {
            const runningSess = (tasks[i].sessions ?? []).find(s => s.endTs === null)
            if (runningSess) {
              // Preserve the raw task text (empty string = Clock-In task, non-empty = Task Manager task).
              // Do NOT apply a fallback here — the empty-string value is the cross-device signal.
              remoteTimer = {
                taskId:    tasks[i].id,
                dateKey:   dateKey,
                sessionId: runningSess.id,
                startTs:   runningSess.startTs,
                taskText:  tasks[i].text,
                taskIndex: i,
              }
              remoteTimerTaskIdx = i
              break
            }
          }

          const cur = activeTaskTimerRef.current
          if (remoteTimer) {
            const alreadySame =
              cur?.taskId    === remoteTimer.taskId &&
              cur?.sessionId === remoteTimer.sessionId
            if (!alreadySame) {
              setActiveTaskTimerRaw(remoteTimer)
              try { localStorage.setItem('xp9-active-task-timer', JSON.stringify(remoteTimer)) } catch {}
            }

            // If this is a Clock-In task (empty text + linkedSessionId) and activeSession is
            // not yet set (e.g. work_sessions Realtime hasn't fired yet), reconstruct it now.
            // This makes the Clock-Out button immediately responsive on the receiving device.
            if (!activeSessionRef.current && remoteTimerTaskIdx >= 0) {
              const clockInTask = tasks[remoteTimerTaskIdx]
              if (clockInTask.text === '' && clockInTask.linkedSessionId) {
                const act = activitiesRef.current.find(a => a.id === clockInTask.actId)
                if (act) {
                  const reconstructed = {
                    id:      clockInTask.linkedSessionId,
                    actId:   act.id,
                    actName: (act.emoji ? act.emoji + ' ' : '') + act.name,
                    actColor: act.color,
                    startTs: remoteTimer.startTs,
                    dateKey: remoteTimer.dateKey,
                  }
                  setActiveSessionRaw(reconstructed)
                  try { localStorage.setItem('xp9-active-session', JSON.stringify(reconstructed)) } catch {}
                }
              }
            }
          } else if (cur?.dateKey === dateKey) {
            // This day was updated and now has no running session → remote stop
            setActiveTaskTimerRaw(null)
            try { localStorage.removeItem('xp9-active-task-timer') } catch {}
          }
        },
      )

      // ── work_sessions changes ────────────────────────────────────────────────
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'work_sessions', filter: `user_id=eq.${userId}` },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            const old = payload.old as { session_id?: string }
            if (old.session_id && activeSessionRef.current?.id === old.session_id) {
              setActiveSessionRaw(null)
              try { localStorage.removeItem('xp9-active-session') } catch {}
            }
            return
          }
          const row = payload.new as {
            session_id?: string; act_id?: string; act_name?: string; act_color?: string
            start_ts?: number; end_ts?: number | null; date_key?: string
          }
          if (!row.session_id || !row.act_id || !row.act_name || !row.act_color ||
              row.start_ts == null || !row.date_key) return

          const incoming: WorkSession = {
            id:       row.session_id,
            actId:    row.act_id,
            actName:  row.act_name,
            actColor: row.act_color,
            startTs:  row.start_ts,
            endTs:    row.end_ts ?? null,
            dateKey:  row.date_key,
          }

          // Merge into sessions list
          setSessions(prev => {
            const byId = new Map(prev.map(s => [s.id, s]))
            byId.set(incoming.id, incoming)
            const next = Array.from(byId.values()).sort((a, b) => a.startTs - b.startTs)
            try { localStorage.setItem('xp9s', JSON.stringify(next)) } catch {}
            return next
          })

          // Reconcile active clock-in session
          const curActive = activeSessionRef.current
          if (incoming.endTs === null) {
            if (curActive?.id !== incoming.id) {
              setActiveSessionRaw(incoming)
              try { localStorage.setItem('xp9-active-session', JSON.stringify(incoming)) } catch {}
            }
          } else {
            if (curActive?.id === incoming.id) {
              setActiveSessionRaw(null)
              try { localStorage.removeItem('xp9-active-session') } catch {}
            }
          }
        },
      )

      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [userId])

  // Flush all pending debounced day-sync writes when the page is about to be discarded.
  // Prevents data loss when the user closes the tab or navigates away within 1 second of editing.
  useEffect(() => {
    function flush() {
      pendingDaySyncTimersRef.current.forEach((timer, key) => {
        clearTimeout(timer)
        const dayData = pendingDaySyncDataRef.current.get(key)
        pendingDaySyncDataRef.current.delete(key)
        const uid = userIdRef.current
        if (dayData && uid) {
          upsertDayData(createClient(), uid, key, dayData).catch(() => {})
        }
      })
      pendingDaySyncTimersRef.current.clear()
    }
    function onVisChange() { if (document.visibilityState === 'hidden') flush() }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVisChange)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVisChange)
    }
  }, [])

  // Sync activeTaskTimer.taskText when the user renames the task while clocked in
  useEffect(() => {
    const att = activeTaskTimerRef.current
    if (!att) return
    const dayData = calData[att.dateKey]
    if (!dayData) return
    const task = dayData.tasks.find(t => t.id === att.taskId)
    if (!task || task.text === att.taskText) return
    setActiveTaskTimerRaw({ ...att, taskText: task.text })
  }, [calData]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Core data mutations ─────────────────────────────────────────────────────

  const updateDay = useCallback((key: string, updater: (prev: DayData) => DayData) => {
    setCalData(prev => {
      const raw = prev[key] ?? { ...EMPTY_DAY }
      // Normalize legacy DayData that may lack a tasks array
      const current: DayData = Array.isArray(raw.tasks) ? raw : { ...raw, tasks: [] }
      const updated = updater(current)
      const next = { ...prev, [key]: updated }
      try { localStorage.setItem('xp9d', JSON.stringify(next)) } catch {}
      // Store latest value for the debounced Supabase write
      pendingDaySyncDataRef.current.set(key, updated)
      return next
    })
    // Schedule debounced Supabase upsert (outside setState to avoid strict-mode double-invoke issues)
    const uid = userIdRef.current
    if (uid) {
      const existing = pendingDaySyncTimersRef.current.get(key)
      if (existing != null) clearTimeout(existing)
      const timer = setTimeout(() => {
        pendingDaySyncTimersRef.current.delete(key)
        const dayData = pendingDaySyncDataRef.current.get(key)
        pendingDaySyncDataRef.current.delete(key)
        if (dayData) {
          upsertDayData(createClient(), uid, key, dayData).catch(err =>
            console.error('[CalData] Supabase sync error for', key, err)
          )
        }
      }, 1000)
      pendingDaySyncTimersRef.current.set(key, timer)
    }
  }, [])

  const addSession = useCallback((s: WorkSession) => {
    setSessions(prev => {
      const next = [...prev, s]
      try { localStorage.setItem('xp9s', JSON.stringify(next)) } catch {}
      return next
    })
    const uid = userIdRef.current
    if (uid) {
      upsertWorkSession(createClient(), uid, s).catch(err =>
        console.error('[Sessions] Supabase sync error:', err)
      )
    }
  }, [])

  const addActivity = useCallback((a: Activity) => {
    const next = [...activitiesRef.current, a]
    try { localStorage.setItem('xp9a', JSON.stringify(next)) } catch {}
    setActivitiesState(next)
    const uid = userIdRef.current
    if (uid) {
      upsertAllActivities(createClient(), uid, next).catch(err =>
        console.error('[Activities] Supabase sync error:', err)
      )
    }
  }, [])

  const updateActivity = useCallback((id: string, patch: Partial<Activity>) => {
    const next = activitiesRef.current.map(a => a.id === id ? { ...a, ...patch } : a)
    try { localStorage.setItem('xp9a', JSON.stringify(next)) } catch {}
    setActivitiesState(next)
    const uid = userIdRef.current
    if (uid) {
      upsertAllActivities(createClient(), uid, next).catch(err =>
        console.error('[Activities] Supabase sync error:', err)
      )
    }
  }, [])

  const setProgressColor = useCallback((c: string) => {
    setProgressColorRaw(c)
    try { localStorage.setItem('xp-progress-color', c) } catch {}
    const uid = userIdRef.current
    if (uid) {
      upsertUserPreferences(createClient(), uid, { progressColor: c }).catch(err =>
        console.error('[Prefs] Progress color sync error:', err)
      )
    }
  }, [])

  const setIsDark = useCallback((v: boolean) => {
    setIsDarkRaw(v)
    try { localStorage.setItem('xp-theme', String(v)) } catch {}
    const uid = userIdRef.current
    if (uid) {
      upsertUserPreferences(createClient(), uid, { isDark: v }).catch(err =>
        console.error('[Prefs] Theme sync error:', err)
      )
    }
  }, [])

  const customColorsRef = useRef(customColors)
  customColorsRef.current = customColors

  // Returns false only when the palette is full and this color isn't already
  // saved — the caller (Activity Manager) uses that to show the limit message.
  // Applying the color to the Activity itself always succeeds regardless.
  const addCustomColor = useCallback((hex: string): boolean => {
    const normalized = normalizeHexColor(hex)
    const current = customColorsRef.current
    if (current.some(c => normalizeHexColor(c) === normalized)) return true
    if (current.length >= 16) return false
    const next = [...current, normalized]
    setCustomColorsRaw(next)
    try { localStorage.setItem('xp-custom-colors', JSON.stringify(next)) } catch {}
    const uid = userIdRef.current
    if (uid) {
      upsertUserPreferences(createClient(), uid, { customColors: next }).catch(err =>
        console.error('[Prefs] Custom color sync error:', err)
      )
    }
    return true
  }, [])

  // Only removes the reusable shortcut — never touches Activities that already use this color.
  const removeCustomColor = useCallback((hex: string) => {
    const normalized = normalizeHexColor(hex)
    const next = customColorsRef.current.filter(c => normalizeHexColor(c) !== normalized)
    setCustomColorsRaw(next)
    try { localStorage.setItem('xp-custom-colors', JSON.stringify(next)) } catch {}
    const uid = userIdRef.current
    if (uid) {
      upsertUserPreferences(createClient(), uid, { customColors: next }).catch(err =>
        console.error('[Prefs] Custom color remove sync error:', err)
      )
    }
  }, [])

  // Wrapped setters that persist to localStorage so the active clock-in session
  // survives a page refresh. On clock-in (non-null), also creates an in-progress
  // work_session row in Supabase (end_ts=null); clock-out's addSession will update it.
  const setActiveSession = useCallback((s: ActiveSession | null) => {
    setActiveSessionRaw(s)
    if (s) {
      try { localStorage.setItem('xp9-active-session', JSON.stringify(s)) } catch {}
      const uid = userIdRef.current
      if (uid) {
        upsertWorkSession(createClient(), uid, { ...s, endTs: null }).catch(err =>
          console.error('[ActiveSession] Supabase upsert error:', err)
        )
      }
    } else {
      try { localStorage.removeItem('xp9-active-session') } catch {}
    }
  }, [])

  // Task Manager timers and Calendar Clock In/Out are two UI surfaces over the
  // SAME authoritative running session: starting a Task Manager timer with no
  // Clock-In already active creates a work_sessions row via setActiveSession
  // (see below). Every local path that stops a task timer — the Stop button,
  // deleting a running task, manually adjusting a running session's time, the
  // Planner→Task-Manager timer link — must finalize that SAME row, or it's
  // left open in Supabase forever and every other device keeps showing it as
  // running. Centralizing the close here (rather than patching each call site)
  // is what makes that guarantee hold everywhere at once.
  //
  // This must NOT fire for remote reconciliation: realtime handlers intentionally
  // call setActiveTaskTimerRaw (not this wrapped setter) specifically to avoid
  // triggering a Supabase write when just reflecting a change that already
  // happened elsewhere — see the "no feedback loop" comment on the realtime effect.
  const setActiveTaskTimer = useCallback((t: ActiveTaskTimer | null) => {
    setActiveTaskTimerRaw(t)
    if (t) {
      try { localStorage.setItem('xp9-active-task-timer', JSON.stringify(t)) } catch {}
      return
    }
    try { localStorage.removeItem('xp9-active-task-timer') } catch {}
    const linkedSession = activeSessionRef.current
    if (linkedSession) {
      const endTs = Date.now()
      const finalized: WorkSession = { ...linkedSession, endTs }
      setSessions(prev => {
        const next = [...prev, finalized]
        try { localStorage.setItem('xp9s', JSON.stringify(next)) } catch {}
        return next
      })
      const uid = userIdRef.current
      if (uid) {
        upsertWorkSession(createClient(), uid, finalized).catch(err =>
          console.error('[ActiveSession] Supabase upsert error:', err)
        )
      }
      setActiveSessionRaw(null)
      try { localStorage.removeItem('xp9-active-session') } catch {}
    }
  }, [])

  const removeActivity = useCallback((id: string) => {
    const next = activitiesRef.current.filter(a => a.id !== id)
    try { localStorage.setItem('xp9a', JSON.stringify(next)) } catch {}
    setActivitiesState(next)
    setSelectedActId(prev => prev === id ? (next[0]?.id ?? DEFAULT_ACTIVITIES[0].id) : prev)
    const uid = userIdRef.current
    if (uid) {
      deleteUserActivity(createClient(), uid, id).catch(err =>
        console.error('[Activities] Supabase delete error:', err)
      )
    }
  }, [])

  // ─── Journal Library organization: Custom Labels + Folders ──────────────────
  // Same shape as Activities: optimistic local update + localStorage cache +
  // fire-and-forget Supabase upsert-all. Document→label/folder relationships
  // are NOT handled here — those live inside each day's own JSON (via
  // updateDay), same as the existing `title` field.

  const addJournalLabel = useCallback((l: JournalLabel) => {
    const next = [...journalLabelsRef.current, l]
    try { localStorage.setItem('xp9jl', JSON.stringify(next)) } catch {}
    setJournalLabelsState(next)
    const uid = userIdRef.current
    if (uid) {
      upsertAllJournalLabels(createClient(), uid, next).catch(err =>
        console.error('[JournalLabels] Supabase sync error:', err)
      )
    }
  }, [])

  const removeJournalLabel = useCallback((id: string) => {
    const next = journalLabelsRef.current.filter(l => l.id !== id)
    try { localStorage.setItem('xp9jl', JSON.stringify(next)) } catch {}
    setJournalLabelsState(next)
    const uid = userIdRef.current
    if (uid) {
      deleteJournalLabel(createClient(), uid, id).catch(err =>
        console.error('[JournalLabels] Supabase delete error:', err)
      )
    }
  }, [])

  const addJournalFolder = useCallback((f: JournalFolder) => {
    const next = [...journalFoldersRef.current, f]
    try { localStorage.setItem('xp9jf', JSON.stringify(next)) } catch {}
    setJournalFoldersState(next)
    const uid = userIdRef.current
    if (uid) {
      upsertAllJournalFolders(createClient(), uid, next).catch(err =>
        console.error('[JournalFolders] Supabase sync error:', err)
      )
    }
  }, [])

  const removeJournalFolder = useCallback((id: string) => {
    const next = journalFoldersRef.current.filter(f => f.id !== id)
    try { localStorage.setItem('xp9jf', JSON.stringify(next)) } catch {}
    setJournalFoldersState(next)
    const uid = userIdRef.current
    if (uid) {
      deleteJournalFolder(createClient(), uid, id).catch(err =>
        console.error('[JournalFolders] Supabase delete error:', err)
      )
    }
  }, [])

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

  // Mute/unmute future delivery for one reminder without touching isActive,
  // its schedule, or its history. Used by the Notifications "Turn off/on
  // reminder" action — never called from the fire/checker path.
  const setReminderNotificationsEnabled = useCallback(async (id: string, enabled: boolean): Promise<void> => {
    const next = remindersRef.current.map(r => r.id === id ? { ...r, notificationsEnabled: enabled } : r)
    persistReminders(next)
    setReminders(next)

    const uid = userIdRef.current
    if (uid) {
      supabasePatchReminder(id, { notificationsEnabled: enabled }).catch(err => {
        console.error('[Reminders] setReminderNotificationsEnabled patch error:', err)
      })
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
      calendarClean, setCalendarClean,
      activeSession, setActiveSession,
      activeTaskTimer, setActiveTaskTimer,
      removingMode, setRemovingMode,
      sidebarOpen, setSidebarOpen,
      toast, setToast,
      progressColor, setProgressColor,
      customColors, addCustomColor, removeCustomColor,
      legendVisible, setLegendVisible,
      journalLabels, addJournalLabel, removeJournalLabel,
      journalFolders, addJournalFolder, removeJournalFolder,
      reminders, userEmail,
      upsertReminderCtx, removeReminderCtx, fireReminderCtx, setReminderNotificationsEnabled,
    }}>
      {children}
    </AppContext.Provider>
  )
}

'use client'

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { CalendarData, WorkSession, Activity, ActiveSession, DayData, ActiveTaskTimer, Reminder, JournalLabel, JournalFolder } from './types'
import { normalizeHexColor, todayKey, detectBrowserTimezone } from './utils'
import { resolveLocale, type Locale } from './i18n'
import {
  upsertReminder as supabaseUpsertReminder,
  deleteReminder as supabaseDeleteReminder,
  patchReminder as supabasePatchReminder,
  fetchReminders as supabaseFetchReminders,
  computeNextRunAt,
} from '@/lib/reminders'
import { createClient } from '@/lib/supabase/client'
import { trackFeature } from '@/lib/analytics/client'
import {
  fetchCalendarDaysWithRev,
  saveDayCas,
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
  upsertAllJournalFolders,
  deleteJournalFolder,
} from '@/lib/supabase/core-data'

import { DaySyncQueue, DaySyncParked } from './daySync'
import { useJournalDocs, type JournalDocsApi } from './useJournalDocs'
import { fetchJournalFoldersStrict } from '@/lib/supabase/journal-docs'
import { mergeDay } from './dayMerge'
import type { MergeConflict } from './dayMerge'
import { DayConflictDialog } from './DayConflictDialog'
import { StartupLoader } from './StartupLoader'
import { freshStages, stageProgress, allStagesSettled, decideStatus, isDataReady, looksLikeNetworkError, parseVerified, VERIFIED_KEY, REQUIRED_STAGES, type StageId, type StageState, type StageMap, type StartupStatus } from './startupReadiness'
import { fetchScheduleEvents, applyScheduleChange, setScheduleTaskLink, fetchScheduleExtras, saveScheduleExtras, fetchScheduleSyncPref, setScheduleSyncPref, ScheduleConflictError, ScheduleSetupError } from '@/lib/supabase/schedule-data'
import type { StoredScheduleEvent } from '@/lib/supabase/schedule-data'
import { planDeadlineSync, deadlineDayMap, reconcileDeadlines, batchItems, opKeys, applyOpsLocal, isBackfillEligible } from './deadlineLink'
import type { TaskOp } from './deadlineLink'
import type { TimeFormat } from './scheduleLogic'
import type { ScheduleCategory, ScheduleEvent } from './scheduleLogic'

// { uid, keys }: days whose latest edit the server has not confirmed. Survives a refresh so the edit is
// re-sent instead of being replaced by the older server copy. Ignored unless it belongs to this account.
const UNSYNCED_KEY = 'xp9d-unsynced'
const BASE_KEY = 'xp9d-base'
const CONFLICT_BACKUP_KEY = 'xp9d-conflict-backup'

const DEFAULT_ACTIVITIES: Activity[] = [
  { id: 'a1',      name: 'Work',                 color: '#7c3aed' },
  { id: 'a2',      name: 'Workout',              color: '#16a34a' },
  { id: 'a3',      name: 'Learning',             color: '#0891b2' },
  { id: 'a4',      name: 'Coding',               color: '#6366f1' },
  { id: 'a5',      name: 'Personal',             color: '#d97706' },
  { id: 'a-meet',  name: 'Meeting',              color: '#e3ed3a' },
  { id: 'a-meal',  name: '🍽 Meal',              color: '#f59e0b', countsTowardProductivity: false },
  { id: 'a-break', name: '☕ Break',             color: '#64748b', countsTowardProductivity: false },
  { id: 'a-plan',  name: 'Planning/Journaling',  color: '#22c55e', countsTowardProductivity: true },
]

// These are always present — injected/updated on every localStorage load so they can never be removed.
// On update: only countsTowardProductivity is forced so user color/name customisations are preserved.
// Meeting lives here (not only in DEFAULT_ACTIVITIES) so existing accounts that already
// have a saved activity list still receive it, and so synced meeting tasks always have it.
const BUILTIN_EXTRAS: Activity[] = [
  { id: 'a-meet',  name: 'Meeting',              color: '#e3ed3a' },
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
  // opts.after: day keys whose write must be confirmed first (a move writes the destination before the origin).
  updateDay: (key: string, updater: (prev: DayData) => DayData, opts?: { after?: string[] }) => void
  // Writes the given days (or every unsynced day) to Supabase now; true only when the server confirmed it.
  flushDays: (keys?: string[]) => Promise<boolean>
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
  // null = "Automatic" (device-detected). A non-null value is a manual
  // override and stays authoritative until changed or reset back to null.
  language: string | null
  setLanguage: (v: string | null) => void
  effectiveLocale: Locale
  timezone: string | null
  setTimezone: (v: string | null) => void
  effectiveTimezone: string
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
  /** Removes the folder at once; resolves true when the cloud delete went through (or there is no account), false when it failed. */
  removeJournalFolder: (id: string) => Promise<boolean>
  /** Rename / recolour an existing folder (same id). */
  updateJournalFolder: (f: JournalFolder) => void
  /** v1.330: extra Planner documents (several per day) and Notes — see useJournalDocs.ts */
  journalDocs: JournalDocsApi
  // Reminders
  reminders: Reminder[]
  userEmail: string
  upsertReminderCtx: (r: Omit<Reminder, 'id'> & { id?: string }) => Promise<Reminder | null>
  removeReminderCtx: (id: string) => Promise<void>
  fireReminderCtx: (id: string) => Promise<void>
  setReminderNotificationsEnabled: (id: string, enabled: boolean) => Promise<void>
  // My Schedule (v1.328): the persisted events — the single source of truth the Calendar and Task Manager read deadlines from.
  scheduleEvents: StoredScheduleEvent[]
  // 'loading' until the first fetch finishes; 'unavailable' when the table can't be read (e.g. migration 022 not applied yet).
  scheduleStatus: 'loading' | 'ready' | 'unavailable'
  // Deadline events by the local day they fall due ("YYYY-MM-DD"), derived from scheduleEvents — what the Calendar markers read.
  deadlineDays: Record<string, StoredScheduleEvent[]>
  // Resolves only once the server confirmed the write; rejects (leaving everything unchanged) otherwise.
  saveScheduleEvent: (ev: ScheduleEvent) => Promise<void>
  deleteScheduleEvent: (id: string) => Promise<void>
  // The user removed a deadline's Task Manager task: remember it (reconciliation must not recreate it), keep the deadline everywhere else.
  detachDeadlineTask: (eventId: string) => Promise<void>
  // ...and the explicit way back: re-link and recreate the task.
  restoreDeadlineTask: (eventId: string) => Promise<void>
  // Set when linked-task repairs keep failing (after a few tries); null when everything agrees. retry resets the attempts.
  scheduleSyncIssue: string | null
  retryScheduleSync: () => Promise<void>
  // One time-format choice for deadline displays. SESSION-ONLY (the schedule preferences are not persisted anywhere yet).
  scheduleTimeFormat: TimeFormat
  setScheduleTimeFormat: (f: TimeFormat) => void
  // "Edit in My Schedule" from the Task Manager: asks the app to open My Schedule focused on this event.
  scheduleFocusRequest: { eventId: string; nonce: number } | null
  requestScheduleEvent: (eventId: string) => void
  clearScheduleFocusRequest: () => void
  // "Mind Mapping" in the main menu: asks the Planner/Journal editor for that date to open its EXISTING Mind Mapping Canvas.
  // "Sync with Task Manager" (per user, saved in Supabase, default OFF): ordinary events get a linked task on their START date while ON.
  scheduleTaskSync: boolean
  // Saves the switch. Existing events get a Task Manager task ONLY when the user explicitly asks (opts.backfill, upcoming events only); otherwise they
  // are left alone and only events saved from now on are linked. Rejects (changing nothing) if the preference can not be saved.
  setScheduleTaskSyncPref: (next: boolean, opts?: { backfill?: boolean }) => Promise<void>
  // A day edited on two devices in conflicting ways: the user is asked (see DayConflictDialog); resolved here.
  dayConflicts: { key: string; mine: DayData; theirs: DayData | null; theirsRev: number; conflicts: MergeConflict[] }[]
  resolveDayConflict: (key: string, choice: 'mine' | 'theirs') => void
  /** Startup readiness: true once the account's data has really been read (or this device holds a verified copy and is offline). Edits and server writes wait for it. */
  dataReady: boolean
  startup: { status: StartupStatus; progress: number; offline: boolean }
  /** Tells a window when the set of days still waiting to be saved changed (e.g. a retried save was confirmed). Returns the unsubscribe. */
  subscribeDaySync: (listener: () => void) => () => void
  /** True while the latest edit of this day is not yet confirmed by the server (pending, in flight or failed). */
  isDayUnsynced: (key: string) => boolean
  // closeOnExit: the canvas was opened straight from the main menu (the Planner was not already showing), so leaving it returns to the main app
  mindMapRequest: { dateKey: string; nonce: number; closeOnExit: boolean } | null
  requestMindMap: (dateKey: string, closeOnExit?: boolean) => void
  clearMindMapRequest: () => void
  savedLocations: string[]
  setSavedLocations: (next: string[]) => Promise<void>
  scheduleCategories: ScheduleCategory[]
  setScheduleCategories: (next: ScheduleCategory[]) => Promise<void>
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
  const [language, setLanguageRaw] = useState<string | null>(null)
  const [timezone, setTimezoneRaw] = useState<string | null>(null)
  const [customColors, setCustomColorsRaw] = useState<string[]>([])
  const [legendVisible, setLegendVisible] = useState(false)
  const [journalLabels, setJournalLabelsState] = useState<JournalLabel[]>([])
  const [journalFolders, setJournalFoldersState] = useState<JournalFolder[]>([])
  const [hydrated, setHydrated] = useState(false)
  const [scheduleEvents, setScheduleEventsState] = useState<StoredScheduleEvent[]>([])
  const [scheduleStatus, setScheduleStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  const deadlineDays = useMemo(() => deadlineDayMap(scheduleEvents) as Record<string, StoredScheduleEvent[]>, [scheduleEvents])
  const [savedLocations, setSavedLocationsState] = useState<string[]>([])
  const [calHydrated, setCalHydrated] = useState(false)
  // ── Startup readiness (see startupReadiness.ts): "not loaded" is never treated as "empty" ──
  const [startup, setStartup] = useState<{ status: StartupStatus; stages: StageMap; attempt: number }>(() => ({ status: 'loading', stages: freshStages(), attempt: 0 }))
  const [overlayDone, setOverlayDone] = useState(false)
  const [graceDone, setGraceDone] = useState(false)
  const stagesRef = useRef<StageMap>(startup.stages)
  const attemptRef = useRef(0)
  const dataReadyRef = useRef(false)
  const readyWaitersRef = useRef(new Set<() => void>())
  const heldEditsRef = useRef<{ key: string; updater: (prev: DayData) => DayData; opts?: { after?: string[] } }[]>([])
  const applyDayEditRef = useRef<(key: string, updater: (prev: DayData) => DayData, opts?: { after?: string[] }) => void>(() => {})
  const [scheduleTaskSync, setScheduleTaskSyncState] = useState(false)
  type DayConflict = { key: string; mine: DayData; theirs: DayData | null; theirsRev: number; conflicts: MergeConflict[] }
  const [dayConflicts, setDayConflicts] = useState<DayConflict[]>([])
  const [scheduleSyncIssue, setScheduleSyncIssue] = useState<string | null>(null)
  const [scheduleTimeFormat, setScheduleTimeFormat] = useState<TimeFormat>('12h')
  const [scheduleFocusRequest, setScheduleFocusRequest] = useState<{ eventId: string; nonce: number } | null>(null)
  const [mindMapRequest, setMindMapRequest] = useState<{ dateKey: string; nonce: number; closeOnExit: boolean } | null>(null)
  const [scheduleCategories, setScheduleCategoriesState] = useState<ScheduleCategory[]>([])

  const [reminders, setReminders] = useState<Reminder[]>([])
  const [userId, setUserId] = useState('')
  const userEmail = email

  // Stable refs so callbacks never close over stale values
  const remindersRef = useRef(reminders)
  remindersRef.current = reminders
  const userIdRef = useRef(userId)
  // v1.330: extra Planner documents + Notes (own table, own sync; the existing day pipeline is untouched)
  const journalDocs = useJournalDocs(userId, setToast)
  userIdRef.current = userId
  // My Schedule callbacks read the latest values through refs, synced after each commit (never written during render)
  const calDataRef = useRef(calData)
  const scheduleEventsRef = useRef(scheduleEvents)
  const scheduleStatusRef = useRef(scheduleStatus)
  const savedLocationsRef = useRef(savedLocations)
  const scheduleCategoriesRef = useRef(scheduleCategories)
  const scheduleTaskSyncRef = useRef(scheduleTaskSync)
  // Stale-write protection: for each day, the SERVER revision + document this device last synced (what local edits are made on top of),
  // the conflicts waiting for the user, and the writer (swapped in after each render; the default refuses so a stub can never "save").
  const serverBaseRef = useRef(new Map<string, { rev: number | null; doc: DayData }>())
  const dayConflictsRef = useRef<DayConflict[]>([])
  const casAvailableRef = useRef(true)
  const writeDayRef = useRef<(key: string, data: DayData, signal?: AbortSignal) => Promise<void>>(async () => { throw new Error('day-writer-not-ready') })
  useEffect(() => {
    calDataRef.current = calData
    scheduleEventsRef.current = scheduleEvents
    scheduleStatusRef.current = scheduleStatus
    savedLocationsRef.current = savedLocations
    scheduleCategoriesRef.current = scheduleCategories
    scheduleTaskSyncRef.current = scheduleTaskSync
    dayConflictsRef.current = dayConflicts
  })
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

  // null timezone = "Automatic" → fall back to the device-detected zone.
  const effectiveTimezone = timezone ?? detectBrowserTimezone()
  const effectiveTimezoneRef = useRef(effectiveTimezone)
  effectiveTimezoneRef.current = effectiveTimezone

  // Durable day-sync queue (see daySync.ts): a day stays "unsynced" from the first edit until the
  // server confirms it. Failed writes keep their data and retry; a move's origin write waits for the
  // destination; hydration / realtime never overwrite an unsynced day.
  const daySyncListenersRef = useRef(new Set<() => void>())
  const daySyncRef = useRef<DaySyncQueue<DayData> | null>(null)
  if (daySyncRef.current === null) {
    daySyncRef.current = new DaySyncQueue<DayData>({
      write: (key, data, signal) => writeDayRef.current(key, data, signal),
      onError: (key, err) => {
        console.error('[CalData] Supabase sync error for', key, err)
        setToast('⚠ Couldn’t save to the cloud — your changes are kept on this device and will retry automatically')
      },
      onRecovered: () => setToast('Changes synced ✓'),
      onUnsyncedChange: keys => {
        // listeners are told in a microtask: this runs inside state updaters / the queue, where a listener's own state update must not run
        queueMicrotask(() => daySyncListenersRef.current.forEach(fn => { try { fn() } catch {} }))
        try { localStorage.setItem(UNSYNCED_KEY, JSON.stringify({ uid: userIdRef.current, keys })) } catch {}
        // remember the version each unsynced day was based on, so a refresh mid-edit can still merge instead of guessing
        try {
          const bases: Record<string, { rev: number | null; doc: DayData }> = {}
          for (const k of keys) { const b = serverBaseRef.current.get(k); if (b) bases[k] = b }
          localStorage.setItem(BASE_KEY, JSON.stringify({ uid: userIdRef.current, bases }))
        } catch {}
      },
    })
  }
  const daySync = daySyncRef.current
  const subscribeDaySync = useCallback((fn: () => void) => { daySyncListenersRef.current.add(fn); return () => { daySyncListenersRef.current.delete(fn) } }, [])
  const isDayUnsynced = useCallback((key: string) => daySync.hasUnsynced(key), [daySync])

  // ── Startup readiness plumbing ─────────────────────────────────────────────────────────────────────────────────────────
  const markStage = useCallback((id: StageId, state: StageState) => {
    if (stagesRef.current[id] === state) return
    stagesRef.current = { ...stagesRef.current, [id]: state }
    setStartup(s => ({ ...s, stages: stagesRef.current }))
  }, [])
  /** Resolves when the account's data is ready (or the signal aborts). Used by the day writer so nothing is saved from an unloaded state. */
  const waitReady = useCallback((signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
    if (dataReadyRef.current) { resolve(); return }
    const go = () => { signal?.removeEventListener('abort', onAbort); resolve() }
    const onAbort = () => { readyWaitersRef.current.delete(go); reject(new Error('startup-wait-aborted')) }
    readyWaitersRef.current.add(go)
    signal?.addEventListener('abort', onAbort, { once: true })
  }), [])
  /** Decide the startup status from the stages (and the failure, if any). Success → ready; failure → offline (verified local copy) or failed (blocked until Retry). */
  const settleStartup = useCallback((err?: unknown) => {
    const verified = parseVerified((() => { try { return localStorage.getItem(VERIFIED_KEY) } catch { return null } })())
    const status = decideStatus({ stages: stagesRef.current, verifiedForUser: !!verified && verified.uid === userIdRef.current, networkDown: looksLikeNetworkError(err) })
    if (status === 'loading') return
    if (status === 'ready') { try { localStorage.setItem(VERIFIED_KEY, JSON.stringify({ uid: userIdRef.current, at: Date.now() })) } catch {} }
    if (isDataReady(status)) {
      dataReadyRef.current = true
      readyWaitersRef.current.forEach(fn => fn()); readyWaitersRef.current.clear()
      const held = heldEditsRef.current; heldEditsRef.current = []
      for (const h of held) applyDayEditRef.current(h.key, h.updater, h.opts)     // edits made before the data was ready run on top of the loaded data
    }
    setStartup(s => ({ ...s, status }))
  }, [])
  const retryStartup = useCallback(() => {
    attemptRef.current += 1
    const next = { ...stagesRef.current }; for (const s of [...REQUIRED_STAGES, 'folders'] as StageId[]) next[s] = 'pending'
    stagesRef.current = next
    setStartup(s => ({ ...s, status: 'loading', stages: next, attempt: attemptRef.current }))
  }, [])

  // ── Stale-write protection (migration 024) ─────────────────────────────────────────────────────────────────────────
  // A day is written only if the server still holds the revision this device based its edits on (calendar_day_save, compare-and-swap). If the day
  // has moved on, the server hands back its current copy and the two are merged THREE ways (dayMerge.ts): changes to different tasks/fields all
  // survive; the same field of the same task changed differently is NOT guessed — the day is parked and the user chooses (DayConflictDialog).
  const isMissingFn = (err: unknown) => { const c = (err as { code?: string } | null)?.code; return c === 'PGRST202' || c === '42883' || c === '404' }

  /** After a confirmed write: record the new base, and bring the screen up to what was written when a merge changed it. */
  function finishWrite(key: string, sent: DayData, written: DayData, rev: number) {
    if (written === sent) { serverBaseRef.current.set(key, { rev, doc: sent }); return }
    const queued = daySync.peek(key)
    if (queued === undefined || queued === sent) {
      serverBaseRef.current.set(key, { rev, doc: written })               // nothing newer typed meanwhile: show the merged day
      setCalData(prev => { const next = { ...prev, [key]: written }; try { localStorage.setItem('xp9d', JSON.stringify(next)) } catch {}; return next })
    } else {
      // the user kept editing while this saved: those edits were made on the PRE-merge screen. Make the next write merge them against the server copy.
      serverBaseRef.current.set(key, { rev: Math.max(0, rev - 1), doc: sent })
    }
  }

  async function writeDay(key: string, data: DayData, signal?: AbortSignal): Promise<void> {
    await waitReady(signal)       // never save before the account's data has been read: an unloaded screen is not an empty account
    const uid = userIdRef.current
    if (!uid) throw new Error('no-user')
    if (dayConflictsRef.current.some(c => c.key === key)) throw new DaySyncParked()     // waiting for the user: no network, no retry storm
    const sb = createClient()
    if (!casAvailableRef.current) { await upsertDayData(sb, uid, key, data, signal); return }  // database without migration 024: the previous behaviour
    let mine = data
    for (let attempt = 0; attempt < 4; attempt++) {
      const base = serverBaseRef.current.get(key)
      let res: Awaited<ReturnType<typeof saveDayCas>>
      try { res = await saveDayCas(sb, key, mine, base?.rev ?? null, signal) }
      catch (err) {
        if (isMissingFn(err)) { casAvailableRef.current = false; await upsertDayData(sb, uid, key, mine, signal); return }
        throw err
      }
      if (res.ok) { finishWrite(key, data, mine, res.rev); return }
      if (res.doc === null) { serverBaseRef.current.delete(key); continue }             // the row no longer exists: write it fresh
      const merged = mergeDay(base?.doc ?? null, mine, res.doc)
      if (merged.conflicts.length > 0) {
        const c: DayConflict = { key, mine, theirs: res.doc, theirsRev: res.rev, conflicts: merged.conflicts }
        dayConflictsRef.current = [...dayConflictsRef.current.filter(x => x.key !== key), c]
        setDayConflicts(dayConflictsRef.current)
        throw new DaySyncParked()
      }
      serverBaseRef.current.set(key, { rev: res.rev, doc: res.doc })                      // merged cleanly: try again on top of the server's copy
      mine = merged.doc
    }
    throw new Error('day-sync-contended')                                                  // bounded; the queue retries later at its normal back-off
  }
  useEffect(() => { writeDayRef.current = writeDay })

  const resolveDayConflict = useCallback((key: string, choice: 'mine' | 'theirs') => {
    const c = dayConflictsRef.current.find(x => x.key === key)
    if (!c) return
    dayConflictsRef.current = dayConflictsRef.current.filter(x => x.key !== key)
    setDayConflicts(dayConflictsRef.current)
    if (c.theirs) serverBaseRef.current.set(key, { rev: c.theirsRev, doc: c.theirs }); else serverBaseRef.current.delete(key)
    if (choice === 'mine') {
      void daySync.resolve(key)                          // the user chose this device's version: it is written over the other one
    } else {
      try {                                              // the discarded version is kept on this device — nothing is lost silently
        const raw = JSON.parse(localStorage.getItem(CONFLICT_BACKUP_KEY) ?? '[]') as unknown[]
        localStorage.setItem(CONFLICT_BACKUP_KEY, JSON.stringify([{ key, savedAt: Date.now(), doc: c.mine }, ...raw].slice(0, 5)))
      } catch {}
      daySync.discard(key)
      const theirs = c.theirs
      if (theirs) setCalData(prev => { const next = { ...prev, [key]: theirs }; try { localStorage.setItem('xp9d', JSON.stringify(next)) } catch {}; return next })
    }
  }, [daySync])

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
    try {
      // Absence of these keys IS the meaningful "Automatic" state — do not
      // write a default value here, only restore an explicit prior choice.
      const lang = localStorage.getItem('xp-language')
      if (lang) setLanguageRaw(lang)
    } catch {}
    try {
      const tz = localStorage.getItem('xp-timezone')
      if (tz) setTimezoneRaw(tz)
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
    markStage('local', 'done')
    setHydrated(true)
  }, [markStage])

  // ─── Resolve Supabase user ID after hydration ────────────────────────────────

  useEffect(() => {
    if (!hydrated) return
    let cancelled = false
    ;(async () => {
      const auth = createClient().auth
      let uid = ''
      try { uid = (await auth.getUser()).data.user?.id ?? '' } catch {}
      if (!uid) { try { uid = (await auth.getSession()).data.session?.user.id ?? '' } catch {} }      // offline: the stored session still names the account
      if (cancelled) return
      if (uid) { setUserId(uid); markStage('auth', 'done') }
      else { markStage('auth', 'failed'); settleStartup(new Error('auth-unavailable')) }
    })()
    return () => { cancelled = true }
  }, [hydrated, startup.attempt, markStage, settleStartup])

  // ─── Initial Supabase data fetch ─────────────────────────────────────────────
  // Runs once per session when the user ID becomes available.
  // SAFETY: if Supabase returns empty data for a table, we keep the existing
  // localStorage state untouched — this protects pre-migration desktop data.

  useEffect(() => {
    if (!userId) return
    const supabase = createClient()
    const attempt = attemptRef.current
    // Each read reports its own completion (that is what the loader's percentage is made of); a read that FAILS is a failure — never "empty".
    const track = <T,>(id: StageId, p: Promise<T>): Promise<T> => p.then(v => { markStage(id, 'done'); return v }, e => { markStage(id, 'failed'); throw e })

    // Resume days whose last edit never reached the server (failed write, or a refresh mid-write): re-send the
    // LOCAL copy and keep hydration from replacing it with the older server row.
    try {
      const stored = JSON.parse(localStorage.getItem(BASE_KEY) ?? 'null') as { uid?: string; bases?: Record<string, { rev: number | null; doc: DayData }> } | null
      if (stored && stored.uid === userId && stored.bases) for (const [k, b] of Object.entries(stored.bases)) serverBaseRef.current.set(k, b)
    } catch {}
    try {
      const marker = JSON.parse(localStorage.getItem(UNSYNCED_KEY) ?? 'null') as { uid?: string; keys?: string[] } | null
      if (marker && marker.uid === userId && Array.isArray(marker.keys)) {
        const local = JSON.parse(localStorage.getItem('xp9d') ?? '{}') as CalendarData
        for (const key of marker.keys) {
          if (local[key] && !daySync.hasUnsynced(key)) daySync.schedule(key, local[key])
        }
      }
    } catch {}

    Promise.all([
      track('calendar', fetchCalendarDaysWithRev(supabase, userId, true)),
      track('sessions', fetchWorkSessions(supabase, userId, true)),
      track('activities', fetchUserActivities(supabase, userId, true)),
      track('preferences', fetchUserPreferences(supabase, userId, true)),
      track('reminders', supabaseFetchReminders(true)),
      track('labels', fetchJournalLabels(supabase, userId, true)),
      fetchJournalFoldersStrict(supabase, userId).then(v => { markStage('folders', 'done'); return v }, () => { markStage('folders', 'done'); return null }),   // optional: null = could not load, this device's copy is kept
    ]).then(([sbCalRes, sbSessions, sbActivities, sbPrefs, sbReminders, sbJournalLabels, sbJournalFolders]) => {
      if (attempt !== attemptRef.current) return      // a newer attempt (Retry) owns the result
      const sbCalData = sbCalRes.data

      // Calendar days: merge if Supabase has rows; Supabase data wins per date key.
      // Skip days that have a pending local write to avoid a race between a fast
      // user edit (debounce not yet fired) and the hydration network response.
      if (Object.keys(sbCalData).length > 0) {
        setCalData(prev => {
          const merged = { ...prev }
          for (const [key, dayData] of Object.entries(sbCalData)) {
            if (!daySync.hasUnsynced(key)) {
              merged[key] = dayData
            }
          }
          try { localStorage.setItem('xp9d', JSON.stringify(merged)) } catch {}
          return merged
        })
      }

      // every day the server sent us is now the version this device is based on — EXCEPT days with unsent local edits, which keep the base they were edited on
      for (const [key, doc] of Object.entries(sbCalData)) if (!daySync.hasUnsynced(key)) serverBaseRef.current.set(key, { rev: sbCalRes.revs[key] ?? null, doc })
      setCalHydrated(true)   // the calendar (and so every task) has been read from the server: schedule/task reconciliation may run

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

        // Language/timezone: Supabase is the cross-device source of truth
        // once a preferences row exists, and unlike isDark/progressColor a
        // null value here is meaningful ("Automatic"), not "absent" — so we
        // always apply it, including null, rather than guarding on truthiness.
        setLanguageRaw(sbPrefs.language)
        try {
          if (sbPrefs.language) localStorage.setItem('xp-language', sbPrefs.language)
          else localStorage.removeItem('xp-language')
        } catch {}
        setTimezoneRaw(sbPrefs.timezone)
        try {
          if (sbPrefs.timezone) localStorage.setItem('xp-timezone', sbPrefs.timezone)
          else localStorage.removeItem('xp-timezone')
        } catch {}
      }

      // Journal labels/folders: replace if Supabase has rows (cross-device truth)
      if (sbJournalLabels.length > 0) {
        setJournalLabelsState(sbJournalLabels)
        try { localStorage.setItem('xp9jl', JSON.stringify(sbJournalLabels)) } catch {}
      }
      // null = could not load (keep what this device has). [] = the account really has no folders (e.g. the last one was deleted on another device).
      if (sbJournalFolders !== null) {
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

      settleStartup()     // everything that guards the user's data was read: editing and saving are now allowed
    }).catch(err => {
      console.error('[XPadite] Supabase initial fetch error:', err)
      if (attempt === attemptRef.current) settleStartup(err)      // nothing was applied: this device's copy stays untouched; offline (verified) or blocked until Retry
    })
  }, [userId, startup.attempt, markStage, settleStartup])   // eslint-disable-line react-hooks/exhaustive-deps

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
      const datesToCheck = Array.from(new Set([todayKey(effectiveTimezoneRef.current), ...(localTimer ? [localTimer.dateKey] : [])]))

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
          const row = payload.new as { date_key?: string; day_data?: DayData; rev?: number }
          if (!row.date_key || !row.day_data) return

          const dateKey = row.date_key
          const dayData  = row.day_data

          // Accept remote calData only when we have no pending local write for this date.
          // This prevents echoes of our own debounce writes from clobbering optimistic state.
          if (!daySync.hasUnsynced(dateKey)) {
            const b0 = serverBaseRef.current.get(dateKey)
            if (typeof row.rev === 'number' && (!b0 || b0.rev == null || row.rev >= b0.rev)) serverBaseRef.current.set(dateKey, { rev: row.rev, doc: dayData })
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
  // Entries stay "unsynced" (and in the persisted marker) until the server confirms, so a write cut off
  // by the page closing is re-sent on the next load instead of being lost.
  useEffect(() => {
    function flush() { void daySync.flushAll() }
    function onVisChange() {
      if (document.visibilityState === 'hidden') flush()
      else daySync.retryNow()
    }
    function onOnline() { daySync.retryNow() }
    window.addEventListener('pagehide', flush)
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisChange)
    return () => {
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisChange)
    }
  }, [daySync])

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

  const applyDayEdit = useCallback((key: string, updater: (prev: DayData) => DayData, opts?: { after?: string[] }) => {
    setCalData(prev => {
      const raw = prev[key] ?? { ...EMPTY_DAY }
      // Normalize legacy DayData that may lack a tasks array
      const current: DayData = Array.isArray(raw.tasks) ? raw : { ...raw, tasks: [] }
      const updated = updater(current)
      const next = { ...prev, [key]: updated }
      try { localStorage.setItem('xp9d', JSON.stringify(next)) } catch {}
      // Queue the debounced, confirm-tracked Supabase write with this exact value. Runs inside the
      // updater so the value is the one React actually committed; it is idempotent, so a strict-mode
      // double invoke only re-queues the same data.
      if (userIdRef.current) daySync.schedule(key, updated, opts)
      return next
    })
  }, [daySync])
  useEffect(() => { applyDayEditRef.current = applyDayEdit }, [applyDayEdit])
  // Before the account's data is ready an edit would be built on a screen that may be missing everything: it is HELD (nothing is lost, nothing is
  // saved) and replayed on top of the loaded data the moment it is ready. The loader blocks the UI, so this is the safety net behind it.
  const updateDay = useCallback((key: string, updater: (prev: DayData) => DayData, opts?: { after?: string[] }) => {
    if (!dataReadyRef.current) { if (heldEditsRef.current.length < 500) heldEditsRef.current.push({ key, updater, opts }); return }
    applyDayEdit(key, updater, opts)
  }, [applyDayEdit])

  const flushDays = useCallback(async (keys?: string[]): Promise<boolean> => {
    if (!dataReadyRef.current) return false        // not loaded yet: nothing has been confirmed saved
    if (!userIdRef.current) return true
    if (!keys) return daySync.flushAll()
    const results = await Promise.all(keys.map(k => daySync.flush(k)))
    return results.every(Boolean)
  }, [daySync])

  // ─── My Schedule (v1.328): events, deadline→task sync, saved locations ───────────────────────────────────────────

  const loadSchedule = useCallback(async () => {
    const uid = userIdRef.current
    if (!uid) return
    const supabase = createClient()
    try {
      const [events, extras, syncPref] = await Promise.all([
        fetchScheduleEvents(supabase, uid),
        fetchScheduleExtras(supabase, uid).catch(() => null),   // columns missing ≠ events unavailable
        fetchScheduleSyncPref(supabase, uid).catch(() => null), // migration 024 not applied yet → stays OFF
      ])
      setScheduleEventsState(events)
      if (syncPref !== null) { scheduleTaskSyncRef.current = syncPref; setScheduleTaskSyncState(syncPref) }
      if (extras) { setSavedLocationsState(extras.savedLocations); setScheduleCategoriesState(extras.categories) }
      setScheduleStatus('ready')
    } catch (err) {
      console.error('[Schedule] load failed:', err)
      // keep whatever we already had on a refresh failure; only the very first failure marks it unavailable
      setScheduleStatus(s => (s === 'ready' ? s : 'unavailable'))
    }
  }, [])

  useEffect(() => { if (userId) void loadSchedule() }, [userId, loadSchedule])

  // Other devices: re-read when the app comes back to the foreground (no realtime subscription → no extra egress).
  useEffect(() => {
    if (!userId) return
    let last = Date.now()
    function onVisible() {
      if (document.visibilityState !== 'visible' || Date.now() - last < 60_000) return
      last = Date.now()
      void loadSchedule()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [userId, loadSchedule])

  // ── Atomic event + linked-task writes (migration 023: schedule_apply) ──────────────────────────────────────────────
  // Every schedule write runs through ONE queue in this tab (so two quick actions never interleave), flushes the affected days'
  // pending local edits first, then asks the server to apply the event write AND the by-id task ops in a single transaction.
  // The server's resulting day documents are adopted locally — so what is on screen is what is stored.

  const syncChainRef = useRef<Promise<unknown>>(Promise.resolve())
  const exclusive = useCallback(<T,>(fn: () => Promise<T>): Promise<T> => {
    const run = syncChainRef.current.then(() => fn())
    syncChainRef.current = run.catch(() => undefined)
    return run
  }, [])

  const fail = (code: 'conflict' | 'setup' | 'sync_pending' | 'signed_out' | 'unavailable', message: string) => Object.assign(new Error(message), { code })
  const scheduleError = (err: unknown): Error => {
    if (err instanceof ScheduleConflictError) { void loadSchedule(); return fail('conflict', 'This event was changed on another device or tab. The latest version has been loaded \u2014 review it and save again.') }
    if (err instanceof ScheduleSetupError) { setScheduleStatus('unavailable'); return fail('setup', 'The schedule database is not fully set up yet (migrations 022 and 023). Nothing was saved.') }
    return err instanceof Error ? err : new Error('request failed')
  }

  const commitEvents = useCallback((fn: (l: StoredScheduleEvent[]) => StoredScheduleEvent[]) => {
    scheduleEventsRef.current = fn(scheduleEventsRef.current)     // visible to the next queued action immediately, not after a re-render
    setScheduleEventsState(scheduleEventsRef.current)
  }, [])

  /** Puts the server's resulting days on screen. A day with an unsent local edit keeps it (the ops are replayed on top instead). */
  const adoptServerDays = useCallback((days: Record<string, DayData>, ops: TaskOp[], revs: Record<string, number> = {}) => {
    const keys = Object.keys(days)
    if (keys.length === 0) return
    const adopt: Record<string, DayData> = {}
    for (const k of keys) {
      if (!daySync.hasUnsynced(k)) { adopt[k] = days[k]; serverBaseRef.current.set(k, { rev: revs[k] ?? null, doc: days[k] }); continue }
      updateDay(k, d => {
        const mine = ops.filter(o => o.date_key === k || (o.kind === 'move' && o.from_key === k))
        let cur = d
        for (const o of mine) {
          if (o.kind === 'move') cur = o.from_key === k ? { ...cur, tasks: cur.tasks.filter(t => t.id !== o.task_id) } : (applyOpsLocal({ [k]: cur }, [{ ...o, kind: 'upsert' }])[k] ?? cur)
          else cur = applyOpsLocal({ [k]: cur }, [o])[k] ?? cur
        }
        return cur
      })
    }
    if (Object.keys(adopt).length === 0) return
    calDataRef.current = { ...calDataRef.current, ...adopt }
    setCalData(prev => {
      const next = { ...prev, ...adopt }
      try { localStorage.setItem('xp9d', JSON.stringify(next)) } catch {}
      return next
    })
  }, [daySync, updateDay])

  const flushFor = useCallback(async (ops: TaskOp[]) => {
    if (ops.length === 0) return
    if (!(await flushDays(opKeys(ops)))) throw fail('sync_pending', 'Your latest task changes have not finished syncing yet \u2014 please try again in a moment. Nothing was saved.')
  }, [flushDays])

  const saveInner = useCallback(async (ev: ScheduleEvent, opts?: { addTask?: boolean }): Promise<void> => {
    const uid = userIdRef.current
    if (!uid) throw fail('signed_out', 'You are signed out, so this could not be saved.')
    if (scheduleStatusRef.current === 'unavailable') throw fail('unavailable', 'Saving is not available yet (the schedule database is not set up). Nothing was saved.')
    const prev = scheduleEventsRef.current.find(e => e.id === ev.id)
    const link = prev?.taskLink ?? 'linked'
    // the per-event opt-out ('detached') survives every edit, including toggling the deadline flag; only the explicit "Add back" clears it
    // a synced-event task is created only for a NEW event (or an explicit "Add back"): re-saving an older event never links it behind the user's back
    const plan = planDeadlineSync(calDataRef.current, ev.id, ev, prev?.taskDateKey ?? null, activitiesRef.current[0]?.id ?? '', undefined, link, scheduleTaskSyncRef.current, !prev || !!opts?.addTask)
    const stored: StoredScheduleEvent = { ...ev, taskDateKey: plan.taskDateKey, rev: prev?.rev, taskLink: link }
    try {
      await flushFor(plan.ops)
      const res = await applyScheduleChange(createClient(), { userId: uid, event: stored, expectedRev: prev?.rev ?? null, ops: plan.ops })
      commitEvents(list => (list.some(e => e.id === ev.id) ? list.map(e => (e.id === ev.id ? { ...stored, rev: res.rev ?? stored.rev } : e)) : [...list, { ...stored, rev: res.rev ?? undefined }]))
      adoptServerDays(res.days, plan.ops, res.revs)
    } catch (err) { throw scheduleError(err) }
  }, [adoptServerDays, commitEvents, flushFor])   // eslint-disable-line react-hooks/exhaustive-deps

  const saveScheduleEvent = useCallback((ev: ScheduleEvent) => exclusive(() => saveInner(ev)), [exclusive, saveInner])

  const deleteScheduleEvent = useCallback((id: string) => exclusive(async () => {
    const uid = userIdRef.current
    if (!uid) throw fail('signed_out', 'You are signed out, so this could not be deleted.')
    const prev = scheduleEventsRef.current.find(e => e.id === id)
    const plan = planDeadlineSync(calDataRef.current, id, null, prev?.taskDateKey ?? null, activitiesRef.current[0]?.id ?? '', undefined, prev?.taskLink ?? 'linked', scheduleTaskSyncRef.current)
    try {
      await flushFor(plan.ops)
      const res = await applyScheduleChange(createClient(), { userId: uid, deleteEventId: id, expectedRev: null, ops: plan.ops })   // one transaction: event + task
      commitEvents(list => list.filter(e => e.id !== id))
      adoptServerDays(res.days, plan.ops, res.revs)
    } catch (err) { throw scheduleError(err) }
  }), [exclusive, flushFor, commitEvents, adoptServerDays])   // eslint-disable-line react-hooks/exhaustive-deps

  const detachDeadlineTask = useCallback((eventId: string) => exclusive(async () => {
    if (!userIdRef.current) throw fail('signed_out', 'You are signed out.')
    try {
      const rev = await setScheduleTaskLink(createClient(), eventId, 'detached')
      commitEvents(list => list.map(e => (e.id === eventId ? { ...e, taskLink: 'detached', taskDateKey: null, rev: rev ?? e.rev } : e)))
    } catch (err) { throw scheduleError(err) }
  }), [exclusive, commitEvents])   // eslint-disable-line react-hooks/exhaustive-deps

  const restoreDeadlineTask = useCallback((eventId: string) => exclusive(async () => {
    if (!userIdRef.current) throw fail('signed_out', 'You are signed out.')
    const ev = scheduleEventsRef.current.find(e => e.id === eventId)
    if (!ev) return
    try {
      const rev = await setScheduleTaskLink(createClient(), eventId, 'linked')
      commitEvents(list => list.map(e => (e.id === eventId ? { ...e, taskLink: 'linked', rev: rev ?? e.rev } : e)))
    } catch (err) { throw scheduleError(err) }
    await saveInner({ ...(scheduleEventsRef.current.find(e => e.id === eventId) as StoredScheduleEvent) }, { addTask: true })   // recreates the task through the same atomic path
  }), [exclusive, commitEvents, saveInner])   // eslint-disable-line react-hooks/exhaustive-deps

  // ── Reconciliation ───────────────────────────────────────────────────────────────────────────────────────────────
  // Whenever schedule data is loaded or changes, compare events with tasks and repair drift through the SAME server-merged ops
  // (so it can never overwrite other tasks or another device's edits). Each event gets at most 3 failed attempts per session —
  // no timers, no loops: it re-runs only when events change, the app refocuses, or the user taps Retry.
  const reconcileAttemptsRef = useRef(new Map<string, number>())

  const reconcileInner = useCallback(async (force = false, backfill = false) => {
    const uid = userIdRef.current
    if (!uid || scheduleStatusRef.current !== 'ready') return
    if (force) reconcileAttemptsRef.current.clear()
    const attempts = reconcileAttemptsRef.current
    // repairs / renames / moves / removes existing links; creates a missing synced-event task ONLY during an explicit, consented back-fill
    const nowMs = Date.now()
    const items = reconcileDeadlines(calDataRef.current, scheduleEventsRef.current, activitiesRef.current[0]?.id ?? '', scheduleTaskSyncRef.current, backfill ? (e => isBackfillEligible(e as Parameters<typeof isBackfillEligible>[0], nowMs, calDataRef.current)) : false)
    const todo = items.filter(it => (attempts.get(it.eventId) ?? 0) < 3)
    let bad = items.length - todo.length
    for (const batch of batchItems(todo)) {
      const ops = batch.flatMap(i => i.ops)
      try {
        await flushFor(ops)
        const res = await applyScheduleChange(createClient(), { userId: uid, ops })
        adoptServerDays(res.days, ops, res.revs)
        for (const it of batch) attempts.delete(it.eventId)
      } catch (err) {
        console.error('[Schedule] reconcile failed:', err)
        for (const it of batch) attempts.set(it.eventId, (attempts.get(it.eventId) ?? 0) + 1)
        bad += batch.length
      }
    }
    setScheduleSyncIssue(bad > 0 ? `${bad} deadline${bad === 1 ? '' : 's'} could not be synced to your Task Manager.` : null)
  }, [flushFor, adoptServerDays])
  const reconcileSchedule = useCallback((force = false) => exclusive(() => reconcileInner(force)), [exclusive, reconcileInner])

  useEffect(() => {
    if (scheduleStatus === 'ready' && calHydrated) void reconcileSchedule().catch(() => {})
  }, [scheduleStatus, calHydrated, scheduleEvents, scheduleTaskSync, reconcileSchedule])

  const retryScheduleSync = useCallback(async () => { await reconcileSchedule(true) }, [reconcileSchedule])

  // "Sync with Task Manager": persist the switch per user, THEN reconcile existing links with it (move/rename or remove-safely). Existing events are
  // only given tasks when `opts.backfill` (the user's explicit choice in the dialog); otherwise turning it ON changes no existing task.
  // If the preference can not be saved this rejects and nothing changes; if some tasks then can not be synced the Retry banner says so.
  const setScheduleTaskSyncPref = useCallback((next: boolean, opts?: { backfill?: boolean }) => exclusive(async () => {
    if (!userIdRef.current) throw fail('signed_out', 'You are signed out, so this could not be saved.')
    if (scheduleStatusRef.current !== 'ready') throw fail('unavailable', 'My Schedule is not ready yet \u2014 try again in a moment. Nothing was changed.')
    try { await setScheduleSyncPref(createClient(), next) } catch (err) { throw scheduleError(err) }
    scheduleTaskSyncRef.current = next; setScheduleTaskSyncState(next)
    await reconcileInner(true, next && !!opts?.backfill)
  }), [exclusive, reconcileInner])   // eslint-disable-line react-hooks/exhaustive-deps

  const requestScheduleEvent = useCallback((eventId: string) => setScheduleFocusRequest({ eventId, nonce: Date.now() }), [])
  const clearScheduleFocusRequest = useCallback(() => setScheduleFocusRequest(null), [])
  const requestMindMap = useCallback((dateKey: string, closeOnExit = false) => setMindMapRequest({ dateKey, nonce: Date.now(), closeOnExit }), [])
  const clearMindMapRequest = useCallback(() => setMindMapRequest(null), [])

  const setSavedLocations = useCallback(async (next: string[]): Promise<void> => {
    const prev = savedLocationsRef.current
    setSavedLocationsState(next)
    const uid = userIdRef.current
    if (!uid) return
    try { await saveScheduleExtras(createClient(), uid, { savedLocations: next }) }
    catch (err) { console.error('[Schedule] saved locations:', err); setSavedLocationsState(prev); setToast('Could not save your locations \u2014 please try again.') }
  }, [])

  const setScheduleCategories = useCallback(async (next: ScheduleCategory[]): Promise<void> => {
    const prev = scheduleCategoriesRef.current
    setScheduleCategoriesState(next)
    const uid = userIdRef.current
    if (!uid) return
    try { await saveScheduleExtras(createClient(), uid, { categories: next }) }
    catch (err) { console.error('[Schedule] categories:', err); setScheduleCategoriesState(prev); setToast('Could not save your categories \u2014 please try again.') }
  }, [])

  const addSession = useCallback((s: WorkSession) => {
    trackFeature('activity_time_tracker') // analytics: a finished tracked session (no-op without consent)
    // Upsert by id, never blind-append — the same session finalizing twice
    // (e.g. a rapid double Clock-Out click before the disabled state takes
    // effect, or a race with the setActiveTaskTimer(null) finalization path
    // below) must still contribute exactly once to every duration total that
    // sums `sessions`. See "Total Focus Time Today" comment in DayModal.tsx.
    setSessions(prev => {
      const next = prev.some(p => p.id === s.id) ? prev.map(p => p.id === s.id ? s : p) : [...prev, s]
      try { localStorage.setItem('xp9s', JSON.stringify(next)) } catch {}
      return next
    })
    const uid = dataReadyRef.current ? userIdRef.current : ''
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
    const uid = dataReadyRef.current ? userIdRef.current : ''
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
    const uid = dataReadyRef.current ? userIdRef.current : ''
    if (uid) {
      upsertAllActivities(createClient(), uid, next).catch(err =>
        console.error('[Activities] Supabase sync error:', err)
      )
    }
  }, [])

  const setProgressColor = useCallback((c: string) => {
    setProgressColorRaw(c)
    try { localStorage.setItem('xp-progress-color', c) } catch {}
    const uid = dataReadyRef.current ? userIdRef.current : ''
    if (uid) {
      upsertUserPreferences(createClient(), uid, { progressColor: c }).catch(err =>
        console.error('[Prefs] Progress color sync error:', err)
      )
    }
  }, [])

  const setIsDark = useCallback((v: boolean) => {
    setIsDarkRaw(v)
    try { localStorage.setItem('xp-theme', String(v)) } catch {}
    const uid = dataReadyRef.current ? userIdRef.current : ''
    if (uid) {
      upsertUserPreferences(createClient(), uid, { isDark: v }).catch(err =>
        console.error('[Prefs] Theme sync error:', err)
      )
    }
  }, [])

  // Supabase/Postgrest errors carry their real detail on .message/.code/
  // .details/.hint — logging the raw object (as this used to) can print as
  // "{}" depending on how it gets serialized, hiding the actual cause. This
  // pulls those fields out explicitly so a real failure is diagnosable, and
  // flags the specific, common "column doesn't exist yet" case (Postgrest
  // code 42703 / PGRST204) — which is exactly what every language/timezone
  // sync attempt produces if migration 012_user_locale_preferences.sql (the
  // one that adds the language/timezone columns to user_preferences) hasn't
  // been run against this Supabase project yet.
  function describePrefsError(err: unknown): string {
    if (err && typeof err === 'object') {
      const e = err as { message?: string; code?: string; details?: string; hint?: string }
      if (e.code === '42703' || e.code === 'PGRST204') {
        return `column missing on user_preferences (code ${e.code}) — has supabase/migrations/012_user_locale_preferences.sql been applied? ${e.message ?? ''}`
      }
      const parts = [e.message, e.code && `code=${e.code}`, e.details, e.hint].filter(Boolean)
      if (parts.length) return parts.join(' | ')
    }
    try { return JSON.stringify(err) } catch { return String(err) }
  }

  // v === null resets to "Automatic" — persisted as an explicit null so it
  // isn't reinterpreted as "no preference set yet" on next load.
  const setLanguage = useCallback((v: string | null) => {
    setLanguageRaw(v)
    try {
      if (v) localStorage.setItem('xp-language', v)
      else localStorage.removeItem('xp-language')
    } catch {}
    const uid = dataReadyRef.current ? userIdRef.current : ''
    if (uid) {
      upsertUserPreferences(createClient(), uid, { language: v }).catch(err =>
        console.error('[Prefs] Language sync error:', describePrefsError(err))
      )
    }
  }, [])

  const setTimezone = useCallback((v: string | null) => {
    setTimezoneRaw(v)
    try {
      if (v) localStorage.setItem('xp-timezone', v)
      else localStorage.removeItem('xp-timezone')
    } catch {}
    const uid = dataReadyRef.current ? userIdRef.current : ''
    if (uid) {
      upsertUserPreferences(createClient(), uid, { timezone: v }).catch(err =>
        console.error('[Prefs] Timezone sync error:', describePrefsError(err))
      )
    }
  }, [])

  const effectiveLocale = resolveLocale(language)

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
    const uid = dataReadyRef.current ? userIdRef.current : ''
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
    const uid = dataReadyRef.current ? userIdRef.current : ''
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
      const uid = dataReadyRef.current ? userIdRef.current : ''
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
      // Upsert by id (see the same guard in addSession above) — this path and
      // addSession/clockOut can both finalize the SAME underlying session id
      // depending on which UI surface (Task Manager Stop vs header Clock Out)
      // closes it first; without this, that session's duration is summed
      // twice in every "Total Focus Time Today" calculation from then on.
      setSessions(prev => {
        const next = prev.some(p => p.id === finalized.id) ? prev.map(p => p.id === finalized.id ? finalized : p) : [...prev, finalized]
        try { localStorage.setItem('xp9s', JSON.stringify(next)) } catch {}
        return next
      })
      const uid = dataReadyRef.current ? userIdRef.current : ''
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
    const uid = dataReadyRef.current ? userIdRef.current : ''
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
    const uid = dataReadyRef.current ? userIdRef.current : ''
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
    const uid = dataReadyRef.current ? userIdRef.current : ''
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
    const uid = dataReadyRef.current ? userIdRef.current : ''
    if (uid) {
      upsertAllJournalFolders(createClient(), uid, next).catch(err =>
        console.error('[JournalFolders] Supabase sync error:', err)
      )
    }
  }, [])

  const updateJournalFolder = useCallback((f: JournalFolder) => {
    const next = journalFoldersRef.current.map(x => (x.id === f.id ? { ...x, ...f } : x))
    try { localStorage.setItem('xp9jf', JSON.stringify(next)) } catch {}
    setJournalFoldersState(next)
    const uid = dataReadyRef.current ? userIdRef.current : ''
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
    const uid = dataReadyRef.current ? userIdRef.current : ''
    if (!uid) return Promise.resolve(true)
    return deleteJournalFolder(createClient(), uid, id).then(() => true, err => {
      console.error('[JournalFolders] Supabase delete error:', err)
      return false
    })
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
        let uid = dataReadyRef.current ? userIdRef.current : ''
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
    const uid = dataReadyRef.current ? userIdRef.current : ''
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
    const uid = dataReadyRef.current ? userIdRef.current : ''
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

    const uid = dataReadyRef.current ? userIdRef.current : ''
    if (uid) {
      supabasePatchReminder(id, { notificationsEnabled: enabled }).catch(err => {
        console.error('[Reminders] setReminderNotificationsEnabled patch error:', err)
      })
    }
  }, [])

  const progress = stageProgress(startup.stages)
  const dataReady = isDataReady(startup.status)
  // the loader completes only once the data is ready AND the optional reads (notes, schedule, folders) have settled — or a short grace has passed
  const loaderGate = dataReady && (allStagesSettled(startup.stages) || graceDone)
  useEffect(() => {
    if (!dataReady || allStagesSettled(startup.stages)) return
    const id = setTimeout(() => setGraceDone(true), 4000)
    return () => clearTimeout(id)
  }, [dataReady, startup.stages])
  useEffect(() => { if (journalDocs.status === 'ready' || journalDocs.status === 'offline' || journalDocs.status === 'unavailable') markStage('notes', 'done') }, [journalDocs.status, markStage])
  useEffect(() => { if (scheduleStatus !== 'loading') markStage('schedule', 'done') }, [scheduleStatus, markStage])
  // back online while the first read had failed: try again by itself
  useEffect(() => {
    if (startup.status !== 'failed') return
    const on = () => retryStartup()
    window.addEventListener('online', on)
    return () => window.removeEventListener('online', on)
  }, [startup.status, retryStartup])

  const loader = overlayDone ? null : (
    <StartupLoader status={startup.status} progress={progress} complete={loaderGate} appVisible={hydrated} onRetry={retryStartup} onDone={() => { if (!dataReadyRef.current) return      /* the overlay can only be released once the data really is ready, whatever the loader asks */
      setOverlayDone(true); if (startup.status === 'offline') setToast('Offline — showing your saved data. Changes sync when you are back online.') }} />
  )

  return (
    <>
    {/* the loader keeps one position in the tree, so it is never remounted when the app appears behind it */}
    {hydrated && <AppContext.Provider value={{
      calData, updateDay, flushDays,
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
      language, setLanguage, effectiveLocale,
      timezone, setTimezone, effectiveTimezone,
      customColors, addCustomColor, removeCustomColor,
      legendVisible, setLegendVisible,
      journalLabels, addJournalLabel, removeJournalLabel,
      journalFolders, addJournalFolder, removeJournalFolder, updateJournalFolder, journalDocs,
      reminders, userEmail,
      upsertReminderCtx, removeReminderCtx, fireReminderCtx, setReminderNotificationsEnabled,
      scheduleEvents, scheduleStatus, deadlineDays, saveScheduleEvent, deleteScheduleEvent,
      scheduleTaskSync, setScheduleTaskSyncPref, dayConflicts, resolveDayConflict, subscribeDaySync, isDayUnsynced,
      dataReady, startup: { status: startup.status, progress, offline: startup.status === 'offline' },
      detachDeadlineTask, restoreDeadlineTask, scheduleSyncIssue, retryScheduleSync, scheduleTimeFormat, setScheduleTimeFormat,
      scheduleFocusRequest, requestScheduleEvent, clearScheduleFocusRequest,
      mindMapRequest, requestMindMap, clearMindMapRequest,
      savedLocations, setSavedLocations, scheduleCategories, setScheduleCategories,
    }}>
      {/* `inert` while the startup overlay is up: nothing underneath can be focused, tapped or typed into. display:contents keeps the layout unchanged. */}
      <div style={{ display: 'contents' }} inert={!overlayDone || !dataReady}>{children}</div>
      {dayConflicts[0] && <DayConflictDialog conflict={dayConflicts[0]} others={dayConflicts.length - 1} onChoose={choice => resolveDayConflict(dayConflicts[0].key, choice)} />}
    </AppContext.Provider>}
    {loader}
    </>
  )
}

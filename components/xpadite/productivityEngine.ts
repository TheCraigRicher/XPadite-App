import { dateKey, APP_YEAR } from './utils'
import type { CalendarData, WorkSession, ActiveSession } from './types'

// ─── Task completion score ─────────────────────────────────────────────────────
// 0→0%, 1→25%, 2→45%, 3→60%, 4→70%, 5→78%, 6→85%, 7→90%, 8→95%, 9+→100%

const TASK_SCORE = [0, 25, 45, 60, 70, 78, 85, 90, 95] as const

export function taskCompletionScore(completed: number): number {
  if (completed <= 0) return 0
  if (completed >= TASK_SCORE.length) return 100
  return TASK_SCORE[completed]
}

// ─── Focus time score: 10% per hour, proportional, capped at 30% ──────────────

export function focusTimeScore(ms: number): number {
  return Math.min(30, (ms / 3_600_000) * 10)
}

// ─── Productive day flag ──────────────────────────────────────────────────────

export function isProdDay(day: CalendarData[string] | undefined): boolean {
  return !!(day?.productive || day?.hyper || day?.milestone || day?.goal)
}

// ─── Day score ────────────────────────────────────────────────────────────────

export interface DayScoreResult {
  score: number
  completedTasks: number
  totalTasks: number
  focusedMinutes: number
}

export function calculateDayScore(
  key: string,
  calData: CalendarData,
  sessions: WorkSession[],
  activeSession: ActiveSession | null = null,
  now: Date = new Date(),
): DayScoreResult {
  const day = calData[key]
  const completedTasks = day?.tasks?.filter(t => t.done).length ?? 0
  const totalTasks = day?.tasks?.length ?? 0
  const tScore = taskCompletionScore(completedTasks)

  const sessionMs = sessions
    .filter(s => s.dateKey === key && s.endTs !== null)
    .reduce((sum, s) => sum + (s.endTs! - s.startTs), 0)

  const taskMs = (day?.tasks ?? []).reduce((tsum, task) =>
    tsum + task.sessions
      .filter(s => s.endTs !== null)
      .reduce((ssum, s) => ssum + (s.endTs! - s.startTs), 0), 0)

  const activeMs =
    activeSession?.dateKey === key
      ? Math.max(0, now.getTime() - activeSession.startTs)
      : 0

  const totalFocusMs = sessionMs + taskMs + activeMs
  const fScore = focusTimeScore(totalFocusMs)

  return {
    score: Math.min(100, Math.round(tScore + fScore)),
    completedTasks,
    totalTasks,
    focusedMinutes: Math.floor(totalFocusMs / 60_000),
  }
}

// ─── Key list builders ────────────────────────────────────────────────────────

/** Current week: Sunday through today */
export function buildWeekKeys(today: Date = new Date()): string[] {
  const dow = today.getDay()
  const start = new Date(today)
  start.setDate(today.getDate() - dow)
  start.setHours(0, 0, 0, 0)
  return Array.from({ length: dow + 1 }, (_, i) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    return dateKey(d.getFullYear(), d.getMonth(), d.getDate())
  })
}

/** Elapsed days in month: day 1 through today for current month; full month for others */
export function buildMonthKeys(
  month: number,
  year: number = APP_YEAR,
  today: Date = new Date(),
): string[] {
  const isCurrentMonth = today.getMonth() === month && today.getFullYear() === year
  const lastDay = isCurrentMonth ? today.getDate() : new Date(year, month + 1, 0).getDate()
  return Array.from({ length: lastDay }, (_, i) => dateKey(year, month, i + 1))
}

/** All days in the year through today */
export function buildYearKeys(year: number = APP_YEAR, today: Date = new Date()): string[] {
  const isCurrentYear = today.getFullYear() === year
  const lastMonth = isCurrentYear ? today.getMonth() : 11
  const keys: string[] = []
  for (let m = 0; m <= lastMonth; m++) {
    const td = new Date(year, m + 1, 0).getDate()
    const lastDay = isCurrentYear && m === lastMonth ? today.getDate() : td
    for (let d = 1; d <= lastDay; d++) keys.push(dateKey(year, m, d))
  }
  return keys
}

// ─── Period progress (average daily scores over elapsed days) ─────────────────

function averageScore(
  keys: string[],
  calData: CalendarData,
  sessions: WorkSession[],
  activeSession: ActiveSession | null,
  now: Date,
): number {
  if (keys.length === 0) return 0
  const total = keys.reduce(
    (sum, key) => sum + calculateDayScore(key, calData, sessions, activeSession, now).score,
    0,
  )
  return Math.round(total / keys.length)
}

export function calculateWeekProgress(
  calData: CalendarData,
  sessions: WorkSession[],
  activeSession: ActiveSession | null = null,
  today: Date = new Date(),
): number {
  return averageScore(buildWeekKeys(today), calData, sessions, activeSession, today)
}

export function calculateMonthProgress(
  calData: CalendarData,
  sessions: WorkSession[],
  activeSession: ActiveSession | null = null,
  month: number,
  year: number = APP_YEAR,
  today: Date = new Date(),
): number {
  return averageScore(buildMonthKeys(month, year, today), calData, sessions, activeSession, today)
}

export function calculateYearProgress(
  calData: CalendarData,
  sessions: WorkSession[],
  activeSession: ActiveSession | null = null,
  year: number = APP_YEAR,
  today: Date = new Date(),
): number {
  return averageScore(buildYearKeys(year, today), calData, sessions, activeSession, today)
}

// ─── Streak calculations ──────────────────────────────────────────────────────

/** Current consecutive productive-day streak, walking backwards from today */
export function calculateCurrentStreak(
  calData: CalendarData,
  today: Date = new Date(),
): number {
  const d = new Date(today)
  d.setHours(0, 0, 0, 0)
  let streak = 0
  while (true) {
    const key = dateKey(d.getFullYear(), d.getMonth(), d.getDate())
    if (!isProdDay(calData[key])) break
    streak++
    d.setDate(d.getDate() - 1)
  }
  return streak
}

/** Longest consecutive productive-day run within a chronological key list */
export function calculateBestStreak(calData: CalendarData, keys: string[]): number {
  let best = 0, run = 0
  for (const key of keys) {
    if (isProdDay(calData[key])) {
      if (++run > best) best = run
    } else {
      run = 0
    }
  }
  return best
}

// ─── Total milliseconds from WorkSessions ─────────────────────────────────────

export function calculateTotalMs(
  sessions: WorkSession[],
  keySet: Set<string>,
  activeSession: ActiveSession | null = null,
  now: Date = new Date(),
  calData: CalendarData | null = null,
): number {
  const completed = sessions
    .filter(s => s.endTs !== null && keySet.has(s.dateKey))
    .reduce((sum, s) => sum + (s.endTs! - s.startTs), 0)
  const active =
    activeSession && keySet.has(activeSession.dateKey)
      ? Math.max(0, now.getTime() - activeSession.startTs)
      : 0
  let taskMs = 0
  if (calData) {
    for (const key of keySet) {
      const tasks = calData[key]?.tasks
      if (!tasks) continue
      for (const task of tasks) {
        for (const s of task.sessions) {
          if (s.endTs !== null) taskMs += s.endTs - s.startTs
        }
      }
    }
  }
  return completed + active + taskMs
}

// ─── Productive day counts ────────────────────────────────────────────────────

export function calculateProductiveDays(
  calData: CalendarData,
  keys: string[],
): { count: number; total: number } {
  let count = 0
  for (const key of keys) {
    if (isProdDay(calData[key])) count++
  }
  return { count, total: keys.length }
}

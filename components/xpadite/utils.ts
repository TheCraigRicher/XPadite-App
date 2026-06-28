import type { CalendarData } from './types'

export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const

export const DAY_HEADERS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const

export const COLOR_PALETTE = [
  '#7c3aed', '#16a34a', '#0891b2', '#d97706', '#dc2626',
  '#db2777', '#059669', '#ea580c', '#6366f1', '#0f172a',
] as const

export const APP_YEAR = new Date().getFullYear()

export function dateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function todayKey(): string {
  const d = new Date()
  return dateKey(d.getFullYear(), d.getMonth(), d.getDate())
}

export function isToday(year: number, month: number, day: number): boolean {
  const t = new Date()
  return t.getFullYear() === year && t.getMonth() === month && t.getDate() === day
}

export function formatMs(ms: number): string {
  if (!ms || ms < 0) return '0m'
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function formatHMS(ms: number): string {
  if (!ms || ms < 0) return '00:00:00'
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  const s = Math.floor((ms % 60_000) / 1_000)
  return [h, m, s].map(n => String(n).padStart(2, '0')).join(':')
}

export function getBestStreak(data: CalendarData): number {
  const keys = Object.keys(data).filter(k => data[k]?.productive).sort()
  if (!keys.length) return 0
  let best = 1
  let cur = 1
  for (let i = 1; i < keys.length; i++) {
    const diff = (new Date(keys[i]).getTime() - new Date(keys[i - 1]).getTime()) / 86_400_000
    if (diff === 1) {
      cur++
      best = Math.max(best, cur)
    } else {
      cur = 1
    }
  }
  return best
}

export function getStreakKeys(data: CalendarData): Set<string> {
  const keys = Object.keys(data).filter(k => data[k]?.productive).sort()
  const set = new Set<string>()
  let run: string[] = []
  for (let i = 0; i < keys.length; i++) {
    const prev = keys[i - 1]
    const curr = keys[i]
    if (prev) {
      const diff = (new Date(curr).getTime() - new Date(prev).getTime()) / 86_400_000
      if (diff === 1) {
        if (run.length === 0) run.push(prev)
        run.push(curr)
      } else {
        if (run.length >= 2) run.forEach(x => set.add(x))
        run = []
      }
    }
  }
  if (run.length >= 2) run.forEach(x => set.add(x))
  return set
}

export function getProductiveDaysForYear(data: CalendarData, year: number): number {
  return Object.keys(data).filter(k => k.startsWith(`${year}-`) && data[k]?.productive).length
}

export function getMonthStats(data: CalendarData, year: number, month: number) {
  const prefix = `${year}-${String(month + 1).padStart(2, '0')}-`
  const keys = Object.keys(data).filter(k => k.startsWith(prefix))
  const totalDays = new Date(year, month + 1, 0).getDate()
  const productiveDays = keys.filter(k => data[k]?.productive || data[k]?.hyper || data[k]?.milestone || data[k]?.goal).length
  const hyperDays = keys.filter(k => data[k]?.hyper).length
  const milestoneDays = keys.filter(k => data[k]?.milestone).length
  const goalDays = keys.filter(k => data[k]?.goal).length
  const completionRate = totalDays > 0 ? Math.round((productiveDays / totalDays) * 100) : 0
  const totalTasks = keys.reduce((s, k) => s + (data[k]?.tasks?.length ?? 0), 0)
  const completedTasks = keys.reduce((s, k) => s + (data[k]?.tasks?.filter(t => t.done).length ?? 0), 0)
  return { productiveDays, hyperDays, milestoneDays, goalDays, completionRate, totalTasks, completedTasks, totalDays }
}

export function getDayOfYear(): number {
  const now = new Date()
  const start = new Date(now.getFullYear(), 0, 0)
  return Math.floor((now.getTime() - start.getTime()) / 86_400_000)
}

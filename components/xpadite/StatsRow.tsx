'use client'

import { useMemo, useState, useEffect, useRef } from 'react'
import { useApp } from './AppContext'
import { dateKey, todayKey, APP_YEAR } from './utils'
import type { CalendarData, WorkSession } from './types'

type Scope = 'today' | 'week' | 'month' | 'year'

// ─── Odometer animated number ─────────────────────────────────────────────────

function useOdometer(target: number, duration = 550): number {
  const [cur, setCur] = useState(target)
  const prev = useRef(target)
  useEffect(() => {
    if (target === prev.current) return
    const from = prev.current
    prev.current = target
    const t0 = performance.now()
    let id: number
    function tick(now: number) {
      const pct = Math.min((now - t0) / duration, 1)
      const eased = 1 - Math.pow(1 - pct, 3)
      setCur(Math.round(from + (target - from) * eased))
      if (pct < 1) id = requestAnimationFrame(tick)
      else setCur(target)
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [target, duration])
  return cur
}

function AnimVal({ raw }: { raw: string }) {
  // Parse a leading number for odometer if string is "X / Y" or "X%" or "Xh Ym"
  const numMatch = raw.match(/^(\d+)(.*)$/)
  const num = numMatch ? parseInt(numMatch[1]) : null
  const suffix = numMatch ? numMatch[2] : raw
  const animated = useOdometer(num ?? 0)

  return (
    <span className="text-lg font-semibold" style={{ color: 'var(--xp-acc)', fontVariantNumeric: 'tabular-nums' }}>
      {num !== null ? `${animated}${suffix}` : raw}
    </span>
  )
}

// ─── Scope calculations ───────────────────────────────────────────────────────

function getCurrentStreak(calData: CalendarData): number {
  const today = new Date()
  let streak = 0
  const d = new Date(today)
  while (true) {
    const k = dateKey(d.getFullYear(), d.getMonth(), d.getDate())
    const day = calData[k]
    if (day?.productive || day?.hyper || day?.milestone || day?.goal) {
      streak++
      d.setDate(d.getDate() - 1)
    } else break
  }
  return streak
}

function getScopeStreak(calData: CalendarData, scope: Scope, today: Date): number {
  if (scope === 'today' || scope === 'week') return getCurrentStreak(calData)

  if (scope === 'month') {
    const m = today.getMonth()
    const y = today.getFullYear()
    let best = 0, cur = 0
    const daysInMonth = new Date(y, m + 1, 0).getDate()
    for (let d = 1; d <= daysInMonth; d++) {
      const k = dateKey(y, m, d)
      const day = calData[k]
      if (day?.productive || day?.hyper || day?.milestone || day?.goal) { cur++; best = Math.max(best, cur) }
      else cur = 0
    }
    return best
  }

  // year — best streak this year
  let best = 0, cur = 0
  const y = today.getFullYear()
  for (let m = 0; m < 12; m++) {
    const days = new Date(y, m + 1, 0).getDate()
    for (let d = 1; d <= days; d++) {
      const k = dateKey(y, m, d)
      const day = calData[k]
      if (day?.productive || day?.hyper || day?.milestone || day?.goal) { cur++; best = Math.max(best, cur) }
      else cur = 0
    }
  }
  return best
}

function getScopeMs(sessions: WorkSession[], keys: Set<string>): number {
  return sessions
    .filter(s => s.endTs !== null && keys.has(s.dateKey))
    .reduce((sum, s) => sum + (s.endTs! - s.startTs), 0)
}

function formatScopeHours(ms: number): string {
  if (!ms || ms < 0) return '0h'
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`
}

function computeStats(calData: CalendarData, sessions: WorkSession[], scope: Scope, today: Date) {
  const y = today.getFullYear()
  const m = today.getMonth()
  const tKey = todayKey()

  if (scope === 'today') {
    const day = calData[tKey]
    const isProductive = !!(day?.productive || day?.hyper || day?.milestone || day?.goal)
    const ms = getScopeMs(sessions, new Set([tKey]))
    return {
      productiveDays: `${isProductive ? 1 : 0} / 1`,
      streak: getCurrentStreak(calData),
      progress: `${isProductive ? 100 : 0}%`,
      hours: formatScopeHours(ms),
    }
  }

  if (scope === 'week') {
    const dow = today.getDay()
    const keys = new Set<string>()
    let productive = 0
    // Full 7-day week (Sun–Sat), denominator always 7
    for (let i = 0; i < 7; i++) {
      const d = new Date(today); d.setDate(today.getDate() - dow + i)
      const k = dateKey(d.getFullYear(), d.getMonth(), d.getDate())
      keys.add(k)
      const day = calData[k]
      if (day?.productive || day?.hyper || day?.milestone || day?.goal) productive++
    }
    const ms = getScopeMs(sessions, keys)
    return {
      productiveDays: `${productive} / 7`,
      streak: getCurrentStreak(calData),
      progress: `${Math.round((productive / 7) * 100)}%`,
      hours: formatScopeHours(ms),
    }
  }

  if (scope === 'month') {
    const daysInMonth = new Date(y, m + 1, 0).getDate()
    const keys = new Set<string>()
    let productive = 0
    for (let d = 1; d <= daysInMonth; d++) {
      const k = dateKey(y, m, d); keys.add(k)
      const day = calData[k]
      if (day?.productive || day?.hyper || day?.milestone || day?.goal) productive++
    }
    const ms = getScopeMs(sessions, keys)
    return {
      productiveDays: `${productive} / ${daysInMonth}`,
      streak: getScopeStreak(calData, 'month', today),
      progress: `${Math.round((productive / Math.max(daysInMonth, 1)) * 100)}%`,
      hours: formatScopeHours(ms),
    }
  }

  // year
  const start = new Date(y, 0, 1)
  const elapsed = Math.floor((today.getTime() - start.getTime()) / 86_400_000) + 1
  const keys = new Set<string>()
  let productive = 0
  for (let mo = 0; mo < 12; mo++) {
    const days = new Date(y, mo + 1, 0).getDate()
    for (let d = 1; d <= days; d++) {
      const k = dateKey(y, mo, d); keys.add(k)
      const day = calData[k]
      if (day?.productive || day?.hyper || day?.milestone || day?.goal) productive++
    }
  }
  const ms = getScopeMs(sessions, keys)
  return {
    productiveDays: `${productive} / ${elapsed}`,
    streak: getScopeStreak(calData, 'year', today),
    progress: `${Math.round((productive / Math.max(elapsed, 1)) * 100)}%`,
    hours: formatScopeHours(ms),
  }
}

// ─── StatsRow ─────────────────────────────────────────────────────────────────

const SCOPES: { key: Scope; label: string; color: string }[] = [
  { key: 'today', label: 'Today', color: '#f59e0b' },
  { key: 'week',  label: 'Week',  color: '#22c55e' },
  { key: 'month', label: 'Month', color: '#06b6d4' },
  { key: 'year',  label: 'Year',  color: '#7c3aed' },
]

export function StatsRow() {
  const { calData, sessions } = useApp()
  const [scope, setScope] = useState<Scope>('today')
  const [hoveredScope, setHoveredScope] = useState<Scope | null>(null)
  const today = useMemo(() => new Date(), [])

  const stats = useMemo(
    () => computeStats(calData, sessions, scope, today),
    [calData, sessions, scope, today]
  )

  void APP_YEAR

  const items = [
    { raw: stats.productiveDays, label: 'Productive days' },
    { raw: String(stats.streak),  label: 'Current streak'  },
    { raw: stats.progress,        label: 'Progress'        },
    { raw: stats.hours,           label: 'Total hours'     },
  ]

  return (
    <div>
      {/* Scope selector */}
      <div className="flex items-center justify-center gap-1.5 pt-2 pb-0.5">
        {SCOPES.map(s => {
          const selected = scope === s.key
          const hovered = hoveredScope === s.key && !selected
          return (
            <button
              key={s.key}
              onClick={() => setScope(s.key)}
              onMouseEnter={() => setHoveredScope(s.key)}
              onMouseLeave={() => setHoveredScope(null)}
              className="px-3 py-1 rounded-full text-[10px] font-semibold"
              style={{
                background: selected
                  ? s.color
                  : hovered
                  ? s.color + '22'
                  : 'var(--xp-bg3)',
                color: selected ? '#ffffff' : hovered ? s.color : 'var(--xp-txt3)',
                border: `0.5px solid ${selected ? 'transparent' : hovered ? s.color + '80' : 'var(--xp-bdr)'}`,
                transition: 'background 0.18s ease, color 0.18s ease, border-color 0.18s ease',
              }}
            >
              {s.label}
            </button>
          )
        })}
      </div>

      {/* Stat cards */}
      <div className="flex justify-center gap-3 px-4 py-2.5 flex-wrap">
        {items.map(item => (
          <div
            key={item.label}
            className="text-center px-3.5 py-2 rounded-xl min-w-[90px]"
            style={{ background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr)' }}
          >
            <AnimVal raw={item.raw} />
            <div className="text-[10px] mt-0.5" style={{ color: 'var(--xp-txt3)' }}>
              {item.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

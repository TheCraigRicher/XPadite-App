'use client'

import { useMemo, useState, useEffect, useRef } from 'react'
import { useApp } from './AppContext'
import { dateKey, todayKey, MONTHS } from './utils'
import type { CalendarData, WorkSession } from './types'

type Scope     = 'today' | 'week' | 'month' | 'year'
type DataScope = 'current' | number  // number = month index 0–11

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

function AnimVal({ raw, accentColor }: { raw: string; accentColor?: string }) {
  const numMatch = raw.match(/^(\d+)(.*)$/)
  const num      = numMatch ? parseInt(numMatch[1]) : null
  const suffix   = numMatch ? numMatch[2] : raw
  const animated = useOdometer(num ?? 0)
  return (
    <span
      className="text-lg font-semibold"
      style={{ color: accentColor ?? 'var(--xp-acc)', fontVariantNumeric: 'tabular-nums', transition: 'color 180ms ease' }}
    >
      {num !== null ? `${animated}${suffix}` : raw}
    </span>
  )
}

const STAT_ACCENTS = [
  { hex: '#f59e0b', rgb: '245,158,11'  },
  { hex: '#22c55e', rgb: '34,197,94'   },
  { hex: '#06b6d4', rgb: '6,182,212'   },
  { hex: '#7c3aed', rgb: '124,58,237'  },
]

const SCOPES: { key: Scope; label: string; color: string }[] = [
  { key: 'today', label: 'Today', color: '#f59e0b' },
  { key: 'week',  label: 'Week',  color: '#22c55e' },
  { key: 'month', label: 'Month', color: '#06b6d4' },
  { key: 'year',  label: 'Year',  color: '#7c3aed' },
]

// ─── Streak formatter ─────────────────────────────────────────────────────────

function formatStreak(days: number): string {
  if (days <= 0) return '0 days'
  if (days === 1) return '1 day'
  if (days < 7)  return `${days} days`
  if (days < 28) {
    const weeks = Math.floor(days / 7)
    const rem   = days % 7
    const w     = weeks === 1 ? '1 week' : `${weeks} weeks`
    return rem === 0 ? w : `${w} ${rem} ${rem === 1 ? 'day' : 'days'}`
  }
  const months = Math.max(1, Math.round(days / 30))
  return months === 1 ? '1 month' : `${months} months`
}

// ─── Stats helpers ────────────────────────────────────────────────────────────

function isProdDay(day: CalendarData[string] | undefined): boolean {
  return !!(day?.productive || day?.hyper || day?.milestone || day?.goal)
}

function monthKeysList(year: number, mIdx: number): string[] {
  const days = new Date(year, mIdx + 1, 0).getDate()
  return Array.from({ length: days }, (_, i) => dateKey(year, mIdx, i + 1))
}

function getCurrentStreak(calData: CalendarData): number {
  const d = new Date()
  let streak = 0
  while (true) {
    const k = dateKey(d.getFullYear(), d.getMonth(), d.getDate())
    if (isProdDay(calData[k])) { streak++; d.setDate(d.getDate() - 1) }
    else break
  }
  return streak
}

function bestStreakInKeys(calData: CalendarData, keys: string[]): number {
  let best = 0, cur = 0
  for (const k of keys) {
    if (isProdDay(calData[k])) { cur++; best = Math.max(best, cur) } else cur = 0
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

// ─── computeStats ─────────────────────────────────────────────────────────────

interface StatsResult {
  productiveDays: string
  streak:         number
  progress:       string
  hours:          string
  isLiveStreak:   boolean
}

const ZERO_RESULT: StatsResult = {
  productiveDays: '0 / 0',
  streak:         0,
  progress:       '0%',
  hours:          '0h',
  isLiveStreak:   false,
}

function computeStats(
  calData:   CalendarData,
  sessions:  WorkSession[],
  scope:     Scope,
  dataScope: DataScope,
  today:     Date,
): StatsResult {
  const y               = today.getFullYear()
  const currentMonthIdx = today.getMonth()
  const tKey            = todayKey()

  // ── Specific month selected ────────────────────────────────────────────────
  // All scopes defer to the selected month for data; scope only affects framing.
  if (typeof dataScope === 'number') {
    const mIdx      = dataScope
    const isCurrent = mIdx === currentMonthIdx

    // Today + different month → no overlap, show zeros
    if (scope === 'today' && !isCurrent) return ZERO_RESULT

    // Today + current month → today's stats
    if (scope === 'today' && isCurrent) {
      const prod = isProdDay(calData[tKey])
      return {
        productiveDays: `${prod ? 1 : 0} / 1`,
        streak:         getCurrentStreak(calData),
        progress:       `${prod ? 100 : 0}%`,
        hours:          formatScopeHours(getScopeMs(sessions, new Set([tKey]))),
        isLiveStreak:   true,
      }
    }

    // Week / Month / Year + specific month → full month stats
    const keys     = monthKeysList(y, mIdx)
    const keySet   = new Set(keys)
    let productive = 0
    for (const k of keys) { if (isProdDay(calData[k])) productive++ }
    return {
      productiveDays: `${productive} / ${keys.length}`,
      streak:         isCurrent ? getCurrentStreak(calData) : bestStreakInKeys(calData, keys),
      progress:       `${Math.round((productive / keys.length) * 100)}%`,
      hours:          formatScopeHours(getScopeMs(sessions, keySet)),
      isLiveStreak:   isCurrent,
    }
  }

  // ── dataScope === 'current' ────────────────────────────────────────────────

  // Today / current
  if (scope === 'today') {
    const prod = isProdDay(calData[tKey])
    return {
      productiveDays: `${prod ? 1 : 0} / 1`,
      streak:         getCurrentStreak(calData),
      progress:       `${prod ? 100 : 0}%`,
      hours:          formatScopeHours(getScopeMs(sessions, new Set([tKey]))),
      isLiveStreak:   true,
    }
  }

  // Week / current — productive days vs full 7-day week; progress vs elapsed days
  if (scope === 'week') {
    const dow      = today.getDay()
    const weekKeys: string[] = []
    let weekProd   = 0
    for (let i = 0; i < 7; i++) {
      const d = new Date(today); d.setDate(today.getDate() - dow + i)
      const k = dateKey(d.getFullYear(), d.getMonth(), d.getDate())
      weekKeys.push(k)
      if (isProdDay(calData[k])) weekProd++
    }
    const elapsedInWeek = dow + 1  // Sunday = 1, Saturday = 7
    return {
      productiveDays: `${weekProd} / 7`,
      streak:         getCurrentStreak(calData),
      progress:       `${Math.round((weekProd / elapsedInWeek) * 100)}%`,
      hours:          formatScopeHours(getScopeMs(sessions, new Set(weekKeys))),
      isLiveStreak:   true,
    }
  }

  // Month / current — progress vs elapsed days in month (never count future)
  if (scope === 'month') {
    const keys  = monthKeysList(y, currentMonthIdx)
    let prod    = 0
    for (const k of keys) { if (isProdDay(calData[k])) prod++ }
    const elapsed = today.getDate()
    return {
      productiveDays: `${prod} / ${elapsed}`,
      streak:         getCurrentStreak(calData),
      progress:       `${Math.round((prod / elapsed) * 100)}%`,
      hours:          formatScopeHours(getScopeMs(sessions, new Set(keys))),
      isLiveStreak:   true,
    }
  }

  // Year / current — year-to-date through today
  const yearStart = new Date(y, 0, 1)
  const elapsed   = Math.floor((today.getTime() - yearStart.getTime()) / 86_400_000) + 1
  const allKeys: string[] = []
  let prod = 0
  for (let mo = 0; mo <= currentMonthIdx; mo++) {
    for (const k of monthKeysList(y, mo)) { allKeys.push(k); if (isProdDay(calData[k])) prod++ }
  }
  return {
    productiveDays: `${prod} / ${elapsed}`,
    streak:         getCurrentStreak(calData),
    progress:       `${Math.round((prod / elapsed) * 100)}%`,
    hours:          formatScopeHours(getScopeMs(sessions, new Set(allKeys))),
    isLiveStreak:   true,
  }
}

// ─── DataScopeDropdown ────────────────────────────────────────────────────────

const ChevronDown = () => (
  <svg viewBox="0 0 16 16" fill="none" width="9" height="9" aria-hidden="true" style={{ flexShrink: 0 }}>
    <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

const CheckMark = () => (
  <svg viewBox="0 0 16 16" fill="none" width="10" height="10" aria-hidden="true" style={{ flexShrink: 0 }}>
    <path d="M3 8l4 4 6-6" stroke="#7c3aed" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

interface DropdownProps {
  value:    DataScope
  onChange: (v: DataScope) => void
}

function DataScopeDropdown({ value, onChange }: DropdownProps) {
  const [open, setOpen]     = useState(false)
  const [hovKey, setHovKey] = useState<string | null>(null)
  const containerRef        = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown',   onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown',   onKey)
    }
  }, [open])

  function getButtonLabel(): string {
    if (value === 'current') return 'Current'
    return (MONTHS[value as number] as string).slice(0, 3)
  }

  type Option = { label: string; key: string; value: DataScope }

  const options: Option[] = [
    { label: 'Current', key: 'current', value: 'current' },
    ...Array.from({ length: 12 }, (_, i) => ({ label: MONTHS[i], key: String(i), value: i as DataScope })),
  ]

  const isFiltered = value !== 'current'

  function renderOption(opt: Option) {
    const isSelected = opt.value === value
    const isHov      = hovKey === opt.key
    return (
      <button
        key={opt.key}
        onClick={() => { onChange(opt.value); setOpen(false) }}
        onMouseEnter={() => setHovKey(opt.key)}
        onMouseLeave={() => setHovKey(null)}
        className="w-full text-left px-3 py-1.5 text-[10px] flex items-center justify-between"
        style={{
          color:      isSelected ? '#7c3aed' : 'var(--xp-txt)',
          background: isSelected ? 'rgba(124,58,237,0.08)' : isHov ? 'rgba(124,58,237,0.05)' : 'transparent',
          fontWeight: isSelected ? 600 : 400,
          transition: 'background 0.1s ease',
          cursor:     'pointer',
        }}
      >
        {opt.label}
        {isSelected && <CheckMark />}
      </button>
    )
  }

  const [currentOpt, ...monthOpts] = options

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold"
        style={{
          background: isFiltered ? '#7c3aed' : 'var(--xp-bg3)',
          color:      isFiltered ? 'white'   : 'var(--xp-txt3)',
          border:     isFiltered ? '0.5px solid transparent' : '0.5px solid var(--xp-bdr)',
          boxShadow:  isFiltered ? '0 1px 4px rgba(124,58,237,0.3)' : 'none',
          transition: 'all 0.18s ease',
        }}
      >
        {getButtonLabel()}
        <ChevronDown />
      </button>

      {open && (
        <div
          className="absolute top-full mt-1.5 right-0 rounded-xl z-50 overflow-hidden"
          style={{
            background: 'var(--xp-card)',
            border:     '0.5px solid var(--xp-bdr)',
            minWidth:   148,
            boxShadow:  '0 8px 32px rgba(0,0,0,0.16), 0 2px 8px rgba(0,0,0,0.10)',
          }}
        >
          {/* Current */}
          <div className="py-1">{renderOption(currentOpt)}</div>

          {/* Divider */}
          <div style={{ height: '0.5px', background: 'var(--xp-bdr)', margin: '0 8px' }} />

          {/* All 12 months — always enabled, none hidden */}
          <div className="py-1 overflow-y-auto" style={{ maxHeight: 216 }}>
            {monthOpts.map(renderOption)}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── StatsRow ─────────────────────────────────────────────────────────────────

export function StatsRow() {
  const { calData, sessions, isDark } = useApp()
  const [scope,        setScope]        = useState<Scope>('today')
  const [dataScope,    setDataScope]    = useState<DataScope>('current')
  const [hoveredScope, setHoveredScope] = useState<Scope | null>(null)
  const [hoveredStat,  setHoveredStat]  = useState<number | null>(null)
  const today           = useMemo(() => new Date(), [])

  const stats = useMemo(
    () => computeStats(calData, sessions, scope, dataScope, today),
    [calData, sessions, scope, dataScope, today],
  )

  const streakLabel = stats.isLiveStreak ? 'Current streak' : 'Best streak'

  const items = [
    { raw: stats.productiveDays,       label: 'Productive days' },
    { raw: formatStreak(stats.streak), label: streakLabel       },
    { raw: stats.progress,             label: 'Progress'        },
    { raw: stats.hours,                label: 'Total hours'     },
  ]

  return (
    <div>
      {/* Time scope pills */}
      <div className="flex items-center justify-center gap-1.5 pt-2 pb-0.5">
        {SCOPES.map(s => {
          const selected = scope === s.key
          const hovered  = hoveredScope === s.key && !selected
          return (
            <button
              key={s.key}
              onClick={() => setScope(s.key)}
              onMouseEnter={() => setHoveredScope(s.key)}
              onMouseLeave={() => setHoveredScope(null)}
              className="px-3 py-1 rounded-full text-[10px] font-semibold"
              style={{
                background: selected ? s.color : hovered ? s.color + '22' : 'var(--xp-bg3)',
                color:      selected ? '#ffffff' : hovered ? s.color : 'var(--xp-txt3)',
                border:     `0.5px solid ${selected ? 'transparent' : hovered ? s.color + '80' : 'var(--xp-bdr)'}`,
                transition: 'background 0.18s ease, color 0.18s ease, border-color 0.18s ease',
              }}
            >
              {s.label}
            </button>
          )
        })}
      </div>

      {/* Stat cards + data scope dropdown (always visible) */}
      <div className="flex items-center justify-center gap-3 px-4 py-2.5 flex-wrap">
        {items.map((item, idx) => {
          const ac          = STAT_ACCENTS[idx]
          const hovered     = hoveredStat === idx
          const bgAlpha     = isDark ? 0.12 : 0.08
          const bdrAlpha    = isDark ? 0.38 : 0.25
          const shadowAlpha = isDark ? 0.20 : 0.12
          return (
            <div
              key={item.label}
              className="text-center px-3.5 py-2 rounded-xl min-w-[90px]"
              style={{
                background: hovered ? `rgba(${ac.rgb},${bgAlpha})` : 'var(--xp-bg3)',
                border:     `0.5px solid ${hovered ? `rgba(${ac.rgb},${bdrAlpha})` : 'var(--xp-bdr)'}`,
                boxShadow:  hovered ? `0 4px 16px rgba(${ac.rgb},${shadowAlpha})` : 'none',
                transition: 'background 200ms ease, border-color 200ms ease, box-shadow 200ms ease',
              }}
              onMouseEnter={() => setHoveredStat(idx)}
              onMouseLeave={() => setHoveredStat(null)}
            >
              <AnimVal raw={item.raw} accentColor={hovered ? ac.hex : undefined} />
              <div className="text-[10px] mt-0.5" style={{ color: 'var(--xp-txt3)' }}>
                {item.label}
              </div>
            </div>
          )
        })}

        {/* Data scope selector — always visible */}
        <div className="self-center ml-1">
          <DataScopeDropdown value={dataScope} onChange={setDataScope} />
        </div>
      </div>
    </div>
  )
}

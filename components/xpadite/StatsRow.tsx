'use client'

import { useMemo, useState, useEffect, useRef } from 'react'
import { useApp } from './AppContext'
import { dateKey, MONTHS } from './utils'
import type { CalendarData, WorkSession, ActiveSession } from './types'
import {
  calculateDayScore,
  calculateWeekProgress,
  calculateMonthProgress,
  calculateYearProgress,
  calculateCurrentStreak,
  calculateBestStreak,
  calculateTotalMs,
  calculateProductiveDays,
  isProdDay,
  buildWeekKeys,
  buildMonthKeys,
  buildYearKeys,
} from './productivityEngine'

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

// ─── Hours formatter ──────────────────────────────────────────────────────────

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
  calData:       CalendarData,
  sessions:      WorkSession[],
  activeSession: ActiveSession | null,
  scope:         Scope,
  dataScope:     DataScope,
  today:         Date,
): StatsResult {
  const y               = today.getFullYear()
  const currentMonthIdx = today.getMonth()
  const tKey            = dateKey(y, currentMonthIdx, today.getDate())

  // ── Specific month selected ────────────────────────────────────────────────
  if (typeof dataScope === 'number') {
    const mIdx      = dataScope
    const isCurrent = mIdx === currentMonthIdx

    // Today + different month → no overlap
    if (scope === 'today' && !isCurrent) return ZERO_RESULT

    // Today + current month → today's score
    if (scope === 'today' && isCurrent) {
      const { score } = calculateDayScore(tKey, calData, sessions, activeSession, today)
      const prod = isProdDay(calData[tKey])
      return {
        productiveDays: `${prod ? 1 : 0} / 1`,
        streak:         calculateCurrentStreak(calData, today),
        progress:       `${score}%`,
        hours:          formatScopeHours(calculateTotalMs(sessions, new Set([tKey]), activeSession, today)),
        isLiveStreak:   true,
      }
    }

    // Week / Month / Year + specific month → that month's full stats
    const keys      = buildMonthKeys(mIdx, y, today)
    const keySet    = new Set(keys)
    const { count } = calculateProductiveDays(calData, keys)
    const progress  = calculateMonthProgress(calData, sessions, isCurrent ? activeSession : null, mIdx, y, today)
    const streak    = isCurrent
      ? calculateCurrentStreak(calData, today)
      : calculateBestStreak(calData, keys)
    const ms = calculateTotalMs(sessions, keySet, isCurrent ? activeSession : null, today)
    return {
      productiveDays: `${count} / ${keys.length}`,
      streak,
      progress:       `${progress}%`,
      hours:          formatScopeHours(ms),
      isLiveStreak:   isCurrent,
    }
  }

  // ── dataScope === 'current' ────────────────────────────────────────────────

  if (scope === 'today') {
    const { score } = calculateDayScore(tKey, calData, sessions, activeSession, today)
    const prod = isProdDay(calData[tKey])
    const ms   = calculateTotalMs(sessions, new Set([tKey]), activeSession, today)
    return {
      productiveDays: `${prod ? 1 : 0} / 1`,
      streak:         calculateCurrentStreak(calData, today),
      progress:       `${score}%`,
      hours:          formatScopeHours(ms),
      isLiveStreak:   true,
    }
  }

  if (scope === 'week') {
    const keys      = buildWeekKeys(today)
    const keySet    = new Set(keys)
    const { count } = calculateProductiveDays(calData, keys)
    const progress  = calculateWeekProgress(calData, sessions, activeSession, today)
    const ms        = calculateTotalMs(sessions, keySet, activeSession, today)
    return {
      productiveDays: `${count} / ${keys.length}`,
      streak:         calculateCurrentStreak(calData, today),
      progress:       `${progress}%`,
      hours:          formatScopeHours(ms),
      isLiveStreak:   true,
    }
  }

  if (scope === 'month') {
    const keys      = buildMonthKeys(currentMonthIdx, y, today)
    const keySet    = new Set(keys)
    const { count } = calculateProductiveDays(calData, keys)
    const progress  = calculateMonthProgress(calData, sessions, activeSession, currentMonthIdx, y, today)
    const ms        = calculateTotalMs(sessions, keySet, activeSession, today)
    return {
      productiveDays: `${count} / ${keys.length}`,
      streak:         calculateCurrentStreak(calData, today),
      progress:       `${progress}%`,
      hours:          formatScopeHours(ms),
      isLiveStreak:   true,
    }
  }

  // Year — best streak (not live current streak)
  const keys      = buildYearKeys(y, today)
  const keySet    = new Set(keys)
  const { count } = calculateProductiveDays(calData, keys)
  const progress  = calculateYearProgress(calData, sessions, activeSession, y, today)
  const ms        = calculateTotalMs(sessions, keySet, activeSession, today)
  return {
    productiveDays: `${count} / ${keys.length}`,
    streak:         calculateBestStreak(calData, keys),
    progress:       `${progress}%`,
    hours:          formatScopeHours(ms),
    isLiveStreak:   false,
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
  const { calData, sessions, isDark, activeSession } = useApp()
  const [scope,        setScope]        = useState<Scope>('today')
  const [dataScope,    setDataScope]    = useState<DataScope>('current')
  const [hoveredScope, setHoveredScope] = useState<Scope | null>(null)
  const [hoveredStat,  setHoveredStat]  = useState<number | null>(null)
  const today           = useMemo(() => new Date(), [])

  const stats = useMemo(
    () => computeStats(calData, sessions, activeSession, scope, dataScope, today),
    [calData, sessions, activeSession, scope, dataScope, today],
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
      {/* Time scope pills + activity capsule */}
      <div className="flex items-center justify-center gap-1.5 pt-2 pb-0.5 flex-wrap">
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

        {/* Data scope selector — grouped with time scope pills */}
        <DataScopeDropdown value={dataScope} onChange={setDataScope} />
      </div>

      {/* Stat cards */}
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
      </div>
    </div>
  )
}

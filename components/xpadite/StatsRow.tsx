'use client'

import { useMemo, useState, useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { useApp } from './AppContext'
import { dateKey, MONTHS } from './utils'
import type { CalendarData, WorkSession, ActiveSession } from './types'
import {
  calculateDayScore,
  calculateMonthProgress,
  calculateYearProgress,
  calculateCurrentStreak,
  calculateBestStreak,
  calculateTotalMs,
  calculateProductiveDays,
  isProdDay,
  buildMonthKeys,
  buildYearKeys,
} from './productivityEngine'

// ─── Types ────────────────────────────────────────────────────────────────────

type ActiveScope = 'today' | 'week' | 'month' | 'year'

interface WeekDef { start: number; end: number }

interface FilterState {
  activeScope: ActiveScope
  year:        number
  month:       number   // 0–11
  weekIdx:     number   // 1-based index from getMonthWeeks
  day:         number   // 1-based day of month
}

// ─── Week utilities ────────────────────────────────────────────────────────────

// Splits month into Sun→Sat blocks clipped to month boundaries
function getMonthWeeks(year: number, month: number): WeekDef[] {
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const weeks: WeekDef[] = []
  let d = 1
  while (d <= daysInMonth) {
    const dow   = new Date(year, month, d).getDay() // 0=Sun … 6=Sat
    const toSat = (6 - dow + 7) % 7
    const end   = Math.min(d + toSat, daysInMonth)
    weeks.push({ start: d, end })
    d = end + 1
  }
  return weeks
}

function weekIdxForDay(year: number, month: number, day: number): number {
  const weeks = getMonthWeeks(year, month)
  const idx   = weeks.findIndex(w => day >= w.start && day <= w.end)
  return idx >= 0 ? idx + 1 : 1
}

// ─── Future-date guards ────────────────────────────────────────────────────────

function isFutureDay(y: number, m: number, d: number, today: Date): boolean {
  return new Date(y, m, d) > new Date(today.getFullYear(), today.getMonth(), today.getDate())
}

function isFutureMonth(y: number, m: number, today: Date): boolean {
  return y > today.getFullYear() || (y === today.getFullYear() && m > today.getMonth())
}

// ─── Pill label helpers ────────────────────────────────────────────────────────

function todayPillLabel(y: number, m: number, d: number, today: Date): string {
  if (y === today.getFullYear() && m === today.getMonth() && d === today.getDate()) return 'Today'
  const yest = new Date(today); yest.setDate(today.getDate() - 1)
  if (y === yest.getFullYear() && m === yest.getMonth() && d === yest.getDate()) return 'Yesterday'
  return `${MONTHS[m].slice(0, 3)} ${d}`
}

function weekPillLabel(y: number, m: number, wIdx: number, today: Date): string {
  const weeks = getMonthWeeks(y, m)
  const week  = weeks[wIdx - 1]
  if (!week) return 'Week'
  const curWIdx = weekIdxForDay(today.getFullYear(), today.getMonth(), today.getDate())
  if (y === today.getFullYear() && m === today.getMonth() && wIdx === curWIdx) return 'This Week'
  return `${MONTHS[m].slice(0, 3)} ${week.start}–${week.end}`
}

function monthPillLabel(y: number, m: number, today: Date): string {
  if (y === today.getFullYear() && m === today.getMonth()) return 'This Month'
  return y === today.getFullYear() ? MONTHS[m] : `${MONTHS[m].slice(0, 3)} '${String(y).slice(2)}`
}

function yearPillLabel(y: number, today: Date): string {
  return y === today.getFullYear() ? 'This Year' : String(y)
}

// ─── averageScore (mirrors private function in productivityEngine) ─────────────

function localAvgScore(
  keys:          string[],
  calData:       CalendarData,
  sessions:      WorkSession[],
  activeSession: ActiveSession | null,
  now:           Date,
): number {
  if (keys.length === 0) return 0
  const total = keys.reduce(
    (sum, k) => sum + calculateDayScore(k, calData, sessions, activeSession, now).score,
    0,
  )
  return Math.round(total / keys.length)
}

// ─── StatsResult ──────────────────────────────────────────────────────────────

interface StatsResult {
  productiveDays: string
  streak:         number
  progress:       string
  hours:          string
  isLiveStreak:   boolean
}

const ZERO: StatsResult = {
  productiveDays: '0 / 0', streak: 0, progress: '0%', hours: '0h', isLiveStreak: false,
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function formatStreak(days: number): string {
  if (days <= 0) return '0 days'
  if (days === 1) return '1 day'
  if (days < 7)  return `${days} days`
  if (days < 28) {
    const w = Math.floor(days / 7), r = days % 7
    const ws = w === 1 ? '1 week' : `${w} weeks`
    return r === 0 ? ws : `${ws} ${r} ${r === 1 ? 'day' : 'days'}`
  }
  const mo = Math.max(1, Math.round(days / 30))
  return mo === 1 ? '1 month' : `${mo} months`
}

function formatMs(ms: number): string {
  if (!ms || ms < 0) return '0h'
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`
}

// ─── computeStats ─────────────────────────────────────────────────────────────

function computeStats(
  calData:       CalendarData,
  sessions:      WorkSession[],
  activeSession: ActiveSession | null,
  f:             FilterState,
  today:         Date,
): StatsResult {
  const { activeScope, year, month, weekIdx, day } = f
  const isToday = year === today.getFullYear() && month === today.getMonth() && day === today.getDate()

  if (activeScope === 'today') {
    const tKey   = dateKey(year, month, day)
    const { score } = calculateDayScore(tKey, calData, sessions, isToday ? activeSession : null, today)
    const prod   = isProdDay(calData[tKey])
    const ms     = calculateTotalMs(sessions, new Set([tKey]), isToday ? activeSession : null, today)
    return {
      productiveDays: `${prod ? 1 : 0} / 1`,
      streak:         isToday ? calculateCurrentStreak(calData, today) : (prod ? 1 : 0),
      progress:       `${score}%`,
      hours:          formatMs(ms),
      isLiveStreak:   isToday,
    }
  }

  if (activeScope === 'week') {
    const weeks = getMonthWeeks(year, month)
    const week  = weeks[weekIdx - 1]
    if (!week) return ZERO
    const isCurrentMonth = year === today.getFullYear() && month === today.getMonth()
    const endDay = isCurrentMonth ? Math.min(week.end, today.getDate()) : week.end
    if (endDay < week.start) return ZERO
    const keys   = Array.from({ length: endDay - week.start + 1 }, (_, i) => dateKey(year, month, week.start + i))
    const keySet = new Set(keys)
    const { count } = calculateProductiveDays(calData, keys)
    const isCurrentWeek = isCurrentMonth && week.start <= today.getDate() && today.getDate() <= week.end
    const progress = localAvgScore(keys, calData, sessions, isCurrentWeek ? activeSession : null, today)
    const ms = calculateTotalMs(sessions, keySet, isCurrentWeek ? activeSession : null, today)
    return {
      productiveDays: `${count} / ${keys.length}`,
      streak:         isCurrentWeek ? calculateCurrentStreak(calData, today) : calculateBestStreak(calData, keys),
      progress:       `${progress}%`,
      hours:          formatMs(ms),
      isLiveStreak:   isCurrentWeek,
    }
  }

  if (activeScope === 'month') {
    const keys   = buildMonthKeys(month, year, today)
    const keySet = new Set(keys)
    const { count } = calculateProductiveDays(calData, keys)
    const isCurrentMonth = year === today.getFullYear() && month === today.getMonth()
    const progress = calculateMonthProgress(calData, sessions, isCurrentMonth ? activeSession : null, month, year, today)
    const ms = calculateTotalMs(sessions, keySet, isCurrentMonth ? activeSession : null, today)
    return {
      productiveDays: `${count} / ${keys.length}`,
      streak:         isCurrentMonth ? calculateCurrentStreak(calData, today) : calculateBestStreak(calData, keys),
      progress:       `${progress}%`,
      hours:          formatMs(ms),
      isLiveStreak:   isCurrentMonth,
    }
  }

  // Year
  const keys   = buildYearKeys(year, today)
  const keySet = new Set(keys)
  const { count } = calculateProductiveDays(calData, keys)
  const isCurrentYear = year === today.getFullYear()
  const progress = calculateYearProgress(calData, sessions, isCurrentYear ? activeSession : null, year, today)
  const ms = calculateTotalMs(sessions, keySet, isCurrentYear ? activeSession : null, today)
  return {
    productiveDays: `${count} / ${keys.length}`,
    streak:         calculateBestStreak(calData, keys),
    progress:       `${progress}%`,
    hours:          formatMs(ms),
    isLiveStreak:   false,
  }
}

// ─── Odometer animated number ────────────────────────────────────────────────

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
      const pct   = Math.min((now - t0) / duration, 1)
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

// ─── STAT_ACCENTS ─────────────────────────────────────────────────────────────

const STAT_ACCENTS = [
  { hex: '#f59e0b', rgb: '245,158,11'  },
  { hex: '#22c55e', rgb: '34,197,94'   },
  { hex: '#06b6d4', rgb: '6,182,212'   },
  { hex: '#7c3aed', rgb: '124,58,237'  },
]

// ─── SVG icons ────────────────────────────────────────────────────────────────

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16" fill="none" width="9" height="9" aria-hidden="true"
      style={{
        flexShrink: 0,
        transition: 'transform 150ms ease',
        transform: open ? 'rotate(180deg)' : 'none',
      }}
    >
      <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" width="10" height="10" style={{ flexShrink: 0 }}>
      <path d="M3 8l4 4 6-6" stroke="#7c3aed" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

// ─── DropdownOption ────────────────────────────────────────────────────────────

function DropdownOption({
  label, selected, disabled, onClick,
}: { label: string; selected: boolean; disabled?: boolean; onClick: () => void }) {
  const [hov, setHov] = useState(false)
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      className="w-full text-left px-3 py-1.5 text-[10px] flex items-center justify-between"
      style={{
        color:      selected ? '#7c3aed' : disabled ? 'var(--xp-txt3)' : 'var(--xp-txt)',
        background: selected
          ? 'rgba(124,58,237,0.08)'
          : hov && !disabled
            ? 'rgba(124,58,237,0.05)'
            : 'transparent',
        fontWeight: selected ? 600 : 400,
        opacity:    disabled ? 0.35 : 1,
        cursor:     disabled ? 'default' : 'pointer',
        transition: 'background 0.1s ease',
      }}
    >
      {label}
      {selected && <CheckIcon />}
    </button>
  )
}

// ─── ScopePill ────────────────────────────────────────────────────────────────

interface ScopePillProps {
  label:        string
  color:        string
  isActive:     boolean
  open:         boolean
  onToggle:     () => void
  containerRef: RefObject<HTMLDivElement | null>
  children:     React.ReactNode
}

function ScopePill({ label, color, isActive, open, onToggle, containerRef, children }: ScopePillProps) {
  const [hov, setHov] = useState(false)
  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={onToggle}
        onMouseEnter={() => setHov(true)}
        onMouseLeave={() => setHov(false)}
        className="flex items-center gap-1 px-3 py-1 rounded-full text-[10px] font-semibold"
        style={{
          background: isActive ? color : hov ? `${color}22` : 'var(--xp-bg3)',
          color:      isActive ? '#ffffff' : hov ? color : 'var(--xp-txt3)',
          border:     `0.5px solid ${isActive ? 'transparent' : hov ? `${color}80` : 'var(--xp-bdr)'}`,
          transition: 'background 0.18s ease, color 0.18s ease, border-color 0.18s ease',
        }}
      >
        {label}
        <ChevronIcon open={open} />
      </button>

      {open && (
        <div
          className="absolute top-full mt-1.5 z-50 rounded-xl overflow-hidden py-1"
          style={{
            left:       '50%',
            transform:  'translateX(-50%)',
            background: 'var(--xp-card)',
            border:     '0.5px solid var(--xp-bdr)',
            minWidth:   172,
            boxShadow:  '0 8px 32px rgba(0,0,0,0.16), 0 2px 8px rgba(0,0,0,0.10)',
          }}
        >
          {children}
        </div>
      )}
    </div>
  )
}

// ─── StatsRow ─────────────────────────────────────────────────────────────────

export function StatsRow() {
  const { calData, sessions, isDark, activeSession } = useApp()
  const today = useMemo(() => new Date(), [])

  const defaultFilter = useMemo((): FilterState => ({
    activeScope: 'today',
    year:        today.getFullYear(),
    month:       today.getMonth(),
    weekIdx:     weekIdxForDay(today.getFullYear(), today.getMonth(), today.getDate()),
    day:         today.getDate(),
  }), [today])

  const [filter,      setFilter]      = useState<FilterState>(defaultFilter)
  const [openScope,   setOpenScope]   = useState<ActiveScope | null>(null)
  const [hoveredStat, setHoveredStat] = useState<number | null>(null)

  const todayRef = useRef<HTMLDivElement>(null)
  const weekRef  = useRef<HTMLDivElement>(null)
  const monthRef = useRef<HTMLDivElement>(null)
  const yearRef  = useRef<HTMLDivElement>(null)

  // Close dropdown on outside click or Escape
  useEffect(() => {
    if (!openScope) return
    function onDown(e: MouseEvent) {
      const refs = [todayRef, weekRef, monthRef, yearRef]
      if (!refs.some(r => r.current?.contains(e.target as Node))) setOpenScope(null)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpenScope(null) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown',   onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown',   onKey)
    }
  }, [openScope])

  function togglePill(scope: ActiveScope) {
    setFilter(f => ({ ...f, activeScope: scope }))
    setOpenScope(prev => prev === scope ? null : scope)
  }

  // ── Hierarchical selection ────────────────────────────────────────────────

  function selectDay(y: number, m: number, d: number) {
    setFilter({ activeScope: 'today', year: y, month: m, weekIdx: weekIdxForDay(y, m, d), day: d })
    setOpenScope(null)
  }

  function selectWeek(y: number, m: number, wIdx: number) {
    const week = getMonthWeeks(y, m)[wIdx - 1]
    setFilter({ activeScope: 'week', year: y, month: m, weekIdx: wIdx, day: week?.start ?? 1 })
    setOpenScope(null)
  }

  function selectMonth(y: number, m: number) {
    const isNow = y === today.getFullYear() && m === today.getMonth()
    const d     = isNow ? today.getDate() : 1
    setFilter({ activeScope: 'month', year: y, month: m, weekIdx: weekIdxForDay(y, m, d), day: d })
    setOpenScope(null)
  }

  function selectYear(y: number) {
    const isNow = y === today.getFullYear()
    const m     = isNow ? today.getMonth() : 0
    const d     = isNow ? today.getDate() : 1
    setFilter({ activeScope: 'year', year: y, month: m, weekIdx: weekIdxForDay(y, m, d), day: d })
    setOpenScope(null)
  }

  // ── Stats ─────────────────────────────────────────────────────────────────

  const stats = useMemo(
    () => computeStats(calData, sessions, activeSession, filter, today),
    [calData, sessions, activeSession, filter, today],
  )

  const streakLabel = stats.isLiveStreak ? 'Current streak' : 'Best streak'
  const items = [
    { raw: stats.productiveDays,       label: 'Productive days' },
    { raw: formatStreak(stats.streak), label: streakLabel       },
    { raw: stats.progress,             label: 'Progress'        },
    { raw: stats.hours,                label: 'Total hours'     },
  ]

  const { year, month, weekIdx, day } = filter

  // ── Dropdown content ──────────────────────────────────────────────────────

  function renderTodayDropdown() {
    const weeks = getMonthWeeks(year, month)
    const week  = weeks[weekIdx - 1] ?? weeks[0]
    if (!week) return null
    const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
    return (
      <div className="overflow-y-auto" style={{ maxHeight: 200 }}>
        {Array.from({ length: week.end - week.start + 1 }, (_, i) => {
          const d      = week.start + i
          const isFut  = isFutureDay(year, month, d, today)
          const dowStr = DOW[new Date(year, month, d).getDay()]
          const isT    = year === today.getFullYear() && month === today.getMonth() && d === today.getDate()
          const yest   = new Date(today); yest.setDate(today.getDate() - 1)
          const isY    = year === yest.getFullYear() && month === yest.getMonth() && d === yest.getDate()
          const label  = isT
            ? `Today (${dowStr} ${d})`
            : isY
              ? `Yesterday (${dowStr} ${d})`
              : `${dowStr}, ${MONTHS[month].slice(0, 3)} ${d}`
          return (
            <DropdownOption
              key={d}
              label={label}
              selected={day === d}
              disabled={isFut}
              onClick={() => selectDay(year, month, d)}
            />
          )
        })}
      </div>
    )
  }

  function renderWeekDropdown() {
    const weeks = getMonthWeeks(year, month)
    return (
      <div>
        {weeks.map((w, i) => {
          const wIdx1    = i + 1
          const isFut    = isFutureDay(year, month, w.start, today)
          const label    = `Week ${wIdx1}: ${MONTHS[month].slice(0, 3)} ${w.start}–${w.end}`
          return (
            <DropdownOption
              key={wIdx1}
              label={label}
              selected={weekIdx === wIdx1}
              disabled={isFut}
              onClick={() => selectWeek(year, month, wIdx1)}
            />
          )
        })}
      </div>
    )
  }

  function renderMonthDropdown() {
    return (
      <div className="overflow-y-auto" style={{ maxHeight: 220 }}>
        {MONTHS.map((name, m) => (
          <DropdownOption
            key={m}
            label={name}
            selected={month === m}
            disabled={isFutureMonth(year, m, today)}
            onClick={() => selectMonth(year, m)}
          />
        ))}
      </div>
    )
  }

  function renderYearDropdown() {
    const curY = today.getFullYear()
    return (
      <div>
        {Array.from({ length: 5 }, (_, i) => curY - i).map(y => (
          <DropdownOption
            key={y}
            label={y === curY ? `${y} (This Year)` : String(y)}
            selected={year === y}
            disabled={false}
            onClick={() => selectYear(y)}
          />
        ))}
      </div>
    )
  }

  const scopeColor = { today: '#f59e0b', week: '#22c55e', month: '#06b6d4', year: '#7c3aed' } as const

  return (
    <div>
      {/* Pill row */}
      <div className="flex items-center justify-center gap-1.5 pt-2 pb-0.5 flex-wrap">
        <ScopePill
          label={todayPillLabel(year, month, day, today)}
          color={scopeColor.today}
          isActive={filter.activeScope === 'today'}
          open={openScope === 'today'}
          onToggle={() => togglePill('today')}
          containerRef={todayRef}
        >
          {renderTodayDropdown()}
        </ScopePill>

        <ScopePill
          label={weekPillLabel(year, month, weekIdx, today)}
          color={scopeColor.week}
          isActive={filter.activeScope === 'week'}
          open={openScope === 'week'}
          onToggle={() => togglePill('week')}
          containerRef={weekRef}
        >
          {renderWeekDropdown()}
        </ScopePill>

        <ScopePill
          label={monthPillLabel(year, month, today)}
          color={scopeColor.month}
          isActive={filter.activeScope === 'month'}
          open={openScope === 'month'}
          onToggle={() => togglePill('month')}
          containerRef={monthRef}
        >
          {renderMonthDropdown()}
        </ScopePill>

        <ScopePill
          label={yearPillLabel(year, today)}
          color={scopeColor.year}
          isActive={filter.activeScope === 'year'}
          open={openScope === 'year'}
          onToggle={() => togglePill('year')}
          containerRef={yearRef}
        >
          {renderYearDropdown()}
        </ScopePill>
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

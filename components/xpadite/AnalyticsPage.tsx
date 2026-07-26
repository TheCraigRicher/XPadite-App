'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { useApp } from './AppContext'
import { formatMs, APP_YEAR, MONTHS, todayKey, dateKey } from './utils'
import { YearlyDashboardModal } from './YearlyDashboardModal'
import { DayDashboardModal } from './DayDashboardModal'
import { PremiumUpgradeModal } from './PremiumUpgradeModal'
import type { CalendarData } from './types'
import type { Activity } from './types'

// ─── Session duration helper (mirrors DayDashboardModal) ─────────────────────

function getSessionDurationMs(startTs: number, endTs: number): number {
  let d = endTs - startTs
  if (d < 0) d += 86_400_000
  return Math.max(d, 0)
}

// ─── Range stats ──────────────────────────────────────────────────────────────

interface DayPoint {
  key: string
  date: Date
  label: string
  dayLabel: string  // short e.g. "Mon" or "1"
  ms: number
  sessionCount: number
  isProductive: boolean
  isToday: boolean
  isFuture: boolean
}

interface RangeStats {
  totalMs: number
  sessionCount: number
  completedTasks: number
  totalTasks: number
  productiveDays: number
  hyperDays: number
  milestoneDays: number
  actBreakdown: { actId: string; name: string; color: string; ms: number; pct: number }[]
  dayPoints: DayPoint[]
  strongestDay: DayPoint | null
  score: number
  daysElapsed: number
  daysInRange: number
}

function computeRangeStats(
  calData: CalendarData,
  activities: Activity[],
  startDate: Date,
  endDate: Date,
  dayLabels?: string[],
): RangeStats {
  const cutoff = todayKey()
  const cursor = new Date(startDate)
  cursor.setHours(0, 0, 0, 0)
  const end = new Date(endDate)
  end.setHours(23, 59, 59, 999)

  let totalMs = 0, sessionCount = 0, completedTasks = 0, totalTasks = 0
  let productiveDays = 0, hyperDays = 0, milestoneDays = 0, daysElapsed = 0, daysInRange = 0
  const actMs = new Map<string, number>()
  const dayPoints: DayPoint[] = []
  let strongestDay: DayPoint | null = null
  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  let labelIdx = 0
  while (cursor <= end) {
    const k = dateKey(cursor.getFullYear(), cursor.getMonth(), cursor.getDate())
    const isFuture = k > cutoff
    const isToday = k === cutoff
    daysInRange++
    if (!isFuture) daysElapsed++

    const day = calData[k]
    const label = `${cursor.getDate()} ${MONTHS[cursor.getMonth()].slice(0, 3)}`
    const dayLabel = dayLabels ? (dayLabels[labelIdx] ?? String(cursor.getDate())) : String(cursor.getDate())
    let dayMs = 0, daySessions = 0

    if (!isFuture && day) {
      if (day.productive || day.hyper) productiveDays++
      if (day.hyper) hyperDays++
      if (day.milestone) milestoneDays++
      totalTasks += day.tasks?.length ?? 0
      completedTasks += day.tasks?.filter(t => t.done).length ?? 0
      day.tasks?.forEach(t => {
        ;(t.sessions ?? []).forEach(s => {
          if (s.endTs !== null) {
            const dur = getSessionDurationMs(s.startTs, s.endTs)
            if (dur > 0 && dur < 86_400_000) {
              dayMs += dur; totalMs += dur; daySessions++; sessionCount++
              if (t.actId) actMs.set(t.actId, (actMs.get(t.actId) ?? 0) + dur)
            }
          }
        })
      })
    }

    const point: DayPoint = {
      key: k,
      date: new Date(cursor),
      label,
      dayLabel: dayLabels ? dayLabel : (DAY_NAMES[cursor.getDay()] ?? String(cursor.getDate())),
      ms: dayMs,
      sessionCount: daySessions,
      isProductive: !!(day?.productive || day?.hyper),
      isToday,
      isFuture,
    }
    dayPoints.push(point)
    if (!isFuture && dayMs > (strongestDay?.ms ?? 0)) strongestDay = point

    cursor.setDate(cursor.getDate() + 1)
    labelIdx++
  }

  const actBreakdown = Array.from(actMs.entries())
    .map(([actId, ms]) => {
      const act = activities.find(a => a.id === actId)
      return { actId, name: act?.name ?? 'Other', color: act?.color ?? '#94a3b8', ms, pct: totalMs > 0 ? ms / totalMs : 0 }
    })
    .sort((a, b) => b.ms - a.ms)

  let score = 0
  if (productiveDays > 0) score += 20
  const hrs = totalMs / 3_600_000
  if (hrs >= 2) score += 10; if (hrs >= 8) score += 15; if (hrs >= 20) score += 15
  if (completedTasks > 0) score += 15
  if (totalTasks > 0) score += Math.round((completedTasks / totalTasks) * 25)
  score = Math.min(100, score)

  return { totalMs, sessionCount, completedTasks, totalTasks, productiveDays, hyperDays, milestoneDays, actBreakdown, dayPoints, strongestDay, score, daysElapsed, daysInRange }
}

// ─── Week/month date ranges ───────────────────────────────────────────────────

function getCurrentWeekRange(): { start: Date; end: Date; labels: string[] } {
  const now = new Date()
  const offset = now.getDay() === 0 ? 6 : now.getDay() - 1
  const start = new Date(now); start.setDate(now.getDate() - offset); start.setHours(0, 0, 0, 0)
  const end = new Date(start); end.setDate(start.getDate() + 6); end.setHours(23, 59, 59, 999)
  const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  return { start, end, labels }
}

function getCurrentMonthRange(): { start: Date; end: Date } {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  return { start, end }
}

// ─── Shared sub-components ────────────────────────────────────────────────────

// Gradient KPI card (same palette as DayDashboardModal)
function KpiCard({ label, value, sub, gradient, border, glowRgb }: {
  label: string; value: string; sub?: string | null
  gradient: string; border: string; glowRgb: string
}) {
  const [hov, setHov] = useState(false)
  return (
    <div
      className="rounded-2xl px-4 py-4 flex flex-col justify-between cursor-default select-none"
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background: gradient,
        border: `0.5px solid ${border}`,
        boxShadow: hov
          ? `0 0 10px 2px rgba(${glowRgb},0.45), 0 4px 20px rgba(${glowRgb},0.2), inset 0 1px 0 rgba(255,255,255,0.12)`
          : '0 2px 12px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.10)',
        transform: hov ? 'translateY(-2px) scale(1.012)' : 'none',
        transition: 'all 200ms cubic-bezier(0.22,1,0.36,1)',
        minHeight: 86,
      }}
    >
      <p className="text-white/55 text-[9px] font-bold uppercase tracking-[0.1em] mb-1">{label}</p>
      <p className="text-white text-xl font-bold leading-none">{value}</p>
      {sub && <p className="text-white/60 text-[9px] mt-1">{sub}</p>}
    </div>
  )
}

// Day bar chart (SVG)
function DayBarsChart({ dayPoints, isDark }: { dayPoints: DayPoint[]; isDark: boolean }) {
  const [hovIdx, setHovIdx] = useState<number | null>(null)
  const maxMs = Math.max(...dayPoints.map(p => p.ms), 1)
  const H = 110, PB = 22, PT = 8
  const plotH = H - PT - PB
  const n = dayPoints.length

  const textColor = isDark ? 'rgba(100,116,139,0.8)' : 'rgba(100,116,139,0.9)'
  const todayTextColor = isDark ? '#a78bfa' : '#7c3aed'

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <svg viewBox={`0 0 600 ${H}`} width="100%" preserveAspectRatio="none" style={{ height: H, display: 'block' }}>
        {dayPoints.map((p, i) => {
          const slotW = 600 / n
          const barW = Math.max(3, Math.min(32, slotW * 0.65))
          const cx = slotW * i + slotW / 2
          const barH = p.isFuture ? 0 : (p.ms / maxMs) * plotH
          const by = PT + plotH - barH
          const fill = p.isFuture ? 'transparent' : p.isToday ? '#a78bfa' : p.isProductive ? '#6366f1' : p.ms > 0 ? '#94a3b8' : (isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)')
          const showLabel = n <= 7 || n <= 10 || i === 0 || i === n - 1 || p.isToday || (n > 10 && (i + 1) % 5 === 0)
          return (
            <g key={p.key} onMouseEnter={() => setHovIdx(i)} onMouseLeave={() => setHovIdx(null)} style={{ cursor: p.ms > 0 ? 'pointer' : 'default' }}>
              <rect x={cx - slotW / 2} y={0} width={slotW} height={H} fill="transparent" />
              {!p.isFuture && (
                <rect
                  x={cx - barW / 2} y={Math.max(by, PT)}
                  width={barW} height={Math.max(barH, p.ms > 0 ? 3 : 0)}
                  rx={Math.min(3, barW / 3)}
                  fill={fill}
                  opacity={p.ms > 0 ? 1 : 0.35}
                />
              )}
              {hovIdx === i && p.ms > 0 && (
                <rect x={cx - barW / 2 - 2} y={Math.max(by - 2, PT - 2)} width={barW + 4} height={Math.max(barH + 4, 7)} rx={Math.min(4, barW / 3 + 1)} fill="none" stroke={p.isToday ? '#a78bfa' : '#6366f1'} strokeWidth="1.5" opacity="0.7" />
              )}
              {showLabel && (
                <text x={cx} y={H - 4} textAnchor="middle" fontSize="8" fill={p.isToday ? todayTextColor : textColor}>
                  {n <= 7 ? p.dayLabel : String(p.date.getDate())}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      {hovIdx !== null && (() => {
        const p = dayPoints[hovIdx]
        const pct = ((hovIdx + 0.5) / n) * 100
        return (
          <div style={{
            position: 'absolute', top: 2, left: `${Math.min(Math.max(pct, 10), 88)}%`,
            transform: 'translateX(-50%)', pointerEvents: 'none',
            background: isDark ? 'rgba(20,11,46,0.96)' : '#ffffff',
            border: isDark ? '0.5px solid rgba(124,58,237,0.35)' : '0.5px solid rgba(0,0,0,0.12)',
            borderRadius: 8, padding: '5px 10px', fontSize: 10, fontWeight: 600,
            color: isDark ? '#e2e8f0' : '#1e1e2e', whiteSpace: 'nowrap',
            boxShadow: '0 4px 14px rgba(0,0,0,0.22)', zIndex: 5,
          }}>
            {p.label}{p.ms > 0 ? ` — ${formatMs(p.ms)}` : ' — No sessions'}
          </div>
        )
      })()}
    </div>
  )
}

// Activity bars (horizontal)
function ActivityBars({ breakdown, totalMs }: { breakdown: RangeStats['actBreakdown']; totalMs: number }) {
  if (breakdown.length === 0) {
    return <p className="text-[11px] py-3 text-center" style={{ color: 'var(--xp-txt3)' }}>No sessions recorded</p>
  }
  return (
    <div className="space-y-2.5">
      {breakdown.slice(0, 6).map(a => (
        <div key={a.actId} className="flex items-center gap-2.5">
          <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: a.color }} />
          <span className="text-[11px] flex-1 min-w-0 truncate" style={{ color: 'var(--xp-txt2)' }}>{a.name}</span>
          <div className="h-1.5 rounded-full overflow-hidden flex-1 max-w-[100px]" style={{ background: 'var(--xp-bdr2)' }}>
            <div className="h-full rounded-full" style={{ width: `${Math.round(a.pct * 100)}%`, background: a.color }} />
          </div>
          <span className="text-[10px] font-semibold w-12 text-right" style={{ color: 'var(--xp-txt)' }}>{formatMs(a.ms)}</span>
          <span className="text-[9px] w-7 text-right tabular-nums" style={{ color: 'var(--xp-txt3)' }}>{Math.round(a.pct * 100)}%</span>
        </div>
      ))}
    </div>
  )
}

// Score badge
function ScoreBadge({ score }: { score: number }) {
  const { color, label } =
    score >= 80 ? { color: '#ef4444', label: 'Elite' }
    : score >= 60 ? { color: '#a855f7', label: 'Advanced' }
    : score >= 40 ? { color: '#22c55e', label: 'Average' }
    : score >= 20 ? { color: '#eab308', label: 'Building' }
    : { color: '#94a3b8', label: 'No Data' }

  return (
    <div className="flex items-center gap-2">
      <div className="rounded-full px-2.5 py-0.5 text-[9px] font-bold" style={{ background: `${color}20`, color, border: `0.5px solid ${color}44` }}>
        {label}
      </div>
      <span className="text-[11px] font-bold" style={{ color: 'var(--xp-txt)' }}>{score}%</span>
    </div>
  )
}

// Section card wrapper
function SectionCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl p-4 ${className}`} style={{ background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr)', boxShadow: '0 1px 8px rgba(0,0,0,0.06)' }}>
      {children}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-bold uppercase mb-3" style={{ color: 'var(--xp-txt3)', letterSpacing: '0.1em' }}>{children}</p>
}

// ─── AnalyticsPageHeader ──────────────────────────────────────────────────────

function AnalyticsPageHeader({ onBack, onAIInsights, onClose, subViewTitle }: {
  onBack: () => void
  onAIInsights: () => void
  onClose: () => void
  subViewTitle: string | null
}) {
  return (
    <header
      className="flex-shrink-0 flex items-center gap-2 px-3 sm:px-5"
      style={{
        height: 54,
        background: 'var(--xp-hdr)',
        borderBottom: '0.5px solid rgba(255,255,255,0.06)',
        flexShrink: 0,
      }}
    >
      <button
        onClick={onBack}
        className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg transition-all hover:bg-white/10 flex-shrink-0"
        style={{ color: 'rgba(255,255,255,0.78)' }}
        aria-label="Back"
      >
        <span style={{ fontSize: 13 }}>←</span>
        <span className="hidden sm:inline ml-0.5">Back</span>
      </button>

      <div className="flex-1 min-w-0 text-center">
        <span className="text-[13px] font-bold text-white">
          {subViewTitle ?? '📈 Analytics'}
        </span>
      </div>

      <button
        onClick={onAIInsights}
        className="hidden sm:flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg transition-all hover:opacity-85 flex-shrink-0"
        style={{ background: 'rgba(124,58,237,0.25)', border: '0.5px solid rgba(167,139,250,0.35)', color: '#c4b5fd' }}
      >
        🤖 AI Insights
      </button>

      <button
        onClick={onClose}
        className="flex items-center justify-center w-7 h-7 rounded-lg text-[12px] font-bold transition-all hover:opacity-80 flex-shrink-0"
        style={{ background: 'rgba(239,68,68,0.2)', border: '0.5px solid rgba(239,68,68,0.35)', color: '#fca5a5' }}
        aria-label="Close Analytics"
      >
        ✕
      </button>
    </header>
  )
}

// ─── AnalyticsNavBar ──────────────────────────────────────────────────────────

const NAV_TOOLS = [
  { id: 'ai',      icon: '🤖', label: 'AI Insights',     v2: false },
  { id: 'goals',   icon: '🎯', label: 'Goal Analytics',  v2: true  },
  { id: 'focus',   icon: '⚡', label: 'Focus Analytics', v2: true  },
  { id: 'habits',  icon: '🔄', label: 'Habit Analytics', v2: true  },
  { id: 'achieve', icon: '🏅', label: 'Achievements',     v2: true  },
] as const

function AnalyticsNavBar({ onAIInsights, onComingSoon }: {
  onAIInsights: () => void
  onComingSoon: (label: string) => void
}) {
  const [active, setActive] = useState<string>('ai')

  return (
    <div
      className="flex-shrink-0 overflow-x-auto"
      style={{ background: 'var(--xp-bg2)', borderBottom: '0.5px solid var(--xp-bdr)' }}
    >
      <div className="flex gap-1 px-3 sm:px-5 py-2" style={{ minWidth: 'max-content' }}>
        {NAV_TOOLS.map(tool => {
          const isActive = active === tool.id
          return (
            <button
              key={tool.id}
              onClick={() => {
                setActive(tool.id)
                if (tool.id === 'ai') { onAIInsights(); return }
                if (tool.v2) onComingSoon(tool.label)
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all duration-150 whitespace-nowrap flex-shrink-0"
              style={{
                background: isActive ? 'rgba(124,58,237,0.14)' : 'transparent',
                color: isActive ? 'var(--xp-acc)' : 'var(--xp-txt3)',
                border: `0.5px solid ${isActive ? 'rgba(124,58,237,0.28)' : 'transparent'}`,
              }}
            >
              <span>{tool.icon}</span>
              <span>{tool.label}</span>
              {tool.v2 && (
                <span className="text-[7px] font-bold px-1.5 py-px rounded" style={{ background: 'rgba(124,58,237,0.14)', color: '#a78bfa' }}>V2</span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── AnalyticsStats (year-level quick stats) ──────────────────────────────────

function AnalyticsStats({ calData, activities }: { calData: CalendarData; activities: Activity[] }) {
  const stats = useMemo(() => {
    let totalMs = 0, productiveDays = 0, hyperDays = 0, completedTasks = 0
    const cutoff = todayKey()
    const prefix = `${APP_YEAR}-`
    Object.entries(calData).forEach(([k, day]) => {
      if (!k.startsWith(prefix) || k > cutoff) return
      if (day.productive || day.hyper) productiveDays++
      if (day.hyper) hyperDays++
      completedTasks += day.tasks?.filter(t => t.done).length ?? 0
      day.tasks?.forEach(t => {
        ;(t.sessions ?? []).forEach(s => {
          if (s.endTs !== null) {
            const dur = getSessionDurationMs(s.startTs, s.endTs)
            if (dur > 0 && dur < 86_400_000) totalMs += dur
          }
        })
      })
    })
    return { totalMs, productiveDays, hyperDays, completedTasks }
  }, [calData])

  const items = [
    { label: `${APP_YEAR} Hours`,   value: `${(stats.totalMs / 3_600_000).toFixed(1)}h`, icon: '⏱' },
    { label: 'Productive Days',     value: String(stats.productiveDays),                  icon: '📅' },
    { label: '🔥 Hyper Days',       value: String(stats.hyperDays),                       icon: '🔥' },
    { label: 'Tasks Completed',     value: String(stats.completedTasks),                  icon: '✓'  },
  ]

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {items.map(item => (
        <div
          key={item.label}
          className="rounded-2xl px-4 py-3.5"
          style={{ background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr)', boxShadow: '0 1px 8px rgba(0,0,0,0.06)' }}
        >
          <p className="text-xl font-bold" style={{ color: 'var(--xp-acc)' }}>{item.value}</p>
          <p className="text-[10px] mt-0.5 font-medium" style={{ color: 'var(--xp-txt3)' }}>{item.label}</p>
        </div>
      ))}
    </div>
  )
}

// ─── DashboardCard ────────────────────────────────────────────────────────────

function DashboardCard({ icon, title, mainValue, subValue, gradient, glowColor, onClick }: {
  icon: string; title: string; mainValue: string; subValue: string
  gradient: string; glowColor: string; onClick: () => void
}) {
  const [hov, setHov] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      className="w-full text-left rounded-2xl p-5 transition-all duration-200"
      style={{
        background: gradient,
        border: '0.5px solid rgba(255,255,255,0.12)',
        transform: hov ? 'translateY(-3px) scale(1.015)' : 'none',
        boxShadow: hov
          ? `0 16px 40px ${glowColor}55, 0 6px 20px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.12)`
          : `0 4px 16px rgba(0,0,0,0.14), inset 0 1px 0 rgba(255,255,255,0.08)`,
      }}
    >
      <div className="flex items-start justify-between mb-3">
        <span className="text-2xl">{icon}</span>
        <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 16, lineHeight: 1 }}>›</span>
      </div>
      <p className="text-[9px] font-bold uppercase tracking-[0.1em] mb-1" style={{ color: 'rgba(255,255,255,0.5)' }}>{title}</p>
      <p className="text-[22px] font-bold text-white leading-none mb-1">{mainValue}</p>
      <p className="text-[10px]" style={{ color: 'rgba(255,255,255,0.6)' }}>{subValue}</p>
    </button>
  )
}

// ─── Analytics hub view ───────────────────────────────────────────────────────

function AnalyticsHub({
  calData, activities, todayMs, weekMs, monthMs, yearMs,
  onSelectDash,
}: {
  calData: CalendarData; activities: Activity[]
  todayMs: number; weekMs: number; monthMs: number; yearMs: number
  onSelectDash: (v: 'today' | 'weekly' | 'monthly' | 'yearly') => void
}) {
  const now = new Date()
  const weekStats = useMemo(() => {
    const { start, end, labels } = getCurrentWeekRange()
    return computeRangeStats(calData, activities, start, end, labels)
  }, [calData, activities])

  const monthStats = useMemo(() => {
    const { start, end } = getCurrentMonthRange()
    return computeRangeStats(calData, activities, start, end)
  }, [calData, activities])

  const todayStr = `${now.getDate()} ${MONTHS[now.getMonth()].slice(0, 3)}`

  const cards = [
    {
      id: 'today' as const,
      icon: '📅',
      title: "Today's Dashboard",
      mainValue: todayMs > 0 ? formatMs(todayMs) : '—',
      subValue: todayMs > 0 ? `${todayStr} · in depth` : `${todayStr} · no sessions yet`,
      gradient: 'linear-gradient(135deg, #5B21B6 0%, #7E22CE 52%, #A21CAF 100%)',
      glowColor: '#7c3aed',
    },
    {
      id: 'weekly' as const,
      icon: '📈',
      title: 'Weekly Dashboard',
      mainValue: weekMs > 0 ? formatMs(weekMs) : '—',
      subValue: `${weekStats.productiveDays}/7 productive · this week`,
      gradient: 'linear-gradient(135deg, #1D4ED8 0%, #0369A1 52%, #0891B2 100%)',
      glowColor: '#0891b2',
    },
    {
      id: 'monthly' as const,
      icon: '🗓️',
      title: 'Monthly Dashboard',
      mainValue: monthMs > 0 ? formatMs(monthMs) : '—',
      subValue: `${monthStats.productiveDays}/${now.getDate()} productive · ${MONTHS[now.getMonth()].slice(0, 3)}`,
      gradient: 'linear-gradient(135deg, #047857 0%, #15803D 52%, #4D7C0F 100%)',
      glowColor: '#16a34a',
    },
    {
      id: 'yearly' as const,
      icon: '🏆',
      title: 'Yearly Dashboard',
      mainValue: yearMs > 0 ? formatMs(yearMs) : '—',
      subValue: `${APP_YEAR} · annual overview`,
      gradient: 'linear-gradient(135deg, #92400E 0%, #B45309 52%, #D97706 100%)',
      glowColor: '#d97706',
    },
  ]

  return (
    <div className="px-3 sm:px-5 py-5 space-y-5 max-w-3xl mx-auto w-full pb-10">
      <AnalyticsStats calData={calData} activities={activities} />

      <div>
        <SectionTitle>Dashboards</SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {cards.map(c => (
            <DashboardCard key={c.id} {...c} onClick={() => onSelectDash(c.id)} />
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── RangeDashboardView (shared for weekly & monthly) ─────────────────────────

function RangeDashboardView({ title, dateLabel, stats, isDark, monthBarLabels }: {
  title: string
  dateLabel: string
  stats: RangeStats
  isDark: boolean
  monthBarLabels?: string[]
}) {
  const kpis = [
    { label: 'Total Worked',    value: stats.totalMs > 0 ? formatMs(stats.totalMs) : '—', gradient: 'linear-gradient(135deg,#5B21B6,#7E22CE,#A21CAF)', border: 'rgba(162,28,175,0.46)', glow: '139,92,246' },
    { label: 'Sessions',        value: String(stats.sessionCount),                          gradient: 'linear-gradient(135deg,#0E7490,#0F766E,#0D9488)',  border: 'rgba(13,148,136,0.46)', glow: '20,184,166' },
    { label: 'Productive Days', value: `${stats.productiveDays}/${stats.daysElapsed}`,      gradient: 'linear-gradient(135deg,#047857,#15803D,#4D7C0F)',  border: 'rgba(21,128,61,0.46)',  glow: '34,197,94'  },
    { label: 'Tasks Done',      value: `${stats.completedTasks}/${stats.totalTasks || 0}`,  gradient: 'linear-gradient(135deg,#1D4ED8,#0369A1,#0891B2)',  border: 'rgba(8,145,178,0.46)',  glow: '14,165,233' },
  ]

  return (
    <div className="px-3 sm:px-5 py-5 space-y-4 max-w-3xl mx-auto w-full pb-10">
      {/* Date label */}
      <p className="text-[11px] font-medium" style={{ color: 'var(--xp-txt3)' }}>{dateLabel}</p>

      {/* KPI grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {kpis.map(k => (
          <KpiCard key={k.label} label={k.label} value={k.value} gradient={k.gradient} border={k.border} glowRgb={k.glow} />
        ))}
      </div>

      {/* Bar chart */}
      <SectionCard>
        <div className="flex items-center justify-between mb-3">
          <SectionTitle>Daily Hours</SectionTitle>
          {stats.totalMs > 0 && <ScoreBadge score={stats.score} />}
        </div>
        <DayBarsChart dayPoints={stats.dayPoints} isDark={isDark} />
      </SectionCard>

      {/* Strongest day */}
      {stats.strongestDay && stats.strongestDay.ms > 0 && (
        <SectionCard>
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-lg"
              style={{ background: 'linear-gradient(135deg, rgba(124,58,237,0.14), rgba(99,102,241,0.08))', border: '0.5px solid rgba(124,58,237,0.2)' }}
            >
              🏆
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-medium" style={{ color: 'var(--xp-txt3)' }}>Strongest Day</p>
              <p className="text-[13px] font-bold" style={{ color: 'var(--xp-txt)' }}>{stats.strongestDay.label}</p>
              <p className="text-[11px]" style={{ color: 'var(--xp-acc)' }}>{formatMs(stats.strongestDay.ms)} tracked</p>
            </div>
            {stats.strongestDay.isToday && (
              <span className="text-[9px] font-bold px-2 py-1 rounded-full" style={{ background: 'rgba(124,58,237,0.12)', color: 'var(--xp-acc)' }}>TODAY</span>
            )}
          </div>
        </SectionCard>
      )}

      {/* Activity distribution */}
      <SectionCard>
        <SectionTitle>Activity Distribution</SectionTitle>
        <ActivityBars breakdown={stats.actBreakdown} totalMs={stats.totalMs} />
      </SectionCard>

      {/* Milestones row */}
      {(stats.hyperDays > 0 || stats.milestoneDays > 0) && (
        <SectionCard>
          <SectionTitle>Highlights</SectionTitle>
          <div className="flex gap-3 flex-wrap">
            {stats.hyperDays > 0 && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: 'rgba(234,179,8,0.1)', border: '0.5px solid rgba(234,179,8,0.25)' }}>
                <span>🔥</span>
                <span className="text-[11px] font-semibold" style={{ color: '#d97706' }}>{stats.hyperDays} hyper day{stats.hyperDays !== 1 ? 's' : ''}</span>
              </div>
            )}
            {stats.milestoneDays > 0 && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: 'rgba(99,102,241,0.1)', border: '0.5px solid rgba(99,102,241,0.25)' }}>
                <span>🏆</span>
                <span className="text-[11px] font-semibold" style={{ color: '#6366f1' }}>{stats.milestoneDays} milestone{stats.milestoneDays !== 1 ? 's' : ''}</span>
              </div>
            )}
            {stats.completedTasks > 0 && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: 'rgba(34,197,94,0.1)', border: '0.5px solid rgba(34,197,94,0.25)' }}>
                <span>✅</span>
                <span className="text-[11px] font-semibold" style={{ color: '#16a34a' }}>{stats.completedTasks} task{stats.completedTasks !== 1 ? 's' : ''} done</span>
              </div>
            )}
          </div>
        </SectionCard>
      )}

      {/* Empty state */}
      {stats.totalMs === 0 && (
        <SectionCard>
          <div className="py-6 text-center">
            <p className="text-2xl mb-2">📊</p>
            <p className="text-[13px] font-semibold" style={{ color: 'var(--xp-txt)' }}>No sessions recorded</p>
            <p className="text-[11px] mt-1" style={{ color: 'var(--xp-txt3)' }}>Start tracking to see your {title.toLowerCase()} data.</p>
          </div>
        </SectionCard>
      )}
    </div>
  )
}

// ─── WeeklyDashboardView ──────────────────────────────────────────────────────

function WeeklyDashboardView({ isDark }: { isDark: boolean }) {
  const { calData, activities } = useApp()
  const { start, end, labels } = useMemo(() => getCurrentWeekRange(), [])
  const stats = useMemo(() => computeRangeStats(calData, activities, start, end, labels), [calData, activities, start, end, labels])

  const fmtDate = (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`
  const dateLabel = `${fmtDate(start)} – ${fmtDate(end)}, ${start.getFullYear()}`

  return <RangeDashboardView title="Weekly" dateLabel={dateLabel} stats={stats} isDark={isDark} />
}

// ─── MonthlyDashboardView ─────────────────────────────────────────────────────

function MonthlyDashboardView({ isDark }: { isDark: boolean }) {
  const { calData, activities } = useApp()
  const now = new Date()
  const { start, end } = useMemo(() => getCurrentMonthRange(), [])
  const stats = useMemo(() => computeRangeStats(calData, activities, start, end), [calData, activities, start, end])
  const dateLabel = `${MONTHS[now.getMonth()]} ${now.getFullYear()}`

  return <RangeDashboardView title="Monthly" dateLabel={dateLabel} stats={stats} isDark={isDark} />
}

// ─── ComingSoonDialog ─────────────────────────────────────────────────────────

function ComingSoonDialog({ feature, onClose }: { feature: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[300px] rounded-2xl p-6 shadow-2xl text-center"
        style={{ background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="text-3xl mb-3">🚀</div>
        <h3 className="text-sm font-bold mb-2" style={{ color: 'var(--xp-txt)' }}>{feature}</h3>
        <p className="text-[11px] leading-relaxed mb-4" style={{ color: 'var(--xp-txt2)' }}>
          Available in <span className="font-semibold" style={{ color: 'var(--xp-acc)' }}>XPadite V2</span> — the AI-powered upgrade coming soon.
        </p>
        <span className="inline-block text-[9px] font-bold px-3 py-1 rounded-full mb-5" style={{ background: 'linear-gradient(135deg,#7c3aed,#6366f1)', color: 'white', letterSpacing: '0.06em' }}>
          XPADITE V2 · COMING SOON
        </span>
        <div>
          <button onClick={onClose} className="px-6 py-2 rounded-full text-[11px] font-semibold transition-opacity hover:opacity-75" style={{ background: 'var(--xp-bg3)', color: 'var(--xp-txt2)', border: '0.5px solid var(--xp-bdr2)' }}>
            Got it
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── AnalyticsPage (main export) ──────────────────────────────────────────────

type SubView = null | 'today' | 'weekly' | 'monthly' | 'yearly'

export function AnalyticsPage({ onClose }: { onClose: () => void }) {
  const { calData, activities, isDark } = useApp()
  const [subView, setSubView] = useState<SubView>(null)
  const [showPremium, setShowPremium] = useState(false)
  const [comingSoon, setComingSoon] = useState<string | null>(null)

  const today = new Date()
  const todK = todayKey()

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (comingSoon) { setComingSoon(null); return }
      if (showPremium) { setShowPremium(false); return }
      if (subView === 'today' || subView === 'yearly') return
      if (subView) { setSubView(null); return }
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, subView, showPremium, comingSoon])

  // Quick totals for hub cards
  const { todayMs, weekMs, monthMs, yearMs } = useMemo(() => {
    const sumKeys = (keys: string[]) => {
      let t = 0
      keys.forEach(k => {
        const day = calData[k]
        if (!day) return
        day.tasks?.forEach(task => {
          ;(task.sessions ?? []).forEach(s => {
            if (s.endTs !== null) {
              const dur = getSessionDurationMs(s.startTs, s.endTs)
              if (dur > 0 && dur < 86_400_000) t += dur
            }
          })
        })
      })
      return t
    }

    const todayMs = sumKeys([todK])

    const { start, end, labels } = getCurrentWeekRange()
    const cursor = new Date(start); cursor.setHours(0, 0, 0, 0)
    const wKeys: string[] = []
    while (cursor <= end) { wKeys.push(dateKey(cursor.getFullYear(), cursor.getMonth(), cursor.getDate())); cursor.setDate(cursor.getDate() + 1) }
    const weekMs = sumKeys(wKeys)

    const { start: ms, end: me } = getCurrentMonthRange()
    const mc = new Date(ms)
    const mKeys: string[] = []
    while (mc <= me) { mKeys.push(dateKey(mc.getFullYear(), mc.getMonth(), mc.getDate())); mc.setDate(mc.getDate() + 1) }
    const monthMs = sumKeys(mKeys)

    const cutoff = todK; const yearPrefix = `${APP_YEAR}-`
    const yKeys = Object.keys(calData).filter(k => k.startsWith(yearPrefix) && k <= cutoff)
    const yearMs = sumKeys(yKeys)

    return { todayMs, weekMs, monthMs, yearMs }
  }, [calData, todK])

  const isInline = subView === 'weekly' || subView === 'monthly'

  const subViewTitle =
    subView === 'weekly'  ? '📈 Weekly Dashboard'
    : subView === 'monthly' ? '🗓️ Monthly Dashboard'
    : null

  const handleBack = isInline ? () => setSubView(null) : onClose

  return (
    <>
      <div className="fixed inset-0 z-50 flex flex-col" style={{ background: 'var(--xp-bg)' }}>
        {/* Header */}
        <AnalyticsPageHeader
          onBack={handleBack}
          onAIInsights={() => { setShowPremium(true) }}
          onClose={onClose}
          subViewTitle={subViewTitle}
        />

        {/* Nav bar — only on hub view */}
        {!subView && (
          <AnalyticsNavBar
            onAIInsights={() => setShowPremium(true)}
            onComingSoon={label => setComingSoon(label)}
          />
        )}

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">
          {!subView && (
            <AnalyticsHub
              calData={calData}
              activities={activities}
              todayMs={todayMs}
              weekMs={weekMs}
              monthMs={monthMs}
              yearMs={yearMs}
              onSelectDash={setSubView}
            />
          )}
          {subView === 'weekly'  && <WeeklyDashboardView  isDark={isDark} />}
          {subView === 'monthly' && <MonthlyDashboardView isDark={isDark} />}
        </div>
      </div>

      {/* Stacked modals (z-50, later in DOM = on top) */}
      {subView === 'today' && (
        <DayDashboardModal
          dateKey={todK}
          month={today.getMonth()}
          day={today.getDate()}
          onClose={() => setSubView(null)}
          onBack={() => setSubView(null)}
        />
      )}
      {subView === 'yearly' && (
        <YearlyDashboardModal onClose={() => setSubView(null)} />
      )}

      {/* Dialogs */}
      {showPremium && <PremiumUpgradeModal onClose={() => setShowPremium(false)} />}
      {comingSoon && <ComingSoonDialog feature={comingSoon} onClose={() => setComingSoon(null)} />}
    </>
  )
}

'use client'

// ─── Yearly Dashboard ───────────────────────────────────────────────────────
// Built directly on top of Monthly Dashboard's (MonthFullPage.tsx) established
// visual system — same KPI card recipe, gauge/badge layout, Yearly/Monthly
// Progress trend chart (the shared TrendBarChart component, fed 12 monthly
// buckets instead of weekly ones), Activity Breakdown donut, and Total
// Activities/Sessions card styling — rather than inventing a parallel design.
// The one genuinely new piece is the collapsible month-group wrapper used by
// Total Activities / Total Sessions / Pending Tasks, since those three cards
// must stay at a fixed footprint while holding a full year of data (grouped
// by month, each independently expandable, scrolling internally).
//
// Like MonthFullPage, calData is the authoritative session source (the flat
// `sessions` array in AppContext is only ever written by the global Clock
// In/Out button, not Task Manager's per-task timers) — allTaskSessions below
// flattens it once across every date on record.
//
// Embedded-only: this dashboard currently only opens inside AnalyticsModal's
// own container (same integration pattern as Monthly's `embedded` prop), so
// there is no standalone full-viewport overlay mode here.

import { useEffect, useMemo, useState } from 'react'
import { useApp } from './AppContext'
import { GaugeMeter } from './GaugeMeter'
import { dateKey, MONTHS, APP_YEAR, getYearStats, getDayOfYear, formatMs, resolveProgressColor } from './utils'
import { useDisplayFirstName } from './useDisplayFirstName'
import { AchievementBanner, PERFORMANCE_TIERS, getTaskPerformanceLevel, DonutChart, TASK_GRAD_STRINGS } from './DayDashboardModal'
import { ProductiveDot } from './LegendRow'
import { TrendBarChart, type TrendBucket } from './TrendBarChart'

type ActivityRow = { name: string; color: string; ms: number }
type SessionRow = { actName: string; actColor: string; durationMs: number }
type PendingRow = { id: string; text: string; dateKey: string }

// Same solid-triangle glyphs used for date-nav arrows elsewhere (AnalyticsModal's
// Today scope nav, DayModal's header) — duplicated locally per the existing
// convention rather than extracting a shared one-off primitive.
const PrevTriangle = () => (
  <svg width="7" height="10" viewBox="0 0 9 12" fill="currentColor" aria-hidden="true"><path d="M9 0 L0 6 L9 12 Z" /></svg>
)
const NextTriangle = () => (
  <svg width="7" height="10" viewBox="0 0 9 12" fill="currentColor" aria-hidden="true"><path d="M0 0 L9 6 L0 12 Z" /></svg>
)

// For the current year, defaults to the current month's group (if it has
// data); for a historical year — or when the current month has none —
// defaults to the most recent month that does. Returns the position within
// `months` (not the month number itself) to default-open, or -1 if empty.
function pickDefaultOpenGroupIdx(months: number[], isCurrentYear: boolean, currentMonthIdx: number): number {
  if (months.length === 0) return -1
  if (isCurrentYear) {
    const idx = months.indexOf(currentMonthIdx)
    if (idx >= 0) return idx
  }
  return months.length - 1
}

function fmtTaskDate(dk: string): string {
  const [y, m, d] = dk.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  const weekday = dt.toLocaleDateString('en-US', { weekday: 'long' })
  const monthDay = dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return `${weekday} · ${monthDay}`
}

// Module-level so React never remounts/resets a group's open state on an
// unrelated parent re-render (the same lesson already applied to TimeRow in
// DayModal.tsx) — collapsed by default except `defaultOpen`, triangle rotates
// 90deg open (the exact collapse affordance already used by DayModal's
// "Journal notes" section).
function MonthGroup({ title, summary, defaultOpen, isDark, children }: {
  title: string
  // Compact inline stats appended to the title after " · " (e.g. "6 pending",
  // "18 sessions", "5 activities · 168h") so the distribution across the year
  // is readable without expanding every month.
  summary?: string
  defaultOpen?: boolean
  isDark: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(!!defaultOpen)
  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 w-full text-left"
        style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '5px 0' }}
      >
        <span
          aria-hidden="true"
          style={{
            display: 'inline-block', fontSize: 9, lineHeight: 1, flexShrink: 0,
            color: isDark ? 'rgba(203,213,225,0.6)' : 'var(--xp-txt3)',
            transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: 'transform 200ms cubic-bezier(0.4,0,0.2,1)',
          }}
        >▶</span>
        <span className="text-[10px] font-semibold flex-1 min-w-0 truncate" style={{ color: isDark ? 'rgba(255,255,255,0.85)' : 'var(--xp-txt)' }}>
          {title}
          {summary && (
            <span style={{ fontWeight: 500, color: isDark ? 'rgba(148,163,184,0.6)' : 'var(--xp-txt3)' }}> · {summary}</span>
          )}
        </span>
      </button>
      {open && <div style={{ paddingLeft: 15, paddingBottom: 6 }}>{children}</div>}
    </div>
  )
}

interface YearFullPageProps {
  onClose: () => void
}

export function YearFullPage({ onClose }: YearFullPageProps) {
  const { calData, activities, isDark, progressColor: _rawColor } = useApp()
  const progressColor = resolveProgressColor(_rawColor, isDark)
  const firstName = useDisplayFirstName()

  const [currentYear, setCurrentYear] = useState(APP_YEAR)
  // Blocks navigating into a future year with no historical Analytics data.
  const isCurrentRealYear = currentYear === new Date().getFullYear()

  // ── Data computations (all keyed to currentYear) ───────────────────────────

  const stats = useMemo(() => getYearStats(calData, currentYear), [calData, currentYear])

  // calData is the authoritative session source — see file header comment.
  const allTaskSessions = useMemo(() => {
    const result: { dateKey: string; startTs: number; endTs: number }[] = []
    for (const key of Object.keys(calData)) {
      const day = calData[key]
      for (const task of (day?.tasks ?? [])) {
        for (const s of (task.sessions ?? [])) {
          if (s.endTs !== null) result.push({ dateKey: key, startTs: s.startTs, endTs: s.endTs })
        }
      }
    }
    return result
  }, [calData])

  const yearKeys = useMemo(() => {
    const s = new Set<string>()
    for (let m = 0; m < 12; m++) {
      const td = new Date(currentYear, m + 1, 0).getDate()
      for (let d = 1; d <= td; d++) s.add(dateKey(currentYear, m, d))
    }
    return s
  }, [currentYear])

  const yearSessions = useMemo(
    () => allTaskSessions.filter(s => yearKeys.has(s.dateKey)),
    [allTaskSessions, yearKeys]
  )

  const totalMs = useMemo(
    () => yearSessions.reduce((sum, s) => sum + (s.endTs - s.startTs), 0),
    [yearSessions]
  )

  const dailyMsMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const s of allTaskSessions) map.set(s.dateKey, (map.get(s.dateKey) ?? 0) + (s.endTs - s.startTs))
    return map
  }, [allTaskSessions])

  // Total Activities / Total Sessions / Pending Tasks — grouped by month in a
  // single pass over the year's days (one iteration feeds all three cards,
  // plus the per-month session/completed-task counts Yearly Progress's
  // tooltip reuses below rather than re-deriving them).
  const groupedByMonth = useMemo(() => {
    const actMaps: Map<string, number>[] = Array.from({ length: 12 }, () => new Map())
    const sessionsByMonth: SessionRow[][] = Array.from({ length: 12 }, () => [])
    const pendingByMonth: PendingRow[][] = Array.from({ length: 12 }, () => [])
    const completedTasksByMonth: number[] = new Array(12).fill(0)

    for (let m = 0; m < 12; m++) {
      const td = new Date(currentYear, m + 1, 0).getDate()
      for (let d = 1; d <= td; d++) {
        const key = dateKey(currentYear, m, d)
        const day = calData[key]
        if (!day) continue
        for (const t of day.tasks) {
          const act = activities.find(a => a.id === t.actId)
          for (const s of t.sessions) {
            if (s.endTs !== null) {
              const dur = s.endTs - s.startTs
              if (t.actId) actMaps[m].set(t.actId, (actMaps[m].get(t.actId) ?? 0) + dur)
              sessionsByMonth[m].push({ actName: act?.name ?? 'Other', actColor: act?.color ?? '#94a3b8', durationMs: dur })
            }
          }
          if (t.done) completedTasksByMonth[m]++
          else pendingByMonth[m].push({ id: t.id, text: t.text, dateKey: key })
        }
      }
      sessionsByMonth[m].sort((a, b) => b.durationMs - a.durationMs)
    }

    const activityRows: ActivityRow[][] = actMaps.map(map =>
      Array.from(map.entries())
        .map(([actId, ms]) => {
          const act = activities.find(a => a.id === actId)
          return { name: act?.name ?? 'Other', color: act?.color ?? '#94a3b8', ms }
        })
        .sort((a, b) => b.ms - a.ms)
    )

    return { activityRows, sessionsByMonth, pendingByMonth, completedTasksByMonth }
  }, [calData, activities, currentYear])

  // Yearly Progress — 12 monthly buckets, feeding the exact same shared
  // bar+curve chart Monthly Dashboard uses (TrendBarChart), rather than a
  // parallel chart implementation. Each bucket's own total is real historical
  // data (including a legitimate 0h for a past month with no sessions); a
  // month that hasn't started yet is flagged isFuture so the shared chart
  // excludes it from the trend line/points entirely rather than reading as a
  // false "zero" — see TrendBarChart's lastActiveIdx/isFuture handling.
  const monthlyBuckets = useMemo((): TrendBucket[] => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const buckets: TrendBucket[] = []
    for (let m = 0; m < 12; m++) {
      const td = new Date(currentYear, m + 1, 0).getDate()
      let ms = 0
      for (let d = 1; d <= td; d++) ms += dailyMsMap.get(dateKey(currentYear, m, d)) ?? 0
      const monthStart = new Date(currentYear, m, 1)
      const monthEnd = new Date(currentYear, m, td)
      const isFuture = monthStart > today
      const isCurrent = !isFuture && monthEnd >= today
      const sessionCount = groupedByMonth.sessionsByMonth[m].length
      const tasksCompleted = groupedByMonth.completedTasksByMonth[m]
      buckets.push({
        label: MONTHS[m].slice(0, 3),
        ms,
        crossMonth: null,
        isFuture,
        isCurrent,
        tooltipLabel: `${MONTHS[m]} ${currentYear}`,
        detail: isFuture ? undefined : [
          `${sessionCount} session${sessionCount === 1 ? '' : 's'}`,
          `${tasksCompleted} task${tasksCompleted === 1 ? '' : 's'} completed`,
        ],
      })
    }
    return buckets
  }, [currentYear, dailyMsMap, groupedByMonth])

  const actBreakdown = useMemo((): ActivityRow[] => {
    const actMs = new Map<string, number>()
    for (const key of yearKeys) {
      const day = calData[key]
      if (!day) continue
      for (const t of day.tasks) {
        for (const s of t.sessions) {
          if (s.endTs !== null && t.actId) actMs.set(t.actId, (actMs.get(t.actId) ?? 0) + (s.endTs - s.startTs))
        }
      }
    }
    return Array.from(actMs.entries()).map(([actId, ms]) => {
      const act = activities.find(a => a.id === actId)
      return { name: act?.name ?? 'Other', color: act?.color ?? '#94a3b8', ms }
    }).sort((a, b) => b.ms - a.ms).slice(0, 7)
  }, [calData, yearKeys, activities])

  const { currentStreak, longestStreak } = useMemo(() => {
    const isProd = (k: string) => { const d = calData[k]; return !!(d?.productive || d?.hyper || d?.milestone || d?.goal) }
    const sortedKeys = Array.from(yearKeys).sort()
    let longest = 0, run = 0
    for (const k of sortedKeys) { if (isProd(k)) { run++; if (run > longest) longest = run } else run = 0 }
    const now = new Date()
    const isCurrentCalYear = currentYear === now.getFullYear()
    // A past year's "current streak" is the streak ending on its last day
    // (Dec 31) — mirrors Monthly's own past-month semantics exactly.
    const lastIdx = isCurrentCalYear
      ? sortedKeys.indexOf(dateKey(currentYear, now.getMonth(), now.getDate()))
      : sortedKeys.length - 1
    let current = 0
    for (let i = (lastIdx >= 0 ? lastIdx : sortedKeys.length - 1); i >= 0; i--) {
      if (isProd(sortedKeys[i])) current++; else break
    }
    return { currentStreak: current, longestStreak: longest }
  }, [calData, yearKeys, currentYear])

  const activityMonthsWithData = groupedByMonth.activityRows
    .map((rows, m) => ({ m, rows }))
    .filter(x => x.rows.length > 0)
  const sessionMonthsWithData = groupedByMonth.sessionsByMonth
    .map((rows, m) => ({ m, rows }))
    .filter(x => x.rows.length > 0)
  const pendingMonthsWithData = groupedByMonth.pendingByMonth
    .map((rows, m) => ({ m, rows }))
    .filter(x => x.rows.length > 0)
  const totalPending = groupedByMonth.pendingByMonth.reduce((s, rows) => s + rows.length, 0)
  const longestSession = groupedByMonth.sessionsByMonth
    .flat()
    .reduce<SessionRow | null>((best, s) => (!best || s.durationMs > best.durationMs ? s : best), null)

  // Smart default expansion (section 6): never all-open at once.
  const currentMonthIdx = new Date().getMonth()
  const activityDefaultOpenIdx = pickDefaultOpenGroupIdx(activityMonthsWithData.map(x => x.m), isCurrentRealYear, currentMonthIdx)
  const sessionDefaultOpenIdx  = pickDefaultOpenGroupIdx(sessionMonthsWithData.map(x => x.m), isCurrentRealYear, currentMonthIdx)
  const pendingDefaultOpenIdx  = pickDefaultOpenGroupIdx(pendingMonthsWithData.map(x => x.m), isCurrentRealYear, currentMonthIdx)

  // ── Yearly KPI card data (days-worked remaining, vs-last-year deltas, peak
  //    time-of-day window) — all derived from the same calData/sessions this
  //    dashboard already uses, no new data sources. ──────────────────────────

  const daysRemaining = useMemo(() => {
    const now = new Date()
    if (currentYear !== now.getFullYear()) return 0
    return Math.max(stats.totalDays - getDayOfYear(), 0)
  }, [currentYear, stats.totalDays])

  const prevYear = useMemo(() => {
    const py = currentYear - 1
    const pKeys = new Set<string>()
    for (let m = 0; m < 12; m++) {
      const td = new Date(py, m + 1, 0).getDate()
      for (let d = 1; d <= td; d++) pKeys.add(dateKey(py, m, d))
    }
    const pSessions = allTaskSessions.filter(s => pKeys.has(s.dateKey))
    const pTotalMs = pSessions.reduce((sum, s) => sum + (s.endTs - s.startTs), 0)
    return { totalMs: pTotalMs, sessionCount: pSessions.length }
  }, [allTaskSessions, currentYear])

  // Peak Performance Time — identical 2-hour time-of-day bucket algorithm
  // Monthly Dashboard uses, fed this year's sessions instead of one month's.
  const peakTime = useMemo(() => {
    const completed = yearSessions
    if (completed.length < 3) return null

    const BUCKET_HOURS = 2
    const NUM_BUCKETS = 24 / BUCKET_HOURS
    const counts = new Array(NUM_BUCKETS).fill(0) as number[]
    const durations = new Array(NUM_BUCKETS).fill(0) as number[]
    for (const s of completed) {
      const bucket = Math.floor(new Date(s.startTs).getHours() / BUCKET_HOURS)
      counts[bucket] += 1
      durations[bucket] += s.endTs - s.startTs
    }
    const maxCount = Math.max(...counts, 1)
    const maxDur   = Math.max(...durations, 1)
    const scores   = counts.map((c, i) => (c / maxCount) * 0.5 + (durations[i] / maxDur) * 0.5)
    const totalDur = durations.reduce((a, b) => a + b, 0)
    if (totalDur === 0) return null

    function fmtHour(h: number): string {
      const hh = ((h % 24) + 24) % 24
      const period = hh < 12 ? 'AM' : 'PM'
      let h12 = hh % 12
      if (h12 === 0) h12 = 12
      return `${h12} ${period}`
    }
    const windowLabel = (startBucket: number, endBucketExclusive: number) =>
      `${fmtHour(startBucket * BUCKET_HOURS)} – ${fmtHour(endBucketExclusive * BUCKET_HOURS)}`

    let topIdx = 0
    for (let i = 1; i < NUM_BUCKETS; i++) if (scores[i] > scores[topIdx]) topIdx = i
    if (scores[topIdx] === 0) return null

    const leftIdx  = topIdx > 0 ? topIdx - 1 : -1
    const rightIdx = topIdx < NUM_BUCKETS - 1 ? topIdx + 1 : -1
    let mergeIdx = -1
    if (leftIdx >= 0 && rightIdx >= 0) mergeIdx = scores[leftIdx] >= scores[rightIdx] ? leftIdx : rightIdx
    else if (leftIdx >= 0) mergeIdx = leftIdx
    else if (rightIdx >= 0) mergeIdx = rightIdx

    const used = new Set([topIdx])
    let winStart = topIdx, winEnd = topIdx + 1
    if (mergeIdx >= 0 && scores[mergeIdx] >= scores[topIdx] * 0.6) {
      used.add(mergeIdx)
      winStart = Math.min(topIdx, mergeIdx)
      winEnd   = Math.max(topIdx, mergeIdx) + 1
    }
    const window1Dur = Array.from(used).reduce((s, i) => s + durations[i], 0)

    let secondIdx = -1
    for (let i = 0; i < NUM_BUCKETS; i++) {
      if (used.has(i) || i === winStart - 1 || i === winEnd) continue
      if (secondIdx === -1 || scores[i] > scores[secondIdx]) secondIdx = i
    }
    const secondary = secondIdx >= 0 && scores[secondIdx] >= scores[topIdx] * 0.65
      ? windowLabel(secondIdx, secondIdx + 1)
      : null

    return {
      primary: windowLabel(winStart, winEnd),
      secondary,
      sharePct: Math.round((window1Dur / totalDur) * 100),
    }
  }, [yearSessions])

  const totalSessionCount = yearSessions.length
  const yearlyWinsTotal = stats.goalDays + stats.milestoneDays + stats.hyperDays + stats.productiveDays

  // Yearly Performance score/badge — same tiered scoring shape Monthly uses
  // (productive-day rate + accumulated hours + wins), with the hour
  // thresholds scaled up roughly 12x for a full year's realistic totals
  // rather than a single month's.
  const yearScore = useMemo(() => {
    const now = new Date()
    const isCurrentCalYear = currentYear === now.getFullYear()
    const elapsed = isCurrentCalYear ? Math.min(getDayOfYear(), stats.totalDays) : stats.totalDays
    const rate = elapsed > 0 ? (stats.productiveDays / elapsed) * 100 : 0
    const hours = totalMs / 3_600_000
    let score = 0
    if (rate >= 30) score += 20; if (rate >= 50) score += 20
    if (rate >= 70) score += 15; if (rate >= 90) score += 15
    if (hours >= 60) score += 10; if (hours >= 180) score += 5
    if (stats.hyperDays >= 3)     score += 8
    if (stats.milestoneDays >= 3) score += 5
    if (stats.goalDays >= 3)      score += 2
    return Math.min(100, score)
  }, [stats, totalMs, currentYear])

  const yearLevel = getTaskPerformanceLevel(yearScore)
  const yearTier  = PERFORMANCE_TIERS[yearLevel]
  const [yearBadgeShine, setYearBadgeShine] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setYearBadgeShine(true), 900)
    return () => clearTimeout(t)
  }, [currentYear])

  const [yearActHovIdx, setYearActHovIdx] = useState<number | null>(null)

  const S1  = isDark ? 'rgba(15,8,36,0.99)'  : '#ffffff'
  const S2  = isDark ? 'rgba(20,11,46,0.98)' : 'var(--xp-card)'
  const BDR = isDark ? 'rgba(124,58,237,0.22)' : 'rgba(0,0,0,0.09)'
  const card1: React.CSSProperties = { background: S1, border: `0.5px solid ${BDR}`, boxShadow: isDark ? '0 2px 20px rgba(0,0,0,0.42)' : '0 1px 10px rgba(0,0,0,0.07)' }
  const card2: React.CSSProperties = { background: S2, border: `0.5px solid ${BDR}`, boxShadow: isDark ? '0 2px 18px rgba(0,0,0,0.38)' : '0 1px 6px rgba(0,0,0,0.05)' }

  return (
    <div className="w-full h-full flex flex-col overflow-hidden">
      {/* ── Header — same 3-stop purple gradient Monthly Dashboard's header
           uses, arrow-only Back + centered title, matching DayDashboardModal's
           simple absolute-centering recipe (no injected stylesheet needed). ── */}
      <div
        className="flex items-center px-4 sm:px-6 py-3.5 sm:py-4 flex-shrink-0 relative min-h-[60px] sm:min-h-[64px]"
        style={{
          background: 'linear-gradient(135deg, #3b0764 0%, #7c3aed 50%, #6d28d9 100%)',
          borderBottom: '0.5px solid rgba(167,139,250,0.28)',
          boxShadow: '0 4px 20px rgba(0,0,0,0.30)',
        }}
      >
        <button
          onClick={onClose}
          className="text-base font-light hover:opacity-70 transition-opacity flex-shrink-0 absolute left-4"
          style={{ color: 'rgba(255,255,255,0.85)', background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1, padding: '4px 2px', top: '50%', transform: 'translateY(-50%)' }}
          aria-label="Back"
        >←</button>

        {/* Single centered row: ◀  Yearly Dashboard - 2026  ▶ — the year no
            longer sits on its own line underneath. */}
        <div className="absolute left-1/2 flex items-center gap-3" style={{ top: '50%', transform: 'translate(-50%,-50%)' }}>
          <button
            onClick={() => setCurrentYear(y => y - 1)}
            aria-label="Previous year"
            className="flex items-center justify-center rounded-full transition-colors hover:bg-white/10 flex-shrink-0"
            style={{ width: 22, height: 22, color: 'rgba(255,255,255,0.75)', background: 'transparent', border: 'none', cursor: 'pointer' }}
          ><PrevTriangle /></button>
          <span style={{ fontSize: 16, fontWeight: 700, color: 'white', letterSpacing: '-0.02em', whiteSpace: 'nowrap', textShadow: '0 1px 4px rgba(0,0,0,0.30)', lineHeight: 1.2 }}>
            Yearly Dashboard - {currentYear}
          </span>
          <button
            onClick={() => setCurrentYear(y => y + 1)}
            disabled={isCurrentRealYear}
            aria-label="Next year"
            className={`flex items-center justify-center rounded-full transition-colors flex-shrink-0 ${isCurrentRealYear ? '' : 'hover:bg-white/10'}`}
            style={{
              width: 22, height: 22,
              color: isCurrentRealYear ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.75)',
              background: 'transparent', border: 'none',
              cursor: isCurrentRealYear ? 'default' : 'pointer',
            }}
          ><NextTriangle /></button>
        </div>
      </div>

      {/* ── Scrollable body — content-driven height on desktop/tablet (matches
           the Analytics modal host's own auto-height card), internal scroll
           on mobile — identical split MonthFullPage's embedded mode uses. ── */}
      <div className="flex-1 overflow-y-auto sm:flex-none sm:overflow-visible" style={{ minHeight: 0, WebkitOverflowScrolling: 'touch' }}>
        <div className="p-3 sm:p-4 lg:p-5 space-y-3 lg:space-y-4" style={{ background: isDark ? 'rgba(9,4,22,0.99)' : 'var(--xp-bg3)' }}>

          {/* ROW 1 — KPI area | (Performance Analytics + Performance Badge) */}
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.52fr)_minmax(0,2.06fr)] items-stretch gap-3 lg:gap-4">

            <div className="flex flex-col gap-2">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 content-start">
                {([
                  {
                    label: 'Days Worked', icon: '📅',
                    value: `${stats.productiveDays}/${stats.totalDays}`,
                    sub: daysRemaining > 0 ? `${daysRemaining} day${daysRemaining === 1 ? '' : 's'} remaining` : null,
                    bg: isDark ? 'linear-gradient(135deg, #1E3A8A 0%, #1D4ED8 50%, #3B82F6 100%)' : 'linear-gradient(135deg, #2563EB 0%, #3B82F6 50%, #60A5FA 100%)',
                    border: isDark ? 'rgba(59,130,246,0.46)' : 'rgba(37,99,235,0.42)', glowRgb: '59,130,246',
                  },
                  {
                    label: 'Total Worked', icon: '⏱',
                    value: formatMs(totalMs),
                    sub: prevYear.totalMs > 0
                      ? `${totalMs >= prevYear.totalMs ? '↑' : '↓'} ${formatMs(Math.abs(totalMs - prevYear.totalMs))} vs last year`
                      : null,
                    bg: isDark ? 'linear-gradient(135deg, #5B21B6 0%, #7E22CE 50%, #A21CAF 100%)' : 'linear-gradient(135deg, #7C3AED 0%, #A855F7 50%, #D946EF 100%)',
                    border: isDark ? 'rgba(162,28,175,0.46)' : 'rgba(126,34,206,0.45)', glowRgb: '167,139,250',
                  },
                  {
                    label: 'Longest Streak', icon: '🔗',
                    value: `${longestStreak} day${longestStreak === 1 ? '' : 's'}`,
                    sub: currentStreak > 0 ? `${currentStreak}d current` : null,
                    bg: isDark ? 'linear-gradient(135deg, #9D174D 0%, #BE185D 48%, #86198F 100%)' : 'linear-gradient(135deg, #DB2777 0%, #EC4899 48%, #C026D3 100%)',
                    border: isDark ? 'rgba(190,24,93,0.46)' : 'rgba(219,39,119,0.46)', glowRgb: '219,39,119',
                  },
                  {
                    label: 'Peak Performance Time', icon: '⏰',
                    value: peakTime?.primary ?? '—',
                    value2: peakTime?.secondary ?? null,
                    sub: !peakTime ? 'Not enough data yet' : !peakTime.secondary ? `${peakTime.sharePct}% of focused work` : null,
                    bg: isDark ? 'linear-gradient(135deg, #5B21B6 0%, #4338CA 52%, #1D4ED8 100%)' : 'linear-gradient(135deg, #7C3AED 0%, #6366F1 52%, #3B82F6 100%)',
                    border: 'rgba(99,102,241,0.46)', glowRgb: '99,102,241',
                  },
                  {
                    label: 'Longest Session', icon: <ProductiveDot color={progressColor} size={14} />,
                    value: longestSession ? formatMs(longestSession.durationMs) : '—',
                    sub: longestSession?.actName ?? null,
                    bg: isDark ? 'linear-gradient(135deg, #1D4ED8 0%, #0369A1 52%, #0891B2 100%)' : 'linear-gradient(135deg, #2563EB 0%, #0EA5E9 52%, #22D3EE 100%)',
                    border: isDark ? 'rgba(8,145,178,0.46)' : 'rgba(14,165,233,0.45)', glowRgb: '14,165,233',
                  },
                  {
                    label: 'Total Sessions', icon: '📋',
                    value: String(totalSessionCount),
                    sub: prevYear.sessionCount > 0
                      ? `${totalSessionCount >= prevYear.sessionCount ? '↑' : '↓'} ${Math.abs(totalSessionCount - prevYear.sessionCount)} vs last year`
                      : null,
                    bg: isDark ? 'linear-gradient(135deg, #0E7490 0%, #0F766E 54%, #0D9488 100%)' : 'linear-gradient(135deg, #06B6D4 0%, #14B8A6 54%, #2DD4BF 100%)',
                    border: isDark ? 'rgba(13,148,136,0.46)' : 'rgba(20,184,166,0.44)', glowRgb: '20,184,166',
                  },
                ] as { label: string; icon: React.ReactNode; value: string; value2?: string | null; sub: string | null; bg: string; border: string; glowRgb: string }[]).map(m => (
                  <div
                    key={m.label}
                    className="rounded-2xl flex flex-col relative overflow-hidden p-2.5 xp-kpi-card"
                    style={{ '--kpi-glow-rgb': m.glowRgb, background: m.bg, border: `0.5px solid ${m.border}`, minHeight: 100 } as React.CSSProperties}
                  >
                    <div style={{ position: 'absolute', inset: 0, borderRadius: 'inherit', pointerEvents: 'none', background: 'linear-gradient(165deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.06) 38%, rgba(255,255,255,0) 100%)' }} />
                    <div style={{ width: 20, height: 20, borderRadius: 5, marginBottom: 5, flexShrink: 0, background: 'rgba(255,255,255,0.16)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#FFFFFF' }}>
                      {m.icon}
                    </div>
                    <p className="text-base sm:text-lg font-bold leading-none tabular-nums mb-1" style={{ color: '#FFFFFF' }}>{m.value}</p>
                    {m.value2 && <p className="text-base sm:text-lg font-bold leading-none tabular-nums mb-1" style={{ color: '#FFFFFF' }}>{m.value2}</p>}
                    <p className="text-[8.5px] font-medium mt-auto leading-tight tracking-wide" style={{ color: 'rgba(255,255,255,0.72)' }}>{m.label}</p>
                    {m.sub && <p className="text-[8px] mt-0.5 font-semibold" style={{ color: 'rgba(255,255,255,0.86)' }}>{m.sub}</p>}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-2xl flex flex-col justify-center relative overflow-hidden p-2.5 xp-kpi-card" style={{ '--kpi-glow-rgb': '34,197,94', background: isDark ? 'linear-gradient(135deg, #047857 0%, #15803D 52%, #4D7C0F 100%)' : 'linear-gradient(135deg, #059669 0%, #22C55E 52%, #84CC16 100%)', border: `0.5px solid ${isDark ? 'rgba(21,128,61,0.46)' : 'rgba(34,197,94,0.44)'}`, minHeight: 100 } as React.CSSProperties}>
                  <div style={{ position: 'absolute', inset: 0, borderRadius: 'inherit', pointerEvents: 'none', background: 'linear-gradient(165deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.06) 38%, rgba(255,255,255,0) 100%)' }} />
                  <p className="relative text-base sm:text-lg font-bold leading-none tabular-nums mb-1" style={{ color: '#FFFFFF' }}>{stats.completedTasks}/{stats.totalTasks}</p>
                  <p className="relative text-[8.5px] font-medium leading-tight tracking-wide" style={{ color: 'rgba(255,255,255,0.72)' }}>Tasks Completed</p>
                  {stats.totalTasks > 0 && (
                    <p className="relative text-[8px] mt-0.5 font-semibold" style={{ color: 'rgba(255,255,255,0.86)' }}>
                      {Math.round((stats.completedTasks / stats.totalTasks) * 100)}% complete
                    </p>
                  )}
                </div>
                <div className="rounded-2xl flex flex-col justify-center relative overflow-hidden p-2.5 xp-kpi-card" style={{ '--kpi-glow-rgb': '245,158,11', background: isDark ? 'linear-gradient(135deg, #78350F 0%, #92400E 50%, #B45309 100%)' : 'linear-gradient(135deg, #D97706 0%, #F59E0B 50%, #FBBF24 100%)', border: `0.5px solid ${isDark ? 'rgba(180,83,9,0.46)' : 'rgba(217,119,6,0.44)'}`, minHeight: 100 } as React.CSSProperties}>
                  <div style={{ position: 'absolute', inset: 0, borderRadius: 'inherit', pointerEvents: 'none', background: 'linear-gradient(165deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.06) 38%, rgba(255,255,255,0) 100%)' }} />
                  <div className="relative flex items-baseline gap-1.5 mb-1">
                    <span className="text-base sm:text-lg font-bold leading-none tabular-nums" style={{ color: '#FFFFFF' }}>{yearlyWinsTotal}</span>
                    <span className="text-[8.5px] font-medium" style={{ color: 'rgba(255,255,255,0.72)' }}>Yearly Wins</span>
                  </div>
                  <div className="relative" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 8, rowGap: 2 }}>
                    {([
                      { icon: <ProductiveDot color="#ffffff" size={8} />, label: 'Productive Days', value: stats.productiveDays },
                      { icon: '🔥', label: 'Hyper Productive Days', value: stats.hyperDays },
                      { icon: '🏆', label: 'Milestones Achieved', value: stats.milestoneDays },
                      { icon: '🎯', label: 'Goals Accomplished', value: stats.goalDays },
                    ] as { icon: React.ReactNode; label: string; value: number }[]).map(row => (
                      <div key={row.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 3, minWidth: 0, fontSize: 7.5, fontWeight: 700, color: 'rgba(255,255,255,0.90)' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500, color: 'rgba(255,255,255,0.78)' }}>{row.icon} {row.label}</span>
                        <span style={{ flexShrink: 0 }}>{row.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.36fr)_minmax(0,0.70fr)] items-stretch gap-3 lg:gap-4">
              <div className="rounded-2xl overflow-hidden flex flex-col justify-center" style={{ background: isDark ? 'linear-gradient(145deg,rgba(16,7,44,0.99) 0%,rgba(7,3,18,0.99) 100%)' : 'var(--xp-card)', border: isDark ? '0.5px solid rgba(124,58,237,0.35)' : '0.5px solid var(--xp-bdr2)', boxShadow: isDark ? '0 4px 36px rgba(80,0,220,0.22),0 2px 16px rgba(0,0,0,0.55)' : '0 2px 12px rgba(0,0,0,0.08)', minHeight: 280 }}>
                <GaugeMeter score={yearScore} />
              </div>

              <AchievementBanner
                tier={yearTier}
                level={yearLevel}
                isDark={isDark}
                firstName={firstName}
                dateLabel={String(currentYear)}
                periodLabel={`${currentYear}'s`}
                triggerShine={yearBadgeShine}
              />
            </div>
          </div>

          {/* ROW 2 — Yearly Progress (12 months) | Activity Breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)] items-stretch gap-3 lg:gap-4">

            <div className="rounded-2xl p-4 sm:p-5 flex flex-col" style={card1}>
              <div className="flex items-start justify-between flex-shrink-0 mb-2">
                <div>
                  <p className="text-[11px] font-semibold tracking-wide" style={{ color: isDark ? 'rgba(255,255,255,0.88)' : 'var(--xp-txt)' }}>Yearly Progress</p>
                  <p className="text-[9px] mt-0.5" style={{ color: isDark ? 'rgba(148,163,184,0.5)' : 'var(--xp-txt3)' }}>Monthly focus time across {currentYear}</p>
                </div>
                {totalMs > 0 && (
                  <div className="text-right flex-shrink-0">
                    <p className="text-[14px] font-bold tabular-nums" style={{ color: '#a78bfa' }}>{formatMs(totalMs)}</p>
                    <p className="text-[9px]" style={{ color: isDark ? 'rgba(148,163,184,0.45)' : 'var(--xp-txt3)' }}>total</p>
                  </div>
                )}
              </div>
              <div style={{ flex: 1, minHeight: 180 }}>
                <TrendBarChart key={currentYear} buckets={monthlyBuckets} isDark={isDark} emptyMessage="No focus sessions this year" />
              </div>
            </div>

            <div className="rounded-2xl p-4 sm:p-5" style={card2}>
              <p className="text-[11px] font-semibold tracking-wide mb-3" style={{ color: isDark ? 'rgba(255,255,255,0.88)' : 'var(--xp-txt)' }}>Activity Breakdown</p>
              {actBreakdown.length > 0 ? (
                <div className="flex flex-col items-center">
                  <DonutChart
                    segments={actBreakdown.map(a => ({ color: a.color, pct: totalMs > 0 ? a.ms / totalMs : 0, name: a.name, ms: a.ms }))}
                    size="lg"
                    hoveredIdx={yearActHovIdx}
                    onHoverIdx={setYearActHovIdx}
                    animate
                  />
                  <div className="w-full mt-5">
                    {actBreakdown.map((a, i) => {
                      const isHov = yearActHovIdx === i
                      const pct = totalMs > 0 ? Math.round((a.ms / totalMs) * 100) : 0
                      return (
                        <div
                          key={a.name}
                          onMouseEnter={() => setYearActHovIdx(i)}
                          onMouseLeave={() => setYearActHovIdx(null)}
                          style={{ display: 'grid', gridTemplateColumns: 'minmax(80px,1fr) 52px 32px', alignItems: 'center', gap: 4, marginBottom: 5, cursor: 'default', opacity: yearActHovIdx !== null && !isHov ? 0.5 : 1, transition: 'opacity 180ms ease' }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: a.color, boxShadow: isHov ? `0 0 5px ${a.color}88` : 'none' }} />
                            <span className="text-[9px] truncate" style={{ color: isHov ? (isDark ? 'rgba(255,255,255,0.95)' : 'var(--xp-txt)') : isDark ? 'rgba(203,213,225,0.78)' : 'var(--xp-txt2)', fontWeight: isHov ? 600 : 400 }}>{a.name}</span>
                          </div>
                          <span className="text-[9px] tabular-nums font-semibold text-right" style={{ color: isHov ? (isDark ? 'rgba(255,255,255,0.95)' : 'var(--xp-txt)') : isDark ? 'rgba(255,255,255,0.72)' : 'var(--xp-txt)' }}>{formatMs(a.ms)}</span>
                          <span className="text-[8px] tabular-nums text-right" style={{ color: isDark ? 'rgba(148,163,184,0.5)' : 'var(--xp-txt3)' }}>{pct}%</span>
                        </div>
                      )
                    })}
                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(80px,1fr) 52px 32px', alignItems: 'center', gap: 4, paddingTop: 6, borderTop: isDark ? '0.5px solid rgba(255,255,255,0.07)' : '0.5px solid var(--xp-bdr)' }}>
                      <span className="text-[9px] font-semibold" style={{ color: isDark ? 'rgba(255,255,255,0.55)' : 'var(--xp-txt3)' }}>Total</span>
                      <span className="text-[9px] font-bold tabular-nums text-right" style={{ color: isDark ? 'rgba(255,255,255,0.88)' : 'var(--xp-txt)' }}>{formatMs(totalMs)}</span>
                      <span className="text-[8px] tabular-nums text-right" style={{ color: isDark ? 'rgba(148,163,184,0.5)' : 'var(--xp-txt3)' }}>100%</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center h-24">
                  <p className="text-[10px]" style={{ color: 'var(--xp-txt3)' }}>No activity data this year</p>
                </div>
              )}
            </div>
          </div>

          {/* ROW 3 — Total Activities | Total Sessions | Pending Tasks, each
              grouped by month (collapsible) and internally scrollable, so
              none of the three cards grows taller just because a full year
              holds more data than a single month would. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 lg:gap-4">

            <div className="rounded-2xl p-3.5 flex flex-col" style={{ ...card1, maxHeight: 280 }}>
              <p className="text-[11px] font-semibold tracking-wide mb-2.5 flex-shrink-0" style={{ color: isDark ? 'rgba(255,255,255,0.88)' : 'var(--xp-txt)' }}>Total Activities</p>
              {activityMonthsWithData.length > 0 ? (
                <div className="flex-1 min-h-0 overflow-y-auto">
                  {activityMonthsWithData.map(({ m, rows }, groupIdx) => {
                    const monthTotal = rows.reduce((s, r) => s + r.ms, 0)
                    return (
                    <MonthGroup
                      key={m}
                      title={`${MONTHS[m]} ${currentYear}`}
                      summary={`${rows.length} activit${rows.length === 1 ? 'y' : 'ies'} · ${formatMs(monthTotal)}`}
                      defaultOpen={groupIdx === activityDefaultOpenIdx}
                      isDark={isDark}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {rows.map((a, idx) => {
                          const gradStr = TASK_GRAD_STRINGS[idx % TASK_GRAD_STRINGS.length]
                          const barPct = Math.round((a.ms / (rows[0]?.ms ?? 1)) * 100)
                          const totalPct = monthTotal > 0 ? Math.round((a.ms / monthTotal) * 100) : 0
                          return (
                            <div key={a.name}>
                              <div className="h-2.5 rounded-full overflow-hidden mb-1.5" style={{ background: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)' }}>
                                <div className="h-full rounded-full" style={{ width: `${Math.max(barPct, 4)}%`, background: gradStr, boxShadow: isDark ? '0 0 12px rgba(124,58,237,0.44), 0 1px 0 rgba(255,255,255,0.12) inset' : '0 1px 0 rgba(255,255,255,0.35) inset' }} />
                              </div>
                              <div className="flex items-baseline justify-between gap-2">
                                <span className="text-[9px] flex-1 min-w-0 leading-snug font-medium truncate" style={{ color: isDark ? 'rgba(203,213,225,0.88)' : 'var(--xp-txt)' }}>{a.name}</span>
                                <div className="flex-shrink-0 flex items-baseline gap-0.5">
                                  <span className="text-[9.5px] font-bold tabular-nums leading-tight" style={{ color: isDark ? 'rgba(203,213,225,0.9)' : 'var(--xp-txt)' }}>{formatMs(a.ms)}</span>
                                  <span className="text-[8px] tabular-nums leading-tight" style={{ color: isDark ? 'rgba(148,163,184,0.5)' : 'var(--xp-txt3)' }}>({totalPct}%)</span>
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </MonthGroup>
                    )
                  })}
                </div>
              ) : (
                <div className="flex items-center justify-center h-20">
                  <p className="text-[10px]" style={{ color: 'var(--xp-txt3)' }}>No activity data this year</p>
                </div>
              )}
            </div>

            <div className="rounded-2xl overflow-hidden flex flex-col" style={{ ...card2, maxHeight: 280 }}>
              <div className="px-4 py-2.5 flex-shrink-0" style={{ borderBottom: isDark ? '0.5px solid rgba(124,58,237,0.12)' : '0.5px solid rgba(0,0,0,0.08)' }}>
                <p className="text-[11px] font-semibold tracking-wide" style={{ color: isDark ? 'rgba(255,255,255,0.88)' : 'var(--xp-txt)' }}>Total Sessions</p>
              </div>
              {sessionMonthsWithData.length > 0 ? (
                <div className="flex-1 min-h-0 overflow-y-auto px-4 py-1">
                  {sessionMonthsWithData.map(({ m, rows }, groupIdx) => (
                    <MonthGroup
                      key={m}
                      title={`${MONTHS[m]} ${currentYear}`}
                      summary={`${rows.length} session${rows.length === 1 ? '' : 's'}`}
                      defaultOpen={groupIdx === sessionDefaultOpenIdx}
                      isDark={isDark}
                    >
                      <div>
                        {rows.slice(0, 8).map((s, i) => {
                          const deep = s.durationMs >= 45 * 60_000
                          return (
                            <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(70px,1fr) 44px 54px', alignItems: 'center', gap: 6, padding: '4px 0' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                                <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.actColor }} />
                                <span className="text-[9.5px] font-semibold truncate" style={{ color: isDark ? 'rgba(255,255,255,0.85)' : 'var(--xp-txt)' }}>{s.actName}</span>
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'center' }}>
                                {deep && <span className="text-[7px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(124,58,237,0.15)', color: '#a78bfa', border: '0.5px solid rgba(124,58,237,0.22)', whiteSpace: 'nowrap' }}>Deep</span>}
                              </div>
                              <span className="text-[9.5px] font-bold tabular-nums text-right" style={{ color: deep ? '#a78bfa' : isDark ? 'rgba(203,213,225,0.72)' : 'var(--xp-txt2)' }}>{formatMs(s.durationMs)}</span>
                            </div>
                          )
                        })}
                      </div>
                    </MonthGroup>
                  ))}
                </div>
              ) : (
                <div className="px-4 py-6 text-center">
                  <p className="text-[10px]" style={{ color: 'var(--xp-txt3)' }}>No sessions recorded this year</p>
                </div>
              )}
            </div>

            <div className="rounded-2xl p-3.5 flex flex-col" style={{ ...card1, maxHeight: 280 }}>
              <div className="flex items-center justify-between mb-2.5 flex-shrink-0">
                <p className="text-[11px] font-semibold tracking-wide" style={{ color: isDark ? 'rgba(255,255,255,0.88)' : 'var(--xp-txt)' }}>Pending Tasks</p>
                <span className="text-[8px] font-bold px-2 py-0.5 rounded-full" style={{ background: isDark ? 'rgba(124,58,237,0.16)' : 'rgba(124,58,237,0.07)', color: '#a78bfa', border: '0.5px solid rgba(124,58,237,0.26)' }}>
                  {totalPending} pending
                </span>
              </div>
              {pendingMonthsWithData.length > 0 ? (
                <div className="flex-1 min-h-0 overflow-y-auto">
                  {pendingMonthsWithData.map(({ m, rows }, groupIdx) => (
                    <MonthGroup
                      key={m}
                      title={`${MONTHS[m]} ${currentYear}`}
                      summary={`${rows.length} pending`}
                      defaultOpen={groupIdx === pendingDefaultOpenIdx}
                      isDark={isDark}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {rows.map(t => (
                          <div key={t.id} style={{ paddingBottom: 6, borderBottom: isDark ? '0.5px solid rgba(255,255,255,0.05)' : '0.5px solid var(--xp-bdr)' }}>
                            <p className="text-[9.5px] font-medium leading-snug truncate" style={{ color: isDark ? 'rgba(226,232,240,0.90)' : 'var(--xp-txt)' }}>{t.text}</p>
                            <p className="text-[8px] mt-0.5" style={{ color: isDark ? 'rgba(148,163,184,0.5)' : 'var(--xp-txt3)' }}>{fmtTaskDate(t.dateKey)}</p>
                          </div>
                        ))}
                      </div>
                    </MonthGroup>
                  ))}
                </div>
              ) : (
                <div className="flex items-center justify-center h-20">
                  <p className="text-[10px]" style={{ color: 'var(--xp-txt3)' }}>No pending tasks this year</p>
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}

'use client'

// ─── Weekly Dashboard ───────────────────────────────────────────────────────
// The same Analytics dashboard system as Monthly/Yearly (YearFullPage.tsx),
// just at daily resolution across one Monday–Sunday week — same KPI card
// recipe, gauge/badge layout, the shared TrendBarChart (fed 7 daily buckets
// instead of monthly/weekly ones), Activity Breakdown donut, and Total
// Activities/Sessions card styling. Total Activities and Total Sessions stay
// flat lists (exactly like Monthly's, not Yearly's month-group accordion) —
// a week's data volume doesn't need grouping. Pending Tasks groups by day
// (non-collapsible, just a header + rows per day) since the task's own date
// is useful context across up to 7 days, without the Monthly/Yearly-style
// expand/collapse interaction a week's small volume doesn't need.
//
// calData is the authoritative session source (the flat `sessions` array in
// AppContext is only ever written by the global Clock In/Out button, not
// Task Manager's per-task timers) — allTaskSessions below flattens it once
// across every date on record, same as Monthly/Yearly.
//
// Embedded-only: opens inside AnalyticsModal's own container, same
// integration pattern as Monthly's `embedded` prop and Yearly's dashboard.

import { useEffect, useMemo, useState } from 'react'
import { useApp } from './AppContext'
import { GaugeMeter } from './GaugeMeter'
import { dateKey, MONTHS, formatMs, resolveProgressColor } from './utils'
import { useDisplayFirstName } from './useDisplayFirstName'
import { AchievementBanner, PERFORMANCE_TIERS, getTaskPerformanceLevel, DonutChart, TASK_GRAD_STRINGS } from './DayDashboardModal'
import { ProductiveDot } from './LegendRow'
import { TrendBarChart, type TrendBucket } from './TrendBarChart'

type ActivityRow = { name: string; color: string; ms: number }
type SessionRow = { actName: string; actColor: string; durationMs: number }
type PendingRow = { id: string; text: string }

const DAY_ABBR = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DAY_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

// Same solid-triangle glyphs used for date-nav arrows elsewhere (Yearly's
// header, AnalyticsModal's Today scope nav) — duplicated locally per the
// existing convention rather than extracting a shared one-off primitive.
const PrevTriangle = () => (
  <svg width="7" height="10" viewBox="0 0 9 12" fill="currentColor" aria-hidden="true"><path d="M9 0 L0 6 L9 12 Z" /></svg>
)
const NextTriangle = () => (
  <svg width="7" height="10" viewBox="0 0 9 12" fill="currentColor" aria-hidden="true"><path d="M0 0 L9 6 L0 12 Z" /></svg>
)

// Monday→Sunday week definition, matching the exact offset formula
// AnalyticsPage.tsx's getCurrentWeekRange already uses (not a different
// convention): Sunday (getDay()===0) rolls back 6 days to the prior Monday,
// any other day rolls back (day-1).
function mondayOf(d: Date): Date {
  const offset = d.getDay() === 0 ? 6 : d.getDay() - 1
  const m = new Date(d)
  m.setDate(d.getDate() - offset)
  m.setHours(0, 0, 0, 0)
  return m
}

function fmtWeekRange(monday: Date): string {
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  const sameMonth = monday.getMonth() === sunday.getMonth()
  const sameYear = monday.getFullYear() === sunday.getFullYear()
  if (sameMonth) return `${MONTHS[monday.getMonth()].slice(0, 3)} ${monday.getDate()}–${sunday.getDate()}, ${sunday.getFullYear()}`
  if (sameYear) return `${MONTHS[monday.getMonth()].slice(0, 3)} ${monday.getDate()} – ${MONTHS[sunday.getMonth()].slice(0, 3)} ${sunday.getDate()}, ${sunday.getFullYear()}`
  return `${MONTHS[monday.getMonth()].slice(0, 3)} ${monday.getDate()}, ${monday.getFullYear()} – ${MONTHS[sunday.getMonth()].slice(0, 3)} ${sunday.getDate()}, ${sunday.getFullYear()}`
}

interface WeekFullPageProps {
  onClose: () => void
}

export function WeekFullPage({ onClose }: WeekFullPageProps) {
  const { calData, activities, isDark, progressColor: _rawColor } = useApp()
  const progressColor = resolveProgressColor(_rawColor, isDark)
  const firstName = useDisplayFirstName()

  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()))
  // Blocks navigating into a completely future week with no historical data.
  const isCurrentWeek = weekStart.getTime() === mondayOf(new Date()).getTime()

  const weekDates = useMemo(
    () => Array.from({ length: 7 }, (_, i) => { const d = new Date(weekStart); d.setDate(weekStart.getDate() + i); return d }),
    [weekStart]
  )
  const weekKeys = useMemo(
    () => weekDates.map(d => dateKey(d.getFullYear(), d.getMonth(), d.getDate())),
    [weekDates]
  )

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

  const weekKeySet = useMemo(() => new Set(weekKeys), [weekKeys])
  const weekSessions = useMemo(
    () => allTaskSessions.filter(s => weekKeySet.has(s.dateKey)),
    [allTaskSessions, weekKeySet]
  )
  const totalMs = useMemo(
    () => weekSessions.reduce((sum, s) => sum + (s.endTs - s.startTs), 0),
    [weekSessions]
  )

  // Per-day breakdown — a single pass over the week's 7 days feeds the
  // chart buckets, the activity/session/pending aggregations, and the
  // streak/productive-day flags below, all from the same calData reads.
  const dayData = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return weekDates.map((d, i) => {
      const key = weekKeys[i]
      const day = calData[key]
      const sessions: SessionRow[] = []
      const pending: PendingRow[] = []
      const actMs = new Map<string, number>()
      let completedCount = 0
      let ms = 0
      if (day) {
        for (const t of day.tasks) {
          const act = activities.find(a => a.id === t.actId)
          for (const s of t.sessions) {
            if (s.endTs !== null) {
              const dur = s.endTs - s.startTs
              ms += dur
              if (t.actId) actMs.set(t.actId, (actMs.get(t.actId) ?? 0) + dur)
              sessions.push({ actName: act?.name ?? 'Other', actColor: act?.color ?? '#94a3b8', durationMs: dur })
            }
          }
          if (t.done) completedCount++
          else pending.push({ id: t.id, text: t.text })
        }
      }
      sessions.sort((a, b) => b.durationMs - a.durationMs)
      const dDate = new Date(d)
      dDate.setHours(0, 0, 0, 0)
      return {
        date: d, ms, sessions, pending, actMs,
        completedCount, totalTasks: day?.tasks.length ?? 0,
        isFuture: dDate > today,
        isCurrent: dDate.getTime() === today.getTime(),
        productive: !!(day?.productive || day?.hyper || day?.milestone || day?.goal),
        hyper: !!day?.hyper, milestone: !!day?.milestone, goal: !!day?.goal,
      }
    })
  }, [weekDates, weekKeys, calData, activities])

  // Weekly Progress — 7 daily buckets, feeding the exact same shared
  // bar+curve chart Monthly/Yearly Dashboard use (TrendBarChart), rather
  // than a parallel chart implementation. A past day with legitimately 0
  // hours still gets a real point; a future day is excluded from the trend
  // line/points entirely (TrendBarChart's isFuture/lastActiveIdx handling).
  const dailyBuckets = useMemo((): TrendBucket[] => {
    return dayData.map((d, i) => ({
      label: DAY_ABBR[i],
      ms: d.ms,
      crossMonth: null,
      isFuture: d.isFuture,
      isCurrent: d.isCurrent,
      tooltipLabel: `${DAY_FULL[i]}, ${MONTHS[d.date.getMonth()]} ${d.date.getDate()}`,
      detail: d.isFuture ? undefined : [
        `${d.sessions.length} session${d.sessions.length === 1 ? '' : 's'}`,
        `${d.completedCount} task${d.completedCount === 1 ? '' : 's'} completed`,
      ],
    }))
  }, [dayData])

  // Activity Breakdown (donut) and Total Activities (bars) share this same
  // week-wide aggregation — exactly how Monthly's single actBreakdown feeds
  // both of its own cards.
  const actBreakdown = useMemo((): ActivityRow[] => {
    const combined = new Map<string, number>()
    for (const d of dayData) for (const [actId, ms] of d.actMs) combined.set(actId, (combined.get(actId) ?? 0) + ms)
    return Array.from(combined.entries()).map(([actId, ms]) => {
      const act = activities.find(a => a.id === actId)
      return { name: act?.name ?? 'Other', color: act?.color ?? '#94a3b8', ms }
    }).sort((a, b) => b.ms - a.ms).slice(0, 7)
  }, [dayData, activities])

  const weekTopSessions = useMemo(
    () => dayData.flatMap(d => d.sessions).sort((a, b) => b.durationMs - a.durationMs).slice(0, 10),
    [dayData]
  )

  const pendingByDay = useMemo(
    () => dayData.map((d, i) => ({ i, date: d.date, pending: d.pending })).filter(x => x.pending.length > 0),
    [dayData]
  )
  const totalPending = useMemo(() => dayData.reduce((s, d) => s + d.pending.length, 0), [dayData])

  // ── Weekly KPI card data (days-worked remaining, vs-last-week deltas, peak
  //    time-of-day window) — all derived from the same calData/sessions this
  //    dashboard already uses, no new data sources. ──────────────────────────

  const stats = useMemo(() => ({
    productiveDays: dayData.filter(d => d.productive).length,
    hyperDays: dayData.filter(d => d.hyper).length,
    milestoneDays: dayData.filter(d => d.milestone).length,
    goalDays: dayData.filter(d => d.goal).length,
    completedTasks: dayData.reduce((s, d) => s + d.completedCount, 0),
    totalTasks: dayData.reduce((s, d) => s + d.totalTasks, 0),
    totalDays: 7,
  }), [dayData])

  const todayKey = useMemo(() => {
    const t = new Date()
    return dateKey(t.getFullYear(), t.getMonth(), t.getDate())
  }, [])
  const todayIdxInWeek = weekKeys.indexOf(todayKey)

  const daysRemaining = useMemo(() => {
    if (!isCurrentWeek || todayIdxInWeek < 0) return 0
    return Math.max(6 - todayIdxInWeek, 0)
  }, [isCurrentWeek, todayIdxInWeek])

  const prevWeek = useMemo(() => {
    const prevMonday = new Date(weekStart)
    prevMonday.setDate(weekStart.getDate() - 7)
    const pKeySet = new Set(Array.from({ length: 7 }, (_, i) => {
      const d = new Date(prevMonday); d.setDate(prevMonday.getDate() + i)
      return dateKey(d.getFullYear(), d.getMonth(), d.getDate())
    }))
    const pSessions = allTaskSessions.filter(s => pKeySet.has(s.dateKey))
    const pTotalMs = pSessions.reduce((sum, s) => sum + (s.endTs - s.startTs), 0)
    return { totalMs: pTotalMs, sessionCount: pSessions.length }
  }, [allTaskSessions, weekStart])

  const { currentStreak, longestStreak } = useMemo(() => {
    let longest = 0, run = 0
    for (const d of dayData) { if (d.productive) { run++; if (run > longest) longest = run } else run = 0 }
    const lastIdx = isCurrentWeek && todayIdxInWeek >= 0 ? todayIdxInWeek : 6
    let current = 0
    for (let i = lastIdx; i >= 0; i--) { if (dayData[i].productive) current++; else break }
    return { currentStreak: current, longestStreak: longest }
  }, [dayData, isCurrentWeek, todayIdxInWeek])

  // Peak Performance Time — identical 2-hour time-of-day bucket algorithm
  // Monthly/Yearly Dashboard use, fed this week's sessions instead.
  const peakTime = useMemo(() => {
    const completed = weekSessions
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
  }, [weekSessions])

  const longestSession = weekTopSessions[0] ?? null
  const totalSessionCount = weekSessions.length
  const weeklyWinsTotal = stats.goalDays + stats.milestoneDays + stats.hyperDays + stats.productiveDays

  // Weekly Performance score/badge — same tiered scoring shape Monthly/Yearly
  // use (productive-day rate + accumulated hours + wins), with the hour
  // thresholds scaled down for a week's realistic totals. `elapsed` only
  // counts days that have actually occurred so future days in the current
  // week never unfairly lower the rate.
  const weekScore = useMemo(() => {
    const elapsed = isCurrentWeek ? (todayIdxInWeek >= 0 ? todayIdxInWeek + 1 : 7) : 7
    const rate = elapsed > 0 ? (stats.productiveDays / elapsed) * 100 : 0
    const hours = totalMs / 3_600_000
    let score = 0
    if (rate >= 30) score += 20; if (rate >= 50) score += 20
    if (rate >= 70) score += 15; if (rate >= 90) score += 15
    if (hours >= 2) score += 10; if (hours >= 5) score += 5
    if (stats.hyperDays >= 1)     score += 8
    if (stats.milestoneDays >= 1) score += 5
    if (stats.goalDays >= 1)      score += 2
    return Math.min(100, score)
  }, [stats, totalMs, isCurrentWeek, todayIdxInWeek])

  const weekLevel = getTaskPerformanceLevel(weekScore)
  const weekTier  = PERFORMANCE_TIERS[weekLevel]
  const [weekBadgeShine, setWeekBadgeShine] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setWeekBadgeShine(true), 900)
    return () => clearTimeout(t)
  }, [weekStart])

  const [weekActHovIdx, setWeekActHovIdx] = useState<number | null>(null)

  const S1  = isDark ? 'rgba(15,8,36,0.99)'  : '#ffffff'
  const S2  = isDark ? 'rgba(20,11,46,0.98)' : 'var(--xp-card)'
  const BDR = isDark ? 'rgba(124,58,237,0.22)' : 'rgba(0,0,0,0.09)'
  const card1: React.CSSProperties = { background: S1, border: `0.5px solid ${BDR}`, boxShadow: isDark ? '0 2px 20px rgba(0,0,0,0.42)' : '0 1px 10px rgba(0,0,0,0.07)' }
  const card2: React.CSSProperties = { background: S2, border: `0.5px solid ${BDR}`, boxShadow: isDark ? '0 2px 18px rgba(0,0,0,0.38)' : '0 1px 6px rgba(0,0,0,0.05)' }

  return (
    <div className="w-full h-full flex flex-col overflow-hidden">
      {/* ── Header — same single-row nav pattern Yearly's header established:
           arrow-only Back, centered "Weekly Dashboard - <range>" with
           prev/next week triangles either side. ── */}
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

        <div className="absolute left-1/2 flex items-center gap-3" style={{ top: '50%', transform: 'translate(-50%,-50%)' }}>
          <button
            onClick={() => setWeekStart(d => { const n = new Date(d); n.setDate(d.getDate() - 7); return n })}
            aria-label="Previous week"
            className="flex items-center justify-center rounded-full transition-colors hover:bg-white/10 flex-shrink-0"
            style={{ width: 22, height: 22, color: 'rgba(255,255,255,0.75)', background: 'transparent', border: 'none', cursor: 'pointer' }}
          ><PrevTriangle /></button>
          <span style={{ fontSize: 16, fontWeight: 700, color: 'white', letterSpacing: '-0.02em', whiteSpace: 'nowrap', textShadow: '0 1px 4px rgba(0,0,0,0.30)', lineHeight: 1.2 }}>
            Weekly Dashboard - {fmtWeekRange(weekStart)}
          </span>
          <button
            onClick={() => setWeekStart(d => { const n = new Date(d); n.setDate(d.getDate() + 7); return n })}
            disabled={isCurrentWeek}
            aria-label="Next week"
            className={`flex items-center justify-center rounded-full transition-colors flex-shrink-0 ${isCurrentWeek ? '' : 'hover:bg-white/10'}`}
            style={{
              width: 22, height: 22,
              color: isCurrentWeek ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.75)',
              background: 'transparent', border: 'none',
              cursor: isCurrentWeek ? 'default' : 'pointer',
            }}
          ><NextTriangle /></button>
        </div>
      </div>

      {/* ── Scrollable body — content-driven height on desktop/tablet (matches
           the Analytics modal host's own auto-height card), internal scroll
           on mobile — identical split Monthly/Yearly's embedded mode uses. ── */}
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
                    sub: prevWeek.totalMs > 0
                      ? `${totalMs >= prevWeek.totalMs ? '↑' : '↓'} ${formatMs(Math.abs(totalMs - prevWeek.totalMs))} vs last week`
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
                    sub: prevWeek.sessionCount > 0
                      ? `${totalSessionCount >= prevWeek.sessionCount ? '↑' : '↓'} ${Math.abs(totalSessionCount - prevWeek.sessionCount)} vs last week`
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
                    <span className="text-base sm:text-lg font-bold leading-none tabular-nums" style={{ color: '#FFFFFF' }}>{weeklyWinsTotal}</span>
                    <span className="text-[8.5px] font-medium" style={{ color: 'rgba(255,255,255,0.72)' }}>Weekly Wins</span>
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
                <GaugeMeter score={weekScore} />
              </div>

              <AchievementBanner
                tier={weekTier}
                level={weekLevel}
                isDark={isDark}
                firstName={firstName}
                dateLabel={fmtWeekRange(weekStart)}
                periodLabel="this week's"
                triggerShine={weekBadgeShine}
              />
            </div>
          </div>

          {/* ROW 2 — Weekly Progress (7 days) | Activity Breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)] items-stretch gap-3 lg:gap-4">

            <div className="rounded-2xl p-4 sm:p-5 flex flex-col" style={card1}>
              <div className="flex items-start justify-between flex-shrink-0 mb-2">
                <div>
                  <p className="text-[11px] font-semibold tracking-wide" style={{ color: isDark ? 'rgba(255,255,255,0.88)' : 'var(--xp-txt)' }}>Weekly Progress</p>
                  <p className="text-[9px] mt-0.5" style={{ color: isDark ? 'rgba(148,163,184,0.5)' : 'var(--xp-txt3)' }}>Daily focus time, {fmtWeekRange(weekStart)}</p>
                </div>
                {totalMs > 0 && (
                  <div className="text-right flex-shrink-0">
                    <p className="text-[14px] font-bold tabular-nums" style={{ color: '#a78bfa' }}>{formatMs(totalMs)}</p>
                    <p className="text-[9px]" style={{ color: isDark ? 'rgba(148,163,184,0.45)' : 'var(--xp-txt3)' }}>total</p>
                  </div>
                )}
              </div>
              <div style={{ flex: 1, minHeight: 180 }}>
                <TrendBarChart key={weekStart.getTime()} buckets={dailyBuckets} isDark={isDark} emptyMessage="No focus sessions this week" />
              </div>
            </div>

            <div className="rounded-2xl p-4 sm:p-5" style={card2}>
              <p className="text-[11px] font-semibold tracking-wide mb-3" style={{ color: isDark ? 'rgba(255,255,255,0.88)' : 'var(--xp-txt)' }}>Activity Breakdown</p>
              {actBreakdown.length > 0 ? (
                <div className="flex flex-col items-center">
                  <DonutChart
                    segments={actBreakdown.map(a => ({ color: a.color, pct: totalMs > 0 ? a.ms / totalMs : 0, name: a.name, ms: a.ms }))}
                    size="lg"
                    hoveredIdx={weekActHovIdx}
                    onHoverIdx={setWeekActHovIdx}
                    animate
                  />
                  <div className="w-full mt-5">
                    {actBreakdown.map((a, i) => {
                      const isHov = weekActHovIdx === i
                      const pct = totalMs > 0 ? Math.round((a.ms / totalMs) * 100) : 0
                      return (
                        <div
                          key={a.name}
                          onMouseEnter={() => setWeekActHovIdx(i)}
                          onMouseLeave={() => setWeekActHovIdx(null)}
                          style={{ display: 'grid', gridTemplateColumns: 'minmax(80px,1fr) 52px 32px', alignItems: 'center', gap: 4, marginBottom: 5, cursor: 'default', opacity: weekActHovIdx !== null && !isHov ? 0.5 : 1, transition: 'opacity 180ms ease' }}
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
                  <p className="text-[10px]" style={{ color: 'var(--xp-txt3)' }}>No activity data this week</p>
                </div>
              )}
            </div>
          </div>

          {/* ROW 3 — Total Activities | Total Sessions | Pending Tasks. Flat
              lists (not grouped/collapsible) for Activities/Sessions — a
              week's volume doesn't need it, exactly like Monthly's own ROW 3.
              Pending Tasks groups by day (plain headers, no expand/collapse)
              since the task's date is useful context across up to 7 days. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 lg:gap-4">

            <div className="rounded-2xl p-3.5" style={card1}>
              <p className="text-[11px] font-semibold tracking-wide mb-2.5" style={{ color: isDark ? 'rgba(255,255,255,0.88)' : 'var(--xp-txt)' }}>Total Activities</p>
              {actBreakdown.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {actBreakdown.map((a, idx) => {
                    const gradStr  = TASK_GRAD_STRINGS[idx % TASK_GRAD_STRINGS.length]
                    const barPct   = Math.round((a.ms / (actBreakdown[0]?.ms ?? 1)) * 100)
                    const totalPct = totalMs > 0 ? Math.round((a.ms / totalMs) * 100) : 0
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
              ) : (
                <div className="flex items-center justify-center h-20">
                  <p className="text-[10px]" style={{ color: 'var(--xp-txt3)' }}>No activity data this week</p>
                </div>
              )}
            </div>

            <div className="rounded-2xl overflow-hidden" style={card2}>
              <div className="px-4 py-2.5" style={{ borderBottom: isDark ? '0.5px solid rgba(124,58,237,0.12)' : '0.5px solid rgba(0,0,0,0.08)' }}>
                <p className="text-[11px] font-semibold tracking-wide" style={{ color: isDark ? 'rgba(255,255,255,0.88)' : 'var(--xp-txt)' }}>Total Sessions</p>
              </div>
              {weekTopSessions.length > 0 ? (
                <div>
                  {weekTopSessions.slice(0, 8).map((s, i) => {
                    const deep = s.durationMs >= 45 * 60_000
                    return (
                      <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(86px,1fr) 44px 54px', alignItems: 'center', gap: 6, padding: '5px 14px', borderBottom: i < Math.min(weekTopSessions.length, 8) - 1 ? isDark ? '0.5px solid rgba(124,58,237,0.08)' : '0.5px solid var(--xp-bdr)' : 'none' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                          <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.actColor }} />
                          <span className="text-[10px] font-semibold truncate" style={{ color: isDark ? 'rgba(255,255,255,0.85)' : 'var(--xp-txt)' }}>{s.actName}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'center' }}>
                          {deep && <span className="text-[7px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(124,58,237,0.15)', color: '#a78bfa', border: '0.5px solid rgba(124,58,237,0.22)', whiteSpace: 'nowrap' }}>Deep</span>}
                        </div>
                        <span className="text-[10px] font-bold tabular-nums text-right" style={{ color: deep ? '#a78bfa' : isDark ? 'rgba(203,213,225,0.72)' : 'var(--xp-txt2)' }}>{formatMs(s.durationMs)}</span>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="px-4 py-6 text-center">
                  <p className="text-[10px]" style={{ color: 'var(--xp-txt3)' }}>No sessions recorded this week</p>
                </div>
              )}
            </div>

            <div className="rounded-2xl p-3.5 flex flex-col" style={{ ...card1, maxHeight: 240 }}>
              <div className="flex items-center justify-between mb-2.5 flex-shrink-0">
                <p className="text-[11px] font-semibold tracking-wide" style={{ color: isDark ? 'rgba(255,255,255,0.88)' : 'var(--xp-txt)' }}>Pending Tasks</p>
                <span className="text-[8px] font-bold px-2 py-0.5 rounded-full" style={{ background: isDark ? 'rgba(124,58,237,0.16)' : 'rgba(124,58,237,0.07)', color: '#a78bfa', border: '0.5px solid rgba(124,58,237,0.26)' }}>
                  {totalPending} pending
                </span>
              </div>
              {pendingByDay.length > 0 ? (
                <div className="flex-1 min-h-0 overflow-y-auto" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {pendingByDay.map(({ i, date, pending }) => (
                    <div key={i}>
                      <p className="text-[9.5px] font-semibold mb-1.5" style={{ color: isDark ? 'rgba(203,213,225,0.75)' : 'var(--xp-txt2)' }}>
                        {DAY_FULL[i]}, {MONTHS[date.getMonth()].slice(0, 3)} {date.getDate()} · {pending.length} pending
                      </p>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {pending.map(t => (
                          <p key={t.id} className="text-[9.5px] font-medium leading-snug truncate" style={{ color: isDark ? 'rgba(226,232,240,0.90)' : 'var(--xp-txt)', paddingBottom: 6, borderBottom: isDark ? '0.5px solid rgba(255,255,255,0.05)' : '0.5px solid var(--xp-bdr)' }}>
                            {t.text}
                          </p>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center justify-center h-20">
                  <p className="text-[10px]" style={{ color: 'var(--xp-txt3)' }}>No pending tasks this week</p>
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}

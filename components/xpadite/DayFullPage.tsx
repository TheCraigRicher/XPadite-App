'use client'

// ─── Daily Dashboard (Analytics) ───────────────────────────────────────────
// Monthly Dashboard is the design origin for the whole Analytics family
// (Weekly/Monthly/Yearly/Daily); this component mirrors its exact KPI card
// recipe, gauge/badge layout, Progress chart (the shared TrendBarChart, fed
// hourly buckets instead of weekly/monthly ones), Activity Breakdown donut,
// and flat Total Activities/Sessions/Pending Tasks cards — only the DATA
// resolution changes (one calendar day instead of a month/week/year).
//
// This is a NEW, separate component from the existing DayDashboardModal.tsx
// (opened by Task Manager's own "Today's Dashboard" button) — that component
// has its own established, already-polished bespoke layout used in multiple
// places across the app, and rewriting it would change it everywhere it's
// used, not just inside Analytics. DayFullPage exists specifically for the
// Analytics modal's "Today" card, alongside WeekFullPage/YearFullPage, so the
// Analytics dashboard family is visually consistent without touching the
// Task Manager entry point's own Daily Dashboard.
//
// calData is the authoritative session source (the flat `sessions` array in
// AppContext is only ever written by the global Clock In/Out button, not
// Task Manager's per-task timers).

import { useEffect, useMemo, useState } from 'react'
import { useApp } from './AppContext'
import { GaugeMeter } from './GaugeMeter'
import { dateKey, formatMs, resolveProgressColor, isProductiveActivity } from './utils'
import { useDisplayFirstName } from './useDisplayFirstName'
import { AchievementBanner, PERFORMANCE_TIERS, getTaskPerformanceLevel, DonutChart, TASK_GRAD_STRINGS } from './DayDashboardModal'
import { ProductiveDot } from './LegendRow'
import { TrendBarChart, type TrendBucket } from './TrendBarChart'

type ActivityRow = { name: string; color: string; ms: number }
type SessionRow = { actName: string; actColor: string; durationMs: number; startTs: number }
type PendingRow = { id: string; text: string }

const HOUR_LABELS = ['12 AM', '3 AM', '6 AM', '9 AM', '12 PM', '3 PM', '6 PM', '9 PM']

// Same solid-triangle glyphs used for date-nav arrows elsewhere (Weekly's
// header, AnalyticsModal's Today scope nav) — duplicated locally per the
// existing convention rather than extracting a shared one-off primitive.
const PrevTriangle = () => (
  <svg width="7" height="10" viewBox="0 0 9 12" fill="currentColor" aria-hidden="true"><path d="M9 0 L0 6 L9 12 Z" /></svg>
)
const NextTriangle = () => (
  <svg width="7" height="10" viewBox="0 0 9 12" fill="currentColor" aria-hidden="true"><path d="M0 0 L9 6 L0 12 Z" /></svg>
)

function startOfDay(d: Date): Date {
  const n = new Date(d)
  n.setHours(0, 0, 0, 0)
  return n
}

function fmtDayLabel(d: Date): string {
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })
}

function getSessionDurationMs(startTs: number, endTs: number): number {
  let d = endTs - startTs
  if (d < 0) d += 86_400_000
  return Math.max(d, 0)
}

interface DayFullPageProps {
  onClose: () => void
}

export function DayFullPage({ onClose }: DayFullPageProps) {
  const { calData, activities, isDark, progressColor: _rawColor } = useApp()
  const progressColor = resolveProgressColor(_rawColor, isDark)
  const firstName = useDisplayFirstName()

  const [selectedDate, setSelectedDate] = useState(() => startOfDay(new Date()))
  // Blocks navigating into a future date with no historical data.
  const isToday = selectedDate.getTime() === startOfDay(new Date()).getTime()
  const selectedKey = dateKey(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate())

  // ── Data computations (all keyed to selectedDate) ──────────────────────────

  const dayRecord = calData[selectedKey]

  // Same per-day breakdown shape Week/YearFullPage build, just for one day:
  // one pass over the day's tasks feeds sessions, activity totals and
  // pending tasks together.
  const dayStats = useMemo(() => {
    const sessions: SessionRow[] = []
    const pending: PendingRow[] = []
    const actMs = new Map<string, number>()
    let completedCount = 0
    let totalMs = 0
    let longestMs = 0
    let deepWorkMs = 0

    if (dayRecord) {
      for (const t of dayRecord.tasks) {
        const act = activities.find(a => a.id === t.actId)
        for (const s of t.sessions) {
          if (s.endTs !== null) {
            const dur = getSessionDurationMs(s.startTs, s.endTs)
            if (isProductiveActivity(activities, t.actId)) {
              totalMs += dur
              if (dur > longestMs) longestMs = dur
              if (dur >= 45 * 60_000) deepWorkMs += dur
              if (t.actId) actMs.set(t.actId, (actMs.get(t.actId) ?? 0) + dur)
              sessions.push({ actName: act?.name ?? 'Other', actColor: act?.color ?? '#94a3b8', durationMs: dur, startTs: s.startTs })
            }
          }
        }
        if (t.done) completedCount++
        else pending.push({ id: t.id, text: t.text })
      }
    }
    sessions.sort((a, b) => b.durationMs - a.durationMs)

    const actBreakdown: ActivityRow[] = Array.from(actMs.entries())
      .map(([actId, ms]) => {
        const act = activities.find(a => a.id === actId)
        return { name: act?.name ?? 'Other', color: act?.color ?? '#94a3b8', ms }
      })
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 7)

    const totalTasks = dayRecord?.tasks.length ?? 0

    // Same day-level scoring DayDashboardModal already uses (completion rate
    // + productive hours thresholds + longest-session thresholds + hyper
    // bonus), reused as-is rather than inventing a separate formula.
    let score = 0
    if (completedCount > 0) score += 20
    if (totalTasks > 0) score += Math.round((completedCount / totalTasks) * 20)
    const hrs = totalMs / 3_600_000
    if (hrs >= 1) score += 15; if (hrs >= 3) score += 15; if (hrs >= 6) score += 10
    if (longestMs >= 45 * 60_000) score += 10; if (longestMs >= 90 * 60_000) score += 5
    if (dayRecord?.hyper) score += 5
    score = Math.min(100, score)

    return {
      sessions, pending, actBreakdown, totalMs, longestMs, deepWorkMs, score,
      completedCount, totalTasks,
      productive: !!(dayRecord?.productive || dayRecord?.hyper || dayRecord?.milestone || dayRecord?.goal),
      hyper: !!dayRecord?.hyper, milestone: !!dayRecord?.milestone, goal: !!dayRecord?.goal,
    }
  }, [dayRecord, activities])

  // Daily Progress — 8 three-hour buckets across the day, feeding the exact
  // same shared bar+curve chart Monthly/Weekly/Yearly Dashboard use
  // (TrendBarChart), rather than a parallel chart implementation.
  const hourlyBuckets = useMemo((): TrendBucket[] => {
    const now = new Date()
    const currentHour = now.getHours()
    return HOUR_LABELS.map((label, i) => {
      const startHour = i * 3
      const endHour = startHour + 3
      let ms = 0
      let sessionCount = 0
      for (const s of dayStats.sessions) {
        const h = new Date(s.startTs).getHours()
        if (h >= startHour && h < endHour) { ms += s.durationMs; sessionCount++ }
      }
      const isFuture = isToday ? startHour > currentHour : selectedDate > now
      const isCurrent = isToday && currentHour >= startHour && currentHour < endHour
      return {
        label, ms, crossMonth: null, isFuture, isCurrent,
        tooltipLabel: `${label} – ${HOUR_LABELS[i + 1] ?? '12 AM'}`,
        detail: isFuture ? undefined : [`${sessionCount} session${sessionCount === 1 ? '' : 's'}`],
      }
    })
  }, [dayStats.sessions, isToday, selectedDate])

  // Peak Performance Time — identical 2-hour time-of-day bucket algorithm
  // Monthly/Weekly/Yearly Dashboard use, fed this day's sessions.
  const peakTime = useMemo(() => {
    const completed = dayStats.sessions
    if (completed.length < 3) return null

    const BUCKET_HOURS = 2
    const NUM_BUCKETS = 24 / BUCKET_HOURS
    const counts = new Array(NUM_BUCKETS).fill(0) as number[]
    const durations = new Array(NUM_BUCKETS).fill(0) as number[]
    for (const s of completed) {
      const bucket = Math.floor(new Date(s.startTs).getHours() / BUCKET_HOURS)
      counts[bucket] += 1
      durations[bucket] += s.durationMs
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
  }, [dayStats.sessions])

  // Longest Streak — consecutive productive days ending at (or, for a past
  // date, ending AT) the selected day, scanned across the user's full
  // history. "Current streak" below is the same run, from the user's
  // perspective of "as of this day."
  const { currentStreak, longestStreak } = useMemo(() => {
    const isProd = (k: string) => { const d = calData[k]; return !!(d?.productive || d?.hyper || d?.milestone || d?.goal) }
    const allKeys = Object.keys(calData).filter(k => k <= selectedKey).sort()
    let longest = 0, run = 0
    for (const k of allKeys) { if (isProd(k)) { run++; if (run > longest) longest = run } else run = 0 }
    let current = 0
    for (let i = allKeys.length - 1; i >= 0; i--) { if (isProd(allKeys[i])) current++; else break }
    return { currentStreak: current, longestStreak: longest }
  }, [calData, selectedKey])

  const longestSession = dayStats.sessions[0] ?? null
  const dailyWinsTotal = (dayStats.productive ? 1 : 0) + (dayStats.hyper ? 1 : 0) + (dayStats.milestone ? 1 : 0) + (dayStats.goal ? 1 : 0)

  const dayScore = dayStats.score
  const dayLevel = getTaskPerformanceLevel(dayScore)
  const dayTier  = PERFORMANCE_TIERS[dayLevel]
  const [dayBadgeShine, setDayBadgeShine] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setDayBadgeShine(true), 900)
    return () => clearTimeout(t)
  }, [selectedKey])

  const [dayActHovIdx, setDayActHovIdx] = useState<number | null>(null)

  const S1  = isDark ? 'rgba(15,8,36,0.99)'  : '#ffffff'
  const S2  = isDark ? 'rgba(20,11,46,0.98)' : 'var(--xp-card)'
  const BDR = isDark ? 'rgba(124,58,237,0.22)' : 'rgba(0,0,0,0.09)'
  const card1: React.CSSProperties = { background: S1, border: `0.5px solid ${BDR}`, boxShadow: isDark ? '0 2px 20px rgba(0,0,0,0.42)' : '0 1px 10px rgba(0,0,0,0.07)' }
  const card2: React.CSSProperties = { background: S2, border: `0.5px solid ${BDR}`, boxShadow: isDark ? '0 2px 18px rgba(0,0,0,0.38)' : '0 1px 6px rgba(0,0,0,0.05)' }
  // Shared FIXED (not max) height for Total Activities / Total Sessions /
  // Pending Tasks — the three cards' outer boxes must always align exactly,
  // never grow or shrink with their own content; each scrolls internally.
  const ROW3_CARD_H = 240

  return (
    <div className="w-full h-full flex flex-col overflow-hidden">
      {/* ── Header — same fixed-position nav cluster Weekly's header
           established: prev/next triangles flanking "Daily Dashboard" on
           the first line, the selected date on its own line below. ── */}
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

        <div className="absolute left-1/2 flex flex-col items-center" style={{ top: '50%', transform: 'translate(-50%,-50%)' }}>
          <div className="flex items-center gap-7">
            <button
              onClick={() => setSelectedDate(d => { const n = new Date(d); n.setDate(d.getDate() - 1); return n })}
              aria-label="Previous day"
              className="flex items-center justify-center rounded-full transition-colors hover:bg-white/10 flex-shrink-0"
              style={{ width: 23, height: 23, color: 'rgba(255,255,255,0.75)', background: 'transparent', border: 'none', cursor: 'pointer' }}
            ><PrevTriangle /></button>
            <span style={{ fontSize: 15, fontWeight: 700, color: 'white', letterSpacing: '-0.02em', whiteSpace: 'nowrap', textShadow: '0 1px 4px rgba(0,0,0,0.30)', lineHeight: 1.2 }}>
              Daily Dashboard
            </span>
            <button
              onClick={() => setSelectedDate(d => { const n = new Date(d); n.setDate(d.getDate() + 1); return n })}
              disabled={isToday}
              aria-label="Next day"
              className={`flex items-center justify-center rounded-full transition-colors flex-shrink-0 ${isToday ? '' : 'hover:bg-white/10'}`}
              style={{
                width: 23, height: 23,
                color: isToday ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.75)',
                background: 'transparent', border: 'none',
                cursor: isToday ? 'default' : 'pointer',
              }}
            ><NextTriangle /></button>
          </div>
          <span style={{ fontSize: 10.5, fontWeight: 600, marginTop: 2, color: 'rgba(255,255,255,0.75)', whiteSpace: 'nowrap' }}>
            {fmtDayLabel(selectedDate)}
          </span>
        </div>

        {!isToday && (
          <button
            onClick={() => setSelectedDate(startOfDay(new Date()))}
            className="absolute right-4 flex items-center flex-shrink-0 whitespace-nowrap"
            style={{
              top: '50%', transform: 'translateY(-50%)',
              fontSize: 10, fontWeight: 700, padding: '4px 9px', borderRadius: 20,
              background: 'rgba(255,255,255,0.14)', color: '#ffffff', border: '0.5px solid rgba(255,255,255,0.28)',
              cursor: 'pointer',
            }}
          >Today</button>
        )}
      </div>

      {/* ── Scrollable body — content-driven height on desktop/tablet (matches
           the Analytics modal host's own auto-height card), internal scroll
           on mobile — identical split Monthly/Weekly/Yearly's embedded mode
           uses. ── */}
      <div className="flex-1 overflow-y-auto sm:flex-none sm:overflow-visible" style={{ minHeight: 0, WebkitOverflowScrolling: 'touch' }}>
        <div className="p-3 sm:p-4 lg:p-5 space-y-3 lg:space-y-4" style={{ background: isDark ? 'rgba(9,4,22,0.99)' : 'var(--xp-bg3)' }}>

          {/* ROW 1 — KPI area | (Performance Analytics + Performance Badge) */}
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.52fr)_minmax(0,2.06fr)] items-stretch gap-3 lg:gap-4">

            <div className="flex flex-col gap-2">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 content-start">
                {([
                  {
                    label: 'Longest Streak', icon: '🔗',
                    value: `${longestStreak} day${longestStreak === 1 ? '' : 's'}`,
                    sub: currentStreak > 0 ? `${currentStreak}d current` : null,
                    bg: isDark ? 'linear-gradient(135deg, #9D174D 0%, #BE185D 48%, #86198F 100%)' : 'linear-gradient(135deg, #DB2777 0%, #EC4899 48%, #C026D3 100%)',
                    border: isDark ? 'rgba(190,24,93,0.46)' : 'rgba(219,39,119,0.46)', glowRgb: '219,39,119',
                  },
                  {
                    label: 'Total Worked', icon: '⏱',
                    value: formatMs(dayStats.totalMs),
                    sub: null,
                    bg: isDark ? 'linear-gradient(135deg, #5B21B6 0%, #7E22CE 50%, #A21CAF 100%)' : 'linear-gradient(135deg, #7C3AED 0%, #A855F7 50%, #D946EF 100%)',
                    border: isDark ? 'rgba(162,28,175,0.46)' : 'rgba(126,34,206,0.45)', glowRgb: '167,139,250',
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
                    value: String(dayStats.sessions.length),
                    sub: null,
                    bg: isDark ? 'linear-gradient(135deg, #0E7490 0%, #0F766E 54%, #0D9488 100%)' : 'linear-gradient(135deg, #06B6D4 0%, #14B8A6 54%, #2DD4BF 100%)',
                    border: isDark ? 'rgba(13,148,136,0.46)' : 'rgba(20,184,166,0.44)', glowRgb: '20,184,166',
                  },
                  {
                    label: 'Deep Work', icon: '🧠',
                    value: formatMs(dayStats.deepWorkMs),
                    sub: null,
                    bg: isDark ? 'linear-gradient(135deg, #1E3A8A 0%, #1D4ED8 50%, #3B82F6 100%)' : 'linear-gradient(135deg, #2563EB 0%, #3B82F6 50%, #60A5FA 100%)',
                    border: isDark ? 'rgba(59,130,246,0.46)' : 'rgba(37,99,235,0.42)', glowRgb: '59,130,246',
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
                  <p className="relative text-base sm:text-lg font-bold leading-none tabular-nums mb-1" style={{ color: '#FFFFFF' }}>{dayStats.completedCount}/{dayStats.totalTasks}</p>
                  <p className="relative text-[8.5px] font-medium leading-tight tracking-wide" style={{ color: 'rgba(255,255,255,0.72)' }}>Tasks Completed</p>
                  {dayStats.totalTasks > 0 && (
                    <p className="relative text-[8px] mt-0.5 font-semibold" style={{ color: 'rgba(255,255,255,0.86)' }}>
                      {Math.round((dayStats.completedCount / dayStats.totalTasks) * 100)}% complete
                    </p>
                  )}
                </div>
                <div className="rounded-2xl flex flex-col justify-center relative overflow-hidden p-2.5 xp-kpi-card" style={{ '--kpi-glow-rgb': '245,158,11', background: isDark ? 'linear-gradient(135deg, #78350F 0%, #92400E 50%, #B45309 100%)' : 'linear-gradient(135deg, #D97706 0%, #F59E0B 50%, #FBBF24 100%)', border: `0.5px solid ${isDark ? 'rgba(180,83,9,0.46)' : 'rgba(217,119,6,0.44)'}`, minHeight: 100 } as React.CSSProperties}>
                  <div style={{ position: 'absolute', inset: 0, borderRadius: 'inherit', pointerEvents: 'none', background: 'linear-gradient(165deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.06) 38%, rgba(255,255,255,0) 100%)' }} />
                  <div className="relative flex items-baseline gap-1.5 mb-1">
                    <span className="text-base sm:text-lg font-bold leading-none tabular-nums" style={{ color: '#FFFFFF' }}>{dailyWinsTotal}</span>
                    <span className="text-[8.5px] font-medium" style={{ color: 'rgba(255,255,255,0.72)' }}>Daily Wins</span>
                  </div>
                  <div className="relative" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 8, rowGap: 2 }}>
                    {([
                      { icon: <ProductiveDot color={progressColor} size={8} />, label: 'Productive', value: dayStats.productive ? 'Yes' : 'No' },
                      { icon: '🔥', label: 'Hyper Productive', value: dayStats.hyper ? 'Yes' : 'No' },
                      { icon: '🏆', label: 'Milestone', value: dayStats.milestone ? 'Yes' : 'No' },
                      { icon: '🎯', label: 'Goal', value: dayStats.goal ? 'Yes' : 'No' },
                    ] as { icon: React.ReactNode; label: string; value: string }[]).map(row => (
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
                <GaugeMeter score={dayScore} />
              </div>

              <AchievementBanner
                tier={dayTier}
                level={dayLevel}
                isDark={isDark}
                firstName={firstName}
                dateLabel={fmtDayLabel(selectedDate)}
                periodLabel={isToday ? "today's" : "that day's"}
                triggerShine={dayBadgeShine}
              />
            </div>
          </div>

          {/* ROW 2 — Daily Progress (8 time-of-day buckets) | Activity Breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)] items-stretch gap-3 lg:gap-4">

            <div className="rounded-2xl p-4 sm:p-5 flex flex-col" style={card1}>
              <div className="flex items-start justify-between flex-shrink-0 mb-2">
                <div>
                  <p className="text-[11px] font-semibold tracking-wide" style={{ color: isDark ? 'rgba(255,255,255,0.88)' : 'var(--xp-txt)' }}>Daily Progress</p>
                  <p className="text-[9px] mt-0.5" style={{ color: isDark ? 'rgba(148,163,184,0.5)' : 'var(--xp-txt3)' }}>Productive time by time of day, {fmtDayLabel(selectedDate)}</p>
                </div>
                {dayStats.totalMs > 0 && (
                  <div className="text-right flex-shrink-0">
                    <p className="text-[14px] font-bold tabular-nums" style={{ color: '#a78bfa' }}>{formatMs(dayStats.totalMs)}</p>
                    <p className="text-[9px]" style={{ color: isDark ? 'rgba(148,163,184,0.45)' : 'var(--xp-txt3)' }}>total</p>
                  </div>
                )}
              </div>
              <div style={{ flex: 1, minHeight: 180 }}>
                <TrendBarChart key={selectedKey} buckets={hourlyBuckets} isDark={isDark} emptyMessage="No focus sessions this day" />
              </div>
            </div>

            <div className="rounded-2xl p-4 sm:p-5" style={card2}>
              <p className="text-[11px] font-semibold tracking-wide mb-3" style={{ color: isDark ? 'rgba(255,255,255,0.88)' : 'var(--xp-txt)' }}>Activity Breakdown</p>
              {dayStats.actBreakdown.length > 0 ? (
                <div className="flex flex-col items-center">
                  <DonutChart
                    segments={dayStats.actBreakdown.map(a => ({ color: a.color, pct: dayStats.totalMs > 0 ? a.ms / dayStats.totalMs : 0, name: a.name, ms: a.ms }))}
                    size="lg"
                    hoveredIdx={dayActHovIdx}
                    onHoverIdx={setDayActHovIdx}
                    animate
                  />
                  <div className="w-full mt-5">
                    {dayStats.actBreakdown.map((a, i) => {
                      const isHov = dayActHovIdx === i
                      const pct = dayStats.totalMs > 0 ? Math.round((a.ms / dayStats.totalMs) * 100) : 0
                      return (
                        <div
                          key={a.name}
                          onMouseEnter={() => setDayActHovIdx(i)}
                          onMouseLeave={() => setDayActHovIdx(null)}
                          style={{ display: 'grid', gridTemplateColumns: 'minmax(80px,1fr) 52px 32px', alignItems: 'center', gap: 4, marginBottom: 5, cursor: 'default', opacity: dayActHovIdx !== null && !isHov ? 0.5 : 1, transition: 'opacity 180ms ease' }}
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
                      <span className="text-[9px] font-bold tabular-nums text-right" style={{ color: isDark ? 'rgba(255,255,255,0.88)' : 'var(--xp-txt)' }}>{formatMs(dayStats.totalMs)}</span>
                      <span className="text-[8px] tabular-nums text-right" style={{ color: isDark ? 'rgba(148,163,184,0.5)' : 'var(--xp-txt3)' }}>100%</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center h-24">
                  <p className="text-[10px]" style={{ color: 'var(--xp-txt3)' }}>No activity data this day</p>
                </div>
              )}
            </div>
          </div>

          {/* ROW 3 — Total Activities | Total Sessions | Pending Tasks. Flat
              lists, matching Monthly/Weekly's own ROW 3 — a single day's
              volume never needs the Yearly-style month-group accordion. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 lg:gap-4">

            <div className="rounded-2xl p-3.5 flex flex-col" style={{ ...card1, height: ROW3_CARD_H }}>
              <p className="text-[11px] font-semibold tracking-wide mb-2.5 flex-shrink-0" style={{ color: isDark ? 'rgba(255,255,255,0.88)' : 'var(--xp-txt)' }}>Total Activities</p>
              {dayStats.actBreakdown.length > 0 ? (
                <div className="flex-1 min-h-0 overflow-y-auto" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {dayStats.actBreakdown.map((a, idx) => {
                    const gradStr  = TASK_GRAD_STRINGS[idx % TASK_GRAD_STRINGS.length]
                    const barPct   = Math.round((a.ms / (dayStats.actBreakdown[0]?.ms ?? 1)) * 100)
                    const totalPct = dayStats.totalMs > 0 ? Math.round((a.ms / dayStats.totalMs) * 100) : 0
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
                <div className="flex-1 flex items-center justify-center">
                  <p className="text-[10px]" style={{ color: 'var(--xp-txt3)' }}>No activity data this day</p>
                </div>
              )}
            </div>

            <div className="rounded-2xl overflow-hidden flex flex-col" style={{ ...card2, height: ROW3_CARD_H }}>
              <div className="px-4 py-2.5 flex-shrink-0" style={{ borderBottom: isDark ? '0.5px solid rgba(124,58,237,0.12)' : '0.5px solid rgba(0,0,0,0.08)' }}>
                <p className="text-[11px] font-semibold tracking-wide" style={{ color: isDark ? 'rgba(255,255,255,0.88)' : 'var(--xp-txt)' }}>Total Sessions</p>
              </div>
              {dayStats.sessions.length > 0 ? (
                <div className="flex-1 min-h-0 overflow-y-auto">
                  {dayStats.sessions.slice(0, 8).map((s, i) => {
                    const deep = s.durationMs >= 45 * 60_000
                    return (
                      <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(86px,1fr) 44px 54px', alignItems: 'center', gap: 6, padding: '5px 14px', borderBottom: i < Math.min(dayStats.sessions.length, 8) - 1 ? isDark ? '0.5px solid rgba(124,58,237,0.08)' : '0.5px solid var(--xp-bdr)' : 'none' }}>
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
                <div className="flex-1 flex items-center justify-center">
                  <p className="text-[10px]" style={{ color: 'var(--xp-txt3)' }}>No sessions recorded this day</p>
                </div>
              )}
            </div>

            <div className="rounded-2xl p-3.5 flex flex-col" style={{ ...card1, height: ROW3_CARD_H }}>
              <div className="flex items-center justify-between mb-2.5 flex-shrink-0">
                <p className="text-[11px] font-semibold tracking-wide" style={{ color: isDark ? 'rgba(255,255,255,0.88)' : 'var(--xp-txt)' }}>Pending Tasks</p>
                <span className="text-[8px] font-bold px-2 py-0.5 rounded-full" style={{ background: isDark ? 'rgba(124,58,237,0.16)' : 'rgba(124,58,237,0.07)', color: '#a78bfa', border: '0.5px solid rgba(124,58,237,0.26)' }}>
                  {dayStats.pending.length} pending
                </span>
              </div>
              {dayStats.pending.length > 0 ? (
                <div className="flex-1 min-h-0 overflow-y-auto" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {dayStats.pending.map(t => (
                    <div key={t.id} style={{ paddingBottom: 6, borderBottom: isDark ? '0.5px solid rgba(255,255,255,0.05)' : '0.5px solid var(--xp-bdr)' }}>
                      <p className="text-[9.5px] font-medium leading-snug truncate" style={{ color: isDark ? 'rgba(226,232,240,0.90)' : 'var(--xp-txt)' }}>{t.text}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center">
                  <p className="text-[10px]" style={{ color: 'var(--xp-txt3)' }}>No pending tasks this day</p>
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}

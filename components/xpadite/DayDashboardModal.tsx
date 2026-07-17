'use client'

import { useMemo, useEffect } from 'react'
import { useApp } from './AppContext'
import { formatMs, formatTime, APP_YEAR, dateKey as makeDateKey } from './utils'
import type { Task } from './types'
import { GaugeMeter } from './GaugeMeter'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getTaskTotalMs(task: Task): number {
  const sessions = task.sessions ?? []
  const fromSessions = sessions.filter(s => s.endTs !== null).reduce((a, s) => a + (s.endTs! - s.startTs), 0)
  if (fromSessions > 0) return fromSessions
  if (task.timerStart && task.timerEnd) return task.timerEnd - task.timerStart
  return 0
}

function niceYMax(ms: number): number {
  const hrs = ms / 3_600_000
  return Math.max(Math.ceil(hrs * 1.18), 1) * 3_600_000
}

function fmtHrTick(ms: number): string {
  const h = ms / 3_600_000
  return h >= 1 ? `${h.toFixed(0)}h` : `${Math.round(ms / 60_000)}m`
}

// ─── SVG Donut ────────────────────────────────────────────────────────────────

interface DonutSegment { color: string; pct: number }

function DonutChart({ segments }: { segments: DonutSegment[] }) {
  const cx = 80, cy = 80, r = 62, inner = 40
  const toRad = (d: number) => (d * Math.PI) / 180
  const pt = (a: number, rad: number) => ({ x: cx + rad * Math.cos(toRad(a)), y: cy + rad * Math.sin(toRad(a)) })
  const total = segments.reduce((s, x) => s + x.pct, 0)

  if (total === 0) {
    return (
      <svg viewBox="0 0 160 160" className="w-28 h-28 sm:w-32 sm:h-32 flex-shrink-0">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(148,163,184,0.12)" strokeWidth={r - inner} />
        <text x={cx} y={cy + 4} textAnchor="middle" fontSize="9" fill="rgba(148,163,184,0.4)">No data</text>
      </svg>
    )
  }

  let angle = -90
  const paths: React.ReactNode[] = []
  segments.forEach((seg, i) => {
    const sweep = (seg.pct / total) * 360
    const end = angle + sweep - 1
    const s = pt(angle, r), e = pt(end, r), si = pt(angle, inner), ei = pt(end, inner)
    const large = sweep > 180 ? 1 : 0
    paths.push(
      <path key={i} fill={seg.color}
        d={`M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y} L ${ei.x} ${ei.y} A ${inner} ${inner} 0 ${large} 0 ${si.x} ${si.y} Z`}
      />
    )
    angle += sweep
  })

  return (
    <svg viewBox="0 0 160 160" className="w-28 h-28 sm:w-32 sm:h-32 flex-shrink-0">
      {paths}
      <circle cx={cx} cy={cy} r={inner} fill="var(--xp-card)" />
    </svg>
  )
}

// ─── Weekly Bar Chart ─────────────────────────────────────────────────────────

function WeeklyBars({ data }: { data: { label: string; ms: number; isToday: boolean }[] }) {
  const VW = 420, VH = 180
  const PL = 32, PB = 22, PT = 24, PR = 8
  const plotW = VW - PL - PR
  const plotH = VH - PT - PB

  const maxMs = Math.max(...data.map(d => d.ms), 1)
  const yMax = niceYMax(maxMs)
  const slotW = plotW / data.length
  const barW = Math.min(Math.max(slotW * 0.58, 10), 36)
  const YTICKS = 4

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} style={{ width: '100%', height: '100%', display: 'block' }}>
      <defs>
        {data.map((d, i) => (
          <linearGradient key={i} id={`wb${i}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={d.isToday ? '#c4b5fd' : '#818cf8'} />
            <stop offset="100%" stopColor={d.isToday ? '#7c3aed' : '#4338ca'} />
          </linearGradient>
        ))}
      </defs>

      {/* Y grid + labels */}
      {Array.from({ length: YTICKS + 1 }, (_, i) => {
        const frac = i / YTICKS
        const y = PT + plotH * (1 - frac)
        return (
          <g key={i}>
            <line x1={PL} y1={y} x2={PL + plotW} y2={y}
              stroke="rgba(148,163,184,0.1)" strokeWidth="0.5" strokeDasharray={i === 0 ? '' : '2,3'} />
            {i > 0 && (
              <text x={PL - 4} y={y + 3} textAnchor="end" fontSize="7.5" fill="rgba(148,163,184,0.45)">
                {fmtHrTick(frac * yMax)}
              </text>
            )}
          </g>
        )
      })}

      {/* Baseline */}
      <line x1={PL} y1={PT + plotH} x2={PL + plotW} y2={PT + plotH}
        stroke="rgba(148,163,184,0.22)" strokeWidth="0.75" />

      {/* Bars + labels */}
      {data.map((d, i) => {
        const barH = d.ms > 0 ? Math.max((d.ms / yMax) * plotH, 3) : 0
        const cx = PL + i * slotW + slotW / 2
        const x = cx - barW / 2
        const y = PT + plotH - barH
        const hrs = d.ms / 3_600_000
        const valLabel = d.ms > 0 ? (hrs >= 1 ? `${hrs.toFixed(1)}h` : `${Math.round(d.ms / 60_000)}m`) : ''

        return (
          <g key={d.label}>
            {d.ms > 0 && (
              <rect
                x={x.toFixed(1)} y={y.toFixed(1)}
                width={barW.toFixed(1)} height={barH.toFixed(1)}
                rx="3" ry="3"
                fill={`url(#wb${i})`}
                style={{ filter: d.isToday ? 'drop-shadow(0 0 5px rgba(124,58,237,0.55))' : 'none' }}
              />
            )}
            {valLabel && barH > 10 && (
              <text x={cx.toFixed(1)} y={(y - 5).toFixed(1)} textAnchor="middle"
                fontSize="7.5" fontWeight="600"
                fill={d.isToday ? '#c4b5fd' : 'rgba(148,163,184,0.72)'}>
                {valLabel}
              </text>
            )}
            <text x={cx.toFixed(1)} y={(PT + plotH + 13).toFixed(1)} textAnchor="middle"
              fontSize="8.5" fontWeight={d.isToday ? '700' : '400'}
              fill={d.isToday ? '#a78bfa' : 'rgba(148,163,184,0.5)'}>
              {d.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// ─── Progress Graph ───────────────────────────────────────────────────────────

type RawSession = { startTs: number; endTs: number | null; actId?: string; taskText?: string }

function ProgressGraph({ sessions, totalMs }: { sessions: RawSession[]; totalMs: number }) {
  const VW = 560, VH = 160
  const PL = 34, PB = 22, PT = 12, PR = 10
  const plotW = VW - PL - PR
  const plotH = VH - PT - PB

  const sorted = [...sessions].filter(s => s.endTs !== null).sort((a, b) => a.startTs - b.startTs)

  if (sorted.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-[11px] text-center px-4" style={{ color: 'var(--xp-txt3)' }}>
          No focused work recorded yet today — start a timer to see your progress
        </p>
      </div>
    )
  }

  const first = sorted[0].startTs
  const last = sorted[sorted.length - 1].endTs!
  const timeSpan = Math.max(last - first, 60_000)
  const yMax = niceYMax(totalMs)

  // Build cumulative step-line points (sorted → no backward movement)
  const pts: { tx: number; ms: number }[] = [{ tx: 0, ms: 0 }]
  let cum = 0
  for (const s of sorted) {
    pts.push({ tx: s.startTs - first, ms: cum })         // flat segment start
    cum += s.endTs! - s.startTs
    pts.push({ tx: s.endTs! - first, ms: cum })           // rise at session end
  }
  if (pts[pts.length - 1].tx < timeSpan) {
    pts.push({ tx: timeSpan, ms: cum })                   // extend flat to end of span
  }

  const toX = (tx: number) => PL + (tx / timeSpan) * plotW
  const toY = (ms: number) => PT + plotH - (ms / yMax) * plotH

  const svgPts = pts.map(p => ({ sx: toX(p.tx), sy: toY(p.ms) }))
  const linePath = svgPts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.sx.toFixed(1)} ${p.sy.toFixed(1)}`).join(' ')

  // Close fill path along the bottom axis (not diagonally)
  const lastPt = svgPts[svgPts.length - 1]
  const firstPt = svgPts[0]
  const baseY = (PT + plotH).toFixed(1)
  const fillPath = `${linePath} L ${lastPt.sx.toFixed(1)} ${baseY} L ${firstPt.sx.toFixed(1)} ${baseY} Z`

  // Session-end highlight dots with cumulative totals
  let dotCum = 0
  const dotPts: { sx: number; sy: number }[] = []
  for (const s of sorted) {
    dotCum += s.endTs! - s.startTs
    dotPts.push({ sx: toX(s.endTs! - first), sy: toY(dotCum) })
  }

  const YTICKS = 4, XTICKS = 4
  const fmtAxisTime = (offsetMs: number) => {
    const d = new Date(first + offsetMs)
    return `${d.getHours()}:${d.getMinutes().toString().padStart(2, '0')}`
  }

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} style={{ width: '100%', height: '100%', display: 'block' }}>
      <defs>
        <linearGradient id="pg-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7c3aed" stopOpacity="0.28" />
          <stop offset="80%" stopColor="#7c3aed" stopOpacity="0.04" />
          <stop offset="100%" stopColor="#7c3aed" stopOpacity="0" />
        </linearGradient>
        <clipPath id="pg-clip">
          <rect x={PL} y={PT} width={plotW} height={plotH} />
        </clipPath>
      </defs>

      {/* Y grid + labels */}
      {Array.from({ length: YTICKS + 1 }, (_, i) => {
        const frac = i / YTICKS
        const y = PT + plotH * (1 - frac)
        return (
          <g key={`yg${i}`}>
            <line x1={PL} y1={y} x2={PL + plotW} y2={y}
              stroke="rgba(148,163,184,0.09)" strokeWidth="0.5" strokeDasharray="3,4" />
            <text x={PL - 4} y={y + 3} textAnchor="end" fontSize="7.5" fill="rgba(148,163,184,0.44)">
              {fmtHrTick(frac * yMax)}
            </text>
          </g>
        )
      })}

      {/* X grid + labels */}
      {Array.from({ length: XTICKS + 1 }, (_, i) => {
        const frac = i / XTICKS
        const x = PL + plotW * frac
        return (
          <g key={`xg${i}`}>
            <line x1={x} y1={PT} x2={x} y2={PT + plotH}
              stroke="rgba(148,163,184,0.06)" strokeWidth="0.5" />
            <text x={x} y={PT + plotH + 12} textAnchor="middle" fontSize="7.5" fill="rgba(148,163,184,0.44)">
              {fmtAxisTime(frac * timeSpan)}
            </text>
          </g>
        )
      })}

      {/* Axes */}
      <line x1={PL} y1={PT} x2={PL} y2={PT + plotH} stroke="rgba(148,163,184,0.18)" strokeWidth="0.75" />
      <line x1={PL} y1={PT + plotH} x2={PL + plotW} y2={PT + plotH} stroke="rgba(148,163,184,0.18)" strokeWidth="0.75" />

      {/* Area fill */}
      <path d={fillPath} fill="url(#pg-area)" clipPath="url(#pg-clip)" />

      {/* Main line */}
      <path d={linePath} fill="none" stroke="#7c3aed" strokeWidth="2.5"
        strokeLinecap="round" strokeLinejoin="round" clipPath="url(#pg-clip)" />

      {/* Session-end dots */}
      {dotPts.map((p, i) => (
        <g key={i}>
          <circle cx={p.sx.toFixed(1)} cy={p.sy.toFixed(1)} r="4.5"
            fill="#7c3aed" stroke="rgba(196,181,253,0.35)" strokeWidth="1.5" />
          <circle cx={p.sx.toFixed(1)} cy={p.sy.toFixed(1)} r="2"
            fill="#e9d5ff" />
        </g>
      ))}
    </svg>
  )
}

// ─── DayDashboardModal ────────────────────────────────────────────────────────

interface DayDashboardModalProps {
  dateKey: string
  month: number
  day: number
  onClose: () => void
  onBack?: () => void
}

export function DayDashboardModal({ dateKey, month, day, onClose, onBack }: DayDashboardModalProps) {
  const { calData, activities, isDark } = useApp()

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const dayData = calData[dateKey]

  const stats = useMemo(() => {
    if (!dayData) return null

    const allSessions = dayData.tasks.flatMap(t =>
      (t.sessions ?? []).filter(s => s.endTs !== null).map(s => ({
        ...s, taskText: t.text, actId: t.actId, taskId: t.id,
      }))
    ).sort((a, b) => a.startTs - b.startTs)

    const totalMs = allSessions.reduce((s, x) => s + (x.endTs! - x.startTs), 0)
    const longestMs = allSessions.reduce((mx, s) => Math.max(mx, s.endTs! - s.startTs), 0)
    const sessionCount = allSessions.length
    const completedTasks = dayData.tasks.filter(t => t.done).length
    const totalTasks = dayData.tasks.length
    const deepWorkMs = allSessions
      .filter(s => (s.endTs! - s.startTs) >= 45 * 60_000)
      .reduce((s, x) => s + (x.endTs! - x.startTs), 0)

    let score = 0
    if (completedTasks > 0) score += 20
    if (totalTasks > 0) score += Math.round((completedTasks / totalTasks) * 20)
    const hrs = totalMs / 3_600_000
    if (hrs >= 1) score += 15; if (hrs >= 3) score += 15; if (hrs >= 6) score += 10
    if (longestMs >= 45 * 60_000) score += 10; if (longestMs >= 90 * 60_000) score += 5
    if (dayData.hyper) score += 5
    score = Math.min(100, score)

    const actMs = new Map<string, number>()
    allSessions.forEach(s => { if (s.actId) actMs.set(s.actId, (actMs.get(s.actId) ?? 0) + (s.endTs! - s.startTs)) })
    const actBreakdown = Array.from(actMs.entries()).map(([actId, ms]) => {
      const act = activities.find(a => a.id === actId)
      return { actId, name: act?.name ?? 'Other', color: act?.color ?? '#94a3b8', ms, pct: totalMs > 0 ? ms / totalMs : 0 }
    }).sort((a, b) => b.ms - a.ms)

    const taskTotals = dayData.tasks
      .map(t => ({ id: t.id, text: t.text, actId: t.actId, done: t.done, ms: getTaskTotalMs(t) }))
      .filter(t => t.ms > 0)
      .sort((a, b) => b.ms - a.ms)

    return { totalMs, longestMs, sessionCount, completedTasks, totalTasks, deepWorkMs, score, actBreakdown, allSessions, taskTotals, isPersonalBest: longestMs > 2 * 3_600_000 }
  }, [dayData, activities])

  const weekData = useMemo(() => {
    const labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const base = new Date(APP_YEAR, month, day)
    const dow = base.getDay()
    return labels.map((label, i) => {
      const d = new Date(base)
      d.setDate(base.getDate() - dow + i)
      const k = makeDateKey(d.getFullYear(), d.getMonth(), d.getDate())
      const dd = calData[k]
      const ms = dd ? dd.tasks.reduce((s, t) => s + getTaskTotalMs(t), 0) : 0
      return { label, ms, isToday: d.getDate() === day && d.getMonth() === month }
    })
  }, [calData, month, day])

  const dateLabel = useMemo(() =>
    new Date(APP_YEAR, month, day)
      .toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' }),
    [month, day])

  const summary = useMemo(() => {
    if (!stats) return 'No tracked data for this day yet.'
    const { totalMs, longestMs, actBreakdown, completedTasks } = stats
    const topAct = actBreakdown[0]
    const hrs = (totalMs / 3_600_000).toFixed(1)
    const lHrs = (longestMs / 3_600_000).toFixed(1)
    if (!topAct) return `${completedTasks} task${completedTasks !== 1 ? 's' : ''} completed. Start tracking time to see your session breakdown.`
    return `A ${topAct.name.toLowerCase()}-focused day with ${hrs}h tracked. Longest session: ${lHrs}h — ${parseFloat(lHrs) > 2 ? 'impressive deep work' : 'keep building the habit'}. ${completedTasks > 0 ? `${completedTasks} task${completedTasks !== 1 ? 's' : ''} completed.` : ''}`
  }, [stats])

  const hasActivity = stats !== null && stats.actBreakdown.length > 0
  const hasSessions = stats !== null && stats.allSessions.length > 0
  const hasTasks    = stats !== null && stats.taskTotals.length > 0

  // Dark mode card surfaces
  const darkCard  = 'rgba(15,10,35,0.92)'
  const darkBdr   = 'rgba(124,58,237,0.22)'
  const lightCard = 'var(--xp-bg3)'
  const lightBdr  = 'var(--xp-bdr)'

  const cardStyle = isDark
    ? { background: darkCard, border: `0.5px solid ${darkBdr}` }
    : { background: lightCard, border: `0.5px solid ${lightBdr}` }

  // Premium metric card definitions
  const metricCards = [
    {
      label: 'Total Worked',
      value: stats ? formatMs(stats.totalMs) : '—',
      sub: null,
      accent: '#7c3aed',
      gradFrom: 'rgba(124,58,237,0.22)',
      gradTo: 'rgba(99,102,241,0.06)',
      glow: 'rgba(124,58,237,0.35)',
      icon: '⏱',
    },
    {
      label: 'Longest Session',
      value: stats ? formatMs(stats.longestMs) : '—',
      sub: stats?.isPersonalBest ? '🔥 Personal Best' : null,
      accent: '#6366f1',
      gradFrom: 'rgba(99,102,241,0.18)',
      gradTo: 'rgba(79,70,229,0.04)',
      glow: 'rgba(99,102,241,0.28)',
      icon: '🏆',
    },
    {
      label: 'Sessions',
      value: stats ? String(stats.sessionCount) : '—',
      sub: null,
      accent: '#0891b2',
      gradFrom: 'rgba(8,145,178,0.16)',
      gradTo: 'rgba(6,182,212,0.03)',
      glow: 'rgba(8,145,178,0.25)',
      icon: '▶',
    },
    {
      label: 'Tasks Done',
      value: stats ? `${stats.completedTasks}/${stats.totalTasks}` : '—',
      sub: stats && stats.totalTasks > 0 ? `${Math.round((stats.completedTasks / stats.totalTasks) * 100)}% complete` : null,
      accent: '#059669',
      gradFrom: 'rgba(5,150,105,0.16)',
      gradTo: 'rgba(16,185,129,0.03)',
      glow: 'rgba(5,150,105,0.25)',
      icon: '✓',
    },
    {
      label: 'Deep Work',
      value: stats ? formatMs(stats.deepWorkMs) : '—',
      sub: null,
      accent: '#7c3aed',
      gradFrom: 'rgba(124,58,237,0.16)',
      gradTo: 'rgba(139,92,246,0.03)',
      glow: 'rgba(124,58,237,0.25)',
      icon: '🧠',
    },
    {
      label: 'Focus Score',
      value: stats ? `${stats.score}%` : '—',
      sub: stats ? (stats.score >= 80 ? 'Excellent' : stats.score >= 60 ? 'Good' : stats.score >= 40 ? 'Average' : 'Building') : null,
      accent: stats && stats.score >= 80 ? '#059669' : stats && stats.score >= 60 ? '#6366f1' : '#f97316',
      gradFrom: 'rgba(124,58,237,0.18)',
      gradTo: 'rgba(167,139,250,0.04)',
      glow: 'rgba(124,58,237,0.3)',
      icon: '◎',
    },
  ]

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-3 sm:p-4 pt-4 sm:pt-6 overflow-y-auto"
      style={{ background: isDark ? 'rgba(0,0,0,0.80)' : 'rgba(0,0,0,0.55)' }}
      onClick={onClose}
    >
      {/* Soft abstract background shapes (dark mode only) */}
      {isDark && (
        <div className="fixed inset-0 pointer-events-none overflow-hidden" style={{ zIndex: -1 }}>
          <div style={{
            position: 'absolute', top: '-10%', right: '-5%',
            width: 600, height: 600, borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(124,58,237,0.07) 0%, transparent 70%)',
          }} />
          <div style={{
            position: 'absolute', bottom: '5%', left: '-8%',
            width: 500, height: 500, borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(8,145,178,0.05) 0%, transparent 70%)',
          }} />
        </div>
      )}

      {/* Modal shell */}
      <div
        className="w-full max-w-[640px] lg:max-w-[1200px] rounded-2xl shadow-2xl overflow-hidden mb-6 sm:mb-8"
        style={{
          background: isDark ? 'rgba(8,5,20,0.97)' : 'var(--xp-card)',
          border: isDark ? '0.5px solid rgba(124,58,237,0.28)' : '0.5px solid var(--xp-bdr2)',
          boxShadow: isDark ? '0 25px 60px rgba(0,0,0,0.7), 0 0 0 0.5px rgba(124,58,237,0.2)' : '0 20px 50px rgba(0,0,0,0.15)',
        }}
        onClick={e => e.stopPropagation()}
      >

        {/* Header */}
        <div
          className="flex items-center gap-3 px-4 sm:px-6 py-3.5 sm:py-4"
          style={{
            background: 'linear-gradient(135deg,#1a0a3d 0%,#2d1b69 60%,#1e3a5f 100%)',
            borderBottom: '0.5px solid rgba(255,255,255,0.07)',
          }}
        >
          {onBack && (
            <button
              onClick={onBack}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium transition-all hover:opacity-80 flex-shrink-0"
              style={{ background: 'rgba(255,255,255,0.1)', border: '0.5px solid rgba(255,255,255,0.18)', color: 'rgba(255,255,255,0.8)' }}
            >
              ← Back
            </button>
          )}
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-bold text-white tracking-wide">Today's Dashboard</h2>
            <p className="text-[10px] mt-0.5 truncate" style={{ color: 'rgba(167,139,250,0.7)' }}>{dateLabel}</p>
          </div>
          <button
            onClick={onClose}
            className="text-xs px-2.5 py-1.5 rounded-lg transition-all hover:opacity-80 flex-shrink-0"
            style={{ background: 'rgba(239,68,68,0.18)', border: '0.5px solid rgba(239,68,68,0.32)', color: '#fca5a5' }}
          >
            × Close
          </button>
        </div>

        {/* Dashboard body */}
        <div className="p-4 sm:p-5 lg:p-6 space-y-4 lg:space-y-5">

          {/* ── TOP ANALYTICS ZONE: Gauge + Summary Cards ──────────────────── */}
          <div className="flex flex-col lg:flex-row gap-4 lg:gap-5">

            {/* Gauge card */}
            <div
              className="rounded-2xl p-4 sm:p-5 flex-shrink-0 lg:w-[280px]"
              style={{
                background: isDark
                  ? 'linear-gradient(145deg, rgba(20,10,50,0.98) 0%, rgba(12,6,30,0.98) 100%)'
                  : lightCard,
                border: isDark ? `0.5px solid ${darkBdr}` : `0.5px solid ${lightBdr}`,
                boxShadow: isDark ? '0 0 30px rgba(124,58,237,0.12) inset' : 'none',
              }}
            >
              <p className="text-[10px] font-bold uppercase tracking-widest mb-3"
                style={{ color: isDark ? 'rgba(167,139,250,0.7)' : 'var(--xp-txt3)' }}>
                Performance Analytics
              </p>
              {/* GaugeMeter is UNTOUCHED — only its container card changes */}
              <GaugeMeter score={stats?.score ?? 0} />
            </div>

            {/* Summary cards — 2 col mobile, 3 col sm, 2 col (3×2) on lg since gauge is beside */}
            <div className="flex-1 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 gap-3">
              {metricCards.map(m => (
                <div
                  key={m.label}
                  className="rounded-xl px-3.5 py-3.5 relative overflow-hidden"
                  style={{
                    background: isDark
                      ? `linear-gradient(135deg, ${m.gradFrom} 0%, ${m.gradTo} 100%)`
                      : lightCard,
                    border: isDark
                      ? `0.5px solid ${m.accent}44`
                      : `0.5px solid ${lightBdr}`,
                    boxShadow: isDark ? `0 4px 20px ${m.glow}20` : 'none',
                  }}
                >
                  {/* Decorative radial highlight */}
                  {isDark && (
                    <div style={{
                      position: 'absolute', top: -20, right: -20, width: 80, height: 80,
                      borderRadius: '50%',
                      background: `radial-gradient(circle, ${m.accent}1a 0%, transparent 70%)`,
                      pointerEvents: 'none',
                    }} />
                  )}
                  {/* Subtle corner shape */}
                  {isDark && (
                    <div style={{
                      position: 'absolute', bottom: -8, right: -8, width: 50, height: 50,
                      borderRadius: '50%',
                      background: `radial-gradient(circle, ${m.accent}0f 0%, transparent 70%)`,
                      pointerEvents: 'none',
                    }} />
                  )}
                  <p className="text-lg sm:text-xl font-bold leading-tight relative z-10"
                    style={{ color: isDark ? m.accent : m.accent }}>
                    {m.value}
                  </p>
                  <p className="text-[9px] mt-0.5 leading-tight relative z-10"
                    style={{ color: isDark ? 'rgba(148,163,184,0.6)' : 'var(--xp-txt3)' }}>
                    {m.label}
                  </p>
                  {m.sub && (
                    <p className="text-[8px] mt-1 leading-tight relative z-10"
                      style={{ color: isDark ? 'rgba(167,139,250,0.65)' : 'var(--xp-txt3)' }}>
                      {m.sub}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* ── TODAY'S PROGRESS ───────────────────────────────────────────── */}
          <div
            className="rounded-2xl p-4 sm:p-5"
            style={{
              background: isDark
                ? 'linear-gradient(145deg, rgba(18,10,42,0.96) 0%, rgba(10,5,25,0.96) 100%)'
                : lightCard,
              border: isDark ? `0.5px solid ${darkBdr}` : `0.5px solid ${lightBdr}`,
            }}
          >
            <div className="flex items-center justify-between mb-3">
              <p className="text-[11px] font-semibold tracking-wide"
                style={{ color: isDark ? 'rgba(255,255,255,0.85)' : 'var(--xp-txt)' }}>
                Today's Progress
              </p>
              {stats && stats.totalMs > 0 && (
                <span className="text-[10px] font-medium"
                  style={{ color: isDark ? 'rgba(167,139,250,0.7)' : 'var(--xp-txt3)' }}>
                  {formatMs(stats.totalMs)} total
                </span>
              )}
            </div>
            <div className="h-36 lg:h-44">
              <ProgressGraph
                sessions={stats?.allSessions ?? []}
                totalMs={stats?.totalMs ?? 0}
              />
            </div>
          </div>

          {/* ── ACTIVITY DISTRIBUTION + WEEKLY OVERVIEW ────────────────────── */}
          <div className={`grid grid-cols-1 gap-4${hasActivity ? ' md:grid-cols-2' : ''}`}>

            {hasActivity && (
              <div className="rounded-2xl p-4 sm:p-5"
                style={{
                  background: isDark
                    ? 'linear-gradient(145deg, rgba(15,8,38,0.96) 0%, rgba(10,5,22,0.96) 100%)'
                    : lightCard,
                  border: isDark ? `0.5px solid ${darkBdr}` : `0.5px solid ${lightBdr}`,
                }}>
                <p className="text-[11px] font-semibold mb-3 tracking-wide"
                  style={{ color: isDark ? 'rgba(255,255,255,0.85)' : 'var(--xp-txt)' }}>
                  Activity Distribution
                </p>
                <div className="flex items-center gap-4 sm:gap-5">
                  <DonutChart
                    segments={stats!.actBreakdown.map(a => ({ color: a.color, pct: a.pct }))}
                  />
                  <div className="flex-1 min-w-0 space-y-2">
                    {stats!.actBreakdown.map(a => (
                      <div key={a.actId} className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: a.color }} />
                        <span className="text-[10px] flex-1 min-w-0 truncate"
                          style={{ color: isDark ? 'rgba(203,213,225,0.8)' : 'var(--xp-txt2)' }}>
                          {a.name}
                        </span>
                        <span className="text-[10px] font-semibold flex-shrink-0 tabular-nums"
                          style={{ color: isDark ? 'rgba(255,255,255,0.9)' : 'var(--xp-txt)' }}>
                          {formatMs(a.ms)}
                        </span>
                        <span className="text-[9px] w-8 text-right flex-shrink-0 tabular-nums"
                          style={{ color: isDark ? 'rgba(148,163,184,0.55)' : 'var(--xp-txt3)' }}>
                          {Math.round(a.pct * 100)}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div className="rounded-2xl p-4 sm:p-5"
              style={{
                background: isDark
                  ? 'linear-gradient(145deg, rgba(15,8,38,0.96) 0%, rgba(10,5,22,0.96) 100%)'
                  : lightCard,
                border: isDark ? `0.5px solid ${darkBdr}` : `0.5px solid ${lightBdr}`,
              }}>
              <p className="text-[11px] font-semibold mb-2 tracking-wide"
                style={{ color: isDark ? 'rgba(255,255,255,0.85)' : 'var(--xp-txt)' }}>
                Weekly Overview
              </p>
              <div className="h-44 sm:h-48">
                <WeeklyBars data={weekData} />
              </div>
            </div>
          </div>

          {/* ── SESSION LOG + TASK BREAKDOWN ───────────────────────────────── */}
          {(hasSessions || hasTasks) && (
            <div className={`grid grid-cols-1 gap-4${hasSessions && hasTasks ? ' md:grid-cols-2' : ''}`}>

              {hasSessions && (
                <div className="rounded-2xl overflow-hidden"
                  style={{
                    background: isDark
                      ? 'linear-gradient(145deg, rgba(15,8,38,0.96) 0%, rgba(10,5,22,0.96) 100%)'
                      : lightCard,
                    border: isDark ? `0.5px solid ${darkBdr}` : `0.5px solid ${lightBdr}`,
                  }}>
                  <div className="px-4 py-3"
                    style={{ borderBottom: isDark ? '0.5px solid rgba(124,58,237,0.15)' : '0.5px solid var(--xp-bdr)' }}>
                    <p className="text-[11px] font-semibold tracking-wide"
                      style={{ color: isDark ? 'rgba(255,255,255,0.85)' : 'var(--xp-txt)' }}>
                      Session Log
                    </p>
                  </div>
                  <div>
                    {stats!.allSessions.map((s, i) => {
                      const act = activities.find(a => a.id === s.actId)
                      const dur = s.endTs! - s.startTs
                      const isDeep = dur >= 45 * 60_000
                      return (
                        <div
                          key={s.id ?? i}
                          className="flex items-center gap-3 px-4 py-2.5"
                          style={{
                            borderBottom: i < stats!.allSessions.length - 1
                              ? isDark ? '0.5px solid rgba(124,58,237,0.1)' : '0.5px solid var(--xp-bdr)'
                              : 'none',
                          }}
                        >
                          <div className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{ background: act?.color ?? '#94a3b8', boxShadow: `0 0 6px ${act?.color ?? '#94a3b8'}80` }} />
                          <span className="text-[11px] font-semibold w-16 truncate flex-shrink-0"
                            style={{ color: isDark ? 'rgba(255,255,255,0.88)' : 'var(--xp-txt)' }}>
                            {act?.name ?? 'Other'}
                          </span>
                          <span className="text-[10px] flex-1 tabular-nums"
                            style={{ color: isDark ? 'rgba(148,163,184,0.6)' : 'var(--xp-txt3)' }}>
                            {formatTime(s.startTs)} → {formatTime(s.endTs!)}
                          </span>
                          {s.note && (
                            <span className="text-[9px] truncate max-w-[80px] hidden sm:block"
                              style={{ color: isDark ? 'rgba(148,163,184,0.45)' : 'var(--xp-txt3)' }}>
                              {s.note}
                            </span>
                          )}
                          <span className="text-[11px] font-bold flex-shrink-0 tabular-nums"
                            style={{ color: isDeep ? '#a78bfa' : isDark ? 'rgba(203,213,225,0.75)' : 'var(--xp-txt2)' }}>
                            {formatMs(dur)}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {hasTasks && (
                <div className="rounded-2xl p-4 sm:p-5"
                  style={{
                    background: isDark
                      ? 'linear-gradient(145deg, rgba(15,8,38,0.96) 0%, rgba(10,5,22,0.96) 100%)'
                      : lightCard,
                    border: isDark ? `0.5px solid ${darkBdr}` : `0.5px solid ${lightBdr}`,
                  }}>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-[11px] font-semibold tracking-wide"
                      style={{ color: isDark ? 'rgba(255,255,255,0.85)' : 'var(--xp-txt)' }}>
                      Task Breakdown
                    </p>
                    <span className="text-[9px] font-medium px-2 py-0.5 rounded-full"
                      style={{
                        background: isDark ? 'rgba(124,58,237,0.2)' : 'rgba(124,58,237,0.08)',
                        color: '#a78bfa',
                        border: '0.5px solid rgba(124,58,237,0.3)',
                      }}>
                      {stats!.completedTasks}/{stats!.totalTasks} done
                    </span>
                  </div>
                  <div className="space-y-3">
                    {stats!.taskTotals.map(t => {
                      const act = activities.find(a => a.id === t.actId)
                      const pct = Math.round((t.ms / (stats!.taskTotals[0]?.ms ?? 1)) * 100)
                      return (
                        <div key={t.id}>
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[10px] flex-1 mr-2 break-words min-w-0 leading-snug"
                              style={{
                                color: t.done
                                  ? isDark ? 'rgba(148,163,184,0.4)' : 'var(--xp-txt3)'
                                  : isDark ? 'rgba(203,213,225,0.85)' : 'var(--xp-txt)',
                                textDecoration: t.done ? 'line-through' : 'none',
                              }}>
                              {t.text}
                            </span>
                            <span className="text-[10px] font-semibold flex-shrink-0 tabular-nums"
                              style={{ color: isDark ? 'rgba(167,139,250,0.8)' : 'var(--xp-txt2)' }}>
                              {formatMs(t.ms)}
                            </span>
                          </div>
                          <div className="h-2 rounded-full overflow-hidden"
                            style={{ background: isDark ? 'rgba(255,255,255,0.07)' : 'var(--xp-bdr)' }}>
                            <div
                              className="h-full rounded-full transition-all"
                              style={{
                                width: `${pct}%`,
                                background: t.done
                                  ? isDark ? 'rgba(148,163,184,0.25)' : 'rgba(148,163,184,0.35)'
                                  : `linear-gradient(90deg, ${act?.color ?? '#7c3aed'} 0%, ${act?.color ?? '#7c3aed'}bb 100%)`,
                                boxShadow: !t.done && isDark ? `0 0 8px ${act?.color ?? '#7c3aed'}60` : 'none',
                              }}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── DAILY SUMMARY ──────────────────────────────────────────────── */}
          <div
            className="rounded-2xl px-4 py-3.5"
            style={{
              background: isDark
                ? 'linear-gradient(135deg, rgba(124,58,237,0.1) 0%, rgba(99,102,241,0.06) 100%)'
                : 'linear-gradient(135deg,rgba(124,58,237,0.07),rgba(99,102,241,0.04))',
              border: isDark ? '0.5px solid rgba(124,58,237,0.25)' : '0.5px solid rgba(124,58,237,0.18)',
            }}
          >
            <div className="flex items-start gap-2.5">
              <span className="text-base flex-shrink-0 mt-0.5">🤖</span>
              <div>
                <p className="text-[10px] font-bold mb-1" style={{ color: '#a78bfa' }}>Daily Summary</p>
                <p className="text-[11px] leading-relaxed"
                  style={{ color: isDark ? 'rgba(203,213,225,0.8)' : 'var(--xp-txt2)' }}>
                  {summary}
                </p>
                <p className="text-[9px] mt-2 italic"
                  style={{ color: isDark ? 'rgba(148,163,184,0.4)' : 'var(--xp-txt3)' }}>
                  AI-powered insights coming soon
                </p>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}

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

// ─── SVG Donut Chart ──────────────────────────────────────────────────────────

interface DonutSegment { color: string; pct: number; label: string; value: string }

function DonutChart({ segments }: { segments: DonutSegment[] }) {
  const cx = 80, cy = 80, r = 62, inner = 40
  const toRad = (d: number) => (d * Math.PI) / 180
  const pt = (a: number, radius: number) => ({
    x: cx + radius * Math.cos(toRad(a)),
    y: cy + radius * Math.sin(toRad(a)),
  })

  const total = segments.reduce((s, x) => s + x.pct, 0)

  if (total === 0) {
    return (
      <svg viewBox="0 0 160 160" className="w-36 h-36">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--xp-bdr)" strokeWidth={r - inner} />
        <circle cx={cx} cy={cy} r={inner} fill="var(--xp-card)" />
        <text x={cx} y={cy + 4} textAnchor="middle" fontSize="9" fill="var(--xp-txt3)">No data</text>
      </svg>
    )
  }

  let angle = -90
  const paths: React.ReactNode[] = []
  segments.forEach((seg, i) => {
    const sweep = (seg.pct / total) * 360
    const end = angle + sweep - 1
    const s = pt(angle, r); const e = pt(end, r)
    const si = pt(angle, inner); const ei = pt(end, inner)
    const large = sweep > 180 ? 1 : 0
    paths.push(
      <path key={i} d={`M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y} L ${ei.x} ${ei.y} A ${inner} ${inner} 0 ${large} 0 ${si.x} ${si.y} Z`} fill={seg.color} />
    )
    angle += sweep
  })

  return (
    <svg viewBox="0 0 160 160" className="w-36 h-36">
      {paths}
      <circle cx={cx} cy={cy} r={inner} fill="var(--xp-card)" />
    </svg>
  )
}


// ─── Weekly Bar Chart (taller) ────────────────────────────────────────────────

function WeeklyBars({ data }: { data: { label: string; ms: number; isToday: boolean }[] }) {
  const maxMs = Math.max(...data.map(d => d.ms), 1)
  const COLORS = ['#6366f1', '#7c3aed', '#ef4444', '#f97316', '#eab308', '#22c55e', '#0891b2']

  return (
    <div className="flex items-end justify-between gap-2 h-44 pt-4">
      {data.map((d, i) => {
        const pct = (d.ms / maxMs) * 100
        const hrs = d.ms / 3_600_000
        return (
          <div key={d.label} className="flex flex-col items-center flex-1 gap-1">
            {d.ms > 0 && (
              <span className="text-[9px] font-bold" style={{ color: d.isToday ? '#a78bfa' : COLORS[i % COLORS.length] }}>
                {hrs >= 1 ? `${hrs.toFixed(1)}h` : `${Math.round(d.ms / 60_000)}m`}
              </span>
            )}
            <div className="w-full flex-1 flex items-end">
              <div
                className="w-full rounded-t-lg transition-all"
                style={{
                  height: `${Math.max(pct, d.ms > 0 ? 4 : 0)}%`,
                  background: d.isToday
                    ? 'linear-gradient(180deg, #a78bfa 0%, #7c3aed 100%)'
                    : COLORS[i % COLORS.length],
                  opacity: d.ms > 0 ? 1 : 0.1,
                  minHeight: d.ms > 0 ? 4 : 0,
                  boxShadow: d.isToday ? '0 0 12px rgba(124,58,237,0.45)' : 'none',
                }}
              />
            </div>
            <span className="text-[9px] font-medium" style={{ color: d.isToday ? 'var(--xp-acc)' : 'var(--xp-txt3)' }}>
              {d.label}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ─── Progress Graph (SVG line chart) ─────────────────────────────────────────

interface ProgressPoint { x: number; y: number }

function ProgressGraph({ points, color = '#7c3aed', height = 90, id = 'pg' }: {
  points: ProgressPoint[]
  color?: string
  height?: number
  id?: string
}) {
  const W = 280, H = height
  if (points.length < 2) {
    return (
      <div className="flex items-center justify-center" style={{ height }}>
        <p className="text-[11px]" style={{ color: 'var(--xp-txt3)' }}>No session data yet — start a timer to see your progress</p>
      </div>
    )
  }

  const maxY = Math.max(...points.map(p => p.y), 0.001)
  const toSVG = (p: ProgressPoint) => ({
    sx: (p.x * W).toFixed(1),
    sy: (H - (p.y / maxY) * H * 0.88 - H * 0.06).toFixed(1),
  })

  const svgPts = points.map(toSVG)
  const linePath = svgPts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.sx} ${p.sy}`).join(' ')
  const fillPath = `${linePath} L ${W} ${H} L 0 ${H} Z`

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" style={{ height }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={fillPath} fill={`url(#${id})`} />
      <path d={linePath} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {svgPts.filter((_, i) => i > 0 && i < svgPts.length - 1 && i % 2 === 0).map((p, i) => (
        <circle key={i} cx={p.sx} cy={p.sy} r="2.5" fill={color} opacity="0.8" />
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
  const { calData, activities } = useApp()

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
    const deepWorkMs = allSessions.filter(s => (s.endTs! - s.startTs) >= 45 * 60_000)
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

    const taskTotals = dayData.tasks.map(t => ({
      id: t.id, text: t.text, actId: t.actId, done: t.done, ms: getTaskTotalMs(t),
    })).filter(t => t.ms > 0).sort((a, b) => b.ms - a.ms)

    return { totalMs, longestMs, sessionCount, completedTasks, totalTasks, deepWorkMs, score, actBreakdown, allSessions, taskTotals, isPersonalBest: longestMs > 2 * 3_600_000 }
  }, [dayData, activities])

  const progressPoints = useMemo<ProgressPoint[]>(() => {
    if (!stats || !stats.allSessions.length) return []
    const first = stats.allSessions[0].startTs
    const last = stats.allSessions[stats.allSessions.length - 1].endTs!
    const span = Math.max(last - first, 1)
    const pts: ProgressPoint[] = [{ x: 0, y: 0 }]
    let cumMs = 0
    stats.allSessions.forEach(s => {
      if (!s.endTs) return
      pts.push({ x: (s.startTs - first) / span, y: cumMs })
      cumMs += s.endTs - s.startTs
      pts.push({ x: (s.endTs - first) / span, y: cumMs })
    })
    pts.push({ x: 1, y: cumMs })
    return pts
  }, [stats])

  const weekData = useMemo(() => {
    const labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const base = new Date(APP_YEAR, month, day)
    const dow = base.getDay()
    return labels.map((label, i) => {
      const d = new Date(base); d.setDate(base.getDate() - dow + i)
      const k = makeDateKey(d.getFullYear(), d.getMonth(), d.getDate())
      const dd = calData[k]
      const ms = dd ? dd.tasks.reduce((s, t) => s + getTaskTotalMs(t), 0) : 0
      return { label, ms, isToday: d.getDate() === day && d.getMonth() === month }
    })
  }, [calData, month, day])

  const dateLabel = useMemo(() => {
    return new Date(APP_YEAR, month, day)
      .toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' })
  }, [month, day])

  const summary = useMemo(() => {
    if (!stats) return 'No tracked data for this day yet.'
    const { totalMs, longestMs, actBreakdown, completedTasks } = stats
    const topAct = actBreakdown[0]
    const hrs = (totalMs / 3_600_000).toFixed(1)
    const lHrs = (longestMs / 3_600_000).toFixed(1)
    if (!topAct) return `${completedTasks} task${completedTasks !== 1 ? 's' : ''} completed. Start tracking time to see your session breakdown.`
    return `A ${topAct.name.toLowerCase()}-focused day with ${hrs}h tracked. Longest session: ${lHrs}h — ${parseFloat(lHrs) > 2 ? 'impressive deep work' : 'keep building the habit'}. ${completedTasks > 0 ? `${completedTasks} task${completedTasks !== 1 ? 's' : ''} completed.` : ''}`
  }, [stats])

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-6 overflow-y-auto"
      style={{ background: 'rgba(0,0,0,0.65)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[640px] rounded-2xl shadow-2xl overflow-hidden mb-8"
        style={{ background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ─────────────────────────────────────────────── */}
        <div
          className="flex items-center gap-3 px-5 py-4"
          style={{ background: 'linear-gradient(135deg, #1e1030 0%, #2d1b69 100%)', borderBottom: '0.5px solid rgba(255,255,255,0.08)' }}
        >
          {onBack && (
            <button
              onClick={onBack}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium transition-all hover:opacity-80 flex-shrink-0"
              style={{ background: 'rgba(255,255,255,0.1)', border: '0.5px solid rgba(255,255,255,0.2)', color: 'rgba(255,255,255,0.8)' }}
            >
              ← Back
            </button>
          )}
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-bold text-white">Today's Dashboard</h2>
            <p className="text-[10px] mt-0.5 truncate" style={{ color: 'rgba(255,255,255,0.5)' }}>{dateLabel}</p>
          </div>
          <button
            onClick={onClose}
            className="text-xs px-2.5 py-1.5 rounded-lg transition-all hover:opacity-80 flex-shrink-0"
            style={{ background: 'rgba(239,68,68,0.2)', border: '0.5px solid rgba(239,68,68,0.35)', color: '#fca5a5' }}
          >
            × Close
          </button>
        </div>

        {/* ── Metric cards ───────────────────────────────────────── */}
        <div className="grid grid-cols-3 gap-3 p-4 pb-2">
          {[
            { label: 'Total Worked', value: stats ? formatMs(stats.totalMs) : '—', accent: true },
            { label: 'Longest Session', value: stats ? formatMs(stats.longestMs) : '—', badge: stats?.isPersonalBest ? '🔥 Best' : null },
            { label: 'Sessions', value: stats ? String(stats.sessionCount) : '—' },
            { label: 'Tasks Done', value: stats ? `${stats.completedTasks}/${stats.totalTasks}` : '—' },
            { label: 'Deep Work', value: stats ? formatMs(stats.deepWorkMs) : '—' },
            { label: 'Focus Score', value: stats ? `${stats.score}%` : '—' },
          ].map(m => (
            <div key={m.label} className="rounded-xl px-3.5 py-3" style={{ background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr)' }}>
              <p className={`font-bold ${m.accent ? 'text-xl' : 'text-base'}`} style={{ color: m.accent ? 'var(--xp-acc)' : 'var(--xp-txt)' }}>
                {m.value}
              </p>
              <p className="text-[10px] mt-0.5" style={{ color: 'var(--xp-txt3)' }}>{m.label}</p>
              {m.badge && <p className="text-[9px] mt-0.5" style={{ color: '#f97316' }}>{m.badge}</p>}
            </div>
          ))}
        </div>

        {/* ── Activity Distribution ───────────────────────────────── */}
        {stats && stats.actBreakdown.length > 0 && (
          <div className="mx-4 mb-3 rounded-xl p-4" style={{ background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr)' }}>
            <p className="text-[11px] font-semibold mb-3" style={{ color: 'var(--xp-txt)' }}>Activity Distribution</p>
            <div className="flex items-center gap-5">
              <div className="flex-shrink-0">
                <DonutChart segments={stats.actBreakdown.map(a => ({ color: a.color, pct: a.pct, label: a.name, value: formatMs(a.ms) }))} />
              </div>
              <div className="flex-1 space-y-2">
                {stats.actBreakdown.map(a => (
                  <div key={a.actId} className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: a.color }} />
                    <span className="text-[11px] flex-1" style={{ color: 'var(--xp-txt2)' }}>{a.name}</span>
                    <span className="text-[11px] font-semibold" style={{ color: 'var(--xp-txt)' }}>{formatMs(a.ms)}</span>
                    <span className="text-[10px] w-9 text-right" style={{ color: 'var(--xp-txt3)' }}>{Math.round(a.pct * 100)}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Performance Gauge (animated) ──────────────────────── */}
        <div className="mx-4 mb-3 rounded-xl p-5" style={{ background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr)' }}>
          <GaugeMeter score={stats?.score ?? 0} />
        </div>

        {/* ── Today's Progress Graph ─────────────────────────────── */}
        <div className="mx-4 mb-3 rounded-xl p-4" style={{ background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr)' }}>
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] font-semibold" style={{ color: 'var(--xp-txt)' }}>Today's Progress</p>
            {stats && stats.totalMs > 0 && (
              <span className="text-[10px]" style={{ color: 'var(--xp-txt3)' }}>{formatMs(stats.totalMs)} total</span>
            )}
          </div>
          <ProgressGraph points={progressPoints} color="#7c3aed" height={90} id="day-prog" />
        </div>

        {/* ── Session Log ───────────────────────────────────────── */}
        {stats && stats.allSessions.length > 0 && (
          <div className="mx-4 mb-3 rounded-xl overflow-hidden" style={{ border: '0.5px solid var(--xp-bdr)' }}>
            <div className="px-4 py-2.5" style={{ background: 'var(--xp-bg3)', borderBottom: '0.5px solid var(--xp-bdr)' }}>
              <p className="text-[11px] font-semibold" style={{ color: 'var(--xp-txt)' }}>Session Log</p>
            </div>
            <div>
              {stats.allSessions.map((s, i) => {
                const act = activities.find(a => a.id === s.actId)
                const dur = s.endTs! - s.startTs
                return (
                  <div key={s.id ?? i} className="flex items-center gap-3 px-4 py-2.5" style={{ borderBottom: i < stats.allSessions.length - 1 ? '0.5px solid var(--xp-bdr)' : 'none' }}>
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: act?.color ?? '#94a3b8' }} />
                    <span className="text-[11px] font-semibold w-16 truncate flex-shrink-0" style={{ color: 'var(--xp-txt)' }}>{act?.name ?? 'Other'}</span>
                    <span className="text-[10px] flex-1 tabular-nums" style={{ color: 'var(--xp-txt3)' }}>
                      {formatTime(s.startTs)} → {formatTime(s.endTs!)}
                    </span>
                    {s.note && <span className="text-[9px] truncate max-w-[90px]" style={{ color: 'var(--xp-txt3)' }}>{s.note}</span>}
                    <span className="text-[11px] font-bold flex-shrink-0 tabular-nums" style={{ color: dur >= 45 * 60_000 ? '#7c3aed' : 'var(--xp-txt2)' }}>
                      {formatMs(dur)}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── Weekly Overview (taller bars) ─────────────────────── */}
        <div className="mx-4 mb-3 rounded-xl p-4" style={{ background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr)' }}>
          <p className="text-[11px] font-semibold mb-1" style={{ color: 'var(--xp-txt)' }}>Weekly Overview</p>
          <WeeklyBars data={weekData} />
        </div>

        {/* ── Task Breakdown ─────────────────────────────────────── */}
        {stats && stats.taskTotals.length > 0 && (
          <div className="mx-4 mb-3 rounded-xl p-4" style={{ background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr)' }}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[11px] font-semibold" style={{ color: 'var(--xp-txt)' }}>Task Breakdown</p>
              <span className="text-[10px]" style={{ color: 'var(--xp-txt3)' }}>{stats.completedTasks}/{stats.totalTasks} finished</span>
            </div>
            <div className="space-y-2.5">
              {stats.taskTotals.map(t => {
                const act = activities.find(a => a.id === t.actId)
                const pct = Math.round((t.ms / (stats.taskTotals[0]?.ms ?? 1)) * 100)
                return (
                  <div key={t.id}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] truncate flex-1 mr-2" style={{ color: t.done ? 'var(--xp-txt3)' : 'var(--xp-txt)', textDecoration: t.done ? 'line-through' : 'none' }}>
                        {t.text}
                      </span>
                      <span className="text-[10px] font-semibold flex-shrink-0" style={{ color: 'var(--xp-txt2)' }}>{formatMs(t.ms)}</span>
                    </div>
                    <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--xp-bdr)' }}>
                      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: act?.color ?? '#7c3aed' }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── Daily Summary ──────────────────────────────────────── */}
        <div
          className="mx-4 mb-5 rounded-xl px-4 py-3.5"
          style={{ background: 'linear-gradient(135deg, rgba(124,58,237,0.07), rgba(99,102,241,0.05))', border: '0.5px solid rgba(124,58,237,0.18)' }}
        >
          <div className="flex items-start gap-2.5">
            <span className="text-base flex-shrink-0 mt-0.5">🤖</span>
            <div>
              <p className="text-[10px] font-bold mb-1" style={{ color: 'var(--xp-acc)' }}>Daily Summary</p>
              <p className="text-[11px] leading-relaxed" style={{ color: 'var(--xp-txt2)' }}>{summary}</p>
              <p className="text-[9px] mt-2 italic" style={{ color: 'var(--xp-txt3)' }}>AI-powered insights coming soon</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

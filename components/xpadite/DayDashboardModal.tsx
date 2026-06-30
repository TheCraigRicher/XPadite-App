'use client'

import { useMemo, useEffect, useState } from 'react'
import { useApp } from './AppContext'
import { formatMs, formatTime, APP_YEAR, dateKey as makeDateKey } from './utils'
import type { Task } from './types'

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

// ─── Animated Gauge Meter (reference-style, single continuous arc) ────────────

function GaugeMeter({ score }: { score: number }) {
  const { isDark } = useApp()
  const [animScore, setAnimScore] = useState(0)

  useEffect(() => {
    const duration = 1600
    const startTime = performance.now()
    let rafId: number
    function tick(now: number) {
      const t = Math.min((now - startTime) / duration, 1)
      const eased = 1 - Math.pow(1 - t, 3)
      setAnimScore(score * eased)
      if (t < 1) rafId = requestAnimationFrame(tick)
      else setAnimScore(score)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [score])

  const cx = 220, cy = 200, r = 120, sw = 28
  const toRad = (d: number) => (d * Math.PI) / 180
  const pt = (a: number, rr = r) => ({
    x: cx + rr * Math.cos(toRad(a)),
    y: cy - rr * Math.sin(toRad(a)),
  })

  // Single continuous half-circle arc: sweep=1 draws through (220,80) — the top dome
  const p0 = pt(180), p1 = pt(0)
  const fullArc = `M ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} A ${r} ${r} 0 0 1 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`
  const arcLen = Math.PI * r        // half-circumference ≈ 376.99
  const segLen = arcLen / 5         // each 36° segment

  // Five equal segments — contiguous, no gaps
  const segs = [
    { offset: 0,           color: '#94a3b8', glow: 'rgba(148,163,184,0.3)',  label: 'Not Serious', emoji: '' },
    { offset: segLen,      color: '#eab308', glow: 'rgba(234,179,8,0.35)',   label: 'Normal',      emoji: '' },
    { offset: segLen * 2,  color: '#22c55e', glow: 'rgba(34,197,94,0.35)',   label: 'Average',     emoji: '' },
    { offset: segLen * 3,  color: '#a855f7', glow: 'rgba(168,85,247,0.35)',  label: 'Advanced',    emoji: '🔥' },
    { offset: segLen * 4,  color: '#ef4444', glow: 'rgba(239,68,68,0.35)',   label: 'Elite Mode',  emoji: '🚀' },
  ]

  const li = score < 20 ? 0 : score < 40 ? 1 : score < 60 ? 2 : score < 80 ? 3 : 4
  const animAngle = 180 - (animScore / 100) * 180
  const needleTip = pt(animAngle, r * 0.75)

  // Segment boundary angles for ticks/labels
  const marks = [
    { angle: 180, label: '0'   },
    { angle: 144, label: '20'  },
    { angle: 108, label: '40'  },
    { angle: 72,  label: '60'  },
    { angle: 36,  label: '80'  },
    { angle: 0,   label: '100' },
  ]
  const segMidAngles = [162, 126, 90, 54, 18]

  // Theme-adaptive colors
  const trackColor = isDark ? 'rgba(255,255,255,0.05)': 'rgba(0,0,0,0.06)'
  const titleFill  = isDark ? 'rgba(255,255,255,0.32)': 'rgba(0,0,0,0.35)'
  const tickStroke = isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.3)'
  const numFill    = isDark ? 'rgba(255,255,255,0.55)': 'rgba(0,0,0,0.45)'
  const scoreFill  = isDark ? 'white'                 : '#0f172a'
  const scoreSubFl = isDark ? 'rgba(255,255,255,0.38)': 'rgba(0,0,0,0.35)'
  const shimmer    = isDark ? 'rgba(255,255,255,0.08)': 'rgba(255,255,255,0.5)'
  const hubBody    = isDark ? '#111827'               : '#e2e8f0'
  const hubStroke  = segs[li].color
  const circuitStk = isDark ? 'rgba(99,179,237,0.1)'  : 'rgba(99,179,237,0.12)'
  const glowOpacity = isDark ? 1 : 0.4

  return (
    <div className="flex flex-col items-center w-full">
      <svg viewBox="0 0 440 295" className="w-full max-w-[500px]">
        <defs>
          <filter id="gm-glow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="b"/>
            <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <filter id="gm-needle" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="b"/>
            <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <radialGradient id="gm-hub" cx="38%" cy="32%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.18)"/>
            <stop offset="100%" stopColor="rgba(0,0,0,0.65)"/>
          </radialGradient>
          <radialGradient id="gm-panel" cx="50%" cy="30%" r="85%">
            <stop offset="0%" stopColor="#161626"/>
            <stop offset="100%" stopColor="#08080f"/>
          </radialGradient>
        </defs>

        {/* Panel background */}
        <rect x={0} y={0} width={440} height={295} rx={14} fill={isDark ? 'url(#gm-panel)' : 'var(--xp-bg2)'}/>

        {/* Circuit texture */}
        <g stroke={circuitStk} strokeWidth="0.8" fill="none">
          <line x1="60" y1="130" x2="160" y2="130"/><line x1="280" y1="130" x2="380" y2="130"/>
          <line x1="220" y1="50" x2="220" y2="90"/>
          <line x1="130" y1="170" x2="90" y2="170"/><line x1="310" y1="170" x2="350" y2="170"/>
          <circle cx="160" cy="130" r="2.5" fill="rgba(99,179,237,0.15)" stroke="none"/>
          <circle cx="280" cy="130" r="2.5" fill="rgba(99,179,237,0.15)" stroke="none"/>
          <circle cx="220" cy="90"  r="2.5" fill="rgba(99,179,237,0.15)" stroke="none"/>
        </g>

        {/* Title — raised to sit clearly above arc labels */}
        <text x={cx} y={14} textAnchor="middle" fontSize="8.5" fill={titleFill} fontWeight="600" letterSpacing="3">
          PERFORMANCE ANALYTICS
        </text>

        {/* Background track — single arc */}
        <path d={fullArc} fill="none" stroke={trackColor} strokeWidth={sw + 10} strokeLinecap="butt"/>

        {/* Glow layers — same arc, dasharray reveals each segment */}
        {segs.map((s, i) => (
          <path key={`gl${i}`} d={fullArc} fill="none" stroke={s.glow}
            strokeWidth={sw + 14} strokeLinecap="butt" filter="url(#gm-glow)" opacity={glowOpacity}
            strokeDasharray={`${segLen.toFixed(2)} ${arcLen.toFixed(2)}`}
            strokeDashoffset={`${(-s.offset).toFixed(2)}`}/>
        ))}

        {/* Main colored segments — single arc, dasharray */}
        {segs.map((s, i) => (
          <path key={`sg${i}`} d={fullArc} fill="none" stroke={s.color}
            strokeWidth={sw} strokeLinecap="butt"
            strokeDasharray={`${segLen.toFixed(2)} ${arcLen.toFixed(2)}`}
            strokeDashoffset={`${(-s.offset).toFixed(2)}`}/>
        ))}

        {/* Shimmer highlight */}
        {segs.map((s, i) => (
          <path key={`sh${i}`} d={fullArc} fill="none" stroke={shimmer}
            strokeWidth={3} strokeLinecap="butt"
            strokeDasharray={`${segLen.toFixed(2)} ${arcLen.toFixed(2)}`}
            strokeDashoffset={`${(-s.offset - 7).toFixed(2)}`}/>
        ))}

        {/* Tick marks — short dashes just outside the colored band */}
        {marks.map((m, i) => {
          const inner = pt(m.angle, r + sw / 2 + 2)
          const outer = pt(m.angle, r + sw / 2 + 12)
          return <line key={`tk${i}`} x1={inner.x.toFixed(1)} y1={inner.y.toFixed(1)} x2={outer.x.toFixed(1)} y2={outer.y.toFixed(1)} stroke={tickStroke} strokeWidth="1.8" strokeLinecap="round"/>
        })}

        {/* Score numbers — inside the arc, readable and upright */}
        {marks.map((m, i) => {
          const lp = pt(m.angle, r - sw / 2 - 26)
          return <text key={`sn${i}`} x={lp.x.toFixed(1)} y={lp.y.toFixed(1)} textAnchor="middle" dominantBaseline="middle" fontSize="9" fill={numFill} fontWeight="600">{m.label}</text>
        })}

        {/* Category labels — radius trimmed so "Average" clears the title above */}
        {segs.map((s, i) => {
          const lp = pt(segMidAngles[i], r + sw / 2 + 34)
          return <text key={`cl${i}`} x={lp.x.toFixed(1)} y={lp.y.toFixed(1)} textAnchor="middle" dominantBaseline="middle" fontSize="8" fill={s.color} fontWeight="700">{s.label}</text>
        })}

        {/* Needle glow */}
        <line x1={cx} y1={cy} x2={needleTip.x.toFixed(2)} y2={needleTip.y.toFixed(2)} stroke={segs[li].color} strokeWidth={6} strokeLinecap="round" filter="url(#gm-needle)" opacity={0.55}/>
        {/* Needle */}
        <line x1={cx} y1={cy} x2={needleTip.x.toFixed(2)} y2={needleTip.y.toFixed(2)} stroke={segs[li].color} strokeWidth={2.5} strokeLinecap="round"/>

        {/* Hub glow ring */}
        <circle cx={cx} cy={cy} r={17} fill="none" stroke={hubStroke} strokeWidth={1} opacity={0.4} filter="url(#gm-glow)"/>
        {/* Hub body */}
        <circle cx={cx} cy={cy} r={14} fill={hubBody} stroke={hubStroke} strokeWidth={1.5}/>
        <circle cx={cx} cy={cy} r={9}  fill="url(#gm-hub)"/>
        <circle cx={cx} cy={cy} r={4}  fill={segs[li].color} opacity={0.85}/>
        <circle cx={cx} cy={cy} r={2}  fill="white" opacity={0.4}/>

        {/* Score */}
        <text x={cx - 6} y={cy + 44} textAnchor="end" fontSize="38" fontWeight="900" fill={scoreFill} fontFamily="-apple-system,BlinkMacSystemFont,sans-serif">
          {Math.round(animScore)}
        </text>
        <text x={cx} y={cy + 38} textAnchor="start" fontSize="16" fill={scoreSubFl} fontFamily="-apple-system,BlinkMacSystemFont,sans-serif">
          /100
        </text>

        {/* Performance label — with emoji via foreignObject for reliable rendering */}
        <foreignObject x={cx - 100} y={cy + 50} width="200" height="28">
          <div style={{ textAlign: 'center', fontSize: 13, fontWeight: 700, color: segs[li].color, letterSpacing: 0.5 }}>
            {segs[li].emoji ? `${segs[li].emoji} ${segs[li].label}` : segs[li].label}
          </div>
        </foreignObject>
      </svg>
    </div>
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

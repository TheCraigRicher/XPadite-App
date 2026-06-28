'use client'

import { useMemo, useEffect, useState } from 'react'
import { useApp } from './AppContext'
import { formatMs, APP_YEAR, MONTHS } from './utils'

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface ProgressPoint { x: number; y: number }

function ProgressGraph({ points, color = '#7c3aed', height = 90, id = 'ypg' }: {
  points: ProgressPoint[]
  color?: string
  height?: number
  id?: string
}) {
  const W = 280, H = height
  if (points.length < 2) {
    return (
      <div className="flex items-center justify-center" style={{ height }}>
        <p className="text-[11px]" style={{ color: 'var(--xp-txt3)' }}>No data yet for this year</p>
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
      {svgPts.map((p, i) => (
        <circle key={i} cx={p.sx} cy={p.sy} r="2.5" fill={color} opacity="0.8" />
      ))}
    </svg>
  )
}

function DonutChart({ segments }: { segments: { color: string; pct: number }[] }) {
  const cx = 80, cy = 80, r = 62, inner = 40
  const toRad = (d: number) => (d * Math.PI) / 180
  const pt = (a: number, radius: number) => ({
    x: cx + radius * Math.cos(toRad(a)),
    y: cy + radius * Math.sin(toRad(a)),
  })
  const total = segments.reduce((s, x) => s + x.pct, 0)
  if (total === 0) {
    return (
      <svg viewBox="0 0 160 160" className="w-32 h-32">
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
    <svg viewBox="0 0 160 160" className="w-32 h-32">
      {paths}
      <circle cx={cx} cy={cy} r={inner} fill="var(--xp-card)" />
    </svg>
  )
}

function AnimatedGauge({ score }: { score: number }) {
  const [animAngle, setAnimAngle] = useState(210)

  useEffect(() => {
    const targetAngle = 210 - (score / 100) * 240
    const duration = 1600
    const startTime = performance.now()
    let rafId: number
    function tick(now: number) {
      const t = Math.min((now - startTime) / duration, 1)
      const eased = 1 - Math.pow(1 - t, 3)
      setAnimAngle(210 + (targetAngle - 210) * eased)
      if (t < 1) rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [score])

  const cx = 160, cy = 135, r = 110, sw = 20
  const toRad = (d: number) => (d * Math.PI) / 180
  const pt = (a: number, rr = r) => ({
    x: cx + rr * Math.cos(toRad(a)),
    y: cy - rr * Math.sin(toRad(a)),
  })

  const segs = [
    { from: 210, to: 162, color: '#64748b', label: 'Not Serious' },
    { from: 162, to: 114, color: '#22d3ee', label: 'Normal' },
    { from: 114, to: 66,  color: '#a3e635', label: 'Average' },
    { from: 66,  to: 18,  color: '#f97316', label: 'Advanced' },
    { from: 18,  to: -30, color: '#ef4444', label: 'Elite Mode' },
  ]

  function arcPath(from: number, to: number) {
    const s = pt(from), e = pt(to)
    const large = Math.abs(from - to) > 180 ? 1 : 0
    return `M ${s.x.toFixed(1)} ${s.y.toFixed(1)} A ${r} ${r} 0 ${large} 0 ${e.x.toFixed(1)} ${e.y.toFixed(1)}`
  }

  const needleTip = pt(animAngle, r * 0.76)
  const labelR = r + 28
  const levelIdx = Math.min(4, Math.floor(score / 20))

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 320 188" className="w-full max-w-[340px]">
        {segs.map(s => (
          <path key={s.label} d={arcPath(s.from, s.to)} fill="none" stroke={s.color} strokeWidth={sw} strokeLinecap="butt" />
        ))}
        {segs.map(s => {
          const lp = pt((s.from + s.to) / 2, labelR)
          return <text key={s.label} x={lp.x.toFixed(1)} y={lp.y.toFixed(1)} fontSize="8.5" fill={s.color} textAnchor="middle">{s.label}</text>
        })}
        <line x1={cx} y1={cy} x2={needleTip.x.toFixed(1)} y2={needleTip.y.toFixed(1)} stroke="var(--xp-txt)" strokeWidth={2.5} strokeLinecap="round" />
        <circle cx={cx} cy={cy} r={8} fill="var(--xp-txt)" />
        <circle cx={cx} cy={cy} r={4} fill="var(--xp-card)" />
      </svg>
      <div className="text-center -mt-3">
        <p className="text-base font-bold" style={{ color: segs[levelIdx].color }}>{segs[levelIdx].label}</p>
        <p className="text-xs mt-0.5" style={{ color: 'var(--xp-txt3)' }}>Annual Performance: {score}%</p>
      </div>
    </div>
  )
}

function MonthlyBars({ data }: { data: { label: string; ms: number; isCurrent: boolean }[] }) {
  const maxMs = Math.max(...data.map(d => d.ms), 1)
  const COLORS = ['#6366f1', '#7c3aed', '#ef4444', '#f97316', '#eab308', '#22c55e', '#0891b2', '#ec4899', '#14b8a6', '#8b5cf6', '#f43f5e', '#3b82f6']

  return (
    <div className="flex items-end justify-between gap-1 h-40 pt-4">
      {data.map((d, i) => {
        const pct = (d.ms / maxMs) * 100
        const hrs = d.ms / 3_600_000
        return (
          <div key={d.label} className="flex flex-col items-center flex-1 gap-1">
            {d.ms > 0 && (
              <span className="text-[7px] font-bold" style={{ color: d.isCurrent ? '#a78bfa' : COLORS[i % COLORS.length] }}>
                {hrs >= 1 ? `${hrs.toFixed(0)}h` : `${Math.round(d.ms / 60_000)}m`}
              </span>
            )}
            <div className="w-full flex-1 flex items-end">
              <div
                className="w-full rounded-t-md transition-all"
                style={{
                  height: `${Math.max(pct, d.ms > 0 ? 4 : 0)}%`,
                  background: d.isCurrent
                    ? 'linear-gradient(180deg, #a78bfa 0%, #7c3aed 100%)'
                    : COLORS[i % COLORS.length],
                  opacity: d.ms > 0 ? 1 : 0.1,
                  minHeight: d.ms > 0 ? 4 : 0,
                  boxShadow: d.isCurrent ? '0 0 10px rgba(124,58,237,0.4)' : 'none',
                }}
              />
            </div>
            <span className="text-[7px] font-medium" style={{ color: d.isCurrent ? 'var(--xp-acc)' : 'var(--xp-txt3)' }}>
              {d.label}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ─── YearlyDashboardModal ─────────────────────────────────────────────────────

interface YearlyDashboardModalProps {
  onClose: () => void
}

export function YearlyDashboardModal({ onClose }: YearlyDashboardModalProps) {
  const { calData, activities } = useApp()
  const currentMonth = new Date().getMonth()

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const stats = useMemo(() => {
    let totalMs = 0, totalTasks = 0, completedTasks = 0
    let productiveDays = 0, hyperDays = 0, milestoneDays = 0
    const actMs = new Map<string, number>()
    const monthTotals: number[] = Array(12).fill(0)
    let bestDayMs = 0
    let bestDayLabel = ''

    for (let m = 0; m < 12; m++) {
      const prefix = `${APP_YEAR}-${String(m + 1).padStart(2, '0')}-`
      Object.entries(calData).filter(([k]) => k.startsWith(prefix)).forEach(([k, day]) => {
        if (day.productive || day.hyper || day.milestone) productiveDays++
        if (day.hyper) hyperDays++
        if (day.milestone) milestoneDays++
        totalTasks += day.tasks?.length ?? 0
        completedTasks += day.tasks?.filter(t => t.done).length ?? 0

        let dayMs = 0
        day.tasks?.forEach(t => {
          const sess = (t.sessions ?? []).filter(s => s.endTs !== null)
          sess.forEach(s => {
            const dur = s.endTs! - s.startTs
            dayMs += dur
            totalMs += dur
            monthTotals[m] += dur
            actMs.set(t.actId, (actMs.get(t.actId) ?? 0) + dur)
          })
        })
        if (dayMs > bestDayMs) {
          bestDayMs = dayMs
          const [, , d] = k.split('-')
          bestDayLabel = `${MONTHS[m]} ${parseInt(d)}`
        }
      })
    }

    let score = 0
    const yHrs = totalMs / 3_600_000
    if (productiveDays >= 30) score += 15
    if (productiveDays >= 100) score += 15
    if (yHrs >= 50) score += 15
    if (yHrs >= 200) score += 15
    if (yHrs >= 500) score += 10
    if (hyperDays >= 5) score += 10
    if (milestoneDays >= 1) score += 10
    if (completedTasks >= 10) score += 5
    if (completedTasks >= 50) score += 5
    score = Math.min(100, score)

    const actBreakdown = Array.from(actMs.entries()).map(([actId, ms]) => {
      const act = activities.find(a => a.id === actId)
      return { actId, name: act?.name ?? 'Other', color: act?.color ?? '#94a3b8', ms, pct: totalMs > 0 ? ms / totalMs : 0 }
    }).sort((a, b) => b.ms - a.ms)

    return { totalMs, totalTasks, completedTasks, productiveDays, hyperDays, milestoneDays, score, actBreakdown, monthTotals, bestDayMs, bestDayLabel }
  }, [calData, activities])

  // Yearly progress: monthly totals as line points
  const progressPoints = useMemo<ProgressPoint[]>(() => {
    const months = stats.monthTotals
    const nonZero = months.some(m => m > 0)
    if (!nonZero) return []
    return months.map((ms, i) => ({ x: i / 11, y: ms }))
  }, [stats.monthTotals])

  const monthBarData = useMemo(() =>
    MONTHS.map((label, i) => ({
      label: label.slice(0, 3),
      ms: stats.monthTotals[i],
      isCurrent: i === currentMonth,
    }))
  , [stats.monthTotals, currentMonth])

  const milestones = useMemo(() => {
    const list: { label: string; value: string; icon: string }[] = []
    if (stats.productiveDays >= 100) list.push({ label: 'Century Club', value: `${stats.productiveDays} days`, icon: '🏆' })
    if (stats.hyperDays >= 10) list.push({ label: 'Fire Streak Master', value: `${stats.hyperDays} hyper days`, icon: '🔥' })
    const yHrs = stats.totalMs / 3_600_000
    if (yHrs >= 100) list.push({ label: '100h Club', value: `${yHrs.toFixed(0)}h total`, icon: '⏱' })
    if (yHrs >= 500) list.push({ label: '500h Elite', value: `${yHrs.toFixed(0)}h total`, icon: '⚡' })
    if (stats.milestoneDays >= 3) list.push({ label: 'Milestone Achiever', value: `${stats.milestoneDays} milestones`, icon: '🎯' })
    if (stats.completedTasks >= 100) list.push({ label: 'Task Champion', value: `${stats.completedTasks} tasks done`, icon: '✅' })
    return list
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
          style={{ background: 'linear-gradient(135deg, #0a0a1a 0%, #1a0a30 50%, #0d1a30 100%)', borderBottom: '0.5px solid rgba(255,255,255,0.08)' }}
        >
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-bold text-white">Yearly Dashboard</h2>
            <p className="text-[10px] mt-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>
              {APP_YEAR} — Annual Performance Overview
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-xs px-2.5 py-1.5 rounded-lg transition-all hover:opacity-80 flex-shrink-0"
            style={{ background: 'rgba(239,68,68,0.2)', border: '0.5px solid rgba(239,68,68,0.35)', color: '#fca5a5' }}
          >
            × Close
          </button>
        </div>

        {/* ── Top stat cards ──────────────────────────────────────── */}
        <div className="grid grid-cols-3 gap-3 p-4 pb-2">
          {[
            { label: 'Total Worked', value: formatMs(stats.totalMs), accent: true },
            { label: 'Productive Days', value: String(stats.productiveDays) },
            { label: 'Tasks Completed', value: `${stats.completedTasks}/${stats.totalTasks}` },
            { label: '🔥 Hyper Days', value: String(stats.hyperDays) },
            { label: '🏆 Milestones', value: String(stats.milestoneDays) },
            { label: 'Annual Score', value: `${stats.score}%` },
          ].map(m => (
            <div key={m.label} className="rounded-xl px-3.5 py-3" style={{ background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr)' }}>
              <p className={`font-bold ${m.accent ? 'text-xl' : 'text-base'}`} style={{ color: m.accent ? 'var(--xp-acc)' : 'var(--xp-txt)' }}>
                {m.value}
              </p>
              <p className="text-[10px] mt-0.5" style={{ color: 'var(--xp-txt3)' }}>{m.label}</p>
            </div>
          ))}
        </div>

        {/* ── Activity Distribution ───────────────────────────────── */}
        {stats.actBreakdown.length > 0 && (
          <div className="mx-4 mb-3 rounded-xl p-4" style={{ background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr)' }}>
            <p className="text-[11px] font-semibold mb-3" style={{ color: 'var(--xp-txt)' }}>Yearly Activity Distribution</p>
            <div className="flex items-center gap-5">
              <div className="flex-shrink-0">
                <DonutChart segments={stats.actBreakdown.map(a => ({ color: a.color, pct: a.pct }))} />
              </div>
              <div className="flex-1 space-y-2">
                {stats.actBreakdown.slice(0, 6).map(a => (
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

        {/* ── Annual Performance Gauge ────────────────────────────── */}
        <div className="mx-4 mb-3 rounded-xl p-5" style={{ background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr)' }}>
          <p className="text-[11px] font-semibold mb-4 text-center" style={{ color: 'var(--xp-txt)' }}>Annual Performance Rating</p>
          <AnimatedGauge score={stats.score} />
        </div>

        {/* ── Yearly Progress Graph ───────────────────────────────── */}
        <div className="mx-4 mb-3 rounded-xl p-4" style={{ background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr)' }}>
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] font-semibold" style={{ color: 'var(--xp-txt)' }}>Yearly Progress</p>
            <span className="text-[10px]" style={{ color: 'var(--xp-txt3)' }}>Monthly trend</span>
          </div>
          <ProgressGraph points={progressPoints} color="#6366f1" height={90} id="year-prog" />
          {/* Month labels */}
          <div className="flex justify-between mt-1">
            {['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'].map((l, i) => (
              <span key={i} className="text-[8px] flex-1 text-center" style={{ color: i === currentMonth ? 'var(--xp-acc)' : 'var(--xp-txt3)' }}>{l}</span>
            ))}
          </div>
        </div>

        {/* ── Monthly Overview Bar Chart ──────────────────────────── */}
        <div className="mx-4 mb-3 rounded-xl p-4" style={{ background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr)' }}>
          <p className="text-[11px] font-semibold mb-1" style={{ color: 'var(--xp-txt)' }}>Monthly Overview</p>
          <MonthlyBars data={monthBarData} />
        </div>

        {/* ── Yearly Milestones ───────────────────────────────────── */}
        {milestones.length > 0 && (
          <div className="mx-4 mb-3 rounded-xl p-4" style={{ background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr)' }}>
            <p className="text-[11px] font-semibold mb-3" style={{ color: 'var(--xp-txt)' }}>Achievements Unlocked</p>
            <div className="grid grid-cols-2 gap-2">
              {milestones.map(m => (
                <div key={m.label} className="flex items-center gap-2.5 rounded-lg px-3 py-2" style={{ background: 'var(--xp-bg2)', border: '0.5px solid var(--xp-bdr)' }}>
                  <span className="text-base">{m.icon}</span>
                  <div>
                    <p className="text-[10px] font-semibold" style={{ color: 'var(--xp-txt)' }}>{m.label}</p>
                    <p className="text-[9px]" style={{ color: 'var(--xp-txt3)' }}>{m.value}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Best Day ────────────────────────────────────────────── */}
        {stats.bestDayMs > 0 && (
          <div className="mx-4 mb-3 rounded-xl px-4 py-3.5 flex items-center gap-3" style={{ background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr)' }}>
            <span className="text-2xl">🏆</span>
            <div>
              <p className="text-[10px] font-bold" style={{ color: 'var(--xp-txt3)' }}>Best Day of the Year</p>
              <p className="text-sm font-bold" style={{ color: 'var(--xp-txt)' }}>{stats.bestDayLabel}</p>
              <p className="text-[11px]" style={{ color: 'var(--xp-acc)' }}>{formatMs(stats.bestDayMs)} tracked</p>
            </div>
          </div>
        )}

        {/* ── Annual Summary ──────────────────────────────────────── */}
        <div
          className="mx-4 mb-5 rounded-xl px-4 py-3.5"
          style={{ background: 'linear-gradient(135deg, rgba(99,102,241,0.07), rgba(124,58,237,0.05))', border: '0.5px solid rgba(99,102,241,0.18)' }}
        >
          <div className="flex items-start gap-2.5">
            <span className="text-base flex-shrink-0 mt-0.5">🤖</span>
            <div>
              <p className="text-[10px] font-bold mb-1" style={{ color: 'var(--xp-acc)' }}>Annual Summary</p>
              <p className="text-[11px] leading-relaxed" style={{ color: 'var(--xp-txt2)' }}>
                {stats.productiveDays > 0
                  ? `${stats.productiveDays} productive days logged in ${APP_YEAR} with ${(stats.totalMs / 3_600_000).toFixed(1)}h of focused work tracked. ${stats.hyperDays > 0 ? `${stats.hyperDays} 🔥 fire days` : 'Keep building your streak'} — ${stats.score >= 60 ? 'you\'re performing at an elite level' : 'consistency is the key to growth'}.`
                  : `Start logging productive days to see your annual performance breakdown. Every day counts.`
                }
              </p>
              <p className="text-[9px] mt-2 italic" style={{ color: 'var(--xp-txt3)' }}>AI-powered insights coming soon</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

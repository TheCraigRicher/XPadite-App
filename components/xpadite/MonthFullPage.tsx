'use client'

import { useMemo, useEffect, useState, useCallback } from 'react'
import { useApp } from './AppContext'
import {
  dateKey, isToday, DAY_HEADERS, MONTHS, APP_YEAR, getMonthStats, formatMs,
} from './utils'

// ─── GaugeMeter (single continuous arc, light/dark adaptive) ─────────────────

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

  const p0 = pt(180), p1 = pt(0)
  const fullArc = `M ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} A ${r} ${r} 0 0 0 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`
  const arcLen = Math.PI * r
  const segLen = arcLen / 5

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

  const marks = [
    { angle: 180, label: '0'   },
    { angle: 144, label: '20'  },
    { angle: 108, label: '40'  },
    { angle: 72,  label: '60'  },
    { angle: 36,  label: '80'  },
    { angle: 0,   label: '100' },
  ]
  const segMidAngles = [162, 126, 90, 54, 18]

  const panelBg    = isDark ? '#0b0b18'               : '#f1f5f9'
  const trackColor = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)'
  const titleFill  = isDark ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.35)'
  const tickStroke = isDark ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.3)'
  const numFill    = isDark ? 'rgba(255,255,255,0.38)' : 'rgba(0,0,0,0.4)'
  const scoreFill  = isDark ? 'white'                  : '#0f172a'
  const scoreSubFl = isDark ? 'rgba(255,255,255,0.38)' : 'rgba(0,0,0,0.35)'
  const shimmer    = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.5)'
  const hubBody    = isDark ? '#111827'                : '#e2e8f0'

  return (
    <div className="flex flex-col items-center w-full">
      <svg viewBox="0 0 440 285" className="w-full max-w-[460px]">
        <defs>
          <filter id="mfp-glow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="b"/>
            <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <filter id="mfp-needle" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="b"/>
            <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <radialGradient id="mfp-hub" cx="38%" cy="32%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.18)"/>
            <stop offset="100%" stopColor="rgba(0,0,0,0.65)"/>
          </radialGradient>
        </defs>

        <rect x={0} y={0} width={440} height={285} rx={14} fill={panelBg}/>

        <g stroke={isDark ? 'rgba(99,179,237,0.07)' : 'rgba(99,179,237,0.12)'} strokeWidth="0.8" fill="none">
          <line x1="60" y1="130" x2="160" y2="130"/><line x1="280" y1="130" x2="380" y2="130"/>
          <line x1="220" y1="50" x2="220" y2="90"/>
          <circle cx="160" cy="130" r="2.5" fill="rgba(99,179,237,0.15)" stroke="none"/>
          <circle cx="280" cy="130" r="2.5" fill="rgba(99,179,237,0.15)" stroke="none"/>
          <circle cx="220" cy="90"  r="2.5" fill="rgba(99,179,237,0.15)" stroke="none"/>
        </g>

        <text x={cx} y={22} textAnchor="middle" fontSize="8.5" fill={titleFill} fontWeight="600" letterSpacing="3">PERFORMANCE ANALYTICS</text>

        <path d={fullArc} fill="none" stroke={trackColor} strokeWidth={sw + 10} strokeLinecap="butt"/>
        {segs.map((s, i) => (
          <path key={`gl${i}`} d={fullArc} fill="none" stroke={s.glow} strokeWidth={sw + 14} strokeLinecap="butt" filter="url(#mfp-glow)"
            strokeDasharray={`${segLen.toFixed(2)} ${arcLen.toFixed(2)}`} strokeDashoffset={`${(-s.offset).toFixed(2)}`}/>
        ))}
        {segs.map((s, i) => (
          <path key={`sg${i}`} d={fullArc} fill="none" stroke={s.color} strokeWidth={sw} strokeLinecap="butt"
            strokeDasharray={`${segLen.toFixed(2)} ${arcLen.toFixed(2)}`} strokeDashoffset={`${(-s.offset).toFixed(2)}`}/>
        ))}
        {segs.map((s, i) => (
          <path key={`sh${i}`} d={fullArc} fill="none" stroke={shimmer} strokeWidth={3} strokeLinecap="butt"
            strokeDasharray={`${segLen.toFixed(2)} ${arcLen.toFixed(2)}`} strokeDashoffset={`${(-s.offset - 7).toFixed(2)}`}/>
        ))}

        {marks.map((m, i) => {
          const inner = pt(m.angle, r - sw / 2 - 3)
          const outer = pt(m.angle, r + sw / 2 + 5)
          return <line key={`tk${i}`} x1={inner.x.toFixed(1)} y1={inner.y.toFixed(1)} x2={outer.x.toFixed(1)} y2={outer.y.toFixed(1)} stroke={tickStroke} strokeWidth="1.8" strokeLinecap="round"/>
        })}
        {marks.map((m, i) => {
          const lp = pt(m.angle, r + sw / 2 + 18)
          return <text key={`sn${i}`} x={lp.x.toFixed(1)} y={lp.y.toFixed(1)} textAnchor="middle" dominantBaseline="middle" fontSize="8" fill={numFill} fontWeight="500">{m.label}</text>
        })}
        {segs.map((s, i) => {
          const lp = pt(segMidAngles[i], r + sw / 2 + 44)
          return <text key={`cl${i}`} x={lp.x.toFixed(1)} y={lp.y.toFixed(1)} textAnchor="middle" dominantBaseline="middle" fontSize="8" fill={s.color} fontWeight="700">{s.label}</text>
        })}

        <line x1={cx} y1={cy} x2={needleTip.x.toFixed(2)} y2={needleTip.y.toFixed(2)} stroke={segs[li].color} strokeWidth={6} strokeLinecap="round" filter="url(#mfp-needle)" opacity={0.55}/>
        <line x1={cx} y1={cy} x2={needleTip.x.toFixed(2)} y2={needleTip.y.toFixed(2)} stroke={segs[li].color} strokeWidth={2.5} strokeLinecap="round"/>

        <circle cx={cx} cy={cy} r={17} fill="none" stroke={segs[li].color} strokeWidth={1} opacity={0.4} filter="url(#mfp-glow)"/>
        <circle cx={cx} cy={cy} r={14} fill={hubBody} stroke={segs[li].color} strokeWidth={1.5}/>
        <circle cx={cx} cy={cy} r={9}  fill="url(#mfp-hub)"/>
        <circle cx={cx} cy={cy} r={4}  fill={segs[li].color} opacity={0.85}/>
        <circle cx={cx} cy={cy} r={2}  fill="white" opacity={0.4}/>

        <text x={cx - 6} y={cy + 44} textAnchor="end" fontSize="38" fontWeight="900" fill={scoreFill} fontFamily="-apple-system,BlinkMacSystemFont,sans-serif">{Math.round(animScore)}</text>
        <text x={cx} y={cy + 38} textAnchor="start" fontSize="16" fill={scoreSubFl} fontFamily="-apple-system,BlinkMacSystemFont,sans-serif">/100</text>

        <foreignObject x={cx - 100} y={cy + 50} width="200" height="28">
          <div style={{ textAlign: 'center', fontSize: 13, fontWeight: 700, color: segs[li].color }}>
            {segs[li].emoji ? `${segs[li].emoji} ${segs[li].label}` : segs[li].label}
          </div>
        </foreignObject>
      </svg>
    </div>
  )
}

// ─── Mini calendar (large version) ───────────────────────────────────────────

function MonthCalendarLarge({ month, calData }: { month: number; calData: Record<string, unknown> }) {
  const { cells, totalDays } = useMemo(() => {
    const fd = new Date(APP_YEAR, month, 1).getDay()
    const td = new Date(APP_YEAR, month + 1, 0).getDate()
    const prevTd = new Date(APP_YEAR, month, 0).getDate()
    const result: { day: number; key: string; isGhost: boolean; dow: number }[] = []
    for (let i = fd - 1; i >= 0; i--) {
      result.push({ day: prevTd - i, key: `g-p-${i}`, isGhost: true, dow: fd - 1 - i })
    }
    for (let d = 1; d <= td; d++) {
      result.push({ day: d, key: dateKey(APP_YEAR, month, d), isGhost: false, dow: (fd + d - 1) % 7 })
    }
    const rem = result.length % 7
    const suf = rem === 0 ? 0 : 7 - rem
    for (let d = 1; d <= suf; d++) {
      result.push({ day: d, key: `g-n-${d}`, isGhost: true, dow: (fd + td + d - 1) % 7 })
    }
    return { cells: result, totalDays: td }
  }, [month])

  const cd = calData as Record<string, { productive?: boolean; hyper?: boolean; milestone?: boolean; goal?: boolean }>

  return (
    <div className="w-full">
      {/* Day headers */}
      <div className="grid grid-cols-7 mb-1">
        {DAY_HEADERS.map((d, i) => (
          <div key={d} className="text-center text-[10px] font-semibold py-1" style={{ color: i === 0 ? '#f97316' : 'var(--xp-txt3)' }}>{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((cell, idx) => {
          if (cell.isGhost) {
            return <div key={idx} className="aspect-square flex items-center justify-center text-[10px]" style={{ color: 'var(--xp-bdr2)' }}>{cell.day}</div>
          }

          const data = cd[cell.key]
          const productive = !!data?.productive
          const hyper = !!data?.hyper
          const milestone = !!data?.milestone
          const goal = !!data?.goal
          const streak = productive || hyper || milestone || goal
          const todayCell = isToday(APP_YEAR, month, cell.day)

          const prevKey = cell.day > 1 ? dateKey(APP_YEAR, month, cell.day - 1) : null
          const nextKey = cell.day < totalDays ? dateKey(APP_YEAR, month, cell.day + 1) : null
          const connL = streak && cell.dow !== 0 && !!prevKey && (() => { const d = cd[prevKey]; return !!(d?.productive || d?.hyper || d?.milestone || d?.goal) })()
          const connR = streak && cell.dow !== 6 && !!nextKey && (() => { const d = cd[nextKey]; return !!(d?.productive || d?.hyper || d?.milestone || d?.goal) })()

          if (hyper) return (
            <div key={cell.key} className="aspect-square relative select-none">
              {connL && <div style={{ position: 'absolute', left: 0, right: '50%', top: '50%', height: 2, background: '#16a34a', transform: 'translateY(-50%)', zIndex: 0 }}/>}
              {connR && <div style={{ position: 'absolute', left: '50%', right: 0, top: '50%', height: 2, background: '#16a34a', transform: 'translateY(-50%)', zIndex: 0 }}/>}
              <span style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', fontSize: 22, lineHeight: 1, zIndex: 1 }}>🔥</span>
              <span style={{ position: 'absolute', top: '65%', left: '50%', transform: 'translate(-50%,-50%)', fontSize: 9, fontWeight: 700, color: '#0a0a0a', zIndex: 2 }}>{cell.day}</span>
            </div>
          )

          if (milestone) return (
            <div key={cell.key} className="aspect-square relative select-none">
              {connL && <div style={{ position: 'absolute', left: 0, right: '50%', top: '50%', height: 2, background: '#16a34a', transform: 'translateY(-50%)', zIndex: 0 }}/>}
              {connR && <div style={{ position: 'absolute', left: '50%', right: 0, top: '50%', height: 2, background: '#16a34a', transform: 'translateY(-50%)', zIndex: 0 }}/>}
              <span style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', fontSize: 8, color: 'rgba(167,139,250,0.2)', filter: 'drop-shadow(0 0 4px rgba(167,139,250,0.5))', zIndex: 0 }}>★</span>
              <span style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', fontSize: 20, lineHeight: 1, zIndex: 1 }}>🏆</span>
              <span style={{ position: 'absolute', top: '37%', left: '50%', transform: 'translate(-50%,-50%)', fontSize: 7, fontWeight: 700, color: '#0a0a0a', zIndex: 2 }}>{cell.day}</span>
            </div>
          )

          if (goal) return (
            <div key={cell.key} className="aspect-square relative select-none">
              {connL && <div style={{ position: 'absolute', left: 0, right: '50%', top: '50%', height: 2, background: '#16a34a', transform: 'translateY(-50%)', zIndex: 0 }}/>}
              {connR && <div style={{ position: 'absolute', left: '50%', right: 0, top: '50%', height: 2, background: '#16a34a', transform: 'translateY(-50%)', zIndex: 0 }}/>}
              <span style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', fontSize: 26, lineHeight: 1, zIndex: 1 }}>🎯</span>
              <span style={{ position: 'absolute', top: '52%', left: '50%', transform: 'translate(-50%,-50%)', fontSize: 9, fontWeight: 700, color: '#000', zIndex: 2 }}>{cell.day}</span>
            </div>
          )

          let circleStyle: React.CSSProperties = { color: cell.dow === 0 ? '#f97316' : 'var(--xp-txt3)', fontSize: 11 }
          if (productive) circleStyle = { background: '#16a34a', color: 'white', fontSize: 11, fontWeight: 600, boxShadow: '0 0 0 1.5px #16a34a' }
          else if (todayCell) circleStyle = { color: 'var(--xp-acc)', background: 'rgba(124,58,237,0.08)', outline: '1.5px solid var(--xp-acc)', outlineOffset: '-1px', fontSize: 11 }

          return (
            <div key={cell.key} className="aspect-square relative select-none">
              {connL && <div style={{ position: 'absolute', left: 0, right: '85%', top: '50%', height: 2, background: '#16a34a', transform: 'translateY(-50%)', zIndex: 0 }}/>}
              {connR && <div style={{ position: 'absolute', left: '85%', right: -1, top: '50%', height: 2, background: '#16a34a', transform: 'translateY(-50%)', zIndex: 0 }}/>}
              <div className="absolute inset-[18%] rounded-full flex items-center justify-center" style={{ zIndex: 1, ...circleStyle }}>{cell.day}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Weekly progress bars ─────────────────────────────────────────────────────

function MonthWeeklyBars({ month, sessions }: { month: number; sessions: { dateKey: string; startTs: number; endTs: number | null }[] }) {
  const weeks = useMemo(() => {
    const fd = new Date(APP_YEAR, month, 1).getDay()
    const td = new Date(APP_YEAR, month + 1, 0).getDate()
    const result: { label: string; ms: number }[] = []
    let wk = 1
    for (let start = 1; start <= td; start += 7) {
      const end = Math.min(start + 6, td)
      const keys = new Set<string>()
      for (let d = start; d <= end; d++) keys.add(dateKey(APP_YEAR, month, d))
      const ms = sessions.filter(s => s.endTs !== null && keys.has(s.dateKey)).reduce((sum, s) => sum + (s.endTs! - s.startTs), 0)
      result.push({ label: `Wk ${wk++}`, ms })
    }
    void fd
    return result
  }, [month, sessions])

  const maxMs = Math.max(...weeks.map(w => w.ms), 1)
  const COLORS = ['#6366f1', '#7c3aed', '#ef4444', '#f97316', '#eab308']

  return (
    <div className="flex items-end gap-3 h-28">
      {weeks.map((w, i) => {
        const pct = (w.ms / maxMs) * 100
        const hrs = w.ms / 3_600_000
        return (
          <div key={w.label} className="flex flex-col items-center flex-1 gap-1">
            {w.ms > 0 && <span className="text-[9px] font-bold" style={{ color: COLORS[i % COLORS.length] }}>{hrs >= 1 ? `${hrs.toFixed(1)}h` : `${Math.round(w.ms / 60_000)}m`}</span>}
            <div className="w-full flex-1 flex items-end">
              <div className="w-full rounded-t-md" style={{ height: `${Math.max(pct, w.ms > 0 ? 4 : 0)}%`, background: COLORS[i % COLORS.length], opacity: w.ms > 0 ? 1 : 0.12, minHeight: w.ms > 0 ? 4 : 0 }}/>
            </div>
            <span className="text-[9px]" style={{ color: 'var(--xp-txt3)' }}>{w.label}</span>
          </div>
        )
      })}
    </div>
  )
}

// ─── MonthFullPage ────────────────────────────────────────────────────────────

interface MonthFullPageProps {
  month: number
  onClose: () => void
}

export function MonthFullPage({ month, onClose }: MonthFullPageProps) {
  const { calData, sessions, activities } = useApp()

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const stats = useMemo(() => getMonthStats(calData, APP_YEAR, month), [calData, month])

  // Gauge score from completion rate
  const gaugeScore = stats.completionRate

  // Monthly sessions
  const monthKeys = useMemo(() => {
    const s = new Set<string>()
    const td = new Date(APP_YEAR, month + 1, 0).getDate()
    for (let d = 1; d <= td; d++) s.add(dateKey(APP_YEAR, month, d))
    return s
  }, [month])

  const monthSessions = useMemo(
    () => sessions.filter(s => monthKeys.has(s.dateKey)),
    [sessions, monthKeys]
  )

  const totalMs = useMemo(
    () => monthSessions.filter(s => s.endTs !== null).reduce((sum, s) => sum + (s.endTs! - s.startTs), 0),
    [monthSessions]
  )

  // Activity breakdown from month's day data
  const actBreakdown = useMemo(() => {
    const actMs = new Map<string, number>()
    for (const key of monthKeys) {
      const day = calData[key]
      if (!day) continue
      day.tasks.flatMap(t => (t.sessions ?? []).filter(s => s.endTs !== null).map(s => ({ actId: t.actId, ms: s.endTs! - s.startTs }))).forEach(({ actId, ms }) => {
        if (actId) actMs.set(actId, (actMs.get(actId) ?? 0) + ms)
      })
    }
    return Array.from(actMs.entries()).map(([actId, ms]) => {
      const act = activities.find(a => a.id === actId)
      return { name: act?.name ?? 'Other', color: act?.color ?? '#94a3b8', ms }
    }).sort((a, b) => b.ms - a.ms).slice(0, 6)
  }, [calData, monthKeys, activities])

  const stopProp = useCallback((e: React.MouseEvent) => e.stopPropagation(), [])

  const statCards = [
    { label: '✅ Productive', value: `${stats.productiveDays} / ${stats.totalDays}` },
    { label: '🔥 Fire Days', value: String(stats.hyperDays) },
    { label: '🏆 Milestones', value: String(stats.milestoneDays) },
    { label: '🎯 Goals Hit', value: String(stats.goalDays) },
    { label: '⏱ Total Hours', value: formatMs(totalMs) },
    { label: '📈 Completion', value: `${stats.completionRate}%` },
  ]

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto"
      style={{ background: 'var(--xp-bg)' }}
      onClick={onClose}
    >
      <div className="min-h-full" onClick={stopProp}>
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-3 sticky top-0 z-10"
          style={{ background: 'var(--xp-card)', borderBottom: '0.5px solid var(--xp-bdr)' }}
        >
          <button
            onClick={onClose}
            className="flex items-center gap-2 text-xs font-medium transition-colors hover:text-violet-500"
            style={{ color: 'var(--xp-txt2)' }}
          >
            ← Back
          </button>
          <h1 className="text-sm font-bold" style={{ color: 'var(--xp-txt)' }}>
            {MONTHS[month]} {APP_YEAR}
          </h1>
          <button onClick={onClose} className="text-sm transition-colors hover:text-red-400" style={{ color: 'var(--xp-txt3)' }}>
            × Close
          </button>
        </div>

        {/* Two-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-5 max-w-[1360px] mx-auto">

          {/* LEFT: Large calendar */}
          <div className="rounded-2xl p-5" style={{ background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr)' }}>
            <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--xp-txt)' }}>
              📅 {MONTHS[month]} Calendar
            </h2>
            <MonthCalendarLarge month={month} calData={calData as Record<string, unknown>} />

            {/* Stat chips below calendar */}
            <div className="grid grid-cols-3 gap-2 mt-5">
              {statCards.map(c => (
                <div key={c.label} className="text-center p-2.5 rounded-xl" style={{ background: 'var(--xp-bg3)', border: '0.5px solid var(--xp-bdr)' }}>
                  <p className="text-base font-bold" style={{ color: 'var(--xp-acc)' }}>{c.value}</p>
                  <p className="text-[10px] mt-0.5" style={{ color: 'var(--xp-txt3)' }}>{c.label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* RIGHT: Monthly analytics */}
          <div className="flex flex-col gap-4">

            {/* Gauge */}
            <div className="rounded-2xl p-4 overflow-hidden" style={{ background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr)' }}>
              <h2 className="text-xs font-semibold mb-3" style={{ color: 'var(--xp-txt3)' }}>Monthly Dashboard</h2>
              <GaugeMeter score={gaugeScore} />
            </div>

            {/* Weekly bars */}
            <div className="rounded-2xl p-4" style={{ background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr)' }}>
              <h2 className="text-xs font-semibold mb-3" style={{ color: 'var(--xp-txt3)' }}>Weekly Work Hours</h2>
              <MonthWeeklyBars month={month} sessions={monthSessions} />
            </div>

            {/* Activity distribution */}
            {actBreakdown.length > 0 && (
              <div className="rounded-2xl p-4" style={{ background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr)' }}>
                <h2 className="text-xs font-semibold mb-3" style={{ color: 'var(--xp-txt3)' }}>Activity Distribution</h2>
                <div className="flex flex-col gap-2">
                  {actBreakdown.map(a => {
                    const pct = totalMs > 0 ? Math.round((a.ms / totalMs) * 100) : 0
                    return (
                      <div key={a.name} className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: a.color }}/>
                        <span className="text-xs flex-1" style={{ color: 'var(--xp-txt2)' }}>{a.name}</span>
                        <span className="text-xs font-semibold" style={{ color: a.color }}>{pct}%</span>
                        <div className="w-24 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--xp-bg3)' }}>
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: a.color }}/>
                        </div>
                        <span className="text-[10px] w-12 text-right" style={{ color: 'var(--xp-txt3)' }}>{formatMs(a.ms)}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* No data placeholder */}
            {actBreakdown.length === 0 && totalMs === 0 && (
              <div className="rounded-2xl p-6 text-center" style={{ background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr)' }}>
                <p className="text-2xl mb-2">⏱</p>
                <p className="text-xs" style={{ color: 'var(--xp-txt3)' }}>Start a work timer to see activity analytics</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

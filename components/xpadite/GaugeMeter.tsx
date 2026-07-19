'use client'

import { useEffect, useState } from 'react'
import { useApp } from './AppContext'

export function GaugeMeter({ score }: { score: number }) {
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
  const fullArc = `M ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} A ${r} ${r} 0 0 1 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`
  const arcLen = Math.PI * r
  const segLen = arcLen / 5

  const segs = [
    { offset: 0,           color: '#94a3b8', glow: 'rgba(148,163,184,0.3)',  label: 'Getting Started', emoji: '' },
    { offset: segLen,      color: '#eab308', glow: 'rgba(234,179,8,0.35)',   label: 'In Action',       emoji: '' },
    { offset: segLen * 2,  color: '#22c55e', glow: 'rgba(34,197,94,0.35)',   label: 'Consistent',      emoji: '' },
    { offset: segLen * 3,  color: '#a855f7', glow: 'rgba(168,85,247,0.35)',  label: 'Advanced',        emoji: '🔥' },
    { offset: segLen * 4,  color: '#ef4444', glow: 'rgba(239,68,68,0.35)',   label: 'Elite Mode',      emoji: '🚀' },
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

  const trackColor = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)'
  const titleFill  = isDark ? 'rgba(255,255,255,0.32)' : 'rgba(0,0,0,0.35)'
  const tickStroke = isDark ? 'rgba(255,255,255,0.4)'  : 'rgba(0,0,0,0.3)'
  const numFill    = isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.45)'
  const scoreFill  = isDark ? 'white'                  : '#0f172a'
  const scoreSubFl = isDark ? 'rgba(255,255,255,0.38)' : 'rgba(0,0,0,0.35)'
  const shimmer    = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.5)'
  const hubBody    = isDark ? '#111827'                : '#e2e8f0'
  const hubStroke  = segs[li].color
  const circuitStk = isDark ? 'rgba(99,179,237,0.1)'  : 'rgba(99,179,237,0.12)'
  const glowOpacity = isDark ? 1 : 0.4

  return (
    <div className="flex flex-col items-center w-full h-full justify-center">
      <svg viewBox="0 0 440 305" className="w-full">
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

        <rect x={0} y={0} width={440} height={305} rx={14} fill={isDark ? 'url(#gm-panel)' : 'var(--xp-bg2)'}/>

        <g stroke={circuitStk} strokeWidth="0.8" fill="none">
          <line x1="60" y1="130" x2="160" y2="130"/><line x1="280" y1="130" x2="380" y2="130"/>
          <line x1="220" y1="50" x2="220" y2="90"/>
          <line x1="130" y1="170" x2="90" y2="170"/><line x1="310" y1="170" x2="350" y2="170"/>
          <circle cx="160" cy="130" r="2.5" fill="rgba(99,179,237,0.15)" stroke="none"/>
          <circle cx="280" cy="130" r="2.5" fill="rgba(99,179,237,0.15)" stroke="none"/>
          <circle cx="220" cy="90"  r="2.5" fill="rgba(99,179,237,0.15)" stroke="none"/>
        </g>

        <text x={cx} y={14} textAnchor="middle" fontSize="8.5" fill={titleFill} fontWeight="600" letterSpacing="3">
          PERFORMANCE ANALYTICS
        </text>

        <path d={fullArc} fill="none" stroke={trackColor} strokeWidth={sw + 10} strokeLinecap="butt"/>

        {segs.map((s, i) => (
          <path key={`gl${i}`} d={fullArc} fill="none" stroke={s.glow}
            strokeWidth={sw + 14} strokeLinecap="butt" filter="url(#gm-glow)" opacity={glowOpacity}
            strokeDasharray={`${segLen.toFixed(2)} ${arcLen.toFixed(2)}`}
            strokeDashoffset={`${(-s.offset).toFixed(2)}`}/>
        ))}

        {segs.map((s, i) => (
          <path key={`sg${i}`} d={fullArc} fill="none" stroke={s.color}
            strokeWidth={sw} strokeLinecap="butt"
            strokeDasharray={`${segLen.toFixed(2)} ${arcLen.toFixed(2)}`}
            strokeDashoffset={`${(-s.offset).toFixed(2)}`}/>
        ))}

        {segs.map((s, i) => (
          <path key={`sh${i}`} d={fullArc} fill="none" stroke={shimmer}
            strokeWidth={3} strokeLinecap="butt"
            strokeDasharray={`${segLen.toFixed(2)} ${arcLen.toFixed(2)}`}
            strokeDashoffset={`${(-s.offset - 7).toFixed(2)}`}/>
        ))}

        {marks.map((m, i) => {
          const inner = pt(m.angle, r + sw / 2 + 2)
          const outer = pt(m.angle, r + sw / 2 + 12)
          return <line key={`tk${i}`} x1={inner.x.toFixed(1)} y1={inner.y.toFixed(1)} x2={outer.x.toFixed(1)} y2={outer.y.toFixed(1)} stroke={tickStroke} strokeWidth="1.8" strokeLinecap="round"/>
        })}

        {marks.map((m, i) => {
          const lp = pt(m.angle, r - sw / 2 - 26)
          return <text key={`sn${i}`} x={lp.x.toFixed(1)} y={lp.y.toFixed(1)} textAnchor="middle" dominantBaseline="middle" fontSize="9" fill={numFill} fontWeight="600">{m.label}</text>
        })}

        {segs.map((s, i) => {
          const lp = pt(segMidAngles[i], r + sw / 2 + 34)
          return <text key={`cl${i}`} x={lp.x.toFixed(1)} y={lp.y.toFixed(1)} textAnchor="middle" dominantBaseline="middle" fontSize="8" fill={s.color} fontWeight="700">{s.label}</text>
        })}

        <line x1={cx} y1={cy} x2={needleTip.x.toFixed(2)} y2={needleTip.y.toFixed(2)} stroke={segs[li].color} strokeWidth={6} strokeLinecap="round" filter="url(#gm-needle)" opacity={0.55}/>
        <line x1={cx} y1={cy} x2={needleTip.x.toFixed(2)} y2={needleTip.y.toFixed(2)} stroke={segs[li].color} strokeWidth={2.5} strokeLinecap="round"/>

        <circle cx={cx} cy={cy} r={17} fill="none" stroke={hubStroke} strokeWidth={1} opacity={0.4} filter="url(#gm-glow)"/>
        <circle cx={cx} cy={cy} r={14} fill={hubBody} stroke={hubStroke} strokeWidth={1.5}/>
        <circle cx={cx} cy={cy} r={9}  fill="url(#gm-hub)"/>
        <circle cx={cx} cy={cy} r={4}  fill={segs[li].color} opacity={0.85}/>
        <circle cx={cx} cy={cy} r={2}  fill="white" opacity={0.4}/>

        <text x={cx - 6} y={cy + 48} textAnchor="end" fontSize="40" fontWeight="900" fill={scoreFill} fontFamily="-apple-system,BlinkMacSystemFont,sans-serif">
          {Math.round(animScore)}
        </text>
        <text x={cx} y={cy + 41} textAnchor="start" fontSize="17" fill={scoreSubFl} fontFamily="-apple-system,BlinkMacSystemFont,sans-serif">
          /100
        </text>

        <foreignObject x={cx - 104} y={cy + 56} width="208" height="34">
          <div style={{ textAlign: 'center', fontSize: 14, fontWeight: 700, color: segs[li].color, letterSpacing: 0.5 }}>
            {segs[li].emoji ? `${segs[li].emoji} ${segs[li].label}` : segs[li].label}
          </div>
        </foreignObject>
      </svg>
    </div>
  )
}

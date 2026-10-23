'use client'

import { useMemo, useEffect, useState, useRef } from 'react'
import { formatMs } from './utils'

// ─── Dynamic Performance Badge System ─────────────────────────────────────────
// Single source of truth for all badge + gauge rendering.
// FinalPerformanceLevel = max(TaskPerformanceLevel, HoursPerformanceLevel).

export type PerformanceLevel = 0 | 1 | 2 | 3 | 4 | 5

interface PerformanceTier {
  level: PerformanceLevel
  title: string
  message: string
  secondaryMessage?: string
  color: string
  glow: string
}

export const PERFORMANCE_TIERS: PerformanceTier[] = [
  { level: 0, title: 'Time to Get Into Action', message: 'Every great achievement begins with a focused session. Start today and earn your first performance badge.',             color: '#94a3b8', glow: 'rgba(148,163,184,0.35)' },
  { level: 1, title: 'Getting Started',         message: "You've taken the first step. Keep building momentum and unlock the next level.",                                         color: '#eab308', glow: 'rgba(234,179,8,0.35)'    },
  { level: 2, title: 'In Action',               message: "You're making solid progress. Stay consistent and keep moving forward.",                                                  color: '#22c55e', glow: 'rgba(34,197,94,0.35)'    },
  { level: 3, title: 'Consistent',              message: "Excellent consistency. You're building habits that compound into long-term success.",                                      color: '#a855f7', glow: 'rgba(168,85,247,0.35)'   },
  { level: 4, title: 'Advanced',                message: 'Outstanding performance today. Elite status is within reach.',                                                            color: '#6366f1', glow: 'rgba(99,102,241,0.35)'   },
  { level: 5, title: 'Elite',                   message: "You have earned today's Elite Badge.", secondaryMessage: 'Exceptional discipline and consistency.',                       color: '#ef4444', glow: 'rgba(239,68,68,0.35)'    },
]

// Task performance: maps the existing 0-100 score to a level.
// Existing score thresholds are preserved exactly — do not change.
export function getTaskPerformanceLevel(score: number): PerformanceLevel {
  if (score === 0) return 0
  if (score < 20)  return 1
  if (score < 40)  return 2
  if (score < 60)  return 3
  if (score < 80)  return 4
  return 5
}

// ─── Deterministic task progress-bar gradient palette ─────────────────────────

export const TASK_GRAD_STRINGS: string[] = [
  'linear-gradient(90deg, #2563EB 0%, #0EA5E9 52%, #22D3EE 100%)',
  'linear-gradient(90deg, #16A34A 0%, #4ADE80 48%, #A3E635 100%)',
  'linear-gradient(90deg, #7C3AED 0%, #A855F7 50%, #D946EF 100%)',
  'linear-gradient(90deg, #F97316 0%, #F59E0B 50%, #FACC15 100%)',
  'linear-gradient(90deg, #EC4899 0%, #D946EF 48%, #8B5CF6 100%)',
  'linear-gradient(90deg, #06B6D4 0%, #0EA5E9 50%, #3B82F6 100%)',
]

// ─── Decorative mini-trend SVG (purely aesthetic) ─────────────────────────────

// ─── Animation helper: cubic ease-out, 0→1 once active flips to true ─────────

function useEaseOut(active: boolean, durationMs: number): number {
  const [frac, setFrac] = useState(active ? 1 : 0)
  const startedRef = useRef(active)
  const rafRef    = useRef(0)

  useEffect(() => {
    if (!active || startedRef.current) return
    startedRef.current = true
    const startTime = performance.now()
    function tick(now: number) {
      const t = Math.min((now - startTime) / durationMs, 1)
      setFrac(t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
      if (t < 1) { rafRef.current = requestAnimationFrame(tick) }
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(rafRef.current) }
  }, [active, durationMs])

  return frac
}

// ─── SVG Donut ────────────────────────────────────────────────────────────────

export interface DonutSegment { color: string; pct: number; name?: string; ms?: number; sessions?: number }

export function DonutChart({
  segments, size = 'md', hoveredIdx = null, onHoverIdx, animate = true,
}: {
  segments: DonutSegment[]
  size?: 'sm' | 'md' | 'lg'
  hoveredIdx?: number | null
  onHoverIdx?: (idx: number | null) => void
  animate?: boolean
}) {
  const revealFrac = useEaseOut(animate, 1300)
  const revealDeg  = (revealFrac * 360).toFixed(1)
  const sz  = size === 'lg' ? { cx: 114, cy: 114, r: 91, inner: 56, vb: 228 }
            : size === 'sm' ? { cx: 72,  cy: 72,  r: 56, inner: 34, vb: 144 }
                            : { cx: 90,  cy: 90,  r: 70, inner: 44, vb: 180 }
  const { cx, cy, r, inner, vb } = sz
  const cls = size === 'lg' ? 'flex-shrink-0'
            : size === 'sm' ? 'w-24 h-24 flex-shrink-0'
                            : 'w-32 h-32 sm:w-36 sm:h-36 flex-shrink-0'
  const toRad = (d: number) => (d * Math.PI) / 180
  const pt = (a: number, rad: number) => ({ x: cx + rad * Math.cos(toRad(a)), y: cy + rad * Math.sin(toRad(a)) })
  const total = segments.reduce((s, x) => s + x.pct, 0)

  const svgSize = size === 'lg' ? 244 : size === 'sm' ? 144 : 180

  if (total === 0) {
    return (
      <svg viewBox={`0 0 ${vb} ${vb}`} className={cls} style={{ width: svgSize, height: svgSize }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(148,163,184,0.12)" strokeWidth={r - inner} />
        <text x={cx} y={cy + 4} textAnchor="middle" fontSize="9" fill="rgba(148,163,184,0.4)">No data</text>
      </svg>
    )
  }

  let angle = -90
  const paths: React.ReactNode[] = []
  segments.forEach((seg, i) => {
    const sweep = (seg.pct / total) * 360
    const isHov = hoveredIdx === i
    const end = angle + sweep - 0.8
    const expand = isHov ? r + 5 : r
    const s = pt(angle, expand), e = pt(end, expand), si = pt(angle, inner), ei = pt(end, inner)
    const large = sweep > 180 ? 1 : 0
    paths.push(
      <path key={i} fill={seg.color} opacity={hoveredIdx !== null && !isHov ? 0.45 : 1}
        style={{ transition: 'opacity 200ms ease, filter 200ms ease', cursor: onHoverIdx ? 'pointer' : 'default', filter: isHov ? `drop-shadow(0 0 6px ${seg.color}88)` : 'none' }}
        d={`M ${s.x} ${s.y} A ${expand} ${expand} 0 ${large} 1 ${e.x} ${e.y} L ${ei.x} ${ei.y} A ${inner} ${inner} 0 ${large} 0 ${si.x} ${si.y} Z`}
        onMouseEnter={() => onHoverIdx?.(i)}
        onMouseLeave={() => onHoverIdx?.(null)}
      />
    )
    angle += sweep
  })

  const hovSeg = hoveredIdx !== null ? segments[hoveredIdx] : null

  const maskStyle = {
    maskImage:       `conic-gradient(from -90deg, #000 ${revealDeg}deg, transparent ${revealDeg}deg)`,
    WebkitMaskImage: `conic-gradient(from -90deg, #000 ${revealDeg}deg, transparent ${revealDeg}deg)`,
  } as React.CSSProperties

  return (
    <svg viewBox={`0 0 ${vb} ${vb}`} className={cls} style={{ width: svgSize, height: svgSize }}>
      {/* Paths masked by conic sweep; center fill and hover text are always visible */}
      <g style={maskStyle}>
        {paths}
      </g>
      <circle cx={cx} cy={cy} r={inner} fill="var(--xp-card)" />
      {hovSeg && hovSeg.name && (
        <>
          <text x={cx} y={cy - 6} textAnchor="middle" fontSize={size === 'lg' ? 8 : 7} fill={hovSeg.color} fontWeight="700">
            {hovSeg.name.length > 10 ? hovSeg.name.slice(0, 9) + '…' : hovSeg.name}
          </text>
          <text x={cx} y={cy + 8} textAnchor="middle" fontSize={size === 'lg' ? 11 : 9} fill={hovSeg.color} fontWeight="900">
            {hovSeg.ms !== undefined ? formatMs(hovSeg.ms) : `${Math.round(hovSeg.pct * 100)}%`}
          </text>
          <text x={cx} y={cy + 19} textAnchor="middle" fontSize={size === 'lg' ? 8 : 7} fill={hovSeg.color} fillOpacity="0.7">
            {Math.round(hovSeg.pct * 100)}% of day
          </text>
        </>
      )}
    </svg>
  )
}

// ─── Weekly Bar Chart ─────────────────────────────────────────────────────────

// ─── Personalized badge copy pools ────────────────────────────────────────────
// {name} is replaced at render time with the user's first name.
// Badge-earned sentence is only set for levels that actually grant a badge (4-5).
// Message is selected once per date so the card is stable while the dashboard is open.

interface BadgeCopy { headline: string; badge?: string; support?: string }

const BADGE_COPY_POOLS: Record<PerformanceLevel, BadgeCopy[]> = {
  0: [
    { headline: 'Your day is still yours to shape, {name}.', support: 'Start one focused session and build from there.' },
    { headline: 'It only takes one action to begin, {name}.', support: 'A small action now can create momentum for the rest of the day.' },
    { headline: 'Your first win starts now, {name}.', support: "Press play and let's get into action 🚀🔥" },
    { headline: 'Good things come to those who start.', support: 'Your progress starts with the next step.' },
    { headline: 'You have to start somewhere, {name}.', support: "Let's get into action 🚀🔥" },
  ],
  1: [
    { headline: 'Great start, {name}!', support: 'The important thing is that you started.' },
    { headline: 'You have to start somewhere, {name}!', support: 'Now keep the momentum alive.' },
    { headline: 'Momentum begins with one action, {name}!', support: 'Build on this first step.' },
    { headline: 'You are officially in motion, {name}!', support: 'Keep going 🚀🔥' },
    { headline: 'Good things come to those who start, {name}!', support: 'One focused session can change the direction of your day.' },
  ],
  2: [
    { headline: 'Solid progress today, {name}!', support: 'Consistency will turn this into something powerful.' },
    { headline: 'You are moving in the right direction, {name}!', support: 'Keep building on what you started.' },
    { headline: 'Good momentum, {name}!', support: 'A little more focus can take today even further.' },
    { headline: 'Great work, {name}!', support: 'Keep going 🚀🔥' },
    { headline: 'Another productive step forward, {name}!', support: 'Consistency will turn this into something powerful.' },
  ],
  3: [
    { headline: 'Strong performance, {name}!', support: 'Your consistency is producing results.' },
    { headline: 'Impressive discipline, {name}!', support: 'Keep this momentum moving forward.' },
    { headline: 'Excellent work, {name}!', support: 'You are building habits that compound into long-term success.' },
    { headline: 'You are building serious momentum, {name}!', support: 'One more strong push can take you even higher.' },
    { headline: 'Solid consistency, {name}!', support: 'This is the kind of day that adds up over time.' },
  ],
  4: [
    { headline: 'Excellent progress, {name}!', badge: "You have earned today's Advanced Badge.", support: 'You are closing in on Elite Mode.' },
    { headline: 'Strong work today, {name}!', badge: "You have earned today's Advanced Badge.", support: 'Your consistency is producing results.' },
    { headline: 'Impressive discipline, {name}!', badge: "You have earned today's Advanced Badge.", support: 'Keep this momentum moving forward.' },
    { headline: 'You are building serious momentum, {name}!', badge: "You have earned today's Advanced Badge.", support: 'One more strong push can take you even higher.' },
    { headline: 'Remarkable effort, {name}!', badge: "You have earned today's Advanced Badge.", support: 'Your hard work is paying off.' },
  ],
  5: [
    { headline: 'Excellent work, {name}!', badge: "You have earned today's Elite Badge.", support: 'Exceptional discipline and consistency.' },
    { headline: 'Incredible work, {name}!', badge: "You have earned today's Elite Badge.", support: 'You showed up and delivered at an elite level.' },
    { headline: 'Outstanding discipline, {name}!', badge: "You have earned today's Elite Badge.", support: 'This is what focused execution looks like.' },
    { headline: 'Remarkable performance, {name}!', badge: "You have earned today's Elite Badge.", support: 'Another powerful day of disciplined action.' },
    { headline: 'Elite effort today, {name}!', badge: "You have earned today's Elite Badge.", support: 'Exceptional discipline and consistency.' },
  ],
}

function selectDailyMessage<T>(pool: T[], seed: string): T {
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash += seed.charCodeAt(i)
  return pool[hash % pool.length]
}

// ─── Badge asset map — add new entries as artwork is supplied ─────────────────
// Key = PerformanceLevel. Extend this object; no other code changes needed.
const BADGE_ASSETS: Partial<Record<PerformanceLevel, string>> = {
  4: '/badges/xpadite-advanced-badge.png',
  5: '/badges/xpadite-elite-badge.png',
}

// ─── Top-right achievement banner — driven by FinalPerformanceLevel ───────────

// periodLabel lets a different time-scoped dashboard (e.g. Monthly) reuse this
// exact badge — artwork, animations, copy pools, everything — by swapping only
// the "today's" possessive in the badge-earned sentence for its own period
// (e.g. "October's"). Defaults to "today's" so DayDashboardModal's own call
// site needs no change.
export function AchievementBanner({
  tier, level, isDark, firstName, dateLabel, triggerShine = false, periodLabel = "today's",
}: {
  tier: PerformanceTier; level: PerformanceLevel; isDark: boolean;
  firstName?: string; dateLabel?: string; triggerShine?: boolean; periodLabel?: string
}) {
  const badgeAsset = BADGE_ASSETS[level] ?? null
  const { color, glow } = tier

  // Select copy pool entry once per day (stable seed = level + dateLabel)
  const copy = useMemo(() => {
    const pool = BADGE_COPY_POOLS[level] ?? BADGE_COPY_POOLS[0]
    const raw  = selectDailyMessage(pool, `${level}-${dateLabel ?? ''}`)
    const name = firstName?.trim() || ''
    return {
      headline: name ? raw.headline.replace('{name}', name) : raw.headline.replace(', {name}', '').replace(' {name}', ''),
      badge:    raw.badge?.replace("today's", periodLabel),
      support:  raw.support,
    }
  }, [level, dateLabel, firstName, periodLabel])

  const [shineKey, setShineKey] = useState(0)
  const [showConfetti, setShowConfetti] = useState(false)
  const confettiFiredRef = useRef(false)

  const confettiParticles = useMemo(() => {
    const cols = [color, '#a78bfa', '#38bdf8', '#f472b6', '#34d399', '#fb923c', '#facc15']
    return Array.from({ length: 14 }, (_, i) => ({
      left: `${22 + ((i * 37) % 56)}%`,
      bottom: `${35 + ((i * 23) % 24)}%`,
      delay: `${i * 45}ms`,
      tx: `${(((i % 5) - 2) * 30) + ((i % 2) * 12 - 6)}px`,
      ty: `${-(26 + (i % 4) * 16)}px`,
      rot: `${(i * 59) % 360}deg`,
      col: cols[i % cols.length],
      size: i % 3 === 0 ? 4 : 5,
      br: i % 2 === 0 ? '50%' : '1px',
    }))
  }, [color])

  // Entrance pop → confetti fires once after badge settles (750 ms)
  useEffect(() => {
    if (level === 0 || confettiFiredRef.current) return
    confettiFiredRef.current = true
    const id = setTimeout(() => setShowConfetti(true), 750)
    return () => clearTimeout(id)
  }, [level])

  // Fire shine sweep once when triggerShine flips to true (orchestrated by parent)
  const shineFiredRef = useRef(false)
  useEffect(() => {
    if (!triggerShine || !BADGE_ASSETS[level] || shineFiredRef.current) return
    shineFiredRef.current = true
    setShineKey(k => k + 1)
  }, [triggerShine, level])

  return (
    <div
      className="rounded-2xl flex flex-col h-full relative overflow-hidden p-3"
      style={{
        background: isDark
          ? 'linear-gradient(145deg, rgba(15,6,38,0.99) 0%, rgba(8,3,18,0.99) 100%)'
          : '#ffffff',
        border: isDark ? `0.5px solid ${color}38` : `0.5px solid ${color}28`,
        boxShadow: isDark ? `0 4px 32px ${glow}, 0 2px 16px rgba(0,0,0,0.45)` : `0 2px 14px ${color}12`,
      }}
    >
      {isDark && (
        <div style={{ position: 'absolute', top: -24, right: -24, width: 140, height: 140, borderRadius: '50%', background: `radial-gradient(circle, ${color}12 0%, transparent 70%)`, pointerEvents: 'none' }} />
      )}
      <div style={{ position: 'absolute', inset: 0, borderRadius: 'inherit', pointerEvents: 'none', background: 'linear-gradient(130deg, transparent 30%, rgba(255,255,255,0.025) 52%, transparent 74%)' }} />

      {/* Personalized headline */}
      <div className="text-center mb-1 relative z-10">
        <p className="text-[11.5px] font-bold leading-snug" style={{ color }}>
          {copy.headline}
        </p>
      </div>

      {/* Badge artwork — entrance pop applied to the entire artwork row */}
      <div className="flex justify-center items-center mb-1 relative z-10"
        style={{ animation: 'xp-badge-pop 700ms cubic-bezier(0.22, 1, 0.36, 1) both' }}>
        {level === 0 ? (
          /* Level 0 — no badge earned yet */
          <div style={{
            width: 80, height: 80, borderRadius: 20,
            background: isDark ? 'rgba(148,163,184,0.08)' : 'rgba(148,163,184,0.1)',
            border: '1.5px solid rgba(148,163,184,0.25)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg viewBox="0 0 40 40" width="38" height="38">
              <circle cx="20" cy="20" r="16" fill="none" stroke="rgba(148,163,184,0.35)" strokeWidth="2" strokeDasharray="4,3" />
              <line x1="20" y1="28" x2="20" y2="14" stroke="rgba(148,163,184,0.5)" strokeWidth="2.5" strokeLinecap="round" />
              <path d="M 13 20 L 20 13 L 27 20" fill="none" stroke="rgba(148,163,184,0.5)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        ) : badgeAsset ? (
          /* Custom artwork — explicit size + clipPath ensures shine never leaks outside badge */
          <div
            style={{
              position: 'relative', width: 174, height: 145,
              overflow: 'hidden', borderRadius: 8,
              clipPath: 'inset(0 round 8px)',
            }}
            onMouseEnter={() => setShineKey(k => k + 1)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={badgeAsset}
              alt={`XPadite Performance Badge`}
              style={{ width: 174, height: 145, objectFit: 'contain', display: 'block' }}
            />
            {/* Shine sweep — background-position animation keeps element stationary inside container */}
            {shineKey > 0 && (
              <div
                key={shineKey}
                className="xp-badge-shine-overlay"
                style={{
                  position: 'absolute', inset: 0,
                  WebkitMaskImage: `url(${badgeAsset})`,
                  WebkitMaskSize: 'contain',
                  WebkitMaskPosition: 'center',
                  WebkitMaskRepeat: 'no-repeat',
                  maskImage: `url(${badgeAsset})`,
                  maskSize: 'contain',
                  maskPosition: 'center',
                  maskRepeat: 'no-repeat',
                  background: 'linear-gradient(105deg, transparent 25%, rgba(255,255,255,0.04) 38%, rgba(255,255,255,0.88) 50%, rgba(255,255,255,0.04) 62%, transparent 75%)',
                  animation: 'xp-badge-shine 800ms ease-in-out forwards',
                  pointerEvents: 'none',
                }}
              />
            )}
          </div>
        ) : (
          /* SVG placeholder — levels 1–3 until custom artwork is supplied */
          <svg viewBox="0 0 100 110" width="92" height="101" style={{ display: 'block', overflow: 'visible' }}>
            <defs>
              <linearGradient id="xp-shield-bg" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={isDark ? 0.32 : 0.18} />
                <stop offset="100%" stopColor={color} stopOpacity={isDark ? 0.12 : 0.06} />
              </linearGradient>
            </defs>
            <path d="M 50 5 C 50 5, 94 19 94 57 C 94 83 50 101 50 101 C 50 101 6 83 6 57 C 6 19 50 5 50 5 Z"
              fill="url(#xp-shield-bg)" stroke={color} strokeWidth="2.5" strokeOpacity="0.6" />
            <path d="M 50 13 C 50 13, 86 25 86 57 C 86 78 50 93 50 93 C 50 93 14 78 14 57 C 14 25 50 13 50 13 Z"
              fill="none" stroke={color} strokeWidth="0.8" strokeOpacity="0.28" />
            {level === 3 ? (
              <g>
                <circle cx="50" cy="53" r="22" fill="none" stroke={color} strokeWidth="3.5" strokeOpacity="0.65" />
                <circle cx="50" cy="53" r="13" fill="none" stroke={color} strokeWidth="2.8" strokeOpacity="0.6" />
                <circle cx="50" cy="53" r="5" fill={color} fillOpacity="0.75" />
              </g>
            ) : level === 2 ? (
              <path d="M 55 25 L 42 52 L 52 52 L 45 78 L 62 46 L 51 46 Z" fill={color} fillOpacity="0.78" />
            ) : (
              <g>
                <line x1="50" y1="72" x2="50" y2="38" stroke={color} strokeWidth="3.5" strokeOpacity="0.7" strokeLinecap="round" />
                <path d="M 50 46 Q 37 38 32 26 Q 46 22 50 46" fill={color} fillOpacity="0.65" />
                <path d="M 50 46 Q 63 38 68 26 Q 54 22 50 46" fill={color} fillOpacity="0.5" />
              </g>
            )}
          </svg>
        )}
      </div>

      {/* Badge-earned sentence + supporting line */}
      <div className="text-center relative z-10 flex-1 flex flex-col justify-center">
        {copy.badge && (
          <p className="text-[13px] font-bold leading-tight mb-1.5" style={{ color }}>{copy.badge}</p>
        )}
        {copy.support && (
          <p className="text-[10px] leading-relaxed"
            style={{ color: isDark ? 'rgba(148,163,184,0.72)' : 'var(--xp-txt3)' }}>
            {copy.support}
          </p>
        )}
        {badgeAsset && dateLabel && (
          <p className="text-[8px] mt-2"
            style={{ color: isDark ? 'rgba(148,163,184,0.42)' : 'var(--xp-txt3)', opacity: 0.8 }}>
            ◎ Earned on {dateLabel}
          </p>
        )}
      </div>

      {/* Confetti burst — fires once after badge entrance animation settles */}
      {showConfetti && confettiParticles.map((p, i) => (
        <div key={`cf${i}`} style={{
          position: 'absolute',
          bottom: p.bottom,
          left: p.left,
          width: p.size,
          height: p.size,
          borderRadius: p.br,
          background: p.col,
          animation: 'xp-confetti 900ms ease-out both',
          animationDelay: p.delay,
          '--tx': p.tx,
          '--ty': p.ty,
          '--rot': p.rot,
          pointerEvents: 'none',
          zIndex: 30,
        } as React.CSSProperties} />
      ))}
    </div>
  )
}

// ─── Bottom-right achievement center ──────────────────────────────────────────

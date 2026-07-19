'use client'

import { useMemo, useEffect, useState } from 'react'
import { useApp } from './AppContext'
import { formatMs, formatTime, APP_YEAR, dateKey as makeDateKey } from './utils'
import type { Task } from './types'
import { GaugeMeter } from './GaugeMeter'
import { createClient } from '@/lib/supabase/client'

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

function lightenHex(hex: string, amount: number): string {
  const clean = hex.replace('#', '')
  if (clean.length !== 6) return hex
  const r = parseInt(clean.slice(0, 2), 16)
  const g = parseInt(clean.slice(2, 4), 16)
  const b = parseInt(clean.slice(4, 6), 16)
  return `#${Math.min(255, Math.round(r + (255 - r) * amount)).toString(16).padStart(2, '0')}${Math.min(255, Math.round(g + (255 - g) * amount)).toString(16).padStart(2, '0')}${Math.min(255, Math.round(b + (255 - b) * amount)).toString(16).padStart(2, '0')}`
}

// ─── Rank system (mirrors GaugeMeter thresholds) ──────────────────────────────

const RANKS = [
  { min: 0,   max: 20,  name: 'Beginner', color: '#94a3b8', glow: 'rgba(148,163,184,0.4)', emoji: '🌱', tagline: 'Every expert started somewhere. Begin today.'         },
  { min: 20,  max: 40,  name: 'Normal',   color: '#eab308', glow: 'rgba(234,179,8,0.4)',   emoji: '⭐', tagline: 'Consistency compounds. Keep the streak going.'        },
  { min: 40,  max: 60,  name: 'Average',  color: '#22c55e', glow: 'rgba(34,197,94,0.4)',   emoji: '🎯', tagline: 'Focused progress beats sporadic perfection.'          },
  { min: 60,  max: 80,  name: 'Advanced', color: '#a855f7', glow: 'rgba(168,85,247,0.4)',  emoji: '🔥', tagline: 'Elite performance is within reach. Push harder.'      },
  { min: 80,  max: 101, name: 'Elite',    color: '#ef4444', glow: 'rgba(239,68,68,0.4)',   emoji: '🚀', tagline: 'Outstanding consistency. Keep pushing toward Legendary.' },
] as const

function getRank(score: number) {
  return RANKS.find(r => score >= r.min && score < r.max) ?? RANKS[RANKS.length - 1]
}

// ─── Dynamic Performance Badge System ─────────────────────────────────────────
// Single source of truth for all badge + gauge rendering.
// FinalPerformanceLevel = max(TaskPerformanceLevel, HoursPerformanceLevel).

type PerformanceLevel = 0 | 1 | 2 | 3 | 4 | 5

interface PerformanceTier {
  level: PerformanceLevel
  title: string
  message: string
  secondaryMessage?: string
  color: string
  glow: string
}

const PERFORMANCE_TIERS: PerformanceTier[] = [
  { level: 0, title: 'Time to Get Into Action', message: 'Every great achievement begins with a focused session. Start today and earn your first performance badge.',             color: '#94a3b8', glow: 'rgba(148,163,184,0.35)' },
  { level: 1, title: 'Getting Started',         message: "You've taken the first step. Keep building momentum and unlock the next level.",                                         color: '#eab308', glow: 'rgba(234,179,8,0.35)'    },
  { level: 2, title: 'In Action',               message: "You're making solid progress. Stay consistent and keep moving forward.",                                                  color: '#22c55e', glow: 'rgba(34,197,94,0.35)'    },
  { level: 3, title: 'Consistent',              message: "Excellent consistency. You're building habits that compound into long-term success.",                                      color: '#a855f7', glow: 'rgba(168,85,247,0.35)'   },
  { level: 4, title: 'Advanced',                message: 'Outstanding performance today. Elite status is within reach.',                                                            color: '#6366f1', glow: 'rgba(99,102,241,0.35)'   },
  { level: 5, title: 'Elite',                   message: "You have earned today's Elite Badge.", secondaryMessage: 'Exceptional discipline and consistency.',                       color: '#ef4444', glow: 'rgba(239,68,68,0.35)'    },
]

// Task performance: maps the existing 0-100 score to a level.
// Existing score thresholds are preserved exactly — do not change.
function getTaskPerformanceLevel(score: number): PerformanceLevel {
  if (score === 0) return 0
  if (score < 20)  return 1
  if (score < 40)  return 2
  if (score < 60)  return 3
  if (score < 80)  return 4
  return 5
}

// Hours performance: independent calculation based on productive time.
function getHoursPerformanceLevel(totalMs: number): PerformanceLevel {
  const hrs = totalMs / 3_600_000
  if (hrs <= 0)  return 0
  if (hrs < 4)   return 1
  if (hrs < 8)   return 2
  if (hrs < 9)   return 3
  if (hrs < 10)  return 4
  return 5
}

// Final level: highest rank from either source always wins.
function getFinalPerformanceLevel(taskScore: number, totalMs: number): PerformanceLevel {
  return Math.max(
    getTaskPerformanceLevel(taskScore),
    getHoursPerformanceLevel(totalMs),
  ) as PerformanceLevel
}

// Convert final level to a gauge score that lands in the correct GaugeMeter segment.
// GaugeMeter segments: 0-20 / 20-40 / 40-60 / 60-80 / 80-100
function performanceLevelToGaugeScore(level: PerformanceLevel): number {
  return ([0, 10, 30, 50, 70, 90] as const)[level]
}

// ─── Activity icon SVG paths for milestone markers (Lucide-compatible, 24×24 vb) ─

function getActivityIconPath(name: string): string {
  const n = name.toLowerCase()
  // Code brackets: </>
  if (n.includes('cod') || n.includes('dev') || n.includes('prog') || n.includes('xpadite'))
    return 'M6 9l-4 3 4 3M18 9l4 3-4 3M14 6l-4 12'
  // Open book / learning
  if (n.includes('learn') || n.includes('study') || n.includes('book'))
    return 'M2 4h7a2 2 0 0 1 2 2v13a2 2 0 0 0-2-2H2zM22 4h-7a2 2 0 0 0-2 2v13a2 2 0 0 1 2-2h7z'
  // Dumbbell
  if (n.includes('workout') || n.includes('gym') || n.includes('exercise'))
    return 'M6 5v14M18 5v14M6 12h12M3 8h3M18 8h3M3 16h3M18 16h3'
  // Coffee cup
  if (n.includes('break') || n.includes('coffee') || n.includes('☕'))
    return 'M17 8h1a4 4 0 0 1 0 8h-1M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4zM6 2v2M10 2v2M14 2v2'
  // Rocket
  if (n.includes('project') || n.includes('launch') || n.includes('rocket'))
    return 'M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09zM12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z'
  // Briefcase
  if (n.includes('work'))
    return 'M20 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2zM16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2'
  // Personal / user
  if (n.includes('personal'))
    return 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'
  // Default: activity pulse
  return 'M22 12h-4l-3 9L9 3l-3 9H2'
}

// ─── Deterministic task progress-bar gradient palette ─────────────────────────

const TASK_GRAD_PALETTE: [string, string][] = [
  ['#93c5fd', '#3b82f6'],
  ['#86efac', '#22c55e'],
  ['#c4b5fd', '#8b5cf6'],
  ['#fdba74', '#f97316'],
  ['#f9a8d4', '#ec4899'],
  ['#67e8f9', '#06b6d4'],
]

// ─── Decorative mini-trend SVG (purely aesthetic) ─────────────────────────────

function MiniTrend({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 44 18" style={{ width: 44, height: 18, display: 'block', opacity: 0.22 }}>
      <polyline points="2,14 7,10 13,12 19,6 25,8 31,4 38,2 43,3"
        fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ─── SVG Donut ────────────────────────────────────────────────────────────────

interface DonutSegment { color: string; pct: number }

function DonutChart({ segments, size = 'md' }: { segments: DonutSegment[]; size?: 'sm' | 'md' }) {
  const sz  = size === 'sm' ? { cx: 72, cy: 72, r: 56, inner: 34, vb: 144 }
                            : { cx: 90, cy: 90, r: 70, inner: 44, vb: 180 }
  const { cx, cy, r, inner, vb } = sz
  const cls = size === 'sm' ? 'w-24 h-24 flex-shrink-0' : 'w-32 h-32 sm:w-36 sm:h-36 flex-shrink-0'
  const toRad = (d: number) => (d * Math.PI) / 180
  const pt = (a: number, rad: number) => ({ x: cx + rad * Math.cos(toRad(a)), y: cy + rad * Math.sin(toRad(a)) })
  const total = segments.reduce((s, x) => s + x.pct, 0)

  if (total === 0) {
    return (
      <svg viewBox={`0 0 ${vb} ${vb}`} className={cls}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(148,163,184,0.12)" strokeWidth={r - inner} />
        <text x={cx} y={cy + 4} textAnchor="middle" fontSize="9" fill="rgba(148,163,184,0.4)">No data</text>
      </svg>
    )
  }

  let angle = -90
  const paths: React.ReactNode[] = []
  segments.forEach((seg, i) => {
    const sweep = (seg.pct / total) * 360
    const end = angle + sweep - 0.8
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
    <svg viewBox={`0 0 ${vb} ${vb}`} className={cls}>
      {paths}
      <circle cx={cx} cy={cy} r={inner} fill="var(--xp-card)" />
    </svg>
  )
}

// ─── Weekly Bar Chart ─────────────────────────────────────────────────────────

function WeeklyBars({ data }: { data: { label: string; ms: number; isToday: boolean }[] }) {
  const VW = 440, VH = 200
  const PL = 34, PB = 24, PT = 28, PR = 8
  const plotW = VW - PL - PR
  const plotH = VH - PT - PB

  const maxMs = Math.max(...data.map(d => d.ms), 1)
  const yMax  = niceYMax(maxMs)
  const slotW = plotW / data.length
  const barW  = Math.min(Math.max(slotW * 0.62, 12), 44)
  const YTICKS = 4

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} style={{ width: '100%', height: '100%', display: 'block' }}>
      <defs>
        {data.map((d, i) => (
          <linearGradient key={i} id={`wb${i}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={d.isToday ? '#ddd6fe' : '#a5b4fc'} />
            <stop offset="100%" stopColor={d.isToday ? '#7c3aed' : '#4f46e5'} />
          </linearGradient>
        ))}
        <filter id="wb-glow">
          <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="b"/>
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>

      {Array.from({ length: YTICKS + 1 }, (_, i) => {
        const frac = i / YTICKS
        const y = PT + plotH * (1 - frac)
        return (
          <g key={i}>
            <line x1={PL} y1={y} x2={PL + plotW} y2={y}
              stroke="rgba(148,163,184,0.1)" strokeWidth="0.5" strokeDasharray={i === 0 ? '' : '2,4'} />
            {i > 0 && (
              <text x={PL - 5} y={y + 3.5} textAnchor="end" fontSize="8" fill="rgba(148,163,184,0.45)">
                {fmtHrTick(frac * yMax)}
              </text>
            )}
          </g>
        )
      })}

      <line x1={PL} y1={PT + plotH} x2={PL + plotW} y2={PT + plotH}
        stroke="rgba(148,163,184,0.2)" strokeWidth="0.75" />

      {data.map((d, i) => {
        const barH = d.ms > 0 ? Math.max((d.ms / yMax) * plotH, 4) : 0
        const cx = PL + i * slotW + slotW / 2
        const x  = cx - barW / 2
        const y  = PT + plotH - barH
        const hrs = d.ms / 3_600_000
        const lbl = d.ms > 0 ? (hrs >= 1 ? `${hrs.toFixed(1)}h` : `${Math.round(d.ms / 60_000)}m`) : ''
        return (
          <g key={d.label}>
            {d.ms > 0 && (
              <>
                {d.isToday && (
                  <rect x={(x - 1).toFixed(1)} y={(y - 1).toFixed(1)}
                    width={(barW + 2).toFixed(1)} height={(barH + 1).toFixed(1)}
                    rx="4" fill="rgba(167,139,250,0.18)" filter="url(#wb-glow)" />
                )}
                <rect x={x.toFixed(1)} y={y.toFixed(1)} width={barW.toFixed(1)} height={barH.toFixed(1)}
                  rx="4" fill={`url(#wb${i})`} />
              </>
            )}
            {lbl && barH > 12 && (
              <text x={cx.toFixed(1)} y={(y - 6).toFixed(1)} textAnchor="middle"
                fontSize="8" fontWeight="700"
                fill={d.isToday ? '#c4b5fd' : 'rgba(148,163,184,0.7)'}>
                {lbl}
              </text>
            )}
            <text x={cx.toFixed(1)} y={(PT + plotH + 14).toFixed(1)} textAnchor="middle"
              fontSize="9" fontWeight={d.isToday ? '700' : '400'}
              fill={d.isToday ? '#a78bfa' : 'rgba(148,163,184,0.5)'}>
              {d.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// ─── Today Overview Bars (activity breakdown for today) ───────────────────────

function TodayOverviewBars({ data }: { data: { label: string; ms: number; color: string }[] }) {
  const VW = 440, VH = 200
  const PL = 34, PB = 30, PT = 28, PR = 8
  const plotW = VW - PL - PR
  const plotH = VH - PT - PB
  const display = data.slice(0, 6)

  if (display.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-[10px]" style={{ color: 'var(--xp-txt3)' }}>No activity data yet</p>
      </div>
    )
  }

  const maxMs = Math.max(...display.map(d => d.ms), 1)
  const yMax  = niceYMax(maxMs)
  const slotW = plotW / display.length
  const barW  = Math.min(Math.max(slotW * 0.62, 14), 50)

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} style={{ width: '100%', height: '100%', display: 'block' }}>
      <defs>
        {display.map((d, i) => (
          <linearGradient key={i} id={`tob${i}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={lightenHex(d.color, 0.38)} />
            <stop offset="100%" stopColor={d.color} />
          </linearGradient>
        ))}
      </defs>

      {Array.from({ length: 4 }, (_, i) => {
        const frac = (i + 1) / 4
        const y = PT + plotH * (1 - frac)
        return (
          <g key={i}>
            <line x1={PL} y1={y} x2={PL + plotW} y2={y}
              stroke="rgba(148,163,184,0.1)" strokeWidth="0.5" strokeDasharray="2,4" />
            <text x={PL - 5} y={y + 3.5} textAnchor="end" fontSize="8" fill="rgba(148,163,184,0.45)">
              {fmtHrTick(frac * yMax)}
            </text>
          </g>
        )
      })}
      <line x1={PL} y1={PT + plotH} x2={PL + plotW} y2={PT + plotH}
        stroke="rgba(148,163,184,0.2)" strokeWidth="0.75" />

      {display.map((d, i) => {
        const barH = d.ms > 0 ? Math.max((d.ms / yMax) * plotH, 4) : 0
        const cx   = PL + i * slotW + slotW / 2
        const x    = cx - barW / 2
        const y    = PT + plotH - barH
        const hrs  = d.ms / 3_600_000
        const lbl  = d.ms > 0 ? (hrs >= 1 ? `${hrs.toFixed(1)}h` : `${Math.round(d.ms / 60_000)}m`) : ''
        const short = d.label.length > 7 ? d.label.slice(0, 6) + '…' : d.label
        return (
          <g key={`tob-${i}`}>
            {d.ms > 0 && (
              <rect x={x.toFixed(1)} y={y.toFixed(1)} width={barW.toFixed(1)} height={barH.toFixed(1)}
                rx="4" fill={`url(#tob${i})`} />
            )}
            {lbl && barH > 14 && (
              <text x={cx.toFixed(1)} y={(y - 6).toFixed(1)} textAnchor="middle"
                fontSize="8" fontWeight="700" fill={d.color}>
                {lbl}
              </text>
            )}
            <text x={cx.toFixed(1)} y={(PT + plotH + 15).toFixed(1)} textAnchor="middle"
              fontSize="8.5" fontWeight="500" fill="rgba(148,163,184,0.65)">
              {short}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// ─── Progress Graph ───────────────────────────────────────────────────────────

type RawSession = { startTs: number; endTs: number | null; actId?: string; taskText?: string }

function ProgressGraph({ sessions, totalMs, activityColors, activityNames }: { sessions: RawSession[]; totalMs: number; activityColors?: Map<string, string>; activityNames?: Map<string, string> }) {
  const VW = 600, VH = 200
  const PL = 40, PB = 26, PT = 14, PR = 12
  const plotW = VW - PL - PR
  const plotH = VH - PT - PB

  // Filter valid sessions and sort chronologically — critical for non-crossing path
  const sorted = [...sessions]
    .filter(s => s.endTs !== null && s.endTs > s.startTs)
    .sort((a, b) => a.startTs - b.startTs)

  if (sorted.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2">
        <div style={{
          width: 40, height: 40, borderRadius: '50%',
          background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
        }}>⏱</div>
        <p className="text-[11px] text-center font-medium" style={{ color: 'var(--xp-txt3)' }}>
          No focused work recorded yet
        </p>
        <p className="text-[10px] text-center" style={{ color: 'var(--xp-txt3)', opacity: 0.6 }}>
          Start a timer to see your progress
        </p>
      </div>
    )
  }

  const first    = sorted[0].startTs
  const last     = Math.max(...sorted.map(s => s.endTs!))
  const timeSpan = Math.max(last - first, 60_000)
  const yMax     = niceYMax(totalMs)

  // Build strictly monotonic step-function: each segment is horizontal (gap) or
  // diagonal upward (active session). We clamp startTx to prevEndTx so overlapping
  // sessions never produce a backward x movement.
  const pts: { tx: number; ms: number }[] = [{ tx: 0, ms: 0 }]
  let cum = 0
  let prevEndTx = 0

  for (const s of sorted) {
    const startTx = Math.max(s.startTs - first, prevEndTx)
    const endTx   = s.endTs! - first
    if (endTx <= startTx) continue
    pts.push({ tx: startTx, ms: cum })
    cum += s.endTs! - s.startTs
    pts.push({ tx: endTx, ms: cum })
    prevEndTx = endTx
  }
  if (pts[pts.length - 1].tx < timeSpan) pts.push({ tx: timeSpan, ms: cum })

  const toX = (tx: number) => PL + (tx / timeSpan) * plotW
  const toY = (ms: number) => PT + plotH - (ms / yMax) * plotH

  const svgPts  = pts.map(p => ({ sx: toX(p.tx), sy: toY(p.ms) }))
  const lp      = svgPts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.sx.toFixed(1)} ${p.sy.toFixed(1)}`).join(' ')
  const lastPt  = svgPts[svgPts.length - 1]
  const firstPt = svgPts[0]
  const baseY   = (PT + plotH).toFixed(1)
  const fp      = `${lp} L ${lastPt.sx.toFixed(1)} ${baseY} L ${firstPt.sx.toFixed(1)} ${baseY} Z`

  // Milestone dot positions: one per original session end
  let dotCum = 0
  const dotPts: { sx: number; sy: number; cumMs: number; actId?: string }[] = []
  for (const s of sorted) {
    dotCum += s.endTs! - s.startTs
    dotPts.push({ sx: toX(s.endTs! - first), sy: toY(dotCum), cumMs: dotCum, actId: s.actId })
  }

  const YTICKS = 5, XTICKS = 5
  const fmtT = (offsetMs: number) => {
    const d = new Date(first + offsetMs)
    const h = d.getHours(), m = d.getMinutes()
    const ap = h >= 12 ? 'pm' : 'am'
    const h12 = h % 12 || 12
    return m === 0 ? `${h12}${ap}` : `${h12}:${m.toString().padStart(2, '0')}`
  }

  const MARKER_R = 10

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} style={{ width: '100%', height: '100%', display: 'block' }}>
      <defs>
        <linearGradient id="pg-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7c3aed" stopOpacity="0.28" />
          <stop offset="70%" stopColor="#7c3aed" stopOpacity="0.05" />
          <stop offset="100%" stopColor="#7c3aed" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="pg-line" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#818cf8" />
          <stop offset="100%" stopColor="#7c3aed" />
        </linearGradient>
        <filter id="pg-glow">
          <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="b"/>
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <clipPath id="pg-clip">
          <rect x={PL} y={PT} width={plotW} height={plotH} />
        </clipPath>
      </defs>

      {Array.from({ length: YTICKS + 1 }, (_, i) => {
        const frac = i / YTICKS
        const y = PT + plotH * (1 - frac)
        return (
          <g key={`yg${i}`}>
            <line x1={PL} y1={y} x2={PL + plotW} y2={y}
              stroke="rgba(148,163,184,0.09)" strokeWidth="0.5" strokeDasharray="2,5" />
            <text x={PL - 6} y={y + 3.5} textAnchor="end" fontSize="8" fill="rgba(148,163,184,0.45)">
              {fmtHrTick(frac * yMax)}
            </text>
          </g>
        )
      })}

      {Array.from({ length: XTICKS + 1 }, (_, i) => {
        const frac = i / XTICKS
        const x = PL + plotW * frac
        return (
          <g key={`xg${i}`}>
            <line x1={x} y1={PT} x2={x} y2={PT + plotH}
              stroke="rgba(148,163,184,0.06)" strokeWidth="0.5" />
            <text x={x} y={PT + plotH + 15} textAnchor="middle" fontSize="8" fill="rgba(148,163,184,0.45)">
              {fmtT(frac * timeSpan)}
            </text>
          </g>
        )
      })}

      <line x1={PL} y1={PT} x2={PL} y2={PT + plotH} stroke="rgba(148,163,184,0.16)" strokeWidth="0.75" />
      <line x1={PL} y1={PT + plotH} x2={PL + plotW} y2={PT + plotH} stroke="rgba(148,163,184,0.16)" strokeWidth="0.75" />

      <path d={fp} fill="url(#pg-area)" clipPath="url(#pg-clip)" />
      <path d={lp} fill="none" stroke="#7c3aed" strokeWidth="4" strokeOpacity="0.15"
        strokeLinecap="round" strokeLinejoin="round" clipPath="url(#pg-clip)" filter="url(#pg-glow)" />
      <path d={lp} fill="none" stroke="url(#pg-line)" strokeWidth="2.5"
        strokeLinecap="round" strokeLinejoin="round" clipPath="url(#pg-clip)" />

      {/* Milestone markers — rendered as separate overlay, never part of line data */}
      {dotPts.map((p, i) => {
        const actColor   = (p.actId && activityColors?.get(p.actId)) ?? '#7c3aed'
        const actName    = (p.actId && activityNames?.get(p.actId)) ?? ''
        const iconPath   = getActivityIconPath(actName)
        const timeLabel  = p.cumMs >= 3_600_000
          ? `${(p.cumMs / 3_600_000).toFixed(1)}h`
          : `${Math.round(p.cumMs / 60_000)}m`

        // Position marker above the dot; clamp so it stays inside plot
        const markerCy   = Math.max(p.sy - 48, PT + MARKER_R + 6)
        const markerBotY = markerCy + MARKER_R
        const dotTopY    = p.sy - 6
        // Guide line only when marker and dot are clearly separated
        const hasLine    = dotTopY > markerBotY + 4
        // Scale 24×24 icon path down to 14×14 centered on (p.sx, markerCy)
        const iconS      = 14 / 24
        const iconTx     = p.sx - 7
        const iconTy     = markerCy - 7

        return (
          <g key={`mk${i}`}>
            {hasLine && (
              <line
                x1={p.sx.toFixed(1)} y1={markerBotY.toFixed(1)}
                x2={p.sx.toFixed(1)} y2={dotTopY.toFixed(1)}
                stroke={actColor} strokeWidth="0.75" strokeDasharray="2,2" opacity="0.38"
              />
            )}
            <text x={p.sx.toFixed(1)} y={(markerCy - MARKER_R - 4).toFixed(1)}
              textAnchor="middle" fontSize="7.5" fontWeight="600"
              fill={actColor} fillOpacity="0.72">{timeLabel}</text>
            <circle cx={p.sx.toFixed(1)} cy={markerCy.toFixed(1)} r={MARKER_R}
              fill={actColor} fillOpacity="0.13"
              stroke={actColor} strokeWidth="1" strokeOpacity="0.5" />
            {/* Activity icon as pure SVG path — no external dependencies */}
            <path
              d={iconPath}
              fill="none"
              stroke={actColor}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              transform={`translate(${iconTx.toFixed(2)},${iconTy.toFixed(2)}) scale(${iconS.toFixed(4)})`}
            />
          </g>
        )
      })}
      {dotPts.map((p, i) => (
        <g key={`dot${i}`}>
          <circle cx={p.sx.toFixed(1)} cy={p.sy.toFixed(1)} r="6" fill="rgba(124,58,237,0.18)" />
          <circle cx={p.sx.toFixed(1)} cy={p.sy.toFixed(1)} r="4"
            fill="#7c3aed" stroke="rgba(221,214,254,0.5)" strokeWidth="1.5" />
          <circle cx={p.sx.toFixed(1)} cy={p.sy.toFixed(1)} r="1.8" fill="#ede9fe" />
        </g>
      ))}
    </svg>
  )
}

// ─── Top-right achievement banner — driven by FinalPerformanceLevel ───────────

function AchievementBanner({
  tier, level, isDark, firstName, dateLabel,
}: {
  tier: PerformanceTier; level: PerformanceLevel; isDark: boolean;
  firstName?: string; dateLabel?: string
}) {
  const isNoBadge = level === 0
  const isElite   = level === 5
  const { color, glow, title, message, secondaryMessage } = tier
  const greeting  = firstName ? `Congratulations, ${firstName}!` : 'Congratulations!'

  return (
    <div
      className="rounded-2xl p-4 flex flex-col h-full xp-lift relative overflow-hidden"
      style={{
        background: isDark
          ? 'linear-gradient(145deg, rgba(15,6,38,0.99) 0%, rgba(8,3,18,0.99) 100%)'
          : 'var(--xp-bg3)',
        border: isDark ? `0.5px solid ${color}35` : `0.5px solid ${color}30`,
        boxShadow: isDark ? `0 4px 30px ${glow}` : `0 2px 12px ${color}10`,
      }}
    >
      {isDark && (
        <div style={{ position: 'absolute', top: -30, right: -30, width: 160, height: 160, borderRadius: '50%', background: `radial-gradient(circle, ${color}10 0%, transparent 70%)`, pointerEvents: 'none' }} />
      )}
      <div style={{ position: 'absolute', inset: 0, borderRadius: 'inherit', pointerEvents: 'none', background: 'linear-gradient(120deg, transparent 28%, rgba(255,255,255,0.03) 50%, transparent 72%)' }} />

      {/* Heading */}
      <div className="text-center mb-2 relative z-10">
        <p className="text-[11px] font-bold leading-snug" style={{ color }}>
          {isNoBadge ? 'Your Daily Badge' : greeting}
        </p>
      </div>

      {/* Badge artwork */}
      <div className="flex justify-center items-center mb-2 relative z-10">
        {isNoBadge ? (
          <div style={{
            width: 72, height: 72, borderRadius: 18,
            background: isDark ? 'rgba(148,163,184,0.08)' : 'rgba(148,163,184,0.1)',
            border: '1.5px solid rgba(148,163,184,0.25)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg viewBox="0 0 40 40" width="36" height="36">
              <circle cx="20" cy="20" r="16" fill="none" stroke="rgba(148,163,184,0.35)" strokeWidth="2" strokeDasharray="4,3" />
              <line x1="20" y1="28" x2="20" y2="14" stroke="rgba(148,163,184,0.5)" strokeWidth="2.5" strokeLinecap="round" />
              <path d="M 13 20 L 20 13 L 27 20" fill="none" stroke="rgba(148,163,184,0.5)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        ) : isElite ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src="/badges/xpadite-elite-badge.png"
            alt="XPadite Elite Badge"
            style={{ width: 156, height: 130, objectFit: 'contain', display: 'block' }}
          />
        ) : (
          <svg viewBox="0 0 100 110" width="80" height="88" style={{ display: 'block', overflow: 'visible' }}>
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
            {level === 4 ? (
              <path d="M 50 70 Q 32 60 32 47 Q 32 34 43 28 Q 40 41 50 41 Q 60 41 57 28 Q 68 34 68 47 Q 68 60 50 70 Z" fill={color} fillOpacity="0.74" />
            ) : level === 3 ? (
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

      {/* Rank title + messages */}
      <div className="text-center relative z-10 flex-1 flex flex-col justify-center gap-0.5">
        <p className="text-[13px] font-bold leading-tight" style={{ color }}>{title}</p>
        <p className="text-[10px] leading-relaxed mt-1"
          style={{ color: isDark ? 'rgba(148,163,184,0.62)' : 'var(--xp-txt3)' }}>
          {message}
        </p>
        {secondaryMessage && (
          <p className="text-[10px] leading-relaxed font-semibold mt-0.5"
            style={{ color: isDark ? `${color}cc` : color, opacity: 0.85 }}>
            {secondaryMessage}
          </p>
        )}
        {isElite && dateLabel && (
          <p className="text-[8px] mt-2 opacity-50" style={{ color: isDark ? 'rgba(203,213,225,0.7)' : 'var(--xp-txt3)' }}>
            ◎ Earned on {dateLabel}
          </p>
        )}
      </div>
    </div>
  )
}

// ─── Bottom-right achievement center ──────────────────────────────────────────

function AchievementCenter({ score, isDark }: { score: number; isDark: boolean }) {
  const rank     = getRank(score)
  const nextRank = RANKS.find(r => r.min === rank.max) ?? null
  const tierPct  = Math.min(((score - rank.min) / (rank.max - rank.min)) * 100, 100)
  const ptsLeft  = nextRank ? nextRank.min - score : 0

  const surf = isDark ? 'rgba(12,6,28,0.98)'  : 'var(--xp-bg3)'
  const bdr  = isDark ? `0.5px solid ${rank.color}30` : `0.5px solid ${rank.color}28`

  return (
    <div className="rounded-2xl overflow-hidden h-full xp-lift" style={{ background: surf, border: bdr, boxShadow: isDark ? `0 4px 20px rgba(0,0,0,0.35)` : '0 1px 8px rgba(0,0,0,0.05)' }}>
      {/* Card header */}
      <div className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: isDark ? '0.5px solid rgba(255,255,255,0.06)' : '0.5px solid var(--xp-bdr)' }}>
        <p className="text-[11px] font-semibold" style={{ color: isDark ? 'rgba(255,255,255,0.85)' : 'var(--xp-txt)' }}>
          Achievement Center
        </p>
        <div className="flex gap-1">
          {(['‹', '›'] as const).map(ch => (
            <button key={ch}
              className="w-5 h-5 rounded flex items-center justify-center text-xs transition-opacity hover:opacity-80"
              style={{ background: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)', color: isDark ? 'rgba(255,255,255,0.5)' : 'var(--xp-txt3)' }}>
              {ch}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4">
        {/* Trophy + rank */}
        <div className="flex items-start gap-3 mb-3">
          <div style={{
            width: 44, height: 44, borderRadius: 12, flexShrink: 0,
            background: isDark ? `${rank.color}18` : `${rank.color}10`,
            border: `1.5px solid ${rank.color}40`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
            boxShadow: isDark ? `0 0 14px ${rank.color}25` : 'none',
          }}>
            {rank.emoji}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-0.5">
              <p className="text-[12px] font-bold" style={{ color: rank.color }}>{rank.name} Badge</p>
              {rank.name === 'Elite' && (
                <span className="text-[7px] font-bold px-1.5 py-0.5 rounded-full"
                  style={{ background: `${rank.color}22`, color: rank.color, border: `0.5px solid ${rank.color}40` }}>
                  TOP RANK
                </span>
              )}
            </div>
            <p className="text-[9px] leading-relaxed"
              style={{ color: isDark ? 'rgba(148,163,184,0.6)' : 'var(--xp-txt3)' }}>
              {rank.tagline}
            </p>
          </div>
        </div>

        {/* Progress */}
        <div className="mb-2">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[9px]" style={{ color: isDark ? 'rgba(148,163,184,0.5)' : 'var(--xp-txt3)' }}>
              {nextRank ? `Progress to ${nextRank.name}` : 'Maximum Rank'}
            </p>
            <p className="text-[9px] font-bold tabular-nums" style={{ color: isDark ? 'rgba(203,213,225,0.7)' : 'var(--xp-txt2)' }}>
              {Math.round(tierPct)}%
            </p>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden"
            style={{ background: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)' }}>
            <div className="h-full rounded-full"
              style={{
                width: `${tierPct}%`,
                background: `linear-gradient(90deg, ${rank.color}88 0%, ${rank.color} 100%)`,
                boxShadow: isDark ? `0 0 6px ${rank.color}55` : 'none',
              }} />
          </div>
        </div>

        {nextRank ? (
          <p className="text-[9px]" style={{ color: isDark ? 'rgba(148,163,184,0.45)' : 'var(--xp-txt3)' }}>
            Only <span style={{ color: nextRank.color, fontWeight: 700 }}>{ptsLeft} pts</span> remaining.
          </p>
        ) : (
          <p className="text-[9px] font-medium" style={{ color: rank.color }}>Maximum rank achieved ✦</p>
        )}

        {/* Dot indicators */}
        <div className="flex justify-center gap-1.5 mt-3">
          {RANKS.map((r, i) => {
            const active = r.name === rank.name
            return (
              <div key={i} style={{
                width: active ? 16 : 6, height: 6, borderRadius: 3,
                background: active ? rank.color : isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)',
                transition: 'width 300ms ease',
              }} />
            )
          })}
        </div>
      </div>
    </div>
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
  const [firstName, setFirstName] = useState<string>('')

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Fetch the signed-in user's display name from Supabase auth metadata
  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => {
      const meta = data.user?.user_metadata as Record<string, string> | undefined
      const full = (meta?.full_name ?? meta?.name ?? '').trim()
      if (full) setFirstName(full.split(/\s+/)[0])
    }).catch(() => {})
  }, [])

  const dayData = calData[dateKey]

  const stats = useMemo(() => {
    if (!dayData) return null

    const allSessions = dayData.tasks.flatMap(t =>
      (t.sessions ?? []).filter(s => s.endTs !== null).map(s => ({
        ...s, taskText: t.text, actId: t.actId, taskId: t.id,
      }))
    ).sort((a, b) => a.startTs - b.startTs)

    const totalMs        = allSessions.reduce((s, x) => s + (x.endTs! - x.startTs), 0)
    const longestMs      = allSessions.reduce((mx, s) => Math.max(mx, s.endTs! - s.startTs), 0)
    const sessionCount   = allSessions.length
    const completedTasks = dayData.tasks.filter(t => t.done).length
    const totalTasks     = dayData.tasks.length
    const deepWorkMs     = allSessions
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
    const base   = new Date(APP_YEAR, month, day)
    const dow    = base.getDay()
    return labels.map((label, i) => {
      const d = new Date(base)
      d.setDate(base.getDate() - dow + i)
      const k  = makeDateKey(d.getFullYear(), d.getMonth(), d.getDate())
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
    const hrs  = (totalMs  / 3_600_000).toFixed(1)
    const lHrs = (longestMs / 3_600_000).toFixed(1)
    if (!topAct) return `${completedTasks} task${completedTasks !== 1 ? 's' : ''} completed. Start tracking time to see your session breakdown.`
    return `A ${topAct.name.toLowerCase()}-focused day with ${hrs}h tracked. Longest session: ${lHrs}h — ${parseFloat(lHrs) > 2 ? 'impressive deep work' : 'keep building the habit'}. ${completedTasks > 0 ? `${completedTasks} task${completedTasks !== 1 ? 's' : ''} completed.` : ''}`
  }, [stats])

  const hasActivity = stats !== null && stats.actBreakdown.length > 0
  const hasSessions = stats !== null && stats.allSessions.length > 0
  const hasTasks    = stats !== null && stats.taskTotals.length > 0

  // ── Single final performance level — shared by gauge AND badge ───────────────
  const finalLevel: PerformanceLevel = stats
    ? getFinalPerformanceLevel(stats.score, stats.totalMs)
    : 0
  const finalTier  = PERFORMANCE_TIERS[finalLevel]
  const gaugeScore = performanceLevelToGaugeScore(finalLevel)

  // ── Shared surface tokens ──────────────────────────────────────────────────
  const S0  = isDark ? 'rgba(10,5,24,0.99)'  : 'var(--xp-bg3)'   // modal bg
  const S1  = isDark ? 'rgba(14,7,34,0.98)'  : 'var(--xp-bg3)'   // card level 1
  const S2  = isDark ? 'rgba(18,9,42,0.97)'  : 'var(--xp-bg3)'   // card level 2
  const BDR = isDark ? 'rgba(124,58,237,0.2)': 'var(--xp-bdr)'

  const card1 = { background: S1, border: `0.5px solid ${BDR}`, boxShadow: isDark ? '0 2px 16px rgba(0,0,0,0.35)' : '0 1px 6px rgba(0,0,0,0.05)' }
  const card2 = { background: S2, border: `0.5px solid ${BDR}`, boxShadow: isDark ? '0 2px 16px rgba(0,0,0,0.35)' : '0 1px 6px rgba(0,0,0,0.05)' }

  // ── KPI card definitions ───────────────────────────────────────────────────
  const focusAccent = stats && stats.score >= 80 ? '#ef4444' : stats && stats.score >= 60 ? '#a855f7' : stats && stats.score >= 40 ? '#22c55e' : '#94a3b8'
  const kpiCards = [
    {
      label: 'Total Worked', value: stats ? formatMs(stats.totalMs) : '—', sub: null, icon: '⏱',
      accent: isDark ? '#c4b5fd' : '#7c3aed',
      bg: isDark
        ? 'linear-gradient(140deg, rgba(109,40,217,0.32) 0%, rgba(139,92,246,0.2) 55%, rgba(167,139,250,0.08) 100%)'
        : 'linear-gradient(140deg, #ede9fe 0%, #ddd6fe 60%, #f5f3ff 100%)',
      border: isDark ? 'rgba(139,92,246,0.38)' : 'rgba(139,92,246,0.22)',
      iconBg: isDark ? 'rgba(139,92,246,0.25)' : 'rgba(139,92,246,0.14)',
    },
    {
      label: 'Longest Session', value: stats ? formatMs(stats.longestMs) : '—', sub: stats?.isPersonalBest ? '🔥 Best' : null, icon: '⚡',
      accent: isDark ? '#a5b4fc' : '#4f46e5',
      bg: isDark
        ? 'linear-gradient(140deg, rgba(55,48,163,0.32) 0%, rgba(99,102,241,0.2) 55%, rgba(129,140,248,0.08) 100%)'
        : 'linear-gradient(140deg, #eff6ff 0%, #dbeafe 60%, #e0e7ff 100%)',
      border: isDark ? 'rgba(99,102,241,0.38)' : 'rgba(99,102,241,0.22)',
      iconBg: isDark ? 'rgba(99,102,241,0.25)' : 'rgba(99,102,241,0.14)',
    },
    {
      label: 'Sessions', value: stats ? String(stats.sessionCount) : '—', sub: null, icon: '📋',
      accent: isDark ? '#67e8f9' : '#0891b2',
      bg: isDark
        ? 'linear-gradient(140deg, rgba(14,116,144,0.32) 0%, rgba(8,145,178,0.2) 55%, rgba(34,211,238,0.08) 100%)'
        : 'linear-gradient(140deg, #ecfeff 0%, #cffafe 60%, #d1fae5 100%)',
      border: isDark ? 'rgba(8,145,178,0.38)' : 'rgba(8,145,178,0.22)',
      iconBg: isDark ? 'rgba(8,145,178,0.25)' : 'rgba(8,145,178,0.14)',
    },
    {
      label: 'Tasks Done', value: stats ? `${stats.completedTasks}/${stats.totalTasks}` : '—', sub: stats && stats.totalTasks > 0 ? `${Math.round((stats.completedTasks / stats.totalTasks) * 100)}% complete` : null, icon: '✓',
      accent: isDark ? '#86efac' : '#059669',
      bg: isDark
        ? 'linear-gradient(140deg, rgba(4,120,87,0.32) 0%, rgba(5,150,105,0.2) 55%, rgba(52,211,153,0.08) 100%)'
        : 'linear-gradient(140deg, #ecfdf5 0%, #d1fae5 60%, #fef9c3 100%)',
      border: isDark ? 'rgba(5,150,105,0.38)' : 'rgba(5,150,105,0.22)',
      iconBg: isDark ? 'rgba(5,150,105,0.25)' : 'rgba(5,150,105,0.14)',
    },
    {
      label: 'Deep Work', value: stats ? formatMs(stats.deepWorkMs) : '—', sub: null, icon: '🧠',
      accent: isDark ? '#f9a8d4' : '#db2777',
      bg: isDark
        ? 'linear-gradient(140deg, rgba(157,23,77,0.32) 0%, rgba(219,39,119,0.2) 55%, rgba(249,168,212,0.08) 100%)'
        : 'linear-gradient(140deg, #fdf2f8 0%, #fce7f3 60%, #ffe4e6 100%)',
      border: isDark ? 'rgba(219,39,119,0.38)' : 'rgba(219,39,119,0.22)',
      iconBg: isDark ? 'rgba(219,39,119,0.22)' : 'rgba(219,39,119,0.12)',
    },
    {
      label: 'Focus Score', value: stats ? `${stats.score}%` : '—', sub: stats ? (stats.score >= 80 ? 'Excellent' : stats.score >= 60 ? 'Good' : stats.score >= 40 ? 'Average' : 'Building') : null, icon: '🎯',
      accent: isDark ? (focusAccent === '#ef4444' ? '#f87171' : focusAccent === '#a855f7' ? '#c084fc' : focusAccent === '#22c55e' ? '#4ade80' : '#94a3b8') : focusAccent,
      bg: isDark
        ? 'linear-gradient(140deg, rgba(88,28,135,0.32) 0%, rgba(124,58,237,0.2) 55%, rgba(6,182,212,0.08) 100%)'
        : 'linear-gradient(140deg, #f5f3ff 0%, #ede9fe 60%, #ecfeff 100%)',
      border: isDark ? 'rgba(124,58,237,0.35)' : 'rgba(124,58,237,0.2)',
      iconBg: isDark ? 'rgba(124,58,237,0.22)' : 'rgba(124,58,237,0.12)',
    },
  ]

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-3 sm:p-4 pt-4 sm:pt-6 overflow-y-auto"
      style={{ background: isDark ? 'rgba(0,0,0,0.82)' : 'rgba(0,0,0,0.55)' }}
      onClick={onClose}
    >
      {/* Ambient glows */}
      {isDark && (
        <div className="fixed inset-0 pointer-events-none overflow-hidden" style={{ zIndex: -1 }}>
          <div style={{ position: 'absolute', top: '-12%', right: '-6%', width: 700, height: 700, borderRadius: '50%', background: 'radial-gradient(circle, rgba(124,58,237,0.06) 0%, transparent 65%)' }} />
          <div style={{ position: 'absolute', bottom: '0%', left: '-8%', width: 600, height: 600, borderRadius: '50%', background: 'radial-gradient(circle, rgba(8,145,178,0.04) 0%, transparent 65%)' }} />
        </div>
      )}

      {/* ═══ Modal shell — matches approved design width ══════════════════════ */}
      <div
        className="w-full max-w-[640px] lg:max-w-[1440px] rounded-2xl shadow-2xl overflow-hidden mb-6 sm:mb-8"
        style={{
          background: S0,
          border: isDark ? '0.5px solid rgba(124,58,237,0.22)' : '0.5px solid var(--xp-bdr2)',
          boxShadow: isDark
            ? '0 30px 70px rgba(0,0,0,0.75), 0 0 0 0.5px rgba(124,58,237,0.16), inset 0 1px 0 rgba(255,255,255,0.04)'
            : '0 20px 50px rgba(0,0,0,0.12)',
        }}
        onClick={e => e.stopPropagation()}
      >

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div
          className="flex items-center gap-3 px-4 sm:px-6 py-3.5 sm:py-4"
          style={{ background: 'linear-gradient(135deg, #0f052e 0%, #2d1b69 55%, #18355a 100%)', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}
        >
          {onBack && (
            <button onClick={onBack}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium hover:opacity-80 flex-shrink-0"
              style={{ background: 'rgba(255,255,255,0.08)', border: '0.5px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.8)' }}>
              ← Back
            </button>
          )}
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-bold text-white tracking-wide">Today's Dashboard</h2>
            <p className="text-[10px] mt-0.5 truncate" style={{ color: 'rgba(167,139,250,0.62)' }}>{dateLabel}</p>
          </div>
          <button onClick={onClose}
            className="text-xs px-2.5 py-1.5 rounded-lg hover:opacity-80 flex-shrink-0"
            style={{ background: 'rgba(239,68,68,0.15)', border: '0.5px solid rgba(239,68,68,0.28)', color: '#fca5a5' }}>
            × Close
          </button>
        </div>

        {/* ── Dashboard body ───────────────────────────────────────────────── */}
        <div className="p-4 sm:p-5 lg:p-6 space-y-4 lg:space-y-5">

          {/* ══════════════════════════════════════════════════════════════════
              ROW 1 — [Gauge ~26%] | [KPI Cards 3×2 ~48%] | [Achievement Badge ~26%]
              Matches Dashboard Design ITR 2 approved top row exactly.
              ══════════════════════════════════════════════════════════════════ */}
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.9fr)_minmax(0,0.77fr)] gap-4 lg:gap-5 items-stretch">

            {/* LEFT — Performance Analytics Gauge (large, not compressed) */}
            <div
              className="rounded-2xl overflow-hidden"
              style={{
                background: isDark
                  ? 'linear-gradient(145deg, rgba(16,7,44,0.99) 0%, rgba(7,3,18,0.99) 100%)'
                  : 'var(--xp-card)',
                border: isDark ? '0.5px solid rgba(124,58,237,0.28)' : '0.5px solid var(--xp-bdr2)',
                boxShadow: isDark ? '0 4px 24px rgba(0,0,0,0.5)' : '0 1px 8px rgba(0,0,0,0.06)',
              }}
            >
              <GaugeMeter score={gaugeScore} />
            </div>

            {/* MIDDLE — KPI Metric Cards: 3 columns × 2 rows */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 content-start">
              {kpiCards.map(m => (
                <div
                  key={m.label}
                  className="rounded-xl p-3.5 flex flex-col relative overflow-hidden"
                  style={{
                    background: m.bg,
                    border: `1px solid ${m.border}`,
                    minHeight: 96,
                  }}
                >
                  {/* Icon tile */}
                  <div style={{
                    width: 30, height: 30, borderRadius: 8, marginBottom: 8, flexShrink: 0,
                    background: m.iconBg,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 14,
                  }}>
                    {m.icon}
                  </div>
                  {/* Value */}
                  <p className="text-xl sm:text-2xl font-bold leading-none tabular-nums mb-1"
                    style={{ color: m.accent }}>
                    {m.value}
                  </p>
                  {/* Label */}
                  <p className="text-[9px] font-medium mt-auto"
                    style={{ color: isDark ? 'rgba(148,163,184,0.6)' : 'rgba(71,85,105,0.65)' }}>
                    {m.label}
                  </p>
                  {/* Sub */}
                  {m.sub && (
                    <p className="text-[8px] mt-0.5 font-semibold" style={{ color: isDark ? `${m.accent}cc` : m.accent }}>
                      {m.sub}
                    </p>
                  )}
                </div>
              ))}
            </div>

            {/* RIGHT — Congratulations / Achievement badge */}
            <AchievementBanner tier={finalTier} level={finalLevel} isDark={isDark} firstName={firstName} dateLabel={dateLabel} />
          </div>

          {/* ══════════════════════════════════════════════════════════════════
              ROW 2 — [Today's Progress ~68%] | [Weekly Overview ~32%]
              ══════════════════════════════════════════════════════════════════ */}
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)] gap-4 lg:gap-5">

            {/* Today's Progress — wide, full graph area */}
            <div className="rounded-2xl p-4 sm:p-5 flex flex-col" style={card1}>
              <div className="flex items-start justify-between mb-3 flex-shrink-0">
                <div>
                  <p className="text-[11px] font-semibold tracking-wide"
                    style={{ color: isDark ? 'rgba(255,255,255,0.88)' : 'var(--xp-txt)' }}>
                    Today's Progress
                  </p>
                  <p className="text-[9px] mt-0.5"
                    style={{ color: isDark ? 'rgba(148,163,184,0.5)' : 'var(--xp-txt3)' }}>
                    Cumulative productive time
                  </p>
                </div>
                {stats && stats.totalMs > 0 && (
                  <div className="text-right">
                    <p className="text-[14px] font-bold tabular-nums" style={{ color: '#a78bfa' }}>
                      {formatMs(stats.totalMs)}
                    </p>
                    <p className="text-[9px]" style={{ color: isDark ? 'rgba(148,163,184,0.45)' : 'var(--xp-txt3)' }}>total</p>
                  </div>
                )}
              </div>
              <div className="flex-1 min-h-[240px] lg:min-h-[280px]">
                <ProgressGraph
                  sessions={stats?.allSessions ?? []}
                  totalMs={stats?.totalMs ?? 0}
                  activityColors={new Map<string, string>(activities.map(a => [a.id, a.color] as [string, string]))}
                  activityNames={new Map<string, string>(activities.map(a => [a.id, a.name] as [string, string]))}
                />
              </div>
            </div>

            {/* Today's Overview — activity breakdown bars */}
            <div className="rounded-2xl p-4 sm:p-5" style={card2}>
              <p className="text-[11px] font-semibold mb-2 tracking-wide"
                style={{ color: isDark ? 'rgba(255,255,255,0.88)' : 'var(--xp-txt)' }}>
                Today's Overview
              </p>
              <div className="min-h-[240px] lg:min-h-[280px]">
                <TodayOverviewBars
                  data={stats?.actBreakdown.map(a => ({ label: a.name, ms: a.ms, color: a.color })) ?? []}
                />
              </div>
            </div>
          </div>

          {/* ══════════════════════════════════════════════════════════════════
              ROW 3 — Three columns
              Activity Distribution | Session Log | Task Breakdown
              ══════════════════════════════════════════════════════════════════ */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-5">

            {/* Activity Distribution — donut left, legend right (horizontal) */}
            <div className="rounded-2xl p-4" style={card1}>
              <p className="text-[11px] font-semibold mb-3 tracking-wide"
                style={{ color: isDark ? 'rgba(255,255,255,0.88)' : 'var(--xp-txt)' }}>
                Activity Distribution
              </p>
              {hasActivity ? (
                <div className="flex items-start gap-3">
                  <DonutChart segments={stats!.actBreakdown.map(a => ({ color: a.color, pct: a.pct }))} size="sm" />
                  <div className="flex-1 min-w-0 space-y-2 pt-1">
                    {stats!.actBreakdown.map(a => (
                      <div key={a.actId} className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ background: a.color }} />
                        <span className="text-[9px] flex-1 min-w-0 truncate"
                          style={{ color: isDark ? 'rgba(203,213,225,0.78)' : 'var(--xp-txt2)' }}>
                          {a.name}
                        </span>
                        <span className="text-[9px] flex-shrink-0 tabular-nums font-semibold"
                          style={{ color: isDark ? 'rgba(255,255,255,0.85)' : 'var(--xp-txt)' }}>
                          {formatMs(a.ms)}
                        </span>
                        <span className="text-[8px] flex-shrink-0 tabular-nums"
                          style={{ color: isDark ? 'rgba(148,163,184,0.5)' : 'var(--xp-txt3)' }}>
                          {Math.round(a.pct * 100)}%
                        </span>
                      </div>
                    ))}
                    <div className="flex items-center gap-1.5 pt-1.5"
                      style={{ borderTop: isDark ? '0.5px solid rgba(255,255,255,0.07)' : '0.5px solid var(--xp-bdr)' }}>
                      <div className="w-2 h-2 flex-shrink-0" />
                      <span className="text-[9px] flex-1 font-semibold"
                        style={{ color: isDark ? 'rgba(255,255,255,0.55)' : 'var(--xp-txt3)' }}>
                        Total
                      </span>
                      <span className="text-[9px] font-bold tabular-nums flex-shrink-0"
                        style={{ color: isDark ? 'rgba(255,255,255,0.88)' : 'var(--xp-txt)' }}>
                        {formatMs(stats!.totalMs)}
                      </span>
                      <span className="text-[8px] flex-shrink-0"
                        style={{ color: isDark ? 'rgba(148,163,184,0.5)' : 'var(--xp-txt3)' }}>
                        100%
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center h-24">
                  <p className="text-[10px]" style={{ color: 'var(--xp-txt3)' }}>No activity data</p>
                </div>
              )}
            </div>

            {/* Session Log */}
            <div className="rounded-2xl overflow-hidden" style={card2}>
              <div className="px-4 py-3"
                style={{ borderBottom: isDark ? '0.5px solid rgba(124,58,237,0.1)' : '0.5px solid var(--xp-bdr)' }}>
                <p className="text-[11px] font-semibold tracking-wide"
                  style={{ color: isDark ? 'rgba(255,255,255,0.88)' : 'var(--xp-txt)' }}>
                  Session Log
                </p>
              </div>
              {hasSessions ? (
                <>
                  {stats!.allSessions.map((s, i) => {
                    const act  = activities.find(a => a.id === s.actId)
                    const dur  = s.endTs! - s.startTs
                    const deep = dur >= 45 * 60_000
                    return (
                      <div
                        key={s.id ?? i}
                        className="xp-row flex items-center gap-2 px-4 py-2.5"
                        style={{ borderBottom: i < stats!.allSessions.length - 1 ? isDark ? '0.5px solid rgba(124,58,237,0.08)' : '0.5px solid var(--xp-bdr)' : 'none' }}
                      >
                        <div className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ background: act?.color ?? '#94a3b8' }} />
                        <span className="text-[10px] font-semibold truncate flex-shrink-0"
                          style={{ width: 54, color: isDark ? 'rgba(255,255,255,0.85)' : 'var(--xp-txt)' }}>
                          {act?.name ?? 'Other'}
                        </span>
                        <span className="text-[9px] flex-1 tabular-nums"
                          style={{ color: isDark ? 'rgba(148,163,184,0.55)' : 'var(--xp-txt3)' }}>
                          {formatTime(s.startTs)} → {formatTime(s.endTs!)}
                        </span>
                        {deep && (
                          <span className="text-[7px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0"
                            style={{ background: 'rgba(124,58,237,0.15)', color: '#a78bfa', border: '0.5px solid rgba(124,58,237,0.22)' }}>
                            Deep
                          </span>
                        )}
                        <span className="text-[10px] font-bold flex-shrink-0 tabular-nums"
                          style={{ color: deep ? '#a78bfa' : isDark ? 'rgba(203,213,225,0.72)' : 'var(--xp-txt2)' }}>
                          {formatMs(dur)}
                        </span>
                      </div>
                    )
                  })}
                  <div className="px-4 py-2.5"
                    style={{ borderTop: isDark ? '0.5px solid rgba(124,58,237,0.08)' : '0.5px solid var(--xp-bdr)' }}>
                    <button className="text-[9px] font-semibold hover:opacity-80 transition-opacity"
                      style={{ color: '#a78bfa' }}>
                      View all sessions →
                    </button>
                  </div>
                </>
              ) : (
                <div className="px-4 py-6 text-center">
                  <p className="text-[10px]" style={{ color: 'var(--xp-txt3)' }}>No sessions recorded</p>
                </div>
              )}
            </div>

            {/* Task Breakdown */}
            <div className="rounded-2xl p-4" style={card1}>
              <div className="flex items-center justify-between mb-3">
                <p className="text-[11px] font-semibold tracking-wide"
                  style={{ color: isDark ? 'rgba(255,255,255,0.88)' : 'var(--xp-txt)' }}>
                  Task Breakdown
                </p>
                {stats && (
                  <span className="text-[8px] font-bold px-2 py-0.5 rounded-full"
                    style={{
                      background: stats.completedTasks === stats.totalTasks && stats.totalTasks > 0
                        ? 'rgba(5,150,105,0.18)' : isDark ? 'rgba(124,58,237,0.16)' : 'rgba(124,58,237,0.07)',
                      color: stats.completedTasks === stats.totalTasks && stats.totalTasks > 0 ? '#34d399' : '#a78bfa',
                      border: stats.completedTasks === stats.totalTasks && stats.totalTasks > 0
                        ? '0.5px solid rgba(5,150,105,0.32)' : '0.5px solid rgba(124,58,237,0.26)',
                    }}>
                    {stats.completedTasks}/{stats.totalTasks} done
                  </span>
                )}
              </div>
              {hasTasks ? (
                <div className="space-y-3.5">
                  {stats!.taskTotals.map((t, taskIdx) => {
                    const act      = activities.find(a => a.id === t.actId)
                    const [palL, palD] = TASK_GRAD_PALETTE[taskIdx % TASK_GRAD_PALETTE.length]
                    const barC     = act?.color ?? palD
                    const barCL    = act?.color ? lightenHex(act.color, 0.55) : palL
                    const barPct   = Math.round((t.ms / (stats!.taskTotals[0]?.ms ?? 1)) * 100)
                    const totalPct = stats!.totalMs > 0 ? Math.round((t.ms / stats!.totalMs) * 100) : 0
                    return (
                      <div key={t.id}>
                        {/* Title row + right-aligned stats */}
                        <div className="flex items-start justify-between gap-2 mb-1.5">
                          <span className="text-[9px] flex-1 min-w-0 leading-snug font-medium"
                            style={{
                              color: t.done ? isDark ? 'rgba(148,163,184,0.38)' : 'var(--xp-txt3)' : isDark ? 'rgba(203,213,225,0.88)' : 'var(--xp-txt)',
                              textDecoration: t.done ? 'line-through' : 'none',
                            }}>
                            {t.text}
                          </span>
                          <div className="flex-shrink-0 text-right" style={{ minWidth: 44 }}>
                            <span className="text-[10px] font-bold block tabular-nums leading-tight"
                              style={{ color: isDark ? 'rgba(203,213,225,0.9)' : 'var(--xp-txt)' }}>
                              {formatMs(t.ms)}
                            </span>
                            <span className="text-[8px] tabular-nums leading-tight"
                              style={{ color: isDark ? 'rgba(148,163,184,0.5)' : 'var(--xp-txt3)' }}>
                              {totalPct}%
                            </span>
                          </div>
                        </div>
                        {/* Gradient progress bar — colorful even when done; done shown via text only */}
                        <div className="h-2 rounded-full overflow-hidden"
                          style={{ background: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)' }}>
                          <div className="h-full rounded-full"
                            style={{
                              width: `${barPct > 0 ? Math.max(barPct, 3) : 0}%`,
                              background: `linear-gradient(90deg, ${barCL} 0%, ${barC} 100%)`,
                              opacity: t.done ? 0.55 : 1,
                            }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="flex items-center justify-center h-24">
                  <p className="text-[10px]" style={{ color: 'var(--xp-txt3)' }}>No task data</p>
                </div>
              )}
            </div>

          </div>

          {/* ── Daily Summary ─────────────────────────────────────────────── */}
          <div className="rounded-2xl px-4 py-3.5"
            style={{
              background: isDark ? 'linear-gradient(135deg, rgba(124,58,237,0.09) 0%, rgba(99,102,241,0.05) 100%)' : 'linear-gradient(135deg, rgba(124,58,237,0.05), rgba(99,102,241,0.03))',
              border: isDark ? '0.5px solid rgba(124,58,237,0.2)' : '0.5px solid rgba(124,58,237,0.14)',
            }}>
            <div className="flex items-start gap-3">
              <span className="text-base flex-shrink-0 mt-0.5">🤖</span>
              <div>
                <p className="text-[10px] font-bold mb-1 tracking-wide" style={{ color: '#a78bfa' }}>Daily Summary</p>
                <p className="text-[11px] leading-relaxed" style={{ color: isDark ? 'rgba(203,213,225,0.75)' : 'var(--xp-txt2)' }}>
                  {summary}
                </p>
                <p className="text-[9px] mt-1.5 italic" style={{ color: isDark ? 'rgba(148,163,184,0.35)' : 'var(--xp-txt3)' }}>
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

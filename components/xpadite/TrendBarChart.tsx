'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { formatMs } from './utils'

// ─── Shared bar + curved-trend-line chart ──────────────────────────────────────
// Originally built for Monthly Dashboard's weekly progress graph, then reused
// as-is (not re-implemented) for Daily Dashboard's hourly progress graph, so
// both dashboards share one visual system: same bars, same smooth curve, same
// point/label/peak treatment, same entrance animation. Only the DATA differs
// per caller (weekly buckets vs. hourly buckets) — this component has no
// concept of "week" or "day", just a generic ordered list of labeled buckets.

export interface TrendBucket {
  label: string
  ms: number
  // Chronologically-ordered sub-parts shown on hover when a bucket's total
  // blends two different source periods (Monthly's cross-month weeks use
  // this; Daily's hourly buckets never set it).
  crossMonth?: { range: string; ms: number }[] | null
  // Overrides `label` in the hover/tap tooltip's header only (e.g. "September
  // 2026" vs. the short axis label "Sep") — the on-chart label stays compact.
  tooltipLabel?: string
  // Extra compact lines shown under the tooltip header, alongside crossMonth
  // if both are set (e.g. Yearly's per-month "47 sessions" / "38 tasks
  // completed").
  detail?: string[]
  // Hasn't started/happened yet (e.g. a calendar week before today, or an
  // hour-of-day later than the current time on today) — distinct from a
  // completed bucket that legitimately totals 0. Drives both the trend
  // line's stop point and the WIP marker.
  isFuture: boolean
  isCurrent: boolean
}

export function TrendBarChart({ buckets, isDark, emptyMessage = 'No focus sessions recorded yet' }: {
  buckets: TrendBucket[]
  isDark: boolean
  emptyMessage?: string
}) {
  // Unique per instance so two charts (e.g. Daily + Monthly, however
  // unlikely to ever be mounted together) never collide on SVG def ids.
  const uid = useId().replace(/[:]/g, '')
  const pointClass = `xp-trend-point-${uid}`

  // Lazy initial value (not an effect) so the reduced-motion case never needs
  // a synchronous setState inside the effect below — it just skips starting
  // the animation loop when this is already 1.
  const [revealFrac, setRevealFrac] = useState(() => (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) ? 1 : 0)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const rafRef = useRef<number>(0)

  // Plays once per mount. Callers remount this component (via a `key` tied
  // to whatever identifies "a different dataset", e.g. month+mode or a day's
  // date) to replay the animation instead of resetting state from inside
  // this effect.
  useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const DURATION = 1100
    const start = performance.now()
    function tick(now: number) {
      const t = Math.min((now - start) / DURATION, 1)
      setRevealFrac(1 - Math.pow(1 - t, 3))
      if (t < 1) rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [])

  if (buckets.every(w => w.ms === 0)) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 180, flexDirection: 'column', gap: 8 }}>
        <span style={{ fontSize: 22 }}>📈</span>
        <p style={{ fontSize: 10, color: isDark ? 'rgba(148,163,184,0.50)' : 'var(--xp-txt3)' }}>{emptyMessage}</p>
      </div>
    )
  }

  const n = buckets.length
  const maxMs = Math.max(...buckets.map(w => w.ms), 1)
  const maxHours = maxMs / 3_600_000
  // Sensible 1-16h default range that grows to fit higher totals — never clips.
  const yMaxHours = Math.max(16, Math.ceil((maxHours * 1.15) / 2) * 2)
  const yMaxMs = yMaxHours * 3_600_000

  const W = 520, H = 220
  const PAD = { top: 52, bottom: 28, left: 32, right: 14 }
  const cW = W - PAD.left - PAD.right
  const cH = H - PAD.top - PAD.bottom
  const slotW = cW / n
  const barW = Math.min(Math.max(slotW * 0.44, 26), 60)
  const xCenter = (i: number) => PAD.left + i * slotW + slotW / 2
  const yPos = (ms: number) => PAD.top + cH - (ms / yMaxMs) * cH
  const baseY = PAD.top + cH
  // The trend line/points float above their bar's top rather than sitting on it.
  const LINE_GAP = 12

  const step = yMaxHours <= 16 ? 2 : yMaxHours <= 30 ? 5 : yMaxHours <= 60 ? 10 : 20
  const yTicks: number[] = []
  for (let h = step; h <= yMaxHours; h += step) yTicks.push(h)

  const peakIdx = buckets.reduce((best, w, i) => (w.ms > buckets[best].ms ? i : best), 0)
  const hasPeak = buckets[peakIdx].ms > 0

  function barFrac(i: number): number {
    const stagger = n > 1 ? 0.45 / n : 0
    const localStart = i * stagger
    const t = Math.max(0, Math.min((revealFrac - localStart) / Math.max(1 - localStart, 0.01), 1))
    return 1 - Math.pow(1 - t, 3)
  }

  // Last bucket that has actually begun — the trend line/points stop here, so
  // a dataset that's only just started never connects forward through
  // buckets that haven't happened yet (which would otherwise sit at 0 and
  // read as "zero activity" rather than "hasn't occurred").
  let lastActiveIdx = -1
  for (let i = 0; i < n; i++) if (!buckets[i].isFuture) lastActiveIdx = i

  const linePts = buckets.map((w, i) => ({ x: xCenter(i), y: yPos(w.ms) - LINE_GAP }))
  const activePts = lastActiveIdx >= 0 ? linePts.slice(0, lastActiveIdx + 1) : []

  // Per-segment horizontal-tangent cubic Bézier: each segment leaves its
  // start point and arrives at its end point moving horizontally, which
  // always produces a genuine flowing S-curve — including between just 2
  // points, where a Catmull-Rom approach can degenerate to a straight
  // diagonal when there's no neighboring point for context. Because the
  // tangent is horizontal on BOTH sides of every point in the list (not just
  // the two real data points), inserting extra waypoints never introduces a
  // kink — every point the path passes through stays smooth, which is what
  // lets the bar-clearance waypoints below just slot in as more points
  // rather than needing special-cased curve math.
  function smoothPath(pts: { x: number; y: number }[]): string {
    if (pts.length < 2) return ''
    let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`
    for (let i = 0; i < pts.length - 1; i++) {
      const p1 = pts[i]
      const p2 = pts[i + 1]
      const midX = (p1.x + p2.x) / 2
      d += ` C ${midX.toFixed(1)} ${p1.y.toFixed(1)}, ${midX.toFixed(1)} ${p2.y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`
    }
    return d
  }

  // Bar-clearance waypoints: for every active bucket with a real bar (ms>0),
  // replace its single dot-point with three co-height points — just outside
  // the bar's left edge, the dot itself, just outside the right edge — all
  // at the dot's own y. Since smoothPath gives every point a horizontal
  // tangent on both sides, the curve rises to "shoulder" height BEFORE it
  // reaches the bar's left edge, stays clear of the bar for its full width,
  // then descends only after clearing the right edge — so the line can never
  // cut through a bar's rectangle, for any bar height/neighboring value,
  // without touching the dot's actual data position or the bar's own
  // geometry. Zero-height buckets (no bar to clear) keep their single point.
  const BAR_CLEARANCE = 5
  const pathPts = activePts.flatMap((p, idx) => {
    const w = buckets[idx]
    if (w.ms <= 0) return [p]
    return [
      { x: p.x - barW / 2 - BAR_CLEARANCE, y: p.y },
      p,
      { x: p.x + barW / 2 + BAR_CLEARANCE, y: p.y },
    ]
  })
  const linePath = smoothPath(pathPts)
  const gridCol = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'
  const txtCol  = isDark ? 'rgba(148,163,184,0.55)' : 'rgba(100,116,139,0.70)'

  return (
    <div style={{ position: 'relative' }}>
      {/* Point radius: unchanged on mobile, modestly smaller on tablet/desktop. */}
      <style>{`@media (min-width: 640px) { .${pointClass} { r: 4px; } }`}</style>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible' }}>
        <defs>
          <linearGradient id={`${uid}-bar`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#a855f7" />
            <stop offset="100%" stopColor="#6d28d9" />
          </linearGradient>
          <clipPath id={`${uid}-line-clip`}>
            <rect x={0} y={0} width={W * revealFrac} height={H} />
          </clipPath>
        </defs>

        {yTicks.map(h => {
          const y = yPos(h * 3_600_000)
          return (
            <g key={h}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} stroke={gridCol} strokeWidth={1} />
              <text x={PAD.left - 6} y={y + 3} textAnchor="end" fontSize={7.5} fill={txtCol}>{h}h</text>
            </g>
          )
        })}
        <line x1={PAD.left} x2={W - PAD.right} y1={baseY} y2={baseY} stroke={isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)'} strokeWidth={1} />

        {/* Full-column hover hit areas — desktop hovers, touch devices tap to
            toggle (mouseenter/mouseleave never fire there). */}
        {buckets.map((w, i) => (
          <rect key={`hit-${w.label}`} x={xCenter(i) - slotW / 2} y={PAD.top} width={slotW} height={cH} fill="transparent"
            style={{ cursor: 'pointer' }}
            onMouseEnter={() => setHoverIdx(i)} onMouseLeave={() => setHoverIdx(null)}
            onClick={() => setHoverIdx(idx => idx === i ? null : i)} />
        ))}

        {/* Bars — rise from the baseline, staggered left to right. Always
            fully opaque/solid — no hover-dim on the bar fill itself. */}
        {buckets.map((w, i) => {
          const frac = barFrac(i)
          const fullH = (w.ms / yMaxMs) * cH
          const barH = fullH * frac
          const x = xCenter(i) - barW / 2
          const y = baseY - barH
          return (
            <rect key={w.label} x={x} y={y} width={barW} height={Math.max(barH, 0)} rx={6}
              fill={`url(#${uid}-bar)`} pointerEvents="none"
            />
          )
        })}

        {/* WIP — only the current (in-progress) bucket's bar, only when
            there's room for the stacked letters so it never overflows or
            collides. */}
        {buckets.map((w, i) => {
          if (!w.isCurrent) return null
          const fullBarH = (w.ms / yMaxMs) * cH
          const availH = fullBarH * barFrac(i)
          const LETTER_H = 11
          const totalH = 3 * LETTER_H
          if (availH < totalH + 10 || barW < 16) return null
          const startY = baseY - availH / 2 - totalH / 2 + LETTER_H * 0.78
          return (
            <g key={`wip-${w.label}`} pointerEvents="none" style={{ opacity: barFrac(i) > 0.85 ? 1 : 0, transition: 'opacity 200ms ease' }}>
              {['W', 'I', 'P'].map((l, li) => (
                <text key={l} x={xCenter(i)} y={startY + li * LETTER_H} textAnchor="middle" fontSize={9} fontWeight={800}
                  letterSpacing="0.04em" fill="rgba(255,255,255,0.88)">{l}</text>
              ))}
            </g>
          )
        })}

        {/* Trend line — wipes in left to right, stops at the last bucket
            that has actually begun (never drawn through future buckets). */}
        {activePts.length > 1 && (
          <g clipPath={`url(#${uid}-line-clip)`}>
            <path d={linePath} fill="none" stroke="#ef4444" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" />
          </g>
        )}

        {/* Points + exact time labels + peak trophy — only for buckets that
            have begun; floating LINE_GAP above their bar's top. */}
        {buckets.map((w, i) => {
          const threshold = lastActiveIdx > 0 ? (i / lastActiveIdx) * 0.92 : 0
          const visible = revealFrac >= threshold
          const p = linePts[i]
          if (w.isFuture) return null
          return (
            <g key={w.label} pointerEvents="none" style={{ opacity: visible ? 1 : 0, transition: 'opacity 280ms ease' }}>
              <circle className={pointClass} cx={p.x} cy={p.y} r={5} fill={isDark ? '#1a1030' : '#ffffff'} stroke="#7c3aed" strokeWidth={2.5} />
              <text x={p.x} y={p.y - 11} textAnchor="middle" fontSize={8.5} fontWeight={700} fill="#7c3aed">
                {formatMs(w.ms)}
              </text>
              {hasPeak && i === peakIdx && (
                <text x={p.x} y={p.y - 23} textAnchor="middle" fontSize={11}>🏆</text>
              )}
            </g>
          )
        })}

        {buckets.map((w, i) => (
          <text key={`lbl-${w.label}`} x={xCenter(i)} y={baseY + 16} textAnchor="middle" fontSize={8.5} fontWeight={700}
            fill={isDark ? 'rgba(226,232,240,0.78)' : 'var(--xp-txt2)'} pointerEvents="none">
            {w.label}
          </text>
        ))}
      </svg>

      {/* Tooltip — cross-month breakdown and/or compact detail lines, only
          when a bucket sets either. Shown on hover (desktop) or tap (touch,
          via the hit-rects' onClick above). Absolutely positioned, so it
          never consumes layout space or changes the chart's own dimensions. */}
      {hoverIdx !== null && !buckets[hoverIdx].isFuture && (buckets[hoverIdx].crossMonth || buckets[hoverIdx].detail) && (
        <div style={{
          position: 'absolute', left: `${(xCenter(hoverIdx) / W) * 100}%`, transform: 'translateX(-50%)',
          bottom: `${100 - (PAD.top / H) * 100 + 2}%`,
          background: isDark ? 'rgba(20,11,46,0.98)' : '#ffffff',
          border: `0.5px solid ${isDark ? 'rgba(124,58,237,0.35)' : 'var(--xp-bdr2)'}`,
          borderRadius: 10, padding: '6px 10px', boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
          fontSize: 9, whiteSpace: 'nowrap', zIndex: 5, pointerEvents: 'none',
        }}>
          <div style={{ fontWeight: 700, marginBottom: 2, color: isDark ? 'rgba(255,255,255,0.90)' : 'var(--xp-txt)' }}>
            {buckets[hoverIdx].tooltipLabel ?? buckets[hoverIdx].label} — {formatMs(buckets[hoverIdx].ms)}
          </div>
          {buckets[hoverIdx].crossMonth?.map(part => (
            <div key={part.range} style={{ color: isDark ? 'rgba(203,213,225,0.75)' : 'var(--xp-txt2)' }}>
              {part.range} · {formatMs(part.ms)}
            </div>
          ))}
          {buckets[hoverIdx].detail?.map((line, i) => (
            <div key={i} style={{ color: isDark ? 'rgba(203,213,225,0.75)' : 'var(--xp-txt2)' }}>
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

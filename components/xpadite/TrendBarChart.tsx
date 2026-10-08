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
  const dotClass = `xp-trend-dot-${uid}`

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
  const LINE_GAP = 20

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

  // Every positive point floats a flat LINE_GAP above its own bar's top.
  // Genuine zero-value buckets are pinned exactly at the baseline and never
  // moved — a zero reading must never be visually lifted into looking
  // non-zero. The connecting line is then drawn as PLAIN STRAIGHT SEGMENTS,
  // point to point, with no inserted bends or routing waypoints. Instead,
  // where a straight segment arriving from (or leaving to) a much lower
  // neighbor would otherwise cut across this point's own bar before
  // reaching it, the point itself is lifted further above its natural
  // LINE_GAP position until the straight segment clears that bar's safe
  // height — "straight, elevated," never "routed around."
  const SAFE_MARGIN = 6
  function barSafeY(bucketIdx: number): number | null {
    const ms = buckets[bucketIdx]?.ms
    if (!ms || ms <= 0) return null
    return yPos(ms) - SAFE_MARGIN
  }

  interface LinePt { x: number; y: number; pinned: boolean }
  const linePts: LinePt[] = buckets.map((w, i) => (
    !w.ms || w.ms <= 0
      ? { x: xCenter(i), y: baseY, pinned: true }
      : { x: xCenter(i), y: yPos(w.ms) - LINE_GAP, pinned: false }
  ))

  // For point `i`'s own bar, given a (possibly still-settling) neighbor
  // `nb`, the highest point `i` is allowed to sit at (smallest y) so the
  // straight segment between them stays at/above the bar's safe height
  // across the bar's own horizontal span — checked at whichever span edge
  // the segment reaches first coming from the neighbor's side.
  function requiredY(i: number, nb: LinePt): number | null {
    const safeY = barSafeY(i)
    if (safeY == null) return null
    const mine = linePts[i]
    const edgeX = nb.x < mine.x ? xCenter(i) - barW / 2 : xCenter(i) + barW / 2
    const dx = mine.x - nb.x
    if (dx === 0) return null
    const t = (edgeX - nb.x) / dx
    if (t <= 0 || t > 1) return null
    return (safeY - nb.y * (1 - t)) / t
  }

  // Relaxation pass: lifting one point can, in rare cascades, tighten what
  // an adjacent point now needs too, so iterate until nothing moves —
  // bounded by the bucket count, always small here (7, 8 or 12 points).
  const MIN_Y = 4
  for (let pass = 0; pass < n; pass++) {
    let changed = false
    for (let i = 0; i < n; i++) {
      if (linePts[i].pinned) continue
      let y = linePts[i].y
      if (i > 0) { const r = requiredY(i, linePts[i - 1]); if (r != null) y = Math.min(y, r) }
      if (i < n - 1) { const r = requiredY(i, linePts[i + 1]); if (r != null) y = Math.min(y, r) }
      y = Math.max(y, MIN_Y)
      if (y < linePts[i].y - 0.01) { linePts[i] = { ...linePts[i], y }; changed = true }
    }
    if (!changed) break
  }

  const activePts = lastActiveIdx >= 0 ? linePts.slice(0, lastActiveIdx + 1) : []

  // ONE continuous red trend line, built from plain straight segments —
  // point → line → point, exactly like a conventional line chart. No
  // spline, no Bézier control points, no routing waypoints. Also returns
  // the final segment's direction, for the arrowhead below.
  function buildPolyline(pts: LinePt[]): { d: string; endDir: { x: number; y: number } | null } {
    if (pts.length < 2) return { d: '', endDir: null }
    let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`
    for (let i = 1; i < pts.length; i++) d += ` L ${pts[i].x.toFixed(1)} ${pts[i].y.toFixed(1)}`
    const a = pts[pts.length - 2], b = pts[pts.length - 1]
    const dx = b.x - a.x, dy = b.y - a.y
    const len = Math.hypot(dx, dy) || 1
    return { d, endDir: { x: dx / len, y: dy / len } }
  }

  const { d: linePath, endDir } = buildPolyline(activePts)

  // Arrowhead — OPEN chevron (two strokes meeting at the tip, not a filled
  // triangle): wing → tip → wing, drawn as a stroked polyline so it reads as
  // a natural continuation of the line itself rather than a separate solid
  // shape. The tip sits exactly RING_R away from the final point along the
  // curve's own exit tangent, i.e. touching the outside edge of that
  // point's ring without entering it.
  let arrowPoints: string | null = null
  if (endDir) {
    const pLast = activePts[activePts.length - 1]
    const RING_R = 3.5, ARROW_LEN = 9, ARROW_W = 7
    const tipX = pLast.x - endDir.x * RING_R, tipY = pLast.y - endDir.y * RING_R
    const backX = pLast.x - endDir.x * (RING_R + ARROW_LEN), backY = pLast.y - endDir.y * (RING_R + ARROW_LEN)
    const px = -endDir.y, py = endDir.x
    const leftX = backX + px * (ARROW_W / 2), leftY = backY + py * (ARROW_W / 2)
    const rightX = backX - px * (ARROW_W / 2), rightY = backY - py * (ARROW_W / 2)
    arrowPoints = `${leftX.toFixed(1)},${leftY.toFixed(1)} ${tipX.toFixed(1)},${tipY.toFixed(1)} ${rightX.toFixed(1)},${rightY.toFixed(1)}`
  }
  // Matches the per-point reveal threshold below evaluated at i=lastActiveIdx
  // (i/lastActiveIdx*0.92 = 0.92 for any lastActiveIdx>0; the lone-point case
  // has no "threshold" to reach, so it's visible as soon as anything is).
  const lastVisible = lastActiveIdx > 0 ? revealFrac >= 0.92 : revealFrac > 0

  const gridCol = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'
  const txtCol  = isDark ? 'rgba(148,163,184,0.55)' : 'rgba(100,116,139,0.70)'

  return (
    <div style={{ position: 'relative' }}>
      {/* Point sizes: unchanged on mobile, modestly smaller on tablet/desktop. */}
      <style>{`@media (min-width: 640px) { .${pointClass} { r: 2.8px; } .${dotClass} { r: 1.1px; } }`}</style>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible' }}>
        <defs>
          <linearGradient id={`${uid}-bar`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#a855f7" />
            <stop offset="100%" stopColor="#6d28d9" />
          </linearGradient>
          {/* Trajectory gradient — flows chronologically left→right (start
              date to end date), independent of each point's own y, so it
              never shifts with the line's vertical position. */}
          <linearGradient id={`${uid}-trend`} gradientUnits="userSpaceOnUse" x1={PAD.left} y1="0" x2={W - PAD.right} y2="0">
            <stop offset="0%" stopColor="#9253E6" />
            <stop offset="100%" stopColor="#BB00FF" />
          </linearGradient>
          <clipPath id={`${uid}-line-clip`}>
            <rect x={0} y={0} width={W * revealFrac} height={H} />
          </clipPath>
          {/* Subtle airy plot-area tint — white at the top fading to a very
              translucent blue toward the baseline. Light mode only; the
              chart's own dark-mode background already handles contrast
              there, and this specific gradient is a light-UI treatment. */}
          {!isDark && (
            <linearGradient id={`${uid}-plot-bg`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#FFFFFF" stopOpacity={0} />
              <stop offset="100%" stopColor="#1A79BF" stopOpacity={0.08} />
            </linearGradient>
          )}
        </defs>

        {!isDark && (
          <rect x={PAD.left} y={PAD.top} width={cW} height={cH} fill={`url(#${uid}-plot-bg)`} pointerEvents="none" />
        )}

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

        {/* Trend line — ONE continuous spline, computed first and in full;
            the point markers below are a separate layer drawn on top and
            never feed back into this path. Wipes in left to right, stops at
            the last bucket that has actually begun (never drawn through
            future buckets). */}
        {activePts.length > 1 && (
          <g clipPath={`url(#${uid}-line-clip)`}>
            <path d={linePath} fill="none" stroke={`url(#${uid}-trend)`} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" />
          </g>
        )}

        {/* Arrowhead — open chevron (two strokes, not a filled shape) at
            only the final valid point, fades in with it. */}
        {arrowPoints && (
          <polyline points={arrowPoints} fill="none" stroke={`url(#${uid}-trend)`} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" pointerEvents="none"
            style={{ opacity: lastVisible ? 1 : 0, transition: 'opacity 280ms ease' }} />
        )}

        {/* Points + exact time labels + peak trophy — only for buckets that
            have begun; floating LINE_GAP above their bar's top. A thin
            purple ring (with a background-colored gap, hiding the spline
            passing directly underneath) plus a small solid center dot,
            layered on top of the finished spline — the spline itself is
            never reshaped around them. */}
        {buckets.map((w, i) => {
          const threshold = lastActiveIdx > 0 ? (i / lastActiveIdx) * 0.92 : 0
          const visible = revealFrac >= threshold
          const p = linePts[i]
          if (w.isFuture) return null
          return (
            <g key={w.label} pointerEvents="none" style={{ opacity: visible ? 1 : 0, transition: 'opacity 280ms ease' }}>
              <circle className={pointClass} cx={p.x} cy={p.y} r={3.5} fill={isDark ? '#1a1030' : '#ffffff'} stroke="#7c3aed" strokeWidth={1.5} />
              <circle className={dotClass} cx={p.x} cy={p.y} r={1.3} fill="#7c3aed" />
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

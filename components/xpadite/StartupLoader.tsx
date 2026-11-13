'use client'

import { useEffect, useRef, useState } from 'react'
import { stepDisplayed, type StartupStatus } from './startupReadiness'

// ── XPadite startup loader ───────────────────────────────────────────────────────────────────────────────────────────────────────
// Layer 1 — outer ring: fills CLOCKWISE with the REAL initialisation progress (see startupReadiness.ts). The displayed value eases toward the real
//           one but never passes it, so it can not claim data has loaded that has not.
// Layer 2 — 36 fixed spikes: a bright wave travels CLOCKWISE (faster than the ring) around them, each spike lighting as the wave reaches it and fading behind it.
//           This is a CSS-only animation (compositor opacity), independent of the network: it keeps cycling if loading pauses. One lap = LAP_S.
//           The spikes never rotate as a graphic — only their brightness moves. They wear the ring's own gradient.
// Centre  — "48% / Loading…" while loading, "100% / Loaded" at the end, never the logo.
// Finish  — spikes fade, the original XPadite X (traced from the supplied logo, recoloured) + wordmark appear, zoom toward the viewer and fade,
//           and the overlay dissolves into the app.
// The overlay is see-through (the app shows behind it) but it still covers the whole screen and the app underneath is `inert`: nothing can be
// tapped, typed or saved until the data is ready.

const BRAND = '#9333EA'            // the X and the wordmark: one solid brand purple
const N = 36                       // spikes
const LAP_S = 1.15                 // one clockwise lap of the spike wave (a typical 2–4 s load = 2–3 laps)
const R_RING = 181.5, RING_W = 17  // outer ring (centre-line radius, thickness) in the 400×400 box
const CIRC = 2 * Math.PI * R_RING
const CX = 200, CY = 200
const EN_P = CIRC / 8, EN_D = 30     // energy pulses: 8 evenly spaced around the ring (the pattern repeats exactly, so the loop is seamless)
const R_IN = 133, R_OUT = 167      // spike radii

// Spike wedges: narrow at the inner end, wider outward (matches the concept image). Angle 0 = 12 o'clock, increasing clockwise.
const polar = (r: number, deg: number) => { const a = (deg - 90) * Math.PI / 180; return [CX + r * Math.cos(a), CY + r * Math.sin(a)] as const }
const SPIKES = Array.from({ length: N }, (_, i) => {
  const th = (360 / N) * i
  const p = [polar(R_IN, th - 0.58), polar(R_OUT, th - 1.5), polar(R_OUT, th + 1.5), polar(R_IN, th + 0.58)]      // ~35% thinner than v1.339
  const d = 'M' + p.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join('L') + 'Z'
  // the wave moves clockwise: spike 0 is hit first, then spike 1, 2, ... Negative delay = already part-way through the lap.
  const hit = (i / N) * LAP_S
  return { d, delay: (hit - LAP_S).toFixed(3) }
})

// ── The XPadite X: three polygons traced from the supplied PNG (silver bevel outline), in that image's pixel space ───────────────
const X_SHAPES: [number, number][][] = [
  [[141, 672], [656, 169], [311, 673]],                  // the long blade
  [[144, 377], [354, 438], [294, 497]],                  // the upper-left wedge
  [[401, 568], [457, 488], [751, 657], [520, 658]],      // the lower-right wedge
]
const toPoints = (p: [number, number][]) => p.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
const X_PATHS = X_SHAPES.map(toPoints)      // the exact traced silhouette of each part, filled with one solid colour

// the wordmark sits under the X: the PNG is 1600x220 (aspect 7.27), shown 232 units wide in the 400-unit box
const WM_W = 232, WM_H = +(232 * 220 / 1600).toFixed(2), WM_X = 200 - WM_W / 2, WM_Y = 250

type Phase = 'run' | 'loaded' | 'logo' | 'zoom'

interface Props {
  status: StartupStatus
  /** Real progress 0..1 (weighted stages that have actually completed). */
  progress: number
  /** The data is ready and every read has settled: play the completion sequence. */
  complete: boolean
  onRetry: () => void
  onDone: () => void
  /** The app is rendered behind the (see-through) overlay. Before that a solid backdrop is used so nothing white shows. */
  appVisible: boolean
}

export function StartupLoader({ status, progress, complete, onRetry, onDone, appVisible }: Props) {
  const [phase, setPhase] = useState<Phase>('run')
  const [reduced, setReduced] = useState(false)
  const arcRef = useRef<SVGCircleElement>(null)
  const arc2Ref = useRef<SVGCircleElement>(null)
  const arc3Ref = useRef<SVGCircleElement>(null)
  const headRef = useRef<SVGCircleElement>(null)
  const pctRef = useRef<SVGTextElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const shown = useRef(0)             // displayed fraction
  const lastPct = useRef(-1)
  const progressRef = useRef(progress); const completeRef = useRef(complete); const doneRef = useRef(onDone)
  useEffect(() => { progressRef.current = progress; completeRef.current = complete; doneRef.current = onDone })

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!mq) return
    const upd = () => setReduced(mq.matches); upd()
    mq.addEventListener?.('change', upd)
    return () => mq.removeEventListener?.('change', upd)
  }, [])

  // ── real-progress ring + percentage (direct DOM writes: no React re-render per frame) ──
  useEffect(() => {
    if (phase !== 'run') return
    let raf = 0, last = performance.now()
    const paint = (f: number, isComplete: boolean) => {
      const arc = arcRef.current, arc2 = arc2Ref.current, arc3 = arc3Ref.current, head = headRef.current, txt = pctRef.current
      const off = String(CIRC * (1 - f))
      if (arc) arc.style.strokeDashoffset = off
      if (arc2) arc2.style.strokeDashoffset = off
      if (arc3) arc3.style.strokeDashoffset = off
      if (head) { const [x, y] = polar(R_RING, f * 360); head.setAttribute('cx', x.toFixed(2)); head.setAttribute('cy', y.toFixed(2)); head.style.opacity = f > 0.004 && f < 0.999 ? '1' : '0' }
      const pct = isComplete && f >= 0.995 ? 100 : Math.min(99, Math.round(f * 100))     // 100% is shown only once everything really is ready
      if (txt && pct !== lastPct.current) { lastPct.current = pct; txt.textContent = pct + '%'; rootRef.current?.setAttribute('aria-valuenow', String(pct)) }
    }
    paint(shown.current, false)
    const tick = (now: number) => {
      const dt = Math.max(0, Math.min(now - last, 100)); last = now      // rAF's timestamp can precede performance.now(): never a negative step
      const isComplete = completeRef.current
      shown.current = stepDisplayed(shown.current, isComplete ? 1 : progressRef.current, dt)
      paint(shown.current, isComplete)
      if (isComplete && shown.current >= 0.9995) { setPhase('loaded'); return }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [phase])

  // ── completion sequence: 100%/Loaded → logo → zoom toward the viewer → overlay removed ──
  useEffect(() => {
    if (phase === 'run') return
    const hidden = () => document.visibilityState === 'hidden'
    const finish = () => doneRef.current()
    if (hidden()) { finish(); return }                        // backgrounded: nothing to look at, do not hold the app back
    const onVis = () => { if (hidden()) finish() }
    document.addEventListener('visibilitychange', onVis)
    const t = phase === 'loaded' ? setTimeout(() => setPhase(reduced ? 'zoom' : 'logo'), reduced ? 350 : 600)
      : phase === 'logo' ? setTimeout(() => setPhase('zoom'), 1050)
      : setTimeout(finish, reduced ? 320 : 1000)
    return () => { clearTimeout(t); document.removeEventListener('visibilitychange', onVis) }
  }, [phase, reduced])

  const failed = status === 'failed' && phase === 'run'
  const cls = ['xl-root', phase !== 'run' ? 'xl-ph-' + phase : '', phase === 'logo' || phase === 'zoom' ? 'xl-past' : '', failed ? 'xl-paused xl-failed' : '', complete && phase === 'run' ? 'xl-finishing' : ''].join(' ')
  const loading = !failed && phase === 'run'
  const label = failed ? 'Couldn’t load' : 'Loaded'

  return (
    <div ref={rootRef} className={cls} role="progressbar" aria-label="Loading XPadite" aria-valuemin={0} aria-valuemax={100} aria-valuenow={0} data-xp-startup="">
      <style>{CSS}</style>
      <div className={'xl-solid' + (appVisible ? ' xl-solid-off' : '')} />
      <div className="xl-bg" />
      <div className="xl-stage">
        <svg viewBox="0 0 400 400" className="xl-svg" aria-hidden="true" focusable="false">
          <defs>
            <linearGradient id="xl-ring" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ff4dfc" /><stop offset=".5" stopColor="#b026ff" /><stop offset="1" stopColor="#5b21d6" /></linearGradient>
            {/* the spikes wear the ring's own colours: the ring is drawn rotated -90deg, so its pink to violet diagonal runs bottom-left to top-right in screen space */}
            <linearGradient id="xl-spike" x1="18" y1="382" x2="382" y2="18" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#ff4dfc" /><stop offset=".5" stopColor="#b026ff" /><stop offset="1" stopColor="#5b21d6" /></linearGradient>
            {/* soft purple-black vignette: darkest in the middle, no edge, fully transparent at the rim */}
            <radialGradient id="xl-vig" cx={CX} cy={CY} r="236" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#0d0620" stopOpacity=".62" /><stop offset=".42" stopColor="#0d0620" stopOpacity=".5" /><stop offset=".72" stopColor="#120828" stopOpacity=".2" /><stop offset="1" stopColor="#120828" stopOpacity="0" /></radialGradient>
            {/* the energy only shows where the ring is already filled: the mask is the progress arc itself (same geometry, same dash offset) */}
            <mask id="xl-prog" maskUnits="userSpaceOnUse" x="0" y="0" width="400" height="400"><circle ref={arc3Ref} cx={CX} cy={CY} r={R_RING} fill="none" stroke="#fff" strokeWidth={RING_W} strokeLinecap="butt" strokeDasharray={CIRC} strokeDashoffset={CIRC} /></mask>
            <mask id="xl-wm-mask" maskUnits="userSpaceOnUse" x={WM_X} y={WM_Y} width={WM_W} height={WM_H}><image href="/startup/xpadite-wordmark.png" x={WM_X} y={WM_Y} width={WM_W} height={WM_H} preserveAspectRatio="xMidYMid meet" /></mask>
          </defs>

          <g className="xl-ringg">
            <circle cx={CX} cy={CY} r="236" fill="url(#xl-vig)" />
            {/* during the logo reveal only, the middle settles a little darker so the solid-purple mark stays legible over the calendar */}
            <circle className="xl-vig2" cx={CX} cy={CY} r="236" fill="url(#xl-vig)" />
            <circle cx={CX} cy={CY} r={R_RING} fill="none" stroke="#7c3aed" strokeOpacity=".22" strokeWidth={RING_W} />
            <g transform={`rotate(-90 ${CX} ${CY})`}>
              <circle ref={arcRef} cx={CX} cy={CY} r={R_RING} fill="none" stroke="url(#xl-ring)" strokeOpacity=".22" strokeWidth={RING_W + 10} strokeLinecap="round" strokeDasharray={CIRC} strokeDashoffset={CIRC} />
              <circle ref={arc2Ref} cx={CX} cy={CY} r={R_RING} fill="none" stroke="url(#xl-ring)" strokeWidth={RING_W} strokeLinecap="round" strokeDasharray={CIRC} strokeDashoffset={CIRC} />
              {/* forward-moving energy (the Journal border-draw technique: a dashed glowing stroke whose dash offset is animated): luminous pulses flow clockwise along the filled part of the ring */}
              <g mask="url(#xl-prog)" className="xl-en">
                <circle className="xl-en1" cx={CX} cy={CY} r={R_RING} fill="none" stroke="#ffe3ff" strokeOpacity=".24" strokeWidth={RING_W - 2} strokeLinecap="round" strokeDasharray={`${EN_D} ${EN_P - EN_D}`} />
                <circle className="xl-en1" cx={CX} cy={CY} r={R_RING} fill="none" stroke="#fff" strokeOpacity=".6" strokeWidth="5" strokeLinecap="round" strokeDasharray={`${EN_D * 0.55} ${EN_P - EN_D * 0.55}`} />
              </g>
            </g>
            <circle ref={headRef} cx={CX} cy={CY - R_RING} r="8.5" fill="#fff" fillOpacity=".95" style={{ opacity: 0 }} className="xl-head" />
          </g>

          <g className="xl-spikes">
            {SPIKES.map((s, i) => <path key={i} d={s.d} fill="url(#xl-spike)" stroke="url(#xl-spike)" strokeOpacity=".4" strokeWidth="2.4" strokeLinejoin="round" className="xl-sp" style={{ animationDelay: s.delay + 's' }} />)}
          </g>

          <g className="xl-txt">
            <text ref={pctRef} x={CX} y="214" textAnchor="middle" className="xl-pct">0%</text>
            <text x={CX} y="248" textAnchor="middle" className="xl-sub">
              {loading ? (<>Loading<tspan className="xl-d1">.</tspan><tspan className="xl-d2">.</tspan><tspan className="xl-d3">.</tspan></>) : label}
            </text>
          </g>

          <g className="xl-mark">
            <g transform="translate(200 152) scale(.27) translate(-446 -421)">
              {X_PATHS.map((p, i) => <polygon key={i} points={p} fill={BRAND} />)}
            </g>
            {/* the supplied wordmark PNG is used as a mask: its exact letter shapes, filled with the same solid brand purple as the X */}
            <rect className="xl-word" x={WM_X} y={WM_Y} width={WM_W} height={WM_H} fill={BRAND} mask="url(#xl-wm-mask)" />
          </g>
        </svg>

        {failed && (
          <div className="xl-err" role="alert">
            <div className="xl-err-t">We couldn&rsquo;t load your data</div>
            <div className="xl-err-s">Your saved information has not been touched. Check your connection and try again.</div>
            <button type="button" className="xl-btn" onClick={onRetry}>Retry</button>
          </div>
        )}
      </div>
    </div>
  )
}

const CSS = `
.xl-root{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;touch-action:none;overscroll-behavior:contain;-webkit-user-select:none;user-select:none;color:#f3e8ff}
.xl-solid{position:absolute;inset:0;background:radial-gradient(circle at 50% 45%,#1b0a3d 0%,#0b0622 55%,#04020f 100%);transition:opacity .5s ease}
.xl-solid-off{opacity:0}
/* see-through: the app stays recognisable behind the loader (no blur); a soft vignette keeps the loader prominent. The layer still covers the screen and takes every touch. */
.xl-bg{position:absolute;inset:0;background:radial-gradient(circle at 50% 50%,rgba(13,6,32,.2) 0%,rgba(13,6,32,.1) 45%,rgba(13,6,32,0) 100%)}
.xl-stage{position:relative;width:min(78vmin,420px);display:flex;flex-direction:column;align-items:center}
/* phones (portrait or landscape): 72.25% of the tablet/desktop size (v1.340 -15%, v1.341 a further -15%) */
@media (max-width:600px),(max-height:500px){.xl-stage{width:min(56.36vmin,303.5px)}}
.xl-svg{width:100%;height:auto;display:block;overflow:visible}
.xl-sp{opacity:.14;animation:xl-trail ${LAP_S}s linear infinite;will-change:opacity}
@keyframes xl-trail{0%{opacity:1}5%{opacity:.9}66%{opacity:.14}92%{opacity:.14}100%{opacity:1}}
.xl-paused .xl-sp{animation-play-state:paused}
.xl-spikes{transition:opacity .6s ease}
/* the spikes calm down as the load completes, so nothing competes with the logo: dimmer while the ring catches up to 100%, dimmer still on 100% / Loaded, gone for the reveal */
.xl-finishing .xl-spikes{opacity:.5}
.xl-ph-loaded .xl-spikes{opacity:.2}
.xl-en1{animation:xl-en 1.5s linear infinite}
@keyframes xl-en{from{stroke-dashoffset:0}to{stroke-dashoffset:-${EN_P}}}
.xl-en{transition:opacity .4s ease}
.xl-vig2{opacity:0;transition:opacity .5s ease}
.xl-past .xl-vig2{opacity:1}
.xl-past .xl-en,.xl-ph-loaded .xl-en{opacity:0}
.xl-paused .xl-en1{animation-play-state:paused}
.xl-pct{font:300 64px/1 "Segoe UI","Helvetica Neue",Arial,sans-serif;fill:#f5e6ff;paint-order:stroke;stroke:#b026ff;stroke-opacity:.35;stroke-width:6px;stroke-linejoin:round}
.xl-d2,.xl-d3{animation:xl-dot 1.2s step-end infinite}
.xl-d3{animation-name:xl-dot3}
@keyframes xl-dot{0%{opacity:0}33.33%{opacity:1}100%{opacity:1}}
@keyframes xl-dot3{0%{opacity:0}66.66%{opacity:1}100%{opacity:1}}
.xl-sub{font:400 23px/1 "Segoe UI","Helvetica Neue",Arial,sans-serif;fill:#e9c9ff;letter-spacing:1.6px}
.xl-head{filter:drop-shadow(0 0 6px #f0abfc)}
.xl-txt{transition:opacity .3s ease}
.xl-mark{filter:drop-shadow(0 0 7px rgba(147,51,234,.5));opacity:0;transform-origin:200px 200px}
.xl-ringg{transition:opacity .6s ease}
.xl-past .xl-spikes,.xl-past .xl-txt{opacity:0}
.xl-past .xl-mark{animation:xl-in .5s ease-out forwards}
.xl-ph-zoom .xl-mark{animation:xl-zoom .95s cubic-bezier(.45,0,.85,.45) forwards}
.xl-ph-zoom .xl-ringg{opacity:0}
.xl-ph-zoom .xl-bg{opacity:0;transition:opacity .85s ease-in .15s}
@keyframes xl-in{from{opacity:0;transform:scale(.55)}to{opacity:1;transform:scale(1)}}
/* gentler finish than v1.340 (scale 6 -> 4.3): the fade starts at once and is complete at 82% of the zoom, long before the mark gets large */
@keyframes xl-zoom{0%{opacity:1;transform:scale(1)}30%{opacity:.82}82%{opacity:0}100%{opacity:0;transform:scale(4.3)}}
@keyframes xl-fade{from{opacity:1}to{opacity:0}}
.xl-failed{overflow-y:auto}
.xl-failed .xl-stage{width:min(62vmin,380px);margin:auto}
@media (max-height:520px) and (orientation:landscape){
  .xl-failed .xl-stage{flex-direction:row;align-items:center;gap:28px;width:min(94vw,760px)}
  .xl-failed .xl-svg{width:min(66vh,250px);flex:none}
  .xl-failed .xl-err{margin-top:0;text-align:left}
}
.xl-err{margin-top:20px;text-align:center;max-width:320px}
.xl-err-t{font:600 17px/1.3 "Segoe UI",Arial,sans-serif;color:#fff}
.xl-err-s{font:400 13.5px/1.45 "Segoe UI",Arial,sans-serif;color:#d9b8ff;margin:6px 0 14px}
.xl-btn{min-height:44px;min-width:120px;padding:0 26px;border:0;border-radius:999px;background:linear-gradient(90deg,#d946ef,#7c3aed);color:#fff;font:600 16px "Segoe UI",Arial,sans-serif;cursor:pointer;box-shadow:0 0 18px rgba(176,38,255,.5)}
.xl-btn:focus-visible{outline:3px solid #f0abfc;outline-offset:3px}
@media (prefers-reduced-motion:reduce){
  .xl-sp{animation:none;opacity:.5}
  .xl-en{display:none}
  .xl-d2,.xl-d3{animation:none;opacity:1}
  .xl-ph-zoom .xl-mark{animation:xl-fade .3s ease forwards}
  .xl-past .xl-mark{animation:none;opacity:1}
  .xl-ph-zoom .xl-bg{transition-duration:.3s;transition-delay:0s}
}
`

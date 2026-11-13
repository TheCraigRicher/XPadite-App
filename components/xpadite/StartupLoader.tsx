'use client'

import { useEffect, useRef, useState } from 'react'
import { stepDisplayed, type StartupStatus } from './startupReadiness'

// ── XPadite startup loader (v1.343: horizontal progress bar) ─────────────────────────────────────────────────────────────────────
// Bar    — a rounded capsule that fills LEFT TO RIGHT with the REAL initialisation progress (see startupReadiness.ts). The displayed value eases toward
//          the real one but never passes it, so it can not claim data has loaded that has not.
// Stripes — diagonal stripes drift to the right, but only inside the part of the bar that is genuinely complete (they are clipped by the fill).
// Text   — directly under the bar: "66% Loading." -> "66% Loading.." -> "66% Loading...", and "100% Loaded" at the end.
// Finish — "100% Loaded" for a moment, then the loader fades away and the app is released. No logo, no reveal.
// The overlay has NO background at all (the app shows straight through) but it still covers the whole screen and the app underneath is `inert`:
// nothing can be tapped, typed or saved until the data is ready.

type Phase = 'run' | 'loaded' | 'fade'

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
  const fillRef = useRef<HTMLDivElement>(null)
  const pctRef = useRef<HTMLSpanElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const shown = useRef(0)             // displayed fraction
  const lastPct = useRef(-1)
  const progressRef = useRef(progress); const completeRef = useRef(complete); const doneRef = useRef(onDone)
  useEffect(() => { progressRef.current = progress; completeRef.current = complete; doneRef.current = onDone })

  // ── real-progress fill + percentage (direct DOM writes: no React re-render per frame) ──
  useEffect(() => {
    if (phase !== 'run') return
    let raf = 0, last = performance.now()
    const paint = (f: number, isComplete: boolean) => {
      const fill = fillRef.current, txt = pctRef.current
      if (fill) { fill.style.width = (f * 100).toFixed(2) + '%'; fill.style.opacity = f > 0.002 ? '1' : '0' }
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

  // ── completion sequence: 100% Loaded -> fade out -> overlay removed ──
  useEffect(() => {
    if (phase === 'run') return
    const hidden = () => document.visibilityState === 'hidden'
    const finish = () => doneRef.current()
    if (hidden()) { finish(); return }                        // backgrounded: nothing to look at, do not hold the app back
    const onVis = () => { if (hidden()) finish() }
    document.addEventListener('visibilitychange', onVis)
    const t = phase === 'loaded' ? setTimeout(() => setPhase('fade'), 450)      // "100% Loaded" for a moment ...
      : setTimeout(finish, 300)                                                  // ... then the loader fades out and the app is released
    return () => { clearTimeout(t); document.removeEventListener('visibilitychange', onVis) }
  }, [phase])

  const failed = status === 'failed' && phase === 'run'
  const cls = ['xl-root', phase !== 'run' ? 'xl-ph-' + phase : '', failed ? 'xl-paused xl-failed' : ''].join(' ')
  const loading = !failed && phase === 'run'
  const label = failed ? 'Couldn’t load' : 'Loaded'

  return (
    <div ref={rootRef} className={cls} role="progressbar" aria-label="Loading XPadite" aria-valuemin={0} aria-valuemax={100} aria-valuenow={0} data-xp-startup="">
      <style>{CSS}</style>
      <div className={'xl-solid' + (appVisible ? ' xl-solid-off' : '')} />
      <div className="xl-stage">
        <div className="xl-bar" aria-hidden="true">
          <div ref={fillRef} className="xl-fill" style={{ width: '0%', opacity: 0 }} />
        </div>

        <div className="xl-txt">
          <span ref={pctRef} className="xl-pct">0%</span>{' '}
          <span className="xl-sub">
            {loading ? (<>Loading<span className="xl-d1">.</span><span className="xl-d2">.</span><span className="xl-d3">.</span></>) : label}
          </span>
        </div>

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
.xl-stage{position:relative;width:min(62vw,240px);display:flex;flex-direction:column;align-items:center;transition:opacity .3s ease}
/* tablet / desktop: a larger bar, same proportions (phones: 220-260px) */
@media (min-width:601px) and (min-height:501px){.xl-stage{width:360px}}
.xl-ph-fade .xl-stage{opacity:0}
.xl-bar{position:relative;width:100%;aspect-ratio:11.4/1;box-sizing:border-box;border:2px solid #c026d3;border-radius:999px;background:rgba(40,14,78,.72);overflow:hidden;box-shadow:0 0 10px rgba(192,38,211,.45)}
.xl-fill{position:absolute;left:0;top:0;bottom:0;border-radius:999px;overflow:hidden;background:linear-gradient(90deg,#9333ea 0%,#c026d3 62%,#e11dff 100%)}
.xl-fill::after{content:"";position:absolute;top:0;bottom:0;left:-28px;right:0;background:repeating-linear-gradient(115deg,rgba(255,255,255,.26) 0 7px,rgba(255,255,255,0) 7px 14px);animation:xl-stripes .6s linear infinite;will-change:transform}
@keyframes xl-stripes{from{transform:translateX(0)}to{transform:translateX(28px)}}
.xl-paused .xl-fill::after{animation-play-state:paused}
.xl-txt{position:absolute;left:0;right:0;top:100%;margin-top:10px;text-align:center;white-space:nowrap;font:400 20px/1.2 "Segoe UI","Helvetica Neue",Arial,sans-serif;letter-spacing:1px;color:#C026D3}
@media (min-width:601px) and (min-height:501px){.xl-txt{font-size:26px;margin-top:12px}}
.xl-pct,.xl-sub{color:#C026D3}
.xl-d2,.xl-d3{animation:xl-dot 1.2s step-end infinite}
.xl-d3{animation-name:xl-dot3}
@keyframes xl-dot{0%{opacity:0}33.33%{opacity:1}100%{opacity:1}}
@keyframes xl-dot3{0%{opacity:0}66.66%{opacity:1}100%{opacity:1}}
.xl-failed{overflow-y:auto}
.xl-failed .xl-stage{margin:auto}
.xl-failed .xl-txt{position:static;margin-top:10px}
.xl-err{margin-top:20px;text-align:center;max-width:320px}
.xl-err-t{font:600 17px/1.3 "Segoe UI",Arial,sans-serif;color:#fff}
.xl-err-s{font:400 13.5px/1.45 "Segoe UI",Arial,sans-serif;color:#d9b8ff;margin:6px 0 14px}
.xl-btn{min-height:44px;min-width:120px;padding:0 26px;border:0;border-radius:999px;background:linear-gradient(90deg,#d946ef,#7c3aed);color:#fff;font:600 16px "Segoe UI",Arial,sans-serif;cursor:pointer;box-shadow:0 0 18px rgba(176,38,255,.5)}
.xl-btn:focus-visible{outline:3px solid #f0abfc;outline-offset:3px}
@media (prefers-reduced-motion:reduce){
  .xl-fill::after{animation:none}
  .xl-d2,.xl-d3{animation:none;opacity:1}
}
`

'use client'

// v1.359 — the Read Aloud playback bar: a compact floating pill that sits just above the editor toolbar (so it never covers an editor control), stays in view while the
// Planner scrolls, and disappears when playback ends or is stopped. It only shows state and calls the callbacks it is given — it never reads or changes a document.
import { RATES } from './readAloud'
import type { ReadState } from './readAloudEngine'

const PAUSE_NOTE: Record<string, string> = {
  user: 'Paused',
  hidden: 'Paused when you left this tab — press Resume',
  interrupted: 'Interrupted by the browser — press Resume',
  blocked: 'The browser needs a tap — press Resume',
}

interface Props { state: ReadState; onPause: () => void; onResume: () => void; onStop: () => void; onRate: (r: number) => void }

export function ReadAloudController({ state, onPause, onResume, onStop, onRate }: Props) {
  if (state.status === 'idle') return null
  const playing = state.status === 'playing'
  const what = state.mode === 'all' ? `Reading all sections · ${state.sectionIndex + 1} of ${state.sectionCount}` : 'Reading this section'
  const sub = !playing ? (PAUSE_NOTE[state.pausedBy ?? 'user'] ?? 'Paused') : state.title
  const round = { width: 38, height: 38, borderRadius: 19, border: 'none', cursor: 'pointer', fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 } as const
  return (
    <div style={{ position: 'relative', height: 0, flexShrink: 0, zIndex: 50, pointerEvents: 'none' }}>
      <div data-testid="read-aloud-bar" role="region" aria-label="Read Aloud"
        style={{
          position: 'absolute', left: '50%', transform: 'translateX(-50%)', bottom: 8, width: 'min(460px, calc(100% - 16px))', boxSizing: 'border-box',
          display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px 6px 6px', borderRadius: 26, pointerEvents: 'auto',
          background: '#1e1130', border: '1px solid rgba(167,139,250,0.55)', boxShadow: '0 8px 26px rgba(0,0,0,0.45)', color: '#f1f5f9',
        }}>
        <button type="button" data-testid="read-aloud-toggle" aria-label={playing ? 'Pause reading' : 'Resume reading'} title={playing ? 'Pause' : 'Resume'}
          onClick={playing ? onPause : onResume} style={{ ...round, background: '#7c3aed', color: '#fff' }}>{playing ? '❚❚' : '▶'}</button>
        <div style={{ flex: 1, minWidth: 0, lineHeight: 1.25 }} aria-live="polite">
          <div data-testid="read-aloud-label" style={{ fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>🔊 {what}</div>
          <div data-testid="read-aloud-sub" style={{ fontSize: 11, opacity: 0.72, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minHeight: 14 }}>{sub}</div>
        </div>
        <select data-testid="read-aloud-speed" aria-label="Reading speed" value={String(state.rate)} onChange={e => onRate(Number(e.target.value))}
          style={{ height: 32, borderRadius: 16, border: '1px solid rgba(167,139,250,0.45)', background: 'rgba(255,255,255,0.08)', color: '#f1f5f9', fontSize: 12, fontWeight: 600, padding: '0 6px', flexShrink: 0, cursor: 'pointer' }}>
          {RATES.map(r => <option key={r} value={String(r)} style={{ color: '#111' }}>{r}×</option>)}
        </select>
        <button type="button" data-testid="read-aloud-stop" aria-label="Stop reading" title="Stop" onClick={onStop} style={{ ...round, background: 'rgba(255,255,255,0.12)', color: '#fff', fontSize: 13 }}>■</button>
      </div>
    </div>
  )
}

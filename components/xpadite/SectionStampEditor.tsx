'use client'

// v1.349 — the compact date + time editor for a section's bottom-right stamp. It only ever returns a NEW display value (or "use the original"); the
// section's immutable creation time is never passed in for modification. Anchored popover on tablets/desktops, centred modal on phones.
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useEscapeLayer } from './escapeLayers'

const pad2 = (n: number) => String(n).padStart(2, '0')

export function splitStamp(ts: number): { date: string; hour12: number; minute: number; pm: boolean } {
  const d = new Date(ts)
  const h = d.getHours()
  return { date: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`, hour12: h % 12 === 0 ? 12 : h % 12, minute: d.getMinutes(), pm: h >= 12 }
}

/** Local date + 12-hour time -> epoch ms in the user's own time zone; null when the date is not a real date. */
export function joinStamp(date: string, hour12: number, minute: number, pm: boolean): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m || !(hour12 >= 1 && hour12 <= 12) || !(minute >= 0 && minute <= 59)) return null
  const y = +m[1], mo = +m[2], d = +m[3]
  const h24 = (hour12 % 12) + (pm ? 12 : 0)
  const dt = new Date(y, mo - 1, d, h24, minute, 0, 0)
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null
  return dt.getTime()
}

export function SectionStampEditor({ isDark, initialTs, anchor, canReset, onSave, onReset, onCancel }: {
  isDark: boolean; initialTs: number; anchor: DOMRect | null; canReset: boolean
  onSave: (ts: number) => void; onReset: () => void; onCancel: () => void
}) {
  const init = useMemo(() => splitStamp(initialTs), [initialTs])
  const [date, setDate] = useState(init.date)
  const [hour, setHour] = useState(String(init.hour12))
  const [minute, setMinute] = useState(pad2(init.minute))
  const [pm, setPm] = useState(init.pm)
  const first = useRef<HTMLInputElement>(null)
  const openedAt = useRef(0)
  useEscapeLayer(true, () => onCancel())
  useEffect(() => { openedAt.current = Date.now(); first.current?.focus() }, [])

  const ts = joinStamp(date, Number(hour), Number(minute), pm)
  const wide = typeof window !== 'undefined' && window.innerWidth >= 640 && !!anchor
  const field: React.CSSProperties = {
    width: '100%', minWidth: 0, height: 34, borderRadius: 8, border: '0.5px solid rgba(124,58,237,0.45)', padding: '0 8px', fontSize: 13, boxSizing: 'border-box',
    background: isDark ? 'rgba(255,255,255,0.06)' : '#faf8ff', color: isDark ? '#f1f5f9' : '#0f172a', colorScheme: isDark ? 'dark' : 'light',
  }
  const btn = (primary: boolean): React.CSSProperties => ({
    minHeight: 36, padding: '0 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
    border: primary ? 'none' : `0.5px solid ${isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.16)'}`,
    background: primary ? 'rgba(124,58,237,0.95)' : 'transparent', color: primary ? '#fff' : (isDark ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.7)'),
    opacity: primary && ts === null ? 0.45 : 1,
  })
  const panelPos: React.CSSProperties = wide && anchor
    ? (anchor.top > 260
      ? { position: 'fixed', right: Math.max(8, window.innerWidth - anchor.right), bottom: window.innerHeight - anchor.top + 8 }
      : { position: 'fixed', right: Math.max(8, window.innerWidth - anchor.right), top: anchor.bottom + 8 })
    : {}
  const submit = () => { if (ts !== null) onSave(ts) }

  return createPortal(
    // the emulated mouse events that follow the double-tap that opened this must not count as an outside click (they land on the backdrop)
    <div onMouseDown={e => { if (e.target === e.currentTarget && Date.now() - openedAt.current > 600) onCancel() }} onClick={e => e.stopPropagation()} onTouchEnd={e => e.stopPropagation()}
      style={{ position: 'fixed', inset: 0, zIndex: 100000, background: wide ? 'transparent' : 'rgba(0,0,0,0.55)', display: wide ? 'block' : 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div role="dialog" aria-modal="true" aria-label="Edit section date and time" data-testid="stamp-editor"
        onKeyDown={e => { if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'BUTTON') { e.preventDefault(); submit() } }}
        style={{ ...panelPos, width: wide ? 300 : '100%', maxWidth: 320, boxSizing: 'border-box', padding: 14, borderRadius: 14, display: 'flex', flexDirection: 'column', gap: 10,
          background: isDark ? '#1e1b2e' : '#ffffff', color: isDark ? '#f1f5f9' : '#0f172a', border: '1px solid rgba(124,58,237,0.35)', boxShadow: '0 12px 40px rgba(0,0,0,0.4)' }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>Section date &amp; time</div>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, opacity: 0.8 }}>Date
          <input ref={first} data-testid="stamp-date" type="date" value={date} onChange={e => setDate(e.target.value)} style={field} />
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr 1fr', gap: 8, alignItems: 'end' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, opacity: 0.8, minWidth: 0 }}>Hour
            <select data-testid="stamp-hour" value={hour} onChange={e => setHour(e.target.value)} style={field}>
              {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={String(i + 1)}>{i + 1}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, opacity: 0.8, minWidth: 0 }}>Minute
            <input data-testid="stamp-minute" inputMode="numeric" maxLength={2} value={minute} onChange={e => setMinute(e.target.value.replace(/\D/g, '').slice(0, 2))}
              onBlur={() => { const n = Number(minute); if (minute !== '' && n >= 0 && n <= 59) setMinute(pad2(n)) }} style={field} aria-label="Minute" />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, opacity: 0.8, minWidth: 0 }}>AM / PM
            <select data-testid="stamp-ampm" value={pm ? 'pm' : 'am'} onChange={e => setPm(e.target.value === 'pm')} style={field}>
              <option value="am">AM</option><option value="pm">PM</option>
            </select>
          </label>
        </div>
        {ts === null && <div role="alert" style={{ fontSize: 11, color: '#f87171' }}>Enter a valid date and time.</div>}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {canReset && <button type="button" data-testid="stamp-reset" onClick={onReset} style={{ ...btn(false), border: 'none', padding: '0 4px', textDecoration: 'underline', fontWeight: 500, fontSize: 12 }}>Use original</button>}
          <span style={{ flex: 1 }} />
          <button type="button" data-testid="stamp-cancel" onClick={onCancel} style={btn(false)}>Cancel</button>
          <button type="button" data-testid="stamp-save" onClick={submit} disabled={ts === null} style={btn(true)}>Save</button>
        </div>
      </div>
    </div>, document.body)
}

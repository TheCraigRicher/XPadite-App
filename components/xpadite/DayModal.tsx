'use client'

import { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useApp, EMPTY_DAY } from './AppContext'
import type { Task, TaskSession, Activity, TaskAttachment, DayData } from './types'
import { formatMs, formatHMS, formatTime, formatTime12, isProductiveActivity, APP_YEAR, todayKey } from './utils'
import { ReminderModal } from './ReminderModal'
import { TransferTaskModal } from './TransferTaskModal'
import { buildAttachments, removeAttachmentById, ATTACHMENT_ACCEPT, AttachmentItem, ImageLightbox, CameraModal } from './attachmentUtils'
import { useLockBodyScroll } from './useLockBodyScroll'
import dynamic from 'next/dynamic'
import { Theme } from 'emoji-picker-react'
import type { EmojiClickData } from 'emoji-picker-react'

const JournalEditorEmbed = dynamic(
  () => import('./JournalEditorEmbed').then(m => ({ default: m.JournalEditorEmbed })),
  { ssr: false }
)

const EmojiPickerLib = dynamic(() => import('emoji-picker-react'), { ssr: false })

// ─── Task helpers ─────────────────────────────────────────────────────────────

function deduplicateTaskSessions(sessions: TaskSession[]): TaskSession[] {
  const completed = sessions.filter(s => s.endTs !== null)
  const running   = sessions.filter(s => s.endTs === null)
  if (completed.length <= 1) return sessions
  // Sort by startTs, then merge overlapping/adjacent intervals so no time is double-counted
  const sorted = [...completed].sort((a, b) => a.startTs - b.startTs)
  const merged: TaskSession[] = [{ ...sorted[0] }]
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1]
    const curr = sorted[i]
    if (curr.startTs <= last.endTs!) {
      merged[merged.length - 1] = { ...last, endTs: Math.max(last.endTs!, curr.endTs!) }
    } else {
      merged.push({ ...curr })
    }
  }
  return [...merged, ...running]
}

function getTaskTotalMs(task: Task, isActive: boolean, now: number): number {
  const sessions = task.sessions ?? []
  const completedMs = sessions
    .filter(s => s.endTs !== null)
    .reduce((acc, s) => acc + (s.endTs! - s.startTs), 0)
  const runningMs = isActive
    ? sessions.filter(s => s.endTs === null).reduce((acc, s) => acc + (now - s.startTs), 0)
    : 0
  const total = completedMs + runningMs
  // Only fall back to legacy timerStart/timerEnd when no sessions exist at all
  if (sessions.length === 0 && task.timerStart) {
    const end = task.timerEnd ?? (isActive ? now : null)
    if (end) return end - task.timerStart
  }
  return total
}

function getRunningSession(task: Task): TaskSession | null {
  return (task.sessions ?? []).find(s => s.endTs === null) ?? null
}

// ─── Confetti ─────────────────────────────────────────────────────────────────

function ConfettiPop({ onDone }: { onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 1500); return () => clearTimeout(t) }, [onDone])
  const COLORS = ['#f97316','#7c3aed','#22d3ee','#4ade80','#fbbf24','#f472b6','#a78bfa','#34d399','#fb7185','#60a5fa']
  const particles = Array.from({ length: 18 }, (_, i) => {
    const angle = (i / 18) * 360 + (Math.random() * 20 - 10)
    const dist  = 55 + Math.random() * 60
    const rad   = (angle * Math.PI) / 180
    return { color: COLORS[i % COLORS.length], tx: Math.cos(rad) * dist, ty: Math.sin(rad) * dist - 20, rot: Math.random() * 540 - 270, size: 4 + Math.random() * 5, delay: Math.random() * 0.15, isRect: i % 3 !== 0 }
  })
  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {particles.map((p, i) => (
        <div key={i} style={{ position: 'absolute', width: p.size, height: p.isRect ? p.size * 2.2 : p.size, borderRadius: p.isRect ? 2 : '50%', background: p.color, ['--tx' as string]: `${p.tx}px`, ['--ty' as string]: `${p.ty}px`, ['--rot' as string]: `${p.rot}deg`, animation: `xp-confetti 1.3s ${p.delay}s cubic-bezier(0.2,0.8,0.4,1) forwards` } as React.CSSProperties} />
      ))}
    </div>
  )
}

// ─── Icons ────────────────────────────────────────────────────────────────────

const PlayIcon = () => <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5"><polygon points="5 3 19 12 5 21 5 3" /></svg>
const StopIcon = () => <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5"><rect x="4" y="4" width="16" height="16" rx="2" /></svg>
const DotsIcon = () => <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>

const GENERATED_TASKS = [
  'Complete morning planning and set daily priorities',
  'Focus on primary work goal for 2+ hours uninterrupted',
  'Review progress and document key learnings',
]

// ─── Task clipboard type (persisted in localStorage) ─────────────────────────

interface ClipboardTask {
  text: string
  actId: string
  journal: string
  taskColor?: string
  isPriority?: boolean
  children: { text: string; actId: string; journal: string; taskColor?: string; isPriority?: boolean }[]
}

// ─── Compact XPadite time-picker dropdown — NO native <select>, NO browser UI ──
// Uses only React state + <button>/<div> elements. Touch and mouse safe.

const ADJUST_HOURS   = Array.from({ length: 12 }, (_, i) => String(i + 1))
const ADJUST_MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'))
const ADJUST_AMPM    = ['AM', 'PM']

// Fully controlled: parent owns open state so only one dropdown is open at a time.
function CompactDropdown({ value, options, onChange, isDark, width, ariaLabel, isOpen, onOpenChange }: {
  value: string
  options: string[]
  onChange: (v: string) => void
  isDark: boolean
  width?: number
  ariaLabel?: string
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [openUp, setOpenUp] = useState(false)
  const [focusedIdx, setFocusedIdx] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)
  const listRef      = useRef<HTMLDivElement>(null)
  const triggerRef   = useRef<HTMLButtonElement>(null)

  // Close on outside pointer-down (works on both touch and mouse)
  useEffect(() => {
    if (!isOpen) return
    function onOutside(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onOpenChange(false)
        setFocusedIdx(-1)
      }
    }
    // rAF so the trigger's own pointerdown doesn't immediately re-close
    const raf = requestAnimationFrame(() => document.addEventListener('pointerdown', onOutside))
    return () => { cancelAnimationFrame(raf); document.removeEventListener('pointerdown', onOutside) }
  }, [isOpen, onOpenChange])

  // Scroll selected option into view when opening
  useEffect(() => {
    if (!isOpen || !listRef.current) return
    const sel = listRef.current.querySelector('[data-sel="true"]') as HTMLElement | null
    if (sel) sel.scrollIntoView({ block: 'nearest' })
  }, [isOpen])

  // Reset keyboard focus when closed
  useEffect(() => { if (!isOpen) setFocusedIdx(-1) }, [isOpen])

  function handleTriggerClick(e: React.MouseEvent | React.TouchEvent) {
    e.stopPropagation()
    if (!isOpen && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect()
      setOpenUp(window.innerHeight - rect.bottom < 230)
    }
    onOpenChange(!isOpen)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!isOpen) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault()
        onOpenChange(true)
        setFocusedIdx(options.indexOf(value))
      }
      return
    }
    if (e.key === 'Escape') { e.preventDefault(); onOpenChange(false); setFocusedIdx(-1); triggerRef.current?.focus() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setFocusedIdx(i => Math.min(i + 1, options.length - 1)) }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); setFocusedIdx(i => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter' && focusedIdx >= 0) {
      e.preventDefault(); onChange(options[focusedIdx]); onOpenChange(false); setFocusedIdx(-1); triggerRef.current?.focus()
    }
  }

  // Prevent the list's own scroll from propagating to the page on touch
  function handleListTouchMove(e: React.TouchEvent) { e.stopPropagation() }

  const panelStyle: React.CSSProperties = {
    position:   'absolute',
    left:       0,
    zIndex:     9999,
    minWidth:   '100%',
    maxHeight:  options.length <= 2 ? 'none' : 190,
    overflowY:  options.length <= 2 ? 'visible' : 'auto',
    borderRadius: 10,
    background: isDark ? '#1e1635' : '#ffffff',
    border:     `1px solid ${isDark ? 'rgba(124,58,237,0.35)' : 'rgba(124,58,237,0.22)'}`,
    boxShadow:  isDark
      ? '0 16px 48px rgba(0,0,0,0.60), 0 4px 16px rgba(0,0,0,0.30)'
      : '0 12px 36px rgba(0,0,0,0.18), 0 4px 12px rgba(0,0,0,0.08)',
    overscrollBehavior: 'contain',
    WebkitOverflowScrolling: 'touch',
    animation: 'xp-act-drop-in 140ms cubic-bezier(0.16,1,0.3,1) forwards',
  } as React.CSSProperties
  panelStyle[openUp ? 'bottom' : 'top'] = 'calc(100% + 5px)'

  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', width: width ?? 64, flexShrink: 0 }}
      onKeyDown={handleKeyDown}
    >
      {/* Trigger — pure <button>, never a <select> */}
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={ariaLabel}
        onClick={handleTriggerClick}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '7px 8px', borderRadius: 8, cursor: 'pointer', outline: 'none',
          border: `1px solid ${isOpen ? '#7c3aed' : 'var(--xp-bdr2)'}`,
          background: isOpen ? (isDark ? 'rgba(124,58,237,0.10)' : 'rgba(124,58,237,0.05)') : 'var(--xp-bg3)',
          color: 'var(--xp-txt)', fontSize: 12, fontWeight: 500,
          transition: 'border-color 130ms ease, background 130ms ease',
          WebkitTapHighlightColor: 'transparent',
          userSelect: 'none',
        }}
      >
        <span style={{ flex: 1, textAlign: 'center', lineHeight: 1.2 }}>{value}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
          style={{ width: 10, height: 10, flexShrink: 0, opacity: 0.45,
            transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 140ms ease' }}>
          <polyline points="6 9 12 15 18 9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* Dropdown panel — React-rendered, never a browser-native overlay */}
      {isOpen && (
        <div
          ref={listRef}
          role="listbox"
          aria-label={ariaLabel}
          style={panelStyle}
          onTouchMove={handleListTouchMove}
        >
          {options.map((opt, i) => {
            const isSelected = opt === value
            const isFocused  = focusedIdx === i
            return (
              <button
                key={opt}
                type="button"
                role="option"
                aria-selected={isSelected}
                data-sel={isSelected ? 'true' : 'false'}
                onClick={e => {
                  e.stopPropagation()
                  onChange(opt)
                  onOpenChange(false)
                  setFocusedIdx(-1)
                }}
                onMouseEnter={() => setFocusedIdx(i)}
                onMouseLeave={() => setFocusedIdx(-1)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '10px 12px', cursor: 'pointer', border: 'none', outline: 'none',
                  fontSize: 12, fontWeight: isSelected ? 600 : 400,
                  background: isSelected
                    ? 'rgba(124,58,237,0.12)'
                    : isFocused
                    ? (isDark ? 'rgba(255,255,255,0.06)' : 'rgba(124,58,237,0.06)')
                    : 'transparent',
                  color: isSelected ? '#7c3aed' : isDark ? 'rgba(255,255,255,0.88)' : '#111827',
                  WebkitTapHighlightColor: 'transparent',
                  userSelect: 'none',
                  touchAction: 'manipulation',
                }}
              >
                <span style={{ width: 11, flexShrink: 0 }} />
                <span style={{ flex: 1, textAlign: 'center' }}>{opt}</span>
                {isSelected ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="2.5"
                    style={{ width: 11, height: 11, flexShrink: 0 }}>
                    <polyline points="20 6 9 17 4 12" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  <span style={{ width: 11, flexShrink: 0 }} />
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── TimeRow — module-level so React never remounts CompactDropdown on state change ──

function TimeRow({ label, h, m, ap, onH, onM, onAP, isDark, activePicker, setActivePicker, prefix,
  manualMode, rawH, rawM, onRawH, onRawM, hInvalid, mInvalid }: {
  label: string; h: string; m: string; ap: string
  onH: (v: string) => void; onM: (v: string) => void; onAP: (v: string) => void
  isDark: boolean
  activePicker: string | null
  setActivePicker: (key: string | null) => void
  prefix: string
  manualMode?: boolean
  rawH?: string; rawM?: string
  onRawH?: (v: string) => void; onRawM?: (v: string) => void
  hInvalid?: boolean; mInvalid?: boolean
}) {
  const inputBase: React.CSSProperties = {
    borderRadius: 8, textAlign: 'center', fontSize: 12, fontWeight: 500,
    background: 'var(--xp-bg3)', color: 'var(--xp-txt)', outline: 'none',
    padding: '7px 8px', WebkitAppearance: 'none', MozAppearance: 'textfield',
  }
  return (
    <div style={{ display: 'flex', justifyContent: 'center' }}>
      <div>
      <label style={{ display: 'block', fontSize: 10, fontWeight: 500, marginBottom: 5, color: 'var(--xp-txt3)' }}>{label}</label>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {manualMode ? (
          <input type="text" inputMode="numeric" value={rawH ?? h} onChange={e => onRawH?.(e.target.value)}
            placeholder="00" maxLength={2}
            style={{ ...inputBase, width: 56, border: `1px solid ${hInvalid ? '#ef4444' : 'var(--xp-bdr2)'}` }} />
        ) : (
          <CompactDropdown value={h} options={ADJUST_HOURS} onChange={onH} isDark={isDark} width={56}
            isOpen={activePicker === `${prefix}H`} onOpenChange={o => setActivePicker(o ? `${prefix}H` : null)} />
        )}
        <span style={{ color: 'var(--xp-txt3)', fontSize: 13, fontWeight: 600, flexShrink: 0 }}>:</span>
        {manualMode ? (
          <input type="text" inputMode="numeric" value={rawM ?? m} onChange={e => onRawM?.(e.target.value)}
            placeholder="00" maxLength={2}
            style={{ ...inputBase, width: 62, border: `1px solid ${mInvalid ? '#ef4444' : 'var(--xp-bdr2)'}` }} />
        ) : (
          <CompactDropdown value={m} options={ADJUST_MINUTES} onChange={onM} isDark={isDark} width={62}
            isOpen={activePicker === `${prefix}M`} onOpenChange={o => setActivePicker(o ? `${prefix}M` : null)} />
        )}
        <CompactDropdown value={ap} options={ADJUST_AMPM} onChange={onAP} isDark={isDark} width={60}
          isOpen={activePicker === `${prefix}AP`} onOpenChange={o => setActivePicker(o ? `${prefix}AP` : null)} />
      </div>
      </div>
    </div>
  )
}

// ─── Adjust Time Modal ────────────────────────────────────────────────────────

interface AdjustTimeProps {
  task: Task
  dateKey: string
  onClose: () => void
  onSave: (sessionId: string | null, startTs: number, endTs: number, note: string) => void
}

function AdjustTimeModal({ task, dateKey, onClose, onSave }: AdjustTimeProps) {
  const { isDark } = useApp()
  const runningSession = getRunningSession(task)
  const lastSession    = task.sessions?.findLast?.(s => s.endTs !== null) ?? null
  const editingSession = runningSession ?? lastSession

  function tsToH12(ts: number | null): { h: string; m: string; ap: string } {
    if (!ts) return { h: '', m: '', ap: 'AM' }
    const d     = new Date(ts)
    const hours = d.getHours()
    const mins  = d.getMinutes()
    const h12   = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours
    return { h: String(h12), m: String(mins).padStart(2, '0'), ap: hours < 12 ? 'AM' : 'PM' }
  }
  function h12ToTs(h: string, m: string, ap: string, baseTs: number): number {
    let hours = Number(h)
    if (ap === 'AM') { if (hours === 12) hours = 0 }
    else             { if (hours !== 12) hours += 12 }
    const d = new Date(baseTs); d.setHours(hours, Number(m), 0, 0); return d.getTime()
  }

  const baseTs    = editingSession?.startTs ?? task.timerStart ?? (() => {
    const [y, mo, d] = dateKey.split('-').map(Number); return new Date(y, mo, d).getTime()
  })()
  const sessionId = editingSession?.id ?? null

  const startInit = tsToH12(editingSession?.startTs ?? null)
  const endInit   = tsToH12(editingSession?.endTs != null ? editingSession.endTs : (runningSession ? Date.now() : null))

  const [startH,  setStartH]  = useState(startInit.h)
  const [startM,  setStartM]  = useState(startInit.m)
  const [startAP, setStartAP] = useState(startInit.ap)
  const [endH,    setEndH]    = useState(endInit.h)
  const [endM,    setEndM]    = useState(endInit.m)
  const [endAP,   setEndAP]   = useState(endInit.ap)
  const [noteVal, setNoteVal] = useState('')
  const [activePicker, setActivePicker] = useState<string | null>(null)

  function validH(v: string) { const n = parseInt(v, 10); return v.trim() !== '' && !isNaN(n) && n >= 1 && n <= 12 }
  function validM(v: string) { const n = parseInt(v, 10); return v.trim() !== '' && !isNaN(n) && n >= 0 && n <= 59 }

  const isValid    = validH(startH) && validM(startM) && validH(endH) && validM(endM)
  const startTs    = isValid ? h12ToTs(startH, startM, startAP, baseTs) : 0
  let   endTs      = isValid ? h12ToTs(endH, endM, endAP, baseTs) : 0
  if (isValid && endTs <= startTs) endTs += 86_400_000
  const durationMs = isValid ? Math.max(0, endTs - startTs) : 0

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.65)' }} onClick={onClose}>
      <div className="w-full max-w-[340px] rounded-2xl shadow-2xl" style={{ background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)' }} onClick={e => e.stopPropagation()}>

        {/* Purple header */}
        <div style={{ background: 'linear-gradient(135deg,#7c3aed 0%,#5b21b6 100%)', borderRadius: '16px 16px 0 0', padding: '18px 20px 16px', textAlign: 'center', boxShadow: '0 2px 10px rgba(124,58,237,0.25)' }}>
          <p style={{ color: 'white', fontSize: 14, fontWeight: 700, lineHeight: 1.2, marginBottom: 4 }}>Adjust Time Session</p>
          {task.text ? (
            <p style={{ color: 'rgba(255,255,255,0.70)', fontSize: 11, lineHeight: 1.35, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>{task.text}</p>
          ) : null}
        </div>

        {/* Body */}
        <div style={{ padding: '18px 20px 16px' }}>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 16 }}>
            <TimeRow
              label="Start Time" h={startH} m={startM} ap={startAP}
              onH={setStartH} onM={setStartM} onAP={setStartAP}
              isDark={isDark} activePicker={activePicker} setActivePicker={setActivePicker} prefix="start"
              manualMode={true} rawH={startH} rawM={startM}
              onRawH={setStartH} onRawM={setStartM}
              hInvalid={startH !== '' && !validH(startH)} mInvalid={startM !== '' && !validM(startM)}
            />
            <TimeRow
              label="End Time" h={endH} m={endM} ap={endAP}
              onH={setEndH} onM={setEndM} onAP={setEndAP}
              isDark={isDark} activePicker={activePicker} setActivePicker={setActivePicker} prefix="end"
              manualMode={true} rawH={endH} rawM={endM}
              onRawH={setEndH} onRawM={setEndM}
              hInvalid={endH !== '' && !validH(endH)} mInvalid={endM !== '' && !validM(endM)}
            />
          </div>

          {/* Total Duration card */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 14px', borderRadius: 10, marginBottom: 14, background: isDark ? 'rgba(124,58,237,0.08)' : 'rgba(124,58,237,0.05)', border: `1px solid ${isDark ? 'rgba(124,58,237,0.20)' : 'rgba(124,58,237,0.14)'}` }}>
            <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--xp-txt3)', display: 'flex', alignItems: 'center', gap: 5 }}>
              <span>⏱</span> Total Duration
            </span>
            <span style={{ fontSize: 13, fontWeight: 700, color: isValid && durationMs > 0 ? '#7c3aed' : 'var(--xp-txt3)' }}>
              {isValid && durationMs > 0 ? formatMs(durationMs) : '00h 00m'}
            </span>
          </div>

          {/* Reason */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 10, fontWeight: 500, marginBottom: 5, color: 'var(--xp-txt3)' }}>Reason (optional)</label>
            <input type="text" value={noteVal} onChange={e => setNoteVal(e.target.value)}
              placeholder="Why are you adjusting this time?"
              className="w-full text-xs px-3 py-2 rounded-lg outline-none"
              style={{ border: '1px solid var(--xp-bdr2)', background: 'var(--xp-bg3)', color: 'var(--xp-txt)' }} />
          </div>

          {/* Actions */}
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={onClose} className="text-xs px-4 py-1.5 rounded-lg border transition-colors hover:bg-black/5" style={{ borderColor: 'var(--xp-bdr2)', color: 'var(--xp-txt2)' }}>Cancel</button>
            <button type="button" disabled={!isValid} onClick={() => { onSave(sessionId, startTs, endTs, noteVal); onClose() }}
              className="text-xs px-5 py-1.5 rounded-full text-white"
              style={{ background: isValid ? '#7c3aed' : 'rgba(124,58,237,0.38)', cursor: isValid ? 'pointer' : 'not-allowed', transition: 'opacity 150ms ease' }}>
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Task color system ────────────────────────────────────────────────────────

const TASK_COLOR_CONFIG: Record<string, { label: string; hex: string; tintL: string; tintD: string }> = {
  default: { label: 'Default', hex: '',        tintL: '',                        tintD: '' },
  lime:    { label: 'Lime',    hex: '#c6ff3e', tintL: 'rgba(198,255,62,0.14)',  tintD: 'rgba(198,255,62,0.19)' },
  orange:  { label: 'Gold',    hex: '#d97706', tintL: 'rgba(217,119,6,0.09)',   tintD: 'rgba(217,119,6,0.14)' },
  yellow:  { label: 'Yellow',  hex: '#eab308', tintL: 'rgba(234,179,8,0.11)',   tintD: 'rgba(234,179,8,0.16)' },
  green:   { label: 'Green',   hex: '#22c55e', tintL: 'rgba(34,197,94,0.08)',   tintD: 'rgba(34,197,94,0.13)' },
  teal:    { label: 'Teal',    hex: '#14b8a6', tintL: 'rgba(20,184,166,0.08)',  tintD: 'rgba(20,184,166,0.13)' },
  blue:    { label: 'Blue',    hex: '#3b82f6', tintL: 'rgba(59,130,246,0.08)',  tintD: 'rgba(59,130,246,0.13)' },
  purple:  { label: 'Purple',  hex: '#7c3aed', tintL: 'rgba(124,58,237,0.08)', tintD: 'rgba(124,58,237,0.13)' },
  pink:    { label: 'Pink',    hex: '#ec4899', tintL: 'rgba(236,72,153,0.08)', tintD: 'rgba(236,72,153,0.13)' },
}
const PRIORITY_TINT = { L: 'rgba(239,68,68,0.09)', D: 'rgba(239,68,68,0.14)' }

function ColorPickerPopover({ currentColor, isDark, onSelect, onClose }: {
  currentColor: string; isDark: boolean; onSelect: (color: string) => void; onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function onOut(e: PointerEvent) { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    const raf = requestAnimationFrame(() => document.addEventListener('pointerdown', onOut))
    return () => { cancelAnimationFrame(raf); document.removeEventListener('pointerdown', onOut) }
  }, [onClose])

  return (
    <div ref={ref} style={{
      position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 9997,
      background: isDark ? '#1e1635' : '#fff',
      border: `1px solid ${isDark ? 'rgba(124,58,237,0.3)' : 'rgba(124,58,237,0.18)'}`,
      borderRadius: 14, padding: '10px 12px', minWidth: 172,
      boxShadow: isDark ? '0 12px 40px rgba(0,0,0,0.55)' : '0 8px 28px rgba(0,0,0,0.14)',
    }}>
      <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--xp-txt3)', marginBottom: 8 }}>Task Color</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6 }}>
        {Object.entries(TASK_COLOR_CONFIG).map(([key, cfg]) => (
          <button key={key} type="button" onClick={() => { onSelect(key); onClose() }} style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
            padding: '6px 4px', borderRadius: 9, border: `1.5px solid ${currentColor === key ? '#7c3aed' : (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.09)')}`,
            background: currentColor === key ? (isDark ? 'rgba(124,58,237,0.15)' : 'rgba(124,58,237,0.06)') : 'transparent',
            cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
          }}>
            <div style={{
              width: 16, height: 16, borderRadius: '50%',
              background: cfg.hex || (isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)'),
              border: key === 'default' ? `1.5px dashed ${isDark ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.22)'}` : 'none',
            }} />
            <span style={{ fontSize: 9, color: 'var(--xp-txt3)', fontWeight: currentColor === key ? 600 : 400 }}>{cfg.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── Tasks batch-action dropdown ──────────────────────────────────────────────

function TasksDropdown({ onGenerate, onReorder, onDelete, isDark }: {
  onGenerate: () => void; onReorder: () => void; onDelete: () => void; isDark: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    function onOut(e: PointerEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const raf = requestAnimationFrame(() => document.addEventListener('pointerdown', onOut))
    return () => { cancelAnimationFrame(raf); document.removeEventListener('pointerdown', onOut) }
  }, [open])

  const items: { icon: string; label: string; action: () => void; iconStyle?: React.CSSProperties }[] = [
    { icon: '✨', label: 'Generate 3 Tasks', action: onGenerate },
    { icon: '↕',  label: 'Reorder Tasks',    action: onReorder, iconStyle: { fontSize: 17, fontWeight: 700 } },
    { icon: '🗑',  label: 'Delete Tasks',     action: onDelete  },
  ]
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" onClick={() => setOpen(o => !o)}
        className="text-[10px] px-2.5 py-1 rounded-lg border transition-colors hover:border-violet-400 hover:text-violet-500"
        style={{ borderColor: open ? '#7c3aed' : 'var(--xp-bdr2)', color: open ? '#7c3aed' : 'var(--xp-txt3)', background: open ? (isDark ? 'rgba(124,58,237,0.08)' : 'rgba(124,58,237,0.04)') : 'transparent' }}>
        ✨ Tasks ▼
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 9995,
          background: isDark ? '#1e1635' : '#fff',
          border: `1px solid ${isDark ? 'rgba(124,58,237,0.3)' : 'rgba(124,58,237,0.18)'}`,
          borderRadius: 12, minWidth: 170, overflow: 'hidden',
          boxShadow: isDark ? '0 12px 40px rgba(0,0,0,0.55)' : '0 8px 28px rgba(0,0,0,0.14)',
        }}>
          {items.map((item, idx) => (
            <button key={item.label} type="button"
              onClick={() => { item.action(); setOpen(false) }}
              className="w-full flex items-center px-3.5 py-2.5 text-left text-xs transition-colors hover:bg-black/5"
              style={{
                color: item.label === 'Delete Tasks' ? '#ef4444' : 'var(--xp-txt)',
                borderTop: idx === 2 ? `0.5px solid var(--xp-bdr)` : 'none',
              }}>
              <span style={{ width: 20, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, ...item.iconStyle }}>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Task 3-dot Menu ──────────────────────────────────────────────────────────

interface TaskMenuProps {
  onEdit: () => void
  onAdjustTime: () => void
  onDuplicate: () => void
  onDelete: () => void
  onSetReminder: () => void
  onCopy: () => void
  onPaste: () => void
  onCreateSubTask: () => void
  onChooseColor: () => void
  onTogglePriority: () => void
  onTransfer: () => void
  pasteEnabled: boolean
  transferDisabled: boolean
  isChild: boolean
  isPriority: boolean
  menuAnchor: DOMRect
  isDark: boolean
  onClose: () => void
}

function TaskMenu({ onEdit, onAdjustTime, onDuplicate, onDelete, onSetReminder, onCopy, onPaste, onCreateSubTask, onChooseColor, onTogglePriority, onTransfer, pasteEnabled, transferDisabled, isChild, isPriority, onClose, menuAnchor, isDark }: TaskMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function onOut(e: PointerEvent) { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    const raf = requestAnimationFrame(() => document.addEventListener('pointerdown', onOut))
    return () => { cancelAnimationFrame(raf); document.removeEventListener('pointerdown', onOut) }
  }, [onClose])

  type MenuItem = { icon: string; label: string; action: () => void; danger?: boolean; disabled?: boolean; sep?: boolean }
  const items: MenuItem[] = [
    { icon: '✏️', label: 'Edit Task',        action: onEdit        },
    { icon: '🔔', label: 'Set Reminder',     action: onSetReminder },
    { icon: '🕒', label: 'Adjust Time',      action: onAdjustTime  },
    { icon: '📄', label: 'Duplicate Task',   action: onDuplicate, sep: true },
    { icon: '📋', label: 'Copy Task',        action: onCopy        },
    { icon: '📌', label: 'Paste Task',       action: onPaste, disabled: !pasteEnabled },
    { icon: '📅', label: 'Transfer Task',    action: onTransfer, disabled: transferDisabled },
    ...(!isChild ? [{ icon: '➕', label: 'Create Sub-Task', action: onCreateSubTask }] as MenuItem[] : []),
    { icon: '🎨', label: 'Choose Task Color', action: onChooseColor, sep: true },
    { icon: '⚡', label: isPriority ? 'Remove Priority' : 'Mark as Priority', action: onTogglePriority },
    { icon: '🗑',  label: 'Delete Task',      action: onDelete, danger: true, sep: true },
  ]

  const MENU_MAX_H = 360
  const vw = typeof window !== 'undefined' ? window.innerWidth  : 390
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  const spaceBelow = vh - menuAnchor.bottom - 8
  const openUpward = spaceBelow < MENU_MAX_H

  // Explicit colors — CSS variables cannot cascade into a body-level portal
  const menuBg  = isDark ? '#1e1635' : '#ffffff'
  const menuBdr = isDark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.09)'
  const itemTxt = isDark ? '#e2e8f0' : '#111827'
  const sepClr  = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)'
  const hoverBg = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'

  return createPortal(
    <div ref={ref} style={{
      position: 'fixed',
      right: vw - menuAnchor.right,
      ...(openUpward ? { bottom: vh - menuAnchor.top + 4 } : { top: menuAnchor.bottom + 4 }),
      zIndex: 99999,
      background: menuBg,
      border: `0.5px solid ${menuBdr}`,
      borderRadius: 12,
      boxShadow: isDark ? '0 16px 48px rgba(0,0,0,0.7)' : '0 8px 32px rgba(0,0,0,0.18)',
      minWidth: 184,
      maxHeight: MENU_MAX_H,
      overflowY: 'auto',
      overscrollBehavior: 'contain',
    }}>
      {items.map((item, idx) => (
        <TaskMenuItem key={item.label}
          item={item} idx={idx} isPriority={isPriority}
          itemTxt={itemTxt} sepClr={sepClr} hoverBg={hoverBg}
          onClose={onClose}
        />
      ))}
    </div>,
    document.body
  )
}

// Extracted to avoid inline-function recreation on every render
function TaskMenuItem({ item, idx, isPriority, itemTxt, sepClr, hoverBg, onClose }: {
  item: { icon: string; label: string; action: () => void; danger?: boolean; disabled?: boolean; sep?: boolean }
  idx: number; isPriority: boolean; itemTxt: string; sepClr: string; hoverBg: string
  onClose: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const priorityLabel = isPriority ? 'Remove Priority' : 'Mark as Priority'
  const color = item.danger ? '#ef4444' : item.label === priorityLabel ? '#f97316' : itemTxt
  return (
    <button
      type="button"
      onPointerEnter={() => { if (!item.disabled) setHovered(true) }}
      onPointerLeave={() => setHovered(false)}
      onClick={() => { if (!item.disabled) { item.action(); onClose() } }}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 14px', textAlign: 'left', fontSize: 12,
        background: hovered && !item.disabled ? hoverBg : 'transparent',
        border: 'none',
        borderTop: item.sep && idx > 0 ? `0.5px solid ${sepClr}` : 'none',
        cursor: item.disabled ? 'default' : 'pointer',
        opacity: item.disabled ? 0.38 : 1,
        color, WebkitTapHighlightColor: 'transparent',
        transition: 'background 120ms ease',
      }}
    >
      <span style={{ fontSize: 14, lineHeight: 1, flexShrink: 0, width: 22, textAlign: 'center' }}>{item.icon}</span>
      <span style={{ whiteSpace: 'nowrap' }}>{item.label}</span>
    </button>
  )
}

// ─── TaskRow ──────────────────────────────────────────────────────────────────

const PILL_W = 100 // fixed pill width — all pills identical

interface TaskRowProps {
  task: Task
  index: number
  isActive: boolean
  blockedByOtherTimer: boolean
  now: number
  isEditing: boolean
  onEditStart: () => void
  onEditEnd: () => void
  dateKey: string
  expanded: boolean
  onExpandToggle: () => void
  onToggle: () => void
  onDelete: () => void
  onDuplicate: () => void
  onStartTimer: () => void
  onStopTimer: () => void
  draftJournal: string | null
  onNotesDraftChange: (text: string) => void
  onNotesSave: () => void
  onTextChange: (text: string) => void
  onActChange: (actId: string) => void
  onAdjustTime: (sessionId: string | null, startTs: number, endTs: number, note: string) => void
  onSetReminder: () => void
  onDragStart: () => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: () => void
  bellTriggerKey: number
  onAttachmentsChange: (attachments: TaskAttachment[]) => void
  // Hierarchy props
  isChild?: boolean
  childIndex?: number
  hasChildren?: boolean
  isParentExpanded?: boolean
  onParentExpandToggle?: () => void
  subTaskCount?: number
  subTaskDoneCount?: number
  // Clipboard props
  onCopy: () => void
  onPaste: () => void
  onCreateSubTask: () => void
  pasteEnabled: boolean
  // Color + priority
  onChooseColor: (color: string) => void
  onTogglePriority: () => void
  // Transfer (move/copy to another date)
  onTransfer: () => void
  transferDisabled: boolean
}

function TaskRow({
  task, index, isActive, blockedByOtherTimer, now, isEditing, onEditStart, onEditEnd, dateKey,
  expanded, onExpandToggle,
  onToggle, onDelete, onDuplicate, onStartTimer, onStopTimer,
  draftJournal, onNotesDraftChange, onNotesSave,
  onTextChange, onActChange, onAdjustTime, onSetReminder,
  onDragStart, onDragOver, onDrop, bellTriggerKey,
  onAttachmentsChange,
  isChild = false, childIndex, hasChildren = false, isParentExpanded, onParentExpandToggle,
  subTaskCount, subTaskDoneCount,
  onCopy, onPaste, onCreateSubTask, pasteEnabled,
  onChooseColor, onTogglePriority,
  onTransfer, transferDisabled,
}: TaskRowProps) {
  const { activities, reminders, isDark, setToast } = useApp()
  const attachments = task.attachments ?? []
  const [uploading,   setUploading]   = useState(false)
  const [lightbox,    setLightbox]    = useState<string | null>(null)
  const [cameraOpen,  setCameraOpen]  = useState(false)
  const uploadRef = useRef<HTMLInputElement>(null)

  async function handleFiles(files: File[] | FileList | null, source: 'upload' | 'camera') {
    if (!files || files.length === 0) return
    setUploading(true)
    try {
      const next = await buildAttachments(files, source)
      onAttachmentsChange([...attachments, ...next])
    } finally {
      setUploading(false)
    }
  }

  function removeAttachment(id: string) {
    onAttachmentsChange(removeAttachmentById(attachments, id))
  }
  const hasReminder = reminders.some(r => r.taskId === task.id && r.dateKey === dateKey && r.isActive)

  const [menuOpen,       setMenuOpen]       = useState(false)
  const [menuAnchorRect, setMenuAnchorRect] = useState<DOMRect | null>(null)
  const dotBtnRef = useRef<HTMLButtonElement>(null)
  const [colorPickerOpen, setColorPickerOpen] = useState(false)
  const [adjustOpen,     setAdjustOpen]     = useState(false)
  const [emojiOpen,      setEmojiOpen]      = useState(false)
  const [isDragOver,     setIsDragOver]     = useState(false)
  const [notesViewMode,  setNotesViewMode]  = useState<'preview' | 'edit'>('preview')
  const [isCardHovered,  setIsCardHovered]  = useState(false)
  const [notesJustSaved, setNotesJustSaved] = useState(false)
  const [titleJustSaved, setTitleJustSaved] = useState(false)
  const notesSavedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const titleSavedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (notesSavedTimerRef.current) clearTimeout(notesSavedTimerRef.current)
    if (titleSavedTimerRef.current) clearTimeout(titleSavedTimerRef.current)
  }, [])

  // Session lock: once a task has a completed session it cannot be restarted
  const hasCompletedSession = (task.sessions?.some(s => s.endTs !== null) ?? false) || !!task.timerEnd
  const sessionLocked = hasCompletedSession && !isActive

  // Reset notes view when task collapses
  useEffect(() => { if (!expanded) setNotesViewMode('preview') }, [expanded])

  // Bell animation
  const [isBellAnimating, setIsBellAnimating] = useState(false)
  const mountedRef     = useRef(false)
  const prevTriggerRef = useRef(bellTriggerKey)
  useEffect(() => {
    if (!mountedRef.current) { mountedRef.current = true; if (hasReminder) setIsBellAnimating(true) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (bellTriggerKey !== prevTriggerRef.current) { prevTriggerRef.current = bellTriggerKey; setIsBellAnimating(true) }
  }, [bellTriggerKey])

  const notesRef          = useRef<HTMLTextAreaElement>(null)
  const emojiPickerRef    = useRef<HTMLDivElement>(null)
  const titleContainerRef = useRef<HTMLDivElement>(null)
  const tooltipTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Close emoji picker when clicking outside
  useEffect(() => {
    if (!emojiOpen) return
    function onDown(e: MouseEvent) {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node)) setEmojiOpen(false)
    }
    const t = setTimeout(() => document.addEventListener('mousedown', onDown), 10)
    return () => { clearTimeout(t); document.removeEventListener('mousedown', onDown) }
  }, [emojiOpen])
  const [showTooltip, setShowTooltip] = useState(false)
  const [tooltipPos,  setTooltipPos]  = useState<{ top: number; left: number; width: number } | null>(null)
  const [showPopover, setShowPopover] = useState(false)

  useEffect(() => () => { if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current) }, [])

  function handleTitleMouseEnter() {
    if (isEditing) return
    tooltipTimerRef.current = setTimeout(() => {
      const rect = titleContainerRef.current?.getBoundingClientRect()
      if (rect && task.text) { setTooltipPos({ top: rect.bottom + 6, left: rect.left, width: rect.width }); setShowTooltip(true) }
    }, 300)
  }
  function handleTitleMouseLeave() {
    if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current)
    setShowTooltip(false); setTooltipPos(null)
  }
  function handleTitleClick() {
    if (isEditing) return
    if (!task.text) { onEditStart(); return }
    setShowTooltip(false); setTooltipPos(null)
    setShowPopover(true)
  }

  // Checklist helpers
  function toggleChecklistLine(lineIndex: number) {
    const current = draftJournal ?? task.journal
    const lines = (current || '').split('\n')
    const line  = lines[lineIndex]
    if (line.startsWith('☐ '))      lines[lineIndex] = '☑ ' + line.slice(2)
    else if (line.startsWith('☑ ')) lines[lineIndex] = '☐ ' + line.slice(2)
    onNotesDraftChange(lines.join('\n'))
  }

  function handleTitleEditEnd() {
    onEditEnd()
    if (task.text.trim()) {
      if (titleSavedTimerRef.current) clearTimeout(titleSavedTimerRef.current)
      setTitleJustSaved(true)
      titleSavedTimerRef.current = setTimeout(() => setTitleJustSaved(false), 1100)
    }
  }

  function handleNotesSaveClick() {
    if (notesDirty) {
      onNotesSave()
      if (notesSavedTimerRef.current) clearTimeout(notesSavedTimerRef.current)
      setNotesJustSaved(true)
      notesSavedTimerRef.current = setTimeout(() => setNotesJustSaved(false), 1100)
    } else {
      setToast('No changes to save.')
    }
  }

  function handleEmojiSelect(emoji: string) {
    const current = draftJournal ?? task.journal
    if (notesViewMode === 'edit' && notesRef.current) {
      const ta    = notesRef.current
      const start = ta.selectionStart ?? current.length
      const next  = current.slice(0, start) + emoji + current.slice(start)
      onNotesDraftChange(next)
      requestAnimationFrame(() => { ta.setSelectionRange(start + emoji.length, start + emoji.length); ta.focus() })
    } else {
      onNotesDraftChange(current + emoji)
    }
  }

  function insertAtCursor(text: string) {
    const current = draftJournal ?? task.journal
    if (notesRef.current) {
      const ta    = notesRef.current
      const start = ta.selectionStart ?? current.length
      const next  = current.slice(0, start) + text + current.slice(start)
      onNotesDraftChange(next)
      requestAnimationFrame(() => { ta.setSelectionRange(start + text.length, start + text.length); ta.focus() })
    } else {
      onNotesDraftChange((current ? current + '\n' : '') + text)
    }
  }

  // Notes textarea is plain text (• /1. /☐ are literal characters this
  // component inserts and interprets itself — there's no rich-text list
  // extension underneath), so unlike a TipTap editor it has no built-in
  // "continue list on Enter" behavior at all. This reproduces that behavior
  // by hand for all three marker styles — "• ", "N. ", and "☐ "/"☑ " (a new
  // checklist item always continues unchecked, matching the other two modes
  // always continuing with a fresh marker) — splitting the line and
  // continuing the same marker; Enter on an EMPTY marker line exits that
  // list mode instead, matching standard editor convention. Backspace needs
  // no special handling — it's plain text, so it already deletes the marker
  // character-by-character with nothing trapping the cursor.
  function handleNotesKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== 'Enter') return
    const ta = e.currentTarget
    const value = ta.value
    const cursor = ta.selectionStart
    const lineStart = value.lastIndexOf('\n', cursor - 1) + 1
    const lineEndIdx = value.indexOf('\n', lineStart)
    const lineEnd = lineEndIdx === -1 ? value.length : lineEndIdx
    const line = value.slice(lineStart, lineEnd)

    const bulletMatch = line.match(/^• (.*)$/)
    const numberMatch = line.match(/^(\d+)\. (.*)$/)
    const checkMatch  = line.match(/^[☐☑] (.*)$/)
    if (!bulletMatch && !numberMatch && !checkMatch) return // not a list line — normal Enter behavior

    const markerLen = bulletMatch ? 2 : numberMatch ? numberMatch[1].length + 2 : 2
    const content   = bulletMatch ? bulletMatch[1] : numberMatch ? numberMatch[2] : checkMatch![1]

    e.preventDefault()

    if (content.trim() === '') {
      // Empty item — exit list mode: drop the marker, leave a plain blank line
      const next = value.slice(0, lineStart) + value.slice(lineStart + markerLen)
      onNotesDraftChange(next)
      requestAnimationFrame(() => { ta.setSelectionRange(lineStart, lineStart); ta.focus() })
      return
    }

    const marker = bulletMatch ? '• ' : numberMatch ? `${Number(numberMatch[1]) + 1}. ` : '☐ '
    const before = value.slice(0, cursor)
    const after  = value.slice(cursor)
    const next   = before + '\n' + marker + after
    onNotesDraftChange(next)
    const newCursor = cursor + 1 + marker.length
    requestAnimationFrame(() => { ta.setSelectionRange(newCursor, newCursor); ta.focus() })
  }

  const notesDirty     = draftJournal !== null
  const totalMs        = getTaskTotalMs(task, isActive, now)
  const runningSession = getRunningSession(task)
  const latestSession  = task.sessions?.findLast?.(s => s.endTs !== null)
  const multiSession   = (task.sessions?.filter(s => s.endTs !== null).length ?? 0) > 1

  // ── Card visuals: purple accent for active (not green) ─────────────────────
  const cardBorder = expanded ? 'rgba(124,58,237,0.28)' : task.isPriority ? 'rgba(239,68,68,0.28)' : 'var(--xp-bdr)'

  // Priority overrides custom color visually; custom color overrides default
  const colorOverlay = task.isPriority
    ? (isDark ? PRIORITY_TINT.D : PRIORITY_TINT.L)
    : (task.taskColor && task.taskColor !== 'default' && TASK_COLOR_CONFIG[task.taskColor])
    ? (isDark ? TASK_COLOR_CONFIG[task.taskColor].tintD : TASK_COLOR_CONFIG[task.taskColor].tintL)
    : null

  const cardBg = colorOverlay
    ? colorOverlay
    : expanded
    ? (isDark ? 'rgba(255,255,255,0.035)' : '#ffffff')
    : isActive
    ? (isDark ? 'rgba(124,58,237,0.07)' : 'rgba(124,58,237,0.04)')
    : isCardHovered
    ? (isDark ? 'rgba(255,255,255,0.04)' : 'rgba(124,58,237,0.018)')
    : 'var(--xp-bg3)'

  // Build box-shadow array
  const shadows: string[] = []
  if (isActive)      shadows.push('inset 3px 0 0 rgba(124,58,237,0.80)')
  if (isActive)      shadows.push('0 0 30px rgba(124,58,237,0.09), 0 2px 10px rgba(0,0,0,0.06)')
  if (expanded)      shadows.push(isDark
    ? '0 4px 20px rgba(0,0,0,0.28),0 0 0 0.5px rgba(124,58,237,0.16)'
    : '0 2px 14px rgba(0,0,0,0.07),0 0 0 0.5px rgba(124,58,237,0.10)')
  if (isCardHovered && !isActive) shadows.push('0 2px 14px rgba(0,0,0,0.08), 0 0 26px rgba(124,58,237,0.12)')
  const cardShadow = shadows.length ? shadows.join(',') : 'none'

  const titleBg     = isEditing ? (isDark ? 'rgba(124,58,237,0.12)' : 'rgba(124,58,237,0.06)') : (isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)')
  const titleBorder = isEditing ? 'var(--xp-acc)' : 'var(--xp-bdr)'

  return (
    <>
      <style>{`@keyframes xp-active-pulse{0%,100%{opacity:1}50%{opacity:0.25}}@keyframes xp-saved-fade{0%{opacity:1}70%{opacity:1}100%{opacity:0}}`}</style>
      <div
        id={`xp-task-${task.id}`}
        className={`rounded-xl overflow-visible relative transition-all duration-200 ${isDragOver ? 'ring-2 ring-violet-400 ring-offset-1' : ''}`}
        style={{ border: `0.5px solid ${cardBorder}`, background: cardBg, boxShadow: cardShadow }}
        onMouseEnter={() => setIsCardHovered(true)}
        onMouseLeave={() => setIsCardHovered(false)}
        onDragOver={e => { e.preventDefault(); setIsDragOver(true); onDragOver(e) }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={() => { setIsDragOver(false); onDrop() }}
      >
        {/* ── HEADER ROW ─────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-1.5 px-3 pt-2.5 pb-1.5">

          {/* Hierarchy expand/collapse (replaces drag handle) */}
          {hasChildren ? (
            <button
              onClick={e => { e.stopPropagation(); onParentExpandToggle?.() }}
              className="xp-parent-expand-btn flex-shrink-0 flex items-center justify-center transition-colors hover:bg-black/5 rounded"
              style={{ width: 18, height: 18, color: 'var(--xp-txt3)', fontSize: 10 }}
              title={isParentExpanded ? 'Collapse sub-tasks' : 'Expand sub-tasks'}
            >
              <span style={{ display: 'inline-block', lineHeight: 1, transform: isParentExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 200ms cubic-bezier(0.4,0,0.2,1)' }}>▶</span>
            </button>
          ) : isChild ? null : (
            /* This alignment spacer only matters for TOP-LEVEL tasks without
               children, so their "Task N" label lines up with sibling
               top-level tasks that DO have the expand triangle. Sub-tasks
               live in their own indented block with their own connector
               arrow already indicating hierarchy, so repeating this spacer
               there was pure dead space eating into the title's width. */
            <span className="flex-shrink-0" style={{ width: 18 }} />
          )}

          {/* Priority indicator */}
          {task.isPriority && (
            <span className="flex-shrink-0 font-bold leading-none" style={{ fontSize: 11, color: '#ef4444' }} title="Priority task">!</span>
          )}

          {/* Task N / Sub-Task N */}
          <span className="text-[10px] font-semibold flex-shrink-0 tabular-nums" style={{ color: 'var(--xp-txt3)', minWidth: isChild ? 52 : 38 }}>
            {isChild ? `Sub-Task ${(childIndex ?? 0) + 1}` : `Task ${index + 1}`}
          </span>

          {/* Completion checkbox */}
          <button onClick={onToggle} className="w-[17px] h-[17px] rounded border-2 flex-shrink-0 flex items-center justify-center transition-all duration-150" style={{ borderColor: task.done ? '#16a34a' : 'var(--xp-bdr2)', background: task.done ? '#16a34a' : 'transparent' }}>
            {task.done && <span className="text-white font-bold leading-none" style={{ fontSize: 9 }}>✓</span>}
          </button>

          {/* Reminder bell — before title */}
          {hasReminder && (
            <span className={`flex-shrink-0 leading-none text-[13px] ${isBellAnimating ? 'xp-bell-ring' : ''}`} onAnimationEnd={() => setIsBellAnimating(false)} title="Reminder set">🔔</span>
          )}

          {/* Title — always in subtle rounded container, fixed width via flex-1 */}
          <div
            ref={titleContainerRef}
            data-no-drag="true"
            className="flex-1 min-w-0 rounded-lg px-2.5 py-1 transition-all relative"
            style={{ background: titleBg, border: `0.5px solid ${titleBorder}` }}
            onMouseEnter={handleTitleMouseEnter}
            onMouseLeave={handleTitleMouseLeave}
          >
            {isEditing ? (
              <input
                type="text"
                autoFocus
                value={task.text}
                onChange={e => onTextChange(e.target.value)}
                onFocus={e => { const len = e.target.value.length; e.target.setSelectionRange(len, len) }}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleTitleEditEnd() } if (e.key === 'Escape') handleTitleEditEnd() }}
                onBlur={handleTitleEditEnd}
                className="w-full bg-transparent outline-none text-xs leading-snug"
                style={{ color: 'var(--xp-txt)' }}
                placeholder={task.linkedSessionId ? 'What did you work on?' : 'Task title...'}
              />
            ) : (
              <>
                <span
                  className="text-xs leading-snug block truncate cursor-default"
                  style={{ color: task.done ? 'var(--xp-txt3)' : 'var(--xp-txt)', textDecoration: task.done ? 'line-through' : 'none' }}
                  onClick={handleTitleClick}
                >
                  {task.text || <span style={{ opacity: 0.38, fontStyle: 'italic' }}>{task.linkedSessionId ? 'Name this session…' : 'Untitled'}</span>}
                </span>
                {titleJustSaved && (
                  <span
                    aria-live="polite"
                    style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', fontSize: 9, fontWeight: 600, color: '#16a34a', pointerEvents: 'none', animation: 'xp-saved-fade 1100ms ease forwards', whiteSpace: 'nowrap' }}
                  >
                    ✓ Saved
                  </span>
                )}
              </>
            )}
          </div>

          {/* Category pill — custom dropdown */}
          <ActivityDropdown
            value={task.actId}
            onChange={onActChange}
            activities={activities}
            isDark={isDark}
          />

          {/* 3-dot */}
          <div className="relative flex-shrink-0">
            <button ref={dotBtnRef} type="button" onClick={() => {
              if (!menuOpen && dotBtnRef.current) setMenuAnchorRect(dotBtnRef.current.getBoundingClientRect())
              setMenuOpen(o => !o)
            }} className="p-1.5 rounded-lg hover:bg-black/5 transition-colors" style={{ color: 'var(--xp-txt3)' }}><DotsIcon /></button>
            {menuOpen && menuAnchorRect && (
              <TaskMenu
                onEdit={() => { onEditStart(); setMenuOpen(false) }}
                onSetReminder={onSetReminder}
                onAdjustTime={() => setAdjustOpen(true)}
                onDuplicate={onDuplicate}
                onDelete={onDelete}
                onCopy={onCopy}
                onPaste={onPaste}
                onCreateSubTask={onCreateSubTask}
                onChooseColor={() => { setMenuOpen(false); setColorPickerOpen(true) }}
                onTogglePriority={() => { onTogglePriority(); setMenuOpen(false) }}
                onTransfer={onTransfer}
                pasteEnabled={pasteEnabled}
                transferDisabled={transferDisabled}
                isChild={isChild}
                isPriority={!!task.isPriority}
                onClose={() => setMenuOpen(false)}
                menuAnchor={menuAnchorRect}
                isDark={isDark}
              />
            )}
            {colorPickerOpen && (
              <ColorPickerPopover
                currentColor={task.taskColor ?? 'default'}
                isDark={isDark}
                onSelect={onChooseColor}
                onClose={() => setColorPickerOpen(false)}
              />
            )}
          </div>
        </div>

        {/* ── DETAILS ROW — fixed layout across all timer states.
            [Total][Play][Stop] and [Active][Sub-task count][▶] are protected,
            flex-shrink-0 controls; the time-range text between them is the ONE
            flexible region (flex:1, min-width:0, ellipsis) — it absorbs any
            width shortfall by truncating instead of letting the row overflow
            the card. min-width:0 + overflow:hidden on the row itself is a
            second line of defense against horizontal overflow. ── */}
        <div className="flex items-center gap-1.5 px-3 pb-2" style={{ minWidth: 0, overflow: 'hidden' }}>

          {/* Total — always shown; placeholder when task not yet started */}
          <span className="text-[10px] flex-shrink-0 flex items-center gap-1 mr-0.5">
            <span style={{ color: 'var(--xp-txt3)', opacity: 0.6 }}>Total:</span>
            <span className="font-mono font-semibold" style={{ minWidth: 52, color: isActive ? '#7c3aed' : totalMs > 0 ? 'var(--xp-txt2)' : 'var(--xp-txt3)', opacity: !isActive && totalMs === 0 ? 0.38 : 1 }}>
              {isActive && runningSession ? formatHMS(now - runningSession.startTs) : totalMs > 0 ? formatMs(totalMs) : '00h 00m'}
            </span>
            {multiSession && !isActive && totalMs > 0 && <span style={{ fontSize: 8, color: 'var(--xp-txt3)', opacity: 0.45 }}>all</span>}
          </span>

          {/* Play — green; disabled when active, blocked by another timer, or session is locked */}
          <button
            onClick={onStartTimer}
            disabled={isActive || blockedByOtherTimer || sessionLocked}
            className={`p-1 rounded-md flex-shrink-0 transition-colors ${!isActive && !blockedByOtherTimer && !sessionLocked ? 'hover:bg-green-500/15 cursor-pointer' : 'cursor-not-allowed'}`}
            style={{ color: '#16a34a', opacity: isActive || blockedByOtherTimer || sessionLocked ? 0.25 : 1 }}
            title={isActive ? 'Timer is running' : blockedByOtherTimer ? 'An active task is already running. Clock out first to start a new timer.' : sessionLocked ? 'Session completed. Duplicate this task to continue working.' : 'Start timer'}
          >
            <PlayIcon />
          </button>

          {/* Stop — red; disabled when not active */}
          <button
            onClick={onStopTimer}
            disabled={!isActive}
            className={`p-1 rounded-md flex-shrink-0 transition-colors ${isActive ? 'hover:bg-red-500/15 cursor-pointer' : 'cursor-not-allowed'}`}
            style={{ color: '#ef4444', opacity: !isActive ? 0.25 : 1 }}
            title={isActive ? 'Stop timer' : sessionLocked ? 'Session completed. Duplicate this task to continue working.' : 'No active session'}
          >
            <StopIcon />
          </button>

          {/* Time range — the flexible region: shrinks and truncates with an
              ellipsis before anything else is allowed to move or overflow. */}
          <span className="text-[9px] tabular-nums" style={{ flex: '1 1 0%', minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', color: 'var(--xp-txt3)', opacity: (latestSession || (isActive && runningSession)) ? 1 : 0.32 }}>
            {/* Desktop: locale default (may be 24h) */}
            <span className="hidden sm:inline">
              {isActive && runningSession
                ? `${formatTime(runningSession.startTs)} → …`
                : latestSession
                ? `${formatTime(latestSession.startTs)} – ${latestSession.endTs ? formatTime(latestSession.endTs) : '…'}`
                : '--:-- – --:--'
              }
            </span>
            {/* Mobile: explicit 12-hour with AM/PM */}
            <span className="sm:hidden">
              {isActive && runningSession
                ? `${formatTime12(runningSession.startTs)} → …`
                : latestSession
                ? `${formatTime12(latestSession.startTs)} – ${latestSession.endTs ? formatTime12(latestSession.endTs) : '…'}`
                : '--:-- – --:--'
              }
            </span>
          </span>

          {/* Active indicator — pulsing green dot */}
          {isActive && (
            <span className="flex items-center gap-1.5 flex-shrink-0">
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#16a34a', display: 'inline-block', flexShrink: 0, animation: 'xp-active-pulse 1.4s ease-in-out infinite' }} />
              <span className="text-[10px] font-semibold" style={{ color: '#16a34a' }}>Active</span>
            </span>
          )}

          {/* Sub-task count badge */}
          {hasChildren && subTaskCount !== undefined && (
            <span className="flex-shrink-0 text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: 'var(--xp-bg2)', border: '0.5px solid var(--xp-bdr2)', color: 'var(--xp-txt3)' }}>
              {subTaskDoneCount}/{subTaskCount}
            </span>
          )}

          {/* Expand arrow */}
          <button onClick={onExpandToggle} className="flex items-center justify-center w-5 h-5 rounded hover:bg-black/5 transition-colors flex-shrink-0" style={{ color: 'var(--xp-txt3)' }}>
            <span style={{ display: 'inline-block', fontSize: 10, lineHeight: 1, transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 220ms cubic-bezier(0.4,0,0.2,1)' }}>▶</span>
          </button>
        </div>

        {/* ── EXPANDABLE NOTES ───────────────────────────────────────────────── */}
        <div aria-hidden={!expanded} style={{ maxHeight: expanded ? 440 : 0, overflow: 'hidden', opacity: expanded ? 1 : 0, transition: expanded ? 'max-height 250ms ease,opacity 200ms ease' : 'max-height 220ms ease,opacity 150ms ease' }}>
          <div className="px-3 pb-3 pt-2.5" style={{ borderTop: '0.5px solid var(--xp-bdr)' }}>

            {/* Session info */}
            {latestSession && (
              <div className="flex items-center gap-3 mb-2 text-[10px] tabular-nums" style={{ color: 'var(--xp-txt3)' }}>
                <span className="flex items-center gap-1">
                  <span style={{ color: '#16a34a' }}>▶</span>
                  <span className="hidden sm:inline">{formatTime(latestSession.startTs)}</span>
                  <span className="sm:hidden">{formatTime12(latestSession.startTs)}</span>
                </span>
                <span style={{ color: 'var(--xp-bdr2)' }}>→</span>
                <span className="flex items-center gap-1">
                  <span style={{ color: '#ef4444' }}>■</span>
                  {latestSession.endTs ? (
                    <>
                      <span className="hidden sm:inline">{formatTime(latestSession.endTs)}</span>
                      <span className="sm:hidden">{formatTime12(latestSession.endTs)}</span>
                    </>
                  ) : '—'}
                </span>
                <span className="ml-auto font-medium" style={{ color: 'var(--xp-txt2)' }}>{latestSession.endTs ? formatMs(latestSession.endTs - latestSession.startTs) : 'Running'}</span>
              </div>
            )}

            {/* ── INTERACTIVE NOTES AREA ── */}
            <div>
              {notesViewMode === 'preview' ? (
                // Preview: interactive checklist + rendered text
                <div
                  className="text-xs rounded-lg px-2.5 py-2"
                  style={{ minHeight: 68, border: '1px solid var(--xp-bdr2)', background: 'var(--xp-bg2)', color: 'var(--xp-txt)', cursor: 'text' }}
                  onClick={() => { if (!(draftJournal ?? task.journal)) setNotesViewMode('edit') }}
                >
                  {(draftJournal ?? task.journal) ? (
                    <div>
                      {(draftJournal ?? task.journal).split('\n').map((line, i) => {
                        const isCheck = line.startsWith('☐ ') || line.startsWith('☑ ')
                        if (isCheck) {
                          const checked = line.startsWith('☑ ')
                          const text    = line.slice(2)
                          return (
                            <button
                              key={i}
                              onClick={e => { e.stopPropagation(); toggleChecklistLine(i) }}
                              className="flex items-center gap-2 w-full text-left py-0.5 transition-opacity hover:opacity-75"
                            >
                              <span style={{ fontSize: 13, flexShrink: 0, color: checked ? '#16a34a' : 'var(--xp-txt3)', lineHeight: 1 }}>{checked ? '☑' : '☐'}</span>
                              <span style={{ textDecoration: checked ? 'line-through' : 'none', color: checked ? 'var(--xp-txt3)' : 'var(--xp-txt)', fontSize: 11, lineHeight: 1.5 }}>
                                {text || <span style={{ opacity: 0.35, fontStyle: 'italic' }}>Empty item</span>}
                              </span>
                            </button>
                          )
                        }
                        return line
                          ? <p key={i} style={{ padding: '1px 0', lineHeight: 1.55, fontSize: 11, color: 'var(--xp-txt2)' }}>{line}</p>
                          : <div key={i} style={{ height: 5 }} />
                      })}
                    </div>
                  ) : (
                    <span style={{ color: 'var(--xp-txt3)', opacity: 0.4, fontSize: 11 }}>
                      Click ✏️ to add notes, or type ☐ for a checklist item...
                    </span>
                  )}
                </div>
              ) : (
                // Edit: raw textarea
                <textarea
                  ref={notesRef}
                  autoFocus
                  value={draftJournal ?? task.journal}
                  onChange={e => onNotesDraftChange(e.target.value)}
                  onKeyDown={handleNotesKeyDown}
                  placeholder="Add notes, or type ☐ to start a checklist item..."
                  rows={3}
                  tabIndex={expanded ? 0 : -1}
                  className="w-full text-xs px-2.5 py-2 rounded-lg outline-none resize-none leading-relaxed"
                  style={{ border: `1px solid ${notesDirty ? 'rgba(124,58,237,0.55)' : 'var(--xp-acc)'}`, background: 'var(--xp-bg2)', color: 'var(--xp-txt)' }}
                />
              )}

              {/* Controls row */}
              <div className="flex items-center justify-between mt-1.5" style={{ flexWrap: 'wrap', gap: 4 }}>
                {/* Left: mode toggle + formatting (edit-only) + upload + camera */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                  <button
                    onClick={() => setNotesViewMode(m => m === 'preview' ? 'edit' : 'preview')}
                    className="text-[10px] px-2 py-0.5 rounded-md transition-colors hover:bg-black/5"
                    style={{ color: 'var(--xp-txt3)' }}
                  >
                    {notesViewMode === 'preview' ? <>✏️ <span className="hidden sm:inline">Edit notes</span><span className="sm:hidden">Edit</span></> : '👁 Preview'}
                  </button>

                  {notesViewMode === 'edit' && (
                    <>
                      <button onClick={() => insertAtCursor('• ')} title="Insert bullet point" className="text-[10px] px-2 py-0.5 rounded-md transition-colors hover:bg-black/5" style={{ color: 'var(--xp-txt3)' }}>• List</button>
                      <button onClick={() => insertAtCursor('1. ')} title="Insert numbered item" className="text-[10px] px-2 py-0.5 rounded-md transition-colors hover:bg-black/5" style={{ color: 'var(--xp-txt3)' }}>1. List</button>
                      <button onClick={() => insertAtCursor('☐ ')} title="Insert checklist item" className="text-[10px] px-2 py-0.5 rounded-md transition-colors hover:bg-black/5" style={{ color: 'var(--xp-txt3)' }}>☐ Check</button>
                    </>
                  )}

                  <button
                    onClick={() => uploadRef.current?.click()}
                    disabled={uploading}
                    title="Upload file or photo"
                    className="text-[10px] px-2 py-0.5 rounded-md transition-colors hover:bg-black/5"
                    style={{ color: 'var(--xp-txt3)', opacity: uploading ? 0.5 : 1, cursor: 'pointer' }}
                  >
                    📎 <span className="hidden sm:inline">Upload File</span><span className="sm:hidden">Upload</span>
                  </button>

                  <button
                    onClick={() => setCameraOpen(true)}
                    disabled={uploading}
                    title="Take a photo with your camera"
                    className="text-[10px] px-2 py-0.5 rounded-md transition-colors hover:bg-black/5"
                    style={{ color: 'var(--xp-txt3)', opacity: uploading ? 0.5 : 1, cursor: 'pointer' }}
                  >
                    📷 Camera
                  </button>

                  {uploading && (
                    <span style={{ fontSize: 10, color: 'var(--xp-txt3)' }}>Uploading…</span>
                  )}

                  {/* Hidden upload input */}
                  <input
                    ref={uploadRef}
                    type="file"
                    multiple
                    accept={ATTACHMENT_ACCEPT}
                    style={{ display: 'none' }}
                    onChange={e => { handleFiles(e.target.files, 'upload'); e.currentTarget.value = '' }}
                  />
                </div>

                <div className="flex items-center gap-1.5">
                  {/* Notes save — always visible, purple-themed */}
                  <button
                    onClick={handleNotesSaveClick}
                    tabIndex={expanded ? 0 : -1}
                    aria-label={notesJustSaved ? 'Notes saved' : notesDirty ? 'Save notes' : 'No unsaved changes'}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 3,
                      padding: '2px 8px', height: 22, borderRadius: 5,
                      border: '1.5px solid rgba(124,58,237,0.45)',
                      background: notesJustSaved ? '#16a34a' : notesDirty ? '#7c3aed' : 'rgba(124,58,237,0.10)',
                      fontSize: 10, fontWeight: 600,
                      cursor: 'pointer',
                      color: notesJustSaved || notesDirty ? '#ffffff' : 'rgba(124,58,237,0.65)',
                      transition: 'background 200ms ease, color 200ms ease',
                      flexShrink: 0, whiteSpace: 'nowrap',
                    }}
                  >
                    {notesJustSaved ? '✓ Saved' : '✓ Save'}
                  </button>

                  {/* Emoji picker — emoji-picker-react */}
                  <div className="relative flex-shrink-0">
                    <button onClick={() => setEmojiOpen(o => !o)} tabIndex={expanded ? 0 : -1} className="hover:scale-110 transition-transform leading-none" style={{ fontSize: 17 }} title="Insert emoji">😊</button>
                    {emojiOpen && (
                      <div ref={emojiPickerRef} style={{ position: 'absolute', bottom: 'calc(100% + 6px)', right: 0, zIndex: 30, borderRadius: 12, overflow: 'hidden', boxShadow: '0 12px 40px rgba(0,0,0,0.22)' }}>
                        <EmojiPickerLib
                          onEmojiClick={(data: EmojiClickData) => { handleEmojiSelect(data.emoji); setEmojiOpen(false) }}
                          theme={isDark ? Theme.DARK : Theme.LIGHT}
                          width={280}
                          height={340}
                          searchPlaceHolder="Search emoji…"
                          lazyLoadEmojis
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Attachment list */}
              {attachments.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
                  {attachments.map(att => (
                    <AttachmentItem
                      key={att.id}
                      attachment={att}
                      isDark={isDark}
                      onRemove={() => removeAttachment(att.id)}
                      onPreview={() => { if (att.mimeType.startsWith('image/')) setLightbox(att.url) }}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Image lightbox */}
      {lightbox && (
        <ImageLightbox src={lightbox} alt="Attachment preview" onClose={() => setLightbox(null)} />
      )}

      {/* Camera modal */}
      {cameraOpen && (
        <CameraModal
          onCapture={file => handleFiles([file], 'camera')}
          onClose={() => setCameraOpen(false)}
        />
      )}

      {adjustOpen && (
        <AdjustTimeModal task={task} dateKey={dateKey} onClose={() => setAdjustOpen(false)} onSave={(sid, s, e, n) => { onAdjustTime(sid, s, e, n); setAdjustOpen(false) }} />
      )}

      {/* Desktop hover tooltip — fixed position, 300ms delay */}
      {showTooltip && tooltipPos && task.text && (
        <div style={{ position: 'fixed', top: tooltipPos.top, left: tooltipPos.left, maxWidth: Math.max(tooltipPos.width, 240), zIndex: 9999, background: isDark ? '#1e1830' : '#ffffff', border: `0.5px solid ${isDark ? 'rgba(124,58,237,0.28)' : 'rgba(0,0,0,0.10)'}`, borderRadius: 10, padding: '6px 10px', boxShadow: '0 8px 28px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.08)', fontSize: 11, fontWeight: 500, color: isDark ? 'rgba(255,255,255,0.88)' : '#111827', lineHeight: 1.55, pointerEvents: 'none', wordBreak: 'break-word' }}>
          {task.text}
        </div>
      )}

      {/* Mobile/tap popover — centered, with backdrop dismiss */}
      {showPopover && task.text && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9998, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, background: 'rgba(0,0,0,0.25)' }} onClick={() => setShowPopover(false)}>
          <div style={{ background: isDark ? '#1e1830' : '#ffffff', border: `0.5px solid ${isDark ? 'rgba(124,58,237,0.30)' : 'rgba(0,0,0,0.10)'}`, borderRadius: 14, padding: '14px 16px', maxWidth: 320, width: '100%', boxShadow: '0 16px 48px rgba(0,0,0,0.22), 0 4px 16px rgba(0,0,0,0.10)' }} onClick={e => e.stopPropagation()}>
            <p style={{ fontSize: 13, color: isDark ? 'rgba(255,255,255,0.88)' : '#111827', lineHeight: 1.55, wordBreak: 'break-word', fontWeight: 500, margin: 0 }}>{task.text}</p>
            <button onClick={() => setShowPopover(false)} style={{ marginTop: 10, fontSize: 11, color: 'var(--xp-txt3)', padding: '3px 12px', borderRadius: 6, border: '0.5px solid var(--xp-bdr2)', background: 'var(--xp-bg2)', cursor: 'pointer' }}>Dismiss</button>
          </div>
        </div>
      )}
    </>
  )
}

// ─── Today's Status Dropdown ──────────────────────────────────────────────────

type StatusValue = 'milestone' | 'hyper' | 'goal' | 'productive'

const STATUS_OPTIONS: { value: StatusValue; icon: string; label: string }[] = [
  { value: 'productive', icon: '✅', label: 'Productive Day'   },
  { value: 'hyper',      icon: '🔥', label: 'Hyper Productive' },
  { value: 'milestone',  icon: '🏆', label: 'Milestone Day'    },
  { value: 'goal',       icon: '🎯', label: 'Goal Achieved'    },
]

function TodayStatusDropdown({ value, onChange, isDark }: { value: StatusValue | null; onChange: (v: StatusValue | null) => void; isDark: boolean }) {
  const [open,       setOpen]       = useState(false)
  const [focusedIdx, setFocusedIdx] = useState(-1)
  const containerRef                = useRef<HTMLDivElement>(null)

  // Option order: index 0 = None, indices 1–4 = STATUS_OPTIONS
  const allOptValues: (StatusValue | null)[] = [null, ...STATUS_OPTIONS.map(o => o.value)]

  useEffect(() => {
    if (!open) return
    function onOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) { setOpen(false); setFocusedIdx(-1) }
    }
    setTimeout(() => document.addEventListener('mousedown', onOutside), 10)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [open])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(true); setFocusedIdx(0) }
      return
    }
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); setFocusedIdx(-1) }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setFocusedIdx(i => Math.min(i < 0 ? 0 : i + 1, allOptValues.length - 1)) }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); setFocusedIdx(i => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter' && focusedIdx >= 0) {
      e.preventDefault()
      const opt = allOptValues[focusedIdx]
      onChange(opt === null ? null : value === opt ? null : opt)
      setOpen(false); setFocusedIdx(-1)
    }
  }

  const selected = STATUS_OPTIONS.find(o => o.value === value)

  return (
    <>
      <style>{`@keyframes xp-status-drop-in{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}`}</style>
      <div ref={containerRef} style={{ position: 'relative' }} onKeyDown={handleKeyDown}>
        <button
          onClick={() => { setOpen(o => !o); setFocusedIdx(-1) }}
          aria-haspopup="listbox"
          aria-expanded={open}
          className="w-40 sm:w-auto"
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 20, fontSize: 11, fontWeight: 500, border: `1px solid ${value ? 'rgba(124,58,237,0.35)' : 'var(--xp-bdr2)'}`, background: value ? 'rgba(124,58,237,0.07)' : isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)', color: value ? '#7c3aed' : 'var(--xp-txt3)', cursor: 'pointer', whiteSpace: 'nowrap', outline: 'none' }}
        >
          {/* Mobile shows CTA placeholder; desktop shows existing None label */}
          <span className="sm:hidden">{value === null ? '👋 Today\'s Status' : `${selected!.icon} ${selected!.label}`}</span>
          <span className="hidden sm:inline">{value === null ? '🤷‍♂️ None' : `${selected!.icon} ${selected!.label}`}</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ width: 12, height: 12, flexShrink: 0, transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 200ms ease' }}>
            <polyline points="6 9 12 15 18 9" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {open && (
          <div
            role="listbox"
            aria-label="Productivity status"
            style={{ position: 'absolute', left: 0, top: 'calc(100% + 6px)', zIndex: 30, minWidth: 220, borderRadius: 14, overflow: 'hidden', background: isDark ? '#1a1530' : '#ffffff', border: `0.5px solid ${isDark ? 'rgba(124,58,237,0.30)' : 'rgba(124,58,237,0.18)'}`, boxShadow: isDark ? '0 16px 48px rgba(0,0,0,0.40)' : '0 12px 40px rgba(0,0,0,0.14)', animation: 'xp-status-drop-in 160ms cubic-bezier(0.16,1,0.3,1) forwards' }}
          >
            {/* None — clears productivity status */}
            <button
              role="option"
              aria-selected={value === null}
              onMouseEnter={() => setFocusedIdx(0)}
              onMouseLeave={() => setFocusedIdx(-1)}
              onClick={() => { onChange(null); setOpen(false); setFocusedIdx(-1) }}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', textAlign: 'left', cursor: 'pointer', border: 'none', outline: 'none', borderLeft: `2.5px solid ${value === null ? '#7c3aed' : 'transparent'}`, background: value === null ? 'rgba(124,58,237,0.09)' : focusedIdx === 0 ? 'rgba(124,58,237,0.05)' : 'transparent' }}
            >
              <span style={{ fontSize: 17, lineHeight: 1, flexShrink: 0 }}>🤷‍♂️</span>
              <span style={{ fontSize: 12, fontWeight: value === null ? 600 : 500, color: value === null ? '#7c3aed' : isDark ? 'rgba(255,255,255,0.85)' : '#111827', flex: 1 }}>None</span>
              {value === null && <svg viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="2.5" style={{ width: 13, height: 13, flexShrink: 0 }}><polyline points="20 6 9 17 4 12" strokeLinecap="round" strokeLinejoin="round" /></svg>}
            </button>
            <div style={{ height: '0.5px', background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)', margin: '0 14px' }} />
            {STATUS_OPTIONS.map((opt, i) => {
              const isAct = value === opt.value
              const isFoc = focusedIdx === i + 1
              return (
                <button
                  key={opt.value}
                  role="option"
                  aria-selected={isAct}
                  onMouseEnter={() => setFocusedIdx(i + 1)}
                  onMouseLeave={() => setFocusedIdx(-1)}
                  onClick={() => { onChange(isAct ? null : opt.value); setOpen(false); setFocusedIdx(-1) }}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', textAlign: 'left', cursor: 'pointer', border: 'none', outline: 'none', borderLeft: `2.5px solid ${isAct ? '#7c3aed' : 'transparent'}`, background: isAct ? 'rgba(124,58,237,0.09)' : isFoc ? 'rgba(124,58,237,0.05)' : 'transparent' }}
                >
                  <span style={{ fontSize: 17, lineHeight: 1, flexShrink: 0 }}>{opt.icon}</span>
                  <span style={{ fontSize: 12, fontWeight: isAct ? 600 : 500, color: isAct ? '#7c3aed' : isDark ? 'rgba(255,255,255,0.85)' : '#111827', flex: 1 }}>{opt.label}</span>
                  {isAct && <svg viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="2.5" style={{ width: 13, height: 13, flexShrink: 0 }}><polyline points="20 6 9 17 4 12" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}

// ─── Activity / Category Dropdown ────────────────────────────────────────────

interface ActivityDropdownProps {
  value: string
  onChange: (actId: string) => void
  activities: Activity[]
  isDark: boolean
}

function ActivityDropdown({ value, onChange, activities, isDark }: ActivityDropdownProps) {
  const [open,       setOpen]       = useState(false)
  const [focusedIdx, setFocusedIdx] = useState(-1)
  const [openUp,     setOpenUp]     = useState(false)
  const containerRef                = useRef<HTMLDivElement>(null)

  const selected  = activities.find(a => a.id === value)
  // Option order: index 0 = "Category" (no selection), indices 1+ = activities
  const allOpts   = [{ id: '', name: 'Category', color: '' } as { id: string; name: string; color: string }, ...activities]

  useEffect(() => {
    if (!open) return
    function onOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) { setOpen(false); setFocusedIdx(-1) }
    }
    setTimeout(() => document.addEventListener('mousedown', onOutside), 10)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [open])

  function handleOpen() {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect()
      setOpenUp(window.innerHeight - rect.bottom < 240)
    }
    setOpen(o => !o)
    setFocusedIdx(-1)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleOpen(); setFocusedIdx(0) }
      return
    }
    if (e.key === 'Escape')     { e.preventDefault(); setOpen(false); setFocusedIdx(-1) }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setFocusedIdx(i => Math.min(i < 0 ? 0 : i + 1, allOpts.length - 1)) }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); setFocusedIdx(i => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter' && focusedIdx >= 0) {
      e.preventDefault()
      onChange(allOpts[focusedIdx]?.id ?? '')
      setOpen(false); setFocusedIdx(-1)
    }
  }

  const dropdownStyle: React.CSSProperties = {
    position: 'absolute',
    right: 0,
    zIndex: 50,
    minWidth: 180,
    borderRadius: 12,
    overflow: 'hidden',
    background: isDark ? '#1a1530' : '#ffffff',
    border: `0.5px solid ${isDark ? 'rgba(124,58,237,0.30)' : 'rgba(124,58,237,0.18)'}`,
    boxShadow: isDark ? '0 12px 36px rgba(0,0,0,0.40)' : '0 8px 28px rgba(0,0,0,0.12)',
    animation: `${openUp ? 'xp-act-drop-up' : 'xp-act-drop-in'} 180ms cubic-bezier(0.16,1,0.3,1) forwards`,
  }
  if (openUp) { dropdownStyle.bottom = 'calc(100% + 4px)' } else { dropdownStyle.top = 'calc(100% + 4px)' }

  return (
    <>
      <style>{`@keyframes xp-act-drop-in{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}@keyframes xp-act-drop-up{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}`}</style>
      <div ref={containerRef} style={{ position: 'relative', width: PILL_W, flexShrink: 0 }} onKeyDown={handleKeyDown}>
        {/* Trigger pill */}
        <button
          onClick={handleOpen}
          aria-haspopup="listbox"
          aria-expanded={open}
          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 4, padding: '3px 6px 3px 7px', borderRadius: 7, cursor: 'pointer', outline: 'none', border: `0.5px solid ${selected ? selected.color + '55' : 'var(--xp-bdr2)'}`, background: selected ? `${selected.color}18` : 'var(--xp-bg2)' }}
        >
          {selected && <span style={{ width: 6, height: 6, borderRadius: '50%', background: selected.color, flexShrink: 0, display: 'inline-block' }} />}
          <span style={{ fontSize: 10, fontWeight: 500, color: selected ? selected.color : 'var(--xp-txt3)', flex: 1, minWidth: 0, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {selected?.name ?? 'Category'}
          </span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ width: 9, height: 9, flexShrink: 0, color: selected ? selected.color : 'var(--xp-txt3)', opacity: 0.7, transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 200ms ease' }}>
            <polyline points="6 9 12 15 18 9" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {/* Dropdown list */}
        {open && (
          <div role="listbox" aria-label="Task category" style={dropdownStyle}>
            {/* No-category option */}
            <button
              role="option"
              aria-selected={!value}
              onMouseEnter={() => setFocusedIdx(0)}
              onMouseLeave={() => setFocusedIdx(-1)}
              onClick={() => { onChange(''); setOpen(false); setFocusedIdx(-1) }}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', textAlign: 'left', cursor: 'pointer', border: 'none', outline: 'none', borderLeft: `2.5px solid ${!value ? '#7c3aed' : 'transparent'}`, background: !value ? 'rgba(124,58,237,0.09)' : focusedIdx === 0 ? (isDark ? 'rgba(124,58,237,0.07)' : 'rgba(124,58,237,0.10)') : 'transparent', transition: 'background 160ms ease' }}
            >
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.14)', flexShrink: 0 }} />
              <span style={{ fontSize: 11, fontWeight: !value ? 600 : (focusedIdx === 0 && !isDark) ? 500 : 400, color: !value ? '#7c3aed' : isDark ? 'rgba(255,255,255,0.50)' : (focusedIdx === 0 ? '#6b7280' : '#9ca3af'), flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Category</span>
              {!value && <svg viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="2.5" style={{ width: 12, height: 12, flexShrink: 0 }}><polyline points="20 6 9 17 4 12" strokeLinecap="round" strokeLinejoin="round" /></svg>}
            </button>

            {activities.length > 0 && <div style={{ height: '0.5px', background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)', margin: '0 12px' }} />}

            {activities.map((act, i) => {
              const isSelected = value === act.id
              const isFocused  = focusedIdx === i + 1
              return (
                <button
                  key={act.id}
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setFocusedIdx(i + 1)}
                  onMouseLeave={() => setFocusedIdx(-1)}
                  onClick={() => { onChange(act.id); setOpen(false); setFocusedIdx(-1) }}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', textAlign: 'left', cursor: 'pointer', border: 'none', outline: 'none', borderLeft: `2.5px solid ${isSelected ? '#7c3aed' : 'transparent'}`, background: isSelected ? 'rgba(124,58,237,0.09)' : isFocused ? (isDark ? `${act.color}14` : 'rgba(124,58,237,0.10)') : 'transparent', transition: 'background 160ms ease' }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: act.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 11, fontWeight: isSelected ? 600 : (isFocused && !isDark) ? 600 : 500, color: isSelected ? '#7c3aed' : isDark ? 'rgba(255,255,255,0.85)' : '#111827', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{act.name}</span>
                  {isSelected && <svg viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="2.5" style={{ width: 12, height: 12, flexShrink: 0 }}><polyline points="20 6 9 17 4 12" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}

// ─── Journal border animation ─────────────────────────────────────────────────

function JournalBorderAnim({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 1000)
    return () => clearTimeout(t)
  }, [onDone])
  return (
    <>
      <style>{`
        @keyframes xp-jb-draw {
          0%   { stroke-dashoffset: 2000; opacity: 1 }
          80%  { stroke-dashoffset: 0;    opacity: 1 }
          100% { stroke-dashoffset: 0;    opacity: 0 }
        }
        @keyframes xp-jb-nomotion {
          0%   { opacity: 0.7; stroke-dashoffset: 0 }
          100% { opacity: 0;   stroke-dashoffset: 0 }
        }
        @media (prefers-reduced-motion: reduce) {
          .xp-jb-path { animation: xp-jb-nomotion 500ms ease forwards !important }
        }
      `}</style>
      <svg
        aria-hidden="true"
        width="100%" height="100%"
        style={{ position: 'absolute', inset: -1.5, width: 'calc(100% + 3px)', height: 'calc(100% + 3px)', pointerEvents: 'none', overflow: 'visible', zIndex: 1 }}
      >
        <defs>
          <linearGradient id="xp-jb-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%"   stopColor="#a855f7" />
            <stop offset="50%"  stopColor="#c084fc" />
            <stop offset="100%" stopColor="#ec4899" />
          </linearGradient>
          <filter id="xp-jb-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2.5" result="blur"/>
            <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>
        <rect
          x="0" y="0" width="100%" height="100%"
          rx="12" ry="12"
          fill="none"
          stroke="url(#xp-jb-grad)"
          strokeWidth="2"
          filter="url(#xp-jb-glow)"
          className="xp-jb-path"
          strokeDasharray="2000 2000"
          strokeDashoffset="2000"
          style={{ animation: 'xp-jb-draw 900ms cubic-bezier(0.25,0.46,0.45,0.94) forwards' }}
        />
      </svg>
    </>
  )
}

// ─── DayModal ─────────────────────────────────────────────────────────────────

interface DayModalProps {
  dateKey: string
  month: number
  day: number
  onClose: () => void
  onDashboard?: () => void
  onDirtyChange?: (dirty: boolean) => void
  onNavigateDay?: (delta: number) => void
  onGoToToday?: () => void
  closeIntent?: 'save' | 'discard' | null
  skipEntryAnimation?: boolean
}

export function DayModal({ dateKey, month, day, onClose, onDashboard, onDirtyChange, onNavigateDay, onGoToToday, closeIntent, skipEntryAnimation }: DayModalProps) {
  const {
    calData, updateDay, activeTaskTimer, setActiveTaskTimer,
    activities, activeSession, setActiveSession, selectedActId,
    reminders, isDark, setToast, sessions, effectiveTimezone, effectiveLocale,
  } = useApp()

  useLockBodyScroll()

  const dayData = calData[dateKey] ?? { ...EMPTY_DAY }

  const currentStatus: StatusValue | null =
    dayData.milestone ? 'milestone' : dayData.hyper ? 'hyper' : dayData.goal ? 'goal' : dayData.productive ? 'productive' : null

  function handleStatusSelect(newValue: StatusValue | null) {
    const wasGoal = !!dayData.goal
    updateDay(dateKey, prev => {
      if (newValue === null)         return { ...prev, productive: false, hyper: false, milestone: false, goal: false }
      if (newValue === 'productive') return { ...prev, productive: true,  hyper: false, milestone: false, goal: false }
      if (newValue === 'hyper')      return { ...prev, productive: true,  hyper: true,  milestone: false, goal: false }
      if (newValue === 'milestone')  return { ...prev, productive: true,  hyper: false, milestone: true,  goal: false }
      return                                { ...prev, productive: true,  hyper: false, milestone: false, goal: true  }
    })
    if (newValue === 'goal' && !wasGoal) setShowConfetti(true)
  }

  const [addingTask,       setAddingTask]       = useState(false)
  const [newTaskText,      setNewTaskText]       = useState('')
  const [editingTaskId,    setEditingTaskId]     = useState<string | null>(null)
  const [notesOpen,        setNotesOpen]         = useState(false)
  const [now,              setNow]               = useState(Date.now())
  const [dragItemId,       setDragItemId]        = useState<string | null>(null)
  const [showConfetti,     setShowConfetti]      = useState(false)
  const [reminderTaskId,   setReminderTaskId]    = useState<string | null>(null)
  const [transferTaskId,   setTransferTaskId]    = useState<string | null>(null)
  const [reminderSavedKey, setReminderSavedKey]  = useState<Record<string, number>>({})
  const [expandedTaskId,   setExpandedTaskId]    = useState<string | null>(null)
  const [dirtyNotesMap,    setDirtyNotesMap]     = useState<Record<string, string>>({})
  const [showCloseDialog,  setShowCloseDialog]   = useState(false)
  const [journalAnimKey,   setJournalAnimKey]    = useState(0)
  const [journalSaved,     setJournalSaved]      = useState(false)
  const [mainSaving,       setMainSaving]        = useState(false)
  const [isMounted, setIsMounted] = useState(skipEntryAnimation ?? false)
  const [isClosing, setIsClosing] = useState(false)
  // Hierarchy & clipboard state
  const [expandedParents,  setExpandedParents]  = useState<Set<string>>(new Set())
  const [pendingDeleteId,  setPendingDeleteId]  = useState<string | null>(null)
  const [taskClipboard,    setTaskClipboard]    = useState<ClipboardTask | null>(() => {
    try { const s = localStorage.getItem('xp9-task-clipboard'); return s ? JSON.parse(s) : null } catch { return null }
  })
  // Task organisation modes
  const [reorderMode,    setReorderMode]    = useState(false)
  const [deleteMode,     setDeleteMode]     = useState(false)
  const [selectedForDel, setSelectedForDel] = useState<Set<string>>(new Set())
  const [deleteConfirm,  setDeleteConfirm]  = useState(false)
  const journalSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevNotesOpenRef    = useRef(false)
  const openSnapshotRef     = useRef<typeof dayData | null>(null)
  const onConfettiDone = useCallback(() => setShowConfetti(false), [])

  // ── Reorder Mode — real-time sortable drag (mouse + touch), replacing the
  // old handle-only HTML5 drag/drop (which never fires on most mobile
  // browsers — HTML5 DnD is effectively desktop-mouse-only) AND the earlier
  // "reorder on drop only" pointer version. Kept fully separate from the
  // pre-existing dragItemId/dragOverId/handleReorderDrop machinery above
  // (left untouched) to avoid any risk to that code path.
  //
  // Architecture: `localOrder` is a purely-visual top-level task-id order
  // used ONLY while a drag is in progress (null the rest of the time, in
  // which case rendering falls back to dayData.tasks' real order). Crossing
  // into another row during the drag reorders `localOrder` immediately (so
  // the prospective final order is always visible), but never touches
  // dayData/Supabase — that only happens ONCE, on drop, via commitLocalOrder.
  // This satisfies "no intermediate writes" while still giving instant,
  // fully live visual feedback.
  //
  // The dragged row's own "follow the finger" motion and every displaced
  // sibling's "slide out of the way" motion are both done with the FLIP
  // technique (measure before reorder → let React reflow → invert the
  // resulting jump with a transform → play it back to zero), applied via
  // direct DOM style writes through refs rather than React state, so it
  // stays smooth at 60fps regardless of render cost elsewhere in the modal.
  const [dragTaskId, setDragTaskId] = useState<string | null>(null)
  const [localOrder, setLocalOrder]  = useState<string[] | null>(null)
  const dragTaskIdRef       = useRef<string | null>(null)
  const localOrderRef       = useRef<string[] | null>(null)
  const activePointerIdRef  = useRef<number | null>(null)
  const pointerYRef         = useRef<number>(0)
  const dragOriginRef       = useRef<{ pointerY: number; naturalTop: number } | null>(null)
  const pendingFlipTopsRef  = useRef<Map<string, number> | null>(null)
  const rowElRefs           = useRef<Map<string, HTMLDivElement>>(new Map())
  const scrollBodyRef       = useRef<HTMLDivElement | null>(null)
  const autoScrollFrameRef  = useRef<number | null>(null)

  function getTopLevelOrderIds(): string[] {
    return dayData.tasks.filter(t => !t.parentTaskId).map(t => t.id)
  }

  // Commits the final visual order to real data — called ONCE, on drop.
  // Moves each top-level task's complete family (itself + its sub-tasks,
  // sessions, attachments etc. are all part of the same Task object, so
  // nothing needs to be individually re-attached) as one unit.
  function commitLocalOrder(order: string[]) {
    updateDay(dateKey, prev => {
      const all = prev.tasks
      const result: Task[] = []
      const placed = new Set<string>()
      order.forEach(id => {
        const top = all.find(t => t.id === id && !t.parentTaskId)
        if (!top || placed.has(id)) return
        placed.add(id)
        result.push(top, ...all.filter(t => t.parentTaskId === id))
      })
      // Safety net: any top-level task not present in `order` (should not
      // happen — order is always seeded from the live list) keeps its family
      // and is appended rather than silently dropped.
      all.forEach(t => {
        if (!t.parentTaskId && !placed.has(t.id)) { placed.add(t.id); result.push(t, ...all.filter(c => c.parentTaskId === t.id)) }
      })
      return { ...prev, tasks: result }
    })
  }

  function measureRowTops(excludeId?: string): Map<string, number> {
    const map = new Map<string, number>()
    rowElRefs.current.forEach((el, id) => { if (id !== excludeId) map.set(id, el.offsetTop) })
    return map
  }

  // Plays the FLIP "slide into place" animation for every displaced sibling
  // after a reorder has already been committed to the DOM (i.e. call from
  // inside a layout effect keyed on `localOrder`, after React has reflowed).
  function playFlip(prevTops: Map<string, number>) {
    rowElRefs.current.forEach((el, id) => {
      if (id === dragTaskIdRef.current) return
      const prevTop = prevTops.get(id)
      if (prevTop == null) return
      const delta = prevTop - el.offsetTop
      if (delta === 0) return
      el.style.transition = 'none'
      el.style.transform = `translateY(${delta}px)`
      void el.offsetHeight // force reflow so the browser registers the start position
      requestAnimationFrame(() => {
        el.style.transition = 'transform 180ms cubic-bezier(0.2,0,0.2,1)'
        el.style.transform = ''
      })
    })
  }

  // Keeps the dragged row tightly coupled to the pointer: its natural DOM
  // position changes every time it's reordered underneath the pointer, so
  // the transform is always computed relative to a FIXED origin (position +
  // pointer Y at drag start) rather than accumulated, which is what lets it
  // track the finger/cursor continuously instead of drifting or jumping.
  function applyDragTransform(clientY: number) {
    const id = dragTaskIdRef.current
    const origin = dragOriginRef.current
    if (!id || !origin) return
    const el = rowElRefs.current.get(id)
    if (!el) return
    const naturalShift = el.offsetTop - origin.naturalTop
    el.style.transition = 'none'
    el.style.transform = `translateY(${clientY - origin.pointerY - naturalShift}px)`
  }

  function clearRowTransforms() {
    rowElRefs.current.forEach(el => { el.style.transition = ''; el.style.transform = '' })
  }

  // Local-only reorder: moves dragId to sit where targetId currently is.
  // One swap per crossed row — repeated crossings accumulate into exactly
  // the "drag past B, then C, then D" progression the list should show.
  function reorderLocal(dragId: string, targetId: string) {
    const base = localOrderRef.current ?? getTopLevelOrderIds()
    const without = base.filter(id => id !== dragId)
    const insertAt = without.indexOf(targetId)
    if (insertAt === -1) return
    const next = [...without.slice(0, insertAt), dragId, ...without.slice(insertAt)]
    localOrderRef.current = next
    setLocalOrder(next)
  }

  function runReorderAutoScroll() {
    const el = scrollBodyRef.current
    if (!el || dragTaskIdRef.current == null) { autoScrollFrameRef.current = null; return }
    const rect = el.getBoundingClientRect()
    const EDGE = 60, MAX_SPEED = 14
    const y = pointerYRef.current
    let dy = 0
    if (y < rect.top + EDGE)         dy = -MAX_SPEED * (1 - Math.max(0, y - rect.top) / EDGE)
    else if (y > rect.bottom - EDGE) dy = MAX_SPEED * (1 - Math.max(0, rect.bottom - y) / EDGE)
    if (dy !== 0) el.scrollTop += dy
    autoScrollFrameRef.current = requestAnimationFrame(runReorderAutoScroll)
  }

  function isReorderDragBlocked(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false
    return !!target.closest('button, input, textarea, select, a, [contenteditable="true"], [data-no-drag]')
  }

  function onReorderPointerDown(e: React.PointerEvent, topLevelId: string) {
    if (!reorderMode) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if (isReorderDragBlocked(e.target)) return
    e.preventDefault()
    activePointerIdRef.current = e.pointerId
    dragTaskIdRef.current = topLevelId
    setDragTaskId(topLevelId)
    const order = getTopLevelOrderIds()
    localOrderRef.current = order
    setLocalOrder(order)
    pointerYRef.current = e.clientY
    const el = rowElRefs.current.get(topLevelId)
    dragOriginRef.current = { pointerY: e.clientY, naturalTop: el ? el.offsetTop : 0 }
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch {}
    if (autoScrollFrameRef.current == null) autoScrollFrameRef.current = requestAnimationFrame(runReorderAutoScroll)
  }

  function onReorderPointerMove(e: React.PointerEvent) {
    if (dragTaskIdRef.current == null || e.pointerId !== activePointerIdRef.current) return
    pointerYRef.current = e.clientY
    applyDragTransform(e.clientY)
    const dragId = dragTaskIdRef.current
    const order = localOrderRef.current ?? []
    for (const id of order) {
      if (id === dragId) continue
      const el = rowElRefs.current.get(id)
      if (!el) continue
      const rect = el.getBoundingClientRect()
      if (e.clientY >= rect.top && e.clientY <= rect.bottom) {
        pendingFlipTopsRef.current = measureRowTops(dragId)
        reorderLocal(dragId, id)
        break
      }
    }
  }

  // After every `localOrder` change (i.e. every live reorder while
  // dragging), the DOM has already reflowed by the time this runs — play
  // the FLIP animation for displaced siblings and re-pin the dragged row's
  // transform to the pointer using its new natural position.
  useLayoutEffect(() => {
    if (localOrder == null) return
    const prevTops = pendingFlipTopsRef.current
    if (prevTops) { playFlip(prevTops); pendingFlipTopsRef.current = null }
    applyDragTransform(pointerYRef.current)
  }, [localOrder])

  // commit=true on a real drop (pointerup): persist the live order shown.
  // commit=false on a cancelled/interrupted drag (pointercancel): discard the
  // in-progress local order instead — since dayData was never touched during
  // the drag, simply not committing is enough to fall back to the last
  // genuinely-saved order, with zero risk of corrupting/duplicating/losing
  // tasks either way.
  function endReorderPointerDrag(e: React.PointerEvent, commit: boolean) {
    if (dragTaskIdRef.current == null) return
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch {}
    const finalOrder = localOrderRef.current
    if (commit && finalOrder) commitLocalOrder(finalOrder)
    clearRowTransforms()
    dragTaskIdRef.current = null
    activePointerIdRef.current = null
    localOrderRef.current = null
    dragOriginRef.current = null
    pendingFlipTopsRef.current = null
    setDragTaskId(null)
    setLocalOrder(null)
    if (autoScrollFrameRef.current != null) { cancelAnimationFrame(autoScrollFrameRef.current); autoScrollFrameRef.current = null }
  }

  const hasDirtyChanges = useMemo(() => {
    if (newTaskText.trim().length > 0) return true
    if (Object.keys(dirtyNotesMap).length > 0) return true
    if (!openSnapshotRef.current) return false
    return JSON.stringify(calData[dateKey] ?? EMPTY_DAY) !== JSON.stringify(openSnapshotRef.current)
  }, [newTaskText, dirtyNotesMap, calData, dateKey])

  // Locale-aware: e.g. "Friday, September 25, 2026" (en-US) vs
  // "Friday, 25 September 2026" (en-GB) — real Intl formatting, not just a
  // hardcoded en-US string.
  const dateLabel = useMemo(() => {
    const d = new Date(APP_YEAR, month, day)
    return new Intl.DateTimeFormat(effectiveLocale, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(d)
  }, [month, day, effectiveLocale])

  // Notify parent whenever dirty state changes (for nav guard)
  useEffect(() => {
    onDirtyChange?.(hasDirtyChanges)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasDirtyChanges])

  // External close intent from parent (nav guard: 'save' or 'discard')
  useEffect(() => {
    if (!closeIntent) return
    if (closeIntent === 'save') {
      flushDirtyNotes()
      openSnapshotRef.current = null
      setNewTaskText('')
      setAddingTask(false)
      doClose()
    } else if (closeIntent === 'discard') {
      if (openSnapshotRef.current) {
        updateDay(dateKey, () => openSnapshotRef.current!)
      }
      setDirtyNotesMap({})
      setNewTaskText('')
      setAddingTask(false)
      doClose()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closeIntent])

  const isActiveHere  = activeTaskTimer?.dateKey === dateKey
  const isSessionHere = activeSession?.dateKey === dateKey

  useEffect(() => {
    if (!isActiveHere && !isSessionHere) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [isActiveHere, isSessionHere])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (hasDirtyChanges) { setShowCloseDialog(true) } else { doClose() }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasDirtyChanges, onClose])

  // Detect journal opening: play border animation
  useEffect(() => {
    if (notesOpen && !prevNotesOpenRef.current) setJournalAnimKey(k => k + 1)
    prevNotesOpenRef.current = notesOpen
  }, [notesOpen])

  // Total Focus Time Today — productive activities only; Meal/Break excluded
  const totalFocusMsToday = useMemo(() => {
    const workMs   = sessions
      .filter(s => s.dateKey === dateKey && s.endTs !== null && isProductiveActivity(activities, s.actId))
      .reduce((sum, s) => sum + (s.endTs! - s.startTs), 0)
    // Clock-in-linked tasks are excluded: their time is already captured by the WorkSession in workMs
    const taskMs   = (dayData.tasks ?? [])
      .filter(task => !task.linkedSessionId && isProductiveActivity(activities, task.actId))
      .reduce((t, task) => t + (task.sessions ?? []).filter(s => s.endTs !== null).reduce((sum, s) => sum + (s.endTs! - s.startTs), 0), 0)
    const activeMs = isSessionHere && isProductiveActivity(activities, activeSession!.actId)
      ? Math.max(0, now - activeSession!.startTs) : 0
    return workMs + taskMs + activeMs
  }, [sessions, activities, dayData.tasks, activeSession, isSessionHere, dateKey, now])

  // On open: snapshot for dirty-change detection
  useEffect(() => {
    const base: DayData = JSON.parse(JSON.stringify(calData[dateKey] ?? EMPTY_DAY))
    openSnapshotRef.current = base
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // One-time dedup on open
  useEffect(() => {
    updateDay(dateKey, prev => {
      const nextTasks = prev.tasks.map(t => {
        const cleaned = deduplicateTaskSessions(t.sessions ?? [])
        return cleaned.length !== (t.sessions ?? []).length ? { ...t, sessions: cleaned } : t
      })
      return nextTasks.some((t, i) => t !== prev.tasks[i]) ? { ...prev, tasks: nextTasks } : prev
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Mount/unmount animation
  useEffect(() => {
    const raf = requestAnimationFrame(() => setIsMounted(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  // ── Task CRUD ─────────────────────────────────────────────────────────────

  function makeTask(text: string): Task {
    return { id: 't' + Date.now() + Math.random().toString(36).slice(2), text, done: false, journal: '', timerStart: null, timerEnd: null, actId: activities[0]?.id ?? '', sessions: [] }
  }

  function addTask(text?: string) {
    const t = (text ?? newTaskText).trim()
    if (!t) return
    const newTask = makeTask(t)
    updateDay(dateKey, prev => ({ ...prev, tasks: [...prev.tasks, newTask] }))
    setNewTaskText('')
    setAddingTask(false)
    setEditingTaskId(newTask.id)
    setTimeout(() => {
      document.getElementById(`xp-task-${newTask.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }, 60)
  }

  function generateTasks() {
    const existing = new Set(dayData.tasks.map(t => t.text))
    const toAdd    = GENERATED_TASKS.filter(t => !existing.has(t))
    if (!toAdd.length) return
    updateDay(dateKey, prev => ({ ...prev, tasks: [...prev.tasks, ...toAdd.map(t => makeTask(t))] }))
  }

  function toggleTask(id: string) {
    updateDay(dateKey, prev => ({ ...prev, tasks: prev.tasks.map(t => t.id === id ? { ...t, done: !t.done } : t) }))
  }

  function deleteTask(id: string) {
    const children = dayData.tasks.filter(t => t.parentTaskId === id)
    if (children.length > 0) { setPendingDeleteId(id); return }
    doDeleteTask(id)
  }

  function doDeleteTask(id: string) {
    const childIds = dayData.tasks.filter(t => t.parentTaskId === id).map(t => t.id)
    const idsToDelete = new Set([id, ...childIds])
    childIds.forEach(cid => { if (activeTaskTimer?.taskId === cid) setActiveTaskTimer(null) })
    if (activeTaskTimer?.taskId === id) setActiveTaskTimer(null)
    updateDay(dateKey, prev => ({ ...prev, tasks: prev.tasks.filter(t => !idsToDelete.has(t.id)) }))
    if (expandedTaskId === id || childIds.includes(expandedTaskId ?? '')) setExpandedTaskId(null)
    setDirtyNotesMap(prev => {
      const next = { ...prev }
      idsToDelete.forEach(did => { delete next[did] })
      return next
    })
    setExpandedParents(prev => { const n = new Set(prev); n.delete(id); return n })
    setPendingDeleteId(null)
  }

  function setTaskColor(taskId: string, color: string) {
    updateDay(dateKey, prev => ({ ...prev, tasks: prev.tasks.map(t => t.id === taskId ? { ...t, taskColor: color } : t) }))
  }

  function toggleTaskPriority(taskId: string) {
    updateDay(dateKey, prev => ({ ...prev, tasks: prev.tasks.map(t => t.id === taskId ? { ...t, isPriority: !t.isPriority } : t) }))
  }

  function toggleDeleteSelect(taskId: string) {
    setSelectedForDel(prev => { const n = new Set(prev); n.has(taskId) ? n.delete(taskId) : n.add(taskId); return n })
  }

  function executeDeleteSelected() {
    const toDelete = new Set<string>()
    selectedForDel.forEach(id => {
      toDelete.add(id)
      dayData.tasks.forEach(t => { if (t.parentTaskId === id) toDelete.add(t.id) })
    })
    toDelete.forEach(id => { if (activeTaskTimer?.taskId === id) setActiveTaskTimer(null) })
    updateDay(dateKey, prev => ({ ...prev, tasks: prev.tasks.filter(t => !toDelete.has(t.id)) }))
    setDirtyNotesMap(prev => { const n = { ...prev }; toDelete.forEach(id => delete n[id]); return n })
    setExpandedParents(prev => { const n = new Set(prev); toDelete.forEach(id => n.delete(id)); return n })
    setSelectedForDel(new Set()); setDeleteMode(false); setDeleteConfirm(false)
  }

  function handleReorderDrop(targetTopLevelId: string) {
    if (!dragItemId || dragItemId === targetTopLevelId) { setDragItemId(null); return }
    const all = [...dayData.tasks]
    const dragged = all.find(t => t.id === dragItemId)
    if (!dragged || dragged.parentTaskId) { setDragItemId(null); return }
    const dragFamily = all.filter(t => t.id === dragItemId || t.parentTaskId === dragItemId)
    const dragIds = new Set(dragFamily.map(t => t.id))
    const remaining = all.filter(t => !dragIds.has(t.id))
    let insertAt = remaining.length
    for (let i = remaining.length - 1; i >= 0; i--) {
      if (remaining[i].id === targetTopLevelId || remaining[i].parentTaskId === targetTopLevelId) {
        insertAt = i + 1; break
      }
    }
    const result = [...remaining.slice(0, insertAt), ...dragFamily, ...remaining.slice(insertAt)]
    updateDay(dateKey, prev => ({ ...prev, tasks: result }))
    setDragItemId(null)
  }

  function duplicateTask(id: string) {
    const src = dayData.tasks.find(t => t.id === id); if (!src) return
    const copy = makeTask(src.text + ' (copy)'); copy.actId = src.actId
    updateDay(dateKey, prev => {
      const idx  = prev.tasks.findIndex(t => t.id === id)
      const next = [...prev.tasks]; next.splice(idx + 1, 0, copy)
      return { ...prev, tasks: next }
    })
  }

  function copyTask(id: string) {
    const task = dayData.tasks.find(t => t.id === id); if (!task) return
    const children = dayData.tasks
      .filter(t => t.parentTaskId === id)
      .map(c => ({ text: c.text, actId: c.actId, journal: c.journal, taskColor: c.taskColor, isPriority: c.isPriority }))
    const clip: ClipboardTask = { text: task.text, actId: task.actId, journal: task.journal, taskColor: task.taskColor, isPriority: task.isPriority, children }
    try { localStorage.setItem('xp9-task-clipboard', JSON.stringify(clip)) } catch {}
    setTaskClipboard(clip)
    setToast('Task copied to clipboard ✓')
  }

  function pasteTask() {
    if (!taskClipboard) return
    const ts = Date.now()
    const newParentId = 't' + ts + Math.random().toString(36).slice(2, 6)
    const newParent: Task = {
      id: newParentId, text: taskClipboard.text, actId: taskClipboard.actId,
      journal: taskClipboard.journal, done: false, timerStart: null, timerEnd: null, sessions: [],
      taskColor: taskClipboard.taskColor, isPriority: taskClipboard.isPriority,
    }
    const newChildren: Task[] = taskClipboard.children.map((c, i) => ({
      id: 't' + (ts + i + 1) + Math.random().toString(36).slice(2, 6),
      text: c.text, actId: c.actId, journal: c.journal,
      done: false, timerStart: null, timerEnd: null, sessions: [],
      parentTaskId: newParentId, taskColor: c.taskColor, isPriority: c.isPriority,
    }))
    updateDay(dateKey, prev => ({ ...prev, tasks: [...prev.tasks, newParent, ...newChildren] }))
    if (newChildren.length > 0) setExpandedParents(prev => new Set([...prev, newParentId]))
    // Single-use: consume clipboard immediately so paste cannot repeat
    setTaskClipboard(null)
    try { localStorage.removeItem('xp9-task-clipboard') } catch {}
    setToast('Task pasted ✓')
  }

  function createSubTask(parentId: string) {
    const parent = dayData.tasks.find(t => t.id === parentId); if (!parent) return
    const childId = 't' + Date.now() + Math.random().toString(36).slice(2, 6)
    const child: Task = {
      id: childId, text: '', actId: parent.actId, journal: '',
      done: false, timerStart: null, timerEnd: null, sessions: [],
      parentTaskId: parentId,
    }
    updateDay(dateKey, prev => {
      const tasks = [...prev.tasks]
      const lastSiblingIdx = tasks.reduce((acc, t, i) => t.parentTaskId === parentId ? i : acc, -1)
      const parentIdx = tasks.findIndex(t => t.id === parentId)
      const insertAfter = lastSiblingIdx >= 0 ? lastSiblingIdx : parentIdx
      tasks.splice(insertAfter + 1, 0, child)
      return { ...prev, tasks }
    })
    setExpandedParents(prev => new Set([...prev, parentId]))
    setEditingTaskId(childId)
    setTimeout(() => document.getElementById(`xp-task-${childId}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 80)
  }

  function toggleParentExpand(parentId: string) {
    setExpandedParents(prev => { const n = new Set(prev); n.has(parentId) ? n.delete(parentId) : n.add(parentId); return n })
  }

  function updateTaskText(id: string, text: string) {
    updateDay(dateKey, prev => ({ ...prev, tasks: prev.tasks.map(t => t.id === id ? { ...t, text } : t) }))
  }
  function updateTaskAct(id: string, actId: string) {
    updateDay(dateKey, prev => ({ ...prev, tasks: prev.tasks.map(t => t.id === id ? { ...t, actId } : t) }))
  }
  function updateTaskJournal(id: string, journal: string) {
    updateDay(dateKey, prev => ({ ...prev, tasks: prev.tasks.map(t => t.id === id ? { ...t, journal } : t) }))
  }
  function updateTaskAttachments(id: string, attachments: TaskAttachment[]) {
    updateDay(dateKey, prev => ({ ...prev, tasks: prev.tasks.map(t => t.id === id ? { ...t, attachments } : t) }))
  }

  // ── Notes dirty-state helpers ─────────────────────────────────────────────

  function handleNotesDraftChange(taskId: string, text: string) {
    const savedJournal = (calData[dateKey]?.tasks ?? []).find(t => t.id === taskId)?.journal ?? ''
    setDirtyNotesMap(prev => {
      if (text === savedJournal) { const { [taskId]: _, ...rest } = prev; return rest }
      return { ...prev, [taskId]: text }
    })
  }

  function saveTaskNotes(taskId: string) {
    const draft = dirtyNotesMap[taskId]
    if (draft === undefined) return
    updateTaskJournal(taskId, draft)
    setDirtyNotesMap(prev => { const { [taskId]: _, ...rest } = prev; return rest })
    setToast('Notes saved ✓')
  }

  function flushDirtyNotes() {
    for (const [taskId, draft] of Object.entries(dirtyNotesMap)) {
      updateTaskJournal(taskId, draft)
    }
    setDirtyNotesMap({})
  }

  function doClose() {
    setIsClosing(true)
    setTimeout(onClose, 210)
  }

  function attemptClose() {
    if (hasDirtyChanges) { setShowCloseDialog(true) } else { doClose() }
  }

  // The parent remounts this modal fresh for the new date (key={dateKey} on
  // <DayModal>), which is the same safe initialization path every normal
  // open already uses — so navigating never needs a second data-loading
  // system. It's only blocked while something is genuinely unsaved (an
  // in-progress "+ Add Task" input, or a still-unsettled notes edit), the
  // same condition that already gates the Close button.
  function attemptNavigateDay(delta: number) {
    if (hasDirtyChanges) { setToast('Finish or save your current changes before switching days'); return }
    onNavigateDay?.(delta)
  }

  function attemptGoToToday() {
    if (hasDirtyChanges) { setToast('Finish or save your current changes before switching days'); return }
    onGoToToday?.()
  }

  const isViewingToday = dateKey === todayKey(effectiveTimezone)

  function handleMainSave() {
    flushDirtyNotes()
    openSnapshotRef.current = null
    setNewTaskText('')
    setAddingTask(false)
    setMainSaving(true)
    setTimeout(doClose, 620)
  }

  function discardAndClose() {
    if (openSnapshotRef.current) {
      updateDay(dateKey, () => openSnapshotRef.current!)
    }
    setDirtyNotesMap({})
    setNewTaskText('')
    setAddingTask(false)
    setShowCloseDialog(false)
    doClose()
  }

  // ── Timers ────────────────────────────────────────────────────────────────

  function startTimer(taskId: string, taskIndex: number) {
    const task = dayData.tasks.find(t => t.id === taskId); if (!task) return
    // Global mutual exclusion: block if any other timer is already running — this
    // also covers an independent Calendar Clock-In with no linked task timer,
    // since Task Manager and Clock In/Out share ONE authoritative running session
    // (mirrors the equivalent guard in AppHeader's clockIn()).
    if (activeTaskTimer && activeTaskTimer.taskId !== taskId) {
      setToast('~An active task is already running.\nClock out first to start a new timer.')
      return
    }
    if (!activeTaskTimer && activeSession) {
      setToast('~An active task is already running.\nClock out first to start a new timer.')
      return
    }
    const sessionId  = 'sess' + Date.now()
    const newSession: TaskSession = { id: sessionId, startTs: Date.now(), endTs: null, note: '', tags: [] }
    updateDay(dateKey, prev => ({ ...prev, tasks: prev.tasks.map(t => t.id === taskId ? { ...t, timerStart: t.timerStart ?? Date.now(), sessions: [...(t.sessions ?? []), newSession] } : t) }))
    // Always store a non-empty taskText so the navbar capsule can distinguish Task Manager timers from Calendar Clock In
    setActiveTaskTimer({ taskId, dateKey, sessionId, startTs: Date.now(), taskText: task.text || `Task ${taskIndex + 1}`, taskIndex })
    setNow(Date.now())
    if (!activeSession) {
      const act = activities.find(a => a.id === (task.actId || selectedActId)) ?? activities[0]
      if (act) setActiveSession({ id: 's' + Date.now(), actId: act.id, actName: act.name, actColor: act.color, startTs: Date.now(), dateKey })
    }
  }

  function stopTimer(taskId: string) {
    const endTs = Date.now()
    updateDay(dateKey, prev => ({ ...prev, tasks: prev.tasks.map(t => t.id !== taskId ? t : { ...t, timerEnd: endTs, sessions: (t.sessions ?? []).map(s => s.endTs === null ? { ...s, endTs } : s) }) }))
    setActiveTaskTimer(null)
  }

  function adjustTime(taskId: string, sessionId: string | null, startTs: number, endTs: number, note: string) {
    let closedRunning = false
    updateDay(dateKey, prev => ({
      ...prev,
      tasks: prev.tasks.map(t => {
        if (t.id !== taskId) return t
        const sessions = t.sessions ?? []; let updated: TaskSession[]
        if (sessionId) {
          if (sessions.find(s => s.id === sessionId)?.endTs === null) closedRunning = true
          updated = sessions.map(s => s.id === sessionId ? { ...s, startTs, endTs, note } : s)
        } else {
          const runIdx  = sessions.findIndex(s => s.endTs === null)
          const lastIdx = sessions.reduce((idx, s, i) => s.endTs !== null ? i : idx, -1)
          if (runIdx >= 0)       { closedRunning = true; updated = sessions.map((s, i) => i === runIdx  ? { ...s, startTs, endTs, note } : s) }
          else if (lastIdx >= 0) {                       updated = sessions.map((s, i) => i === lastIdx ? { ...s, startTs, endTs, note } : s) }
          else                   {                       updated = [{ id: 'manual-' + Date.now(), startTs, endTs, note, tags: [] }] }
        }
        return { ...t, timerStart: startTs, timerEnd: endTs, sessions: updated }
      }),
    }))
    if (closedRunning && activeTaskTimer?.taskId === taskId) setActiveTaskTimer(null)
    setToast('Time adjusted')
  }

  // ── Drag reorder ──────────────────────────────────────────────────────────

  function handleDrop(targetId: string) {
    if (!dragItemId || dragItemId === targetId) { setDragItemId(null); return }
    const tasks = [...dayData.tasks]
    const fromIdx = tasks.findIndex(t => t.id === dragItemId)
    const toIdx   = tasks.findIndex(t => t.id === targetId)
    if (fromIdx < 0 || toIdx < 0) { setDragItemId(null); return }
    const [item] = tasks.splice(fromIdx, 1); tasks.splice(toIdx, 0, item)
    updateDay(dateKey, prev => ({ ...prev, tasks })); setDragItemId(null)
  }

  const topLevelTasks = dayData.tasks.filter(t => !t.parentTaskId)
  const doneCount     = topLevelTasks.filter(t => t.done).length

  const visible = isMounted && !isClosing

  return (
    <div
      className="fixed inset-x-0 top-0 bottom-14 sm:inset-0 z-50 flex items-stretch sm:items-center sm:justify-center sm:p-4"
      style={{
        background: isDark
          ? `rgba(4,0,14,${visible ? 0.72 : 0})`
          : `rgba(0,0,0,${visible ? 0.55 : 0})`,
        backdropFilter: isDark ? `blur(${visible ? 9 : 0}px)` : undefined,
        WebkitBackdropFilter: isDark ? `blur(${visible ? 9 : 0}px)` : undefined,
        transition: 'background 220ms ease-out, backdrop-filter 220ms ease-out',
        willChange: isDark ? 'backdrop-filter' : undefined,
      }}
    >
      {/* Purple ambient glow — dark mode only */}
      {isDark && (
        <div aria-hidden="true" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <div style={{
            width: 680, height: 480, borderRadius: '50%',
            background: 'radial-gradient(ellipse at center, rgba(124,58,237,0.20) 0%, rgba(109,40,217,0.09) 45%, transparent 72%)',
            filter: 'blur(55px)',
            opacity: visible ? 1 : 0,
            transition: 'opacity 220ms ease-out',
            transform: 'translateZ(0)',
            pointerEvents: 'none',
          }} />
        </div>
      )}
      <div
        className="w-full sm:max-w-[610px] rounded-none sm:rounded-2xl flex flex-col overflow-hidden flex-1 sm:flex-none max-h-full sm:h-[90vh]"
        style={{
          background: 'var(--xp-card)',
          border: '0.5px solid var(--xp-bdr2)',
          boxShadow: '0 20px 48px rgba(0,0,0,0.18), 0 6px 16px rgba(0,0,0,0.08), 0 0 80px rgba(124,58,237,0.13), 0 0 140px rgba(139,92,246,0.07)',
          opacity: visible ? 1 : 0,
          transform: visible ? 'scale(1)' : 'scale(0.98)',
          transition: 'opacity 220ms ease-out, transform 220ms ease-out',
          willChange: 'opacity, transform',
          position: 'relative',
          zIndex: 1,
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Desktop/tablet-only Close button micro-interaction — a subtle red
            tint on hover ("this closes the modal") and a quick press-scale on
            click, purely visual; attemptClose's behavior is untouched. */}
        <style>{`
          .xp-dm-close-btn { transition: background 150ms ease, border-color 150ms ease, transform 90ms ease; }
          .xp-dm-close-btn:hover { background: rgba(239,68,68,0.28) !important; border-color: rgba(239,68,68,0.45) !important; }
          .xp-dm-close-btn:active { transform: scale(0.93); transition-duration: 60ms; }
          /* The Multi-delete selector's inline style can't reach :focus/:active/
             :focus-visible — a platform default focus/tap ring on some mobile
             browsers can render its own glow around a <button> on press, which
             is what was showing as the selected state "bleeding" past the
             purple square. Re-asserting the exact intended inset ring (and
             nothing else) for those pseudo-states forces it back to only ever
             showing what the base style already shows. */
          .xp-dm-mdel-cb:focus, .xp-dm-mdel-cb:active, .xp-dm-mdel-cb:focus-visible {
            outline: none !important;
            box-shadow: inset 0 0 0 1.5px rgba(124,58,237,0.85) !important;
          }
          /* Mobile-only: shrink BOTH the outer indent that pushes the whole
             sub-task block in from the parent task's edge, AND the connector's
             own internal geometry (trunk/branch/arrowhead) proportionally, so
             the sub-task card starts noticeably further left overall — every
             recovered pixel goes straight to the sub-task title, which is the
             only flex:1 element in that row. The connector's trunk/branch/
             arrowhead keep the exact same 2px overlap relationship to each
             other (just at smaller absolute offsets), so it stays visually
             identical in miniature — never redesigned, never overlapping the
             title. Desktop/tablet keep the original values untouched. */
          @media (max-width: 640px) {
            .xp-subtask-indent { margin-left: 2px !important; }
            .xp-subtask-indent[data-reorder="true"] { margin-left: 10px !important; }
            .xp-sc-item { padding-left: 17px !important; }
            .xp-sc-trunk { left: 4px !important; }
            .xp-sc-branch { left: 4px !important; width: 9px !important; }
            .xp-sc-arrow { left: 11px !important; }
            /* Mobile-only: the parent expand/collapse triangle keeps its exact
               18x18 slot (so the "Task N" label and everything after it never
               moves) — only its glyph's alignment WITHIN that slot shifts from
               centered to right-aligned, closer to the gap before the label. */
            .xp-parent-expand-btn { justify-content: flex-end !important; }
          }
        `}</style>

        {/* Desktop/tablet header — three-zone layout so the center date stays
            visually centered regardless of the Back/Close controls' own widths.
            Hidden below sm: mobile gets its own bare-triangle header below. */}
        <div className="hidden sm:flex items-center px-4 py-3 flex-shrink-0" style={{ borderBottom: '0.5px solid rgba(255,255,255,0.08)', background: 'linear-gradient(135deg, #3b0764 0%, #7c3aed 50%, #6d28d9 100%)' }}>
          <div className="flex-1 flex justify-start min-w-0">
            <button
              onClick={attemptClose}
              title="Back" aria-label="Back"
              className="flex items-center justify-center flex-shrink-0 transition-opacity hover:opacity-70 active:scale-90"
              style={{ width: 36, height: 36, background: 'transparent', border: 'none', borderRadius: 8, cursor: 'pointer', transition: 'transform 100ms, opacity 120ms' }}
            >
              <svg width="11" height="18" viewBox="0 0 11 18" fill="none" aria-hidden="true">
                <path d="M9.5 1.5L1.5 9L9.5 16.5" stroke="#ffffff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          {/* Center nav — bare triangles (no square/background), pinned at a
              fixed distance from THIS zone's own horizontal center via
              position:absolute (same technique as the mobile header below),
              so neither triangle moves as the date text's length changes;
              only the text itself updates. This zone's own width is set purely
              by the flex split against the fixed-size Back/Close zones, never
              by the date text, so the whole nav group also stays centered. */}
          <div style={{ position: 'relative', flex: '2 1 0%', minWidth: 0, height: 36 }}>
            <span style={{
              position: 'absolute', left: 0, right: 0, top: '50%', transform: 'translateY(-50%)',
              textAlign: 'center', padding: '0 46px',
              color: '#ffffff', fontSize: 14, fontWeight: 600,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {dateLabel}
            </span>
            <button
              onClick={() => attemptNavigateDay(-1)}
              title="Previous day" aria-label="Previous day"
              className="flex items-center justify-center transition-all hover:opacity-70 active:scale-90"
              style={{ position: 'absolute', left: 'calc(50% - 132px)', top: '50%', transform: 'translateY(-50%)', width: 36, height: 36, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}
            >
              <svg width="9" height="12" viewBox="0 0 9 12" fill="#ffffff" aria-hidden="true"><path d="M9 0 L0 6 L9 12 Z" /></svg>
            </button>
            <button
              onClick={() => attemptNavigateDay(1)}
              title="Next day" aria-label="Next day"
              className="flex items-center justify-center transition-all hover:opacity-70 active:scale-90"
              style={{ position: 'absolute', right: 'calc(50% - 132px)', top: '50%', transform: 'translateY(-50%)', width: 36, height: 36, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}
            >
              <svg width="9" height="12" viewBox="0 0 9 12" fill="#ffffff" aria-hidden="true"><path d="M0 0 L9 6 L0 12 Z" /></svg>
            </button>
          </div>

          <div className="flex-1 flex justify-end min-w-0">
            <button
              onClick={attemptClose}
              title="Close" aria-label="Close"
              className="xp-dm-close-btn flex items-center justify-center flex-shrink-0"
              style={{ width: 32, height: 32, background: 'rgba(255,255,255,0.14)', border: '1px solid rgba(255,255,255,0.20)', borderRadius: 8, cursor: 'pointer', color: '#ffffff', fontSize: 14, fontWeight: 700 }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Mobile-only header — no Back/Close, bare triangles with no visible
            button chrome. Prev/next are pinned at a fixed distance from the
            header's horizontal center via position:absolute (the same technique
            already used for the Planner Editor's day-nav arrows), so neither
            triangle — nor the gap around the date — ever shifts as the date
            text's own length changes across different weekdays/months; only
            the text itself changes. */}
        <div className="flex sm:hidden flex-shrink-0" style={{ position: 'relative', minHeight: 52, borderBottom: '0.5px solid rgba(255,255,255,0.08)', background: 'linear-gradient(135deg, #3b0764 0%, #7c3aed 50%, #6d28d9 100%)' }}>
          <span style={{
            position: 'absolute', left: 0, right: 0, top: '50%', transform: 'translateY(-50%)',
            textAlign: 'center', padding: '0 58px',
            color: '#ffffff', fontSize: 12.5, fontWeight: 600, letterSpacing: '-0.01em',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {dateLabel}
          </span>
          <button
            onClick={() => attemptNavigateDay(-1)}
            title="Previous day" aria-label="Previous day"
            className="transition-transform active:scale-90"
            style={{ position: 'absolute', left: 'calc(50% - 148px)', top: '50%', transform: 'translateY(-50%)', width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}
          >
            <svg width="9" height="12" viewBox="0 0 9 12" fill="#ffffff" aria-hidden="true"><path d="M9 0 L0 6 L9 12 Z" /></svg>
          </button>
          <button
            onClick={() => attemptNavigateDay(1)}
            title="Next day" aria-label="Next day"
            className="transition-transform active:scale-90"
            style={{ position: 'absolute', right: 'calc(50% - 148px)', top: '50%', transform: 'translateY(-50%)', width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}
          >
            <svg width="9" height="12" viewBox="0 0 9 12" fill="#ffffff" aria-hidden="true"><path d="M0 0 L9 6 L0 12 Z" /></svg>
          </button>
        </div>

        {/* Today's Status row */}
        <div className="flex items-center gap-2 px-4 py-2 flex-shrink-0" style={{ borderBottom: '0.5px solid var(--xp-bdr)' }}>
          <span className="hidden sm:inline text-[10px] font-semibold uppercase tracking-wider flex-shrink-0" style={{ color: 'var(--xp-txt3)' }}>Today&apos;s Status</span>
          <TodayStatusDropdown value={currentStatus} onChange={handleStatusSelect} isDark={isDark} />
          <div style={{ flex: 1 }} />
          <button onClick={onDashboard} className="flex items-center gap-1.5 text-[10px] sm:text-xs px-2.5 sm:px-3.5 py-1.5 rounded-lg font-medium text-white transition-all hover:opacity-85 flex-shrink-0" style={{ background: '#7c3aed' }}>📊 Today&apos;s Dashboard</button>
        </div>

        {/* Scrollable body */}
        <div ref={scrollBodyRef} className="flex-1 overflow-y-auto">
          <div className="px-4 py-3" style={{ borderBottom: '0.5px solid var(--xp-bdr)' }}>

            {/* Section header */}
            <div className="flex items-start justify-between mb-2 gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold" style={{ color: 'var(--xp-txt)' }}>
                  Accomplishments
                  {topLevelTasks.length > 0 && <span className="ml-1 font-normal" style={{ color: 'var(--xp-txt3)' }}>· {doneCount}/{topLevelTasks.length} Completed</span>}
                </p>
                <p className="text-[10px] mt-0.5" style={{ color: 'var(--xp-txt3)' }}>
                  Total Focus Time Today:{' '}
                  <span className="font-semibold" style={{ color: totalFocusMsToday > 0 ? 'var(--xp-txt2)' : 'var(--xp-txt3)' }}>
                    {totalFocusMsToday > 0 ? formatMs(totalFocusMsToday) : '—'}
                  </span>
                </p>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <TasksDropdown
                  isDark={isDark}
                  onGenerate={generateTasks}
                  onReorder={() => { setReorderMode(true); setDeleteMode(false); setSelectedForDel(new Set()) }}
                  onDelete={() => { setDeleteMode(true); setReorderMode(false); setSelectedForDel(new Set()) }}
                />
                <button onClick={() => setAddingTask(true)} className="text-[10px] px-2.5 py-1 rounded-lg text-white font-medium transition-opacity hover:opacity-85 flex-shrink-0" style={{ background: '#16a34a' }}>+ Add Task</button>
              </div>
            </div>

            {/* Empty state */}
            {topLevelTasks.length === 0 && !addingTask && (
              <div className="text-center py-7">
                <div className="text-2xl mb-2">📋</div>
                <p className="text-xs font-medium mb-1" style={{ color: 'var(--xp-txt)' }}>No accomplishments yet.</p>
                <p className="text-xs mb-4" style={{ color: 'var(--xp-txt3)' }}>Start with one small win.</p>
                <button onClick={() => setAddingTask(true)} className="text-xs px-5 py-2 rounded-full text-white font-medium transition-opacity hover:opacity-80" style={{ background: '#16a34a' }}>+ Add Task</button>
              </div>
            )}

            {/* Task list — hierarchical */}
            <div className="space-y-2">
              {(() => {
                const baseTopLevel = dayData.tasks.filter(t => !t.parentTaskId)
                // While actively dragging, render in the live `localOrder`
                // instead of the real saved order — this is what makes the
                // prospective final order visible DURING the drag, without
                // writing anything to dayData/Supabase until drop.
                const topLevel = localOrder
                  ? localOrder.map(id => baseTopLevel.find(t => t.id === id)).filter((t): t is Task => !!t)
                  : baseTopLevel
                let topIdx = 0
                return topLevel.map(task => {
                  const children      = dayData.tasks.filter(t => t.parentTaskId === task.id)
                  const hasKids       = children.length > 0
                  const isExpanded    = expandedParents.has(task.id)
                  const parentActColor = activities.find(a => a.id === task.actId)?.color ?? '#7c3aed'
                  const taskIndex     = topIdx++
                  const subDone       = children.filter(c => c.done).length

                  const connColor = `${parentActColor}70`

                  const sharedProps = (t: Task, idx: number, isChild = false, childIdx?: number) => ({
                    task: t, index: idx, isActive: activeTaskTimer?.taskId === t.id && activeTaskTimer.dateKey === dateKey,
                    blockedByOtherTimer: activeTaskTimer ? activeTaskTimer.taskId !== t.id : !!activeSession,
                    now, isEditing: editingTaskId === t.id,
                    onEditStart: () => setEditingTaskId(t.id), onEditEnd: () => setEditingTaskId(null),
                    dateKey, expanded: expandedTaskId === t.id,
                    onExpandToggle: () => setExpandedTaskId(prev => prev === t.id ? null : t.id),
                    onToggle: () => toggleTask(t.id), onDelete: () => deleteTask(t.id),
                    onDuplicate: () => duplicateTask(t.id),
                    onStartTimer: () => startTimer(t.id, idx), onStopTimer: () => stopTimer(t.id),
                    draftJournal: dirtyNotesMap[t.id] ?? null,
                    onNotesDraftChange: (text: string) => handleNotesDraftChange(t.id, text),
                    onNotesSave: () => saveTaskNotes(t.id),
                    onTextChange: (text: string) => updateTaskText(t.id, text),
                    onActChange: (actId: string) => updateTaskAct(t.id, actId),
                    onAdjustTime: (sid: string | null, s: number, e: number, n: string) => adjustTime(t.id, sid, s, e, n),
                    onSetReminder: () => setReminderTaskId(t.id),
                    onDragStart: () => setDragItemId(t.id), onDragOver: (ev: React.DragEvent) => ev.preventDefault(),
                    onDrop: () => reorderMode ? handleReorderDrop(t.id) : handleDrop(t.id),
                    bellTriggerKey: reminderSavedKey[t.id] ?? 0,
                    onAttachmentsChange: (atts: TaskAttachment[]) => updateTaskAttachments(t.id, atts),
                    onCopy: () => copyTask(t.id), onPaste: pasteTask,
                    onCreateSubTask: () => createSubTask(t.id),
                    pasteEnabled: !!taskClipboard,
                    onTransfer: () => setTransferTaskId(t.id),
                    transferDisabled: (() => {
                      const childIds = dayData.tasks.filter(c => c.parentTaskId === t.id).map(c => c.id)
                      const familyIds = new Set([t.id, ...childIds])
                      return !!activeTaskTimer && activeTaskTimer.dateKey === dateKey && familyIds.has(activeTaskTimer.taskId)
                    })(),
                    isChild, childIndex: childIdx,
                    onChooseColor: (color: string) => setTaskColor(t.id, color),
                    onTogglePriority: () => toggleTaskPriority(t.id),
                  })

                  return (
                    <div key={task.id}>
                      {/* Reorder drag wrapper — the ENTIRE card is the drag
                          surface while Reorder Mode is active (Pointer Events,
                          not the old HTML5 draggable handle-only approach, so
                          it works identically for mouse AND touch). A capture
                          check (isReorderDragBlocked) skips drag-start when the
                          press lands on an actual control — button/input/
                          textarea/select/link/the title's editable area — so
                          every existing interaction (checkboxes, activity
                          dropdown, three-dot menu, timers, title editing)
                          keeps working exactly as before; everywhere else on
                          the card (background, "Task N" label, empty gaps,
                          the ⠿ handle itself) now starts the drag. */}
                      <div
                        ref={el => { if (el) rowElRefs.current.set(task.id, el); else rowElRefs.current.delete(task.id) }}
                        style={{
                          display: 'flex', alignItems: 'flex-start', gap: 4, position: 'relative',
                          borderRadius: 12,
                          outline: reorderMode && dragTaskId === task.id ? '2px solid rgba(124,58,237,0.9)' : 'none',
                          touchAction: reorderMode ? 'none' : undefined,
                          cursor: reorderMode ? (dragTaskId === task.id ? 'grabbing' : 'grab') : undefined,
                          zIndex: reorderMode && dragTaskId === task.id ? 3 : undefined,
                        }}
                        onPointerDown={reorderMode ? (e => onReorderPointerDown(e, task.id)) : undefined}
                        onPointerMove={reorderMode ? onReorderPointerMove : undefined}
                        onPointerUp={reorderMode ? (e => endReorderPointerDrag(e, true)) : undefined}
                        onPointerCancel={reorderMode ? (e => endReorderPointerDrag(e, false)) : undefined}
                      >
                        {/* Drag handle — visual affordance only now; dragging
                            can start from anywhere on the card, not just here. */}
                        {reorderMode && (
                          <div
                            style={{ cursor: dragTaskId === task.id ? 'grabbing' : 'grab', padding: '12px 4px', color: 'var(--xp-txt3)', flexShrink: 0, fontSize: 13, lineHeight: 1, userSelect: 'none', opacity: 0.6 }}
                            title="Drag to reorder"
                          >⠿</div>
                        )}
                        <div style={{ flex: 1, minWidth: 0, position: 'relative', borderRadius: 12 }}>
                          {/* Multi-delete selection checkbox — PARENT TASKS ONLY,
                              same placement/size on mobile, tablet and desktop:
                              inside the card's own upper-left corner. Built as
                              ONE 16x16 element (no separate padded wrapper button
                              around an inner div) — the same structure as the
                              normal completion checkbox just above it in this
                              file — so its rendered footprint IS the purple box,
                              nothing larger around it. Unchecked interior gets a
                              subtle fill via backgroundClip:'padding-box', which
                              keeps that fill confined INSIDE the (transparent)
                              border — the border itself never paints, so nothing
                              can bleed past the purple inset ring as a halo (the
                              bug from two rounds ago). The border itself stays
                              transparent in BOTH states — selected uses a red
                              fill, not a red border — because an inset box-shadow
                              ring is drawn starting at the border's inner edge,
                              so a colored border paints in the band OUTSIDE that
                              ring (the earlier red-bleed bug). The .xp-dm-mdel-cb
                              :focus/:active rule above guards the same ring
                              against platform focus/tap outlines. zIndex
                              kept BELOW the sticky delete-mode action bar's
                              zIndex:5 so it can never paint over "0 selected /
                              Cancel / Delete" while scrolling. */}
                          {deleteMode && (
                            <button type="button" onClick={() => toggleDeleteSelect(task.id)} className="xp-dm-mdel-cb"
                              style={{
                                position: 'absolute', top: 3, left: 2, zIndex: 2,
                                width: 16, height: 16, borderRadius: 6, margin: 0, padding: 0,
                                border: '2px solid transparent',
                                backgroundColor: selectedForDel.has(task.id) ? 'rgba(124,58,237,0.85)' : (isDark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.035)'),
                                backgroundClip: 'padding-box',
                                boxShadow: 'inset 0 0 0 1.5px rgba(124,58,237,0.85)',
                                overflow: 'hidden',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                cursor: 'pointer', outline: 'none', appearance: 'none', WebkitAppearance: 'none',
                                WebkitTapHighlightColor: 'transparent',
                              }}>
                              {selectedForDel.has(task.id) && <span style={{ color: 'white', fontSize: 10, fontWeight: 700, lineHeight: 1 }}>✓</span>}
                            </button>
                          )}
                          <TaskRow
                            {...sharedProps(task, taskIndex)}
                            hasChildren={hasKids}
                            isParentExpanded={isExpanded}
                            onParentExpandToggle={() => toggleParentExpand(task.id)}
                            subTaskCount={hasKids ? children.length : undefined}
                            subTaskDoneCount={hasKids ? subDone : undefined}
                          />
                        </div>
                      </div>

                      {/* Sub-tasks hierarchy — corrected connector geometry */}
                      {hasKids && isExpanded && (
                        <div className="xp-subtask-indent" data-reorder={reorderMode ? 'true' : 'false'} style={{ marginLeft: reorderMode ? 24 : 16, marginTop: 6 }}>
                          {children.map((child, ci) => {
                            const isLast = ci === children.length - 1
                            return (
                              <div key={child.id} className="xp-sc-item" style={{ position: 'relative', paddingLeft: 22, marginBottom: isLast ? 0 : 8 }}>
                                {/* Upper vertical: top → midpoint */}
                                <div className="xp-sc-trunk" style={{ position: 'absolute', left: 7, top: 0, height: '50%', width: 1.5, background: connColor, pointerEvents: 'none' }} />
                                {/* Lower vertical: midpoint → bottom + gap (non-last only) */}
                                {!isLast && (
                                  <div className="xp-sc-trunk" style={{ position: 'absolute', left: 7, top: '50%', height: 'calc(50% + 8px)', width: 1.5, background: connColor, pointerEvents: 'none' }} />
                                )}
                                {/* Horizontal branch at exact midpoint */}
                                <div className="xp-sc-branch" style={{ position: 'absolute', left: 7, top: '50%', width: 14, height: 1.5, background: connColor, transform: 'translateY(-50%)', pointerEvents: 'none', borderRadius: 1 }} />
                                {/* Arrowhead */}
                                <div className="xp-sc-arrow" style={{ position: 'absolute', left: 19, top: '50%', transform: 'translateY(-50%)', width: 0, height: 0, borderTop: '3px solid transparent', borderBottom: '3px solid transparent', borderLeft: `4px solid ${connColor}`, pointerEvents: 'none' }} />
                                {/* No Multi-delete selector on sub-tasks — only
                                    parent tasks are independently selectable;
                                    deleting a parent already cascades to all of
                                    its sub-tasks (see executeDeleteSelected). */}
                                <TaskRow
                                  {...sharedProps(child, ci, true, ci)}
                                  hasChildren={false}
                                />
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })
              })()}

              {addingTask && (
                <div className="flex items-center gap-2">
                  <input autoFocus type="text" value={newTaskText} onChange={e => setNewTaskText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addTask(); if (e.key === 'Escape') { setAddingTask(false); setNewTaskText('') } }} placeholder="What did you accomplish?" className="flex-1 text-xs px-3 py-2 rounded-lg outline-none" style={{ border: '1px solid var(--xp-acc)', background: 'var(--xp-bg3)', color: 'var(--xp-txt)' }} />
                  <button onClick={() => addTask()} className="text-xs px-3.5 py-2 rounded-lg text-white transition-opacity hover:opacity-80 flex-shrink-0 font-medium" style={{ background: '#16a34a' }}>Add</button>
                  <button onClick={() => { setAddingTask(false); setNewTaskText('') }} className="text-sm px-2 py-1.5 flex-shrink-0 transition-colors hover:text-red-400" style={{ color: 'var(--xp-txt3)' }}>×</button>
                </div>
              )}
            </div>

            {/* Reorder mode banner */}
            {reorderMode && (
              <div style={{ position: 'sticky', bottom: 0, paddingTop: 8, paddingBottom: 2, background: 'var(--xp-card)', zIndex: 5 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderRadius: 12, background: isDark ? 'rgba(124,58,237,0.12)' : 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.22)' }}>
                  <span style={{ fontSize: 11, fontWeight: 500, color: '#7c3aed' }}>↕ Drag tasks to reorder</span>
                  <button type="button" onClick={() => setReorderMode(false)} style={{ fontSize: 11, fontWeight: 600, color: 'white', background: '#7c3aed', border: 'none', borderRadius: 8, padding: '4px 12px', cursor: 'pointer' }}>Done</button>
                </div>
              </div>
            )}

            {/* Delete mode controls */}
            {deleteMode && (
              <div style={{ position: 'sticky', bottom: 0, paddingTop: 8, paddingBottom: 2, background: 'var(--xp-card)', zIndex: 5 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 12px', borderRadius: 12, background: isDark ? 'rgba(239,68,68,0.10)' : 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.22)' }}>
                  <span style={{ fontSize: 11, fontWeight: 500, color: '#ef4444' }}>{selectedForDel.size} selected</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button type="button" onClick={() => { setDeleteMode(false); setSelectedForDel(new Set()) }} style={{ fontSize: 11, fontWeight: 500, color: 'var(--xp-txt2)', background: 'var(--xp-bg3)', border: '1px solid var(--xp-bdr2)', borderRadius: 8, padding: '4px 10px', cursor: 'pointer' }}>Cancel</button>
                    <button type="button" disabled={selectedForDel.size === 0} onClick={() => setDeleteConfirm(true)} style={{ fontSize: 11, fontWeight: 600, color: 'white', background: selectedForDel.size > 0 ? '#ef4444' : 'rgba(239,68,68,0.3)', border: 'none', borderRadius: 8, padding: '4px 12px', cursor: selectedForDel.size > 0 ? 'pointer' : 'default' }}>Delete {selectedForDel.size > 0 ? selectedForDel.size : ''}</button>
                  </div>
                </div>
              </div>
            )}

            {topLevelTasks.length > 0 && !addingTask && !reorderMode && !deleteMode && (
              <div style={{ position: 'sticky', bottom: 0, paddingTop: 6, paddingBottom: 2, background: 'var(--xp-card)', zIndex: 4 }}>
                <button onClick={() => setAddingTask(true)} className="w-full text-xs py-2.5 rounded-xl text-white font-semibold transition-all hover:opacity-85" style={{ background: 'linear-gradient(135deg,#7c3aed 0%,#5b21b6 100%)', boxShadow: '0 2px 10px rgba(124,58,237,0.35)' }}>
                  + Add accomplishment
                </button>
              </div>
            )}
          </div>

          {/* Journal notes */}
          <div className="px-4 py-3">
            <div className="flex items-center justify-between mb-1">
              <button onClick={() => setNotesOpen(o => !o)} className="flex items-center gap-2 text-xs font-medium text-left transition-colors hover:text-violet-500" style={{ color: 'var(--xp-txt2)' }}>
                <span style={{ display: 'inline-block', fontSize: 10, lineHeight: 1, flexShrink: 0, transform: notesOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 220ms cubic-bezier(0.4,0,0.2,1)' }}>▶</span>
                <span>Journal notes</span>
              </button>
              {notesOpen && journalSaved && (
                <span aria-live="polite" style={{ fontSize: 9.5, fontWeight: 600, color: '#16a34a', transition: 'opacity 300ms ease', paddingRight: 2 }}>✓ Saved</span>
              )}
            </div>
            {notesOpen && (
              <div style={{ position: 'relative' }}>
                {journalAnimKey > 0 && <JournalBorderAnim key={journalAnimKey} onDone={() => {}} />}
                <JournalEditorEmbed
                  dateKey={dateKey}
                  rawContent={dayData.notes ?? ''}
                  isDark={isDark}
                  onChange={content => {
                    updateDay(dateKey, prev => ({ ...prev, notes: content }))
                    if (journalSaveTimerRef.current) clearTimeout(journalSaveTimerRef.current)
                    journalSaveTimerRef.current = setTimeout(() => {
                      setJournalSaved(true)
                      setTimeout(() => setJournalSaved(false), 1000)
                    }, 600)
                  }}
                  attachments={dayData.attachments ?? []}
                  onAttachmentsChange={atts => updateDay(dateKey, prev => ({ ...prev, attachments: atts }))}
                />
              </div>
            )}
          </div>
        </div>

        {/* Footer — Today pill (bottom-left, only when viewing another date)
            shares this row with Cancel/Save rather than adding modal height. */}
        <div className="flex items-center justify-between gap-2 px-4 py-3 flex-shrink-0" style={{ borderTop: '0.5px solid var(--xp-bdr)' }}>
          <div>
            {!isViewingToday && (
              <button
                onClick={attemptGoToToday}
                title="Return to today" aria-label="Return to today"
                className="text-[11px] font-semibold px-3 py-1.5 rounded-full transition-all hover:opacity-85 active:scale-95"
                style={{
                  background: isDark ? 'rgba(167,139,250,0.20)' : 'rgba(124,58,237,0.12)',
                  color: isDark ? '#c4b5fd' : '#7c3aed',
                  border: `1px solid ${isDark ? 'rgba(167,139,250,0.35)' : 'rgba(124,58,237,0.28)'}`,
                }}
              >
                <span className="text-[13px] sm:text-[11px]">⟳</span> Today
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button onClick={attemptClose} className="text-xs px-4 py-1.5 rounded-lg border transition-colors hover:bg-black/5" style={{ borderColor: 'var(--xp-bdr2)', color: 'var(--xp-txt2)' }}>Cancel</button>
            <button onClick={handleMainSave} disabled={mainSaving} className="text-xs px-5 py-1.5 rounded-full text-white font-medium transition-all" style={{ background: mainSaving ? '#16a34a' : '#7c3aed', opacity: mainSaving ? 1 : undefined }}>
              {mainSaving ? '✓ Saved' : '✓ Save'}
            </button>
          </div>
        </div>
      </div>

      {/* Unsaved-changes confirmation dialog */}
      {showCloseDialog && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9995, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, background: 'rgba(0,0,0,0.55)' }} onClick={() => setShowCloseDialog(false)}>
          <div style={{ background: isDark ? '#1a1530' : '#ffffff', borderRadius: 18, padding: '22px 22px 18px', maxWidth: 320, width: '100%', boxShadow: '0 24px 60px rgba(0,0,0,0.35), 0 4px 16px rgba(0,0,0,0.12)', border: `0.5px solid ${isDark ? 'rgba(124,58,237,0.25)' : 'rgba(0,0,0,0.08)'}` }} onClick={e => e.stopPropagation()}>
            <p style={{ fontWeight: 700, fontSize: 14, color: isDark ? '#ffffff' : '#111827', margin: '0 0 6px' }}>Save your changes?</p>
            <p style={{ fontSize: 12, color: 'var(--xp-txt3)', margin: '0 0 20px', lineHeight: 1.55 }}>You have unsaved changes. Would you like to save them before closing?</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button
                onClick={() => setShowCloseDialog(false)}
                style={{ width: '100%', padding: '10px 16px', borderRadius: 10, background: 'transparent', color: 'var(--xp-txt3)', border: '1px solid var(--xp-bdr2)', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
              >
                Keep Editing
              </button>
              <button
                onClick={discardAndClose}
                style={{ width: '100%', padding: '10px 16px', borderRadius: 10, background: isDark ? 'rgba(239,68,68,0.10)' : 'rgba(239,68,68,0.06)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.22)', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
              >
                Close Without Saving
              </button>
              <button
                onClick={() => { setShowCloseDialog(false); handleMainSave() }}
                style={{ width: '100%', padding: '10px 16px', borderRadius: 10, background: '#7c3aed', color: '#ffffff', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
              >
                Save and Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete parent + children confirmation */}
      {pendingDeleteId && (() => {
        const pendingTask = dayData.tasks.find(t => t.id === pendingDeleteId)
        const childCount  = dayData.tasks.filter(t => t.parentTaskId === pendingDeleteId).length
        return (
          <div style={{ position: 'fixed', inset: 0, zIndex: 9996, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, background: 'rgba(0,0,0,0.55)' }} onClick={() => setPendingDeleteId(null)}>
            <div style={{ background: isDark ? '#1a1530' : '#ffffff', borderRadius: 18, padding: '22px 22px 18px', maxWidth: 320, width: '100%', boxShadow: '0 24px 60px rgba(0,0,0,0.35)', border: `0.5px solid ${isDark ? 'rgba(239,68,68,0.25)' : 'rgba(239,68,68,0.15)'}` }} onClick={e => e.stopPropagation()}>
              <p style={{ fontWeight: 700, fontSize: 14, color: isDark ? '#ffffff' : '#111827', margin: '0 0 6px' }}>Delete task and sub-tasks?</p>
              <p style={{ fontSize: 12, color: 'var(--xp-txt3)', margin: '0 0 4px', lineHeight: 1.55 }}>
                <strong style={{ color: isDark ? 'rgba(255,255,255,0.85)' : '#374151' }}>{pendingTask?.text || 'This task'}</strong> has {childCount} sub-task{childCount !== 1 ? 's' : ''}.
              </p>
              <p style={{ fontSize: 12, color: 'var(--xp-txt3)', margin: '0 0 20px', lineHeight: 1.55 }}>Deleting it will also remove all sub-tasks and their history.</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button onClick={() => setPendingDeleteId(null)} style={{ width: '100%', padding: '10px 16px', borderRadius: 10, background: 'transparent', color: 'var(--xp-txt3)', border: '1px solid var(--xp-bdr2)', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>Keep Task</button>
                <button onClick={() => doDeleteTask(pendingDeleteId)} style={{ width: '100%', padding: '10px 16px', borderRadius: 10, background: isDark ? 'rgba(239,68,68,0.12)' : 'rgba(239,68,68,0.07)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.28)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Delete Task + Sub-Tasks</button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Multi-delete confirmation dialog */}
      {deleteConfirm && (() => {
        const parentCount = [...selectedForDel].filter(id => !dayData.tasks.find(t => t.id === id)?.parentTaskId).length
        const childrenAffected = [...selectedForDel]
          .filter(id => !dayData.tasks.find(t => t.id === id)?.parentTaskId)
          .reduce((acc, id) => acc + dayData.tasks.filter(t => t.parentTaskId === id && !selectedForDel.has(t.id)).length, 0)
        return (
          <div style={{ position: 'fixed', inset: 0, zIndex: 9996, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'rgba(0,0,0,0.5)' }}>
            <div style={{ width: '100%', maxWidth: 320, borderRadius: 18, padding: 20, background: 'var(--xp-card)', border: '0.5px solid var(--xp-bdr2)', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
              <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--xp-txt)', marginBottom: 8 }}>Delete {selectedForDel.size} task{selectedForDel.size !== 1 ? 's' : ''}?</p>
              {childrenAffected > 0 && (
                <p style={{ fontSize: 12, color: 'var(--xp-txt3)', marginBottom: 14, lineHeight: 1.5 }}>{parentCount > 1 ? 'Some' : 'One'} selected task{parentCount > 1 ? 's have' : ' has'} sub-tasks. Those sub-tasks will also be deleted ({childrenAffected} additional item{childrenAffected !== 1 ? 's' : ''}).</p>
              )}
              {childrenAffected === 0 && <p style={{ fontSize: 12, color: 'var(--xp-txt3)', marginBottom: 14 }}>This action cannot be undone.</p>}
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={() => setDeleteConfirm(false)} style={{ flex: 1, padding: '9px 0', borderRadius: 10, background: 'transparent', color: 'var(--xp-txt2)', border: '1px solid var(--xp-bdr2)', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>Cancel</button>
                <button type="button" onClick={executeDeleteSelected} style={{ flex: 1, padding: '9px 0', borderRadius: 10, background: '#ef4444', color: 'white', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Delete</button>
              </div>
            </div>
          </div>
        )
      })()}

      {showConfetti && <ConfettiPop onDone={onConfettiDone} />}

      {reminderTaskId && (() => {
        const reminderTask = dayData.tasks.find(t => t.id === reminderTaskId)
        const existing     = reminders.find(r => r.taskId === reminderTaskId && r.dateKey === dateKey && r.isActive) ?? null
        return reminderTask ? (
          <ReminderModal taskId={reminderTaskId} dateKey={dateKey} taskText={reminderTask.text} existingReminder={existing} onClose={() => setReminderTaskId(null)} onSaved={() => setReminderSavedKey(prev => ({ ...prev, [reminderTaskId]: (prev[reminderTaskId] ?? 0) + 1 }))} />
        ) : null
      })()}

      {transferTaskId && (() => {
        const transferTask = dayData.tasks.find(t => t.id === transferTaskId)
        return transferTask ? (
          <TransferTaskModal task={transferTask} dateKey={dateKey} onClose={() => setTransferTaskId(null)} />
        ) : null
      })()}
    </div>
  )
}

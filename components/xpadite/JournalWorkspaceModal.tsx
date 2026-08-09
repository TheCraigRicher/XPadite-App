'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { useApp } from './AppContext'

// Editor loaded only when the editor view is active (reduces initial bundle)
const JournalEditorContent = dynamic(
  () => import('./JournalEditorContent').then(m => ({ default: m.JournalEditorContent })),
  { ssr: false }
)

// ─── Constants ────────────────────────────────────────────────────────────────

const QUARTERS = [
  { label: 'Q1', months: [0, 1, 2] },
  { label: 'Q2', months: [3, 4, 5] },
  { label: 'Q3', months: [6, 7, 8] },
  { label: 'Q4', months: [9, 10, 11] },
]

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const DOW_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

// ─── Date helpers ─────────────────────────────────────────────────────────────

function toKey(y: number, m: number, d: number) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function fromKey(key: string): [number, number, number] {
  const [y, m, d] = key.split('-').map(Number)
  return [y, m - 1, d]
}

function buildCells(y: number, m: number): (number | null)[] {
  const firstDow = new Date(y, m, 1).getDay()
  const days = new Date(y, m + 1, 0).getDate()
  const out: (number | null)[] = Array(firstDow).fill(null)
  for (let d = 1; d <= days; d++) out.push(d)
  // Pad to multiple of 7
  while (out.length % 7 !== 0) out.push(null)
  return out
}

function getTodayKey() {
  const n = new Date()
  return toKey(n.getFullYear(), n.getMonth(), n.getDate())
}

function shiftDay(key: string, delta: number): string {
  const [y, m, d] = fromKey(key)
  const t = new Date(y, m, d + delta)
  return toKey(t.getFullYear(), t.getMonth(), t.getDate())
}

// ─── Journal month card ───────────────────────────────────────────────────────

interface JournalMonthCardProps {
  year: number
  month: number
  todayKey: string
  selectedDate: string | null
  hasEntry: (dateKey: string) => boolean
  isDark: boolean
  onDayClick: (dateKey: string) => void
  onDayDoubleClick: (dateKey: string) => void
}

function JournalMonthCard({
  year, month, todayKey, selectedDate, hasEntry, isDark, onDayClick, onDayDoubleClick,
}: JournalMonthCardProps) {
  const cells = useMemo(() => buildCells(year, month), [year, month])
  const acc = '#7c3aed'
  const txt = isDark ? '#e2e8f0' : '#1e293b'
  const muted = isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.28)'
  const cardBg = isDark ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.7)'
  const cardBdr = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)'

  return (
    <div style={{
      background: cardBg,
      border: `0.5px solid ${cardBdr}`,
      borderRadius: 10,
      padding: '8px 6px 6px',
      display: 'flex',
      flexDirection: 'column',
      gap: 2,
    }}>
      {/* Month name */}
      <div style={{
        textAlign: 'center',
        fontSize: 11,
        fontWeight: 600,
        color: txt,
        paddingBottom: 4,
        letterSpacing: '0.02em',
      }}>
        {MONTH_NAMES[month]}
      </div>

      {/* Day-of-week headers */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
        {DOW_LABELS.map((d, i) => (
          <div key={i} style={{
            textAlign: 'center',
            fontSize: 8,
            fontWeight: 500,
            color: muted,
            padding: '0 0 2px',
          }}>
            {d}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1 }}>
        {cells.map((day, i) => {
          if (day === null) return <div key={`_${i}`} style={{ aspectRatio: '1' }} />
          const dateKey = toKey(year, month, day)
          const isToday = dateKey === todayKey
          const isSel = selectedDate === dateKey
          const entry = hasEntry(dateKey)

          return (
            <button
              key={dateKey}
              onClick={() => onDayClick(dateKey)}
              onDoubleClick={() => onDayDoubleClick(dateKey)}
              title={entry ? `Journal entry — ${MONTH_SHORT[month]} ${day}` : undefined}
              style={{
                aspectRatio: '1',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 5,
                border: isSel
                  ? `1.5px solid ${acc}`
                  : isToday
                  ? `1px solid rgba(124,58,237,0.40)`
                  : '1px solid transparent',
                background: isSel
                  ? isDark ? 'rgba(124,58,237,0.22)' : 'rgba(124,58,237,0.10)'
                  : isToday
                  ? isDark ? 'rgba(124,58,237,0.10)' : 'rgba(124,58,237,0.05)'
                  : 'transparent',
                cursor: 'pointer',
                padding: 0,
                gap: 0,
                transition: 'background 100ms',
              }}
            >
              <span style={{
                fontSize: 9,
                fontWeight: isToday ? 700 : 400,
                color: isToday ? acc : isSel ? acc : txt,
                lineHeight: 1,
              }}>
                {day}
              </span>
              {entry && (
                <span style={{ fontSize: 7, lineHeight: 1, marginTop: 1 }}>📝</span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── Chevron for quarter headers ─────────────────────────────────────────────

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      style={{
        width: 13,
        height: 13,
        transition: 'transform 200ms',
        transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
        flexShrink: 0,
      }}
    >
      <polyline points="6 9 12 15 18 9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

interface JournalWorkspaceModalProps {
  onClose: () => void
}

export function JournalWorkspaceModal({ onClose }: JournalWorkspaceModalProps) {
  const { isDark, calData, updateDay } = useApp()

  const todayDate = useMemo(() => new Date(), [])
  const todayKey = useMemo(getTodayKey, [])

  // ─── View ─────────────────────────────────────────────────────────────────
  const [view, setView] = useState<'calendar' | 'editor'>('calendar')

  // ─── Calendar state ────────────────────────────────────────────────────────
  const [calYear, setCalYear] = useState(todayDate.getFullYear())
  const [openQ, setOpenQ] = useState<Record<string, boolean>>({ Q1: true, Q2: true, Q3: true, Q4: true })
  const [selectedDate, setSelectedDate] = useState<string | null>(null)

  // ─── Editor state ──────────────────────────────────────────────────────────
  const [editorDate, setEditorDate] = useState(todayKey)
  // Latest content from the editor (updated on every keystroke via callback)
  const pendingContentRef = useRef<string>('')

  // ─── ESC key (ref pattern — stable listener, always reads latest state) ─────
  const escRef = useRef<() => void>(() => {})
  escRef.current = () => {
    if (view === 'editor') doGoCalendar()
    else doClose()
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') escRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Persist entry ─────────────────────────────────────────────────────────
  const persistEntry = useCallback((dateKey: string, content: string) => {
    updateDay(dateKey, prev => ({ ...prev, notes: content }))
  }, [updateDay])

  // Flush any pending unsaved content immediately
  function flush() {
    const content = pendingContentRef.current
    if (content !== undefined) {
      persistEntry(editorDate, content)
    }
  }

  // ─── Open editor ───────────────────────────────────────────────────────────
  function doOpenEditor(dateKey: string) {
    pendingContentRef.current = calData[dateKey]?.notes ?? ''
    setEditorDate(dateKey)
    setSelectedDate(dateKey)
    setView('editor')
  }

  // ─── Back to calendar ──────────────────────────────────────────────────────
  function doGoCalendar() {
    flush()
    setView('calendar')
  }

  // ─── Close modal ───────────────────────────────────────────────────────────
  function doClose() {
    if (view === 'editor') flush()
    onClose()
  }

  // ─── Navigate days in editor ───────────────────────────────────────────────
  function navigateDay(delta: number) {
    flush()
    const key = shiftDay(editorDate, delta)
    pendingContentRef.current = calData[key]?.notes ?? ''
    setEditorDate(key)
    setSelectedDate(key)
  }

  function navigateToday() {
    flush()
    pendingContentRef.current = calData[todayKey]?.notes ?? ''
    setEditorDate(todayKey)
    setSelectedDate(todayKey)
    setCalYear(todayDate.getFullYear())
  }

  // ─── Calendar day interactions ─────────────────────────────────────────────
  function handleDayClick(dateKey: string) {
    if (selectedDate === dateKey) doOpenEditor(dateKey) // tap-again = open (mobile-friendly)
    else setSelectedDate(dateKey)
  }

  function handleDayDoubleClick(dateKey: string) {
    doOpenEditor(dateKey)
  }

  // ─── Quarter toggle ────────────────────────────────────────────────────────
  function toggleQ(label: string) {
    setOpenQ(prev => ({ ...prev, [label]: !prev[label] }))
  }

  // ─── Has journal entry check ────────────────────────────────────────────────
  const hasEntry = useCallback((dateKey: string) => {
    return !!(calData[dateKey]?.notes?.trim())
  }, [calData])

  // ─── Scroll to today's quarter on open ────────────────────────────────────
  const calContentRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (view !== 'calendar') return
    const q = QUARTERS.find(q => q.months.includes(todayDate.getMonth()))
    if (!q) return
    requestAnimationFrame(() => {
      const el = document.getElementById(`xp-j-q-${q.label}`)
      if (el && calContentRef.current) {
        calContentRef.current.scrollTop = el.offsetTop - 12
      }
    })
  }, [view, todayDate])

  // ─── Theme tokens ──────────────────────────────────────────────────────────
  const bg = isDark ? '#0d0f1a' : '#f8fafc'
  const bdr = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'
  const txt = isDark ? '#f1f5f9' : '#0f172a'
  const muted = isDark ? 'rgba(255,255,255,0.38)' : 'rgba(0,0,0,0.36)'
  const surfaceBg = isDark ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.02)'
  const acc = '#7c3aed'

  // ═══════════════════════════════════════════════════════════════════════════
  // CALENDAR VIEW — header + quarterly grid
  // ═══════════════════════════════════════════════════════════════════════════

  const calendarView = (
    <>
      {/* Animated purple header */}
      <style>{`
        @keyframes xpJHdrFlow {
          0%   { background-position: 0%   50%; }
          50%  { background-position: 100% 50%; }
          100% { background-position: 0%   50%; }
        }
        .xp-j-hdr {
          background: linear-gradient(
            135deg,
            #4a1a8c  0%,
            #5b21b6 22%,
            #7c3aed 46%,
            #8b5cf6 65%,
            #7c3aed 82%,
            #6d28d9 100%
          );
          background-size: 320% 320%;
          animation: xpJHdrFlow 14s ease infinite;
        }
      `}</style>

      <div
        className="xp-j-hdr"
        style={{
          height: 60,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 20px',
          flexShrink: 0,
          borderBottom: '0.5px solid rgba(255,255,255,0.06)',
        }}
      >
        <div>
          <div style={{ color: '#fff', fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em' }}>
            📝 Journal
          </div>
          <div style={{ color: 'rgba(255,255,255,0.58)', fontSize: 11, marginTop: 1 }}>
            Personal reflections &amp; notes
          </div>
        </div>
        <button
          onClick={doClose}
          style={{
            width: 32, height: 32, borderRadius: '50%', border: 'none', cursor: 'pointer',
            background: 'rgba(255,255,255,0.14)', color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
          }}
        >
          ✕
        </button>
      </div>

      {/* Year navigation bar */}
      <div style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        padding: '9px 20px',
        borderBottom: `0.5px solid ${bdr}`,
        flexShrink: 0,
        background: surfaceBg,
      }}>
        <button
          onClick={() => setCalYear(y => y - 1)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: muted, fontSize: 18, padding: '2px 6px', lineHeight: 1 }}
        >
          ‹
        </button>
        <span style={{ color: txt, fontSize: 14, fontWeight: 600, minWidth: 48, textAlign: 'center' }}>
          {calYear}
        </span>
        <button
          onClick={() => setCalYear(y => y + 1)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: muted, fontSize: 18, padding: '2px 6px', lineHeight: 1 }}
        >
          ›
        </button>
        {calYear !== todayDate.getFullYear() && (
          <button
            onClick={() => { setCalYear(todayDate.getFullYear()) }}
            style={{
              fontSize: 11, padding: '2px 8px', borderRadius: 6,
              border: `0.5px solid ${acc}`, background: 'transparent',
              color: acc, cursor: 'pointer', fontWeight: 500,
              position: 'absolute', right: 20,
            }}
          >
            Today
          </button>
        )}
      </div>

      {/* Quarterly calendar content — scrollable */}
      <div ref={calContentRef} style={{ flex: 1, overflowY: 'auto', padding: '12px 16px 20px' }}>
        {QUARTERS.map(q => {
          const isOpen = openQ[q.label]
          return (
            <div key={q.label} id={`xp-j-q-${q.label}`} style={{ marginBottom: 12 }}>
              {/* Quarter header */}
              <button
                onClick={() => toggleQ(q.label)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 7,
                  background: 'none', border: 'none', cursor: 'pointer',
                  padding: '5px 4px 6px',
                  borderRadius: 6,
                  color: muted,
                }}
              >
                <Chevron open={isOpen} />
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: muted }}>
                  {q.label} {calYear}
                </span>
                <div style={{ flex: 1, height: '0.5px', background: bdr, marginLeft: 4 }} />
              </button>

              {/* Quarter months grid */}
              {isOpen && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, paddingTop: 4 }}>
                  {q.months.map(m => (
                    <JournalMonthCard
                      key={m}
                      year={calYear}
                      month={m}
                      todayKey={todayKey}
                      selectedDate={selectedDate}
                      hasEntry={hasEntry}
                      isDark={isDark}
                      onDayClick={handleDayClick}
                      onDayDoubleClick={handleDayDoubleClick}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}

        {/* Footer hint */}
        <div style={{ textAlign: 'center', paddingTop: 4 }}>
          <span style={{ fontSize: 11, color: muted }}>
            Double-click a date to open the editor &nbsp;·&nbsp; 📝 has an entry
          </span>
        </div>
      </div>
    </>
  )

  // ═══════════════════════════════════════════════════════════════════════════
  // EDITOR VIEW
  // ═══════════════════════════════════════════════════════════════════════════

  const editorView = (
    <JournalEditorContent
      dateKey={editorDate}
      rawContent={calData[editorDate]?.notes ?? ''}
      isDark={isDark}
      isEditorOnToday={editorDate === todayKey}
      onContentChange={(s) => { pendingContentRef.current = s }}
      onPersist={persistEntry}
      onNavigateDay={navigateDay}
      onNavigateToday={navigateToday}
      onBack={doGoCalendar}
      onClose={doClose}
      attachments={calData[editorDate]?.attachments ?? []}
      onAttachmentsChange={atts => updateDay(editorDate, prev => ({ ...prev, attachments: atts }))}
    />
  )

  // ─── Root ─────────────────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto p-3 sm:p-4 pt-4"
      style={{ background: 'rgba(0,0,0,0.60)' }}
      onClick={doClose}
    >
      <div
        className="w-full sm:rounded-2xl"
        style={{
          maxWidth: 800,
          background: bg,
          border: `0.5px solid ${bdr}`,
          boxShadow: '0 24px 64px rgba(0,0,0,0.35)',
          height: 'calc(100vh - 48px)',
          maxHeight: 860,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          flexShrink: 0,
        }}
        onClick={e => e.stopPropagation()}
      >
        {view === 'calendar' ? calendarView : editorView}
      </div>
    </div>
  )
}

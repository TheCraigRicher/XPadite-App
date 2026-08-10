'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { useApp } from './AppContext'
import { parseJournalDoc } from './journalUtils'

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

// ─── Journal entry summary types & helpers ────────────────────────────────────

export interface JournalEntrySummary {
  label: string
  accentColor: string
}

const SECTION_ACCENT: Record<string, string> = {
  blue:     '#60a5fa',
  green:    '#4ade80',
  peach:    '#fb923c',
  pink:     '#f472b6',
  lavender: '#a78bfa',
}

function accentToBg(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

function extractFirstLine(tiptapJson: string | undefined): string {
  if (!tiptapJson) return ''
  try {
    const doc = JSON.parse(tiptapJson)
    const parts: string[] = []
    function walk(node: unknown) {
      const n = node as Record<string, unknown>
      if (!n || typeof n !== 'object') return
      if (n.type === 'text' && typeof n.text === 'string') parts.push(n.text)
      if (n.type === 'paragraph' && parts.length > 0) parts.push('\n')
      if (Array.isArray(n.content)) (n.content as unknown[]).forEach(walk)
    }
    walk(doc)
    const firstLine = parts.join('').split('\n').find(l => l.trim()) ?? ''
    return firstLine.trim().slice(0, 52)
  } catch { return '' }
}

function getJournalEntrySummaries(notes: string | undefined): JournalEntrySummary[] {
  if (!notes?.trim()) return []
  try {
    const doc = parseJournalDoc(notes)
    const results: JournalEntrySummary[] = []
    for (const block of doc.blocks) {
      if (block.type === 'text') {
        const line = extractFirstLine(block.content)
        if (!line) continue  // skip empty text blocks
        results.push({ label: line, accentColor: '#a78bfa' })
      } else if (block.type === 'section') {
        const line = extractFirstLine(block.content)
        results.push({
          label: line || `Journal ${results.length + 1}`,
          accentColor: SECTION_ACCENT[block.sectionColor ?? 'lavender'] ?? '#a78bfa',
        })
      } else if (block.type === 'drawing') {
        results.push({ label: block.name ?? `Drawing ${results.length + 1}`, accentColor: '#f9a8d4' })
      } else if (block.type === 'image') {
        results.push({ label: block.name ?? `Photo ${results.length + 1}`, accentColor: '#6ee7b7' })
      }
    }
    // Fallback: if doc parsed but produced nothing (e.g. empty tiptap doc migrated), show one entry
    if (results.length === 0 && notes.trim()) {
      results.push({ label: 'Journal', accentColor: '#a78bfa' })
    }
    return results
  } catch {
    return [{ label: 'Journal', accentColor: '#a78bfa' }]
  }
}

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
  const days     = new Date(y, m + 1, 0).getDate()
  const out: (number | null)[] = Array(firstDow).fill(null)
  for (let d = 1; d <= days; d++) out.push(d)
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

// ─── Chevron ─────────────────────────────────────────────────────────────────

function Chevron({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      className="w-3.5 h-3.5 transition-transform duration-200"
      style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)', flexShrink: 0 }}
    >
      <polyline points="6 9 12 15 18 9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ─── Journal Month Card ───────────────────────────────────────────────────────

interface JournalMonthCardProps {
  year: number
  month: number
  todayKey: string
  selectedDate: string | null
  getEntrySummaries: (dateKey: string) => JournalEntrySummary[]
  isDark: boolean
  onDayClick: (dateKey: string) => void
  onDayDoubleClick: (dateKey: string) => void
}

const MAX_LABELS = 3

// Single source of truth for the 7-column calendar grid.
// Both the DOW header row and the day-cell rows reference this SAME object,
// making column misalignment structurally impossible.
const CAL_GRID: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(7, 1fr)',
  gap: 2,
}

function JournalMonthCard({
  year, month, todayKey, selectedDate, getEntrySummaries, isDark, onDayClick, onDayDoubleClick,
}: JournalMonthCardProps) {
  const cells   = useMemo(() => buildCells(year, month), [year, month])
  const acc     = '#7c3aed'
  const txt     = isDark ? '#e2e8f0' : '#1e293b'
  const dowColor = isDark ? 'rgba(167,139,250,0.58)' : 'rgba(109,40,217,0.48)'
  const cardBg  = isDark ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.70)'
  const cardBdr = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)'

  // Journal cell border/background when the day has entries but is not selected/today
  const journalBdr = isDark ? 'rgba(167,139,250,0.30)' : 'rgba(124,58,237,0.22)'
  const journalBg  = isDark ? 'rgba(167,139,250,0.07)' : 'rgba(124,58,237,0.04)'
  // Hover targets — updated via style attributes in event handlers
  const journalHoverBdr = isDark ? 'rgba(167,139,250,0.55)' : 'rgba(124,58,237,0.45)'
  const journalHoverBg  = isDark ? 'rgba(167,139,250,0.13)' : 'rgba(124,58,237,0.08)'

  return (
    <div style={{
      background: cardBg,
      border: `0.5px solid ${cardBdr}`,
      borderRadius: 10,
      padding: '10px 8px 8px',
      display: 'flex', flexDirection: 'column', gap: 2,
    }}>
      {/* Month name */}
      <div style={{
        textAlign: 'center', fontSize: 11, fontWeight: 600,
        color: txt, paddingBottom: 4, letterSpacing: '0.02em',
      }}>
        {MONTH_NAMES[month]}
      </div>

      {/* Single CAL_GRID container: DOW headers and ALL day cells share the exact same
          7-column grid definition. Column alignment is structurally guaranteed. */}
      <div style={CAL_GRID}>
        {DOW_LABELS.map((d, i) => (
          <div key={`dow_${i}`} style={{
            textAlign: 'center', fontSize: 9, fontWeight: 600,
            color: dowColor, paddingBottom: 8,
          }}>
            {d}
          </div>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <div key={`_${i}`} style={{ height: 60 }} />

          const dateKey   = toKey(year, month, day)
          const isToday   = dateKey === todayKey
          const isSel     = selectedDate === dateKey
          const summaries = getEntrySummaries(dateKey)
          const hasJ      = summaries.length > 0
          const visible   = summaries.slice(0, MAX_LABELS)

          return (
            <button
              key={dateKey}
              onClick={() => onDayClick(dateKey)}
              onDoubleClick={() => onDayDoubleClick(dateKey)}
              title={hasJ
                ? summaries.map(s => s.label).join(' · ')
                : `${MONTH_SHORT[month]} ${day}`
              }
              onMouseEnter={e => {
                if (!hasJ || isSel) return
                const el = e.currentTarget
                el.style.borderColor = isToday ? 'rgba(124,58,237,0.60)' : journalHoverBdr
                el.style.background  = isToday
                  ? (isDark ? 'rgba(124,58,237,0.15)' : 'rgba(124,58,237,0.08)')
                  : journalHoverBg
              }}
              onMouseLeave={e => {
                if (!hasJ || isSel) return
                const el = e.currentTarget
                el.style.borderColor = isToday ? 'rgba(124,58,237,0.40)' : journalBdr
                el.style.background  = isToday
                  ? (isDark ? 'rgba(124,58,237,0.10)' : 'rgba(124,58,237,0.05)')
                  : journalBg
              }}
              style={{
                height: 60,
                display: 'flex', flexDirection: 'column',
                alignItems: 'stretch',
                borderRadius: 7,
                border: isSel
                  ? `1.5px solid ${acc}`
                  : isToday
                  ? `1px solid rgba(124,58,237,0.40)`
                  : hasJ
                  ? `0.5px solid ${journalBdr}`
                  : '1px solid transparent',
                background: isSel
                  ? (isDark ? 'rgba(124,58,237,0.22)' : 'rgba(124,58,237,0.10)')
                  : isToday
                  ? (isDark ? 'rgba(124,58,237,0.10)' : 'rgba(124,58,237,0.05)')
                  : hasJ
                  ? journalBg
                  : 'transparent',
                cursor: 'pointer',
                padding: '4px 3px 3px',
                transition: 'border-color 140ms, background 140ms',
                overflow: 'hidden',
              }}
            >
              {/* Date number — centered horizontally to align with the DOW label above */}
              <span style={{
                fontSize: 11,
                fontWeight: isToday ? 700 : isSel ? 600 : 400,
                color: isToday || isSel ? acc : txt,
                lineHeight: 1,
                textAlign: 'center',
                marginBottom: 2,
                flexShrink: 0,
              }}>
                {day}
              </span>

              {/* Journal mini-labels — only render when entries exist */}
              {hasJ && (
                <div style={{
                  display: 'flex', flexDirection: 'column', gap: 1.5,
                  alignSelf: 'stretch', overflow: 'hidden',
                }}>
                  {visible.map((s, idx) => (
                    <div
                      key={idx}
                      style={{
                        display: 'flex', alignItems: 'center',
                        height: 13, flexShrink: 0,
                        borderLeft: `2px solid ${s.accentColor}`,
                        paddingLeft: 2,
                        borderRadius: '0 3px 3px 0',
                        background: accentToBg(s.accentColor, isDark ? 0.20 : 0.15),
                        overflow: 'hidden',
                        minWidth: 0,
                      }}
                    >
                      <span style={{
                        fontSize: 7.5,
                        lineHeight: '13px',
                        color: isDark ? 'rgba(255,255,255,0.88)' : 'rgba(0,0,0,0.72)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        minWidth: 0,
                        paddingRight: 2,
                        display: 'block',
                      }}>
                        {s.label}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

interface JournalWorkspaceModalProps {
  onClose: () => void
}

export function JournalWorkspaceModal({ onClose }: JournalWorkspaceModalProps) {
  const { isDark, calData, updateDay } = useApp()

  const todayDate = useMemo(() => new Date(), [])
  const todayKey  = useMemo(getTodayKey, [])

  const [view, setView]             = useState<'calendar' | 'editor'>('calendar')
  const [calYear, setCalYear]       = useState(todayDate.getFullYear())
  const [openQ, setOpenQ]           = useState<Record<string, boolean>>({ Q1: true, Q2: true, Q3: true, Q4: true })
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [editorDate, setEditorDate] = useState(todayKey)

  // ── ESC key — calendar view only; editor ESC is owned by JournalEditorContent ─
  const escRef = useRef<() => void>(() => {})
  escRef.current = () => {
    if (view !== 'editor') doClose()
    // editor ESC is intercepted by JournalEditorContent's own capture listener
  }
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') escRef.current() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Persist ───────────────────────────────────────────────────────────────────
  const persistEntry = useCallback((dateKey: string, content: string) => {
    updateDay(dateKey, prev => ({ ...prev, notes: content }))
  }, [updateDay])

  // ── Navigation ────────────────────────────────────────────────────────────────
  // NOTE: no flush() on navigation — the child editor owns save/discard via its dirty guard
  function doOpenEditor(dateKey: string) {
    setEditorDate(dateKey)
    setSelectedDate(dateKey)
    setView('editor')
  }

  function doGoCalendar() { setView('calendar') }
  function doClose()      { onClose() }

  function navigateDay(delta: number) {
    const key = shiftDay(editorDate, delta)
    setEditorDate(key)
    setSelectedDate(key)
  }

  function navigateToday() {
    setEditorDate(todayKey)
    setSelectedDate(todayKey)
    setCalYear(todayDate.getFullYear())
  }

  function handleDayClick(dateKey: string) {
    if (selectedDate === dateKey) doOpenEditor(dateKey)
    else setSelectedDate(dateKey)
  }

  function handleDayDoubleClick(dateKey: string) { doOpenEditor(dateKey) }

  function toggleQ(label: string) {
    setOpenQ(prev => ({ ...prev, [label]: !prev[label] }))
  }

  const getEntrySummaries = useCallback((dateKey: string): JournalEntrySummary[] => {
    return getJournalEntrySummaries(calData[dateKey]?.notes)
  }, [calData])

  // ── Scroll to today's quarter on calendar open ────────────────────────────────
  const calContentRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (view !== 'calendar') return
    const q = QUARTERS.find(q => q.months.includes(todayDate.getMonth()))
    if (!q) return
    requestAnimationFrame(() => {
      const el = document.getElementById(`xp-j-q-${q.label}`)
      if (el && calContentRef.current) calContentRef.current.scrollTop = el.offsetTop - 12
    })
  }, [view, todayDate])

  // ── Theme ─────────────────────────────────────────────────────────────────────
  // Match Dashboard exactly: rgba(9,4,22,0.99) dark / var(--xp-bg3) light
  const shellBg = isDark ? 'rgba(9,4,22,0.99)' : 'var(--xp-bg3)'
  const bdr     = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'
  const muted   = isDark ? 'rgba(255,255,255,0.38)' : 'rgba(0,0,0,0.36)'

  // ═══════════════════════════════════════════════════════════════════════════
  // CALENDAR VIEW
  // ═══════════════════════════════════════════════════════════════════════════

  const calendarView = (
    <>
      {/* Header — centered title, Dashboard-style buttons */}
      <div
        className="xp-j-hdr"
        style={{
          height: 64,
          display: 'flex', alignItems: 'center',
          padding: '0 20px',
          flexShrink: 0,
          position: 'relative',
          borderBottom: '0.5px solid rgba(255,255,255,0.06)',
        }}
      >
        {/* Back — absolute left so it doesn't offset the center */}
        <button
          onClick={doClose}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium hover:opacity-80 flex-shrink-0"
          style={{ position: 'absolute', left: 20, background: 'rgba(255,255,255,0.08)', border: '0.5px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.80)' }}
        >
          ← Back
        </button>

        {/* Centered: large circular arrows flanking the title */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <button
              onClick={() => setCalYear(y => y - 1)}
              title="Previous year"
              style={{
                width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(255,255,255,0.14)', border: '1px solid rgba(255,255,255,0.28)',
                color: '#fff', cursor: 'pointer', padding: 0,
                transition: 'background 120ms, transform 80ms',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.24)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.14)' }}
              onMouseDown={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(0.92)' }}
              onMouseUp={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>

            <span style={{ color: '#fff', fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em', lineHeight: 1 }}>
              📝 Journal {calYear}
            </span>

            <button
              onClick={() => setCalYear(y => y + 1)}
              title="Next year"
              style={{
                width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(255,255,255,0.14)', border: '1px solid rgba(255,255,255,0.28)',
                color: '#fff', cursor: 'pointer', padding: 0,
                transition: 'background 120ms, transform 80ms',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.24)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.14)' }}
              onMouseDown={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(0.92)' }}
              onMouseUp={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>
        </div>

        {/* Right: Today (when not current year) + Close */}
        <div style={{ position: 'absolute', right: 20, display: 'flex', alignItems: 'center', gap: 6 }}>
          {calYear !== todayDate.getFullYear() && (
            <button
              onClick={() => setCalYear(todayDate.getFullYear())}
              style={{
                background: 'rgba(255,255,255,0.10)', border: '0.5px solid rgba(255,255,255,0.22)',
                borderRadius: 8, cursor: 'pointer', color: 'rgba(255,255,255,0.65)',
                fontSize: 10, padding: '3px 8px', lineHeight: 1.4,
              }}
            >
              Today
            </button>
          )}
          <button
            onClick={doClose}
            className="text-xs px-2.5 py-1.5 rounded-lg hover:opacity-80 flex-shrink-0"
            style={{ background: 'rgba(239,68,68,0.15)', border: '0.5px solid rgba(239,68,68,0.28)', color: '#fca5a5' }}
          >
            × Close
          </button>
        </div>
      </div>

      {/* Quarterly calendar content */}
      <div ref={calContentRef} style={{ flex: 1, overflowY: 'auto', padding: '14px 20px 28px' }}>
        {QUARTERS.map(q => {
          const isOpen = openQ[q.label]
          return (
            <div
              key={q.label}
              id={`xp-j-q-${q.label}`}
              style={{ marginBottom: 12, borderBottom: `0.5px solid ${bdr}`, paddingBottom: 4 }}
            >
              {/* Quarter header — matches CalendarSection.tsx style */}
              <button
                onClick={() => toggleQ(q.label)}
                className="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--xp-txt2)' }}
              >
                <Chevron open={isOpen} />
                <span className="text-xs font-semibold" style={{ color: 'var(--xp-acc)' }}>
                  {q.label}
                </span>
                <span className="text-[10px]" style={{ color: 'var(--xp-txt3)' }}>
                  {calYear}
                </span>
                <div style={{ flex: 1, height: '0.5px', background: bdr, marginLeft: 4 }} />
              </button>

              {/* Month grid */}
              {isOpen && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, paddingTop: 4, paddingBottom: 8 }}>
                  {q.months.map(m => (
                    <JournalMonthCard
                      key={m}
                      year={calYear}
                      month={m}
                      todayKey={todayKey}
                      selectedDate={selectedDate}
                      getEntrySummaries={getEntrySummaries}
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

        <div style={{ textAlign: 'center', paddingTop: 4 }}>
          <span style={{ fontSize: 11, color: muted }}>
            Double-click a date to open the journal editor
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
      onContentChange={() => {/* child owns all persistence via onPersist */}}
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
    <>
      {/* Shared animated header — always mounted so editor view can use xp-j-hdr */}
      <style>{`
        @keyframes xpJHdrFlow {
          0%   { background-position: 0%   50%; }
          50%  { background-position: 100% 50%; }
          100% { background-position: 0%   50%; }
        }
        .xp-j-hdr {
          background: linear-gradient(135deg, #4a1a8c 0%, #5b21b6 30%, #7c3aed 65%, #8b5cf6 100%);
          background-size: 300% 300%;
          animation: xpJHdrFlow 14s ease infinite;
        }
      `}</style>

      {/* Overlay — exactly matches DayDashboardModal */}
      <div
        className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto p-3 sm:p-4 pt-4"
        style={{ background: isDark ? 'rgba(0,0,0,0.82)' : 'rgba(0,0,0,0.55)' }}
      >
        {/* Shell — exactly matches DayDashboardModal width tokens */}
        <div
          className="w-full rounded-2xl shadow-2xl overflow-hidden max-w-[640px] lg:max-w-[1296px]"
          style={{
            background: shellBg,
            border: isDark ? '0.5px solid rgba(124,58,237,0.22)' : '0.5px solid var(--xp-bdr2)',
            boxShadow: isDark
              ? '0 30px 70px rgba(0,0,0,0.75), 0 0 0 0.5px rgba(124,58,237,0.16), inset 0 1px 0 rgba(255,255,255,0.04)'
              : '0 20px 50px rgba(0,0,0,0.12)',
            // Fixed height so Journal fills near the full viewport
            height: 'calc(100vh - 44px)',
            maxHeight: 'calc(100vh - 44px)',
            display: 'flex', flexDirection: 'column',
            marginBottom: 24,
          }}
          onClick={e => e.stopPropagation()}
        >
          {view === 'calendar' ? calendarView : editorView}
        </div>
      </div>
    </>
  )
}

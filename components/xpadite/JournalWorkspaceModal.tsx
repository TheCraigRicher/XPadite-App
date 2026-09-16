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
  mobileNavSpace?: boolean
  onDirtyChange?: (dirty: boolean) => void
  closeIntent?: 'save' | 'discard' | null
}

export function JournalWorkspaceModal({ onClose, mobileNavSpace, onDirtyChange, closeIntent }: JournalWorkspaceModalProps) {
  const { isDark, calData, updateDay } = useApp()

  const todayDate = useMemo(() => new Date(), [])
  const todayKey  = useMemo(getTodayKey, [])

  const [view, setView]             = useState<'calendar' | 'editor' | 'library'>('editor')
  const [calYear, setCalYear]       = useState(todayDate.getFullYear())
  const [openQ, setOpenQ]           = useState<Record<string, boolean>>({ Q1: true, Q2: true, Q3: true, Q4: true })
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [editorDate, setEditorDate] = useState(todayKey)
  const [selectedLibEntry, setSelectedLibEntry] = useState<string | null>(null)
  const [renamingEntry, setRenamingEntry]       = useState<string | null>(null)
  const [renameValue, setRenameValue]           = useState('')
  const [draggingKey, setDraggingKey]           = useState<string | null>(null)
  const [dropZoneOver, setDropZoneOver]         = useState(false)
  const [deleteConfirmKey, setDeleteConfirmKey] = useState<string | null>(null)
  const libTouchRef      = useRef<{ key: string; time: number } | null>(null)
  const dropZoneRef      = useRef<HTMLDivElement>(null)
  const longPressRef     = useRef<ReturnType<typeof setTimeout> | null>(null)
  const touchDragKeyRef  = useRef<string | null>(null)
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null)
  const [libViewMode, setLibViewMode]   = useState<'compact' | 'detail' | 'tile' | 'thumbnail'>('compact')
  const [libSortOrder, setLibSortOrder] = useState<'newer' | 'older'>('newer')

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

  // ── Library rename + open handlers ───────────────────────────────────────────
  function handleLibClick(dateKey: string, title: string) {
    setSelectedLibEntry(dateKey)
    setRenamingEntry(dateKey)
    setRenameValue(title)
  }
  function handleLibDoubleClick(dateKey: string) {
    setRenamingEntry(null)
    doOpenEditor(dateKey)
  }
  function handleLibTouchEnd(dateKey: string, title: string) {
    const now = Date.now()
    const last = libTouchRef.current
    if (last?.key === dateKey && now - last.time < 350) {
      libTouchRef.current = null
      setRenamingEntry(null)
      doOpenEditor(dateKey)
    } else {
      libTouchRef.current = { key: dateKey, time: now }
      setSelectedLibEntry(dateKey)
      setRenamingEntry(dateKey)
      setRenameValue(title)
    }
  }
  function commitLibRename(dateKey: string) {
    const trimmed = renameValue.trim()
    const existingDoc = parseJournalDoc(calData[dateKey]?.notes)
    const updated = { ...existingDoc }
    if (trimmed) updated.title = trimmed
    else delete updated.title
    updateDay(dateKey, prev => ({ ...prev, notes: JSON.stringify(updated) }))
    setRenamingEntry(null)
  }

  function commitDelete(dateKey: string) {
    updateDay(dateKey, prev => ({ ...prev, notes: '' }))
    if (renamingEntry === dateKey) setRenamingEntry(null)
    if (selectedLibEntry === dateKey) setSelectedLibEntry(null)
    setDeleteConfirmKey(null)
  }

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

  // ── Library entries — all dates with journal content ────────────────────────
  const libraryEntries = useMemo(() => {
    const entries = Object.entries(calData)
      .filter(([, d]) => d.notes?.trim())
      .map(([key]) => {
        const [y, m, d] = fromKey(key)
        const parsedDoc = parseJournalDoc(calData[key]?.notes)
        const title = parsedDoc.title?.trim() || extractFirstLine(calData[key]?.notes) || 'Untitled'
        return { dateKey: key, year: y, month: m, day: d, title }
      })
    return libSortOrder === 'newer'
      ? entries.sort((a, b) => b.dateKey.localeCompare(a.dateKey))
      : entries.sort((a, b) => a.dateKey.localeCompare(b.dateKey))
  }, [calData, libSortOrder])

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
        {/* Back — absolute left, hidden on mobile (bottom nav handles close) */}
        <button
          onClick={doClose}
          className="hidden sm:flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium hover:opacity-80 flex-shrink-0"
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
              📋 Planner/Journal {calYear}
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

        {/* Right: Today (when not current year) + Close — hidden on mobile */}
        <div className="hidden sm:flex" style={{ position: 'absolute', right: 20, alignItems: 'center', gap: 6 }}>
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

      {/* ── Bottom view-nav bar ───────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        padding: '10px 16px', flexShrink: 0,
        borderTop: '0.5px solid rgba(124,58,237,0.20)',
        background: 'rgba(8,20,58,0.98)',
        boxShadow: 'inset 0 1px 0 rgba(124,58,237,0.10), 0 -6px 24px rgba(0,0,0,0.40)',
      }}>
        {([
          { key: 'calendar' as const, icon: '📅', label: 'Journal Calendar', action: () => setView('calendar') },
          { key: 'library'  as const, icon: '📚', label: 'Library',          action: () => setView('library')  },
          { key: 'editor'   as const, icon: '✏️', label: 'Editor',           action: () => setView('editor')   },
        ]).map(item => {
          const active = view === item.key
          return (
            <button
              key={item.key}
              onClick={item.action}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 14px', borderRadius: 8,
                fontSize: 12, fontWeight: active ? 600 : 400,
                cursor: 'pointer',
                background: active ? 'rgba(124,58,237,0.18)' : 'rgba(124,58,237,0.06)',
                border: `0.5px solid ${active ? 'rgba(124,58,237,0.40)' : 'rgba(124,58,237,0.16)'}`,
                color: active ? '#a78bfa' : 'rgba(255,255,255,0.55)',
                transition: 'background 120ms',
              }}
            >
              {item.icon} {item.label}
            </button>
          )
        })}
      </div>
    </>
  )

  // ── Shared drag-event factory used by all 4 library card modes ──────────────
  function mkDragHandlers(dateKey: string, title: string, isRen: boolean) {
    return {
      draggable: !isRen,
      onDragStart: !isRen ? () => setDraggingKey(dateKey) : undefined,
      onDragEnd: () => { setDraggingKey(null); setDropZoneOver(false) },
      onTouchStart: (e: React.TouchEvent) => {
        if (isRen) return
        touchStartPosRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
        longPressRef.current = setTimeout(() => {
          touchDragKeyRef.current = dateKey
          setDraggingKey(dateKey)
          setSelectedLibEntry(dateKey)
          if (navigator.vibrate) navigator.vibrate(50)
        }, 600)
      },
      onTouchMove: (e: React.TouchEvent) => {
        const t = e.touches[0]
        if (longPressRef.current && touchStartPosRef.current) {
          if (Math.hypot(t.clientX - touchStartPosRef.current.x, t.clientY - touchStartPosRef.current.y) > 10) {
            clearTimeout(longPressRef.current); longPressRef.current = null
          }
        }
        if (touchDragKeyRef.current) {
          e.preventDefault()
          setDropZoneOver(dropZoneRef.current?.contains(document.elementFromPoint(t.clientX, t.clientY)) ?? false)
        }
      },
      onTouchEnd: (e: React.TouchEvent) => {
        if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null }
        if (touchDragKeyRef.current) {
          const t = e.changedTouches[0]
          if (dropZoneRef.current?.contains(document.elementFromPoint(t.clientX, t.clientY))) {
            setDeleteConfirmKey(touchDragKeyRef.current)
          }
          touchDragKeyRef.current = null; setDraggingKey(null); setDropZoneOver(false)
          e.preventDefault(); return
        }
        e.preventDefault(); handleLibTouchEnd(dateKey, title)
      },
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LIBRARY VIEW
  // ═══════════════════════════════════════════════════════════════════════════

  const libraryView = (
    <>
      {/* Header */}
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
        <button
          onClick={() => setView('calendar')}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium hover:opacity-80 flex-shrink-0"
          style={{ position: 'absolute', left: 20, background: 'rgba(255,255,255,0.08)', border: '0.5px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.80)' }}
        >
          ← Back
        </button>

        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ color: '#fff', fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em' }}>
            📚 Library
          </span>
        </div>

        {/* Close — hidden on mobile (bottom nav handles close) */}
        <button
          onClick={doClose}
          className="hidden sm:block text-xs px-2.5 py-1.5 rounded-lg hover:opacity-80 flex-shrink-0"
          style={{ position: 'absolute', right: 20, background: 'rgba(239,68,68,0.15)', border: '0.5px solid rgba(239,68,68,0.28)', color: '#fca5a5' }}
        >
          × Close
        </button>
      </div>

      {/* Controls bar — view mode + sort order */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 20px', flexShrink: 0,
        borderBottom: `0.5px solid ${bdr}`,
        background: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)',
        gap: 12,
      }}>
        {/* View mode toggles + sort order inline */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 10, color: muted, marginRight: 4, whiteSpace: 'nowrap' }}>View:</span>
          {([
            { key: 'compact'   as const, label: '⊡ Default'   , title: 'Default (compact) mode' },
            { key: 'detail'    as const, label: '≡ Detail'    , title: 'Detail mode'    },
            { key: 'tile'      as const, label: '⊞ Tile'      , title: 'Tile mode'      },
            { key: 'thumbnail' as const, label: '⊟ Thumbnail' , title: 'Thumbnail mode' },
          ]).map(opt => (
            <button
              key={opt.key}
              onClick={() => setLibViewMode(opt.key)}
              title={opt.title}
              style={{
                padding: '3px 10px', borderRadius: 6, fontSize: 11,
                fontWeight: libViewMode === opt.key ? 600 : 400,
                cursor: 'pointer',
                background: libViewMode === opt.key ? 'rgba(124,58,237,0.18)' : 'transparent',
                border: `0.5px solid ${libViewMode === opt.key ? 'rgba(124,58,237,0.40)' : 'rgba(124,58,237,0.14)'}`,
                color: libViewMode === opt.key ? '#a78bfa' : isDark ? 'rgba(255,255,255,0.50)' : 'rgba(0,0,0,0.45)',
                transition: 'background 120ms',
              }}
            >{opt.label}</button>
          ))}

          {/* Divider */}
          <span style={{ width: 1, height: 14, background: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)', margin: '0 4px', flexShrink: 0 }} />

          {/* Sort toggles — inline after view buttons */}
          {([
            { key: 'newer' as const, label: '↓ Newer' },
            { key: 'older' as const, label: '↑ Older' },
          ]).map(opt => (
            <button
              key={opt.key}
              onClick={() => setLibSortOrder(opt.key)}
              style={{
                padding: '3px 10px', borderRadius: 6, fontSize: 11,
                fontWeight: libSortOrder === opt.key ? 600 : 400,
                cursor: 'pointer',
                background: libSortOrder === opt.key ? 'rgba(124,58,237,0.18)' : 'transparent',
                border: `0.5px solid ${libSortOrder === opt.key ? 'rgba(124,58,237,0.40)' : 'rgba(124,58,237,0.14)'}`,
                color: libSortOrder === opt.key ? '#a78bfa' : isDark ? 'rgba(255,255,255,0.50)' : 'rgba(0,0,0,0.45)',
                transition: 'background 120ms',
              }}
            >{opt.label}</button>
          ))}
        </div>

        {/* Trash drop zone */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
          <div
            ref={dropZoneRef}
            onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDropZoneOver(true) }}
            onDragLeave={() => setDropZoneOver(false)}
            onDrop={e => {
              e.preventDefault(); setDropZoneOver(false)
              if (draggingKey) { setDeleteConfirmKey(draggingKey); setDraggingKey(null) }
            }}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 500,
              userSelect: 'none', transition: 'all 180ms',
              border: `1.5px dashed ${dropZoneOver ? 'rgba(239,68,68,0.85)' : draggingKey ? 'rgba(239,68,68,0.50)' : 'rgba(239,68,68,0.25)'}`,
              background: dropZoneOver ? 'rgba(239,68,68,0.18)' : draggingKey ? 'rgba(239,68,68,0.07)' : 'transparent',
              color: dropZoneOver ? '#fca5a5' : draggingKey ? 'rgba(239,68,68,0.75)' : 'rgba(239,68,68,0.45)',
              cursor: draggingKey ? 'copy' : 'default',
              transform: dropZoneOver ? 'scale(1.05)' : 'scale(1)',
            }}
          >
            🗑️ {dropZoneOver ? 'Release to delete' : draggingKey ? 'Drop here to delete' : 'Delete'}
          </div>
          {!draggingKey && !dropZoneOver && (
            <span style={{
              fontSize: 9, color: 'rgba(239,68,68,0.28)', fontStyle: 'italic',
              whiteSpace: 'nowrap', lineHeight: 1, userSelect: 'none',
            }}>
              {typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0
                ? 'Long-press & drag a document here to delete'
                : 'Drag a document here to delete'}
            </span>
          )}
        </div>
      </div>

      {/* Entry list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
        {libraryEntries.length === 0 ? (
          <div style={{ textAlign: 'center', paddingTop: 48, color: muted, fontSize: 13 }}>
            No journal entries yet. Start writing in the Editor.
          </div>
        ) : libViewMode === 'compact' ? (
          /* ── Compact/Default mode: desktop-folder style tight grid ────── */
          <div style={{
            display: 'flex', flexWrap: 'wrap',
            gap: 6, alignContent: 'flex-start',
          }}>
            {libraryEntries.map(entry => {
              const isSel = selectedLibEntry === entry.dateKey
              const isRen = renamingEntry === entry.dateKey
              const renInput = (fontSize: number, width?: string) => (
                <input
                  autoFocus
                  type="text"
                  value={renameValue}
                  maxLength={80}
                  onChange={e => setRenameValue(e.target.value)}
                  onBlur={() => commitLibRename(entry.dateKey)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); commitLibRename(entry.dateKey) }
                    if (e.key === 'Escape') { e.stopPropagation(); setRenamingEntry(null) }
                  }}
                  onClick={e => e.stopPropagation()}
                  onTouchEnd={e => e.stopPropagation()}
                  style={{
                    fontSize, fontWeight: 500, lineHeight: 1.3, width: width ?? '100%',
                    background: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)',
                    border: '1px solid rgba(124,58,237,0.55)', borderRadius: 4, outline: 'none',
                    color: isDark ? 'rgba(255,255,255,0.92)' : 'rgba(0,0,0,0.85)',
                    padding: '1px 5px', boxSizing: 'border-box',
                  }}
                />
              )
              const isDragThis = draggingKey === entry.dateKey
              return (
                <div
                  key={entry.dateKey}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleLibClick(entry.dateKey, entry.title)}
                  onDoubleClick={() => handleLibDoubleClick(entry.dateKey)}
                  onKeyDown={e => { if (e.key === 'Enter') handleLibDoubleClick(entry.dateKey) }}
                  {...mkDragHandlers(entry.dateKey, entry.title, isRen)}
                  title={`${entry.title} — ${MONTH_NAMES[entry.month]} ${entry.day}, ${entry.year}\nClick/tap to rename · Double-click/tap to open\nDrag / long-press to delete zone to remove`}
                  style={{
                    width: 110, flexShrink: 0,
                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                    padding: '10px 8px 8px', borderRadius: 10, textAlign: 'center',
                    cursor: isDragThis ? 'grabbing' : 'pointer', userSelect: 'none',
                    background: isSel
                      ? (isDark ? 'rgba(124,58,237,0.28)' : 'rgba(124,58,237,0.14)')
                      : 'transparent',
                    border: isSel
                      ? '1.5px solid rgba(124,58,237,0.55)'
                      : '1.5px solid transparent',
                    transition: 'background 130ms, border-color 130ms, opacity 150ms, transform 150ms',
                    opacity: isDragThis ? 0.40 : 1,
                    transform: isDragThis ? 'scale(0.92)' : undefined,
                    gap: 5,
                  }}
                >
                  <div style={{
                    width: 52, height: 60, borderRadius: 6,
                    background: isSel
                      ? (isDark ? 'rgba(124,58,237,0.30)' : 'rgba(124,58,237,0.15)')
                      : (isDark ? 'rgba(255,255,255,0.06)' : 'rgba(124,58,237,0.07)'),
                    border: `0.5px solid ${isSel ? 'rgba(124,58,237,0.45)' : isDark ? 'rgba(255,255,255,0.10)' : 'rgba(124,58,237,0.14)'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 24, flexShrink: 0, position: 'relative',
                  }}>
                    📝
                    <div style={{
                      position: 'absolute', top: 0, right: 0, width: 0, height: 0,
                      borderStyle: 'solid', borderWidth: '0 10px 10px 0',
                      borderColor: `transparent ${isDark ? 'rgba(0,0,0,0.40)' : 'rgba(124,58,237,0.18)'} transparent transparent`,
                    }} />
                  </div>
                  {isRen ? renInput(11) : (
                    <span style={{
                      fontSize: 11, fontWeight: 500, lineHeight: 1.3,
                      color: isSel ? (isDark ? '#c4b5fd' : '#7c3aed') : isDark ? 'rgba(255,255,255,0.82)' : 'rgba(0,0,0,0.75)',
                      overflow: 'hidden', textOverflow: 'ellipsis',
                      display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                      width: '100%',
                    }}>{entry.title}</span>
                  )}
                  <span style={{ fontSize: 9, lineHeight: 1.2, color: isSel ? 'rgba(167,139,250,0.75)' : muted }}>
                    {MONTH_SHORT[entry.month]} {entry.day}, {entry.year}
                  </span>
                </div>
              )
            })}
          </div>
        ) : libViewMode === 'detail' ? (
          /* ── Detail mode: one row per entry ───────────────────────────── */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {libraryEntries.map(entry => {
              const isSel = selectedLibEntry === entry.dateKey
              const isRen = renamingEntry === entry.dateKey
              const isDragThis = draggingKey === entry.dateKey
              return (
                <div
                  key={entry.dateKey}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleLibClick(entry.dateKey, entry.title)}
                  onDoubleClick={() => handleLibDoubleClick(entry.dateKey)}
                  onKeyDown={e => { if (e.key === 'Enter') handleLibDoubleClick(entry.dateKey) }}
                  {...mkDragHandlers(entry.dateKey, entry.title, isRen)}
                  title="Click/tap to rename · Double-click/tap to open · Drag to 🗑️ to delete"
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '12px 16px', borderRadius: 10, textAlign: 'left',
                    cursor: isDragThis ? 'grabbing' : 'pointer', userSelect: 'none',
                    background: isSel
                      ? (isDark ? 'rgba(124,58,237,0.20)' : 'rgba(124,58,237,0.10)')
                      : (isDark ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.70)'),
                    border: isSel
                      ? '1.5px solid rgba(124,58,237,0.50)'
                      : `0.5px solid ${isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)'}`,
                    transition: 'background 140ms, border-color 140ms, opacity 150ms, transform 150ms',
                    opacity: isDragThis ? 0.40 : 1,
                    transform: isDragThis ? 'scale(0.98)' : undefined,
                    minWidth: 0,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: 1 }}>
                    <span style={{ fontSize: 18, flexShrink: 0 }}>📝</span>
                    {isRen ? (
                      <input
                        autoFocus
                        type="text"
                        value={renameValue}
                        maxLength={80}
                        onChange={e => setRenameValue(e.target.value)}
                        onBlur={() => commitLibRename(entry.dateKey)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') { e.preventDefault(); commitLibRename(entry.dateKey) }
                          if (e.key === 'Escape') { e.stopPropagation(); setRenamingEntry(null) }
                        }}
                        onClick={e => e.stopPropagation()}
                        onTouchEnd={e => e.stopPropagation()}
                        style={{
                          flex: 1, minWidth: 0, fontSize: 13, fontWeight: 500,
                          background: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)',
                          border: '1px solid rgba(124,58,237,0.55)', borderRadius: 4, outline: 'none',
                          color: isDark ? 'rgba(255,255,255,0.92)' : 'rgba(0,0,0,0.85)',
                          padding: '1px 5px', boxSizing: 'border-box',
                        }}
                      />
                    ) : (
                      <span style={{
                        fontSize: 13, fontWeight: 500,
                        color: isSel ? '#a78bfa' : isDark ? 'rgba(255,255,255,0.88)' : 'rgba(0,0,0,0.80)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        minWidth: 0,
                      }}>{entry.title}</span>
                    )}
                  </div>
                  <span style={{
                    fontSize: 11, flexShrink: 0, marginLeft: 12,
                    color: isSel ? 'rgba(167,139,250,0.80)' : muted,
                    whiteSpace: 'nowrap',
                  }}>{MONTH_NAMES[entry.month]} {entry.day}, {entry.year}</span>
                </div>
              )
            })}
          </div>
        ) : libViewMode === 'tile' ? (
          /* ── Tile mode: 2-column grid ──────────────────────────────────── */
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
            {libraryEntries.map(entry => {
              const isSel = selectedLibEntry === entry.dateKey
              const isRen = renamingEntry === entry.dateKey
              const isDragThis = draggingKey === entry.dateKey
              return (
                <div
                  key={entry.dateKey}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleLibClick(entry.dateKey, entry.title)}
                  onDoubleClick={() => handleLibDoubleClick(entry.dateKey)}
                  onKeyDown={e => { if (e.key === 'Enter') handleLibDoubleClick(entry.dateKey) }}
                  {...mkDragHandlers(entry.dateKey, entry.title, isRen)}
                  title="Click/tap to rename · Double-click/tap to open · Drag to 🗑️ to delete"
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                    padding: '14px 16px', borderRadius: 12, textAlign: 'left',
                    cursor: isDragThis ? 'grabbing' : 'pointer', userSelect: 'none',
                    background: isSel
                      ? (isDark ? 'rgba(124,58,237,0.20)' : 'rgba(124,58,237,0.10)')
                      : (isDark ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.80)'),
                    border: isSel
                      ? '1.5px solid rgba(124,58,237,0.50)'
                      : `0.5px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)'}`,
                    transition: 'background 140ms, border-color 140ms, opacity 150ms, transform 150ms',
                    opacity: isDragThis ? 0.40 : 1,
                    transform: isDragThis ? 'scale(0.96)' : undefined,
                    gap: 8, minWidth: 0,
                  }}
                >
                  <span style={{ fontSize: 22 }}>📝</span>
                  {isRen ? (
                    <input
                      autoFocus
                      type="text"
                      value={renameValue}
                      maxLength={80}
                      onChange={e => setRenameValue(e.target.value)}
                      onBlur={() => commitLibRename(entry.dateKey)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { e.preventDefault(); commitLibRename(entry.dateKey) }
                        if (e.key === 'Escape') { e.stopPropagation(); setRenamingEntry(null) }
                      }}
                      onClick={e => e.stopPropagation()}
                      onTouchEnd={e => e.stopPropagation()}
                      style={{
                        width: '100%', fontSize: 13, fontWeight: 600,
                        background: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)',
                        border: '1px solid rgba(124,58,237,0.55)', borderRadius: 4, outline: 'none',
                        color: isDark ? 'rgba(255,255,255,0.92)' : 'rgba(0,0,0,0.85)',
                        padding: '1px 5px', boxSizing: 'border-box',
                      }}
                    />
                  ) : (
                    <span style={{
                      fontSize: 13, fontWeight: 600, lineHeight: 1.3,
                      color: isSel ? '#a78bfa' : isDark ? 'rgba(255,255,255,0.90)' : 'rgba(0,0,0,0.82)',
                      overflow: 'hidden', textOverflow: 'ellipsis',
                      display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                      width: '100%',
                    }}>{entry.title}</span>
                  )}
                  <span style={{ fontSize: 10, marginTop: 2, color: isSel ? 'rgba(167,139,250,0.80)' : muted }}>
                    {MONTH_NAMES[entry.month]} {entry.day}, {entry.year}
                  </span>
                </div>
              )
            })}
          </div>
        ) : (
          /* ── Thumbnail mode: 3-column grid, larger cards ───────────────── */
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            {libraryEntries.map(entry => {
              const isSel = selectedLibEntry === entry.dateKey
              const isRen = renamingEntry === entry.dateKey
              const isDragThis = draggingKey === entry.dateKey
              return (
                <div
                  key={entry.dateKey}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleLibClick(entry.dateKey, entry.title)}
                  onDoubleClick={() => handleLibDoubleClick(entry.dateKey)}
                  onKeyDown={e => { if (e.key === 'Enter') handleLibDoubleClick(entry.dateKey) }}
                  {...mkDragHandlers(entry.dateKey, entry.title, isRen)}
                  title="Click/tap to rename · Double-click/tap to open · Drag to 🗑️ to delete"
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                    padding: '20px 14px 16px', borderRadius: 14, textAlign: 'center',
                    cursor: isDragThis ? 'grabbing' : 'pointer', userSelect: 'none',
                    background: isSel
                      ? (isDark ? 'rgba(124,58,237,0.22)' : 'rgba(124,58,237,0.12)')
                      : (isDark ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.85)'),
                    border: isSel
                      ? '1.5px solid rgba(124,58,237,0.55)'
                      : `0.5px solid ${isDark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.07)'}`,
                    transition: 'background 140ms, border-color 140ms, opacity 150ms, transform 150ms',
                    opacity: isDragThis ? 0.40 : 1,
                    transform: isDragThis ? 'scale(0.96)' : undefined,
                    gap: 10, minWidth: 0,
                  }}
                >
                  <div style={{
                    width: '100%', height: 70, borderRadius: 8,
                    background: isSel ? 'rgba(124,58,237,0.15)' : isDark ? 'rgba(124,58,237,0.08)' : 'rgba(124,58,237,0.06)',
                    border: `0.5px solid rgba(124,58,237,0.15)`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 28, marginBottom: 2,
                  }}>📝</div>
                  {isRen ? (
                    <input
                      autoFocus
                      type="text"
                      value={renameValue}
                      maxLength={80}
                      onChange={e => setRenameValue(e.target.value)}
                      onBlur={() => commitLibRename(entry.dateKey)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { e.preventDefault(); commitLibRename(entry.dateKey) }
                        if (e.key === 'Escape') { e.stopPropagation(); setRenamingEntry(null) }
                      }}
                      onClick={e => e.stopPropagation()}
                      onTouchEnd={e => e.stopPropagation()}
                      style={{
                        width: '100%', fontSize: 12, fontWeight: 600,
                        background: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)',
                        border: '1px solid rgba(124,58,237,0.55)', borderRadius: 4, outline: 'none',
                        color: isDark ? 'rgba(255,255,255,0.92)' : 'rgba(0,0,0,0.85)',
                        padding: '1px 5px', boxSizing: 'border-box', textAlign: 'center',
                      }}
                    />
                  ) : (
                    <span style={{
                      fontSize: 12, fontWeight: 600, lineHeight: 1.3,
                      color: isSel ? '#a78bfa' : isDark ? 'rgba(255,255,255,0.90)' : 'rgba(0,0,0,0.82)',
                      overflow: 'hidden', textOverflow: 'ellipsis',
                      display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                      width: '100%',
                    }}>{entry.title}</span>
                  )}
                  <span style={{ fontSize: 10, color: isSel ? 'rgba(167,139,250,0.80)' : muted }}>
                    {MONTH_SHORT[entry.month]} {entry.day}, {entry.year}
                  </span>
                </div>
              )
            })}
          </div>
        )}

        {libraryEntries.length > 0 && (
          <div style={{ textAlign: 'center', paddingTop: 14 }}>
            <span style={{ fontSize: 11, color: muted }}>
              Click / tap to rename · Double-click / double-tap to open in editor
            </span>
          </div>
        )}
      </div>

      {/* ── Delete confirmation dialog ───────────────────────────────────── */}
      {deleteConfirmKey && (() => {
        const entry = libraryEntries.find(e => e.dateKey === deleteConfirmKey)
        return (
          <div
            style={{
              position: 'absolute', inset: 0, zIndex: 80,
              background: 'rgba(0,0,0,0.55)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: 'inherit',
            }}
            onClick={() => setDeleteConfirmKey(null)}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{
                background: isDark ? '#1e1b2e' : '#ffffff',
                border: `1px solid ${isDark ? 'rgba(239,68,68,0.35)' : 'rgba(239,68,68,0.25)'}`,
                borderRadius: 14, padding: '24px 28px', maxWidth: 320, width: '90%',
                boxShadow: '0 8px 40px rgba(0,0,0,0.45)',
                display: 'flex', flexDirection: 'column', gap: 16,
              }}
            >
              <div style={{ fontSize: 15, fontWeight: 600, color: isDark ? 'rgba(255,255,255,0.90)' : 'rgba(0,0,0,0.85)' }}>
                Delete this document?
              </div>
              {entry && (
                <div style={{ fontSize: 13, color: muted, lineHeight: 1.4 }}>
                  <strong style={{ color: isDark ? 'rgba(255,255,255,0.80)' : 'rgba(0,0,0,0.75)' }}>{entry.title}</strong>
                  <br />
                  {MONTH_NAMES[entry.month]} {entry.day}, {entry.year}
                </div>
              )}
              <div style={{ fontSize: 12, color: muted }}>
                This action cannot be undone.
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button
                  onClick={() => setDeleteConfirmKey(null)}
                  style={{
                    padding: '7px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500,
                    cursor: 'pointer',
                    background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
                    border: `0.5px solid ${isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.12)'}`,
                    color: isDark ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.65)',
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => commitDelete(deleteConfirmKey)}
                  style={{
                    padding: '7px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                    cursor: 'pointer',
                    background: 'rgba(239,68,68,0.88)',
                    border: '0.5px solid rgba(239,68,68,0.60)',
                    color: '#fff',
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Bottom view-nav bar ───────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        padding: '10px 16px', flexShrink: 0,
        borderTop: '0.5px solid rgba(124,58,237,0.20)',
        background: 'rgba(8,20,58,0.98)',
        boxShadow: 'inset 0 1px 0 rgba(124,58,237,0.10), 0 -6px 24px rgba(0,0,0,0.40)',
      }}>
        {([
          { key: 'calendar' as const, icon: '📅', label: 'Journal Calendar', action: () => setView('calendar') },
          { key: 'library'  as const, icon: '📚', label: 'Library',          action: () => setView('library')  },
          { key: 'editor'   as const, icon: '✏️', label: 'Editor',           action: () => setView('editor')   },
        ]).map(item => {
          const active = view === item.key
          return (
            <button
              key={item.key}
              onClick={item.action}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 14px', borderRadius: 8,
                fontSize: 12, fontWeight: active ? 600 : 400,
                cursor: 'pointer',
                background: active ? 'rgba(124,58,237,0.18)' : 'rgba(124,58,237,0.06)',
                border: `0.5px solid ${active ? 'rgba(124,58,237,0.40)' : 'rgba(124,58,237,0.16)'}`,
                color: active ? '#a78bfa' : 'rgba(255,255,255,0.55)',
                transition: 'background 120ms',
              }}
            >
              {item.icon} {item.label}
            </button>
          )
        })}
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
      onJournalCalendar={() => setView('calendar')}
      onLibrary={() => setView('library')}
      onEditor={() => setView('editor')}
      onDirtyChange={onDirtyChange}
      closeIntent={closeIntent}
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

      {/* Overlay */}
      <div
        className={mobileNavSpace
          ? "fixed inset-x-0 top-0 bottom-14 sm:inset-0 z-[49] sm:z-[70] flex flex-col sm:flex-row sm:items-start sm:justify-center sm:overflow-y-auto sm:p-4"
          : "fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto p-3 sm:p-4 pt-4"
        }
        style={{ background: isDark ? 'rgba(0,0,0,0.82)' : 'rgba(0,0,0,0.55)' }}
      >
        {/* Shell */}
        <div
          className={mobileNavSpace
            ? "w-full rounded-none sm:rounded-2xl shadow-2xl overflow-hidden sm:max-w-[640px] lg:max-w-[1296px] xp-j-shell-contained"
            : "w-full rounded-2xl shadow-2xl overflow-hidden max-w-[640px] lg:max-w-[1296px]"
          }
          style={{
            background: shellBg,
            border: isDark ? '0.5px solid rgba(124,58,237,0.22)' : '0.5px solid var(--xp-bdr2)',
            boxShadow: isDark
              ? '0 30px 70px rgba(0,0,0,0.75), 0 0 0 0.5px rgba(124,58,237,0.16), inset 0 1px 0 rgba(255,255,255,0.04)'
              : '0 20px 50px rgba(0,0,0,0.12)',
            display: 'flex', flexDirection: 'column',
            ...(mobileNavSpace ? {} : { height: 'calc(100vh - 44px)', maxHeight: 'calc(100vh - 44px)', marginBottom: 24 }),
          }}
          onClick={e => e.stopPropagation()}
        >
          {view === 'calendar' ? calendarView : view === 'library' ? libraryView : editorView}
        </div>
      </div>
    </>
  )
}

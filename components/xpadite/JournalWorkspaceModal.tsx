'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { useApp } from './AppContext'
import { parseJournalDoc, mkId } from './journalUtils'
import { exportToTxt, exportToPdf, exportToDocx, makeFilename, type ExportEntry } from './journalExport'
import type { JournalFolder } from './types'

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

// ─── Library organization: categories/labels vs folders ───────────────────────
// CATEGORY/LABEL describes what a doc is about (a doc may have several).
// FOLDER describes where a doc is organized (a doc belongs to at most one).
// Built-ins are fixed constants — only user-created custom labels/folders
// need their own identity (persisted via AppContext's journalLabels).

interface LibraryCategory { id: string; name: string; color: string }

const BUILTIN_CATEGORIES: LibraryCategory[] = [
  { id: 'important',   name: 'Important',   color: '#f87171' },
  { id: 'priority',    name: 'Priority',    color: '#fb923c' },
  { id: 'reflections', name: 'Reflections', color: '#a78bfa' },
  { id: 'planning',    name: 'Planning',    color: '#60a5fa' },
  { id: 'goals',       name: 'Goals',       color: '#4ade80' },
]

const LABEL_COLOR_OPTIONS = ['purple', 'yellow', 'green', 'pink', 'blue'] as const
type LabelColorKey = (typeof LABEL_COLOR_OPTIONS)[number]

const LABEL_COLOR_HEX: Record<LabelColorKey, string> = {
  purple: '#a78bfa',
  yellow: '#fde047',
  green:  '#4ade80',
  pink:   '#f9a8d4',
  blue:   '#60a5fa',
}

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
  maxLabels?: number
  embedded?: boolean
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
  maxLabels = MAX_LABELS, embedded = false,
}: JournalMonthCardProps) {
  const cells   = useMemo(() => buildCells(year, month), [year, month])
  const acc     = '#7c3aed'
  const txt     = isDark ? '#e2e8f0' : '#1e293b'
  const dowColor = isDark ? 'rgba(167,139,250,0.58)' : 'rgba(109,40,217,0.48)'
  const cardBg  = isDark ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.70)'
  const cardBdr = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)'
  const overflowColor = isDark ? 'rgba(255,255,255,0.42)' : 'rgba(0,0,0,0.38)'
  const cardStyle: React.CSSProperties = embedded
    ? { padding: '6px 8px 10px', display: 'flex', flexDirection: 'column', gap: 2 }
    : { background: cardBg, border: `0.5px solid ${cardBdr}`, borderRadius: 10, padding: '10px 8px 8px', display: 'flex', flexDirection: 'column', gap: 2 }

  // Journal cell border/background when the day has entries but is not selected/today
  const journalBdr = isDark ? 'rgba(167,139,250,0.30)' : 'rgba(124,58,237,0.22)'
  const journalBg  = isDark ? 'rgba(167,139,250,0.07)' : 'rgba(124,58,237,0.04)'
  // Hover targets — updated via style attributes in event handlers
  const journalHoverBdr = isDark ? 'rgba(167,139,250,0.55)' : 'rgba(124,58,237,0.45)'
  const journalHoverBg  = isDark ? 'rgba(167,139,250,0.13)' : 'rgba(124,58,237,0.08)'

  return (
    <div style={cardStyle}>
      {/* Month name — hidden in embedded mode (header row already shows it) */}
      {!embedded && (
        <div style={{
          textAlign: 'center', fontSize: 11, fontWeight: 600,
          color: txt, paddingBottom: 4, letterSpacing: '0.02em',
        }}>
          {MONTH_NAMES[month]}
        </div>
      )}

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
          const visible   = summaries.slice(0, maxLabels)
          const overflow  = summaries.length - maxLabels

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
                  {overflow > 0 && (
                    <div style={{
                      fontSize: 6.5, lineHeight: '10px', flexShrink: 0,
                      paddingLeft: 3, color: overflowColor,
                    }}>
                      +{overflow}
                    </div>
                  )}
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── Library card ⋮ menu — shared across all 4 view modes ─────────────────────
// One implementation reused by compact/detail/tile/thumbnail instead of 4
// duplicated menu blobs. Anchored via its own position:relative wrapper —
// callers control placement (corner-absolute for grid cards, inline for the
// Detail row) by passing `wrapperStyle`.

interface LibraryCardMenuProps {
  isDark: boolean
  bdr: string
  isOpen: boolean
  view: 'main' | 'category' | 'folder'
  onOpenChange: (open: boolean) => void
  onViewChange: (view: 'main' | 'category' | 'folder') => void
  onRename: () => void
  onExport: () => void
  onDeleteRequest: () => void
  categories: LibraryCategory[]
  activeLabelIds: string[]
  onToggleLabel: (id: string) => void
  onDeleteLabel: (id: string) => void
  onCreateLabel: () => void
  folders: JournalFolder[]
  activeFolderId: string | null
  onSetFolder: (id: string | null) => void
  onDeleteFolder: (id: string) => void
  onCreateFolder: () => void
  wrapperStyle: React.CSSProperties
}

function LibraryCardMenu({
  isDark, bdr, isOpen, view, onOpenChange, onViewChange,
  onRename, onExport, onDeleteRequest,
  categories, activeLabelIds, onToggleLabel, onDeleteLabel, onCreateLabel,
  folders, activeFolderId, onSetFolder, onDeleteFolder, onCreateFolder,
  wrapperStyle,
}: LibraryCardMenuProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return
    function outside(e: MouseEvent | TouchEvent) {
      if (ref.current?.contains(e.target as Node)) return
      onOpenChange(false)
    }
    document.addEventListener('mousedown', outside)
    document.addEventListener('touchstart', outside)
    return () => {
      document.removeEventListener('mousedown', outside)
      document.removeEventListener('touchstart', outside)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  const itemStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8,
    width: '100%', padding: '9px 12px',
    background: 'transparent', border: 'none', cursor: 'pointer',
    fontSize: 12, fontWeight: 500, textAlign: 'left',
    color: isDark ? 'rgba(255,255,255,0.80)' : 'rgba(0,0,0,0.70)',
  }
  const headerStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 6,
    width: '100%', padding: '8px 12px', cursor: 'pointer',
    background: 'transparent', border: 'none', textAlign: 'left',
    fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em',
    color: isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.42)',
  }
  const dividerStyle: React.CSSProperties = {
    height: 1, background: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)', margin: '4px 0',
  }
  const xBtnStyle: React.CSSProperties = {
    marginLeft: 'auto', flexShrink: 0, width: 16, height: 16, borderRadius: 4,
    border: 'none', background: 'transparent', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 10, color: isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.28)',
  }

  return (
    <div ref={ref} style={wrapperStyle} onClick={e => e.stopPropagation()} onTouchEnd={e => e.stopPropagation()}>
      <button
        onClick={() => { onOpenChange(!isOpen); onViewChange('main') }}
        title="Document actions"
        aria-label="Document actions"
        style={{
          width: 22, height: 22, borderRadius: 6, border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: isOpen ? (isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.09)') : (isDark ? 'rgba(0,0,0,0.20)' : 'rgba(255,255,255,0.55)'),
          color: isDark ? 'rgba(255,255,255,0.65)' : 'rgba(0,0,0,0.55)',
          fontSize: 13, fontWeight: 700, lineHeight: 1,
        }}
      >⋮</button>

      {isOpen && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 70,
          background: isDark ? '#1a1530' : '#ffffff',
          border: `0.5px solid ${bdr}`,
          borderRadius: 10, overflow: 'hidden',
          boxShadow: '0 4px 24px rgba(0,0,0,0.30)',
          minWidth: 178,
        }}>
          {view === 'main' && (
            <>
              <button onClick={onRename} style={itemStyle}><span>✏️</span>Rename</button>
              <button onClick={onExport} style={itemStyle}><span>📤</span>Export</button>
              <button onClick={() => onViewChange('category')} style={itemStyle}><span>🏷</span>Category<span style={{ marginLeft: 'auto', opacity: 0.5 }}>›</span></button>
              <button onClick={() => onViewChange('folder')} style={itemStyle}><span>📁</span>Move to Folder<span style={{ marginLeft: 'auto', opacity: 0.5 }}>›</span></button>
              <div style={dividerStyle} />
              <button onClick={onDeleteRequest} style={{ ...itemStyle, color: '#f87171' }}><span>🗑</span>Delete</button>
            </>
          )}

          {view === 'category' && (
            <>
              <button onClick={() => onViewChange('main')} style={headerStyle}>‹ Category</button>
              <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                {categories.map(cat => {
                  const checked = activeLabelIds.includes(cat.id)
                  const isCustom = !BUILTIN_CATEGORIES.some(b => b.id === cat.id)
                  return (
                    <div key={cat.id} style={{ display: 'flex', alignItems: 'center' }}>
                      <button onClick={() => onToggleLabel(cat.id)} style={{ ...itemStyle, flex: 1 }}>
                        <span style={{
                          width: 13, height: 13, borderRadius: 4, flexShrink: 0,
                          border: `1.5px solid ${checked ? cat.color : isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.25)'}`,
                          background: checked ? cat.color : 'transparent',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          {checked && <svg width="8" height="8" viewBox="0 0 12 12" fill="none"><polyline points="2,6 5,9 10,3" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                        </span>
                        {cat.name}
                      </button>
                      {isCustom && (
                        <button onClick={() => onDeleteLabel(cat.id)} title="Delete label" style={{ ...xBtnStyle, marginRight: 8 }}>✕</button>
                      )}
                    </div>
                  )
                })}
              </div>
              <div style={dividerStyle} />
              <button onClick={onCreateLabel} style={itemStyle}><span>+</span>Create Custom Label</button>
            </>
          )}

          {view === 'folder' && (
            <>
              <button onClick={() => onViewChange('main')} style={headerStyle}>‹ Move to Folder</button>
              <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                <button onClick={() => onSetFolder(null)} style={itemStyle}>
                  <span style={{ opacity: activeFolderId === null ? 1 : 0 }}>✓</span>No Folder
                </button>
                {folders.map(f => (
                  <div key={f.id} style={{ display: 'flex', alignItems: 'center' }}>
                    <button onClick={() => onSetFolder(f.id)} style={{ ...itemStyle, flex: 1 }}>
                      <span style={{ opacity: activeFolderId === f.id ? 1 : 0 }}>✓</span>📁 {f.name}
                    </button>
                    <button onClick={() => onDeleteFolder(f.id)} title="Delete folder" style={{ ...xBtnStyle, marginRight: 8 }}>✕</button>
                  </div>
                ))}
              </div>
              <div style={dividerStyle} />
              <button onClick={onCreateFolder} style={itemStyle}><span>+</span>New Folder</button>
            </>
          )}
        </div>
      )}
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
  const {
    isDark, calData, updateDay,
    journalLabels, addJournalLabel, removeJournalLabel,
    journalFolders, addJournalFolder, removeJournalFolder,
  } = useApp()

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
  const [isSelectMode, setIsSelectMode]         = useState(false)
  const [selectedKeys, setSelectedKeys]         = useState<Set<string>>(new Set())
  const [deleteConfirmKeys, setDeleteConfirmKeys] = useState<string[] | null>(null)
  const [libViewMode, setLibViewMode]   = useState<'compact' | 'detail' | 'tile' | 'thumbnail'>('compact')
  const [libSortOrder, setLibSortOrder] = useState<'newer' | 'older'>('newer')
  const [openMobileMonths, setOpenMobileMonths] = useState<Set<number>>(
    () => new Set([todayDate.getMonth()])
  )
  const [openMobileQuarters, setOpenMobileQuarters] = useState<Record<string, boolean>>(
    { Q1: true, Q2: true, Q3: true, Q4: true }
  )
  const [libMonthFilter, setLibMonthFilter]         = useState<number | null>(null)
  const [isExportMode, setIsExportMode]             = useState(false)
  const [showMoreMenu, setShowMoreMenu]             = useState(false)
  const [exportFormatKeys, setExportFormatKeys]     = useState<string[] | null>(null)
  const [isExporting, setIsExporting]               = useState(false)

  // ── Library organization: filters, per-card ⋮ menu, create modals ───────────
  const [libFolderFilter, setLibFolderFilter]       = useState<string | null>(null)
  const [libCategoryFilter, setLibCategoryFilter]   = useState<string | null>(null)
  const [cardMenuOpen, setCardMenuOpen]             = useState<string | null>(null)
  const [cardMenuView, setCardMenuView]             = useState<'main' | 'category' | 'folder'>('main')
  const [showCreateLabel, setShowCreateLabel]       = useState(false)
  const [newLabelName, setNewLabelName]             = useState('')
  const [newLabelColor, setNewLabelColor]           = useState<LabelColorKey>('purple')
  const [showCreateFolder, setShowCreateFolder]     = useState(false)
  const [newFolderName, setNewFolderName]           = useState('')

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

  const editorFlushRef = useRef<(() => void) | null>(null)

  function doGoCalendar() { setView('calendar') }
  function doClose()      { editorFlushRef.current?.(); onClose() }

  // ── Library rename + open handlers ───────────────────────────────────────────
  // Single click/tap now opens the document directly (doOpenEditor, defined
  // above); rename moved entirely into the ⋮ menu's "Rename" action, which
  // reuses this exact same start/commit pair — no duplicate rename system.
  function handleLibRenameStart(dateKey: string, title: string) {
    setSelectedLibEntry(dateKey)
    setRenamingEntry(dateKey)
    setRenameValue(title)
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

  // ── Library organization: category (label) + folder assignment ──────────────
  // Read-modify-write against the doc's own JSON, exactly like commitLibRename
  // does for `title` — reuses the existing per-day persistence/RLS/cross-device
  // pipeline (updateDay) with zero new sync code for this relationship.
  function toggleDocLabel(dateKey: string, labelId: string) {
    const doc = parseJournalDoc(calData[dateKey]?.notes)
    const current = doc.labelIds ?? []
    const next = current.includes(labelId) ? current.filter(id => id !== labelId) : [...current, labelId]
    const updated = { ...doc, labelIds: next }
    updateDay(dateKey, prev => ({ ...prev, notes: JSON.stringify(updated) }))
  }
  function setDocFolder(dateKey: string, folderId: string | null) {
    const doc = parseJournalDoc(calData[dateKey]?.notes)
    const updated = { ...doc, folderId }
    updateDay(dateKey, prev => ({ ...prev, notes: JSON.stringify(updated) }))
  }

  // Deleting a label/folder only removes its definition + the assignment on
  // any document that used it — the document's content is never touched.
  function handleDeleteLabel(labelId: string) {
    removeJournalLabel(labelId)
    for (const [key, day] of Object.entries(calData)) {
      if (!day.notes?.trim()) continue
      const doc = parseJournalDoc(day.notes)
      if (doc.labelIds?.includes(labelId)) {
        const updated = { ...doc, labelIds: doc.labelIds.filter(id => id !== labelId) }
        updateDay(key, prev => ({ ...prev, notes: JSON.stringify(updated) }))
      }
    }
    if (libCategoryFilter === labelId) setLibCategoryFilter(null)
  }
  function handleDeleteFolder(folderId: string) {
    removeJournalFolder(folderId)
    for (const [key, day] of Object.entries(calData)) {
      if (!day.notes?.trim()) continue
      const doc = parseJournalDoc(day.notes)
      if (doc.folderId === folderId) {
        const updated = { ...doc, folderId: null }
        updateDay(key, prev => ({ ...prev, notes: JSON.stringify(updated) }))
      }
    }
    if (libFolderFilter === folderId) setLibFolderFilter(null)
  }
  function commitCreateLabel() {
    const name = newLabelName.trim()
    if (!name) return
    addJournalLabel({ id: mkId(), name, color: newLabelColor })
    setShowCreateLabel(false)
    setNewLabelName('')
    setNewLabelColor('purple')
  }
  function commitCreateFolder() {
    const name = newFolderName.trim()
    if (!name) return
    addJournalFolder({ id: mkId(), name })
    setShowCreateFolder(false)
    setNewFolderName('')
  }

  function enterSelectMode() {
    setIsSelectMode(true)
    setSelectedKeys(new Set())
    setRenamingEntry(null)
  }

  function exitSelectMode() {
    setIsSelectMode(false)
    setSelectedKeys(new Set())
    setIsExportMode(false)
  }

  function enterExportMode() {
    setIsExportMode(true)
    setIsSelectMode(true)
    setSelectedKeys(new Set())
    setRenamingEntry(null)
  }

  function exitExportMode() {
    setIsExportMode(false)
    setIsSelectMode(false)
    setSelectedKeys(new Set())
  }

  async function handleExport(format: 'pdf' | 'docx' | 'txt') {
    if (!exportFormatKeys || exportFormatKeys.length === 0) return
    setIsExporting(true)
    try {
      const entries: ExportEntry[] = exportFormatKeys.flatMap(key => {
        const e = libraryEntries.find(x => x.dateKey === key)
        return e ? [{ title: e.title, dateKey: key, notes: calData[key]?.notes, year: e.year, month: e.month, day: e.day }] : []
      })
      if (entries.length === 0) return
      const filename = entries.length === 1
        ? makeFilename(entries[0].title, entries[0].dateKey)
        : `XPadite-Journal-Export-${todayKey}`
      if (format === 'txt')  await exportToTxt(entries, filename)
      else if (format === 'pdf')  await exportToPdf(entries, filename)
      else                        await exportToDocx(entries, filename)
      setExportFormatKeys(null)
      exitExportMode()
    } catch (err) {
      console.error('Export failed:', err)
    } finally {
      setIsExporting(false)
    }
  }

  function toggleSelectKey(key: string) {
    setSelectedKeys(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function commitDeleteMany(keys: string[]) {
    for (const key of keys) {
      updateDay(key, prev => ({ ...prev, notes: '' }))
      if (renamingEntry === key) setRenamingEntry(null)
      if (selectedLibEntry === key) setSelectedLibEntry(null)
    }
    setDeleteConfirmKeys(null)
    exitSelectMode()
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

  function toggleMobileMonth(m: number) {
    setOpenMobileMonths(prev => {
      const next = new Set(prev)
      if (next.has(m)) next.delete(m)
      else next.add(m)
      return next
    })
  }

  function toggleMobileQuarter(label: string) {
    setOpenMobileQuarters(prev => ({ ...prev, [label]: !prev[label] }))
  }

  // Reset mobile month/quarter expansion when the viewed year changes
  useEffect(() => {
    const isCurrentYear = calYear === todayDate.getFullYear()
    setOpenMobileMonths(new Set(isCurrentYear ? [todayDate.getMonth()] : []))
    setOpenMobileQuarters({ Q1: true, Q2: true, Q3: true, Q4: true })
  }, [calYear, todayDate])

  // Close more menu on any outside click
  useEffect(() => {
    if (!showMoreMenu) return
    const close = () => setShowMoreMenu(false)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [showMoreMenu])

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
        return {
          dateKey: key, year: y, month: m, day: d, title,
          labelIds: parsedDoc.labelIds ?? [],
          folderId: parsedDoc.folderId ?? null,
        }
      })
    return libSortOrder === 'newer'
      ? entries.sort((a, b) => b.dateKey.localeCompare(a.dateKey))
      : entries.sort((a, b) => a.dateKey.localeCompare(b.dateKey))
  }, [calData, libSortOrder])

  // Month/Folder (mutually exclusive, from the "All ▾" control) AND Category
  // (independent, from "🏷 Category ▾") combine — e.g. newer Priority docs
  // inside the XPadite folder — without either resetting the other.
  const filteredLibraryEntries = useMemo(() => {
    return libraryEntries.filter(e => {
      if (libMonthFilter !== null && e.month !== libMonthFilter) return false
      if (libFolderFilter !== null && e.folderId !== libFolderFilter) return false
      if (libCategoryFilter !== null && !e.labelIds.includes(libCategoryFilter)) return false
      return true
    })
  }, [libraryEntries, libMonthFilter, libFolderFilter, libCategoryFilter])

  // All categories (built-in + custom), for rendering dots/checkmarks and
  // resolving a labelId to its display color.
  const allCategories = useMemo<LibraryCategory[]>(() => [
    ...BUILTIN_CATEGORIES,
    ...journalLabels.map(l => ({ id: l.id, name: l.name, color: LABEL_COLOR_HEX[l.color as LabelColorKey] ?? LABEL_COLOR_HEX.purple })),
  ], [journalLabels])

  const availableMonths = useMemo(
    () => Array.from(new Set(libraryEntries.map(e => e.month))).sort((a, b) => a - b),
    [libraryEntries],
  )

  // ── Scroll to today's quarter/month on calendar open ─────────────────────────
  const calContentRef  = useRef<HTMLDivElement>(null)
  const calMobileRef   = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (view !== 'calendar') return
    requestAnimationFrame(() => {
      // Desktop: scroll to today's quarter section
      const q = QUARTERS.find(q => q.months.includes(todayDate.getMonth()))
      if (q) {
        const el = document.getElementById(`xp-j-q-${q.label}`)
        if (el && calContentRef.current) calContentRef.current.scrollTop = el.offsetTop - 12
      }
      // Mobile: scroll so the current month header sits at the top of the scroll area.
      // getBoundingClientRect() is used to avoid offsetParent chain inaccuracies.
      const mEl = document.getElementById(`xp-jcal-mob-m-${todayDate.getMonth()}`)
      const container = calMobileRef.current
      if (mEl && container) {
        const elTop = mEl.getBoundingClientRect().top
        const containerTop = container.getBoundingClientRect().top
        container.scrollTop = container.scrollTop + (elTop - containerTop)
      }
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

      {/* Quarterly calendar content — desktop/tablet only */}
      <div ref={calContentRef} className="xp-jcal-quarters" style={{ flex: 1, overflowY: 'auto', padding: '14px 20px 28px' }}>
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

      {/* Mobile-only: collapsible Q/month accordion */}
      <div ref={calMobileRef} className="xp-jcal-mobile-grid" style={{ flex: 1, overflowY: 'auto', padding: '6px 12px 20px' }}>
        {QUARTERS.map(q => {
          const isQOpen = openMobileQuarters[q.label]
          return (
          <div key={q.label} style={{ marginBottom: 8 }}>
            {/* Quarter header — collapsible */}
            <button
              onClick={() => toggleMobileQuarter(q.label)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                width: '100%', padding: '8px 2px 5px',
                background: 'none', border: 'none', cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <svg
                width="9" height="9" viewBox="0 0 10 10"
                style={{
                  flexShrink: 0,
                  transform: isQOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                  transition: 'transform 150ms',
                  color: 'var(--xp-acc)',
                }}
              >
                <polyline points="3,1 8,5 3,9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--xp-acc)', letterSpacing: '0.03em' }}>
                {q.label}
              </span>
              <span style={{ fontSize: 10, color: muted }}>— {calYear}</span>
              <div style={{ flex: 1, height: '0.5px', background: bdr, marginLeft: 2 }} />
            </button>

            {/* Month rows — shown only when quarter is open */}
            {isQOpen && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {q.months.map(m => {
                const isOpen = openMobileMonths.has(m)
                const isCurrentM = m === todayDate.getMonth() && calYear === todayDate.getFullYear()
                return (
                  <div key={m} id={`xp-jcal-mob-m-${m}`}>
                    {/* Month header row */}
                    <button
                      onClick={() => toggleMobileMonth(m)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        width: '100%', padding: '8px 10px',
                        borderRadius: isOpen ? '8px 8px 0 0' : 8,
                        background: isOpen
                          ? (isDark ? 'rgba(124,58,237,0.18)' : 'rgba(124,58,237,0.09)')
                          : (isDark ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.65)'),
                        border: `0.5px solid ${isOpen
                          ? 'rgba(124,58,237,0.38)'
                          : (isDark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.09)')}`,
                        ...(isOpen ? { borderBottom: 'none' } : {}),
                        cursor: 'pointer', textAlign: 'left',
                        transition: 'background 120ms',
                      }}
                    >
                      <svg
                        width="10" height="10" viewBox="0 0 10 10"
                        style={{
                          flexShrink: 0,
                          transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                          transition: 'transform 150ms',
                          color: isOpen ? '#7c3aed' : (isDark ? 'rgba(255,255,255,0.42)' : 'rgba(0,0,0,0.32)'),
                        }}
                      >
                        <polyline points="3,1 8,5 3,9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <span style={{
                        fontSize: 12, fontWeight: isOpen ? 600 : 400,
                        color: isCurrentM
                          ? '#7c3aed'
                          : isOpen
                          ? (isDark ? '#c4b5fd' : '#5b21b6')
                          : (isDark ? 'rgba(255,255,255,0.78)' : 'rgba(0,0,0,0.65)'),
                        transition: 'color 120ms',
                      }}>
                        {MONTH_NAMES[m]}
                      </span>
                      {isCurrentM && (
                        <span style={{
                          fontSize: 8, fontWeight: 600,
                          color: '#7c3aed',
                          background: isDark ? 'rgba(124,58,237,0.18)' : 'rgba(124,58,237,0.10)',
                          border: '0.5px solid rgba(124,58,237,0.28)',
                          borderRadius: 4, padding: '1px 5px', lineHeight: 1.5,
                          marginLeft: 2,
                        }}>
                          Now
                        </span>
                      )}
                    </button>

                    {/* Expanded calendar */}
                    {isOpen && (
                      <div style={{
                        border: '0.5px solid rgba(124,58,237,0.38)',
                        borderTop: 'none',
                        borderRadius: '0 0 8px 8px',
                        overflow: 'hidden',
                        background: isDark ? 'rgba(124,58,237,0.04)' : 'rgba(248,245,255,0.80)',
                      }}>
                        <JournalMonthCard
                          year={calYear}
                          month={m}
                          todayKey={todayKey}
                          selectedDate={selectedDate}
                          getEntrySummaries={getEntrySummaries}
                          isDark={isDark}
                          onDayClick={handleDayClick}
                          onDayDoubleClick={handleDayDoubleClick}
                          embedded
                        />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            )}
          </div>
          )
        })}
        <div style={{ textAlign: 'center', paddingTop: 8, paddingBottom: 4 }}>
          <span style={{ fontSize: 11, color: muted }}>
            Tap a date to open the journal editor
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
              className={`xp-jws-nav-btn${active ? ' xp-jws-nav-active' : ''}`}
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
        {/* Mic slot — mobile only, disabled when not in Editor view */}
        <button
          className="xp-jws-mic-nav xp-jws-nav-btn"
          disabled
          style={{
            alignItems: 'center', gap: 6,
            padding: '6px 14px', borderRadius: 8,
            fontSize: 12, fontWeight: 400,
            cursor: 'not-allowed',
            background: 'rgba(124,58,237,0.06)',
            border: '0.5px solid rgba(124,58,237,0.16)',
            color: 'rgba(255,255,255,0.55)',
            opacity: 0.35,
          }}
          title="Microphone (available in Editor)"
        >🎙 Mic</button>
      </div>
    </>
  )

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
          className="hidden sm:flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium hover:opacity-80 flex-shrink-0"
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

      {/* Controls bar — wraps to a second line on narrow viewports instead of scrolling,
          so the "⋮ More menu" dropdown (which opens downward, below the bar) never gets
          clipped by a scroll container; this keeps everything on-screen with no page overflow. */}
      <div style={{
        display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4,
        padding: '7px 10px', flexShrink: 0, minHeight: 44,
        borderBottom: `0.5px solid ${bdr}`,
        background: isSelectMode
          ? isExportMode
            ? (isDark ? 'rgba(124,58,237,0.08)' : 'rgba(124,58,237,0.04)')
            : (isDark ? 'rgba(239,68,68,0.06)' : 'rgba(239,68,68,0.04)')
          : (isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)'),
        transition: 'background 180ms',
      }}>
        {isSelectMode ? (
          /* ── Selection mode (delete or export) ── */
          <>
            <button
              onClick={isExportMode ? exitExportMode : exitSelectMode}
              style={{
                padding: '5px 12px', borderRadius: 7, fontSize: 12, fontWeight: 500,
                cursor: 'pointer', flexShrink: 0,
                background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
                border: `0.5px solid ${isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.12)'}`,
                color: isDark ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.65)',
              }}
            >Cancel</button>
            <span style={{
              flex: 1, textAlign: 'center', fontSize: 12, fontWeight: 600,
              color: isDark ? 'rgba(255,255,255,0.82)' : 'rgba(0,0,0,0.72)',
            }}>
              {selectedKeys.size} selected
            </span>
            {isExportMode ? (
              <button
                onClick={() => { if (selectedKeys.size > 0) setExportFormatKeys([...selectedKeys]) }}
                disabled={selectedKeys.size === 0}
                style={{
                  padding: '5px 14px', borderRadius: 7, fontSize: 12, fontWeight: 600,
                  cursor: selectedKeys.size > 0 ? 'pointer' : 'default', flexShrink: 0,
                  background: selectedKeys.size > 0 ? 'rgba(124,58,237,0.88)' : 'rgba(124,58,237,0.14)',
                  border: `0.5px solid ${selectedKeys.size > 0 ? 'rgba(124,58,237,0.60)' : 'rgba(124,58,237,0.22)'}`,
                  color: selectedKeys.size > 0 ? '#fff' : 'rgba(124,58,237,0.38)',
                  transition: 'background 180ms, color 180ms',
                }}
              >Export</button>
            ) : (
              <button
                onClick={() => { if (selectedKeys.size > 0) setDeleteConfirmKeys([...selectedKeys]) }}
                disabled={selectedKeys.size === 0}
                style={{
                  padding: '5px 14px', borderRadius: 7, fontSize: 12, fontWeight: 600,
                  cursor: selectedKeys.size > 0 ? 'pointer' : 'default', flexShrink: 0,
                  background: selectedKeys.size > 0 ? 'rgba(239,68,68,0.88)' : 'rgba(239,68,68,0.14)',
                  border: `0.5px solid ${selectedKeys.size > 0 ? 'rgba(239,68,68,0.60)' : 'rgba(239,68,68,0.22)'}`,
                  color: selectedKeys.size > 0 ? '#fff' : 'rgba(239,68,68,0.38)',
                  transition: 'background 180ms, color 180ms',
                }}
              >Delete</button>
            )}
          </>
        ) : (
          /* ── Normal mode: View | Sort | Month | Delete | ⋮ ── */
          <>
            {/* Shared select style */}
            {(() => {
              const ss: React.CSSProperties = {
                padding: '4px 5px', borderRadius: 6, fontSize: 11, fontWeight: 500,
                cursor: 'pointer', flexShrink: 0, outline: 'none',
                border: `0.5px solid ${isDark ? 'rgba(124,58,237,0.32)' : 'rgba(124,58,237,0.28)'}`,
                background: isDark ? 'rgba(124,58,237,0.12)' : 'rgba(124,58,237,0.06)',
                color: isDark ? '#c4b5fd' : '#7c3aed',
              }
              return (
                <>
                  <select value={libViewMode} onChange={e => setLibViewMode(e.target.value as typeof libViewMode)} style={ss} title="View mode">
                    <option value="compact">Default</option>
                    <option value="detail">Detail</option>
                    <option value="tile">Tile</option>
                    <option value="thumbnail">Thumb</option>
                  </select>
                  <select value={libSortOrder} onChange={e => setLibSortOrder(e.target.value as 'newer' | 'older')} style={ss} title="Sort order">
                    <option value="newer">↓ Newer</option>
                    <option value="older">↑ Older</option>
                  </select>
                  {/* "All ▾" — month filter, extended with Folders per the Library organization upgrade.
                      Month and Folder are mutually exclusive (one dropdown, one choice); Category
                      (below) is a fully independent, additive filter. */}
                  <select
                    value={libFolderFilter !== null ? `f:${libFolderFilter}` : libMonthFilter !== null ? `m:${libMonthFilter}` : ''}
                    onChange={e => {
                      const v = e.target.value
                      if (v === '') { setLibMonthFilter(null); setLibFolderFilter(null) }
                      else if (v.startsWith('m:')) { setLibMonthFilter(Number(v.slice(2))); setLibFolderFilter(null) }
                      else if (v.startsWith('f:')) { setLibFolderFilter(v.slice(2)); setLibMonthFilter(null) }
                    }}
                    style={ss}
                    title="Filter by month or folder"
                  >
                    <option value="">All</option>
                    {availableMonths.map(m => (
                      <option key={m} value={`m:${m}`}>{MONTH_SHORT[m]}</option>
                    ))}
                    {journalFolders.length > 0 && (
                      <optgroup label="Folders">
                        {journalFolders.map(f => (
                          <option key={f.id} value={`f:${f.id}`}>📁 {f.name}</option>
                        ))}
                      </optgroup>
                    )}
                  </select>

                  {/* 🏷 Category — FILTERS the Library (finding documents), distinct from the
                      per-document ⋮ → Category menu which ASSIGNS categories. */}
                  <select
                    value={libCategoryFilter ?? ''}
                    onChange={e => setLibCategoryFilter(e.target.value === '' ? null : e.target.value)}
                    style={ss}
                    title="Filter by category"
                  >
                    <option value="">🏷 Category</option>
                    {BUILTIN_CATEGORIES.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                    {journalLabels.length > 0 && (
                      <optgroup label="Custom Labels">
                        {journalLabels.map(l => (
                          <option key={l.id} value={l.id}>{l.name}</option>
                        ))}
                      </optgroup>
                    )}
                  </select>

                  {/* + New Folder */}
                  <button onClick={() => setShowCreateFolder(true)} style={ss} title="Create a new folder">
                    + Folder
                  </button>
                </>
              )
            })()}

            <div style={{ flex: 1 }} />

            {/* Delete button */}
            <button
              onClick={enterSelectMode}
              style={{
                padding: '4px 9px', borderRadius: 6, fontSize: 11, fontWeight: 500,
                cursor: 'pointer', flexShrink: 0,
                background: 'transparent',
                border: '0.5px solid rgba(239,68,68,0.30)',
                color: 'rgba(239,68,68,0.55)',
                whiteSpace: 'nowrap',
              }}
            >🗑️ Delete</button>

            {/* ⋮ More menu */}
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <button
                onClick={e => { e.stopPropagation(); setShowMoreMenu(v => !v) }}
                style={{
                  padding: '4px 8px', borderRadius: 6, fontSize: 16, fontWeight: 700,
                  lineHeight: '14px', cursor: 'pointer',
                  background: showMoreMenu ? (isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.07)') : 'transparent',
                  border: `0.5px solid ${isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.12)'}`,
                  color: isDark ? 'rgba(255,255,255,0.65)' : 'rgba(0,0,0,0.50)',
                }}
                title="More actions"
              >⋮</button>
              {showMoreMenu && (
                <div style={{
                  position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 60,
                  background: isDark ? '#1a1530' : '#ffffff',
                  border: `0.5px solid ${bdr}`,
                  borderRadius: 10, overflow: 'hidden',
                  boxShadow: '0 4px 24px rgba(0,0,0,0.30)',
                  minWidth: 170,
                }}>
                  <button
                    onClick={() => { setShowMoreMenu(false); enterExportMode() }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      width: '100%', padding: '10px 14px',
                      background: 'transparent', border: 'none', cursor: 'pointer',
                      fontSize: 12, fontWeight: 500, textAlign: 'left',
                      color: isDark ? 'rgba(255,255,255,0.80)' : 'rgba(0,0,0,0.70)',
                    }}
                  >
                    <span>📤</span>Export documents
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Entry list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
        {filteredLibraryEntries.length === 0 ? (
          <div style={{ textAlign: 'center', paddingTop: 48, color: muted, fontSize: 13 }}>
            {libraryEntries.length === 0
              ? 'No journal entries yet. Start writing in the Editor.'
              : libMonthFilter !== null
                ? `No entries in ${MONTH_NAMES[libMonthFilter]}.`
                : libFolderFilter !== null || libCategoryFilter !== null
                  ? 'No documents match this filter.'
                  : 'No journal entries yet. Start writing in the Editor.'}
          </div>
        ) : libViewMode === 'compact' ? (
          /* ── Compact/Default mode: desktop-folder style tight grid ────── */
          <div style={{
            display: 'flex', flexWrap: 'wrap',
            gap: 6, alignContent: 'flex-start',
          }}>
            {filteredLibraryEntries.map(entry => {
              const isSel = selectedLibEntry === entry.dateKey
              const isRen = renamingEntry === entry.dateKey
              const isChecked = selectedKeys.has(entry.dateKey)
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
              return (
                <div
                  key={entry.dateKey}
                  role="button"
                  tabIndex={0}
                  onClick={isSelectMode ? () => toggleSelectKey(entry.dateKey) : () => doOpenEditor(entry.dateKey)}
                  onKeyDown={e => {
                    if (isSelectMode) { if (e.key === 'Enter' || e.key === ' ') toggleSelectKey(entry.dateKey) }
                    else if (e.key === 'Enter') doOpenEditor(entry.dateKey)
                  }}
                  title={isSelectMode ? entry.title : `${entry.title} — ${MONTH_NAMES[entry.month]} ${entry.day}, ${entry.year}`}
                  style={{
                    width: 110, flexShrink: 0, position: 'relative',
                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                    padding: '10px 8px 8px', borderRadius: 10, textAlign: 'center',
                    cursor: 'pointer', userSelect: 'none',
                    background: isSelectMode
                      ? (isChecked ? (isDark ? 'rgba(124,58,237,0.28)' : 'rgba(124,58,237,0.14)') : 'transparent')
                      : (isSel ? (isDark ? 'rgba(124,58,237,0.28)' : 'rgba(124,58,237,0.14)') : 'transparent'),
                    border: isSelectMode
                      ? `1.5px solid ${isChecked ? 'rgba(124,58,237,0.55)' : 'rgba(124,58,237,0.18)'}`
                      : (isSel ? '1.5px solid rgba(124,58,237,0.55)' : '1.5px solid transparent'),
                    transition: 'background 130ms, border-color 130ms',
                    gap: 5,
                  }}
                >
                  {/* Selection checkbox */}
                  {isSelectMode && (
                    <div style={{
                      position: 'absolute', top: 5, right: 5,
                      width: 17, height: 17, borderRadius: 4,
                      border: `1.5px solid ${isChecked ? '#7c3aed' : isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.28)'}`,
                      background: isChecked ? 'rgba(124,58,237,0.88)' : isDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.80)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      pointerEvents: 'none',
                    }}>
                      {isChecked && <svg width="9" height="9" viewBox="0 0 12 12" fill="none"><polyline points="2,6 5,9 10,3" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                    </div>
                  )}
                  {!isSelectMode && (
                    <LibraryCardMenu
                      isDark={isDark} bdr={bdr}
                      isOpen={cardMenuOpen === entry.dateKey} view={cardMenuView}
                      onOpenChange={open => setCardMenuOpen(open ? entry.dateKey : null)}
                      onViewChange={setCardMenuView}
                      onRename={() => { handleLibRenameStart(entry.dateKey, entry.title); setCardMenuOpen(null) }}
                      onExport={() => { setExportFormatKeys([entry.dateKey]); setCardMenuOpen(null) }}
                      onDeleteRequest={() => { setDeleteConfirmKeys([entry.dateKey]); setCardMenuOpen(null) }}
                      categories={allCategories} activeLabelIds={entry.labelIds}
                      onToggleLabel={id => toggleDocLabel(entry.dateKey, id)}
                      onDeleteLabel={handleDeleteLabel}
                      onCreateLabel={() => { setShowCreateLabel(true); setCardMenuOpen(null) }}
                      folders={journalFolders} activeFolderId={entry.folderId}
                      onSetFolder={id => { setDocFolder(entry.dateKey, id); setCardMenuOpen(null) }}
                      onDeleteFolder={handleDeleteFolder}
                      onCreateFolder={() => { setShowCreateFolder(true); setCardMenuOpen(null) }}
                      wrapperStyle={{ position: 'absolute', top: 5, right: 5 }}
                    />
                  )}
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
                  {isRen && !isSelectMode ? renInput(11) : (
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
                  {entry.labelIds.length > 0 && (
                    <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', justifyContent: 'center' }}>
                      {entry.labelIds.slice(0, 6).map(id => {
                        const cat = allCategories.find(c => c.id === id)
                        return cat ? <span key={id} style={{ width: 5, height: 5, borderRadius: '50%', background: cat.color, flexShrink: 0 }} /> : null
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ) : libViewMode === 'detail' ? (
          /* ── Detail mode: one row per entry ───────────────────────────── */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filteredLibraryEntries.map(entry => {
              const isSel = selectedLibEntry === entry.dateKey
              const isRen = renamingEntry === entry.dateKey
              const isChecked = selectedKeys.has(entry.dateKey)
              return (
                <div
                  key={entry.dateKey}
                  role="button"
                  tabIndex={0}
                  onClick={isSelectMode ? () => toggleSelectKey(entry.dateKey) : () => doOpenEditor(entry.dateKey)}
                  onKeyDown={e => {
                    if (isSelectMode) { if (e.key === 'Enter' || e.key === ' ') toggleSelectKey(entry.dateKey) }
                    else if (e.key === 'Enter') doOpenEditor(entry.dateKey)
                  }}
                  title={entry.title}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '12px 16px', borderRadius: 10, textAlign: 'left',
                    cursor: 'pointer', userSelect: 'none',
                    background: isSelectMode
                      ? (isChecked ? (isDark ? 'rgba(124,58,237,0.20)' : 'rgba(124,58,237,0.10)') : (isDark ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.70)'))
                      : (isSel ? (isDark ? 'rgba(124,58,237,0.20)' : 'rgba(124,58,237,0.10)') : (isDark ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.70)')),
                    border: isSelectMode
                      ? `1.5px solid ${isChecked ? 'rgba(124,58,237,0.50)' : isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)'}`
                      : (isSel ? '1.5px solid rgba(124,58,237,0.50)' : `0.5px solid ${isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)'}`),
                    transition: 'background 140ms, border-color 140ms',
                    minWidth: 0, position: 'relative',
                  }}
                >
                  {/* Selection checkbox */}
                  {isSelectMode && (
                    <div style={{
                      width: 17, height: 17, borderRadius: 4, flexShrink: 0, marginRight: 10,
                      border: `1.5px solid ${isChecked ? '#7c3aed' : isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.28)'}`,
                      background: isChecked ? 'rgba(124,58,237,0.88)' : isDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.80)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      pointerEvents: 'none',
                    }}>
                      {isChecked && <svg width="9" height="9" viewBox="0 0 12 12" fill="none"><polyline points="2,6 5,9 10,3" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                    </div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: 1 }}>
                    <span style={{ fontSize: 18, flexShrink: 0 }}>📝</span>
                    {isRen && !isSelectMode ? (
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
                        color: (isSelectMode ? isChecked : isSel) ? '#a78bfa' : isDark ? 'rgba(255,255,255,0.88)' : 'rgba(0,0,0,0.80)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        minWidth: 0,
                      }}>{entry.title}</span>
                    )}
                  </div>
                  {entry.labelIds.length > 0 && (
                    <div style={{ display: 'flex', gap: 3, flexShrink: 0, marginLeft: 10 }}>
                      {entry.labelIds.slice(0, 6).map(id => {
                        const cat = allCategories.find(c => c.id === id)
                        return cat ? <span key={id} style={{ width: 5, height: 5, borderRadius: '50%', background: cat.color, flexShrink: 0 }} /> : null
                      })}
                    </div>
                  )}
                  <span style={{
                    fontSize: 11, flexShrink: 0, marginLeft: 12,
                    color: isSel ? 'rgba(167,139,250,0.80)' : muted,
                    whiteSpace: 'nowrap',
                  }}>{MONTH_NAMES[entry.month]} {entry.day}, {entry.year}</span>
                  {!isSelectMode && (
                    <LibraryCardMenu
                      isDark={isDark} bdr={bdr}
                      isOpen={cardMenuOpen === entry.dateKey} view={cardMenuView}
                      onOpenChange={open => setCardMenuOpen(open ? entry.dateKey : null)}
                      onViewChange={setCardMenuView}
                      onRename={() => { handleLibRenameStart(entry.dateKey, entry.title); setCardMenuOpen(null) }}
                      onExport={() => { setExportFormatKeys([entry.dateKey]); setCardMenuOpen(null) }}
                      onDeleteRequest={() => { setDeleteConfirmKeys([entry.dateKey]); setCardMenuOpen(null) }}
                      categories={allCategories} activeLabelIds={entry.labelIds}
                      onToggleLabel={id => toggleDocLabel(entry.dateKey, id)}
                      onDeleteLabel={handleDeleteLabel}
                      onCreateLabel={() => { setShowCreateLabel(true); setCardMenuOpen(null) }}
                      folders={journalFolders} activeFolderId={entry.folderId}
                      onSetFolder={id => { setDocFolder(entry.dateKey, id); setCardMenuOpen(null) }}
                      onDeleteFolder={handleDeleteFolder}
                      onCreateFolder={() => { setShowCreateFolder(true); setCardMenuOpen(null) }}
                      wrapperStyle={{ position: 'relative', flexShrink: 0, marginLeft: 8 }}
                    />
                  )}
                </div>
              )
            })}
          </div>
        ) : libViewMode === 'tile' ? (
          /* ── Tile mode: 2-column grid ──────────────────────────────────── */
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
            {filteredLibraryEntries.map(entry => {
              const isSel = selectedLibEntry === entry.dateKey
              const isRen = renamingEntry === entry.dateKey
              const isChecked = selectedKeys.has(entry.dateKey)
              return (
                <div
                  key={entry.dateKey}
                  role="button"
                  tabIndex={0}
                  onClick={isSelectMode ? () => toggleSelectKey(entry.dateKey) : () => doOpenEditor(entry.dateKey)}
                  onKeyDown={e => {
                    if (isSelectMode) { if (e.key === 'Enter' || e.key === ' ') toggleSelectKey(entry.dateKey) }
                    else if (e.key === 'Enter') doOpenEditor(entry.dateKey)
                  }}
                  title={entry.title}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                    padding: '14px 16px', borderRadius: 12, textAlign: 'left', position: 'relative',
                    cursor: 'pointer', userSelect: 'none',
                    background: isSelectMode
                      ? (isChecked ? (isDark ? 'rgba(124,58,237,0.20)' : 'rgba(124,58,237,0.10)') : (isDark ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.80)'))
                      : (isSel ? (isDark ? 'rgba(124,58,237,0.20)' : 'rgba(124,58,237,0.10)') : (isDark ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.80)')),
                    border: isSelectMode
                      ? `1.5px solid ${isChecked ? 'rgba(124,58,237,0.50)' : isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)'}`
                      : (isSel ? '1.5px solid rgba(124,58,237,0.50)' : `0.5px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)'}`),
                    transition: 'background 140ms, border-color 140ms',
                    gap: 8, minWidth: 0,
                  }}
                >
                  {/* Selection checkbox */}
                  {isSelectMode && (
                    <div style={{
                      position: 'absolute', top: 8, right: 8,
                      width: 17, height: 17, borderRadius: 4,
                      border: `1.5px solid ${isChecked ? '#7c3aed' : isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.28)'}`,
                      background: isChecked ? 'rgba(124,58,237,0.88)' : isDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.80)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      pointerEvents: 'none',
                    }}>
                      {isChecked && <svg width="9" height="9" viewBox="0 0 12 12" fill="none"><polyline points="2,6 5,9 10,3" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                    </div>
                  )}
                  {!isSelectMode && (
                    <LibraryCardMenu
                      isDark={isDark} bdr={bdr}
                      isOpen={cardMenuOpen === entry.dateKey} view={cardMenuView}
                      onOpenChange={open => setCardMenuOpen(open ? entry.dateKey : null)}
                      onViewChange={setCardMenuView}
                      onRename={() => { handleLibRenameStart(entry.dateKey, entry.title); setCardMenuOpen(null) }}
                      onExport={() => { setExportFormatKeys([entry.dateKey]); setCardMenuOpen(null) }}
                      onDeleteRequest={() => { setDeleteConfirmKeys([entry.dateKey]); setCardMenuOpen(null) }}
                      categories={allCategories} activeLabelIds={entry.labelIds}
                      onToggleLabel={id => toggleDocLabel(entry.dateKey, id)}
                      onDeleteLabel={handleDeleteLabel}
                      onCreateLabel={() => { setShowCreateLabel(true); setCardMenuOpen(null) }}
                      folders={journalFolders} activeFolderId={entry.folderId}
                      onSetFolder={id => { setDocFolder(entry.dateKey, id); setCardMenuOpen(null) }}
                      onDeleteFolder={handleDeleteFolder}
                      onCreateFolder={() => { setShowCreateFolder(true); setCardMenuOpen(null) }}
                      wrapperStyle={{ position: 'absolute', top: 8, right: 8 }}
                    />
                  )}
                  <span style={{ fontSize: 22 }}>📝</span>
                  {isRen && !isSelectMode ? (
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
                      color: (isSelectMode ? isChecked : isSel) ? '#a78bfa' : isDark ? 'rgba(255,255,255,0.90)' : 'rgba(0,0,0,0.82)',
                      overflow: 'hidden', textOverflow: 'ellipsis',
                      display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                      width: '100%',
                    }}>{entry.title}</span>
                  )}
                  <span style={{ fontSize: 10, marginTop: 2, color: isSel ? 'rgba(167,139,250,0.80)' : muted }}>
                    {MONTH_NAMES[entry.month]} {entry.day}, {entry.year}
                  </span>
                  {entry.labelIds.length > 0 && (
                    <div style={{ display: 'flex', gap: 3 }}>
                      {entry.labelIds.slice(0, 6).map(id => {
                        const cat = allCategories.find(c => c.id === id)
                        return cat ? <span key={id} style={{ width: 5, height: 5, borderRadius: '50%', background: cat.color, flexShrink: 0 }} /> : null
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          /* ── Thumbnail mode: 3-column grid, larger cards ───────────────── */
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            {filteredLibraryEntries.map(entry => {
              const isSel = selectedLibEntry === entry.dateKey
              const isRen = renamingEntry === entry.dateKey
              const isChecked = selectedKeys.has(entry.dateKey)
              return (
                <div
                  key={entry.dateKey}
                  role="button"
                  tabIndex={0}
                  onClick={isSelectMode ? () => toggleSelectKey(entry.dateKey) : () => doOpenEditor(entry.dateKey)}
                  onKeyDown={e => {
                    if (isSelectMode) { if (e.key === 'Enter' || e.key === ' ') toggleSelectKey(entry.dateKey) }
                    else if (e.key === 'Enter') doOpenEditor(entry.dateKey)
                  }}
                  title={entry.title}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                    padding: '20px 14px 16px', borderRadius: 14, textAlign: 'center', position: 'relative',
                    cursor: 'pointer', userSelect: 'none',
                    background: isSelectMode
                      ? (isChecked ? (isDark ? 'rgba(124,58,237,0.22)' : 'rgba(124,58,237,0.12)') : (isDark ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.85)'))
                      : (isSel ? (isDark ? 'rgba(124,58,237,0.22)' : 'rgba(124,58,237,0.12)') : (isDark ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.85)')),
                    border: isSelectMode
                      ? `1.5px solid ${isChecked ? 'rgba(124,58,237,0.55)' : isDark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.07)'}`
                      : (isSel ? '1.5px solid rgba(124,58,237,0.55)' : `0.5px solid ${isDark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.07)'}`),
                    transition: 'background 140ms, border-color 140ms',
                    gap: 10, minWidth: 0,
                  }}
                >
                  {/* Selection checkbox */}
                  {isSelectMode && (
                    <div style={{
                      position: 'absolute', top: 8, right: 8,
                      width: 17, height: 17, borderRadius: 4,
                      border: `1.5px solid ${isChecked ? '#7c3aed' : isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.28)'}`,
                      background: isChecked ? 'rgba(124,58,237,0.88)' : isDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.80)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      pointerEvents: 'none',
                    }}>
                      {isChecked && <svg width="9" height="9" viewBox="0 0 12 12" fill="none"><polyline points="2,6 5,9 10,3" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                    </div>
                  )}
                  {!isSelectMode && (
                    <LibraryCardMenu
                      isDark={isDark} bdr={bdr}
                      isOpen={cardMenuOpen === entry.dateKey} view={cardMenuView}
                      onOpenChange={open => setCardMenuOpen(open ? entry.dateKey : null)}
                      onViewChange={setCardMenuView}
                      onRename={() => { handleLibRenameStart(entry.dateKey, entry.title); setCardMenuOpen(null) }}
                      onExport={() => { setExportFormatKeys([entry.dateKey]); setCardMenuOpen(null) }}
                      onDeleteRequest={() => { setDeleteConfirmKeys([entry.dateKey]); setCardMenuOpen(null) }}
                      categories={allCategories} activeLabelIds={entry.labelIds}
                      onToggleLabel={id => toggleDocLabel(entry.dateKey, id)}
                      onDeleteLabel={handleDeleteLabel}
                      onCreateLabel={() => { setShowCreateLabel(true); setCardMenuOpen(null) }}
                      folders={journalFolders} activeFolderId={entry.folderId}
                      onSetFolder={id => { setDocFolder(entry.dateKey, id); setCardMenuOpen(null) }}
                      onDeleteFolder={handleDeleteFolder}
                      onCreateFolder={() => { setShowCreateFolder(true); setCardMenuOpen(null) }}
                      wrapperStyle={{ position: 'absolute', top: 8, right: 8 }}
                    />
                  )}
                  <div style={{
                    width: '100%', height: 70, borderRadius: 8,
                    background: isSel ? 'rgba(124,58,237,0.15)' : isDark ? 'rgba(124,58,237,0.08)' : 'rgba(124,58,237,0.06)',
                    border: `0.5px solid rgba(124,58,237,0.15)`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 28, marginBottom: 2,
                  }}>📝</div>
                  {isRen && !isSelectMode ? (
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
                      color: (isSelectMode ? isChecked : isSel) ? '#a78bfa' : isDark ? 'rgba(255,255,255,0.90)' : 'rgba(0,0,0,0.82)',
                      overflow: 'hidden', textOverflow: 'ellipsis',
                      display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                      width: '100%',
                    }}>{entry.title}</span>
                  )}
                  <span style={{ fontSize: 10, color: isSel ? 'rgba(167,139,250,0.80)' : muted }}>
                    {MONTH_SHORT[entry.month]} {entry.day}, {entry.year}
                  </span>
                  {entry.labelIds.length > 0 && (
                    <div style={{ display: 'flex', gap: 3 }}>
                      {entry.labelIds.slice(0, 6).map(id => {
                        const cat = allCategories.find(c => c.id === id)
                        return cat ? <span key={id} style={{ width: 5, height: 5, borderRadius: '50%', background: cat.color, flexShrink: 0 }} /> : null
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Delete confirmation dialog ───────────────────────────────────── */}
      {deleteConfirmKeys && deleteConfirmKeys.length > 0 && (
        <div
          style={{
            position: 'absolute', inset: 0, zIndex: 80,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: 'inherit',
          }}
          onClick={() => setDeleteConfirmKeys(null)}
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
              {deleteConfirmKeys.length === 1 ? 'Delete this document?' : `Delete ${deleteConfirmKeys.length} documents?`}
            </div>
            {deleteConfirmKeys.length === 1 && (() => {
              const entry = libraryEntries.find(e => e.dateKey === deleteConfirmKeys[0])
              return entry ? (
                <div style={{ fontSize: 13, color: muted, lineHeight: 1.4 }}>
                  <strong style={{ color: isDark ? 'rgba(255,255,255,0.80)' : 'rgba(0,0,0,0.75)' }}>{entry.title}</strong>
                  <br />
                  {MONTH_NAMES[entry.month]} {entry.day}, {entry.year}
                </div>
              ) : null
            })()}
            <div style={{ fontSize: 12, color: muted }}>
              This action cannot be undone.
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setDeleteConfirmKeys(null)}
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
                onClick={() => commitDeleteMany(deleteConfirmKeys)}
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
      )}

      {/* ── Export format picker ────────────────────────────────────────── */}
      {exportFormatKeys && exportFormatKeys.length > 0 && !isExporting && (
        <div
          style={{
            position: 'absolute', inset: 0, zIndex: 80,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: 'inherit',
          }}
          onClick={() => setExportFormatKeys(null)}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: isDark ? '#1e1b2e' : '#ffffff',
              border: `1px solid ${isDark ? 'rgba(124,58,237,0.35)' : 'rgba(124,58,237,0.25)'}`,
              borderRadius: 14, padding: '24px 28px', maxWidth: 300, width: '88%',
              boxShadow: '0 8px 40px rgba(0,0,0,0.45)',
              display: 'flex', flexDirection: 'column', gap: 16,
            }}
          >
            <div style={{ fontSize: 15, fontWeight: 600, color: isDark ? 'rgba(255,255,255,0.90)' : 'rgba(0,0,0,0.85)' }}>
              Export {exportFormatKeys.length} document{exportFormatKeys.length !== 1 ? 's' : ''} as…
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {([
                { format: 'pdf'  as const, label: 'PDF',           ext: '.pdf',  icon: '📄' },
                { format: 'docx' as const, label: 'Word Document',  ext: '.docx', icon: '📝' },
                { format: 'txt'  as const, label: 'Plain Text',     ext: '.txt',  icon: '📃' },
              ]).map(({ format, label, ext, icon }) => (
                <button
                  key={format}
                  onClick={() => handleExport(format)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 14px', borderRadius: 9, fontSize: 13, fontWeight: 500,
                    cursor: 'pointer', textAlign: 'left',
                    background: isDark ? 'rgba(124,58,237,0.12)' : 'rgba(124,58,237,0.06)',
                    border: `0.5px solid ${isDark ? 'rgba(124,58,237,0.28)' : 'rgba(124,58,237,0.20)'}`,
                    color: isDark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.78)',
                  }}
                >
                  <span>{icon} {label}</span>
                  <span style={{ fontSize: 11, color: isDark ? '#a78bfa' : '#7c3aed', fontWeight: 600 }}>{ext}</span>
                </button>
              ))}
            </div>
            <button
              onClick={() => setExportFormatKeys(null)}
              style={{
                padding: '7px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500,
                cursor: 'pointer', alignSelf: 'flex-end',
                background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
                border: `0.5px solid ${isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.12)'}`,
                color: isDark ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.65)',
              }}
            >Cancel</button>
          </div>
        </div>
      )}

      {/* ── Create Custom Label modal ───────────────────────────────────── */}
      {showCreateLabel && (
        <div
          style={{
            position: 'absolute', inset: 0, zIndex: 85,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: 'inherit',
          }}
          onClick={() => { setShowCreateLabel(false); setNewLabelName(''); setNewLabelColor('purple') }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: isDark ? '#1e1b2e' : '#ffffff',
              border: `1px solid ${isDark ? 'rgba(124,58,237,0.35)' : 'rgba(124,58,237,0.25)'}`,
              borderRadius: 14, padding: '22px 24px', maxWidth: 280, width: '88%',
              boxShadow: '0 8px 40px rgba(0,0,0,0.45)',
              display: 'flex', flexDirection: 'column', gap: 14,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.03em', textTransform: 'uppercase', color: isDark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.78)' }}>
              Create Label
            </div>
            <input
              autoFocus
              value={newLabelName}
              onChange={e => setNewLabelName(e.target.value)}
              placeholder="Label name"
              maxLength={30}
              onKeyDown={e => { if (e.key === 'Enter') commitCreateLabel(); if (e.key === 'Escape') setShowCreateLabel(false) }}
              style={{
                fontSize: 13, padding: '8px 10px', borderRadius: 8, outline: 'none',
                border: `1px solid ${isDark ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.14)'}`,
                background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.03)',
                color: isDark ? '#fff' : '#0f172a',
              }}
            />
            <div>
              <div style={{ fontSize: 11, fontWeight: 500, marginBottom: 7, color: muted }}>Choose color</div>
              <div style={{ display: 'flex', gap: 9 }}>
                {LABEL_COLOR_OPTIONS.map(c => (
                  <button
                    key={c}
                    onClick={() => setNewLabelColor(c)}
                    title={c}
                    style={{
                      width: 22, height: 22, borderRadius: '50%', border: 'none', cursor: 'pointer', padding: 0,
                      background: LABEL_COLOR_HEX[c],
                      outline: newLabelColor === c ? `2px solid ${isDark ? '#fff' : '#0f172a'}` : '1.5px solid rgba(0,0,0,0.12)',
                      outlineOffset: newLabelColor === c ? 1 : 0,
                    }}
                  />
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => { setShowCreateLabel(false); setNewLabelName(''); setNewLabelColor('purple') }}
                style={{
                  padding: '7px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer',
                  background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
                  border: `0.5px solid ${isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.12)'}`,
                  color: isDark ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.65)',
                }}
              >Cancel</button>
              <button
                onClick={commitCreateLabel}
                disabled={!newLabelName.trim()}
                style={{
                  padding: '7px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                  cursor: newLabelName.trim() ? 'pointer' : 'default',
                  background: newLabelName.trim() ? 'rgba(124,58,237,0.88)' : 'rgba(124,58,237,0.30)',
                  border: '0.5px solid rgba(124,58,237,0.60)',
                  color: '#fff',
                }}
              >Create</button>
            </div>
          </div>
        </div>
      )}

      {/* ── New Folder modal ─────────────────────────────────────────────── */}
      {showCreateFolder && (
        <div
          style={{
            position: 'absolute', inset: 0, zIndex: 85,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: 'inherit',
          }}
          onClick={() => { setShowCreateFolder(false); setNewFolderName('') }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: isDark ? '#1e1b2e' : '#ffffff',
              border: `1px solid ${isDark ? 'rgba(124,58,237,0.35)' : 'rgba(124,58,237,0.25)'}`,
              borderRadius: 14, padding: '22px 24px', maxWidth: 280, width: '88%',
              boxShadow: '0 8px 40px rgba(0,0,0,0.45)',
              display: 'flex', flexDirection: 'column', gap: 14,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.03em', textTransform: 'uppercase', color: isDark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.78)' }}>
              New Folder
            </div>
            <input
              autoFocus
              value={newFolderName}
              onChange={e => setNewFolderName(e.target.value)}
              placeholder="Folder name"
              maxLength={40}
              onKeyDown={e => { if (e.key === 'Enter') commitCreateFolder(); if (e.key === 'Escape') setShowCreateFolder(false) }}
              style={{
                fontSize: 13, padding: '8px 10px', borderRadius: 8, outline: 'none',
                border: `1px solid ${isDark ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.14)'}`,
                background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.03)',
                color: isDark ? '#fff' : '#0f172a',
              }}
            />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => { setShowCreateFolder(false); setNewFolderName('') }}
                style={{
                  padding: '7px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer',
                  background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
                  border: `0.5px solid ${isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.12)'}`,
                  color: isDark ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.65)',
                }}
              >Cancel</button>
              <button
                onClick={commitCreateFolder}
                disabled={!newFolderName.trim()}
                style={{
                  padding: '7px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                  cursor: newFolderName.trim() ? 'pointer' : 'default',
                  background: newFolderName.trim() ? 'rgba(124,58,237,0.88)' : 'rgba(124,58,237,0.30)',
                  border: '0.5px solid rgba(124,58,237,0.60)',
                  color: '#fff',
                }}
              >+ Create Folder</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Exporting overlay ────────────────────────────────────────────── */}
      {isExporting && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 80,
          background: 'rgba(0,0,0,0.55)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: 'inherit',
        }}>
          <div style={{
            background: isDark ? '#1e1b2e' : '#ffffff',
            border: `1px solid ${isDark ? 'rgba(124,58,237,0.35)' : 'rgba(124,58,237,0.25)'}`,
            borderRadius: 14, padding: '28px 36px',
            boxShadow: '0 8px 40px rgba(0,0,0,0.45)',
            fontSize: 14, fontWeight: 500,
            color: isDark ? 'rgba(255,255,255,0.80)' : 'rgba(0,0,0,0.70)',
          }}>
            Preparing export…
          </div>
        </div>
      )}

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
              className={`xp-jws-nav-btn${active ? ' xp-jws-nav-active' : ''}`}
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
        {/* Mic slot — mobile only, disabled when not in Editor view */}
        <button
          className="xp-jws-mic-nav xp-jws-nav-btn"
          disabled
          style={{
            alignItems: 'center', gap: 6,
            padding: '6px 14px', borderRadius: 8,
            fontSize: 12, fontWeight: 400,
            cursor: 'not-allowed',
            background: 'rgba(124,58,237,0.06)',
            border: '0.5px solid rgba(124,58,237,0.16)',
            color: 'rgba(255,255,255,0.55)',
            opacity: 0.35,
          }}
          title="Microphone (available in Editor)"
        >🎙 Mic</button>
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
      flushRef={editorFlushRef}
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
        .xp-jws-mic-nav { display: none !important; }
        @media (max-width: 640px) { .xp-jws-mic-nav { display: flex !important; } }
        .xp-jcal-mobile-grid { display: none !important; }
        @media (max-width: 640px) {
          .xp-jcal-quarters { display: none !important; }
          .xp-jcal-mobile-grid { display: block !important; }
        }
        @media (max-width: 640px) {
          .xp-jws-nav-btn {
            padding: 5px 11px !important;
            border-radius: 7px !important;
            background: rgba(255,255,255,0.04) !important;
            border: 0.5px solid rgba(255,255,255,0.09) !important;
            color: rgba(255,255,255,0.60) !important;
            font-size: 12px !important;
            font-weight: 400 !important;
          }
          .xp-jws-nav-active {
            background: rgba(124,58,237,0.28) !important;
            border-color: rgba(124,58,237,0.65) !important;
            color: #c4b5fd !important;
            font-weight: 600 !important;
          }
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

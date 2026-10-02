'use client'

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useEditor, EditorContent } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import { Mark, mergeAttributes } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import ListItem from '@tiptap/extension-list-item'
import Placeholder from '@tiptap/extension-placeholder'
import Underline from '@tiptap/extension-underline'
import { TextStyle } from '@tiptap/extension-text-style'
import { Color } from '@tiptap/extension-color'
import { Table as TiptapTable, TableRow, TableHeader, TableCell } from '@tiptap/extension-table'
import { Theme } from 'emoji-picker-react'
import type { EmojiClickData } from 'emoji-picker-react'
import { addGalleryItem } from './GalleryModal'
import dynamic from 'next/dynamic'
import { buildAttachment, buildAttachments, ATTACHMENT_ACCEPT, CameraModal, ImageLightbox } from './attachmentUtils'
import type { JournalBlock, JournalTimerSession, TaskAttachment, Task, TaskSession, SectionCell } from './types'
import { useApp } from './AppContext'
import { JournalDrawModal } from './JournalDrawModal'
import type { JournalDrawModalHandle } from './JournalDrawModal'
import {
  parseJournalDoc, parseJournalContent, serializeJournalContent, serializeJournalDoc,
  getSectionStyle, SECTION_COLORS, createTextBlock, createSectionBlock,
  createDrawingBlock, createImageBlock, mkId, getTableColor,
  mkContentCell, mkImageCell, isSectionEmpty, mergeTiptapContents,
} from './journalUtils'
import { TransferSectionModal } from './TransferSectionModal'
import { SendToOptionsModal } from './SendToOptionsModal'
import {
  ensureTaskItemIds, extractPlannerTaskTree, makeTaskId,
} from './plannerTaskBridge'
import type { PlannerTaskNode } from './plannerTaskBridge'
import type { SectionColorKey } from './journalUtils'

// Re-export for backward compat — JournalEditorEmbed imports these
export { parseJournalContent, serializeJournalContent }

const EmojiPicker = dynamic(() => import('emoji-picker-react'), { ssr: false })

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtEditorDate(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })
}

function fmtShortDate(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtTransferDate(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
}

function fmtBlockTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

function fmtTimerElapsed(ms: number): string {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
  return `${m}:${String(sec).padStart(2,'0')}`
}

function fmtTimerDuration(ms: number): string {
  const m = Math.round(ms / 60000)
  return m < 1 ? '<1m' : `${m}m`
}

function calcTotalMs(sessions: JournalTimerSession[], runningMs = 0): number {
  return sessions.reduce((acc, s) => acc + (s.endTs - s.startTs), 0) + runningMs
}

// ─── Grid masonry layout ──────────────────────────────────────────────────────
// Uses CSS Grid with per-block ResizeObserver span tracking.
// Each block independently measures its own content height and sets grid-row: span N,
// so shorter blocks stack beside taller ones without dead space.

const GRID_COLS = 12
const ROW_PX    = 4  // grid-auto-rows base unit in px
const GRID_GAP  = 8  // gap between blocks in px

function widthToColSpan(pct: number): number {
  return Math.max(1, Math.min(GRID_COLS, Math.round((pct / 100) * GRID_COLS)))
}

function GridBlockItem({
  blockId, colSpan, className, style, onClick, onMouseDown, children,
}: {
  blockId: string
  colSpan: number
  className?: string
  style?: React.CSSProperties
  onClick?: React.MouseEventHandler<HTMLDivElement>
  onMouseDown?: React.MouseEventHandler<HTMLDivElement>
  children: React.ReactNode
}) {
  const [rowSpan, setRowSpan] = useState(1)
  const measureRef = useRef<HTMLDivElement>(null)

  // Sync initial measurement before first paint to avoid layout jump
  useLayoutEffect(() => {
    const el = measureRef.current
    if (!el) return
    const h = el.offsetHeight
    if (h > 0) setRowSpan(Math.max(1, Math.ceil((h + GRID_GAP) / (ROW_PX + GRID_GAP))))
  }, [])

  // Keep span updated as content resizes (text editing, image load, etc.)
  useEffect(() => {
    const el = measureRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const h = entry.borderBoxSize?.[0]?.blockSize ?? el.offsetHeight
      if (h > 0) setRowSpan(Math.max(1, Math.ceil((h + GRID_GAP) / (ROW_PX + GRID_GAP))))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div
      data-block-id={blockId}
      className={className}
      style={{ gridColumn: `span ${colSpan}`, gridRow: `span ${rowSpan}`, position: 'relative', minWidth: 0, ...style }}
      onClick={onClick}
      onMouseDown={onMouseDown}
    >
      <div ref={measureRef} style={{ position: 'relative' }}>
        {children}
      </div>
    </div>
  )
}

// ─── AddTableModal ────────────────────────────────────────────────────────────

interface AddTableConfig {
  rows: number
  cols: number
  headerOn: boolean
  headerColor: SectionColorKey
  firstColOn: boolean
  firstColColor: SectionColorKey
  fillColor: SectionColorKey
  corners: 'square' | 'rounded'
}

function TableSwitch({ isDark, value, onChange, label }: { isDark: boolean; value: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={value}
      aria-label={label}
      onClick={() => onChange(!value)}
      style={{
        width: 36, height: 20, borderRadius: 999, border: 'none', cursor: 'pointer', flexShrink: 0,
        background: value ? '#7c3aed' : (isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.16)'),
        position: 'relative', transition: 'background 150ms',
      }}
    >
      <span style={{
        position: 'absolute', top: 2, left: value ? 18 : 2,
        width: 16, height: 16, borderRadius: '50%', background: '#fff',
        boxShadow: '0 1px 3px rgba(0,0,0,0.35)', transition: 'left 150ms',
      }} />
    </button>
  )
}

function TableStepper({ isDark, label, value, onChange, min, max }: {
  isDark: boolean; label: string; value: number; onChange: (n: number) => void; min: number; max: number
}) {
  const btnStyle: React.CSSProperties = {
    width: 24, height: 24, borderRadius: 7, border: 'none', cursor: 'pointer',
    background: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.07)',
    color: isDark ? '#fff' : '#0f172a', fontSize: 15, lineHeight: 1,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: isDark ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.65)' }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} style={{ ...btnStyle, opacity: value <= min ? 0.4 : 1 }}>−</button>
        <span style={{ fontSize: 13, fontWeight: 700, minWidth: 18, textAlign: 'center', color: isDark ? '#fff' : '#0f172a' }}>{value}</span>
        <button onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} style={{ ...btnStyle, opacity: value >= max ? 0.4 : 1 }}>+</button>
      </div>
    </div>
  )
}

function TableColorRow({ isDark, label, value, onChange }: {
  isDark: boolean; label: string; value: SectionColorKey; onChange: (c: SectionColorKey) => void
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: isDark ? 'rgba(255,255,255,0.42)' : 'rgba(0,0,0,0.40)', marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
        {SECTION_COLORS.map(c => {
          const hex = getTableColor(c.key)
          const selected = value === c.key
          return (
            <button
              key={c.key}
              onClick={() => onChange(c.key)}
              title={c.label}
              aria-label={c.label}
              style={{
                width: 22, height: 22, borderRadius: '50%', flexShrink: 0, padding: 0, cursor: 'pointer',
                background: hex.bg,
                border: selected ? '2px solid #7c3aed' : `1px solid ${isDark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.15)'}`,
                boxShadow: selected ? '0 0 0 2px rgba(124,58,237,0.30)' : 'none',
              }}
            />
          )
        })}
      </div>
    </div>
  )
}

function TableCornerToggle({ isDark, value, onChange }: {
  isDark: boolean; value: 'square' | 'rounded'; onChange: (v: 'square' | 'rounded') => void
}) {
  const opts: Array<{ key: 'square' | 'rounded'; label: string }> = [
    { key: 'square', label: '◻ Square' },
    { key: 'rounded', label: '▢ Rounded' },
  ]
  return (
    <div style={{
      display: 'flex', gap: 3, padding: 3, borderRadius: 10,
      background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
    }}>
      {opts.map(o => {
        const selected = value === o.key
        return (
          <button
            key={o.key}
            onClick={() => onChange(o.key)}
            style={{
              flex: 1, padding: '6px 0', borderRadius: 7, border: 'none', cursor: 'pointer',
              fontSize: 11.5, fontWeight: selected ? 700 : 500,
              background: selected ? '#7c3aed' : 'transparent',
              color: selected ? '#fff' : (isDark ? 'rgba(255,255,255,0.60)' : 'rgba(0,0,0,0.55)'),
              transition: 'background 120ms, color 120ms',
            }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

function AddTableModal({ isDark, onClose, onConfirm }: {
  isDark: boolean
  onClose: () => void
  onConfirm: (config: AddTableConfig) => void
}) {
  const [cols, setCols]                 = useState(3)
  const [rows, setRows]                 = useState(3)
  const [headerOn, setHeaderOn]         = useState(true)
  const [headerColor, setHeaderColor]   = useState<SectionColorKey>('lavender')
  const [firstColOn, setFirstColOn]     = useState(false)
  const [firstColColor, setFirstColColor] = useState<SectionColorKey>('lavender')
  const [fillColor, setFillColor]       = useState<SectionColorKey>('plain')
  const [corners, setCorners]           = useState<'square' | 'rounded'>('rounded')

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const dividerStyle: React.CSSProperties = { height: 1, background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)', margin: '10px 0 12px' }
  const rowLabelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: isDark ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.65)' }

  return (
    <div
      className="fixed inset-0 z-[220] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={onClose}
    >
      {/* Same vh→dvh progressive enhancement as SendToOptionsModal's .xp-sendto-card —
          plain vh measures the tallest possible mobile viewport (address bar hidden),
          which overshoots the actually-visible area when the address bar is showing,
          letting the card run off the bottom of the screen. */}
      <style>{`
        .xp-addtbl-card { max-height: 88vh; }
        @supports (height: 88dvh) { .xp-addtbl-card { max-height: 88dvh; } }
      `}</style>
      <div
        className="xp-addtbl-card w-full max-w-[340px] rounded-2xl overflow-hidden flex flex-col"
        style={{ background: isDark ? '#160a30' : '#fff', border: `0.5px solid ${isDark ? 'rgba(124,58,237,0.30)' : 'rgba(0,0,0,0.10)'}`, boxShadow: '0 24px 64px rgba(0,0,0,0.32)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3.5 flex-shrink-0" style={{ background: 'linear-gradient(135deg, #5b21b6 0%, #7c3aed 100%)' }}>
          <h3 className="text-[14px] font-semibold" style={{ color: '#fff' }}>Add Table</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(255,255,255,0.16)', color: '#fff', border: 'none', cursor: 'pointer' }}
          >✕</button>
        </div>

        <div className="px-4 py-3.5 overflow-y-auto" style={{ minHeight: 0 }}>
          <TableStepper isDark={isDark} label="Columns" value={cols} onChange={setCols} min={1} max={10} />
          <TableStepper isDark={isDark} label="Rows" value={rows} onChange={setRows} min={1} max={30} />

          <div style={dividerStyle} />

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: headerOn ? 8 : 10 }}>
            <span style={rowLabelStyle}>Header Row</span>
            <TableSwitch isDark={isDark} value={headerOn} onChange={setHeaderOn} label="Header row" />
          </div>
          {headerOn && <TableColorRow isDark={isDark} label="Header Color" value={headerColor} onChange={setHeaderColor} />}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: firstColOn ? 8 : 10 }}>
            <span style={rowLabelStyle}>First Column Emphasis</span>
            <TableSwitch isDark={isDark} value={firstColOn} onChange={setFirstColOn} label="First column emphasis" />
          </div>
          {firstColOn && <TableColorRow isDark={isDark} label="First Column Color" value={firstColColor} onChange={setFirstColColor} />}

          <div style={dividerStyle} />

          <TableColorRow isDark={isDark} label="Table Fill" value={fillColor} onChange={setFillColor} />

          <div style={{ marginTop: 4 }}>
            <div style={{ fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: isDark ? 'rgba(255,255,255,0.42)' : 'rgba(0,0,0,0.40)', marginBottom: 6 }}>
              Table Corners
            </div>
            <TableCornerToggle isDark={isDark} value={corners} onChange={setCorners} />
          </div>
        </div>

        <div className="px-4 pt-2 pb-3.5 flex items-center gap-2.5 flex-shrink-0">
          <button
            onClick={onClose}
            className="flex-1 text-[12.5px] font-semibold"
            style={{ padding: '9px 0', borderRadius: 10, background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', color: isDark ? '#fff' : '#0f172a', border: 'none', cursor: 'pointer' }}
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm({ rows, cols, headerOn, headerColor, firstColOn, firstColColor, fillColor, corners })}
            className="flex-1 text-[12.5px] font-semibold text-white"
            style={{ padding: '9px 0', borderRadius: 10, background: '#7c3aed', border: 'none', cursor: 'pointer' }}
          >
            Add Table
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── JournalTextBlock ─────────────────────────────────────────────────────────

// Shared Tiptap editor setup — extracted from JournalTextBlock so a split
// section's two partition panes can each mount their OWN independent editor
// instance (one useEditor() call per component instance; hook rules are per-
// component, so two sibling cell components each calling this is valid even
// though a single component can't call useEditor() twice). The unsplit path
// (JournalTextBlock itself) calls this once, same as before — zero behavior
// change there.
function useProseEditor({
  content, placeholder, resyncKey, forcedContent, onContentChange, onFocus, onSelectionUpdate, onPasteImage,
}: {
  content: string
  placeholder: string
  resyncKey: string // re-applies `content` to the editor whenever this changes (matches the original [editor, block.id] dependency)
  forcedContent?: { content: string; seq: number }
  onContentChange: (content: string) => void
  onFocus: (editor: Editor) => void
  onSelectionUpdate: () => void
  // Image paste support — only passed for section content (see JournalTextBlock
  // and SectionPartitionPane), never for plain text blocks (out of this
  // feature's scope). Returning true from handlePaste tells ProseMirror the
  // paste was fully handled, so it never falls through to inserting the image
  // as text/leaves the default paste behavior to run.
  onPasteImage?: (file: File) => void
}): Editor | null {
  const prevForcedSeqRef = useRef<number>(-1)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        codeBlock: false, blockquote: false,
        strike: false, code: false, horizontalRule: false,
        // bold and italic enabled (default)
        listItem: false, // replaced by SubItemListItem below (adds the sub-item attribute)
      }),
      SubItemListItem,
      TaskList,
      SubItemTaskItem.configure({ nested: true }), // nested:true required for checkbox sub-items
      Placeholder.configure({ placeholder }),
      Underline,
      TextStyle,
      Color,
      XpHighlight,
      BoxTitle,
      XpTable.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
    editorProps: {
      attributes: { class: 'xp-j-prose' },
      handlePaste: onPasteImage ? (_view, event) => {
        const items = event.clipboardData?.items
        if (!items) return false
        for (const item of Array.from(items)) {
          if (item.kind === 'file' && item.type.startsWith('image/')) {
            const file = item.getAsFile()
            if (file) { onPasteImage(file); return true }
          }
        }
        return false
      } : undefined,
    },
    onUpdate: ({ editor: e }) => onContentChange(serializeJournalContent(e)),
  })

  useEffect(() => {
    if (!editor) return
    editor.commands.setContent(parseJournalContent(content || ''), { emitUpdate: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, resyncKey])

  useEffect(() => {
    if (!editor || !forcedContent || forcedContent.seq === prevForcedSeqRef.current) return
    prevForcedSeqRef.current = forcedContent.seq
    editor.commands.setContent(parseJournalContent(forcedContent.content), { emitUpdate: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, forcedContent])

  useEffect(() => {
    if (!editor) return
    const onF = () => onFocus(editor)
    const onS = () => onSelectionUpdate()
    editor.on('focus', onF)
    editor.on('selectionUpdate', onS)
    return () => { editor.off('focus', onF); editor.off('selectionUpdate', onS) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor])

  return editor
}

// ─── Section cells (split-section partitions / single-image sections) ────────
// Deliberate scope simplification (see plan): a cell-level image has no free-
// drag "Move" of its own — only the divider drag (repositions the boundary)
// and "Swap sides" exist for repositioning. Resize reuses the same generic
// ResizeHandles component top-level image/drawing blocks already use.

function SectionImageCell({ blockId, which, cell, isDark, selected, onSelect, onResizeStart, onEditMindMap, onDeleteImage }: {
  blockId: string
  which: 'single' | 'p0' | 'p1'
  cell: SectionCell
  isDark: boolean
  selected: boolean
  onSelect: () => void
  onResizeStart: (dir: ResizeDir, e: React.MouseEvent) => void
  onEditMindMap?: () => void
  onDeleteImage?: () => void
}) {
  // Neutral by default — no cursor affordance, no resize box — until selected
  // by a single click/tap. Double-click/tap opens the full image instead of
  // the old click-to-zoom behavior.
  const { setToast } = useApp()
  const [lightbox, setLightbox] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [sendToOpen, setSendToOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    function outside(e: MouseEvent) {
      if (menuRef.current?.contains(e.target as Node)) return
      setMenuOpen(false)
    }
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [menuOpen])

  return (
    <div
      data-cell-id={`${blockId}:${which}`}
      onClick={e => { e.stopPropagation(); onSelect() }}
      onDoubleClick={e => { e.stopPropagation(); setLightbox(true) }}
      style={{ position: 'relative', display: 'flex', justifyContent: 'center', padding: 4 }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={cell.src}
        alt={cell.name ?? ''}
        style={{
          width: `${cell.width ?? 100}%`, maxWidth: '100%', borderRadius: 8, display: 'block',
          cursor: 'default',
          outline: selected ? '1.5px solid rgba(124,58,237,0.55)' : '1.5px solid transparent',
        }}
      />
      {selected && <ResizeHandles onResizeStart={onResizeStart} />}

      {/* ⋮ menu — same top-right control an MMC-originated image had as a
          top-level block; Resize reuses this component's own selection state,
          Edit Mind Map only appears when this image still carries its
          underlying canvasData (never shown for a plain pasted/uploaded
          image), Delete reuses the same path the Delete key already uses. */}
      <div ref={menuRef} style={{ position: 'absolute', top: 6, right: 6 }} onClick={e => e.stopPropagation()}>
        <button
          onClick={() => setMenuOpen(v => !v)}
          style={{
            width: 24, height: 24, borderRadius: 6, border: 'none', cursor: 'pointer',
            background: menuOpen ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.45)',
            color: '#fff', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center',
            backdropFilter: 'blur(4px)',
          }}
        >⋮</button>
        {menuOpen && (
          <div style={{
            position: 'absolute', top: 28, right: 0, zIndex: 40, minWidth: 148,
            background: isDark ? '#1e1130' : '#fff',
            border: `0.5px solid ${isDark ? 'rgba(124,58,237,0.30)' : 'rgba(0,0,0,0.12)'}`,
            borderRadius: 10,
            boxShadow: isDark ? '0 8px 32px rgba(0,0,0,0.55)' : '0 4px 20px rgba(0,0,0,0.12)',
            padding: '4px 0', overflow: 'hidden',
          }}>
            <button onClick={() => { onSelect(); setMenuOpen(false) }} style={menuItemStyle(isDark)}>
              ⤡ Resize
            </button>
            {/* Available for every image, not just MMC-originated ones — an
                ordinary externally pasted/uploaded image opens with a
                synthesized starting state (see openEditMindMapForCell) and
                only becomes MMC-backed once the user actually saves. */}
            <button onClick={() => { onEditMindMap?.(); setMenuOpen(false) }} style={menuItemStyle(isDark)}>
              🧠 Edit Mind Map
            </button>
            <button onClick={() => { setSendToOpen(true); setMenuOpen(false) }} style={menuItemStyle(isDark)}>
              📤 Send to →
            </button>
            <button onClick={() => { onDeleteImage?.(); setMenuOpen(false) }} style={{ ...menuItemStyle(isDark), color: '#f87171' }}>
              🗑 Delete
            </button>
          </div>
        )}
      </div>

      {lightbox && cell.src && (
        <ImageLightbox src={cell.src} alt={cell.name ?? 'Image'} onClose={() => setLightbox(false)} />
      )}
      {sendToOpen && (
        <SendToOptionsModal
          isDark={isDark}
          context="image"
          taskTree={[]}
          onClose={() => setSendToOpen(false)}
          onCreateTasks={() => 0}
          onAICoachComingSoon={() => setToast('Send to AI Coach — coming soon in Premium V2 🔒')}
        />
      )}
    </div>
  )
}

function SectionPartitionPane({
  blockId, which, content, placeholder, onContentChange, onFocus, onSelectionUpdate,
}: {
  blockId: string
  which: 'p0' | 'p1'
  content: string
  placeholder: string
  onContentChange: (content: string) => void
  onFocus: (editor: Editor) => void
  onSelectionUpdate: () => void
}) {
  const editor = useProseEditor({
    content,
    placeholder,
    resyncKey: `${blockId}:${which}`,
    onContentChange,
    onFocus,
    onSelectionUpdate,
  })
  return (
    <div
      data-cell-id={`${blockId}:${which}`}
      onClick={() => editor?.commands.focus()}
      style={{ cursor: 'text', minHeight: 40 }}
    >
      <EditorContent editor={editor} />
    </div>
  )
}

interface JournalTextBlockProps {
  block: JournalBlock
  isDark: boolean
  isOnlyBlock: boolean
  isFirstBlock?: boolean
  forcedContent?: { content: string; seq: number }
  onContentChange: (id: string, content: string) => void
  onFocus: (editor: Editor) => void
  onSelectionUpdate: () => void
  onDelete?: () => void
  onDuplicate?: () => void
  onTransferSection?: () => void
  onMoveActivate?: () => void
  onResizeActivate?: () => void
  onColorChange?: (color: SectionColorKey) => void
  onNameChange?: (name: string | undefined) => void
  onCollapseToggle?: () => void
  onPasteImage?: (file: File) => void
  onSplitSection?: () => void
  onMergeSection?: () => void
  onUpdateBlock?: (updates: Partial<JournalBlock>) => void
  onCellResizeStart?: (which: 'single' | 'p0' | 'p1', dir: ResizeDir, e: React.MouseEvent) => void
  onDeleteImageCell?: (which: 'single' | 'p0' | 'p1') => void
  onEditMindMapCell?: (which: 'single' | 'p0' | 'p1') => void
  canMoveUp: boolean
  canMoveDown: boolean
  onMoveUp: () => void
  onMoveDown: () => void
}

const JournalTextBlock = React.memo(function JournalTextBlock({
  block, isDark, isOnlyBlock, isFirstBlock = false, forcedContent,
  onContentChange, onFocus, onSelectionUpdate,
  onDelete, onDuplicate, onTransferSection,
  onMoveActivate, onResizeActivate, onColorChange, onNameChange, onCollapseToggle,
  onPasteImage, onSplitSection, onMergeSection, onUpdateBlock, onCellResizeStart, onDeleteImageCell, onEditMindMapCell,
  canMoveUp, canMoveDown, onMoveUp, onMoveDown,
}: JournalTextBlockProps) {
  const { updateDay, setToast } = useApp()
  const [menuOpen,       setMenuOpen]       = useState(false)
  const [showColorPick,  setShowColorPick]  = useState(false)
  const [addingTitle,    setAddingTitle]    = useState(false)
  const [titleValue,     setTitleValue]     = useState(block.name ?? '')
  const [selectedCell,   setSelectedCell]   = useState<'single' | 'p0' | 'p1' | null>(null)
  const [liveSplit,      setLiveSplit]      = useState<number | null>(null)
  const menuRef           = useRef<HTMLDivElement>(null)
  const titleInputRef     = useRef<HTMLInputElement>(null)
  const dividerRef        = useRef<HTMLDivElement>(null)

  // Draggable divider between the two partitions — live-visual only (liveSplit)
  // until mouseup, when it's persisted once via onUpdateBlock (same "don't spam
  // history per pixel" pattern startBlockResize uses for the top-level blocks).
  function startDividerDrag(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    const row = dividerRef.current?.parentElement as HTMLElement | null
    if (!row) return
    const rect = row.getBoundingClientRect()
    const clampPct = (clientX: number) => Math.max(20, Math.min(80, Math.round(((clientX - rect.left) / rect.width) * 100)))
    const onMove = (ev: MouseEvent) => setLiveSplit(clampPct(ev.clientX))
    const onUp = (ev: MouseEvent) => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      const pct = clampPct(ev.clientX)
      setLiveSplit(null)
      onUpdateBlock?.({ partitionSplit: pct })
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  // ── "Send to…" (this section only) — the wizard UI itself lives entirely
  // inside SendToOptionsModal; this component just supplies a fresh task tree
  // each time it opens and performs the actual Task Manager write on confirm.
  const [sendToOpen, setSendToOpen] = useState(false)
  const [tmTaskTree, setTmTaskTree] = useState<PlannerTaskNode[]>([])
  const [showAddTable, setShowAddTable] = useState(false)

  // Unsplit section/text content — when block.sectionImage or block.partitions
  // is set this editor's content is simply unused (see the render branch
  // below), but the hook still runs (hook-call order must stay unconditional).
  const editor = useProseEditor({
    content: block.content ?? '',
    placeholder: (block.type === 'section' && !isFirstBlock)
      ? 'Add section content…'
      : 'Write your plans, reflections, gratitude, journal entries, brain dumps, ideas, or mind maps here…',
    resyncKey: block.id,
    forcedContent,
    onContentChange: content => onContentChange(block.id, content),
    onFocus,
    onSelectionUpdate,
    onPasteImage: block.type === 'section' ? onPasteImage : undefined,
  })

  useEffect(() => {
    if (!menuOpen) setShowColorPick(false)
  }, [menuOpen])

  useEffect(() => {
    if (addingTitle) titleInputRef.current?.focus()
  }, [addingTitle])

  useEffect(() => { setTitleValue(block.name ?? '') }, [block.name])

  useEffect(() => {
    if (!menuOpen) return
    function outside(e: MouseEvent) {
      if (menuRef.current?.contains(e.target as Node)) return
      setMenuOpen(false)
    }
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [menuOpen])

  // Exclusive image-cell selection: clicking/tapping anywhere outside the
  // selected cell deselects it; Delete/Backspace removes just that image
  // (leaving a split section's layout intact — never auto-merges).
  useEffect(() => {
    const cell = selectedCell
    if (!cell) return
    function outside(e: MouseEvent) {
      const cellEl = document.querySelector(`[data-cell-id="${block.id}:${cell}"]`)
      if (cellEl?.contains(e.target as Node)) return
      setSelectedCell(null)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      const active = document.activeElement as HTMLElement | null
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return
      e.preventDefault()
      onDeleteImageCell?.(cell as 'single' | 'p0' | 'p1')
      setSelectedCell(null)
    }
    document.addEventListener('mousedown', outside)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', outside)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [selectedCell, block.id, onDeleteImageCell])

  // ── "Send to…" ────────────────────────────────────────────────────────────────
  // Builds a fresh task tree for this section and opens the modal — everything
  // past this point (selection, duplicate handling, TM date) lives inside
  // SendToOptionsModal itself; this component only supplies data and performs
  // the actual write.
  function tmOpenSendTo() {
    if (editor) {
      const { doc, changed } = ensureTaskItemIds(editor.getJSON())
      if (changed) editor.commands.setContent(doc, { emitUpdate: true })
      setTmTaskTree(extractPlannerTaskTree(doc))
    }
    setSendToOpen(true)
    setMenuOpen(false)
  }

  // AI Coach send destinations are a planned Premium V2 feature — the action
  // itself is a lightweight "coming soon" notice, never an attempted send.
  function tmSendAICoachComingSoon() {
    setToast('Send to AI Coach — coming soon in Premium V2 🔒')
  }

  // Creates the actual Task Manager tasks (existing Task/updateDay data model —
  // no separate storage), then writes xpSentTaskId back onto the corresponding
  // Planner taskItem nodes so the "Sent" badge appears and future duplicate
  // checks see it. The Planner document's own content is otherwise untouched —
  // this is a send/copy, never a move. Returns the created count so the modal
  // can show feedback without needing to duplicate this logic.
  function tmCreateTasks(nodes: PlannerTaskNode[], destKey: string): number {
    const idMap = new Map<string, string>()
    const newTasks: Task[] = []
    let seed = 0
    for (const top of nodes) {
      const topId = makeTaskId(seed++)
      idMap.set(top.id, topId)
      newTasks.push({ id: topId, text: top.text || '(untitled task)', done: false, journal: '', timerStart: null, timerEnd: null, actId: 'a-plan', sessions: [] })
      for (const child of top.children) {
        const childId = makeTaskId(seed++)
        idMap.set(child.id, childId)
        newTasks.push({ id: childId, text: child.text || '(untitled task)', done: false, journal: '', timerStart: null, timerEnd: null, actId: 'a-plan', sessions: [], parentTaskId: topId })
      }
    }
    updateDay(destKey, prev => ({ ...prev, tasks: [...(prev.tasks ?? []), ...newTasks] }))

    if (editor) {
      const doc = editor.getJSON()
      function walk(node: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
        if (!node || typeof node !== 'object') return
        if (node.type === 'taskItem' && node.attrs?.xpId && idMap.has(node.attrs.xpId)) {
          node.attrs = { ...node.attrs, xpSentTaskId: idMap.get(node.attrs.xpId) }
        }
        if (Array.isArray(node.content)) node.content.forEach(walk)
      }
      walk(doc)
      editor.commands.setContent(doc, { emitUpdate: true })
      setTmTaskTree(extractPlannerTaskTree(doc)) // keep the modal's tree (Sent badges) in sync
    }

    const n = newTasks.length
    setToast(`${n} ${n === 1 ? 'task' : 'tasks'} sent to Task Manager ✓`)
    return n
  }

  function commitTitle() {
    const trimmed = titleValue.trim()
    onNameChange?.(trimmed || undefined)
    setAddingTitle(false)
  }

  // Inserts the configured table at the current cursor in THIS block's own
  // editor, then bakes the chosen colors onto the table node itself — chained
  // in one command sequence so updateAttributes reads the selection insertTable
  // just placed inside the new table's first cell.
  function handleAddTable(config: AddTableConfig) {
    setShowAddTable(false)
    if (!editor) return
    // Two separate .run() calls, not one chained sequence: insertTable must
    // fully dispatch and land in the editor's real state before
    // updateAttributes reads "the table at the current selection" — chaining
    // both under one transaction risks updateAttributes resolving against a
    // selection/doc pairing from a half-applied step.
    const inserted = editor.chain().focus()
      .insertTable({ rows: config.rows, cols: config.cols, withHeaderRow: config.headerOn })
      .run()
    if (!inserted) {
      setToast('Could not insert the table here — try clicking inside the section first.')
      return
    }
    editor.chain().updateAttributes('table', {
      fillColor: config.fillColor,
      headerColor: config.headerColor,
      firstColColor: config.firstColColor,
      firstColOn: config.firstColOn,
      corners: config.corners,
    }).run()
  }

  const isSection   = block.type === 'section'
  const sectionStyle = isSection
    ? getSectionStyle(block.sectionColor ?? 'plain', isDark)
    : null
  const hasTitle  = isSection && !!block.name
  const hasMenu   = isSection ? true : canMoveUp || canMoveDown || (!!onDelete && !isOnlyBlock)
  const collapsed = isSection && block.collapsed === true

  return (
    <div
      className={isSection ? 'xp-j-sec-wrap' : 'xp-j-main-wrap'}
      style={{
        position: 'relative',
        borderRadius: sectionStyle ? 10 : 0,
        border: sectionStyle ? `0.5px solid ${sectionStyle.border}` : 'none',
        background: sectionStyle ? sectionStyle.background : 'transparent',
        padding: sectionStyle ? '12px 40px 12px 14px' : '0',
        marginBottom: sectionStyle ? 4 : 0,
        ...(isSection && block.height != null && !collapsed ? { minHeight: block.height } : {}),
      }}
    >

      {/* Section header row: ▶ collapse triangle + title (presentational-only collapse) */}
      {isSection ? (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 5 }}>
          <button
            onClick={() => onCollapseToggle?.()}
            title={collapsed ? 'Expand section' : 'Collapse section'}
            aria-label={collapsed ? 'Expand section' : 'Collapse section'}
            style={{
              flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 18, height: 18, marginTop: 1, border: 'none', background: 'transparent', cursor: 'pointer',
              borderRadius: 5, color: isDark ? 'rgba(255,255,255,0.40)' : 'rgba(0,0,0,0.35)',
              transition: 'background 120ms, color 120ms',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
          >
            <span style={{ display: 'inline-block', fontSize: 10, lineHeight: 1, transform: collapsed ? 'rotate(0deg)' : 'rotate(90deg)', transition: 'transform 200ms cubic-bezier(0.4,0,0.2,1)' }}>▶</span>
          </button>

          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Optional section title */}
            {(hasTitle || addingTitle) ? (
              addingTitle ? (
                <input
                  ref={titleInputRef}
                  value={titleValue}
                  onChange={e => setTitleValue(e.target.value)}
                  onBlur={commitTitle}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); commitTitle() }
                    if (e.key === 'Escape') { setAddingTitle(false); setTitleValue(block.name ?? '') }
                  }}
                  placeholder="Section title…"
                  style={{
                    display: 'block', width: '100%', border: 'none', outline: 'none',
                    background: 'transparent', padding: '0 0 6px',
                    fontFamily: 'inherit', fontSize: 15, fontWeight: 700,
                    letterSpacing: '-0.01em',
                    color: isDark ? '#f1f5f9' : '#0f172a',
                    borderBottom: `1px solid ${isDark ? 'rgba(124,58,237,0.35)' : 'rgba(124,58,237,0.25)'}`,
                    marginBottom: 8,
                  }}
                />
              ) : (
                <div
                  onClick={() => setAddingTitle(true)}
                  title="Click to edit title"
                  style={{
                    fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em',
                    color: isDark ? '#f1f5f9' : '#0f172a',
                    marginBottom: collapsed ? 0 : 6, cursor: 'text',
                    lineHeight: 1.3,
                  }}
                >{block.name}</div>
              )
            ) : (
              /* Faint "+ Add Title" — only visible on hover via CSS */
              <div
                className="xp-j-add-title"
                onClick={() => setAddingTitle(true)}
                style={{
                  fontSize: 11, cursor: 'text', marginBottom: 4,
                  color: isDark ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.25)',
                  opacity: 0, transition: 'opacity 150ms',
                  userSelect: 'none',
                }}
              >+ Add Title</div>
            )}
          </div>
        </div>
      ) : null}

      {/* Editor — hidden while collapsed; collapsing never touches its content.
          Task selection for "Send to…" happens entirely inside SendToOptionsModal,
          never in-place here — the Planner document itself is never altered for it.
          Three mutually-exclusive states: split (partitions), single image
          (sectionImage), or the plain Tiptap editor — every pre-existing
          section (neither field set) renders exactly as before. */}
      {!collapsed && (
        block.partitions ? (
          <div style={{ display: 'flex', alignItems: 'stretch', position: 'relative' }}>
            <div style={{ flex: `0 0 ${liveSplit ?? block.partitionSplit ?? 50}%`, minWidth: 0 }}>
              {block.partitions[0].kind === 'image' ? (
                <SectionImageCell
                  blockId={block.id} which="p0" cell={block.partitions[0]} isDark={isDark}
                  selected={selectedCell === 'p0'}
                  onSelect={() => setSelectedCell('p0')}
                  onResizeStart={(dir, e) => onCellResizeStart?.('p0', dir, e)}
                  onEditMindMap={() => onEditMindMapCell?.('p0')}
                  onDeleteImage={() => onDeleteImageCell?.('p0')}
                />
              ) : (
                <SectionPartitionPane
                  blockId={block.id} which="p0"
                  content={block.partitions[0].content ?? ''}
                  placeholder="Add content…"
                  onContentChange={content => onUpdateBlock?.({
                    partitions: [{ ...block.partitions![0], content }, block.partitions![1]],
                  })}
                  onFocus={onFocus}
                  onSelectionUpdate={onSelectionUpdate}
                />
              )}
            </div>
            <div
              ref={dividerRef}
              onMouseDown={startDividerDrag}
              title="Drag to resize"
              style={{ width: 10, flexShrink: 0, cursor: 'col-resize', position: 'relative' }}
            >
              <div style={{
                position: 'absolute', left: '50%', top: 4, bottom: 4, width: 2,
                transform: 'translateX(-50%)', borderRadius: 1,
                background: isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.12)',
              }} />
            </div>
            <div style={{ flex: '1 1 0%', minWidth: 0 }}>
              {block.partitions[1].kind === 'image' ? (
                <SectionImageCell
                  blockId={block.id} which="p1" cell={block.partitions[1]} isDark={isDark}
                  selected={selectedCell === 'p1'}
                  onSelect={() => setSelectedCell('p1')}
                  onResizeStart={(dir, e) => onCellResizeStart?.('p1', dir, e)}
                  onEditMindMap={() => onEditMindMapCell?.('p1')}
                  onDeleteImage={() => onDeleteImageCell?.('p1')}
                />
              ) : (
                <SectionPartitionPane
                  blockId={block.id} which="p1"
                  content={block.partitions[1].content ?? ''}
                  placeholder="Add content…"
                  onContentChange={content => onUpdateBlock?.({
                    partitions: [block.partitions![0], { ...block.partitions![1], content }],
                  })}
                  onFocus={onFocus}
                  onSelectionUpdate={onSelectionUpdate}
                />
              )}
            </div>
            <button
              onClick={() => onUpdateBlock?.({ partitions: [block.partitions![1], block.partitions![0]] })}
              title="Swap sides"
              style={{
                position: 'absolute', top: -10, left: '50%', transform: 'translateX(-50%)',
                width: 20, height: 20, borderRadius: 6, border: 'none', cursor: 'pointer',
                background: isDark ? '#1e1130' : '#fff',
                boxShadow: isDark ? '0 2px 8px rgba(0,0,0,0.5)' : '0 2px 8px rgba(0,0,0,0.18)',
                color: isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.45)',
                fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >⇄</button>
          </div>
        ) : block.sectionImage ? (
          <SectionImageCell
            blockId={block.id} which="single" cell={block.sectionImage} isDark={isDark}
            selected={selectedCell === 'single'}
            onSelect={() => setSelectedCell('single')}
            onResizeStart={(dir, e) => onCellResizeStart?.('single', dir, e)}
            onEditMindMap={() => onEditMindMapCell?.('single')}
            onDeleteImage={() => onDeleteImageCell?.('single')}
          />
        ) : (
          <div onClick={() => editor?.commands.focus()} style={{ cursor: 'text' }}>
            <EditorContent editor={editor} />
          </div>
        )
      )}

      {/* Section timestamp — bottom-right, quiet metadata */}
      {isSection && !collapsed && (
        <div style={{
          position: 'absolute', bottom: 6, right: 8,
          fontSize: 10, lineHeight: 1, userSelect: 'none', pointerEvents: 'none',
          color: isDark ? 'rgba(255,255,255,0.20)' : 'rgba(0,0,0,0.20)',
          letterSpacing: '0.01em',
        }}>
          {fmtBlockTime(block.createdAt)}
        </div>
      )}

      {/* ⋮ block menu */}
      {hasMenu && (
        <div ref={menuRef} style={{ position: 'absolute', top: 8, right: 8 }}>
          <button
            onClick={() => setMenuOpen(v => !v)}
            style={{
              width: 24, height: 24, borderRadius: 6, border: 'none', cursor: 'pointer',
              background: menuOpen
                ? (isDark ? 'rgba(124,58,237,0.20)' : 'rgba(124,58,237,0.10)')
                : 'transparent',
              color: isDark ? 'rgba(255,255,255,0.40)' : 'rgba(0,0,0,0.35)',
              fontSize: 14, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 120ms',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.color = isDark ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.65)'
            }}
            onMouseLeave={e => {
              if (!menuOpen) (e.currentTarget as HTMLButtonElement).style.color = isDark ? 'rgba(255,255,255,0.40)' : 'rgba(0,0,0,0.35)'
            }}
          >⋮</button>

          {menuOpen && (
            <div style={{
              position: 'absolute', top: 28, right: 0, zIndex: 40, minWidth: 156,
              background: isDark ? '#1e1130' : '#fff',
              border: `0.5px solid ${isDark ? 'rgba(124,58,237,0.30)' : 'rgba(0,0,0,0.12)'}`,
              borderRadius: 10,
              boxShadow: isDark ? '0 8px 32px rgba(0,0,0,0.55)' : '0 4px 20px rgba(0,0,0,0.12)',
              padding: '4px 0', overflow: 'hidden',
            }}>
              {isSection ? (
                showColorPick ? (
                  /* Color picker sub-view */
                  <>
                    <div style={{ padding: '5px 12px 3px', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: isDark ? 'rgba(255,255,255,0.38)' : 'rgba(0,0,0,0.35)', userSelect: 'none' }}>
                      Section Color
                    </div>
                    {SECTION_COLORS.map(c => {
                      const swatchColor = c.key === 'plain'
                        ? (isDark ? 'rgba(255,255,255,0.80)' : 'rgba(0,0,0,0.35)')
                        : getSectionStyle(c.key, isDark).labelColor
                      const isSelected = block.sectionColor === c.key
                      return (
                        <button
                          key={c.key}
                          onClick={() => { onColorChange?.(c.key as SectionColorKey); setMenuOpen(false) }}
                          style={{ ...menuItemStyle(isDark), display: 'flex', alignItems: 'center', gap: 9, fontWeight: isSelected ? 600 : 400 }}
                          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = isDark ? 'rgba(124,58,237,0.16)' : 'rgba(124,58,237,0.07)' }}
                          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
                        >
                          <span style={{
                            width: 11, height: 11, borderRadius: '50%', flexShrink: 0,
                            background: swatchColor,
                            border: c.key === 'plain' ? `0.5px solid ${isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.22)'}` : 'none',
                            boxShadow: c.key !== 'plain' ? `0 0 5px ${swatchColor}66` : 'none',
                          }} />
                          {c.label}
                          {isSelected && <span style={{ marginLeft: 'auto', fontSize: 10, color: '#a78bfa' }}>✓</span>}
                        </button>
                      )
                    })}
                    <div style={{ height: 1, background: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)', margin: '4px 0' }} />
                    <button onClick={() => setShowColorPick(false)} style={{ ...menuItemStyle(isDark), fontSize: 11, color: isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.40)' }}>
                      ← Back
                    </button>
                  </>
                ) : (
                  /* Section action menu */
                  <>
                    <button onClick={() => { onMoveActivate?.(); setMenuOpen(false) }} style={menuItemStyle(isDark)}>
                      ✥ Move
                    </button>
                    <button onClick={() => { onResizeActivate?.(); setMenuOpen(false) }} style={menuItemStyle(isDark)}>
                      ⤡ Resize
                    </button>
                    <button onClick={() => {
                      if (!hasTitle) setAddingTitle(true)
                      else editor?.commands.focus()
                      setMenuOpen(false)
                    }} style={menuItemStyle(isDark)}>
                      ✏ Edit Section
                    </button>
                    <button onClick={() => { setShowAddTable(true); setMenuOpen(false) }} style={menuItemStyle(isDark)}>
                      ▦ Add Table
                    </button>
                    {!block.partitions ? (
                      <button onClick={() => { onSplitSection?.(); setMenuOpen(false) }} style={menuItemStyle(isDark)}>
                        ⬓ Split Section
                      </button>
                    ) : (
                      <button onClick={() => { onMergeSection?.(); setMenuOpen(false) }} style={menuItemStyle(isDark)}>
                        ▭ Merge Section
                      </button>
                    )}
                    <button onClick={() => setShowColorPick(true)} style={menuItemStyle(isDark)}>
                      🎨 Change Color
                    </button>
                    {!!onDuplicate && (
                      <button onClick={() => { onDuplicate(); setMenuOpen(false) }} style={menuItemStyle(isDark)}>
                        📑 Duplicate
                      </button>
                    )}
                    {!!onTransferSection && (
                      <button onClick={() => { onTransferSection(); setMenuOpen(false) }} style={menuItemStyle(isDark)}>
                        📅 Move Section
                      </button>
                    )}
                    <button onClick={tmOpenSendTo} style={menuItemStyle(isDark)}>
                      📤 Send to…
                    </button>
                    {!!onDelete && !isOnlyBlock && (
                      <button onClick={() => { onDelete(); setMenuOpen(false) }} style={{ ...menuItemStyle(isDark), color: '#f87171' }}>
                        🗑 Delete
                      </button>
                    )}
                  </>
                )
              ) : (
                /* Plain text block menu */
                <>
                  {canMoveUp && (
                    <button onClick={() => { onMoveUp(); setMenuOpen(false) }} style={menuItemStyle(isDark)}>
                      ↑ Move Up
                    </button>
                  )}
                  {canMoveDown && (
                    <button onClick={() => { onMoveDown(); setMenuOpen(false) }} style={menuItemStyle(isDark)}>
                      ↓ Move Down
                    </button>
                  )}
                  {!!onDelete && !isOnlyBlock && (
                    <button onClick={() => { onDelete(); setMenuOpen(false) }} style={{ ...menuItemStyle(isDark), color: '#f87171' }}>
                      🗑 Delete
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* "Send to…" — a self-contained wizard (options → select → duplicate →
          TM date/calendar) that stays open across actions; only its own explicit
          Close exits it. Selection/duplicate handling all live inside the modal —
          this component only supplies the task tree and performs the TM write. */}
      {sendToOpen && (
        <SendToOptionsModal
          isDark={isDark}
          context="section"
          taskTree={tmTaskTree}
          onClose={() => setSendToOpen(false)}
          onCreateTasks={tmCreateTasks}
          onAICoachComingSoon={tmSendAICoachComingSoon}
        />
      )}

      {showAddTable && (
        <AddTableModal
          isDark={isDark}
          onClose={() => setShowAddTable(false)}
          onConfirm={handleAddTable}
        />
      )}
    </div>
  )
})

// ─── InlineMediaBlock ─────────────────────────────────────────────────────────

interface InlineMediaBlockProps {
  block: JournalBlock
  isDark: boolean
  onEdit: () => void
  onMoveActivate: () => void
  onResizeActivate: () => void
  onDelete: () => void
  onCollapseToggle: () => void
  onBeginDrag?: (e: React.MouseEvent | React.TouchEvent) => void
  wasJustDragged?: () => boolean
}

function InlineMediaBlock({ block, isDark, onEdit, onMoveActivate, onResizeActivate, onDelete, onCollapseToggle, onBeginDrag, wasJustDragged }: InlineMediaBlockProps) {
  const { setToast } = useApp()
  const [menuOpen, setMenuOpen] = useState(false)
  const [lightbox, setLightbox] = useState(false)
  const [sendToOpen, setSendToOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const collapsed = block.collapsed === true
  const mediaLabel = block.name || (block.type === 'drawing' ? 'Mind Map' : 'Image')

  useEffect(() => {
    if (!menuOpen) return
    function outside(e: MouseEvent) {
      if (menuRef.current?.contains(e.target as Node)) return
      setMenuOpen(false)
    }
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [menuOpen])

  return (
    <div style={{ position: 'relative', margin: '4px 0' }}>
      {/* Header row: collapse triangle + label — same visual language as a Planner
          section's own header, so media follows the identical collapse pattern. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: collapsed ? 0 : 5, paddingRight: 32 }}>
        <button
          onClick={onCollapseToggle}
          title={collapsed ? 'Expand media' : 'Collapse media'}
          aria-label={collapsed ? 'Expand media' : 'Collapse media'}
          style={{
            flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 18, height: 18, border: 'none', background: 'transparent', cursor: 'pointer',
            borderRadius: 5, color: isDark ? 'rgba(255,255,255,0.40)' : 'rgba(0,0,0,0.35)',
            transition: 'background 120ms, color 120ms',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
        >
          <span style={{ display: 'inline-block', fontSize: 10, lineHeight: 1, transform: collapsed ? 'rotate(0deg)' : 'rotate(90deg)', transition: 'transform 200ms cubic-bezier(0.4,0,0.2,1)' }}>▶</span>
        </button>
        <span style={{
          fontSize: 11, fontWeight: 600, color: isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.55)',
          minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', userSelect: 'none',
        }}>
          {block.type === 'drawing' ? '✏️ ' : '📷 '}{mediaLabel}
        </span>
      </div>

      {/* Image — explicit height when user has resized vertically (desktop/tablet
          only; mobile always shows the image at its natural aspect ratio via the
          xp-media-img CSS override below, so a resized box never letterboxes with
          gray bars on a narrow screen). Hidden entirely while collapsed. */}
      {!collapsed && block.src && (
        <img
          className="xp-media-img"
          data-has-fixed-height={block.height != null ? 'true' : undefined}
          src={block.thumbnail ?? block.src}
          alt={block.name ?? (block.type === 'drawing' ? 'Mind Map' : 'Image')}
          onMouseDown={e => { e.stopPropagation(); onBeginDrag?.(e) }}
          onTouchStart={e => { e.stopPropagation(); onBeginDrag?.(e) }}
          onClick={e => {
            e.stopPropagation()
            if (wasJustDragged?.()) return
            onResizeActivate()
          }}
          onDoubleClick={e => { e.stopPropagation(); setLightbox(true) }}
          style={{
            display: 'block', cursor: 'default',
            width: '100%',
            height: block.height != null ? block.height + 'px' : 'auto',
            objectFit: block.height != null ? 'contain' : undefined,
            borderRadius: 10,
            border: `0.5px solid ${isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)'}`,
            boxShadow: isDark ? '0 2px 12px rgba(0,0,0,0.35)' : '0 2px 8px rgba(0,0,0,0.08)',
          }}
        />
      )}

      {/* ⋮ menu — Move, Resize, Edit, Delete */}
      <div ref={menuRef} style={{ position: 'absolute', top: 8, right: 8 }}>
        <button
          onClick={() => setMenuOpen(v => !v)}
          style={{
            width: 26, height: 26, borderRadius: 6, border: 'none', cursor: 'pointer',
            background: menuOpen ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.45)',
            color: '#fff', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
            backdropFilter: 'blur(4px)',
          }}
        >⋮</button>

        {menuOpen && (
          <div style={{
            position: 'absolute', top: 32, right: 0, zIndex: 40, minWidth: 148,
            background: isDark ? '#1e1130' : '#fff',
            border: `0.5px solid ${isDark ? 'rgba(124,58,237,0.30)' : 'rgba(0,0,0,0.12)'}`,
            borderRadius: 10,
            boxShadow: isDark ? '0 8px 32px rgba(0,0,0,0.55)' : '0 4px 20px rgba(0,0,0,0.12)',
            padding: '4px 0', overflow: 'hidden',
          }}>
              <button onClick={() => { onMoveActivate(); setMenuOpen(false) }} style={menuItemStyle(isDark)}>
              ✥ Move
            </button>
            <button onClick={() => { onResizeActivate(); setMenuOpen(false) }} style={menuItemStyle(isDark)}>
              ⤡ Resize
            </button>
            {/* Available for every image, not just MMC-originated drawings —
                an ordinary externally pasted/uploaded image opens with a
                synthesized starting state (see openEditMindMapForImage) and
                only becomes MMC-backed once the user actually saves. */}
            <button onClick={() => { onEdit(); setMenuOpen(false) }} style={menuItemStyle(isDark)}>
              🧠 Edit Mind Map
            </button>
            <button onClick={() => { setSendToOpen(true); setMenuOpen(false) }} style={menuItemStyle(isDark)}>
              📤 Send to →
            </button>
            <button onClick={() => { onDelete(); setMenuOpen(false) }} style={{ ...menuItemStyle(isDark), color: '#f87171' }}>
              🗑 Delete
            </button>
          </div>
        )}
      </div>

      {lightbox && block.src && (
        <ImageLightbox src={block.src} alt={block.name ?? 'Image'} onClose={() => setLightbox(false)} />
      )}

      {/* Images/Mind Maps are never Task Manager tasks — only AI Coach applies here */}
      {sendToOpen && (
        <SendToOptionsModal
          isDark={isDark}
          context="image"
          taskTree={[]}
          onClose={() => setSendToOpen(false)}
          onCreateTasks={() => 0}
          onAICoachComingSoon={() => setToast('Send to AI Coach — coming soon in Premium V2 🔒')}
        />
      )}
    </div>
  )
}

// InsertRow component removed — new sections/content added via the bottom toolbar.

// ─── Ghost slot — drop target preview during drag-move ────────────────────────

function GhostSlot({ colSpan, blockH }: { colSpan: number; blockH?: number }) {
  const rowSpan = blockH
    ? Math.max(4, Math.ceil((blockH + GRID_GAP) / (ROW_PX + GRID_GAP)))
    : 10
  return (
    <div
      aria-hidden
      style={{
        gridColumn: `span ${colSpan}`,
        gridRow: `span ${rowSpan}`,
        background: 'rgba(124,58,237,0.07)',
        border: '1.5px dashed rgba(124,58,237,0.38)',
        borderRadius: 10,
        boxShadow: 'inset 0 0 0 1px rgba(124,58,237,0.06)',
        pointerEvents: 'none',
        animation: 'xpGhostPulse 2s ease-in-out infinite',
      }}
    />
  )
}

// ─── Floating text formatter — appears above text selection ──────────────────

// ── XpHighlight: custom inline mark for text background highlight ─────────────
declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    xpHighlight: {
      setXpHighlight: (color: string) => ReturnType
      unsetXpHighlight: () => ReturnType
    }
    boxTitle: {
      setBoxTitle: (color: string) => ReturnType
      unsetBoxTitle: () => ReturnType
    }
  }
}

const XpHighlight = Mark.create({
  name: 'xpHighlight',
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: el => (el as HTMLElement).getAttribute('data-xp-hl') || null,
        renderHTML: attrs => attrs.color ? { 'data-xp-hl': attrs.color } : {},
      },
    }
  },
  parseHTML() { return [{ tag: 'mark[data-xp-hl]' }] },
  renderHTML({ HTMLAttributes }) {
    return ['mark', mergeAttributes(HTMLAttributes, {
      style: `background-color:${HTMLAttributes['data-xp-hl']};border-radius:2px;padding:0 1px;`,
    }), 0]
  },
  addCommands() {
    return {
      setXpHighlight: (color: string) => ({ commands }) => commands.setMark(this.name, { color }),
      unsetXpHighlight: () => ({ commands }) => commands.unsetMark(this.name),
    }
  },
})

// ── Box Title: a toggle mark wrapping selected text in a compact rounded pill
// via the .xp-j-box-title CSS class, with a `color` attribute (default 'purple')
// selecting one of five curated pastel treatments via data-box-color. Persists
// through the same editor.getJSON() pipeline as every other mark in this editor.
const BOX_TITLE_DEFAULT_COLOR = 'purple'
const BoxTitle = Mark.create({
  name: 'boxTitle',
  addAttributes() {
    return {
      color: {
        default: BOX_TITLE_DEFAULT_COLOR,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-box-color') || BOX_TITLE_DEFAULT_COLOR,
        renderHTML: (attrs: { color?: string }) => ({ 'data-box-color': attrs.color || BOX_TITLE_DEFAULT_COLOR }),
      },
    }
  },
  parseHTML() { return [{ tag: 'span[data-box-title]' }] },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-box-title': 'true', class: 'xp-j-box-title' }), 0]
  },
  addCommands() {
    return {
      setBoxTitle: (color: string) => ({ commands }) => commands.setMark(this.name, { color }),
      unsetBoxTitle: () => ({ commands }) => commands.unsetMark(this.name),
    }
  },
})

// ── Sub-item: a data-only flag on listItem/taskItem marking a node as a
// one-level-deep child created via the "↳ Sub-item" control (distinct from
// plain Indent). Persists through the existing editor.getJSON() pipeline —
// no separate storage needed. Purely additive: normal Indent/nesting is
// untouched, this only adds an attribute the connector CSS reads.
const SubItemListItem = ListItem.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      subItem: {
        default: false,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-sub-item') === 'true',
        renderHTML: (attrs: { subItem?: boolean }) => attrs.subItem ? { 'data-sub-item': 'true' } : {},
      },
    }
  },
})

const SubItemTaskItem = TaskItem.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      subItem: {
        default: false,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-sub-item') === 'true',
        renderHTML: (attrs: { subItem?: boolean }) => attrs.subItem ? { 'data-sub-item': 'true' } : {},
      },
      // Stable identity for the Planner → Task Manager bridge — persists through
      // the existing editor.getJSON()/content-string pipeline, no separate store.
      xpId: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-xp-id') || null,
        renderHTML: (attrs: { xpId?: string | null }) => attrs.xpId ? { 'data-xp-id': attrs.xpId } : {},
      },
      // The Task Manager task id this item was last sent as, or null if never sent.
      xpSentTaskId: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-xp-sent-task-id') || null,
        renderHTML: (attrs: { xpSentTaskId?: string | null }) => attrs.xpSentTaskId ? { 'data-xp-sent-task-id': attrs.xpSentTaskId } : {},
      },
    }
  },
})

// Planner "Add Table" — colors are resolved once via getTableColor and baked
// into CSS custom properties on the <table> element itself. This node lives
// inside ProseMirror-managed content, which only repaints on editor
// transactions (not on ordinary React re-renders like the app's dark/light
// toggle), so its colors are fixed at creation time — see getTableColor's
// comment in journalUtils.ts for why that's the deliberate tradeoff.
const XpTable = TiptapTable.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      fillColor:     { default: 'plain' },
      headerColor:   { default: 'lavender' },
      firstColColor: { default: 'lavender' },
      firstColOn:    { default: false },
      corners:       { default: 'rounded' },
    }
  },
  renderHTML({ node, HTMLAttributes }) {
    const fill     = getTableColor(node.attrs.fillColor)
    const header   = getTableColor(node.attrs.headerColor)
    const firstCol = getTableColor(node.attrs.firstColColor)
    const style =
      `--xp-tbl-fill:${fill.bg};--xp-tbl-fill-text:${fill.text};` +
      `--xp-tbl-header:${header.bg};--xp-tbl-header-text:${header.text};` +
      `--xp-tbl-firstcol:${firstCol.bg};--xp-tbl-firstcol-text:${firstCol.text};`
    const wrapClass = 'xp-j-table-wrap' + (node.attrs.corners === 'square' ? ' xp-j-table-square' : '')
    return ['div', { class: wrapClass }, ['table', mergeAttributes(HTMLAttributes, {
      class: 'xp-j-table' + (node.attrs.firstColOn ? ' xp-j-table-firstcol' : ''),
      style,
    }), ['tbody', 0]]]
  },
})

const HIGHLIGHT_COLORS: Array<{ label: string; value: string | null; swatch: string }> = [
  { label: 'None',        value: null,      swatch: 'transparent' },
  { label: 'Yellow',      value: '#fef08a', swatch: '#fef08a' },
  { label: 'Lavender',    value: '#e9d5ff', swatch: '#e9d5ff' },
  { label: 'Light Green', value: '#bbf7d0', swatch: '#bbf7d0' },
  { label: 'Light Red',   value: '#fecaca', swatch: '#fecaca' },
  { label: 'Purple',      value: '#ddd6fe', swatch: '#ddd6fe' },
  { label: 'Teal',        value: '#99f6e4', swatch: '#99f6e4' },
  { label: 'Peach',       value: '#fed7aa', swatch: '#fed7aa' },
  { label: 'Light Gray',  value: '#e5e7eb', swatch: '#e5e7eb' },
  { label: 'Light Blue',  value: '#bfdbfe', swatch: '#bfdbfe' },
]

const BOX_TITLE_COLORS: Array<{ label: string; value: string; swatch: string }> = [
  { label: 'Purple', value: 'purple', swatch: '#a78bfa' },
  { label: 'Yellow', value: 'yellow', swatch: '#fde047' },
  { label: 'Green',  value: 'green',  swatch: '#4ade80' },
  { label: 'Pink',   value: 'pink',   swatch: '#f9a8d4' },
  { label: 'Blue',   value: 'blue',   swatch: '#60a5fa' },
]

const TEXT_COLORS: Array<{ label: string; value: string | null; swatch: string }> = [
  { label: 'Default',  value: null,      swatch: 'linear-gradient(135deg,rgba(255,255,255,0.55) 0%,rgba(255,255,255,0.20) 100%)' },
  { label: 'Purple',   value: '#a78bfa', swatch: '#a78bfa' },
  { label: 'Blue',     value: '#60a5fa', swatch: '#60a5fa' },
  { label: 'Green',    value: '#4ade80', swatch: '#4ade80' },
  { label: 'Red',      value: '#f87171', swatch: '#f87171' },
  { label: 'Pink',     value: '#f9a8d4', swatch: '#f9a8d4' },
  { label: 'Orange',   value: '#fb923c', swatch: '#fb923c' },
  { label: 'Gray',     value: '#94a3b8', swatch: '#94a3b8' },
  { label: 'White',    value: '#f1f5f9', swatch: '#f1f5f9' },
  { label: 'Black',    value: '#1e293b', swatch: '#1e293b' },
]

function FloatingFormatter({ editor, rect }: { editor: Editor | null; rect: DOMRect }) {
  const [showSize,      setShowSize]      = useState(false)
  const [showColor,     setShowColor]     = useState(false)
  const [showHighlight, setShowHighlight] = useState(false)
  const [showBoxColor,  setShowBoxColor]  = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close sub-menus on outside click
  useEffect(() => {
    if (!showSize && !showColor && !showHighlight && !showBoxColor) return
    function outside(e: MouseEvent) {
      if (ref.current?.contains(e.target as Node)) return
      setShowSize(false)
      setShowColor(false)
      setShowHighlight(false)
      setShowBoxColor(false)
    }
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [showSize, showColor, showHighlight, showBoxColor])

  if (!editor) return null

  const isBold      = editor.isActive('bold')
  const isItalic    = editor.isActive('italic')
  const isUnderline = editor.isActive('underline')
  const isH2        = editor.isActive('heading', { level: 2 })
  const isH3        = editor.isActive('heading', { level: 3 })
  const isBoxTitle  = editor.isActive('boxTitle')
  const sizeLabel   = isH2 ? 'Heading' : isH3 ? 'Large' : 'Normal'

  // Active Box Title color (falls back to the default when no color attr is set,
  // e.g. content saved before colors existed)
  const activeBoxColor: string = (editor.getAttributes('boxTitle').color as string | undefined) ?? BOX_TITLE_DEFAULT_COLOR

  // Active color: what the current selection has (null = default)
  const activeColor: string | null = (editor.getAttributes('textStyle').color as string | undefined) ?? null
  const hasCustomColor = activeColor !== null

  // Active highlight color
  const activeHighlight: string | null = (editor.getAttributes('xpHighlight').color as string | undefined) ?? null
  const hasHighlight = activeHighlight !== null

  const top  = Math.max(8, rect.top - 50)
  const left = rect.left + rect.width / 2

  const fBtn = (active: boolean, extra?: React.CSSProperties): React.CSSProperties => ({
    padding: '3px 8px', borderRadius: 5, border: 'none', cursor: 'pointer',
    background: active ? 'rgba(124,58,237,0.40)' : 'transparent',
    color: active ? '#c4b5fd' : 'rgba(255,255,255,0.82)',
    fontSize: 12, fontWeight: active ? 700 : 500,
    transition: 'background 80ms', ...extra,
  })

  const divider = (
    <div style={{ width: 1, height: 14, background: 'rgba(255,255,255,0.14)', margin: '0 2px', flexShrink: 0 }} />
  )

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed', top, left,
        transform: 'translateX(-50%)',
        zIndex: 9990,
        background: 'rgba(10,6,30,0.97)',
        border: '0.5px solid rgba(124,58,237,0.32)',
        borderRadius: 9, padding: '4px 5px',
        display: 'flex', alignItems: 'center', gap: 2,
        boxShadow: '0 4px 20px rgba(0,0,0,0.65), 0 0 0 0.5px rgba(124,58,237,0.10)',
        backdropFilter: 'blur(8px)',
        userSelect: 'none',
      }}
      onMouseDown={e => e.preventDefault()}
    >
      {/* B */}
      <button style={{ ...fBtn(isBold), fontWeight: 700, minWidth: 26, textAlign: 'center' }}
        onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleBold().run() }}>B</button>

      {/* I */}
      <button style={{ ...fBtn(isItalic), fontStyle: 'italic', minWidth: 26, textAlign: 'center' }}
        onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleItalic().run() }}>I</button>

      {/* U */}
      <button
        style={{ ...fBtn(isUnderline), minWidth: 26, textAlign: 'center', textDecoration: isUnderline ? 'underline' : 'none' }}
        onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleUnderline().run() }}
      >U</button>

      {divider}

      {/* Text Color — A with color dot beneath */}
      <div style={{ position: 'relative' }}>
        <button
          style={{ ...fBtn(hasCustomColor || showColor), minWidth: 26, textAlign: 'center', padding: '3px 6px', position: 'relative' }}
          onMouseDown={e => { e.preventDefault(); setShowColor(v => !v); setShowSize(false); setShowHighlight(false); setShowBoxColor(false) }}
          title="Text color"
        >
          <span style={{ fontSize: 12, fontWeight: 700, lineHeight: 1 }}>A</span>
          <span style={{
            display: 'block', height: 3, borderRadius: 1, marginTop: 1,
            background: activeColor ?? 'linear-gradient(90deg,#f87171,#fb923c,#4ade80,#60a5fa,#a78bfa)',
            width: '100%',
          }} />
        </button>

        {showColor && (
          <div style={{
            position: 'absolute', bottom: 'calc(100% + 6px)', left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(10,6,30,0.98)',
            border: '0.5px solid rgba(124,58,237,0.28)',
            borderRadius: 10, padding: '8px 9px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.65)',
            zIndex: 10, minWidth: 148,
          }}>
            <div style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'rgba(255,255,255,0.35)', marginBottom: 7, userSelect: 'none' }}>
              Text Color
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 5 }}>
              {TEXT_COLORS.map(({ label, value, swatch }) => {
                const isSelected = value === activeColor
                return (
                  <button
                    key={label}
                    title={label}
                    onMouseDown={e => {
                      e.preventDefault()
                      if (value === null) {
                        editor.chain().focus().unsetColor().run()
                      } else {
                        editor.chain().focus().setColor(value).run()
                      }
                      setShowColor(false)
                    }}
                    style={{
                      width: 22, height: 22, borderRadius: 5, border: 'none', cursor: 'pointer', padding: 0,
                      background: swatch,
                      outline: isSelected ? '2px solid #a78bfa' : '1.5px solid rgba(255,255,255,0.12)',
                      outlineOffset: isSelected ? 2 : 0,
                      transition: 'transform 80ms, outline 80ms',
                      transform: 'scale(1)',
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1.18)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)' }}
                  />
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Highlight — H with colored underbar */}
      <div style={{ position: 'relative' }}>
        <button
          style={{ ...fBtn(hasHighlight || showHighlight), minWidth: 26, textAlign: 'center', padding: '3px 6px', position: 'relative' }}
          onMouseDown={e => { e.preventDefault(); setShowHighlight(v => !v); setShowColor(false); setShowSize(false); setShowBoxColor(false) }}
          title="Text highlight"
        >
          <span style={{ fontSize: 12, fontWeight: 700, lineHeight: 1 }}>H</span>
          <span style={{
            display: 'block', height: 3, borderRadius: 1, marginTop: 1,
            background: activeHighlight ?? 'linear-gradient(90deg,#fef08a,#bbf7d0,#bfdbfe,#e9d5ff)',
            width: '100%',
          }} />
        </button>

        {showHighlight && (
          <div style={{
            position: 'absolute', bottom: 'calc(100% + 6px)', left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(10,6,30,0.98)',
            border: '0.5px solid rgba(124,58,237,0.28)',
            borderRadius: 10, padding: '8px 9px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.65)',
            zIndex: 10, minWidth: 152,
          }}>
            <div style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'rgba(255,255,255,0.35)', marginBottom: 7, userSelect: 'none' }}>
              Highlight
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 5 }}>
              {HIGHLIGHT_COLORS.map(({ label, value, swatch }) => {
                const isSelected = value === activeHighlight
                return (
                  <button
                    key={label}
                    title={label}
                    onMouseDown={e => {
                      e.preventDefault()
                      if (value === null) {
                        editor.chain().focus().unsetXpHighlight().run()
                      } else {
                        editor.chain().focus().setXpHighlight(value).run()
                      }
                      setShowHighlight(false)
                    }}
                    style={{
                      width: 22, height: 22, borderRadius: 5, border: 'none', cursor: 'pointer', padding: 0,
                      background: value === null ? 'rgba(255,255,255,0.06)' : swatch,
                      outline: isSelected ? '2px solid #a78bfa' : value === null ? '1.5px solid rgba(255,255,255,0.25)' : '1.5px solid rgba(0,0,0,0.10)',
                      outlineOffset: isSelected ? 2 : 0,
                      transition: 'transform 80ms, outline 80ms',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, color: 'rgba(255,255,255,0.70)',
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1.18)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)' }}
                  >{value === null ? '✕' : ''}</button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {divider}

      {/* Size ▼ */}
      <div style={{ position: 'relative' }}>
        <button
          style={{ ...fBtn(false), display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, whiteSpace: 'nowrap' as const }}
          onMouseDown={e => { e.preventDefault(); setShowSize(v => !v); setShowColor(false); setShowHighlight(false); setShowBoxColor(false) }}
        >
          {sizeLabel} <span style={{ fontSize: 8, opacity: 0.65 }}>▾</span>
        </button>
        {showSize && (
          <div style={{
            position: 'absolute', bottom: 'calc(100% + 5px)', left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(10,6,30,0.97)',
            border: '0.5px solid rgba(124,58,237,0.28)',
            borderRadius: 8, padding: '4px 0',
            boxShadow: '0 4px 16px rgba(0,0,0,0.60)',
            minWidth: 88, zIndex: 10,
          }}>
            {([
              { label: 'Normal',  run: () => editor.chain().focus().setParagraph().run() },
              { label: 'Large',   run: () => editor.chain().focus().toggleHeading({ level: 3 }).run() },
              { label: 'Heading', run: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
            ] as const).map(({ label, run }) => (
              <button key={label}
                onMouseDown={e => { e.preventDefault(); run(); setShowSize(false) }}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '5px 11px', border: 'none',
                  background: label === sizeLabel ? 'rgba(124,58,237,0.18)' : 'transparent',
                  cursor: 'pointer', fontSize: 11,
                  color: label === sizeLabel ? '#c4b5fd' : 'rgba(255,255,255,0.78)',
                  fontWeight: label === sizeLabel ? 600 : 400,
                }}
              >{label}</button>
            ))}
          </div>
        )}
      </div>

      {divider}

      {/* ▣ Box — main click toggles Box Title on (purple default)/off; ▾ opens the
          5-color picker (also usable to apply a non-default color from scratch) */}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <button
          style={{ ...fBtn(isBoxTitle), minWidth: 22, textAlign: 'center', paddingRight: 4 }}
          onMouseDown={e => {
            e.preventDefault()
            if (isBoxTitle) editor.chain().focus().unsetBoxTitle().run()
            else editor.chain().focus().setBoxTitle(BOX_TITLE_DEFAULT_COLOR).run()
          }}
          title="Box Title"
          aria-label="Box Title"
        >▣</button>
        <button
          style={{ ...fBtn(showBoxColor), minWidth: 14, padding: '3px 2px', fontSize: 8 }}
          onMouseDown={e => { e.preventDefault(); setShowBoxColor(v => !v); setShowColor(false); setShowHighlight(false); setShowSize(false) }}
          title="Box Title color"
          aria-label="Box Title color"
        >▾</button>

        {showBoxColor && (
          <div style={{
            position: 'absolute', bottom: 'calc(100% + 6px)', left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(10,6,30,0.98)',
            border: '0.5px solid rgba(124,58,237,0.28)',
            borderRadius: 10, padding: '8px 9px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.65)',
            zIndex: 10, minWidth: 148,
          }}>
            <div style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'rgba(255,255,255,0.35)', marginBottom: 7, userSelect: 'none' }}>
              Box Title Color
            </div>
            <div style={{ display: 'flex', gap: 7 }}>
              {BOX_TITLE_COLORS.map(({ label, value, swatch }) => {
                const isSelected = isBoxTitle && value === activeBoxColor
                return (
                  <button
                    key={value}
                    title={label}
                    aria-label={label}
                    onMouseDown={e => {
                      e.preventDefault()
                      editor.chain().focus().setBoxTitle(value).run()
                      setShowBoxColor(false)
                    }}
                    style={{
                      width: 20, height: 20, borderRadius: '50%', border: 'none', cursor: 'pointer', padding: 0,
                      background: swatch,
                      outline: isSelected ? '2px solid #ffffff' : '1.5px solid rgba(255,255,255,0.15)',
                      outlineOffset: isSelected ? 1 : 0,
                      transition: 'transform 80ms, outline 80ms',
                      transform: 'scale(1)',
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1.18)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)' }}
                  />
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Unsaved-changes confirmation dialog ──────────────────────────────────────

function UnsavedChangesDialog({
  onKeepEditing, onExitWithoutSaving, onSaveAndExit,
}: {
  onKeepEditing: () => void
  onExitWithoutSaving: () => void
  onSaveAndExit: () => void
}) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 99999,
      background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: '#0f0a1e',
        border: '0.5px solid rgba(124,58,237,0.30)',
        borderRadius: 16,
        boxShadow: '0 24px 80px rgba(0,0,0,0.80), 0 0 0 1px rgba(124,58,237,0.08)',
        padding: '28px 32px',
        maxWidth: 380, width: '100%',
        display: 'flex', flexDirection: 'column', gap: 20,
      }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#f1f5f9', marginBottom: 8, letterSpacing: '-0.01em' }}>
            Unsaved changes
          </div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.58)', lineHeight: 1.65 }}>
            You have changes in this journal entry that haven&apos;t been saved yet.
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button
            onClick={onSaveAndExit}
            style={{
              padding: '10px 16px', borderRadius: 9, border: 'none',
              background: 'linear-gradient(135deg, #5b21b6 0%, #7c3aed 100%)',
              color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              transition: 'opacity 120ms, transform 80ms',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.88' }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '1' }}
          >Save &amp; Exit</button>
          <button
            onClick={onExitWithoutSaving}
            style={{
              padding: '10px 16px', borderRadius: 9,
              border: '0.5px solid rgba(239,68,68,0.32)',
              background: 'rgba(239,68,68,0.10)', color: '#fca5a5',
              fontSize: 13, fontWeight: 500, cursor: 'pointer',
              transition: 'all 120ms',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(239,68,68,0.18)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(239,68,68,0.10)' }}
          >Exit Without Saving</button>
          <button
            onClick={onKeepEditing}
            style={{
              padding: '10px 16px', borderRadius: 9,
              border: '0.5px solid rgba(255,255,255,0.10)',
              background: 'transparent', color: 'rgba(255,255,255,0.55)',
              fontSize: 13, fontWeight: 500, cursor: 'pointer',
              transition: 'all 120ms',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.06)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
          >Keep Editing</button>
        </div>
      </div>
    </div>
  )
}

// ─── Shared style helpers ─────────────────────────────────────────────────────

function menuItemStyle(isDark: boolean): React.CSSProperties {
  return {
    display: 'block', width: '100%', textAlign: 'left',
    padding: '7px 14px', border: 'none', background: 'transparent', cursor: 'pointer',
    fontSize: 12, fontWeight: 500,
    color: isDark ? 'rgba(255,255,255,0.82)' : 'rgba(0,0,0,0.72)',
    transition: 'background 100ms',
  }
}

function dockBtn(active = false): React.CSSProperties {
  return {
    padding: '5px 11px', borderRadius: 7, cursor: 'pointer',
    border: `0.5px solid ${active ? 'rgba(124,58,237,0.65)' : 'rgba(255,255,255,0.09)'}`,
    background: active ? 'rgba(124,58,237,0.28)' : 'rgba(255,255,255,0.04)',
    color: active ? '#c4b5fd' : 'rgba(255,255,255,0.60)',
    fontSize: 12, fontWeight: active ? 600 : 400,
    transition: 'all 120ms', flexShrink: 0, whiteSpace: 'nowrap' as const,
  }
}

// ─── Resize system ────────────────────────────────────────────────────────────

type ResizeDir = 'e' | 'w' | 'n' | 's' | 'ne' | 'nw' | 'se' | 'sw'

// 8-direction handles shown on selected media blocks
function ResizeHandles({ onResizeStart }: {
  onResizeStart: (dir: ResizeDir, e: React.MouseEvent) => void
}) {
  const dot: React.CSSProperties = {
    position: 'absolute', width: 8, height: 8, borderRadius: 2,
    background: '#7c3aed', boxShadow: '0 1px 6px rgba(0,0,0,0.38)', zIndex: 15,
  }
  const pill: React.CSSProperties = {
    position: 'absolute', background: '#7c3aed', borderRadius: 2,
    opacity: 0.82, boxShadow: '0 1px 6px rgba(0,0,0,0.35)', zIndex: 15,
  }
  const md = (dir: ResizeDir) => (e: React.MouseEvent) => { e.stopPropagation(); onResizeStart(dir, e) }
  return (
    <>
      {/* Corners */}
      <div onMouseDown={md('nw')} style={{ ...dot, top: -4, left: -4,   cursor: 'nwse-resize' }} />
      <div onMouseDown={md('ne')} style={{ ...dot, top: -4, right: -4,  cursor: 'nesw-resize' }} />
      <div onMouseDown={md('sw')} style={{ ...dot, bottom: -4, left: -4,  cursor: 'nesw-resize' }} />
      <div onMouseDown={md('se')} style={{ ...dot, bottom: -4, right: -4, cursor: 'nwse-resize' }} />
      {/* Edge pills */}
      <div onMouseDown={md('e')} style={{ ...pill, width: 4, height: 28, right: -6, top: '50%', transform: 'translateY(-50%)', cursor: 'ew-resize' }} />
      <div onMouseDown={md('w')} style={{ ...pill, width: 4, height: 28, left: -6,  top: '50%', transform: 'translateY(-50%)', cursor: 'ew-resize' }} />
      <div onMouseDown={md('s')} style={{ ...pill, width: 28, height: 4, bottom: -6, left: '50%', transform: 'translateX(-50%)', cursor: 'ns-resize' }} />
      <div onMouseDown={md('n')} style={{ ...pill, width: 28, height: 4, top: -6,   left: '50%', transform: 'translateX(-50%)', cursor: 'ns-resize' }} />
    </>
  )
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface JournalEditorContentProps {
  dateKey: string
  rawContent: string
  isDark: boolean
  isEditorOnToday: boolean
  onContentChange: (serialized: string) => void
  onPersist: (dateKey: string, serialized: string) => void
  onNavigateDay: (delta: number) => void
  onNavigateToday: () => void
  onBack: () => void
  onClose: () => void
  onJournalCalendar?: () => void
  onLibrary?: () => void
  onEditor?: () => void
  onDirtyChange?: (dirty: boolean) => void
  closeIntent?: 'save' | 'discard' | null
  flushRef?: React.MutableRefObject<(() => void) | null>
  // Legacy props — accepted for backward compat; attachments now live as inline blocks
  attachments?: TaskAttachment[]
  onAttachmentsChange?: (atts: TaskAttachment[]) => void
}

// ─── Main component ───────────────────────────────────────────────────────────

export function JournalEditorContent({
  dateKey, rawContent, isDark, isEditorOnToday,
  onContentChange, onPersist,
  onNavigateDay, onNavigateToday, onBack, onClose,
  onJournalCalendar, onLibrary, onEditor,
  onDirtyChange, closeIntent, flushRef,
}: JournalEditorContentProps) {

  // ── App context (for Task Manager integration) ───────────────────────────────
  const { calData, updateDay, activeTaskTimer, setActiveTaskTimer, setToast } = useApp()

  // ── Transfer Section modal (Move/Copy a section to another date) ─────────────
  const [transferBlockId, setTransferBlockId] = useState<string | null>(null)

  // ── State ───────────────────────────────────────────────────────────────────
  // ── Editor-wide history (mobile undo/redo) ───────────────────────────────────
  type HistoryEntry = { blocks: JournalBlock[]; contents: Record<string, string> }
  const historyStackRef        = useRef<HistoryEntry[]>([])
  const historyPosRef          = useRef<number>(-1)
  const historyTextDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [historyRestoreSeq, setHistoryRestoreSeq] = useState(0)

  const [blocks, setBlocks]             = useState<JournalBlock[]>([])
  const [saveStatus, setSaveStatus]     = useState<'idle' | 'saved'>('idle')
  const [showEmoji, setShowEmoji]       = useState(false)
  const [cameraInsertAt, setCameraInsertAt] = useState<number | null>(null)
  const [focusTick, setFocusTick]       = useState(0)  // triggers dock state update
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
  const [drawState, setDrawState]       = useState<{
    insertAt: number
    editingBlock: JournalBlock | null
    // Set instead of editingBlock when "Edit Mind Map" is opened from an
    // MMC-originated image living inside a section (sectionImage or one of
    // its partitions) rather than a top-level drawing block — saving must
    // write back into that same cell, never create/duplicate a top-level block.
    editingCell?: { blockId: string; which: 'single' | 'p0' | 'p1' }
    // "Edit Mind Map" opened on an ORDINARY (externally pasted/uploaded)
    // image that has no canvasData yet — a synthesized one-object MMC state
    // (that single image, sized/positioned to fit) used ONLY as this
    // session's starting point. editingBlock/editingCell above still say
    // WHERE a save writes back to; nothing is persisted onto the
    // block/cell unless the user actually saves (Cancel/Discard leaves the
    // original plain image completely untouched).
    syntheticInitialObjects?: string
  } | null>(null)
  // Mind Mapping Canvas immersive "Fit" mode — owned here (not inside
  // JournalDrawModal) because only the PARENT can portal {header + canvas}
  // to document.body, which is the only way to escape this Journal modal's
  // own z-index stacking context and actually render above the main mobile
  // bottom nav (a z-index set from inside that stacking context never can,
  // regardless of value — see the portal render below). Reset directly at
  // every place MMC closes (not via a setState-in-effect watching drawState)
  // so a later reopen never starts back in a stale "Restore" state.
  const [mmcFit, setMmcFit] = useState(false)

  // ── Floating formatter state ─────────────────────────────────────────────────
  const [selectionRect, setSelectionRect] = useState<DOMRect | null>(null)

  // ── Document title ────────────────────────────────────────────────────────────
  const [title, setTitle] = useState('')
  const titleRef          = useRef('')

  // ── Dirty / unsaved-changes state ───────────────────────────────────────────
  const [isDirty, setIsDirty]           = useState(false)
  const [showExitDialog, setShowExitDialog] = useState(false)
  const isDirtyRef      = useRef(false)  // fast path — avoids closure staleness
  const savedDocRef     = useRef('')     // doc string at last explicit Save Notes
  const pendingNavRef   = useRef<(() => void) | null>(null)

  // Notify parent when dirty state changes (for global nav guard)
  useEffect(() => {
    onDirtyChange?.(isDirty)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDirty])

  // External close intent from parent nav guard: 'save' or 'discard'
  useEffect(() => {
    if (!closeIntent) return
    if (closeIntent === 'save') {
      if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null }
      const serialized = buildDocStr()
      onPersist(dateKeyRef.current, serialized)
      savedDocRef.current = serialized
      isDirtyRef.current  = false
      setIsDirty(false)
      setShowExitDialog(false)
      onClose()
    } else {
      if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null }
      onPersist(dateKeyRef.current, savedDocRef.current)
      isDirtyRef.current = false
      setIsDirty(false)
      setShowExitDialog(false)
      onClose()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closeIntent])
  const showExitDialogRef = useRef(false)  // for ESC handler stable closure
  const drawStateRef = useRef<typeof drawState>(null)  // lets the capture-phase ESC/Ctrl+S handler know the Mind Mapping Canvas owns the key right now
  // Lets the mobile-only header back arrow (rendered here, outside
  // JournalDrawModal, for Fit-mode portal reasons) trigger that component's
  // OWN unsaved-changes guard instead of unconditionally closing — the exact
  // gap desktop's in-component Cancel button never had.
  const drawModalRef = useRef<JournalDrawModalHandle>(null)

  // ── Journal session timer ────────────────────────────────────────────────────
  const [timerSessions,    setTimerSessions]    = useState<JournalTimerSession[]>([])
  const [timerStartTs,     setTimerStartTs]     = useState<number | null>(null)
  const [timerElapsedMs,   setTimerElapsedMs]   = useState(0)
  const [showSessions,     setShowSessions]     = useState(false)
  const [confirmDeleteIdx, setConfirmDeleteIdx] = useState<number | null>(null)
  const timerSessionsRef  = useRef<JournalTimerSession[]>([])
  const timerIntervalRef  = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastActivityRef   = useRef(Date.now())
  const timerStartTsRef   = useRef<number | null>(null)
  const showSessionsRef   = useRef(false)
  const timerWrapperRef    = useRef<HTMLDivElement>(null)
  const timerBadgeBtnRef   = useRef<HTMLButtonElement>(null)
  const [sessionsPopPos, setSessionsPopPos] = useState<{ left: number; bottom: number } | null>(null)
  // Planner → Task Manager link: persisted in journal doc JSON so it survives remounts
  const plannerTaskLinkRef    = useRef<{ taskId: string; sessionDate: string } | null>(null)
  const plannerTmSessionIdRef = useRef<string | null>(null)
  const toolbarScrollRef   = useRef<HTMLDivElement>(null)
  const [canScrollLeft,  setCanScrollLeft]  = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const [undoRedoTip,    setUndoRedoTip]    = useState<null | 'undo' | 'redo'>(null)
  const undoRedoTipTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Move / resize mode state ─────────────────────────────────────────────────
  const [moveModeId,   setMoveModeId]   = useState<string | null>(null)
  const [resizeModeId, setResizeModeId] = useState<string | null>(null)
  // Mirrors resizeModeId for the mount-time-only global keydown handler below
  // (Delete/Backspace while a top-level image/drawing is selected).
  const resizeModeIdRef = useRef<string | null>(null)
  useEffect(() => { resizeModeIdRef.current = resizeModeId }, [resizeModeId])
  // dragPos: non-null while mouse is held down during a move drag
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null)
  const [dropIdx,  setDropIdx]  = useState(0)
  const [snapGuides, setSnapGuides] = useState<
    Array<{ type: 'v' | 'h'; coord: number; from: number; to: number }>
  >([])
  // Set only while dragging an image/drawing block over a DIFFERENT section —
  // every other block type's drag behavior (dropIdx/snapGuides above) is
  // completely unaffected by this. Mirrored into a ref because the drag's
  // document-level mouseup handler closes over state from drag-start time
  // (same reason dragMoveRef exists instead of reading dragPos state there).
  const [dropTargetSectionId, setDropTargetSectionIdState] = useState<string | null>(null)
  const dropTargetSectionIdRef = useRef<string | null>(null)
  function setDropTargetSectionId(id: string | null) {
    dropTargetSectionIdRef.current = id
    setDropTargetSectionIdState(id)
  }
  // Ref holds drag metadata without triggering extra re-renders
  const dragMoveRef = useRef<{
    blockId: string
    offsetX: number; offsetY: number
    blockW: number;  blockH: number
  } | null>(null)
  // Set right when a direct image press-drag ends in an actual move, so the
  // click event the browser still fires afterward doesn't also re-trigger
  // select-for-resize on the same image.
  const suppressImageClickRef = useRef(false)

  // ── Voice-to-notes state ────────────────────────────────────────────────────
  const [isRecording, setIsRecording] = useState(false)
  const [voiceError,  setVoiceError]  = useState<string | null>(null)
  const isRecordingRef     = useRef(false)
  const recognitionRef     = useRef<any>(null)
  // The section editor focused WHEN Mic was pressed — stays the dictation
  // target for the whole session even though clicking the Mic button itself
  // moves DOM focus away from that section.
  const micTargetEditorRef = useRef<Editor | null>(null)
  const silenceTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Refs ────────────────────────────────────────────────────────────────────
  const contentMapRef   = useRef<Map<string, string>>(new Map())
  const blocksRef       = useRef<JournalBlock[]>([])
  const focusedEditor   = useRef<Editor | null>(null)
  const saveTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dateKeyRef      = useRef(dateKey)
  const emojiBtnRef     = useRef<HTMLButtonElement>(null)
  const blockListRef    = useRef<HTMLDivElement>(null)
  const onBackRef       = useRef(onBack)  // stable ref for ESC capture handler

  dateKeyRef.current        = dateKey
  onBackRef.current         = onBack
  showExitDialogRef.current = showExitDialog
  showSessionsRef.current   = showSessions
  drawStateRef.current      = drawState

  // Keep blocksRef in sync with blocks state
  useEffect(() => { blocksRef.current = blocks }, [blocks])

  // ── Toolbar scroll arrows ────────────────────────────────────────────────────
  const updateScrollArrows = useCallback(() => {
    const el = toolbarScrollRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 2)
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2)
  }, [])

  useEffect(() => {
    const el = toolbarScrollRef.current
    if (!el) return
    updateScrollArrows()
    const ro = new ResizeObserver(updateScrollArrows)
    ro.observe(el)
    return () => ro.disconnect()
  }, [updateScrollArrows])

  // ── Unmount cleanup — stop voice recording ──────────────────────────────────
  useEffect(() => () => { stopVoiceSession() }, [])

  // ── Unmount cleanup — close any open Task Manager session ────────────────────
  useEffect(() => {
    return () => {
      const tmSessionId = plannerTmSessionIdRef.current
      const link = plannerTaskLinkRef.current
      if (!tmSessionId || !link) return
      const endNow = Date.now()
      updateDay(link.sessionDate, prev => ({
        ...prev,
        tasks: (prev.tasks ?? []).map(t =>
          t.id !== link.taskId ? t : {
            ...t, timerEnd: endNow,
            sessions: (t.sessions ?? []).map(s => s.id === tmSessionId ? { ...s, endTs: endNow } : s),
          }
        ),
      }))
    }
  }, [updateDay])

  // ── Init / date change ───────────────────────────────────────────────────────
  useEffect(() => {
    // Stop any active voice recording when navigating to a new date
    stopVoiceSession()
    setVoiceError(null)

    const doc = parseJournalDoc(rawContent)
    const initialBlocks = doc.blocks.length > 0 ? doc.blocks : [createSectionBlock('lavender')]
    setBlocks(initialBlocks)
    blocksRef.current = initialBlocks
    contentMapRef.current.clear()
    initialBlocks.forEach(b => {
      if ((b.type === 'text' || b.type === 'section') && b.content) {
        contentMapRef.current.set(b.id, b.content)
      }
    })
    // Initialize editor-wide history for this entry
    historyStackRef.current = []
    historyPosRef.current = -1
    if (historyTextDebounceRef.current) { clearTimeout(historyTextDebounceRef.current); historyTextDebounceRef.current = null }
    // Load timer sessions for this date
    const sessions = doc.timerSessions ?? []
    setTimerSessions(sessions)
    timerSessionsRef.current = sessions
    // Stop any running timer from previous date — also close its Task Manager session
    if (timerIntervalRef.current) { clearInterval(timerIntervalRef.current); timerIntervalRef.current = null }
    if (timerStartTsRef.current && plannerTmSessionIdRef.current && plannerTaskLinkRef.current) {
      const closeEndTs = Date.now()
      const { taskId, sessionDate } = plannerTaskLinkRef.current
      const closingId = plannerTmSessionIdRef.current
      updateDay(sessionDate, prev => ({
        ...prev,
        tasks: (prev.tasks ?? []).map(t =>
          t.id !== taskId ? t : {
            ...t, timerEnd: closeEndTs,
            sessions: (t.sessions ?? []).map(s => s.id === closingId ? { ...s, endTs: closeEndTs } : s),
          }
        ),
      }))
    }
    setTimerStartTs(null)
    timerStartTsRef.current = null
    setTimerElapsedMs(0)
    // Read/reset Planner → TM link for the new document
    try {
      const rawDoc = JSON.parse(rawContent ?? '{}')
      plannerTaskLinkRef.current = rawDoc?.plannerTaskLink ?? null
    } catch { plannerTaskLinkRef.current = null }
    plannerTmSessionIdRef.current = null
    setShowSessions(false)
    setDrawState(null)
    setMmcFit(false)
    setSelectedBlockId(null)
    setShowEmoji(false)
    setSaveStatus('idle')
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null }
    titleRef.current      = doc.title ?? ''
    setTitle(doc.title ?? '')
    savedDocRef.current   = rawContent ?? ''
    isDirtyRef.current    = false
    setIsDirty(false)
    setShowExitDialog(false)
    pendingNavRef.current = null
    pushHistoryRef.current(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateKey])

  // ── Doc serialization ───────────────────────────────────────────────────────
  const buildDocStr = useCallback((): string => {
    const sessions = timerSessionsRef.current
    const doc = {
      v: 1 as const,
      ...(titleRef.current ? { title: titleRef.current } : {}),
      blocks: blocksRef.current.map(b => ({
        ...b,
        content: (b.type === 'text' || b.type === 'section')
          ? (contentMapRef.current.get(b.id) ?? b.content ?? '')
          : b.content,
      })),
      ...(sessions.length > 0 ? { timerSessions: sessions } : {}),
      ...(plannerTaskLinkRef.current ? { plannerTaskLink: plannerTaskLinkRef.current } : {}),
    }
    return JSON.stringify(doc)
  }, [])

  // ── Autosave scheduler ──────────────────────────────────────────────────────
  // Autosave writes to DB for safety but does NOT clear isDirty.
  // Only an explicit "Save Notes" (handleManualSave) clears the dirty flag.
  // This ensures the unsaved-changes dialog always shows when real changes exist.
  const scheduleSave = useCallback(() => {
    if (!isDirtyRef.current) { isDirtyRef.current = true; setIsDirty(true) }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      const serialized = buildDocStr()
      onPersist(dateKeyRef.current, serialized)
      // Show brief "Saved" indicator but keep dirty — explicit Save Notes resets baseline
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus(s => s === 'saved' ? 'idle' : s), 2200)
      saveTimerRef.current = null
    }, 1500)
  }, [buildDocStr, onPersist])

  // ── Imperative flush: cancel pending autosave and persist immediately ────────
  // Updated each render so the closure always reads latest refs.
  const flushFnRef = useRef<() => void>(() => {})
  flushFnRef.current = () => {
    if (!saveTimerRef.current) return
    clearTimeout(saveTimerRef.current)
    saveTimerRef.current = null
    onPersist(dateKeyRef.current, buildDocStr())
  }
  // Expose to parent (for modal close) and to pagehide (for tab close).
  if (flushRef) flushRef.current = flushFnRef.current
  useEffect(() => {
    const flush = () => flushFnRef.current()
    const onVis = () => { if (document.visibilityState === 'hidden') flush() }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVis)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Mobile/tablet-only: tapping a task checkbox must not jump the viewport ──
  // The checkbox lives inside a contentEditable region; on touch-primary
  // browsers, the mousedown a tap synthesizes can make the browser try to
  // focus/place a text cursor at that point BEFORE the checkbox's own toggle
  // runs, and scroll to "reveal" that cursor elsewhere in a long document —
  // desktop never shows this because a real mouse click doesn't trigger that
  // same focus-seeking scroll behavior. preventDefault on the checkbox's own
  // mousedown blocks only that focus/selection side effect — a checkbox still
  // toggles via its `click`/`change` event regardless of mousedown being
  // prevented, so the existing check/uncheck behavior is unaffected. Gated
  // entirely behind a (pointer: coarse) match (true only for touch-primary
  // devices), so this listener is never even attached on desktop.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia('(pointer: coarse)').matches) return
    function onMouseDown(e: MouseEvent) {
      const t = e.target as HTMLElement | null
      if (t?.tagName === 'INPUT' && t.getAttribute('type') === 'checkbox' && t.closest('.xp-j-prose')) {
        e.preventDefault()
      }
    }
    document.addEventListener('mousedown', onMouseDown, true)
    return () => document.removeEventListener('mousedown', onMouseDown, true)
  }, [])

  // ── Block content change ────────────────────────────────────────────────────
  const pushHistoryRef = useRef<(immediate?: boolean) => void>(() => {})
  const onBlockContentChange = useCallback((id: string, content: string) => {
    contentMapRef.current.set(id, content)
    onContentChange(buildDocStr())
    scheduleSave()
    pushHistoryRef.current()
  }, [buildDocStr, onContentChange, scheduleSave])

  // ── Editor focus tracking ───────────────────────────────────────────────────
  const onEditorFocus = useCallback((editor: Editor) => {
    focusedEditor.current = editor
    setFocusTick(t => t + 1)
  }, [])

  const onEditorSelectionUpdate = useCallback(() => {
    setFocusTick(t => t + 1)
    const ed = focusedEditor.current
    if (!ed || ed.state.selection.empty) { setSelectionRect(null); return }
    try {
      const sel = window.getSelection()
      if (sel && sel.rangeCount > 0) {
        const r = sel.getRangeAt(0).getBoundingClientRect()
        setSelectionRect(r.width > 0 || r.height > 0 ? r : null)
      }
    } catch { setSelectionRect(null) }
  }, [])

  const isActive = (name: string, attrs?: Record<string, unknown>) => focusedEditor.current?.isActive(name, attrs) ?? false
  const isSubItem = () => {
    const ed = focusedEditor.current
    if (!ed) return false
    return ed.isActive('listItem', { subItem: true }) || ed.isActive('taskItem', { subItem: true })
  }
  // focusTick is consumed by the isActive call above — just reference it to avoid lint warning
  void focusTick

  // ── Manual save ─────────────────────────────────────────────────────────────
  function handleManualSave() {
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null }
    const serialized = buildDocStr()
    onPersist(dateKeyRef.current, serialized)
    savedDocRef.current = serialized
    isDirtyRef.current  = false
    setIsDirty(false)
    setSaveStatus('saved')
    setTimeout(() => setSaveStatus(s => s === 'saved' ? 'idle' : s), 2200)
  }

  // ── Unsaved-changes guard ────────────────────────────────────────────────────
  function guardedNavigate(action: () => void) {
    if (!isDirtyRef.current) { action(); return }
    pendingNavRef.current = action
    setShowExitDialog(true)
  }

  function commitExitWithoutSaving() {
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null }
    // Restore DB to last explicitly-saved baseline (undoes any autosaves since last Save Notes)
    onPersist(dateKeyRef.current, savedDocRef.current)
    // Reset in-memory state to match the restored content
    const doc = parseJournalDoc(savedDocRef.current)
    const restoredBlocks = doc.blocks.length > 0 ? doc.blocks : [createTextBlock()]
    contentMapRef.current.clear()
    restoredBlocks.forEach(b => {
      if ((b.type === 'text' || b.type === 'section') && b.content) {
        contentMapRef.current.set(b.id, b.content)
      }
    })
    blocksRef.current = restoredBlocks
    setBlocks(restoredBlocks)
    // Restore timer sessions
    setTimerSessions(doc.timerSessions ?? [])
    timerSessionsRef.current = doc.timerSessions ?? []
    isDirtyRef.current = false
    setIsDirty(false)
    setShowExitDialog(false)
    const action = pendingNavRef.current
    pendingNavRef.current = null
    action?.()
  }

  function commitSaveAndExit() {
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null }
    const serialized = buildDocStr()
    onPersist(dateKeyRef.current, serialized)
    savedDocRef.current = serialized
    isDirtyRef.current  = false
    setIsDirty(false)
    setSaveStatus('saved')
    setTimeout(() => setSaveStatus(s => s === 'saved' ? 'idle' : s), 2200)
    setShowExitDialog(false)
    const action = pendingNavRef.current
    pendingNavRef.current = null
    action?.()
  }

  // ── Block structural operations ─────────────────────────────────────────────
  // IMPORTANT: always update blocksRef.current BEFORE calling buildDocStr()

  function insertBlock(block: JournalBlock, atIndex: number) {
    const next = [...blocksRef.current]
    next.splice(atIndex + 1, 0, block)
    blocksRef.current = next
    setBlocks(next)
    onContentChange(buildDocStr())
    scheduleSave()
    pushHistory(true)
  }

  function deleteBlock(id: string) {
    contentMapRef.current.delete(id)
    const filtered = blocksRef.current.filter(b => b.id !== id)
    const next = filtered.length > 0 ? filtered : [createSectionBlock('lavender')]
    blocksRef.current = next
    setBlocks(next)
    onContentChange(buildDocStr())
    scheduleSave()
    pushHistory(true)
  }

  function moveBlock(id: string, delta: -1 | 1) {
    const current = blocksRef.current
    const idx = current.findIndex(b => b.id === id)
    if (idx < 0) return
    const newIdx = idx + delta
    if (newIdx < 0 || newIdx >= current.length) return
    const next = [...current]
    next[idx]    = { ...next[idx],    content: contentMapRef.current.get(next[idx].id)    ?? next[idx].content    ?? '' }
    next[newIdx] = { ...next[newIdx], content: contentMapRef.current.get(next[newIdx].id) ?? next[newIdx].content ?? '' }
    ;[next[idx], next[newIdx]] = [next[newIdx], next[idx]]
    blocksRef.current = next
    setBlocks(next)
    onContentChange(buildDocStr())
    scheduleSave()
    pushHistory(true)
  }

  // Duplicate: new id + fresh timestamps, everything else copied by value (content
  // is a JSON string, so the copy can never share mutable state with the original).
  // Inserting right after the original and letting the existing CSS Grid auto-flow
  // place it is what gives "beside if there's room, otherwise below" for free — no
  // custom collision math needed, and on mobile the grid already collapses to a
  // single stacked column, so the duplicate always lands below there too.
  function duplicateBlock(id: string) {
    const idx = blocksRef.current.findIndex(b => b.id === id)
    if (idx < 0) return
    const original = blocksRef.current[idx]
    const liveContent = contentMapRef.current.get(id) ?? original.content ?? ''
    const ts = Date.now()
    const copy: JournalBlock = { ...original, id: mkId(), content: liveContent, createdAt: ts, updatedAt: ts }
    contentMapRef.current.set(copy.id, liveContent)
    insertBlock(copy, idx)
  }

  // Appends an independent copy of `block` (with `liveContent` merged in) onto
  // another date's Planner/Journal doc — used by both Move and Copy below.
  // Reads/writes calData[destKey].notes directly via updateDay (the actual
  // field the editor loads/persists — see JournalWorkspaceModal's
  // rawContent={calData[editorDate]?.notes} and persistEntry), exactly like
  // every other cross-date write in this file (e.g. syncStartToTaskManager),
  // since the destination date's editor isn't mounted here.
  function appendBlockToDay(destKey: string, block: JournalBlock) {
    const destDoc = parseJournalDoc(calData[destKey]?.notes)
    const newDoc = { ...destDoc, blocks: [...destDoc.blocks, block] }
    updateDay(destKey, prev => ({ ...prev, notes: serializeJournalDoc(newDoc) }))
  }

  // Transfer: Move relocates the exact same section (same id, unchanged
  // content/color/title — a true move, so deleteBlock's existing safe-removal
  // fallback runs on the origin). Copy leaves the origin completely untouched
  // and appends a fresh-id independent copy (mirrors duplicateBlock's pattern)
  // — completion states are preserved exactly, never reset. The destination
  // write (appendBlockToDay) always runs and completes its local state update
  // before deleteBlock removes the origin, so Move never drops content into a
  // gap between the two.
  function transferSection(mode: 'move' | 'copy', id: string, destKey: string) {
    const block = blocksRef.current.find(b => b.id === id)
    if (!block) return
    const liveContent = contentMapRef.current.get(id) ?? block.content ?? ''
    const ts = Date.now()
    const destLabel = fmtTransferDate(destKey)

    if (mode === 'copy') {
      const copy: JournalBlock = { ...block, id: mkId(), content: liveContent, createdAt: ts, updatedAt: ts }
      appendBlockToDay(destKey, copy)
      setToast(`Section copied to ${destLabel} ✓`)
    } else {
      const moved: JournalBlock = { ...block, content: liveContent, updatedAt: ts }
      appendBlockToDay(destKey, moved)
      deleteBlock(id)
      setToast(`Section moved to ${destLabel} ✓`)
    }
  }

  function updateBlock(id: string, updates: Partial<JournalBlock>) {
    const next = blocksRef.current.map(b => b.id === id ? { ...b, ...updates, updatedAt: Date.now() } : b)
    blocksRef.current = next
    setBlocks(next)
    onContentChange(buildDocStr())
    scheduleSave()
    pushHistory(true)
  }

  function setBlockWidth(id: string, width: number) {
    const next = blocksRef.current.map(b => b.id === id ? { ...b, width } : b)
    blocksRef.current = next
    setBlocks(next)
    onContentChange(buildDocStr())
    scheduleSave()
  }

  // ── Editor-wide history helpers ──────────────────────────────────────────────

  function captureHistoryState(): HistoryEntry {
    const contents: Record<string, string> = {}
    blocksRef.current.forEach(b => {
      if (b.type === 'text' || b.type === 'section') {
        contents[b.id] = contentMapRef.current.get(b.id) ?? ''
      }
    })
    return { blocks: blocksRef.current.map(b => ({ ...b })), contents }
  }

  function pushHistory(immediate?: boolean) {
    if (historyTextDebounceRef.current) {
      clearTimeout(historyTextDebounceRef.current)
      historyTextDebounceRef.current = null
    }
    const doPush = () => {
      historyStackRef.current = historyStackRef.current.slice(0, historyPosRef.current + 1)
      historyStackRef.current.push(captureHistoryState())
      if (historyStackRef.current.length > 50) historyStackRef.current.shift()
      historyPosRef.current = historyStackRef.current.length - 1
    }
    if (immediate) doPush()
    else historyTextDebounceRef.current = setTimeout(doPush, 800)
  }

  function customUndo() {
    if (historyTextDebounceRef.current) {
      clearTimeout(historyTextDebounceRef.current)
      historyTextDebounceRef.current = null
    }
    if (historyPosRef.current <= 0) return
    historyPosRef.current -= 1
    const entry = historyStackRef.current[historyPosRef.current]
    if (!entry) return
    contentMapRef.current = new Map(Object.entries(entry.contents))
    const restored = entry.blocks.map(b => ({ ...b }))
    blocksRef.current = restored
    setBlocks(restored)
    setHistoryRestoreSeq(s => s + 1)
  }

  function customRedo() {
    if (historyPosRef.current >= historyStackRef.current.length - 1) return
    historyPosRef.current += 1
    const entry = historyStackRef.current[historyPosRef.current]
    if (!entry) return
    contentMapRef.current = new Map(Object.entries(entry.contents))
    const restored = entry.blocks.map(b => ({ ...b }))
    blocksRef.current = restored
    setBlocks(restored)
    setHistoryRestoreSeq(s => s + 1)
  }

  pushHistoryRef.current = pushHistory

  // 8-direction drag-to-resize — handles width %, height px, and aspect-constrained corners
  function startBlockResize(blockId: string, dir: ResizeDir, e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    const container = blockListRef.current
    if (!container) return

    // Snapshot DOM state at drag start
    const blockEl = container.querySelector(`[data-block-id="${blockId}"]`) as HTMLElement | null
    const imgEl   = blockEl?.querySelector('img') as HTMLImageElement | null
    const containerW   = container.offsetWidth
    const startHeightPx = blockEl?.offsetHeight ?? 200
    const naturalAspect = (imgEl && imgEl.naturalWidth && imgEl.naturalHeight)
      ? imgEl.naturalWidth / imgEl.naturalHeight
      : 0

    const block = blocksRef.current.find(b => b.id === blockId)
    if (!block) return
    const startWidthPct = block.width ?? 100
    const startX = e.clientX
    const startY = e.clientY

    const isW      = dir === 'w' || dir === 'nw' || dir === 'sw'
    const isN      = dir === 'n' || dir === 'ne' || dir === 'nw'
    const isHoriz  = dir !== 'n' && dir !== 's'
    const isVert   = dir !== 'e' && dir !== 'w'
    const isCorner = dir === 'ne' || dir === 'nw' || dir === 'se' || dir === 'sw'

    const SNAP_POINTS = [25, 33, 50, 66, 75, 100]
    const SNAP_THRESHOLD = 5
    const MIN_W = 15
    const MAX_W = 100
    const MIN_H = block.type === 'section' ? 80 : 60

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY

      let newWidthPct = startWidthPct
      let newHeightPx: number | undefined = block.height ?? undefined

      if (isHoriz) {
        let w = startWidthPct + (isW ? -1 : 1) * (dx / containerW) * 100
        const nearest = SNAP_POINTS.reduce((b, p) => Math.abs(p - w) < Math.abs(b - w) ? p : b)
        if (Math.abs(nearest - w) <= SNAP_THRESHOLD) w = nearest
        newWidthPct = Math.max(MIN_W, Math.min(MAX_W, Math.round(w)))
      }

      if (isVert) {
        if (isCorner && naturalAspect > 0) {
          // Preserve natural aspect ratio on corners
          const newWidthPx = (newWidthPct / 100) * containerW
          newHeightPx = Math.max(MIN_H, Math.round(newWidthPx / naturalAspect))
        } else {
          newHeightPx = Math.max(MIN_H, Math.round(startHeightPx + (isN ? -1 : 1) * dy))
        }
      }

      const next = blocksRef.current.map(b =>
        b.id === blockId ? { ...b, width: newWidthPct, height: newHeightPx } : b
      )
      blocksRef.current = next
      setBlocks(next)
    }

    const onUp = () => {
      onContentChange(buildDocStr())
      scheduleSave()
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  // Upload via bottom toolbar (appends to end)
  async function handleUploadAtEnd(files: FileList | File[] | null, isCamera = false) {
    if (!files || files.length === 0) return
    const arr = Array.isArray(files) ? files : Array.from(files)
    const atts = await buildAttachments(arr, isCamera ? 'camera' : 'upload')
    const newBlocks = atts.map(att => createImageBlock(att.url, att.name))
    const next = [...blocksRef.current, ...newBlocks]
    blocksRef.current = next
    setBlocks(next)
    onContentChange(buildDocStr())
    scheduleSave()
  }

  // ── Section image paste/drop + Split/Merge Section ──────────────────────────
  // Shared by paste (Ctrl+V inside a section), upload/drop, and MMC drag-drop —
  // one insertion path, per the "don't build separate image systems" mandate.

  function loadImageNaturalSize(src: string): Promise<{ w: number; h: number }> {
    return new Promise(resolve => {
      const im = new Image()
      im.onload  = () => resolve({ w: im.naturalWidth || 0, h: im.naturalHeight || 0 })
      im.onerror = () => resolve({ w: 0, h: 0 })
      im.src = src
    })
  }

  // Percent-of-available-width sizing: never upscale past the image's own
  // natural width, cap at 85% of the box so it never overwhelms the cell.
  function computeIntelligentCellWidth(naturalW: number, _naturalH: number, availableW: number): number {
    if (!naturalW || !availableW) return 100
    const capped = Math.min(naturalW, availableW * 0.85)
    return Math.max(20, Math.min(100, Math.round((capped / availableW) * 100)))
  }

  async function insertImageIntoSection(
    blockId: string,
    img: { src: string; name: string; canvasData?: string },
    preferredSide?: 'left' | 'right',
  ) {
    const block = blocksRef.current.find(b => b.id === blockId)
    if (!block || block.type !== 'section') return

    const sectionEl = blockListRef.current?.querySelector(`[data-block-id="${blockId}"]`) as HTMLElement | null
    const sectionW = sectionEl?.offsetWidth ?? 400
    const { w: naturalW, h: naturalH } = await loadImageNaturalSize(img.src)

    // Re-read in case the block changed while the image was loading (e.g. the
    // user kept typing, or split/merged the section before this resolved).
    const latest = blocksRef.current.find(b => b.id === blockId)
    if (!latest) return

    if (latest.partitions) {
      const side = preferredSide === 'right' ? 1 : 0
      const availableW = sectionW * ((latest.partitionSplit ?? 50) / 100)
      const cell: SectionCell = { ...mkImageCell(img.src, img.name, img.canvasData), width: computeIntelligentCellWidth(naturalW, naturalH, availableW) }
      const nextPartitions = [...latest.partitions] as [SectionCell, SectionCell]
      nextPartitions[side] = cell
      updateBlock(blockId, { partitions: nextPartitions })
    } else if (isSectionEmpty(latest)) {
      // Completely empty section: insert directly, never force a split.
      updateBlock(blockId, {
        sectionImage: { ...mkImageCell(img.src, img.name, img.canvasData), width: computeIntelligentCellWidth(naturalW, naturalH, sectionW) },
        content: '',
      })
    } else {
      // Has existing content: auto-split, exactly like manual "Split Section".
      const existingCell = latest.sectionImage ?? mkContentCell(latest.content ?? '')
      const newCell: SectionCell = { ...mkImageCell(img.src, img.name, img.canvasData), width: computeIntelligentCellWidth(naturalW, naturalH, sectionW / 2) }
      const partitions: [SectionCell, SectionCell] = preferredSide === 'left' ? [newCell, existingCell] : [existingCell, newCell]
      updateBlock(blockId, { partitions, partitionSplit: 50, content: '', sectionImage: undefined })
    }
  }

  async function handlePasteImageIntoSection(blockId: string, file: File) {
    const att = await buildAttachment(file, 'upload')
    await insertImageIntoSection(blockId, { src: att.url, name: att.name })
  }

  function handleSplitSection(blockId: string) {
    const block = blocksRef.current.find(b => b.id === blockId)
    if (!block || block.partitions) return
    const currentCell: SectionCell = block.sectionImage ?? mkContentCell(block.content ?? '')
    updateBlock(blockId, {
      partitions: [currentCell, mkContentCell('')],
      partitionSplit: 50,
      content: '',
      sectionImage: undefined,
    })
  }

  // Deletes only the image — a split section's layout (both panes, divider)
  // stays intact; the vacated pane becomes an empty content cell rather than
  // auto-merging (the user can still Merge Section manually if they want to).
  function handleDeleteImageCell(blockId: string, which: 'single' | 'p0' | 'p1') {
    const block = blocksRef.current.find(b => b.id === blockId)
    if (!block) return
    if (which === 'single') {
      if (!block.sectionImage) return
      updateBlock(blockId, { sectionImage: undefined })
    } else if (block.partitions) {
      const idx = which === 'p0' ? 0 : 1
      const parts = [...block.partitions] as [SectionCell, SectionCell]
      parts[idx] = mkContentCell('')
      updateBlock(blockId, { partitions: parts })
    }
  }

  // Reads one section's image cell by its {blockId, which} address — shared by
  // the "Edit Mind Map" menu action below and the JournalDrawModal props that
  // need to show/save into it.
  function getSectionImageCell(blockId: string, which: 'single' | 'p0' | 'p1'): SectionCell | undefined {
    const block = blocksRef.current.find(b => b.id === blockId)
    if (!block) return undefined
    if (which === 'single') return block.sectionImage
    return which === 'p0' ? block.partitions?.[0] : block.partitions?.[1]
  }

  // Fits an image's natural size into a sensible default MMC working area,
  // preserving aspect ratio and centering it — used only to seed the ONE
  // starting image-object for an ordinary image's first "Edit Mind Map" (see
  // openEditMindMapForImage/openEditMindMapForCell below). Matches the same
  // fallback canvas size JournalDrawModal itself assumes before its own
  // canvas has mounted.
  function fitImageToMmcCanvas(naturalW: number, naturalH: number): { x: number; y: number; w: number; h: number } {
    const CANVAS_W = 720, CANVAS_H = 480
    const maxW = CANVAS_W * 0.8, maxH = CANVAS_H * 0.8
    let w = naturalW || maxW, h = naturalH || maxH
    const scale = Math.min(1, maxW / (w || 1), maxH / (h || 1))
    w *= scale; h *= scale
    return { x: (CANVAS_W - w) / 2, y: (CANVAS_H - h) / 2, w, h }
  }

  // Opens the Mind Mapping Canvas against the ACTUAL underlying drawing an
  // MMC-originated section/partition image still carries (cell.canvasData).
  // An ORDINARY image (no canvasData yet — externally pasted/uploaded)
  // instead opens with a synthesized one-object starting state: that same
  // image, sized to fit, as a real, editable MMC image object — reusing the
  // existing image-object type/rendering/persistence rather than the
  // separate flattened-background fallback, so saving naturally carries the
  // base image forward inside canvasData (see handleDrawSave's editingCell
  // branch, unchanged) instead of losing it. Nothing is written back onto
  // the cell until the user actually saves — Cancel/Discard leaves an
  // ordinary image completely untouched.
  async function openEditMindMapForCell(blockId: string, which: 'single' | 'p0' | 'p1') {
    const idx = blocksRef.current.findIndex(b => b.id === blockId)
    if (idx < 0) return
    const cell = getSectionImageCell(blockId, which)
    if (cell?.canvasData || !cell?.src) {
      setDrawState({ insertAt: idx, editingBlock: null, editingCell: { blockId, which } })
      return
    }
    const { w: naturalW, h: naturalH } = await loadImageNaturalSize(cell.src)
    const rect = fitImageToMmcCanvas(naturalW, naturalH)
    const synthetic = JSON.stringify([{ id: `img-${Date.now()}`, type: 'image', src: cell.src, ...rect }])
    setDrawState({ insertAt: idx, editingBlock: null, editingCell: { blockId, which }, syntheticInitialObjects: synthetic })
  }

  // Same idea as openEditMindMapForCell above, for a top-level image/drawing
  // block — see that function's comment for the full reasoning.
  async function openEditMindMapForImage(blockId: string) {
    const idx = blocksRef.current.findIndex(b => b.id === blockId)
    if (idx < 0) return
    const block = blocksRef.current[idx]
    if (block.canvasData || !block.src) {
      setDrawState({ insertAt: idx, editingBlock: block })
      return
    }
    const { w: naturalW, h: naturalH } = await loadImageNaturalSize(block.src)
    const rect = fitImageToMmcCanvas(naturalW, naturalH)
    const synthetic = JSON.stringify([{ id: `img-${Date.now()}`, type: 'image', src: block.src, ...rect }])
    setDrawState({ insertAt: idx, editingBlock: block, syntheticInitialObjects: synthetic })
  }

  // Never deletes content: text sides concatenate, image sides get ejected as
  // new adjacent top-level blocks (reusing createImageBlock/createDrawingBlock)
  // rather than being discarded.
  function handleMergeSection(blockId: string) {
    const idx = blocksRef.current.findIndex(b => b.id === blockId)
    const block = blocksRef.current[idx]
    if (!block || !block.partitions) return
    const [a, b] = block.partitions
    const eject = (cell: SectionCell) => cell.canvasData
      ? createDrawingBlock(cell.src ?? '', cell.name ?? 'Image', cell.canvasData)
      : createImageBlock(cell.src ?? '', cell.name ?? 'Image')

    let mergedContent = ''
    const toInsert: JournalBlock[] = []
    if (a.kind === 'content' && b.kind === 'content') {
      mergedContent = mergeTiptapContents(a.content ?? '', b.content ?? '')
    } else if (a.kind === 'content') {
      mergedContent = a.content ?? ''
      toInsert.push(eject(b))
    } else if (b.kind === 'content') {
      mergedContent = b.content ?? ''
      toInsert.push(eject(a))
    } else {
      toInsert.push(eject(a), eject(b))
    }

    const merged: JournalBlock = {
      ...block, content: mergedContent, partitions: undefined, partitionSplit: undefined, sectionImage: undefined, updatedAt: Date.now(),
    }
    const next = [...blocksRef.current]
    next[idx] = merged
    if (toInsert.length > 0) next.splice(idx + 1, 0, ...toInsert)
    blocksRef.current = next
    setBlocks(next)
    onContentChange(buildDocStr())
    scheduleSave()
    pushHistory(true)
  }

  // Cell-level resize — a direct copy of startBlockResize's percent-width math,
  // scoped to one cell's own box (data-cell-id) instead of the whole grid block.
  function startCellResize(blockId: string, which: 'single' | 'p0' | 'p1', dir: ResizeDir, e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    const cellEl = blockListRef.current?.querySelector(`[data-cell-id="${blockId}:${which}"]`) as HTMLElement | null
    if (!cellEl) return
    const containerW = cellEl.offsetWidth
    const block = blocksRef.current.find(b => b.id === blockId)
    if (!block) return
    const getCell = (b: JournalBlock): SectionCell | undefined =>
      which === 'single' ? b.sectionImage : (which === 'p0' ? b.partitions?.[0] : b.partitions?.[1])
    const cell = getCell(block)
    if (!cell) return

    const startWidthPct = cell.width ?? 100
    const startX = e.clientX
    const isW = dir === 'w' || dir === 'nw' || dir === 'sw'
    const isHoriz = dir !== 'n' && dir !== 's'
    const MIN_W = 10
    const MAX_W = 100

    const onMove = (ev: MouseEvent) => {
      if (!isHoriz) return
      const dx = ev.clientX - startX
      const w = Math.max(MIN_W, Math.min(MAX_W, Math.round(startWidthPct + (isW ? -1 : 1) * (dx / containerW) * 100)))
      const next = blocksRef.current.map(b => {
        if (b.id !== blockId) return b
        if (which === 'single') return { ...b, sectionImage: b.sectionImage ? { ...b.sectionImage, width: w } : b.sectionImage }
        if (!b.partitions) return b
        const parts = [...b.partitions] as [SectionCell, SectionCell]
        const pIdx = which === 'p0' ? 0 : 1
        parts[pIdx] = { ...parts[pIdx], width: w }
        return { ...b, partitions: parts }
      })
      blocksRef.current = next
      setBlocks(next)
    }
    const onUp = () => {
      onContentChange(buildDocStr())
      scheduleSave()
      pushHistory(true)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  // ── Drag-to-reorder: activated by ✥ Move in the ⋮ menu ─────────────────────

  // Compute which array index the block should be inserted at given mouse position.
  // Only considers non-dragged blocks so the ghost slot doesn't skew the geometry.
  function computeDropIdx(draggedId: string, mouseX: number, mouseY: number): number {
    const container = blockListRef.current
    if (!container) return 0
    const els = Array.from(container.querySelectorAll('[data-block-id]'))
    const others = els.filter(el => el.getAttribute('data-block-id') !== draggedId)
    if (others.length === 0) return 0

    let bestEl: Element | null = null
    let bestDist = Infinity
    for (const el of others) {
      const r = (el as HTMLElement).getBoundingClientRect()
      const cx = r.left + r.width / 2
      const cy = r.top  + r.height / 2
      // Weight vertical distance more heavily so row-detection is reliable
      const dist = Math.hypot(mouseX - cx, (mouseY - cy) * 1.4)
      if (dist < bestDist) { bestDist = dist; bestEl = el }
    }
    if (!bestEl) return 0

    const targetId  = bestEl.getAttribute('data-block-id')!
    const targetArr = blocksRef.current.findIndex(b => b.id === targetId)
    const rect = (bestEl as HTMLElement).getBoundingClientRect()
    // In a 2D masonry grid, use Y-midpoint: upper half = insert before, lower half = insert after
    const insertBefore = mouseY < rect.top + rect.height / 2
    return Math.max(0, Math.min(blocksRef.current.length, insertBefore ? targetArr : targetArr + 1))
  }

  // Compute up to 4 alignment guide lines (fixed-coord space) during a drag.
  function computeAlignGuides(
    draggedId: string, floatL: number, floatT: number, floatW: number, floatH: number
  ): Array<{ type: 'v' | 'h'; coord: number; from: number; to: number }> {
    const SNAP = 14
    const container = blockListRef.current
    if (!container) return []
    const guides: Array<{ type: 'v' | 'h'; coord: number; from: number; to: number }> = []
    const floatR = floatL + floatW
    const floatB = floatT + floatH

    for (const el of container.querySelectorAll('[data-block-id]')) {
      if (el.getAttribute('data-block-id') === draggedId) continue
      const r = (el as HTMLElement).getBoundingClientRect()
      const addV = (x: number) => guides.push({ type: 'v', coord: x, from: Math.min(floatT, r.top) - 16, to: Math.max(floatB, r.bottom) + 16 })
      const addH = (y: number) => guides.push({ type: 'h', coord: y, from: Math.min(floatL, r.left) - 16, to: Math.max(floatR, r.right)  + 16 })
      if (Math.abs(floatL  - r.left)   < SNAP) addV(r.left)
      if (Math.abs(floatL  - r.right)  < SNAP) addV(r.right)
      if (Math.abs(floatR  - r.right)  < SNAP) addV(r.right)
      if (Math.abs(floatT  - r.top)    < SNAP) addH(r.top)
      if (Math.abs(floatB  - r.bottom) < SNAP) addH(r.bottom)
    }
    // Deduplicate by rounding coord to nearest 4px
    const seen = new Set<string>()
    return guides.filter(g => { const k = `${g.type}_${Math.round(g.coord / 4) * 4}`; return seen.has(k) ? false : (seen.add(k), true) })
  }

  // Reorder the blocks array, moving blockId to targetIdx.
  function doMoveBlockToIdx(blockId: string, targetIdx: number) {
    const cur = blocksRef.current
    const from = cur.findIndex(b => b.id === blockId)
    if (from < 0) return
    const next = [...cur]
    const [blk] = next.splice(from, 1)
    const adj   = from < targetIdx ? targetIdx - 1 : targetIdx
    next.splice(adj, 0, blk)
    blocksRef.current = next
    setBlocks(next)
    onContentChange(buildDocStr())
    scheduleSave()
  }

  // Extracts the pointer position from either a mouse or a touch event, so the
  // same drag machinery below drives both the menu-activated ✥ Move (mouse
  // only, via startBlockMove) and the image's own direct press/hold-drag
  // (mouse + touch, via startImagePressDrag).
  function getEventXY(ev: MouseEvent | TouchEvent): { x: number; y: number } | null {
    if ('touches' in ev) {
      const t = ev.touches[0] ?? ev.changedTouches[0]
      return t ? { x: t.clientX, y: t.clientY } : null
    }
    return { x: ev.clientX, y: ev.clientY }
  }

  // Core block-drag machinery (reorder, or — for image/drawing blocks — drop
  // into a different section). `startBlockMove` (the existing ✥ Move menu
  // flow) and `startImagePressDrag` (direct click/press-drag on an image,
  // below) both funnel into this once a drag is actually underway.
  function beginBlockDrag(blockId: string, startX: number, startY: number) {
    const container = blockListRef.current
    const blockEl   = container?.querySelector(`[data-block-id="${blockId}"]`) as HTMLElement | null
    if (!blockEl) return

    const draggedBlock = blocksRef.current.find(b => b.id === blockId)
    const isMediaDrag = draggedBlock?.type === 'image' || draggedBlock?.type === 'drawing'

    const rect = blockEl.getBoundingClientRect()
    dragMoveRef.current = {
      blockId,
      offsetX: startX - rect.left,
      offsetY: startY - rect.top,
      blockW:  rect.width,
      blockH:  rect.height,
    }
    setDragPos({ x: startX, y: startY })
    setDropIdx(blocksRef.current.findIndex(b => b.id === blockId))
    if (isMediaDrag) { setMoveModeId(blockId); setSelectedBlockId(blockId) }

    function onMove(ev: MouseEvent | TouchEvent) {
      const dm = dragMoveRef.current
      if (!dm) return
      const xy = getEventXY(ev)
      if (!xy) return
      if ('touches' in ev) ev.preventDefault() // dragging on touch must not also scroll the page
      setDragPos({ x: xy.x, y: xy.y })

      // Image/drawing blocks may additionally target a different section to
      // drop INTO (auto-splitting it) — every other block type keeps the
      // reorder-only ghost-slot behavior below, untouched.
      let overSection: string | null = null
      if (isMediaDrag) {
        const el = document.elementFromPoint(xy.x, xy.y)?.closest('[data-block-id]') as HTMLElement | null
        const targetId = el?.getAttribute('data-block-id')
        if (targetId && targetId !== blockId) {
          const targetBlock = blocksRef.current.find(b => b.id === targetId)
          if (targetBlock?.type === 'section') overSection = targetId
        }
      }
      setDropTargetSectionId(overSection)

      if (overSection) {
        // A section drop-target is active — suppress the normal ghost slot so
        // the two affordances never show at once.
        setSnapGuides([])
      } else {
        setDropIdx(computeDropIdx(blockId, xy.x, xy.y))
        setSnapGuides(computeAlignGuides(
          blockId,
          xy.x - dm.offsetX,
          xy.y - dm.offsetY,
          dm.blockW,
          dm.blockH,
        ))
      }
    }
    function onUp(ev: MouseEvent | TouchEvent) {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup',   onUp)
      document.removeEventListener('touchmove', onMove)
      document.removeEventListener('touchend',  onUp)
      const xy = getEventXY(ev) ?? { x: startX, y: startY }

      if (isMediaDrag) suppressImageClickRef.current = true

      if (isMediaDrag && dropTargetSectionIdRef.current) {
        const targetId = dropTargetSectionIdRef.current
        const targetBlock = blocksRef.current.find(b => b.id === targetId)
        const dragged = blocksRef.current.find(b => b.id === blockId)
        if (targetBlock && dragged && dragged.src) {
          let side: 'left' | 'right' | undefined
          if (targetBlock.partitions) {
            const targetRect = (document.querySelector(`[data-block-id="${targetId}"]`) as HTMLElement | null)?.getBoundingClientRect()
            side = targetRect && xy.x < targetRect.left + targetRect.width / 2 ? 'left' : 'right'
          }
          insertImageIntoSection(targetId, { src: dragged.src, name: dragged.name ?? 'Image', canvasData: dragged.canvasData }, side)
          const next = blocksRef.current.filter(b => b.id !== blockId)
          blocksRef.current = next
          setBlocks(next)
          onContentChange(buildDocStr())
          scheduleSave()
        }
      } else {
        const finalIdx = computeDropIdx(blockId, xy.x, xy.y)
        doMoveBlockToIdx(blockId, finalIdx)
      }

      dragMoveRef.current = null
      setDragPos(null)
      setSnapGuides([])
      setDropTargetSectionId(null)
      setMoveModeId(null)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup',   onUp)
    document.addEventListener('touchmove', onMove, { passive: false })
    document.addEventListener('touchend',  onUp)
  }

  function startBlockMove(blockId: string, e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    beginBlockDrag(blockId, e.clientX, e.clientY)
  }

  // Direct press/drag on an existing image/drawing block's own thumbnail —
  // no need to open the ⋮ menu and activate ✥ Move first. Distinguishes a
  // drag from a plain click/tap so the existing single-click-to-select and
  // double-click-to-expand behavior (InlineMediaBlock) is never disturbed:
  // desktop starts dragging as soon as the mouse moves past a small
  // threshold; touch requires a brief press/hold (so a scroll gesture is
  // never mistaken for a drag) with its own, smaller movement tolerance.
  function startImagePressDrag(blockId: string, e: React.MouseEvent | React.TouchEvent) {
    const isTouch = 'touches' in e
    const start = isTouch ? e.touches[0] : e
    if (!start) return
    const startX = start.clientX, startY = start.clientY
    const MOVE_THRESHOLD = 6
    const HOLD_MS = 200
    let armed = false
    let holdTimer: ReturnType<typeof setTimeout> | null = null

    function cleanup() {
      document.removeEventListener('mousemove', onWatch)
      document.removeEventListener('mouseup',   onCancel)
      document.removeEventListener('touchmove', onWatch)
      document.removeEventListener('touchend',  onCancel)
      if (holdTimer) { clearTimeout(holdTimer); holdTimer = null }
    }
    function beginNow(x: number, y: number) {
      if (armed) return
      armed = true
      cleanup()
      beginBlockDrag(blockId, x, y)
    }
    function onWatch(ev: MouseEvent | TouchEvent) {
      const xy = getEventXY(ev)
      if (!xy) return
      const dist = Math.hypot(xy.x - startX, xy.y - startY)
      if (!isTouch) {
        if (dist > MOVE_THRESHOLD) beginNow(xy.x, xy.y)
      } else if (dist > MOVE_THRESHOLD * 2) {
        // Moved too far before the hold completed — a scroll/swipe, not a drag.
        cleanup()
      }
    }
    function onCancel() { cleanup() }

    if (isTouch) holdTimer = setTimeout(() => beginNow(startX, startY), HOLD_MS)
    document.addEventListener('mousemove', onWatch)
    document.addEventListener('mouseup',   onCancel)
    document.addEventListener('touchmove', onWatch)
    document.addEventListener('touchend',  onCancel)
  }

  // Draw handlers
  // Save-in-place — never closes the canvas (Ctrl+S and the toolbar Save button
  // both go through this). Exiting is only ever Back (mobile) / Cancel (desktop,
  // tablet). The first save of a brand-new Mind Map creates its block and starts
  // tracking it as `editingBlock`, so every save after that (including the very
  // next Ctrl+S) updates that same block instead of inserting another one.
  function handleDrawSave(dataUrl: string, objectsJson: string) {
    if (!drawState) return
    if (drawState.editingCell) {
      // Writes back into the SAME section cell the drawing was opened from —
      // never creates/ejects a top-level block, so the image's Planner
      // location (unsplit sectionImage, or whichever partition) is untouched;
      // only its src/thumbnail/canvasData update, same as any other re-save.
      const { blockId, which } = drawState.editingCell
      const cell = getSectionImageCell(blockId, which)
      if (!cell) { setDrawState(null); setMmcFit(false); return }
      const updatedCell: SectionCell = { ...cell, src: dataUrl, thumbnail: dataUrl, canvasData: objectsJson }
      const block = blocksRef.current.find(b => b.id === blockId)
      if (which === 'single') {
        updateBlock(blockId, { sectionImage: updatedCell })
      } else if (block?.partitions) {
        const parts = [...block.partitions] as [SectionCell, SectionCell]
        parts[which === 'p0' ? 0 : 1] = updatedCell
        updateBlock(blockId, { partitions: parts })
      }
      handleManualSave()
      return
    }
    let next: JournalBlock[]
    let savedBlock: JournalBlock
    if (drawState.editingBlock) {
      savedBlock = { ...drawState.editingBlock, src: dataUrl, thumbnail: dataUrl, canvasData: objectsJson, updatedAt: Date.now() }
      next = blocksRef.current.map(b => b.id === drawState.editingBlock!.id ? savedBlock : b)
    } else {
      savedBlock = createDrawingBlock(dataUrl, `Mind Map — ${fmtShortDate(dateKey)}`, objectsJson)
      next = [...blocksRef.current]
      next.splice(drawState.insertAt + 1, 0, savedBlock)
      // New drawings become Gallery assets automatically; re-editing an existing
      // one (the branch above) does not create a second Gallery entry.
      addGalleryItem({
        id: 'draw-' + Date.now(),
        type: 'drawing',
        createdAt: Date.now(),
        title: `Mind Map — ${fmtShortDate(dateKey)}`,
        dataUri: dataUrl,
        source: 'Planner/Journal',
        relatedDateLabel: fmtShortDate(dateKey),
      })
    }
    blocksRef.current = next
    setBlocks(next)
    setDrawState(prev => prev ? { ...prev, editingBlock: savedBlock } : prev)
    onContentChange(buildDocStr())
    // Persist immediately rather than the debounced autosave — the MMC's own
    // Save button/Ctrl+S must guarantee reopening the Mind Map restores what
    // was just saved, not whatever was on disk up to 1500ms ago. Reuses the
    // same immediate-persist path "Save Notes" already uses.
    handleManualSave()
  }

  // Emoji
  function handleEmojiClick(data: EmojiClickData) {
    focusedEditor.current?.chain().focus().insertContent(data.emoji).run()
    setShowEmoji(false)
  }

  // Indent — nests list items; no-op for plain paragraphs (no arbitrary block indent)
  function handleIndent() {
    const ed = focusedEditor.current
    if (!ed) return
    if (ed.isActive('taskList')) {
      ed.chain().focus().sinkListItem('taskItem').run()
    } else {
      ed.chain().focus().sinkListItem('listItem').run()
    }
  }

  // Sub-item — true ON/OFF toggle, distinct from Indent: ON creates an explicit
  // one-level parent→child relationship (flags the nested node so the connector
  // CSS renders a branch); pressing it again on an existing sub-item lifts it
  // back to the parent level and clears the flag, preserving its text, checkbox
  // state, list type and formatting untouched (only structure/attrs change).
  function handleSubItem() {
    const ed = focusedEditor.current
    if (!ed) return
    const itemType = ed.isActive('taskList') ? 'taskItem' : 'listItem'

    function findItem(state: Editor['state']) {
      const { $from } = state.selection
      for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type.name === itemType) return { node: $from.node(d), depth: d }
      }
      return null
    }

    const current = findItem(ed.state)
    if (!current) return // not inside a list — nothing to toggle

    if (current.node.attrs.subItem) {
      // TOGGLE OFF: clear the flag, then lift back to the parent level
      ed.chain()
        .focus()
        .command(({ tr, state }) => {
          const item = findItem(state)
          if (!item) return false
          tr.setNodeMarkup(state.selection.$from.before(item.depth), undefined, { ...item.node.attrs, subItem: false })
          return true
        })
        .liftListItem(itemType)
        .run()
      return
    }

    // TOGGLE ON — V1 supports one level of nesting only
    function listAncestorCount(state: Editor['state']): number {
      const { $from } = state.selection
      let n = 0
      for (let d = $from.depth; d > 0; d--) {
        const t = $from.node(d).type.name
        if (t === 'listItem' || t === 'taskItem') n++
      }
      return n
    }
    if (listAncestorCount(ed.state) >= 2) return // already nested via Indent — one level only

    ed.chain()
      .focus()
      .sinkListItem(itemType)
      .command(({ tr, state }) => {
        const item = findItem(state)
        if (!item) return false
        tr.setNodeMarkup(state.selection.$from.before(item.depth), undefined, { ...item.node.attrs, subItem: true })
        return true
      })
      .run()
  }

  // Voice-to-notes — session stays active across the browser's own recognition
  // cycles (which end on their own even in continuous mode); it only stops on
  // a manual toggle, 10s of continuous silence, or a genuinely fatal error.
  function clearSilenceTimer() {
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null }
  }
  function resetSilenceTimer() {
    clearSilenceTimer()
    silenceTimerRef.current = setTimeout(() => stopVoiceSession(), 10000)
  }
  function stopVoiceSession() {
    isRecordingRef.current = false
    setIsRecording(false)
    clearSilenceTimer()
    micTargetEditorRef.current = null
    try { recognitionRef.current?.stop() } catch {}
    recognitionRef.current = null
  }
  function handleVoiceToggle() {
    if (isRecordingRef.current) {
      stopVoiceSession()
      return
    }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) {
      setVoiceError('Voice recognition is not supported in this browser. Try Chrome or Edge.')
      return
    }
    // Remember the section focused BEFORE Mic was pressed — that section is
    // the dictation target for the whole session, not whatever has DOM focus
    // by the time a result comes back (which by then is the Mic button itself).
    const target = focusedEditor.current
    if (!target) {
      setVoiceError('Click inside a section first, then press Mic to dictate into it.')
      return
    }
    micTargetEditorRef.current = target
    const rec = new SR()
    rec.continuous = true
    rec.interimResults = true
    rec.lang = navigator.language || 'en-US'
    rec.onresult = (e: any) => {
      resetSilenceTimer() // any recognition activity — interim or final — proves the user is still talking
      let transcript = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) transcript += e.results[i][0].transcript
      }
      if (transcript.trim()) {
        // No .focus() — dictation must not steal UI focus from wherever the
        // user is looking (the Mic button/Listening indicator).
        micTargetEditorRef.current?.chain().insertContent(transcript.trim() + ' ').run()
      }
    }
    rec.onerror = (e: any) => {
      // 'no-speech' fires on ordinary pauses and 'aborted' fires from our own
      // .stop() calls — neither means the session should end.
      if (e.error === 'no-speech' || e.error === 'aborted') return
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        setVoiceError('Microphone access denied. Allow microphone access in your browser settings and try again.')
      } else {
        setVoiceError(`Voice error (${e.error}). Please try again.`)
      }
      stopVoiceSession()
    }
    rec.onend = () => {
      // The browser ending its own recognition cycle is NOT the same as the
      // XPadite session ending — restart it as long as the user hasn't
      // manually stopped and the silence timer hasn't already fired. A short
      // delay avoids some browsers throwing if .start() is called again in
      // the same tick the previous cycle finished.
      if (!isRecordingRef.current) return
      setTimeout(() => {
        if (!isRecordingRef.current) return
        try { rec.start() } catch {
          setVoiceError('Voice recognition stopped unexpectedly. Please try again.')
          stopVoiceSession()
        }
      }, 200)
    }
    recognitionRef.current = rec
    try {
      rec.start()
      isRecordingRef.current = true
      setIsRecording(true)
      setVoiceError(null)
      resetSilenceTimer()
    } catch {
      setVoiceError('Could not start voice recognition. Please check your microphone.')
      recognitionRef.current = null
      micTargetEditorRef.current = null
    }
  }
  useEffect(() => {
    if (!showEmoji) return
    function outside(e: MouseEvent) {
      const t = e.target as Node
      if (emojiBtnRef.current?.contains(t)) return
      if (document.getElementById('xp-j-emoji')?.contains(t)) return
      setShowEmoji(false)
    }
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [showEmoji])

  // ── Browser tab/window close protection ─────────────────────────────────────
  useEffect(() => {
    if (!isDirty) return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  // ── ESC key — capture phase so it fires before the parent's bubble handler ──
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Ctrl+S / Cmd+S — save the Planner document through the exact same
      // handler the Save button uses. When the Mind Mapping Canvas is open it
      // owns the key instead (its own listener saves the canvas) — never fire
      // both saves for one keypress.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        if (drawStateRef.current) return
        e.preventDefault()
        handleManualSave()
        return
      }
      // Delete/Backspace deletes a resize-selected top-level image/drawing
      // block — never while the user is typing in a text field or editor.
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const selId = resizeModeIdRef.current
        if (!selId) return
        const active = document.activeElement as HTMLElement | null
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return
        const selBlock = blocksRef.current.find(b => b.id === selId)
        if (!selBlock || (selBlock.type !== 'image' && selBlock.type !== 'drawing')) return
        e.preventDefault()
        deleteBlock(selId)
        setResizeModeId(null)
        return
      }
      if (e.key !== 'Escape') return
      // The Mind Mapping Canvas has its own Escape behavior (exit text-edit,
      // then deselect) — let its bubble-phase listener handle it instead of
      // navigating back out of the Planner.
      if (drawStateRef.current) return
      e.stopImmediatePropagation()
      if (showExitDialogRef.current) {
        setShowExitDialog(false)
        pendingNavRef.current = null
      } else if (showSessionsRef.current) {
        setShowSessions(false)
        setConfirmDeleteIdx(null)
      } else {
        guardedNavigate(onBackRef.current)
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Sessions popover — outside-click dismissal ───────────────────────────────
  useEffect(() => {
    if (!showSessions) return
    function onOutside(e: MouseEvent) {
      if (timerWrapperRef.current?.contains(e.target as Node)) return
      setShowSessions(false)
      setConfirmDeleteIdx(null)
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [showSessions])

  // ── confirmDeleteIdx — reset when clicking outside the confirm button ─────────
  useEffect(() => {
    if (confirmDeleteIdx === null) return
    function onAnyDown(e: MouseEvent) {
      if ((e.target as Element).closest('[data-confirm-del]')) return
      setConfirmDeleteIdx(null)
    }
    document.addEventListener('mousedown', onAnyDown)
    return () => document.removeEventListener('mousedown', onAnyDown)
  }, [confirmDeleteIdx])

  // ── Journal timer logic ──────────────────────────────────────────────────────
  const IDLE_PAUSE_MS = 30 * 60 * 1000  // auto-stop after 30min inactivity

  // Helper: today's date key (YYYY-MM-DD) — session date, not document date
  function makeTodayKey(): string {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  // Helper: get the title for the Task Manager task (doc title or auto-generated)
  function getPlannerTimerTitle(sessionDateKey: string): string {
    const docTitle = titleRef.current?.trim()
    if (docTitle) return docTitle
    const tasks = calData[sessionDateKey]?.tasks ?? []
    const maxN = tasks.reduce((m, t) => {
      const match = t.text.match(/^Planning\/Journaling Session (\d+)$/)
      return match ? Math.max(m, parseInt(match[1])) : m
    }, 0)
    return `Planning/Journaling Session ${maxN + 1}`
  }

  // Start: create or reuse Task Manager task, open a TaskSession
  function syncStartToTaskManager(startTs: number) {
    const sessionDate = makeTodayKey()
    const currentTasks = calData[sessionDate]?.tasks ?? []

    let taskId = plannerTaskLinkRef.current?.taskId ?? null
    let taskTitle = ''

    // Validate the linked task still exists (user may have deleted it)
    if (taskId && !currentTasks.find(t => t.id === taskId)) taskId = null

    if (!taskId) {
      // Create a fresh Task Manager task for this Planner document
      taskTitle = getPlannerTimerTitle(sessionDate)
      taskId = 't' + startTs + Math.random().toString(36).slice(2, 6)
      const newTask: Task = {
        id: taskId, text: taskTitle, done: false, journal: '',
        timerStart: null, timerEnd: null, actId: 'a-plan', sessions: [],
      }
      updateDay(sessionDate, prev => ({ ...prev, tasks: [...(prev.tasks ?? []), newTask] }))
      plannerTaskLinkRef.current = { taskId, sessionDate }
      // Persist the link in the journal doc so it survives remounts
      if (!isDirtyRef.current) { isDirtyRef.current = true; setIsDirty(true) }
      scheduleSave()
    } else {
      taskTitle = currentTasks.find(t => t.id === taskId)?.text ?? ''
    }

    // Open a new TaskSession for this timing interval
    const tmSessionId = 'ps' + startTs + Math.random().toString(36).slice(2, 4)
    plannerTmSessionIdRef.current = tmSessionId
    const newTaskSession: TaskSession = { id: tmSessionId, startTs, endTs: null, note: '', tags: [] }
    updateDay(sessionDate, prev => ({
      ...prev,
      tasks: (prev.tasks ?? []).map(t =>
        t.id === taskId ? { ...t, sessions: [...(t.sessions ?? []), newTaskSession] } : t
      ),
    }))

    // Integrate with global active-timer indicator (only if nothing else is running)
    if (!activeTaskTimer) {
      const taskIndex = Math.max(0, currentTasks.findIndex(t => t.id === taskId))
      setActiveTaskTimer({ taskId: taskId!, dateKey: sessionDate, sessionId: tmSessionId, startTs, taskText: taskTitle, taskIndex })
    }
  }

  // Stop/pause: close the running TaskSession
  function syncStopToTaskManager(endTs: number) {
    const link = plannerTaskLinkRef.current
    const tmSessionId = plannerTmSessionIdRef.current
    if (!link || !tmSessionId) return
    const { taskId, sessionDate } = link
    updateDay(sessionDate, prev => ({
      ...prev,
      tasks: (prev.tasks ?? []).map(t =>
        t.id !== taskId ? t : {
          ...t, timerEnd: endTs,
          sessions: (t.sessions ?? []).map(s => s.id === tmSessionId ? { ...s, endTs } : s),
        }
      ),
    }))
    plannerTmSessionIdRef.current = null
    if (activeTaskTimer?.taskId === taskId && activeTaskTimer.dateKey === sessionDate) {
      setActiveTaskTimer(null)
    }
  }

  function timerStart() {
    const now = Date.now()
    lastActivityRef.current = now
    timerStartTsRef.current = now
    setTimerStartTs(now)
    setTimerElapsedMs(0)
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current)
    timerIntervalRef.current = setInterval(() => {
      const start = timerStartTsRef.current
      if (!start) return
      const elapsed = Date.now() - start
      setTimerElapsedMs(elapsed)
      // Idle auto-stop
      if (Date.now() - lastActivityRef.current > IDLE_PAUSE_MS) {
        timerStopAt(lastActivityRef.current)
      }
    }, 1000)
    // Mirror to Task Manager
    syncStartToTaskManager(now)
  }

  function timerStopAt(endTs: number) {
    if (timerIntervalRef.current) { clearInterval(timerIntervalRef.current); timerIntervalRef.current = null }
    const start = timerStartTsRef.current
    if (!start) return
    const newSession: JournalTimerSession = { startTs: start, endTs }
    const next = [...timerSessionsRef.current, newSession]
    timerSessionsRef.current = next
    setTimerSessions(next)
    timerStartTsRef.current = null
    setTimerStartTs(null)
    setTimerElapsedMs(0)
    if (!isDirtyRef.current) { isDirtyRef.current = true; setIsDirty(true) }
    scheduleSave()
    // Mirror to Task Manager
    syncStopToTaskManager(endTs)
  }

  function timerStop() { timerStopAt(Date.now()) }

  function deleteTimerSession(idx: number) {
    const next = timerSessionsRef.current.filter((_, i) => i !== idx)
    timerSessionsRef.current = next
    setTimerSessions(next)
    setConfirmDeleteIdx(null)
    if (!isDirtyRef.current) { isDirtyRef.current = true; setIsDirty(true) }
    scheduleSave()
  }

  // Track user activity for idle detection
  useEffect(() => {
    function onActivity() { lastActivityRef.current = Date.now() }
    document.addEventListener('mousemove', onActivity, { passive: true })
    document.addEventListener('keydown',   onActivity, { passive: true })
    document.addEventListener('click',     onActivity, { passive: true })
    document.addEventListener('scroll',    onActivity, { passive: true })
    return () => {
      document.removeEventListener('mousemove', onActivity)
      document.removeEventListener('keydown',   onActivity)
      document.removeEventListener('click',     onActivity)
      document.removeEventListener('scroll',    onActivity)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Styles ──────────────────────────────────────────────────────────────────
  // Dock: deep navy blue — premium, complements XPadite purple, never black
  const dockBg  = 'rgba(8,20,58,0.98)'
  const dockBdr = 'rgba(124,58,237,0.20)'
  const dockDiv = 'rgba(255,255,255,0.08)'

  function showUndoRedoTip(which: 'undo' | 'redo') {
    if (undoRedoTipTimer.current) clearTimeout(undoRedoTipTimer.current)
    setUndoRedoTip(which)
    undoRedoTipTimer.current = setTimeout(() => setUndoRedoTip(null), 1400)
  }

  // Utility buttons: subdued navy/lavender treatment (List, Upload, Camera, Draw)
  // ─────────────────────────────────────────────────────────────────────────

  // Extracted so the SAME header renders both in the normal embedded layout
  // and inside the Fit-mode portal below (see mmcFit) without duplicating it.
  const headerEl = (
    <div
      className="xp-j-hdr"
      style={{ flexShrink: 0, borderBottom: '0.5px solid rgba(255,255,255,0.08)' }}
    >
      {/* Mobile-only Mind Mapping Canvas header — swaps in for the normal date-nav
          header while the canvas is open on mobile; desktop/tablet always keep the
          normal header below untouched (this block is display:none there). */}
      {drawState && (
        <div className="xp-j-draw-mobile-hdr" style={{
          display: 'none', position: 'relative', alignItems: 'center',
          height: 52, padding: '0 14px',
        }}>
          <button
            onClick={() => drawModalRef.current?.requestClose()}
            title="Back"
            aria-label="Back"
            style={{
              position: 'relative', zIndex: 1, width: 40, height: 40, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'transparent', border: 'none',
              color: 'rgba(255,255,255,0.85)', cursor: 'pointer', padding: 0,
              fontSize: 18, fontWeight: 300, lineHeight: 1,
              transition: 'opacity 120ms, transform 80ms',
            }}
            onMouseDown={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(0.88)' }}
            onMouseUp={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)' }}
          >←</button>
          <span style={{
            position: 'absolute', left: 0, right: 0, top: '50%', transform: 'translateY(-50%)',
            textAlign: 'center', pointerEvents: 'none',
            color: '#fff', fontSize: 13, fontWeight: 600, letterSpacing: '-0.01em', whiteSpace: 'nowrap',
          }}>🧠 Mind Mapping Canvas</span>
        </div>
      )}

      <div className={drawState ? 'xp-j-hdr-normal' : undefined} style={{
        position: 'relative', display: 'flex', alignItems: 'center',
        height: 52, padding: '0 14px', gap: 6,
      }}>
        {/* Left: back — mobile only (bottom nav handles close on mobile; hidden on desktop/tablet) */}
        <button
          onClick={() => guardedNavigate(onBack)}
          className="hidden"
          style={{
            padding: '5px 10px', borderRadius: 8, border: '0.5px solid rgba(255,255,255,0.16)',
            background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.78)',
            fontSize: 12, fontWeight: 500, cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap',
          }}
        >← Calendar</button>

        {/*
         * Center group: the date is independently centered on the header,
         * and each triangle is pinned at a FIXED distance (132px) from that
         * same center point — never from the date's own rendered width.
         * Changing weekday/month/day/year length never moves a triangle.
         */}
        <div style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, pointerEvents: 'none' }}>
          <span style={{
            position: 'absolute', left: 0, right: 0, top: '50%', transform: 'translateY(-50%)',
            textAlign: 'center',
            color: '#fff', fontSize: 13, fontWeight: 600, letterSpacing: '-0.01em', whiteSpace: 'nowrap',
          }}>
            {fmtEditorDate(dateKey)}
          </span>
          <button
            onClick={() => guardedNavigate(() => onNavigateDay(-1))}
            title="Previous day"
            style={{
              position: 'absolute', left: 'calc(50% - 132px)', top: '50%', transform: 'translateY(-50%)',
              width: 32, height: 32, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'transparent', border: 'none',
              color: '#fff', cursor: 'pointer', padding: 0, pointerEvents: 'auto',
              transition: 'opacity 120ms, transform 80ms',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.7' }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '1' }}
            onMouseDown={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-50%) scale(0.88)' }}
            onMouseUp={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-50%) scale(1)' }}
          >
            <svg width="9" height="12" viewBox="0 0 9 12" fill="#fff" aria-hidden="true">
              <path d="M9 0 L0 6 L9 12 Z" />
            </svg>
          </button>
          <button
            onClick={() => guardedNavigate(() => onNavigateDay(1))}
            title="Next day"
            style={{
              position: 'absolute', right: 'calc(50% - 132px)', top: '50%', transform: 'translateY(-50%)',
              width: 32, height: 32, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'transparent', border: 'none',
              color: '#fff', cursor: 'pointer', padding: 0, pointerEvents: 'auto',
              transition: 'opacity 120ms, transform 80ms',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.7' }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '1' }}
            onMouseDown={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-50%) scale(0.88)' }}
            onMouseUp={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-50%) scale(1)' }}
          >
            <svg width="9" height="12" viewBox="0 0 9 12" fill="#fff" aria-hidden="true">
              <path d="M0 0 L9 6 L0 12 Z" />
            </svg>
          </button>
        </div>

        {/* Right: today + close */}
        <div style={{ flex: 1 }} />
        {!isEditorOnToday && (
          <button
            onClick={() => guardedNavigate(onNavigateToday)}
            title="Go to today"
            style={{
              padding: '3px 8px', borderRadius: 20, border: '0.5px solid rgba(255,255,255,0.22)',
              background: 'transparent', color: 'rgba(255,255,255,0.60)',
              fontSize: 11, cursor: 'pointer', flexShrink: 0,
            }}
          >Today</button>
        )}
        {/* Close — hidden on mobile (bottom nav handles close) and removed
            entirely while the Mind Mapping Canvas is open on any device: its
            own mobile Back / desktop-tablet Cancel already handle exiting,
            so × Close there was a redundant second exit control. */}
        {!drawState && (
          <button
            onClick={() => guardedNavigate(onClose)}
            className="hidden sm:block"
            style={{
              padding: '5px 10px', borderRadius: 8,
              border: '0.5px solid rgba(239,68,68,0.28)',
              background: 'rgba(239,68,68,0.15)', color: '#fca5a5',
              fontSize: 12, fontWeight: 500, cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap',
            }}
          >× Close</button>
        )}
      </div>
    </div>
  )

  // Reads from `blocks` (render state), not blocksRef, since this runs during
  // render itself — getSectionImageCell's ref read is for event handlers only.
  const editingCellData = drawState?.editingCell
    ? (() => {
        const { blockId, which } = drawState.editingCell!
        const b = blocks.find(bb => bb.id === blockId)
        if (!b) return undefined
        return which === 'single' ? b.sectionImage : which === 'p0' ? b.partitions?.[0] : b.partitions?.[1]
      })()
    : undefined
  const journalDrawModalEl = drawState && (
    <JournalDrawModal
      ref={drawModalRef}
      isDark={isDark}
      initialSrc={drawState.editingCell ? editingCellData?.src : drawState.editingBlock?.src}
      initialObjects={drawState.syntheticInitialObjects ?? (drawState.editingCell ? editingCellData?.canvasData : drawState.editingBlock?.canvasData)}
      onSave={handleDrawSave}
      onClose={() => { setDrawState(null); setMmcFit(false) }}
      fitScreen={mmcFit}
      onToggleFitScreen={() => setMmcFit(f => !f)}
    />
  )

  return (
    <>
      {/* Fit mode: portal JUST the canvas (no header — true full-screen, the
          header's own 52px is reclaimed by the workspace too) to document.body
          so it escapes this Journal modal's own z-index stacking context
          entirely — the only way to visually sit above the main mobile bottom
          nav (z-index:50), since no z-index set from WITHIN that stacking
          context ever could. Restore stays reachable via the MMC's own
          bottom-toolbar Fit/Restore button, still rendered inside. */}
      {mmcFit && drawState && createPortal(
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          display: 'flex', flexDirection: 'column',
          background: isDark ? '#10071e' : '#ffffff',
        }}>
          {journalDrawModalEl}
        </div>,
        document.body
      )}

      {/* ── CSS ─────────────────────────────────────────────────────────── */}
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
        /* Utility buttons: neutral hover (subdued, not purple) */
        .xp-jd-btn:hover:not(.xp-j-active):not(:disabled) {
          border-color: rgba(255,255,255,0.18) !important;
          background:   rgba(255,255,255,0.09) !important;
          color: rgba(255,255,255,0.88) !important;
          transform: translateY(-1px);
        }
        .xp-jd-btn:active {
          transform: scale(0.97) !important;
          transition-duration: 60ms !important;
        }
        @keyframes xpSecMenuIn {
          from { opacity: 0; transform: scale(0.95) translateY(5px); }
          to   { opacity: 1; transform: scale(1)    translateY(0); }
        }
        .xp-j-sec-menu { animation: xpSecMenuIn 140ms cubic-bezier(0.16,1,0.3,1) both; }
        .xp-j-save-btn { transition: all 120ms; }
        .xp-j-save-btn:hover { opacity: 0.88; transform: translateY(-1px); }
        .xp-j-save-btn:active { transform: scale(0.97); transition-duration: 60ms; }
        /* Mobile-only: the main (non-section) block's ⋮ menu is absolutely
           positioned at top:8/right:8 with no padding reserving space for it
           (unlike section blocks, which already reserve 40px via inline
           padding) — on desktop/tablet the block is wide enough that text
           wraps well before reaching it, but on mobile's narrow width the
           placeholder/first line collides with it. Reserve the same 40px
           section blocks already use, mobile only; desktop/tablet keep their
           existing padding:0 untouched. */
        @media (max-width: 640px) {
          .xp-j-main-wrap { padding-right: 40px !important; }
        }
        .xp-j-prose {
          outline: none; font-size: 14px; line-height: 1.75;
          font-family: inherit; color: ${isDark ? '#f1f5f9' : '#0f172a'}; min-height: 32px;
        }
        .xp-j-prose p { margin: 0 0 6px; }
        .xp-j-prose p:last-child { margin-bottom: 0; }
        .xp-j-prose strong { font-weight: 650; }
        .xp-j-prose em { font-style: italic; }
        .xp-j-prose h2 { font-size: 1.30em; font-weight: 700; margin: 0 0 8px; line-height: 1.3; letter-spacing: -0.01em; color: inherit; }
        .xp-j-prose h3 { font-size: 1.12em; font-weight: 600; margin: 0 0 6px; line-height: 1.4; color: inherit; }
        .xp-j-prose ul:not([data-type="taskList"]) { padding-left: 20px; margin: 0 0 6px; list-style: disc; }
        .xp-j-prose ol { padding-left: 22px; margin: 0 0 6px; list-style-type: decimal; }
        .xp-j-prose ol[type="a"] { list-style-type: lower-alpha; }
        .xp-j-prose li { margin-bottom: 3px; }
        .xp-j-prose ul[data-type="taskList"] { list-style: none; padding-left: 0; margin: 0 0 6px; }
        .xp-j-prose ul[data-type="taskList"] > li { display: flex; align-items: flex-start; gap: 7px; margin-bottom: 4px; }
        .xp-j-prose ul[data-type="taskList"] > li > label { flex-shrink: 0; margin-top: 3px; cursor: pointer; display: flex; }
        .xp-j-prose ul[data-type="taskList"] > li > label > input[type="checkbox"] { width: 14px; height: 14px; cursor: pointer; accent-color: #7c3aed; margin: 0; }
        .xp-j-prose ul[data-type="taskList"] > li > div { flex: 1; min-width: 0; }
        .xp-j-prose ul[data-type="taskList"] > li[data-checked="true"] > div { opacity: 0.52; }
        /* Sent-to-Task-Manager indicator — a quiet inline badge, never a checkbox
           replacement and never auto-completes the Planner item; purely presentational,
           driven entirely by the taskItem's own data-xp-sent-task-id attribute. */
        .xp-j-prose ul[data-type="taskList"] > li[data-xp-sent-task-id] > div > p:first-child::after {
          content: 'Sent'; display: inline-block; margin-left: 7px; vertical-align: middle;
          font-size: 9px; font-weight: 700; letter-spacing: 0.02em; line-height: 1;
          padding: 2px 6px; border-radius: 8px;
          background: ${isDark ? 'rgba(124,58,237,0.22)' : 'rgba(124,58,237,0.12)'};
          color: ${isDark ? '#c4b5fd' : '#7c3aed'};
        }
        /* Sub-item connector — Task Manager-style: thin trunk + sharp 90° branch +
           small right-facing arrowhead, no curves. Sub-items always live inside a
           dedicated nested list under their parent, so :last-child on that nested
           list scopes exactly to "the final child in this group" with no JS bookkeeping.
           Geometry is deliberately self-contained: both pseudo-elements sit fully
           within the li's own reserved margin-left gutter (never past it), so the
           connector can never depend on — or be clipped by — spacing borrowed from
           an ancestor (e.g. a checkbox list's zero-padding <ul>), which is what made
           it disappear on Mobile's tighter layout despite rendering fine on Desktop. */
        .xp-j-prose li[data-sub-item="true"] { position: relative; margin-left: 20px; }
        .xp-j-prose li[data-sub-item="true"]::before {
          content: ''; position: absolute; left: -16px; top: 0; bottom: -3px; width: 2px;
          background: ${isDark ? 'rgba(167,139,250,0.55)' : 'rgba(124,58,237,0.50)'}; pointer-events: none;
        }
        .xp-j-prose li[data-sub-item="true"]:last-child::before { bottom: auto; height: 10px; }
        .xp-j-prose li[data-sub-item="true"]::after {
          content: ''; position: absolute; left: -16px; top: 5px; width: 12px; height: 9px;
          background: ${isDark ? 'rgba(167,139,250,0.65)' : 'rgba(124,58,237,0.55)'}; pointer-events: none;
          clip-path: polygon(0% 42%, 62% 42%, 62% 12%, 100% 50%, 62% 88%, 62% 58%, 0% 58%);
        }
        .xp-j-prose ul[data-type="taskList"] > li[data-sub-item="true"] { position: relative; margin-left: 20px; }
        .xp-j-prose ul[data-type="taskList"] > li[data-sub-item="true"]::before {
          content: ''; position: absolute; left: -16px; top: 0; bottom: -4px; width: 2px;
          background: ${isDark ? 'rgba(167,139,250,0.55)' : 'rgba(124,58,237,0.50)'}; pointer-events: none;
        }
        .xp-j-prose ul[data-type="taskList"] > li[data-sub-item="true"]:last-child::before { bottom: auto; height: 15px; }
        .xp-j-prose ul[data-type="taskList"] > li[data-sub-item="true"]::after {
          content: ''; position: absolute; left: -16px; top: 11px; width: 12px; height: 9px;
          background: ${isDark ? 'rgba(167,139,250,0.65)' : 'rgba(124,58,237,0.55)'}; pointer-events: none;
          clip-path: polygon(0% 42%, 62% 42%, 62% 12%, 100% 50%, 62% 88%, 62% 58%, 0% 58%);
        }
        @media (max-width: 640px) {
          /* Mobile-only: horizontal branch lengthened ~10px versus the base mobile
             values above (margin-left/left both shift by the same 10px so the
             vertical trunk's on-screen position is unchanged — only the child's
             own box and the branch itself move). The clip-path split moves from
             62% to 82% so the arrowhead keeps its original ~3.4px physical width
             at the new, wider box instead of scaling up with it. Desktop/tablet
             (the un-media-queried rules above) are untouched. */
          .xp-j-prose li[data-sub-item="true"] { margin-left: 24px; }
          .xp-j-prose ul[data-type="taskList"] > li[data-sub-item="true"] { margin-left: 24px; }
          .xp-j-prose li[data-sub-item="true"]::before,
          .xp-j-prose ul[data-type="taskList"] > li[data-sub-item="true"]::before { left: -21px; }
          .xp-j-prose li[data-sub-item="true"]::after,
          .xp-j-prose ul[data-type="taskList"] > li[data-sub-item="true"]::after {
            left: -21px; width: 19px;
            clip-path: polygon(0% 42%, 82% 42%, 82% 12%, 100% 50%, 82% 88%, 82% 58%, 0% 58%);
          }
        }
        /* Box Title — a text format (toggle mark), not a section or drawn shape.
           Five curated pastel pill treatments (default: purple), each readable
           over any existing section background color, in both themes. */
        .xp-j-box-title {
          display: inline-block;
          padding: 3px 10px;
          margin: 1px 0;
          border-radius: 8px;
          font-weight: 700;
          line-height: 1.5;
          max-width: 100%;
          overflow-wrap: break-word;
        }
        .xp-j-box-title[data-box-color="purple"] {
          background: ${isDark ? 'rgba(124,58,237,0.28)' : 'rgba(124,58,237,0.12)'};
          border: 0.5px solid ${isDark ? 'rgba(167,139,250,0.45)' : 'rgba(124,58,237,0.30)'};
          color: ${isDark ? '#e9d5ff' : '#5b21b6'};
        }
        .xp-j-box-title[data-box-color="yellow"] {
          background: ${isDark ? 'rgba(234,179,8,0.28)' : 'rgba(250,204,21,0.22)'};
          border: 0.5px solid ${isDark ? 'rgba(250,204,21,0.45)' : 'rgba(202,138,4,0.35)'};
          color: ${isDark ? '#fef08a' : '#713f12'};
        }
        .xp-j-box-title[data-box-color="green"] {
          background: ${isDark ? 'rgba(34,197,94,0.26)' : 'rgba(34,197,94,0.14)'};
          border: 0.5px solid ${isDark ? 'rgba(74,222,128,0.45)' : 'rgba(22,163,74,0.32)'};
          color: ${isDark ? '#bbf7d0' : '#166534'};
        }
        .xp-j-box-title[data-box-color="pink"] {
          background: ${isDark ? 'rgba(236,72,153,0.26)' : 'rgba(236,72,153,0.13)'};
          border: 0.5px solid ${isDark ? 'rgba(244,114,182,0.45)' : 'rgba(219,39,119,0.30)'};
          color: ${isDark ? '#fbcfe8' : '#9d174d'};
        }
        .xp-j-box-title[data-box-color="blue"] {
          background: ${isDark ? 'rgba(59,130,246,0.26)' : 'rgba(59,130,246,0.13)'};
          border: 0.5px solid ${isDark ? 'rgba(96,165,250,0.45)' : 'rgba(37,99,235,0.30)'};
          color: ${isDark ? '#bfdbfe' : '#1e40af'};
        }
        .xp-j-prose p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          color: ${isDark ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.30)'};
          float: left; pointer-events: none; height: 0;
        }
        /* Planner tables — a bounded scroll container so a wide table can never
           push the Planner viewport wider; colors come from CSS vars the XpTable
           node bakes onto the <table> itself (see getTableColor). Precedence:
           base fill → first-column override (td only, never th) → header (th,
           always wins the top-left intersection since a cell is never both). */
        .xp-j-table-wrap {
          overflow-x: auto; max-width: 100%; margin: 6px 0; -webkit-overflow-scrolling: touch;
          border-radius: 10px; border: 1px solid ${isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.12)'};
        }
        .xp-j-table-wrap.xp-j-table-square { border-radius: 0; }
        .xp-j-table { border-collapse: collapse; width: 100%; table-layout: fixed; font-size: 12.5px; }
        .xp-j-prose .xp-j-table p { margin: 0; }
        .xp-j-table td, .xp-j-table th {
          border: 1px solid ${isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.12)'};
          padding: 6px 8px; vertical-align: top; min-width: 84px;
          background: var(--xp-tbl-fill); color: var(--xp-tbl-fill-text);
        }
        .xp-j-table th { background: var(--xp-tbl-header); color: var(--xp-tbl-header-text); font-weight: 700; text-align: left; }
        .xp-j-table-firstcol td:first-child { background: var(--xp-tbl-firstcol); color: var(--xp-tbl-firstcol-text); }
        .xp-j-table .selectedCell { background: rgba(124,58,237,0.28) !important; }
        /* Selectable blocks */
        .xp-j-blk { cursor: pointer; }
        .xp-j-blk:hover { box-shadow: 0 0 0 1.5px rgba(124,58,237,0.22); border-radius: 10px; }
        /* Section title: faint "Add Title" reveals on hover */
        .xp-j-sec-wrap:hover .xp-j-add-title { opacity: 0.45 !important; }
        /* Responsive collapse */
        @media (max-width: 640px) {
          .xp-j-grid { display: flex !important; flex-direction: column !important; }
          .xp-j-grid > * { width: 100% !important; flex-shrink: 0 !important; }
          /* A manually-resized image/drawing box uses a fixed height + object-fit:
             contain on desktop/tablet (unchanged) — on mobile that letterboxes
             with gray bars whenever the box's aspect ratio doesn't match the
             image's own, so mobile always shows it at its natural aspect ratio
             instead, filling the block edge-to-edge with no wasted gray space. */
          .xp-media-img[data-has-fixed-height="true"] { height: auto !important; object-fit: unset !important; }
          .xp-j-content-scroll { padding-bottom: 24px !important; }
          .xp-j-grid > :first-child .xp-j-prose { min-height: 80px !important; }
          .xp-jd-sec-dt { display: none !important; }
          .xp-jd-ind-dt { display: none !important; }
          .xp-jd-mic-toolbar { display: none !important; }
          .xp-j-saved-txt { display: none !important; }
          /* Mobile save-button in-button feedback */
          .xp-j-save-btn .xp-j-save-lbl { transition: opacity 180ms; }
          .xp-j-save-btn .xp-j-saved-mob { opacity: 0; transition: opacity 180ms; }
          .xp-j-save-btn-saved .xp-j-save-lbl { opacity: 0; }
          .xp-j-save-btn-saved .xp-j-saved-mob { opacity: 1; }
          .xp-jd-nav-btn {
            font-size: 20px !important;
            color: rgba(255,255,255,0.92) !important;
            background: rgba(124,58,237,0.22) !important;
            border-radius: 6px !important;
            padding: 3px 7px !important;
          }
          /* Emoji picker: clamp to viewport width on mobile so it never clips left */
          #xp-j-emoji {
            left: 4px !important;
            right: 4px !important;
            width: auto !important;
          }
          #xp-j-emoji aside,
          #xp-j-emoji .EmojiPickerReact {
            width: 100% !important;
            min-width: 0 !important;
          }
        }
        @media (min-width: 641px) {
          .xp-jd-sec-mo { display: none !important; }
          .xp-jd-ind-mo { display: none !important; }
          .xp-jd-mic-nav { display: none !important; }
          /* Desktop/tablet — in-button saved overlay never appears */
          .xp-j-saved-mob { display: none !important; }
        }
        /* Undo/Redo tap tooltip — mobile only */
        .xp-jd-tip {
          position: absolute; bottom: calc(100% + 6px); left: 50%;
          transform: translateX(-50%);
          background: rgba(20,10,40,0.95); color: rgba(255,255,255,0.90);
          font-size: 11px; padding: 3px 8px; border-radius: 6px;
          white-space: nowrap; pointer-events: none; z-index: 100;
          animation: xpUndoRedoTipFade 1.4s ease-in-out forwards;
        }
        @keyframes xpUndoRedoTipFade {
          0%   { opacity: 0; transform: translateX(-50%) translateY(4px); }
          15%  { opacity: 1; transform: translateX(-50%) translateY(0); }
          70%  { opacity: 1; }
          100% { opacity: 0; transform: translateX(-50%) translateY(0); }
        }
        @media (min-width: 641px) { .xp-jd-tip { display: none; } }
        /* Ghost slot pulse during drag-move */
        @keyframes xpGhostPulse {
          0%, 100% { opacity: 0.85; }
          50%       { opacity: 1; }
        }
        /* Mic recording pulse */
        @keyframes xpMicPulse {
          0%   { box-shadow: 0 0 0 0   rgba(239,68,68,0.65); }
          70%  { box-shadow: 0 0 0 7px rgba(239,68,68,0);    }
          100% { box-shadow: 0 0 0 0   rgba(239,68,68,0);    }
        }
        .xp-j-mic-rec { animation: xpMicPulse 1.5s ease-out infinite; }
        /* Listening-indicator dot — restrained pulse, no scale/flash */
        @keyframes xpMicDotPulse {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.35; }
        }
        .xp-mic-dot { animation: xpMicDotPulse 1.3s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .xp-mic-dot { animation: none; }
        }
        /* Mind Mapping Canvas — mobile-only header swap (desktop/tablet never
           match this query, so the normal date-nav header always shows there). */
        @media (max-width: 640px) {
          .xp-j-draw-mobile-hdr { display: flex !important; }
          .xp-j-hdr-normal { display: none !important; }
        }
      `}</style>

      {/* Normal embedded layout — suppressed while the Fit-mode portal above
          owns the (identical) header + canvas instead, so JournalDrawModal is
          never mounted twice at once. */}
      {!mmcFit && headerEl}

      {/* ── Content area or Draw canvas ─────────────────────────────────────── */}
      {!mmcFit && (drawState ? journalDrawModalEl : (
        <>
          {/* Block list — masonry grid layout */}
          <div
            className="xp-j-content-scroll"
            style={{ flex: 1, overflowY: 'auto', padding: '12px 20px 8px', minHeight: 0 }}
            onClick={() => { setSelectedBlockId(null); setMoveModeId(null); setResizeModeId(null); setSelectionRect(null) }}
          >
            {/* ── Document title ──────────────────────────────────────────────── */}
            <style>{`.xp-j-title::placeholder{color:${isDark ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.28)'}}`}</style>
            <input
              className="xp-j-title"
              type="text"
              value={title}
              onChange={e => {
                const v = e.target.value.slice(0, 80)
                titleRef.current = v
                setTitle(v)
                if (!isDirtyRef.current) { isDirtyRef.current = true; setIsDirty(true) }
              }}
              placeholder="Add a title..."
              maxLength={80}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  const firstProse = blockListRef.current?.querySelector('.xp-j-prose') as HTMLElement | null
                  firstProse?.focus()
                }
              }}
              onClick={e => e.stopPropagation()}
              style={{
                width: '100%', display: 'block',
                fontSize: 20, fontWeight: 700, lineHeight: 1.3,
                background: 'transparent', border: 'none', outline: 'none',
                color: isDark ? 'rgba(255,255,255,0.92)' : 'rgba(0,0,0,0.86)',
                padding: '2px 0 10px',
                marginBottom: 14,
                borderBottom: `0.5px solid ${isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.09)'}`,
                boxSizing: 'border-box',
              }}
            />

            <div
              ref={blockListRef}
              className="xp-j-grid"
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)`,
                gap: GRID_GAP,
                gridAutoRows: `${ROW_PX}px`,
                alignContent: 'start',
              }}
            >
              {(() => {
                const ghostBlock = dragPos !== null && dragMoveRef.current
                  ? blocks.find(b => b.id === dragMoveRef.current!.blockId)
                  : null
                const ghostColSpan = ghostBlock ? widthToColSpan(ghostBlock.width ?? 100) : 6
                const ghostBlockH  = dragMoveRef.current?.blockH

                return blocks.flatMap((block, idx) => {
                  const w          = block.width ?? 100
                  const isSelected = selectedBlockId === block.id
                  const isSelectable = block.type !== 'text'
                  const isMoveMode = moveModeId === block.id
                  const isDragging = isMoveMode && dragPos !== null
                  const colSpan    = widthToColSpan(w)
                  const isDraggedBlock = dragMoveRef.current?.blockId === block.id

                  const elements: React.ReactNode[] = []

                  // Ghost slot before this block (marks where dragged block will land)
                  if (dragPos !== null && !isDraggedBlock && dropIdx === idx) {
                    elements.push(
                      <GhostSlot key="__ghost__" colSpan={ghostColSpan} blockH={ghostBlockH} />
                    )
                  }

                  elements.push(
                    <GridBlockItem
                      key={block.id}
                      blockId={block.id}
                      colSpan={colSpan}
                      style={{
                        opacity: isDragging ? 0.25 : 1,
                        cursor: isMoveMode ? (isDragging ? 'grabbing' : 'grab') : undefined,
                        transition: isDragging ? 'none' : 'opacity 150ms',
                      }}
                      onClick={isSelectable ? e => {
                        e.stopPropagation()
                        if (moveModeId   && moveModeId   !== block.id) setMoveModeId(null)
                        if (resizeModeId && resizeModeId !== block.id) setResizeModeId(null)
                        setSelectedBlockId(block.id)
                      } : undefined}
                      onMouseDown={isMoveMode && !isDragging ? e => startBlockMove(block.id, e) : undefined}
                    >
                      {/* Block content with hover/selection outline */}
                      <div
                        className={isSelectable ? 'xp-j-blk' : ''}
                        style={{
                          position: 'relative',
                          outline: dropTargetSectionId === block.id
                            ? '1.5px solid rgba(124,58,237,0.85)'
                            : (isSelected && isSelectable ? '1.5px solid rgba(124,58,237,0.55)' : '1.5px solid transparent'),
                          boxShadow: dropTargetSectionId === block.id ? 'inset 0 0 0 3px rgba(124,58,237,0.20)' : undefined,
                          borderRadius: 10, transition: 'outline 120ms',
                        }}
                      >
                        {(block.type === 'text' || block.type === 'section') ? (
                          <JournalTextBlock
                            block={block}
                            isDark={isDark}
                            isOnlyBlock={blocks.length === 1}
                            isFirstBlock={idx === 0}
                            forcedContent={{ content: contentMapRef.current.get(block.id) ?? '', seq: historyRestoreSeq }}
                            onContentChange={onBlockContentChange}
                            onFocus={onEditorFocus}
                            onSelectionUpdate={onEditorSelectionUpdate}
                            onDelete={blocks.length > 1 ? () => deleteBlock(block.id) : undefined}
                            onDuplicate={block.type === 'section' ? () => duplicateBlock(block.id) : undefined}
                            onTransferSection={block.type === 'section' ? () => setTransferBlockId(block.id) : undefined}
                            onMoveActivate={block.type === 'section' ? () => {
                              setMoveModeId(block.id)
                              setSelectedBlockId(block.id)
                            } : undefined}
                            onResizeActivate={block.type === 'section' ? () => {
                              setResizeModeId(block.id)
                              setSelectedBlockId(block.id)
                            } : undefined}
                            onColorChange={block.type === 'section'
                              ? (color) => updateBlock(block.id, { sectionColor: color })
                              : undefined}
                            onNameChange={block.type === 'section'
                              ? (name) => updateBlock(block.id, { name })
                              : undefined}
                            onCollapseToggle={block.type === 'section'
                              ? () => updateBlock(block.id, { collapsed: !block.collapsed })
                              : undefined}
                            onPasteImage={block.type === 'section'
                              ? (file) => handlePasteImageIntoSection(block.id, file)
                              : undefined}
                            onSplitSection={block.type === 'section'
                              ? () => handleSplitSection(block.id)
                              : undefined}
                            onMergeSection={block.type === 'section'
                              ? () => handleMergeSection(block.id)
                              : undefined}
                            onUpdateBlock={block.type === 'section'
                              ? (updates) => updateBlock(block.id, updates)
                              : undefined}
                            onCellResizeStart={block.type === 'section'
                              ? (which, dir, e) => startCellResize(block.id, which, dir, e)
                              : undefined}
                            onDeleteImageCell={block.type === 'section'
                              ? (which) => handleDeleteImageCell(block.id, which)
                              : undefined}
                            onEditMindMapCell={block.type === 'section'
                              ? (which) => openEditMindMapForCell(block.id, which)
                              : undefined}
                            canMoveUp={idx > 0}
                            canMoveDown={idx < blocks.length - 1}
                            onMoveUp={() => moveBlock(block.id, -1)}
                            onMoveDown={() => moveBlock(block.id, 1)}
                          />
                        ) : (
                          <InlineMediaBlock
                            block={block}
                            isDark={isDark}
                            onEdit={() => openEditMindMapForImage(block.id)}
                            onMoveActivate={() => {
                              setMoveModeId(block.id)
                              setSelectedBlockId(block.id)
                            }}
                            onResizeActivate={() => {
                              setResizeModeId(block.id)
                              setSelectedBlockId(block.id)
                            }}
                            onDelete={() => deleteBlock(block.id)}
                            onCollapseToggle={() => updateBlock(block.id, { collapsed: !block.collapsed })}
                            onBeginDrag={e => startImagePressDrag(block.id, e)}
                            wasJustDragged={() => {
                              if (!suppressImageClickRef.current) return false
                              suppressImageClickRef.current = false
                              return true
                            }}
                          />
                        )}
                      </div>

                      {/* Resize handles only in explicit resize mode (3-dot menu → Resize) —
                          for images/drawings too now; plain selection no longer shows them. */}
                      {!isDragging && resizeModeId === block.id && (
                        (!block.collapsed && (block.type === 'image' || block.type === 'drawing')) ||
                        block.type === 'section'
                      ) && (
                        <ResizeHandles onResizeStart={(dir, e) => startBlockResize(block.id, dir, e)} />
                      )}
                    </GridBlockItem>
                  )

                  // Ghost slot after the last block
                  if (dragPos !== null && !isDraggedBlock && idx === blocks.length - 1 && dropIdx >= blocks.length) {
                    elements.push(
                      <GhostSlot key="__ghost_end__" colSpan={ghostColSpan} blockH={ghostBlockH} />
                    )
                  }

                  return elements
                })
              })()}
            </div>
          </div>

          {/* Listening indicator — small strip directly above the toolbar, only while Mic is active */}
          {isRecording && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              padding: '3px 0', flexShrink: 0,
              background: dockBg, borderTop: `0.5px solid ${dockBdr}`,
            }}>
              <span className="xp-mic-dot" aria-hidden="true" style={{ width: 6, height: 6, borderRadius: '50%', background: '#a78bfa', flexShrink: 0 }} />
              <span style={{ fontSize: 10.5, fontWeight: 600, color: '#c4b5fd', letterSpacing: '0.01em', userSelect: 'none' }}>
                Listening…
              </span>
            </div>
          )}

          {/* ── Editor tools bar (single row, horizontally scrollable) ──── */}
          <div style={{
            background: dockBg, borderTop: `0.5px solid ${dockBdr}`,
            boxShadow: 'inset 0 1px 0 rgba(124,58,237,0.10), 0 -4px 16px rgba(0,0,0,0.30)',
            flexShrink: 0, position: 'relative',
            display: 'flex', alignItems: 'stretch',
          }}>
            {/* Scroll wrapper — clips arrows and fills space left of Save Notes */}
            <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>

              {/* Left fade + arrow */}
              <div style={{
                position: 'absolute', left: 0, top: 0, bottom: 0, width: 28, zIndex: 3,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: `linear-gradient(90deg, ${dockBg} 50%, transparent)`,
                opacity: canScrollLeft ? 1 : 0, pointerEvents: canScrollLeft ? 'auto' : 'none',
                transition: 'opacity 160ms',
              }}>
                <button
                  className="xp-jd-nav-btn"
                  onMouseDown={e => { e.preventDefault(); toolbarScrollRef.current?.scrollBy({ left: -130, behavior: 'smooth' }) }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.70)', fontSize: 16, padding: '0 4px', lineHeight: 1 }}
                >‹</button>
              </div>

              {/* Scrollable tools row */}
              <div
                ref={toolbarScrollRef}
                onScroll={updateScrollArrows}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  overflowX: 'auto', padding: '8px 10px',
                  scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch',
                } as React.CSSProperties}
              >
                {/* ☷ List ▾ — Bullet Points / Numbers / Letters. Numbers and Letters are
                    the SAME orderedList node — Letters just sets its native `type: 'a'`
                    attribute (real <ol type="a"> — the browser continues a,b,c…z,aa,bb…
                    on its own, no custom numbering logic needed). Switching between any
                    of the three always changes the existing list in place, never stacks. */}
                <ListPicker
                  activeType={
                    isActive('bulletList') ? 'bullet'
                    : isActive('orderedList', { type: 'a' }) ? 'letters'
                    : isActive('orderedList') ? 'numbers'
                    : null
                  }
                  onPick={type => {
                    const ed = focusedEditor.current
                    if (!ed) return
                    if (type === 'bullet') { ed.chain().focus().toggleBulletList().run(); return }
                    if (!ed.isActive('orderedList')) ed.chain().focus().toggleOrderedList().run()
                    ed.chain().focus().updateAttributes('orderedList', { type: type === 'letters' ? 'a' : null }).run()
                  }}
                />
                {/* ☐ Check */}
                <button
                  className={`xp-jd-btn${isActive('taskList') ? ' xp-j-active' : ''}`}
                  style={dockBtn(isActive('taskList'))}
                  onClick={() => focusedEditor.current?.chain().focus().toggleTaskList().run()}
                  title="Interactive checklist"
                >☐ Check</button>

                <span style={{ width: 1, height: 18, background: dockDiv, flexShrink: 0, margin: '0 2px' }} />

                {/* + Section — mobile primary slot (desktop version lives after Draw) */}
                <div className="xp-jd-sec-mo">
                  <SectionPicker isDark={isDark} onPick={color => {
                    insertBlock(createSectionBlock(color), blocks.length - 1)
                  }} />
                </div>

                {/* ⇥ Indent — desktop primary slot (mobile version lives after Undo/Redo) */}
                <button
                  className="xp-jd-btn xp-jd-ind-dt"
                  style={dockBtn()}
                  onMouseDown={e => e.preventDefault()}
                  onClick={handleIndent}
                  title="Indent (nest into sub-item)"
                >⇥ Indent</button>
                {/* ↳ Sub-item — ON/OFF toggle: parent→child hierarchy with connector line, distinct from Indent */}
                <button
                  className={`xp-jd-btn${isSubItem() ? ' xp-j-active' : ''}`}
                  style={dockBtn(isSubItem())}
                  onMouseDown={e => e.preventDefault()}
                  onClick={handleSubItem}
                  title={isSubItem() ? 'Remove sub-item (return to parent level)' : 'Sub-item (nest as a child of the item above)'}
                  aria-label="Sub-item"
                >↳ Sub-item</button>
                {/* ↺ Undo — icon only + mobile tap tooltip */}
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  <button
                    className="xp-jd-btn"
                    style={{ ...dockBtn(), padding: '5px 9px' }}
                    onClick={() => {
                      if (typeof window !== 'undefined' && window.innerWidth < 641) {
                        customUndo()
                      } else {
                        // Fall back to the Planner-level undo stack whenever the
                        // focused Tiptap editor is gone (e.g. destroyed by Merge
                        // Section unmounting its pane) or has nothing left in its
                        // own local history — never call .chain() on a stale/
                        // destroyed editor. Structural ops like Merge/Split live
                        // only in the Planner history, not in any one editor's.
                        const ed = focusedEditor.current
                        if (ed && !ed.isDestroyed && ed.can().undo()) ed.chain().focus().undo().run()
                        else customUndo()
                      }
                      showUndoRedoTip('undo')
                    }}
                    title="Undo"
                    aria-label="Undo"
                  >
                    <svg viewBox="0 0 18 18" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M2.5 9A6.5 6.5 0 1 0 4.4 4.4"/>
                      <polyline points="2 2 2 7.5 7.5 7.5"/>
                    </svg>
                  </button>
                  {undoRedoTip === 'undo' && <div className="xp-jd-tip">Undo</div>}
                </div>
                {/* ↻ Redo — icon only + mobile tap tooltip */}
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  <button
                    className="xp-jd-btn"
                    style={{ ...dockBtn(), padding: '5px 9px' }}
                    onClick={() => {
                      if (typeof window !== 'undefined' && window.innerWidth < 641) {
                        customRedo()
                      } else {
                        const ed = focusedEditor.current
                        if (ed && !ed.isDestroyed && ed.can().redo()) ed.chain().focus().redo().run()
                        else customRedo()
                      }
                      showUndoRedoTip('redo')
                    }}
                    title="Redo"
                    aria-label="Redo"
                  >
                    <svg viewBox="0 0 18 18" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M15.5 9A6.5 6.5 0 1 1 13.6 4.4"/>
                      <polyline points="16 2 16 7.5 10.5 7.5"/>
                    </svg>
                  </button>
                  {undoRedoTip === 'redo' && <div className="xp-jd-tip">Redo</div>}
                </div>

                <span style={{ width: 1, height: 18, background: dockDiv, flexShrink: 0, margin: '0 2px' }} />

                {/* ⇥ Indent — mobile secondary slot (hidden on desktop) */}
                <button
                  className="xp-jd-btn xp-jd-ind-mo"
                  style={dockBtn()}
                  onMouseDown={e => e.preventDefault()}
                  onClick={handleIndent}
                  title="Indent (nest into sub-item)"
                >⇥ Indent</button>

                {/* Upload */}
                <label style={{ ...dockBtn(), cursor: 'pointer' }} title="Upload image" className="xp-jd-btn">
                  📎 Upload
                  <input
                    type="file" multiple accept={ATTACHMENT_ACCEPT}
                    style={{ display: 'none' }}
                    onChange={e => { handleUploadAtEnd(e.target.files); e.currentTarget.value = '' }}
                  />
                </label>
                {/* Camera */}
                <button
                  className="xp-jd-btn"
                  style={dockBtn()}
                  onClick={() => setCameraInsertAt(blocks.length - 1)}
                  title="Take a photo"
                >📷 Camera</button>

                <span style={{ width: 1, height: 18, background: dockDiv, flexShrink: 0, margin: '0 2px' }} />

                {/* Mind Map — opens the Mind Mapping Canvas (internal name stays drawState/createDrawingBlock) */}
                <button
                  className="xp-jd-btn"
                  style={dockBtn()}
                  onClick={() => setDrawState({ insertAt: blocks.length - 1, editingBlock: null })}
                  title="Open Mind Mapping Canvas"
                >🧠 Mind Map</button>

                {/* + Section — desktop slot (mobile version is before Undo/Redo) */}
                <div className="xp-jd-sec-dt" style={{ display: 'contents' }}>
                  <SectionPicker isDark={isDark} onPick={color => {
                    insertBlock(createSectionBlock(color), blocks.length - 1)
                  }} />
                </div>

                <span style={{ width: 1, height: 18, background: dockDiv, flexShrink: 0, margin: '0 2px' }} />

                {/* ── Journal Session Timer ─────────────────────────────── */}
                {(() => {
                  const isRunning   = timerStartTs !== null
                  const totalMs     = calcTotalMs(timerSessions, timerElapsedMs)
                  const hasSessions = timerSessions.length > 0
                  return (
                    <div ref={timerWrapperRef} style={{ position: 'relative', flexShrink: 0 }}>
                      <button
                        className="xp-jd-btn"
                        onClick={() => isRunning ? timerStop() : timerStart()}
                        title={isRunning ? 'Stop timer' : 'Start journaling timer'}
                        style={{
                          ...dockBtn(isRunning),
                          fontVariantNumeric: 'tabular-nums',
                          minWidth: isRunning ? 74 : hasSessions ? 60 : 76,
                          textAlign: 'center',
                          letterSpacing: isRunning ? '0.02em' : 'normal',
                        }}
                      >
                        {isRunning
                          ? `■ ${fmtTimerElapsed(timerElapsedMs)}`
                          : hasSessions
                            ? `▶ ${fmtTimerDuration(totalMs)}`
                            : '▶ Timer'}
                      </button>
                      {hasSessions && !isRunning && (
                        <button
                          ref={timerBadgeBtnRef}
                          onClick={() => {
                            if (showSessions) { setShowSessions(false); return }
                            const rect = timerBadgeBtnRef.current?.getBoundingClientRect()
                            if (rect) {
                              const left = Math.min(rect.left, window.innerWidth - 240 - 12)
                              setSessionsPopPos({ left: Math.max(8, left), bottom: window.innerHeight - rect.top + 8 })
                            }
                            setShowSessions(true)
                            setConfirmDeleteIdx(null)
                          }}
                          title="View journal sessions"
                          style={{
                            position: 'absolute', top: -6, right: -6,
                            width: 14, height: 14, borderRadius: '50%', border: 'none',
                            background: showSessions ? 'rgba(124,58,237,0.70)' : 'rgba(124,58,237,0.38)',
                            color: '#fff', fontSize: 8, lineHeight: '14px', textAlign: 'center',
                            cursor: 'pointer', fontWeight: 700, padding: 0,
                          }}
                        >{timerSessions.length}</button>
                      )}
                      {showSessions && sessionsPopPos && (
                        <div style={{
                          position: 'fixed', bottom: sessionsPopPos.bottom, left: sessionsPopPos.left,
                          minWidth: 240, maxWidth: 280, maxHeight: '60vh', overflowY: 'auto', zIndex: 9999,
                          background: 'rgba(10,6,30,0.98)',
                          border: '0.5px solid rgba(124,58,237,0.28)',
                          borderRadius: 10, padding: '10px 14px 12px',
                          boxShadow: '0 8px 32px rgba(0,0,0,0.65)',
                          animation: 'xpSecMenuIn 140ms cubic-bezier(0.16,1,0.3,1) both',
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                            <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'rgba(255,255,255,0.38)', userSelect: 'none' }}>
                              Journal Time
                            </div>
                            {/* Closes the whole popup — visibly larger than each session's
                                own small × so the hierarchy (close-all vs delete-one) is obvious. */}
                            <button
                              onClick={() => { setShowSessions(false); setConfirmDeleteIdx(null) }}
                              title="Close"
                              aria-label="Close"
                              style={{
                                width: 22, height: 22, borderRadius: 6, flexShrink: 0,
                                border: 'none', background: 'transparent', color: 'rgba(255,255,255,0.55)',
                                fontSize: 16, lineHeight: 1, cursor: 'pointer',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
                              }}
                              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#fff' }}
                              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.55)' }}
                            >×</button>
                          </div>
                          {timerSessions.map((s, i) => {
                            const isPending = confirmDeleteIdx === i
                            return (
                              <div key={i} style={{ marginBottom: 10 }}>
                                <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'rgba(255,255,255,0.28)', marginBottom: 3, userSelect: 'none' }}>
                                  Session {i + 1}
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)', whiteSpace: 'nowrap', flex: 1 }}>
                                    {fmtBlockTime(s.startTs)} – {fmtBlockTime(s.endTs)}
                                  </span>
                                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.38)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                                    {fmtTimerDuration(s.endTs - s.startTs)}
                                  </span>
                                  {isPending ? (
                                    <button
                                      data-confirm-del="1"
                                      onClick={() => deleteTimerSession(i)}
                                      title="Confirm — permanently delete this session"
                                      style={{
                                        padding: '1px 6px', borderRadius: 4, flexShrink: 0,
                                        border: '0.5px solid rgba(239,68,68,0.55)',
                                        background: 'rgba(239,68,68,0.18)', color: '#fca5a5',
                                        fontSize: 10, cursor: 'pointer', whiteSpace: 'nowrap',
                                      }}
                                    >Delete?</button>
                                  ) : (
                                    <button
                                      onClick={() => setConfirmDeleteIdx(i)}
                                      title="Delete session"
                                      style={{
                                        width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                                        border: 'none', background: 'transparent',
                                        color: 'rgba(255,255,255,0.20)',
                                        fontSize: 13, lineHeight: 1, cursor: 'pointer',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        padding: 0,
                                      }}
                                      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#fca5a5' }}
                                      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.20)' }}
                                    >×</button>
                                  )}
                                </div>
                              </div>
                            )
                          })}
                          <div style={{ height: '0.5px', background: 'rgba(255,255,255,0.08)', margin: '4px 0 8px' }} />
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>Total</span>
                            <span style={{ fontSize: 12, fontWeight: 600, color: '#c4b5fd', fontVariantNumeric: 'tabular-nums' }}>
                              {fmtTimerDuration(totalMs)}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })()}

                {/* Mic — visible on desktop; on mobile it moves to the lower nav row */}
                <button
                  className={`xp-jd-btn xp-jd-mic-toolbar${isRecording ? ' xp-j-mic-rec' : ''}`}
                  onClick={handleVoiceToggle}
                  title={isRecording ? 'Recording… Tap to stop' : 'Voice to Notes'}
                  style={{
                    ...dockBtn(isRecording),
                    flexShrink: 0,
                    ...(isRecording ? {
                      background: 'rgba(239,68,68,0.22)',
                      border: '0.5px solid rgba(239,68,68,0.65)',
                      color: '#fca5a5',
                    } : {}),
                  }}
                >🎙 {isRecording ? 'Stop' : 'Mic'}</button>

                {/* 😊 */}
                <button
                  ref={emojiBtnRef}
                  className="xp-jd-btn"
                  onClick={() => setShowEmoji(v => !v)}
                  title="Add emoji"
                  style={{ ...dockBtn(), flexShrink: 0, fontSize: 16, padding: '4px 9px', lineHeight: 1, borderRadius: 8 }}
                >😊</button>
              </div>

              {/* Right fade + arrow */}
              <div style={{
                position: 'absolute', right: 0, top: 0, bottom: 0, width: 28, zIndex: 3,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: `linear-gradient(270deg, ${dockBg} 50%, transparent)`,
                opacity: canScrollRight ? 1 : 0, pointerEvents: canScrollRight ? 'auto' : 'none',
                transition: 'opacity 160ms',
              }}>
                <button
                  className="xp-jd-nav-btn"
                  onMouseDown={e => { e.preventDefault(); toolbarScrollRef.current?.scrollBy({ left: 130, behavior: 'smooth' }) }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.70)', fontSize: 16, padding: '0 4px', lineHeight: 1 }}
                >›</button>
              </div>
            </div>

            {/* Save — always pinned on right */}
            <div style={{
              flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 12px', borderLeft: `0.5px solid ${dockDiv}`,
              background: dockBg,
            }}>
              {/* ✓ Saved — desktop/tablet only; space always reserved so Save button never shifts */}
              <span className="xp-j-saved-txt" style={{
                fontSize: 11, whiteSpace: 'nowrap', userSelect: 'none', flexShrink: 0,
                color: '#16a34a', fontWeight: 600,
                opacity: saveStatus === 'saved' ? 1 : 0,
                transition: 'opacity 200ms',
              }}>✓ Saved</span>
              <button
                className={`xp-j-save-btn${saveStatus === 'saved' ? ' xp-j-save-btn-saved' : ''}`}
                onClick={handleManualSave}
                style={{
                  padding: '6px 18px', borderRadius: 8, border: 'none', cursor: 'pointer',
                  background: 'linear-gradient(135deg, #7c3aed, #6d28d9)',
                  color: '#fff', fontSize: 12, fontWeight: 700,
                  boxShadow: '0 2px 10px rgba(124,58,237,0.45)',
                  whiteSpace: 'nowrap',
                  position: 'relative', overflow: 'hidden',
                }}
              >
                <span className="xp-j-save-lbl">Save</span>
                {/* Mobile in-button saved state — absolutely overlays "Save" text */}
                <span className="xp-j-saved-mob" style={{
                  position: 'absolute', inset: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 700,
                }}>✓ Saved</span>
              </button>
            </div>

            {/* Voice error toast */}
            {voiceError && (
              <div style={{
                position: 'absolute', bottom: 'calc(100% + 6px)', right: 16,
                background: 'rgba(30,6,10,0.97)', border: '0.5px solid rgba(239,68,68,0.50)',
                color: '#fca5a5', fontSize: 11, padding: '7px 10px 7px 12px',
                borderRadius: 8, maxWidth: 300, zIndex: 61,
                boxShadow: '0 4px 16px rgba(0,0,0,0.55)',
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <span style={{ flex: 1, lineHeight: 1.45 }}>{voiceError}</span>
                <button
                  onMouseDown={e => { e.preventDefault(); setVoiceError(null) }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(252,165,165,0.70)', fontSize: 14, flexShrink: 0, padding: 0 }}
                >✕</button>
              </div>
            )}

            {/* Emoji picker */}
            {showEmoji && (
              <div id="xp-j-emoji" style={{
                position: 'absolute', bottom: 'calc(100% + 8px)', right: 130, zIndex: 100,
                borderRadius: 12, overflow: 'hidden',
                boxShadow: `0 8px 32px rgba(0,0,0,${isDark ? '0.50' : '0.20'})`,
              }}>
                <EmojiPicker
                  onEmojiClick={handleEmojiClick}
                  theme={isDark ? Theme.DARK : Theme.LIGHT}
                  width={300} height={360}
                  searchPlaceHolder="Search emoji…"
                  lazyLoadEmojis
                />
              </div>
            )}
          </div>

          {/* ── Navigation bar ─────────────────────────────────────────────── */}
          {(onJournalCalendar || onLibrary || onEditor) && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              padding: '10px 16px', flexShrink: 0,
              borderTop: '0.5px solid rgba(124,58,237,0.20)',
              background: 'rgba(8,20,58,0.98)',
              boxShadow: 'inset 0 1px 0 rgba(124,58,237,0.10), 0 -6px 24px rgba(0,0,0,0.40)',
            }}>
              {onJournalCalendar && (
                <button
                  className="xp-jd-btn"
                  style={dockBtn()}
                  onClick={() => guardedNavigate(onJournalCalendar)}
                  title="Journal Calendar"
                >📅 Journal Calendar</button>
              )}
              {onLibrary && (
                <button
                  className="xp-jd-btn"
                  style={dockBtn()}
                  onClick={() => guardedNavigate(onLibrary)}
                  title="Library"
                >📚 Library</button>
              )}
              {onEditor && (
                <button
                  className="xp-jd-btn"
                  style={dockBtn(true)}
                  onClick={onEditor}
                  title="Planner/Journal Editor"
                >✏️ Editor</button>
              )}
              {/* Mic — mobile only (hidden on desktop via CSS), always active in Editor view */}
              <button
                className={`xp-jd-btn xp-jd-mic-nav${isRecording ? ' xp-j-mic-rec' : ''}`}
                onClick={handleVoiceToggle}
                title={isRecording ? 'Recording… Tap to stop' : 'Voice to Notes'}
                style={{
                  ...dockBtn(isRecording),
                  flexShrink: 0,
                  ...(isRecording ? {
                    background: 'rgba(239,68,68,0.22)',
                    border: '0.5px solid rgba(239,68,68,0.65)',
                    color: '#fca5a5',
                  } : {}),
                }}
              >🎙 {isRecording ? 'Stop' : 'Mic'}</button>
            </div>
          )}

          {/* ── Floating clone: follows mouse during drag-move ─────────────── */}
          {dragPos !== null && dragMoveRef.current && (() => {
            const d = dragMoveRef.current!
            const draggedBlock = blocks.find(b => b.id === d.blockId)
            if (!draggedBlock) return null
            return (
              <div
                style={{
                  position: 'fixed',
                  left: dragPos.x - d.offsetX,
                  top:  dragPos.y - d.offsetY,
                  width: d.blockW,
                  height: d.blockH,
                  pointerEvents: 'none',
                  zIndex: 9999,
                  opacity: 0.88,
                  borderRadius: 10,
                  border: '1.5px solid rgba(124,58,237,0.60)',
                  boxShadow: '0 8px 32px rgba(0,0,0,0.45), 0 0 0 1px rgba(124,58,237,0.20)',
                  overflow: 'hidden',
                  background: isDark ? 'rgba(18,10,38,0.96)' : 'rgba(255,255,255,0.96)',
                }}
              >
                {draggedBlock.src && (
                  <img
                    src={draggedBlock.src}
                    alt=""
                    style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
                    draggable={false}
                  />
                )}
              </div>
            )
          })()}

          {/* ── Alignment guides: thin fixed lines at edge proximity ───────── */}
          {snapGuides.map((g, i) => (
            g.type === 'v' ? (
              <div key={i} style={{
                position: 'fixed',
                left: g.coord,
                top: g.from,
                width: 1,
                height: g.to - g.from,
                background: 'rgba(124,58,237,0.70)',
                boxShadow: '0 0 4px rgba(124,58,237,0.40)',
                pointerEvents: 'none',
                zIndex: 9998,
              }} />
            ) : (
              <div key={i} style={{
                position: 'fixed',
                left: g.from,
                top: g.coord,
                width: g.to - g.from,
                height: 1,
                background: 'rgba(124,58,237,0.70)',
                boxShadow: '0 0 4px rgba(124,58,237,0.40)',
                pointerEvents: 'none',
                zIndex: 9998,
              }} />
            )
          ))}

          {/* ── Floating text formatter ─────────────────────────────────────── */}
          {selectionRect && focusedEditor.current && (
            <FloatingFormatter editor={focusedEditor.current} rect={selectionRect} />
          )}
        </>
      ))}

      {/* ── Modals ─────────────────────────────────────────────────────────── */}
      {cameraInsertAt !== null && (
        <CameraModal
          onCapture={file => {
            handleUploadAtEnd([file], true)
            setCameraInsertAt(null)
          }}
          onClose={() => setCameraInsertAt(null)}
        />
      )}

      {/* ── Transfer Section modal ────────────────────────────────────────── */}
      {transferBlockId && (() => {
        const block = blocks.find(b => b.id === transferBlockId)
        if (!block) return null
        return (
          <TransferSectionModal
            dateKey={dateKey}
            sectionLabel={block.name ?? ''}
            onClose={() => setTransferBlockId(null)}
            onConfirm={(mode, destKey) => {
              transferSection(mode, transferBlockId, destKey)
              setTransferBlockId(null)
            }}
          />
        )
      })()}

      {/* ── Unsaved-changes guard dialog ──────────────────────────────────── */}
      {showExitDialog && (
        <UnsavedChangesDialog
          onKeepEditing={() => {
            setShowExitDialog(false)
            pendingNavRef.current = null
          }}
          onExitWithoutSaving={commitExitWithoutSaving}
          onSaveAndExit={commitSaveAndExit}
        />
      )}
    </>
  )
}

// ─── List picker inline component — consolidates Bullet/Numbered into one control ──

function ListPicker({ activeType, onPick }: { activeType: 'bullet' | 'numbers' | 'letters' | null; onPick: (type: 'bullet' | 'numbers' | 'letters') => void }) {
  const [open, setOpen] = useState(false)
  const [popPos, setPopPos] = useState<{ left: number; bottom: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    function outside(e: MouseEvent | TouchEvent) {
      if (ref.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', outside)
    document.addEventListener('touchstart', outside)
    return () => {
      document.removeEventListener('mousedown', outside)
      document.removeEventListener('touchstart', outside)
    }
  }, [open])

  function handleToggle() {
    if (open) { setOpen(false); return }
    const rect = btnRef.current?.getBoundingClientRect()
    if (rect) setPopPos({ left: rect.left, bottom: window.innerHeight - rect.top + 6 })
    setOpen(true)
  }

  const isActiveList = activeType !== null

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        ref={btnRef}
        className={`xp-jd-btn${isActiveList ? ' xp-j-active' : ''}`}
        style={dockBtn(isActiveList || open)}
        onMouseDown={e => e.preventDefault()}
        onClick={handleToggle}
        title="List"
      >☷ List <span style={{ fontSize: 8, opacity: 0.7, marginLeft: 1 }}>▾</span></button>

      {open && popPos && (
        <div className="xp-j-sec-menu" style={{
          position: 'fixed', bottom: popPos.bottom, left: popPos.left, zIndex: 9999,
          background: '#160a30',
          border: '0.5px solid rgba(124,58,237,0.32)',
          borderRadius: 10,
          boxShadow: '0 8px 32px rgba(0,0,0,0.65)',
          padding: '6px', overflow: 'hidden', minWidth: 148,
          display: 'flex', flexDirection: 'column', gap: 2,
        }}>
          <button
            onClick={() => { onPick('bullet'); setOpen(false) }}
            style={{
              ...menuItemStyle(true), display: 'flex', alignItems: 'center', gap: 8, borderRadius: 7,
              color: activeType === 'bullet' ? '#c4b5fd' : 'rgba(255,255,255,0.82)',
              fontWeight: activeType === 'bullet' ? 600 : 400,
            }}
          >• Bullet Points{activeType === 'bullet' && <span style={{ marginLeft: 'auto', fontSize: 10 }}>✓</span>}</button>
          <button
            onClick={() => { onPick('numbers'); setOpen(false) }}
            style={{
              ...menuItemStyle(true), display: 'flex', alignItems: 'center', gap: 8, borderRadius: 7,
              color: activeType === 'numbers' ? '#c4b5fd' : 'rgba(255,255,255,0.82)',
              fontWeight: activeType === 'numbers' ? 600 : 400,
            }}
          >1. Numbers{activeType === 'numbers' && <span style={{ marginLeft: 'auto', fontSize: 10 }}>✓</span>}</button>
          <button
            onClick={() => { onPick('letters'); setOpen(false) }}
            style={{
              ...menuItemStyle(true), display: 'flex', alignItems: 'center', gap: 8, borderRadius: 7,
              color: activeType === 'letters' ? '#c4b5fd' : 'rgba(255,255,255,0.82)',
              fontWeight: activeType === 'letters' ? 600 : 400,
            }}
          >a. Letters{activeType === 'letters' && <span style={{ marginLeft: 'auto', fontSize: 10 }}>✓</span>}</button>
        </div>
      )}
    </div>
  )
}

// ─── Section picker inline component ─────────────────────────────────────────

function SectionPicker({ isDark, onPick }: { isDark: boolean; onPick: (c: SectionColorKey) => void }) {
  const [open, setOpen] = useState(false)
  const [hoveredKey, setHoveredKey] = useState<string | null>(null)
  const [popPos, setPopPos] = useState<{ left: number; bottom: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    function outside(e: MouseEvent | TouchEvent) {
      if (ref.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', outside)
    document.addEventListener('touchstart', outside)
    return () => {
      document.removeEventListener('mousedown', outside)
      document.removeEventListener('touchstart', outside)
    }
  }, [open])

  function handleToggle() {
    if (open) { setOpen(false); return }
    const rect = btnRef.current?.getBoundingClientRect()
    if (rect) {
      setPopPos({ left: rect.left, bottom: window.innerHeight - rect.top + 6 })
    }
    setOpen(true)
  }

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        ref={btnRef}
        className="xp-jd-btn"
        style={{
          padding: '5px 11px', borderRadius: 7, cursor: 'pointer',
          border: `0.5px solid ${open ? 'rgba(124,58,237,0.70)' : 'rgba(124,58,237,0.38)'}`,
          background: open ? 'rgba(124,58,237,0.30)' : 'rgba(124,58,237,0.10)',
          color: '#c4b5fd',
          fontSize: 12, fontWeight: open ? 600 : 500,
          transition: 'all 120ms', flexShrink: 0, whiteSpace: 'nowrap' as const,
        }}
        onClick={handleToggle}
        title="Add a colored section"
      >+ Section</button>

      {open && popPos && (
        <div className="xp-j-sec-menu" style={{
          position: 'fixed', bottom: popPos.bottom, left: popPos.left, zIndex: 9999,
          background: '#160a30',
          border: '0.5px solid rgba(124,58,237,0.32)',
          borderRadius: 10,
          boxShadow: '0 8px 32px rgba(0,0,0,0.65)',
          padding: '6px', overflow: 'hidden', minWidth: 152,
          display: 'flex', flexDirection: 'column', gap: 2,
        }}>
          {SECTION_COLORS.map(c => {
            const isHovered = hoveredKey === c.key
            const swatch = getSectionStyle(c.key, true)
            const isPlainSwatch = c.key === 'plain'
            return (
              <button
                key={c.key}
                onClick={() => { onPick(c.key as SectionColorKey); setOpen(false) }}
                onMouseEnter={() => setHoveredKey(c.key)}
                onMouseLeave={() => setHoveredKey(null)}
                style={{
                  ...menuItemStyle(true),
                  display: 'flex', alignItems: 'center', gap: 9,
                  borderRadius: 7,
                  background: isHovered ? 'rgba(124,58,237,0.16)' : 'transparent',
                  transform: isHovered ? 'translateY(-1px)' : 'none',
                  transition: 'background 100ms, transform 100ms, box-shadow 100ms',
                  boxShadow: isHovered ? '0 2px 8px rgba(124,58,237,0.18)' : 'none',
                }}
              >
                <span style={{
                  width: 13, height: 13, borderRadius: '50%', flexShrink: 0,
                  transition: 'transform 100ms, box-shadow 100ms',
                  transform: isHovered ? 'scale(1.22)' : 'scale(1)',
                  boxShadow: isHovered ? `0 0 6px ${swatch.labelColor}99` : 'none',
                  ...(isPlainSwatch
                    ? { background: 'rgba(255,255,255,0.12)', border: '1.5px solid rgba(255,255,255,0.32)' }
                    : { background: swatch.labelColor }
                  ),
                }} />
                {c.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

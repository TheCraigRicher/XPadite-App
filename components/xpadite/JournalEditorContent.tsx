'use client'

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Placeholder from '@tiptap/extension-placeholder'
import Underline from '@tiptap/extension-underline'
import { TextStyle } from '@tiptap/extension-text-style'
import { Color } from '@tiptap/extension-color'
import { Theme } from 'emoji-picker-react'
import type { EmojiClickData } from 'emoji-picker-react'
import dynamic from 'next/dynamic'
import { buildAttachments, ATTACHMENT_ACCEPT, CameraModal, ImageLightbox } from './attachmentUtils'
import type { JournalBlock, JournalTimerSession, TaskAttachment } from './types'
import { JournalDrawModal } from './JournalDrawModal'
import {
  parseJournalDoc, parseJournalContent, serializeJournalContent,
  getSectionStyle, SECTION_COLORS, createTextBlock, createSectionBlock,
  createDrawingBlock, createImageBlock,
} from './journalUtils'
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

// ─── JournalTextBlock ─────────────────────────────────────────────────────────

interface JournalTextBlockProps {
  block: JournalBlock
  isDark: boolean
  isOnlyBlock: boolean
  onContentChange: (id: string, content: string) => void
  onFocus: (editor: Editor) => void
  onSelectionUpdate: () => void
  onDelete?: () => void
  onMoveActivate?: () => void
  onResizeActivate?: () => void
  onColorChange?: (color: SectionColorKey) => void
  onNameChange?: (name: string | undefined) => void
  canMoveUp: boolean
  canMoveDown: boolean
  onMoveUp: () => void
  onMoveDown: () => void
}

const JournalTextBlock = React.memo(function JournalTextBlock({
  block, isDark, isOnlyBlock,
  onContentChange, onFocus, onSelectionUpdate,
  onDelete, onMoveActivate, onResizeActivate, onColorChange, onNameChange,
  canMoveUp, canMoveDown, onMoveUp, onMoveDown,
}: JournalTextBlockProps) {
  const [menuOpen,       setMenuOpen]       = useState(false)
  const [showColorPick,  setShowColorPick]  = useState(false)
  const [addingTitle,    setAddingTitle]    = useState(false)
  const [titleValue,     setTitleValue]     = useState(block.name ?? '')
  const menuRef      = useRef<HTMLDivElement>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        codeBlock: false, blockquote: false,
        strike: false, code: false, horizontalRule: false,
        // bold and italic enabled (default)
      }),
      TaskList,
      TaskItem.configure({ nested: false }),
      Placeholder.configure({
        placeholder: block.type === 'section'
          ? 'Add section content…'
          : 'What made today great? Reflections, insights, gratitude…',
      }),
      Underline,
      TextStyle,
      Color,
    ],
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
    editorProps: { attributes: { class: 'xp-j-prose' } },
    onUpdate: ({ editor: e }) => onContentChange(block.id, serializeJournalContent(e)),
  })

  useEffect(() => {
    if (!editor) return
    editor.commands.setContent(parseJournalContent(block.content || ''))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, block.id])

  useEffect(() => {
    if (!editor) return
    const onF = () => onFocus(editor)
    const onS = () => onSelectionUpdate()
    editor.on('focus', onF)
    editor.on('selectionUpdate', onS)
    return () => { editor.off('focus', onF); editor.off('selectionUpdate', onS) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor])

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

  function commitTitle() {
    const trimmed = titleValue.trim()
    onNameChange?.(trimmed || undefined)
    setAddingTitle(false)
  }

  const isSection   = block.type === 'section'
  const sectionStyle = isSection
    ? getSectionStyle(block.sectionColor ?? 'plain', isDark)
    : null
  const hasTitle = isSection && !!block.name
  const hasMenu  = isSection ? true : canMoveUp || canMoveDown || (!!onDelete && !isOnlyBlock)

  return (
    <div
      className={isSection ? 'xp-j-sec-wrap' : undefined}
      style={{
        position: 'relative',
        borderRadius: sectionStyle ? 10 : 0,
        border: sectionStyle ? `0.5px solid ${sectionStyle.border}` : 'none',
        background: sectionStyle ? sectionStyle.background : 'transparent',
        padding: sectionStyle ? '12px 40px 12px 14px' : '0',
        marginBottom: sectionStyle ? 4 : 0,
        ...(isSection && block.height != null ? { minHeight: block.height } : {}),
      }}
    >

      {/* Optional section title */}
      {isSection && (hasTitle || addingTitle) ? (
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
              marginBottom: 6, cursor: 'text',
              lineHeight: 1.3,
            }}
          >{block.name}</div>
        )
      ) : isSection ? (
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
      ) : null}

      {/* Editor */}
      <div onClick={() => editor?.commands.focus()} style={{ cursor: 'text' }}>
        <EditorContent editor={editor} />
      </div>

      {/* Section timestamp — bottom-right, quiet metadata */}
      {isSection && (
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
                    <button onClick={() => setShowColorPick(true)} style={menuItemStyle(isDark)}>
                      🎨 Change Color
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
    </div>
  )
})

// ─── InlineMediaBlock ─────────────────────────────────────────────────────────

interface InlineMediaBlockProps {
  block: JournalBlock
  isDark: boolean
  onEdit: () => void
  onMoveActivate: () => void
  onDelete: () => void
}

function InlineMediaBlock({ block, isDark, onEdit, onMoveActivate, onDelete }: InlineMediaBlockProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [lightbox, setLightbox] = useState(false)
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
    <div style={{ position: 'relative', margin: '4px 0' }}>
      {/* Image — explicit height when user has resized vertically */}
      {block.src && (
        <img
          src={block.thumbnail ?? block.src}
          alt={block.name ?? (block.type === 'drawing' ? 'Drawing' : 'Image')}
          onClick={() => setLightbox(true)}
          style={{
            display: 'block', cursor: 'zoom-in',
            width: '100%',
            height: block.height != null ? block.height + 'px' : 'auto',
            objectFit: block.height != null ? 'contain' : undefined,
            borderRadius: 10,
            border: `0.5px solid ${isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)'}`,
            boxShadow: isDark ? '0 2px 12px rgba(0,0,0,0.35)' : '0 2px 8px rgba(0,0,0,0.08)',
          }}
        />
      )}

      {/* Label — hidden once explicit height is set (keeps handle positions clean) */}
      {block.name && block.height == null && (
        <div style={{
          fontSize: 10, color: isDark ? 'rgba(255,255,255,0.40)' : 'rgba(0,0,0,0.40)',
          marginTop: 4, textAlign: 'center', userSelect: 'none',
        }}>
          {block.type === 'drawing' ? '✏️ ' : '📷 '}{block.name}
        </div>
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
            <button onClick={() => setMenuOpen(false)} style={menuItemStyle(isDark)}>
              ⤡ Resize
            </button>
            {block.type === 'drawing' && (
              <button onClick={() => { onEdit(); setMenuOpen(false) }} style={menuItemStyle(isDark)}>
                ✏️ Edit Drawing
              </button>
            )}
            <button onClick={() => { onDelete(); setMenuOpen(false) }} style={{ ...menuItemStyle(isDark), color: '#f87171' }}>
              🗑 Delete
            </button>
          </div>
        )}
      </div>

      {lightbox && block.src && (
        <ImageLightbox src={block.src} alt={block.name ?? 'Image'} onClose={() => setLightbox(false)} />
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
  const [showSize,  setShowSize]  = useState(false)
  const [showColor, setShowColor] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close sub-menus on outside click
  useEffect(() => {
    if (!showSize && !showColor) return
    function outside(e: MouseEvent) {
      if (ref.current?.contains(e.target as Node)) return
      setShowSize(false)
      setShowColor(false)
    }
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [showSize, showColor])

  if (!editor) return null

  const isBold      = editor.isActive('bold')
  const isItalic    = editor.isActive('italic')
  const isUnderline = editor.isActive('underline')
  const isH2        = editor.isActive('heading', { level: 2 })
  const isH3        = editor.isActive('heading', { level: 3 })
  const sizeLabel   = isH2 ? 'Heading' : isH3 ? 'Large' : 'Normal'

  // Active color: what the current selection has (null = default)
  const activeColor: string | null = (editor.getAttributes('textStyle').color as string | undefined) ?? null
  const hasCustomColor = activeColor !== null

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
          onMouseDown={e => { e.preventDefault(); setShowColor(v => !v); setShowSize(false) }}
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

      {divider}

      {/* Size ▼ */}
      <div style={{ position: 'relative' }}>
        <button
          style={{ ...fBtn(false), display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, whiteSpace: 'nowrap' as const }}
          onMouseDown={e => { e.preventDefault(); setShowSize(v => !v); setShowColor(false) }}
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
  // Legacy props — accepted for backward compat; attachments now live as inline blocks
  attachments?: TaskAttachment[]
  onAttachmentsChange?: (atts: TaskAttachment[]) => void
}

// ─── Main component ───────────────────────────────────────────────────────────

export function JournalEditorContent({
  dateKey, rawContent, isDark, isEditorOnToday,
  onContentChange, onPersist,
  onNavigateDay, onNavigateToday, onBack, onClose,
}: JournalEditorContentProps) {

  // ── State ───────────────────────────────────────────────────────────────────
  const [blocks, setBlocks]             = useState<JournalBlock[]>([])
  const [saveStatus, setSaveStatus]     = useState<'idle' | 'saved'>('idle')
  const [showEmoji, setShowEmoji]       = useState(false)
  const [cameraInsertAt, setCameraInsertAt] = useState<number | null>(null)
  const [focusTick, setFocusTick]       = useState(0)  // triggers dock state update
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
  const [drawState, setDrawState]       = useState<{
    insertAt: number
    editingBlock: JournalBlock | null
  } | null>(null)

  // ── Floating formatter state ─────────────────────────────────────────────────
  const [selectionRect, setSelectionRect] = useState<DOMRect | null>(null)

  // ── Dirty / unsaved-changes state ───────────────────────────────────────────
  const [isDirty, setIsDirty]           = useState(false)
  const [showExitDialog, setShowExitDialog] = useState(false)
  const isDirtyRef      = useRef(false)  // fast path — avoids closure staleness
  const savedDocRef     = useRef('')     // doc string at last explicit Save Notes
  const pendingNavRef   = useRef<(() => void) | null>(null)
  const showExitDialogRef = useRef(false)  // for ESC handler stable closure

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
  const timerWrapperRef   = useRef<HTMLDivElement>(null)

  // ── Move / resize mode state ─────────────────────────────────────────────────
  const [moveModeId,   setMoveModeId]   = useState<string | null>(null)
  const [resizeModeId, setResizeModeId] = useState<string | null>(null)
  // dragPos: non-null while mouse is held down during a move drag
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null)
  const [dropIdx,  setDropIdx]  = useState(0)
  const [snapGuides, setSnapGuides] = useState<
    Array<{ type: 'v' | 'h'; coord: number; from: number; to: number }>
  >([])
  // Ref holds drag metadata without triggering extra re-renders
  const dragMoveRef = useRef<{
    blockId: string
    offsetX: number; offsetY: number
    blockW: number;  blockH: number
  } | null>(null)

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

  // Keep blocksRef in sync with blocks state
  useEffect(() => { blocksRef.current = blocks }, [blocks])

  // ── Init / date change ───────────────────────────────────────────────────────
  useEffect(() => {
    const doc = parseJournalDoc(rawContent)
    const initialBlocks = doc.blocks.length > 0 ? doc.blocks : [createTextBlock()]
    setBlocks(initialBlocks)
    blocksRef.current = initialBlocks
    contentMapRef.current.clear()
    initialBlocks.forEach(b => {
      if ((b.type === 'text' || b.type === 'section') && b.content) {
        contentMapRef.current.set(b.id, b.content)
      }
    })
    // Load timer sessions for this date
    const sessions = doc.timerSessions ?? []
    setTimerSessions(sessions)
    timerSessionsRef.current = sessions
    // Stop any running timer from previous date
    if (timerIntervalRef.current) { clearInterval(timerIntervalRef.current); timerIntervalRef.current = null }
    setTimerStartTs(null)
    timerStartTsRef.current = null
    setTimerElapsedMs(0)
    setShowSessions(false)
    setDrawState(null)
    setSelectedBlockId(null)
    setShowEmoji(false)
    setSaveStatus('idle')
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null }
    savedDocRef.current   = rawContent ?? ''
    isDirtyRef.current    = false
    setIsDirty(false)
    setShowExitDialog(false)
    pendingNavRef.current = null
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateKey])

  // ── Doc serialization ───────────────────────────────────────────────────────
  const buildDocStr = useCallback((): string => {
    const sessions = timerSessionsRef.current
    const doc = {
      v: 1 as const,
      blocks: blocksRef.current.map(b => ({
        ...b,
        content: (b.type === 'text' || b.type === 'section')
          ? (contentMapRef.current.get(b.id) ?? b.content ?? '')
          : b.content,
      })),
      ...(sessions.length > 0 ? { timerSessions: sessions } : {}),
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

  // ── Block content change ────────────────────────────────────────────────────
  const onBlockContentChange = useCallback((id: string, content: string) => {
    contentMapRef.current.set(id, content)
    onContentChange(buildDocStr())
    scheduleSave()
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

  const isActive = (name: string) => focusedEditor.current?.isActive(name) ?? false
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
  }

  function deleteBlock(id: string) {
    contentMapRef.current.delete(id)
    const filtered = blocksRef.current.filter(b => b.id !== id)
    const next = filtered.length > 0 ? filtered : [createTextBlock()]
    blocksRef.current = next
    setBlocks(next)
    onContentChange(buildDocStr())
    scheduleSave()
  }

  function moveBlock(id: string, delta: -1 | 1) {
    const current = blocksRef.current
    const idx = current.findIndex(b => b.id === id)
    if (idx < 0) return
    const newIdx = idx + delta
    if (newIdx < 0 || newIdx >= current.length) return
    const next = [...current]
    // Preserve live content before swap
    next[idx]    = { ...next[idx],    content: contentMapRef.current.get(next[idx].id)    ?? next[idx].content    ?? '' }
    next[newIdx] = { ...next[newIdx], content: contentMapRef.current.get(next[newIdx].id) ?? next[newIdx].content ?? '' }
    ;[next[idx], next[newIdx]] = [next[newIdx], next[idx]]
    blocksRef.current = next
    setBlocks(next)
    onContentChange(buildDocStr())
    scheduleSave()
  }

  function updateBlock(id: string, updates: Partial<JournalBlock>) {
    const next = blocksRef.current.map(b => b.id === id ? { ...b, ...updates, updatedAt: Date.now() } : b)
    blocksRef.current = next
    setBlocks(next)
    onContentChange(buildDocStr())
    scheduleSave()
  }

  function setBlockWidth(id: string, width: number) {
    const next = blocksRef.current.map(b => b.id === id ? { ...b, width } : b)
    blocksRef.current = next
    setBlocks(next)
    onContentChange(buildDocStr())
    scheduleSave()
  }

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

  function startBlockMove(blockId: string, e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    const container = blockListRef.current
    const blockEl   = container?.querySelector(`[data-block-id="${blockId}"]`) as HTMLElement | null
    if (!blockEl) return

    const rect = blockEl.getBoundingClientRect()
    dragMoveRef.current = {
      blockId,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      blockW:  rect.width,
      blockH:  rect.height,
    }
    setDragPos({ x: e.clientX, y: e.clientY })
    setDropIdx(blocksRef.current.findIndex(b => b.id === blockId))

    function onMove(ev: MouseEvent) {
      const dm = dragMoveRef.current
      if (!dm) return
      setDragPos({ x: ev.clientX, y: ev.clientY })
      setDropIdx(computeDropIdx(blockId, ev.clientX, ev.clientY))
      setSnapGuides(computeAlignGuides(
        blockId,
        ev.clientX - dm.offsetX,
        ev.clientY - dm.offsetY,
        dm.blockW,
        dm.blockH,
      ))
    }
    function onUp(ev: MouseEvent) {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup',   onUp)
      const finalIdx = computeDropIdx(blockId, ev.clientX, ev.clientY)
      doMoveBlockToIdx(blockId, finalIdx)
      dragMoveRef.current = null
      setDragPos(null)
      setSnapGuides([])
      setMoveModeId(null)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup',   onUp)
  }

  // Draw handlers
  function handleDrawSave(dataUrl: string) {
    if (!drawState) return
    let next: JournalBlock[]
    if (drawState.editingBlock) {
      const updatedBlock: JournalBlock = { ...drawState.editingBlock, src: dataUrl, thumbnail: dataUrl, updatedAt: Date.now() }
      next = blocksRef.current.map(b => b.id === drawState.editingBlock!.id ? updatedBlock : b)
    } else {
      const drawBlock = createDrawingBlock(dataUrl, `Drawing — ${fmtShortDate(dateKey)}`)
      next = [...blocksRef.current]
      next.splice(drawState.insertAt + 1, 0, drawBlock)
    }
    blocksRef.current = next
    setBlocks(next)
    setDrawState(null)
    onContentChange(buildDocStr())
    scheduleSave()
  }

  // Emoji
  function handleEmojiClick(data: EmojiClickData) {
    focusedEditor.current?.chain().focus().insertContent(data.emoji).run()
    setShowEmoji(false)
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
      if (e.key !== 'Escape') return
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

  // Utility buttons: subdued navy/lavender treatment (List, Upload, Camera, Draw)
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

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <>
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
        .xp-j-prose ol { padding-left: 22px; margin: 0 0 6px; list-style: decimal; }
        .xp-j-prose li { margin-bottom: 3px; }
        .xp-j-prose ul[data-type="taskList"] { list-style: none; padding-left: 0; margin: 0 0 6px; }
        .xp-j-prose ul[data-type="taskList"] > li { display: flex; align-items: flex-start; gap: 7px; margin-bottom: 4px; }
        .xp-j-prose ul[data-type="taskList"] > li > label { flex-shrink: 0; margin-top: 3px; cursor: pointer; display: flex; }
        .xp-j-prose ul[data-type="taskList"] > li > label > input[type="checkbox"] { width: 14px; height: 14px; cursor: pointer; accent-color: #7c3aed; margin: 0; }
        .xp-j-prose ul[data-type="taskList"] > li > div { flex: 1; min-width: 0; }
        .xp-j-prose ul[data-type="taskList"] > li[data-checked="true"] > div { opacity: 0.52; }
        .xp-j-prose p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          color: ${isDark ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.30)'};
          float: left; pointer-events: none; height: 0;
        }
        /* Selectable blocks */
        .xp-j-blk { cursor: pointer; }
        .xp-j-blk:hover { box-shadow: 0 0 0 1.5px rgba(124,58,237,0.22); border-radius: 10px; }
        /* Section title: faint "Add Title" reveals on hover */
        .xp-j-sec-wrap:hover .xp-j-add-title { opacity: 0.45 !important; }
        /* Responsive collapse */
        @media (max-width: 640px) {
          .xp-j-grid { grid-template-columns: 1fr !important; grid-auto-rows: auto !important; }
          .xp-j-grid > * { grid-column: 1 / -1 !important; grid-row: auto !important; }
        }
        /* Ghost slot pulse during drag-move */
        @keyframes xpGhostPulse {
          0%, 100% { opacity: 0.85; }
          50%       { opacity: 1; }
        }
      `}</style>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div
        className="xp-j-hdr"
        style={{ flexShrink: 0, borderBottom: '0.5px solid rgba(255,255,255,0.08)' }}
      >
        <div style={{
          position: 'relative', display: 'flex', alignItems: 'center',
          height: 52, padding: '0 14px', gap: 6,
        }}>
          {/* Left: back */}
          <button
            onClick={() => guardedNavigate(onBack)}
            style={{
              padding: '5px 10px', borderRadius: 8, border: '0.5px solid rgba(255,255,255,0.16)',
              background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.78)',
              fontSize: 12, fontWeight: 500, cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap',
            }}
          >← Calendar</button>

          {/* Center: circular prev/next flanking the date — absolutely centered regardless of side controls */}
          <div style={{
            position: 'absolute', left: 0, right: 0,
            display: 'flex', justifyContent: 'center', alignItems: 'center',
            pointerEvents: 'none',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, pointerEvents: 'auto' }}>
              <button
                onClick={() => guardedNavigate(() => onNavigateDay(-1))}
                title="Previous day"
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
              <span style={{ color: '#fff', fontSize: 13, fontWeight: 600, letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}>
                {fmtEditorDate(dateKey)}
              </span>
              <button
                onClick={() => guardedNavigate(() => onNavigateDay(1))}
                title="Next day"
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

          {/* Right: today + close */}
          <div style={{ flex: 1 }} />
          {!isEditorOnToday && (
            <button
              onClick={() => guardedNavigate(onNavigateToday)}
              style={{
                padding: '3px 8px', borderRadius: 20, border: '0.5px solid rgba(255,255,255,0.22)',
                background: 'transparent', color: 'rgba(255,255,255,0.60)',
                fontSize: 11, cursor: 'pointer', flexShrink: 0,
              }}
            >Today</button>
          )}
          <button
            onClick={() => guardedNavigate(onClose)}
            style={{
              padding: '5px 10px', borderRadius: 8,
              border: '0.5px solid rgba(239,68,68,0.28)',
              background: 'rgba(239,68,68,0.15)', color: '#fca5a5',
              fontSize: 12, fontWeight: 500, cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap',
            }}
          >× Close</button>
        </div>
      </div>

      {/* ── Content area or Draw canvas ─────────────────────────────────────── */}
      {drawState ? (
        <JournalDrawModal
          isDark={isDark}
          initialSrc={drawState.editingBlock?.src}
          onSave={handleDrawSave}
          onClose={() => setDrawState(null)}
        />
      ) : (
        <>
          {/* Block list — masonry grid layout */}
          <div
            style={{ flex: 1, overflowY: 'auto', padding: '12px 20px 8px', minHeight: 0 }}
            onClick={() => { setSelectedBlockId(null); setMoveModeId(null); setResizeModeId(null); setSelectionRect(null) }}
          >
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
                          outline: isSelected && isSelectable ? '1.5px solid rgba(124,58,237,0.55)' : '1.5px solid transparent',
                          borderRadius: 10, transition: 'outline 120ms',
                        }}
                      >
                        {(block.type === 'text' || block.type === 'section') ? (
                          <JournalTextBlock
                            block={block}
                            isDark={isDark}
                            isOnlyBlock={blocks.length === 1}
                            onContentChange={onBlockContentChange}
                            onFocus={onEditorFocus}
                            onSelectionUpdate={onEditorSelectionUpdate}
                            onDelete={blocks.length > 1 ? () => deleteBlock(block.id) : undefined}
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
                            canMoveUp={idx > 0}
                            canMoveDown={idx < blocks.length - 1}
                            onMoveUp={() => moveBlock(block.id, -1)}
                            onMoveDown={() => moveBlock(block.id, 1)}
                          />
                        ) : (
                          <InlineMediaBlock
                            block={block}
                            isDark={isDark}
                            onEdit={() => setDrawState({ insertAt: idx, editingBlock: block })}
                            onMoveActivate={() => {
                              setMoveModeId(block.id)
                              setSelectedBlockId(block.id)
                            }}
                            onDelete={() => deleteBlock(block.id)}
                          />
                        )}
                      </div>

                      {/* Resize handles: images/drawings when selected; sections in explicit resize mode */}
                      {!isDragging && (
                        (isSelected && (block.type === 'image' || block.type === 'drawing')) ||
                        (resizeModeId === block.id && block.type === 'section')
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

          {/* ── Tool dock ─────────────────────────────────────────────────── */}
          <div style={{
            background: dockBg, borderTop: `0.5px solid ${dockBdr}`,
            boxShadow: 'inset 0 1px 0 rgba(124,58,237,0.10), 0 -6px 24px rgba(0,0,0,0.40)',
            padding: '10px 16px 12px', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 6, flexWrap: 'wrap', position: 'relative',
          }}>
            {/* Left cluster */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
              <button
                className={`xp-jd-btn${isActive('bulletList') ? ' xp-j-active' : ''}`}
                style={dockBtn(isActive('bulletList'))}
                onClick={() => focusedEditor.current?.chain().focus().toggleBulletList().run()}
                title="Bulleted list"
              >• List</button>
              <button
                className={`xp-jd-btn${isActive('orderedList') ? ' xp-j-active' : ''}`}
                style={dockBtn(isActive('orderedList'))}
                onClick={() => focusedEditor.current?.chain().focus().toggleOrderedList().run()}
                title="Numbered list"
              >1. List</button>
              <button
                className={`xp-jd-btn${isActive('taskList') ? ' xp-j-active' : ''}`}
                style={dockBtn(isActive('taskList'))}
                onClick={() => focusedEditor.current?.chain().focus().toggleTaskList().run()}
                title="Interactive checklist"
              >☐ Check</button>

              <span style={{ width: 1, height: 18, background: dockDiv, flexShrink: 0, margin: '0 2px' }} />

              {/* Upload */}
              <label style={{ ...dockBtn(), cursor: 'pointer' }} title="Upload image" className="xp-jd-btn">
                📎 Upload
                <input
                  type="file" multiple accept={ATTACHMENT_ACCEPT}
                  style={{ display: 'none' }}
                  onChange={e => { handleUploadAtEnd(e.target.files); e.currentTarget.value = '' }}
                />
              </label>
              <button
                className="xp-jd-btn"
                style={dockBtn()}
                onClick={() => setCameraInsertAt(blocks.length - 1)}
                title="Take a photo"
              >📷 Camera</button>

              <span style={{ width: 1, height: 18, background: dockDiv, flexShrink: 0, margin: '0 2px' }} />

              {/* Draw */}
              <button
                className="xp-jd-btn"
                style={dockBtn()}
                onClick={() => setDrawState({ insertAt: blocks.length - 1, editingBlock: null })}
                title="Open draw canvas"
              >✏️ Draw</button>

              {/* + New Section */}
              <SectionPicker isDark={isDark} onPick={color => {
                insertBlock(createSectionBlock(color), blocks.length - 1)
              }} />
            </div>

            {/* Right cluster */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <span style={{
                fontSize: 11, whiteSpace: 'nowrap', userSelect: 'none',
                color: saveStatus === 'saved' ? '#16a34a' : 'transparent',
                transition: 'color 200ms',
              }}>Saved ✓</span>

              {/* ── Journal Session Timer ─────────────────────────────────── */}
              {(() => {
                const isRunning   = timerStartTs !== null
                const totalMs     = calcTotalMs(timerSessions, timerElapsedMs)
                const hasSessions = timerSessions.length > 0

                return (
                  <div ref={timerWrapperRef} style={{ position: 'relative' }}>
                    {/* Timer button */}
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

                    {/* Session count badge — toggle popover */}
                    {hasSessions && !isRunning && (
                      <button
                        onClick={() => { setShowSessions(v => !v); setConfirmDeleteIdx(null) }}
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

                    {/* Session log popover */}
                    {showSessions && (
                      <div style={{
                        position: 'absolute', bottom: 'calc(100% + 8px)', right: 0,
                        minWidth: 240, zIndex: 60,
                        background: 'rgba(10,6,30,0.98)',
                        border: '0.5px solid rgba(124,58,237,0.28)',
                        borderRadius: 10, padding: '10px 14px 12px',
                        boxShadow: '0 8px 32px rgba(0,0,0,0.65)',
                        animation: 'xpSecMenuIn 140ms cubic-bezier(0.16,1,0.3,1) both',
                      }}>
                        <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'rgba(255,255,255,0.38)', marginBottom: 10, userSelect: 'none' }}>
                          Journal Time
                        </div>
                        {timerSessions.map((s, i) => {
                          const isPending = confirmDeleteIdx === i
                          return (
                            <div key={i} style={{ marginBottom: 10 }}>
                              {/* Session label row */}
                              <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'rgba(255,255,255,0.28)', marginBottom: 3, userSelect: 'none' }}>
                                Session {i + 1}
                              </div>
                              {/* Time + duration + delete row */}
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

              <button
                ref={emojiBtnRef}
                className="xp-jd-btn"
                onClick={() => setShowEmoji(v => !v)}
                title="Add emoji"
                style={{ ...dockBtn(), fontSize: 16, padding: '4px 9px', lineHeight: 1, borderRadius: 8 }}
              >😊</button>

              <button
                className="xp-j-save-btn"
                onClick={handleManualSave}
                style={{
                  padding: '6px 18px', borderRadius: 8, border: 'none', cursor: 'pointer',
                  background: 'linear-gradient(135deg, #7c3aed, #6d28d9)',
                  color: '#fff', fontSize: 12, fontWeight: 700,
                  boxShadow: '0 2px 10px rgba(124,58,237,0.45)',
                  whiteSpace: 'nowrap',
                }}
              >Save Notes</button>
            </div>

            {/* Emoji picker */}
            {showEmoji && (
              <div id="xp-j-emoji" style={{
                position: 'absolute', bottom: 'calc(100% + 8px)', right: 16, zIndex: 100,
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
      )}

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

// ─── Section picker inline component ─────────────────────────────────────────

function SectionPicker({ isDark, onPick }: { isDark: boolean; onPick: (c: SectionColorKey) => void }) {
  const [open, setOpen] = useState(false)
  const [hoveredKey, setHoveredKey] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function outside(e: MouseEvent) {
      if (ref.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        className="xp-jd-btn"
        style={{
          padding: '5px 11px', borderRadius: 7, cursor: 'pointer',
          border: `0.5px solid ${open ? 'rgba(124,58,237,0.70)' : 'rgba(124,58,237,0.38)'}`,
          background: open ? 'rgba(124,58,237,0.30)' : 'rgba(124,58,237,0.10)',
          color: '#c4b5fd',
          fontSize: 12, fontWeight: open ? 600 : 500,
          transition: 'all 120ms', flexShrink: 0, whiteSpace: 'nowrap' as const,
        }}
        onClick={() => setOpen(v => !v)}
        title="Add a colored section"
      >+ Section</button>

      {open && (
        <div className="xp-j-sec-menu" style={{
          position: 'absolute', bottom: 'calc(100% + 6px)', left: 0, zIndex: 50,
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

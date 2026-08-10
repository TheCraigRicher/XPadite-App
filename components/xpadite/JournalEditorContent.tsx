'use client'

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Placeholder from '@tiptap/extension-placeholder'
import { Theme } from 'emoji-picker-react'
import type { EmojiClickData } from 'emoji-picker-react'
import dynamic from 'next/dynamic'
import { buildAttachments, ATTACHMENT_ACCEPT, CameraModal, ImageLightbox } from './attachmentUtils'
import type { JournalBlock, TaskAttachment } from './types'
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
  onDelete?: () => void        // undefined for first/only block (not deletable)
  onMoveActivate?: () => void  // section blocks only
  canMoveUp: boolean
  canMoveDown: boolean
  onMoveUp: () => void
  onMoveDown: () => void
}

const JournalTextBlock = React.memo(function JournalTextBlock({
  block, isDark, isOnlyBlock,
  onContentChange, onFocus, onSelectionUpdate,
  onDelete, onMoveActivate, canMoveUp, canMoveDown, onMoveUp, onMoveDown,
}: JournalTextBlockProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false, codeBlock: false, blockquote: false,
        strike: false, code: false, bold: false, italic: false, horizontalRule: false,
      }),
      TaskList,
      TaskItem.configure({ nested: false }),
      Placeholder.configure({
        placeholder: block.type === 'section'
          ? 'Add section content…'
          : 'What made today great? Reflections, insights, gratitude…',
      }),
    ],
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
    editorProps: { attributes: { class: 'xp-j-prose' } },
    onUpdate: ({ editor: e }) => {
      const content = serializeJournalContent(e)
      onContentChange(block.id, content)
    },
  })

  // Set content when block.id changes (new block mounted)
  useEffect(() => {
    if (!editor) return
    editor.commands.setContent(parseJournalContent(block.content || ''))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, block.id])

  // Wire focus and selection events
  useEffect(() => {
    if (!editor) return
    const handleFocus = () => onFocus(editor)
    const handleSelection = () => onSelectionUpdate()
    editor.on('focus', handleFocus)
    editor.on('selectionUpdate', handleSelection)
    return () => {
      editor.off('focus', handleFocus)
      editor.off('selectionUpdate', handleSelection)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor])

  // Close ⋮ menu on outside click
  useEffect(() => {
    if (!menuOpen) return
    function outside(e: MouseEvent) {
      if (menuRef.current?.contains(e.target as Node)) return
      setMenuOpen(false)
    }
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [menuOpen])

  const isSection = block.type === 'section'
  const sectionStyle = isSection && block.sectionColor
    ? getSectionStyle(block.sectionColor, isDark)
    : null

  const hasMenu = isSection ? true : canMoveUp || canMoveDown || (!!onDelete && !isOnlyBlock)

  return (
    <div style={{
      position: 'relative',
      borderRadius: sectionStyle ? 10 : 0,
      border: sectionStyle ? `0.5px solid ${sectionStyle.border}` : 'none',
      background: sectionStyle ? sectionStyle.background : 'transparent',
      padding: sectionStyle ? '12px 40px 12px 14px' : '0',
      marginBottom: sectionStyle ? 4 : 0,
    }}>
      {/* Section color label */}
      {sectionStyle && block.sectionColor && (
        <div style={{
          fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
          letterSpacing: '0.06em', color: sectionStyle.labelColor,
          marginBottom: 6, userSelect: 'none',
        }}>
          {SECTION_COLORS.find(c => c.key === block.sectionColor)?.label ?? 'Section'}
        </div>
      )}

      {/* Editor */}
      <div onClick={() => editor?.commands.focus()} style={{ cursor: 'text' }}>
        <EditorContent editor={editor} />
      </div>

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
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '1'; (e.currentTarget as HTMLButtonElement).style.color = isDark ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.65)' }}
            onMouseLeave={e => { if (!menuOpen) { (e.currentTarget as HTMLButtonElement).style.color = isDark ? 'rgba(255,255,255,0.40)' : 'rgba(0,0,0,0.35)' } }}
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
              {isSection ? (
                <>
                  <button onClick={() => { onMoveActivate?.(); setMenuOpen(false) }} style={menuItemStyle(isDark)}>
                    ✥ Move
                  </button>
                  <button onClick={() => { editor?.commands.focus(); setMenuOpen(false) }} style={menuItemStyle(isDark)}>
                    ✏ Edit Section
                  </button>
                  {!!onDelete && !isOnlyBlock && (
                    <button onClick={() => { onDelete(); setMenuOpen(false) }} style={{ ...menuItemStyle(isDark), color: '#f87171' }}>
                      🗑 Delete
                    </button>
                  )}
                </>
              ) : (
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

  // ── Move mode state ──────────────────────────────────────────────────────────
  const [moveModeId, setMoveModeId] = useState<string | null>(null)
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

  dateKeyRef.current = dateKey

  // Keep blocksRef in sync with blocks state
  useEffect(() => { blocksRef.current = blocks }, [blocks])

  // ── Init / date change ───────────────────────────────────────────────────────
  useEffect(() => {
    const doc = parseJournalDoc(rawContent)
    // Ensure at least one text block
    const initialBlocks = doc.blocks.length > 0 ? doc.blocks : [createTextBlock()]
    setBlocks(initialBlocks)
    blocksRef.current = initialBlocks
    contentMapRef.current.clear()
    // Pre-populate contentMap from loaded blocks
    initialBlocks.forEach(b => {
      if ((b.type === 'text' || b.type === 'section') && b.content) {
        contentMapRef.current.set(b.id, b.content)
      }
    })
    setDrawState(null)
    setSelectedBlockId(null)
    setShowEmoji(false)
    setSaveStatus('idle')
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateKey])

  // ── Doc serialization ───────────────────────────────────────────────────────
  const buildDocStr = useCallback((): string => {
    const doc = {
      v: 1 as const,
      blocks: blocksRef.current.map(b => ({
        ...b,
        content: (b.type === 'text' || b.type === 'section')
          ? (contentMapRef.current.get(b.id) ?? b.content ?? '')
          : b.content,
      })),
    }
    return JSON.stringify(doc)
  }, [])

  // ── Autosave scheduler ──────────────────────────────────────────────────────
  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      const serialized = buildDocStr()
      onPersist(dateKeyRef.current, serialized)
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
  }, [])

  const isActive = (name: string) => focusedEditor.current?.isActive(name) ?? false
  // focusTick is consumed by the isActive call above — just reference it to avoid lint warning
  void focusTick

  // ── Manual save ─────────────────────────────────────────────────────────────
  function handleManualSave() {
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null }
    const serialized = buildDocStr()
    onPersist(dateKeyRef.current, serialized)
    setSaveStatus('saved')
    setTimeout(() => setSaveStatus(s => s === 'saved' ? 'idle' : s), 2200)
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
    const MIN_H = 60

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

  // ── Styles ──────────────────────────────────────────────────────────────────
  // Dock is a fixed premium deep navy/plum regardless of page theme
  const dockBg  = 'rgba(10,5,26,0.98)'
  const dockBdr = 'rgba(124,58,237,0.22)'
  const dockDiv = 'rgba(255,255,255,0.08)'

  function dockBtn(active = false): React.CSSProperties {
    return {
      padding: '5px 11px', borderRadius: 7, cursor: 'pointer',
      border: `0.5px solid ${active ? 'rgba(124,58,237,0.65)' : 'rgba(255,255,255,0.11)'}`,
      background: active ? 'rgba(124,58,237,0.28)' : 'rgba(255,255,255,0.055)',
      color: active ? '#c4b5fd' : 'rgba(255,255,255,0.78)',
      fontSize: 12, fontWeight: active ? 600 : 500,
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
        .xp-jd-btn:hover:not(.xp-j-active):not(:disabled) {
          border-color: rgba(124,58,237,0.55) !important;
          background:   rgba(124,58,237,0.16) !important;
          color: #c4b5fd !important;
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
          outline: none;
          font-size: 14px;
          line-height: 1.75;
          font-family: inherit;
          color: ${isDark ? '#f1f5f9' : '#0f172a'};
          min-height: 32px;
        }
        .xp-j-prose p { margin: 0 0 6px; }
        .xp-j-prose p:last-child { margin-bottom: 0; }
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
        /* Selectable blocks: hover outline signals interactivity; handles appear on selection */
        .xp-j-blk { cursor: pointer; }
        .xp-j-blk:hover { box-shadow: 0 0 0 1.5px rgba(124,58,237,0.22); border-radius: 10px; }
        /* Responsive collapse: narrow viewports stack all blocks in a single column */
        @media (max-width: 640px) {
          .xp-j-grid { grid-template-columns: 1fr !important; grid-auto-rows: auto !important; }
          .xp-j-grid > * { grid-column: 1 / -1 !important; grid-row: auto !important; }
        }
        /* Drop indicator lines — absolute positioned, no grid layout impact */
        .xp-j-drop-before { position: relative; }
        .xp-j-drop-before::before {
          content: ''; position: absolute; top: -5px; left: 0; right: 0; height: 2px;
          background: rgba(124,58,237,0.80); border-radius: 2px;
          box-shadow: 0 0 6px rgba(124,58,237,0.50); z-index: 20; pointer-events: none;
        }
        .xp-j-drop-after { position: relative; }
        .xp-j-drop-after::after {
          content: ''; position: absolute; bottom: -5px; left: 0; right: 0; height: 2px;
          background: rgba(124,58,237,0.80); border-radius: 2px;
          box-shadow: 0 0 6px rgba(124,58,237,0.50); z-index: 20; pointer-events: none;
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
            onClick={onBack}
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
                onClick={() => onNavigateDay(-1)}
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
                onClick={() => onNavigateDay(1)}
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
              onClick={onNavigateToday}
              style={{
                padding: '3px 8px', borderRadius: 20, border: '0.5px solid rgba(255,255,255,0.22)',
                background: 'transparent', color: 'rgba(255,255,255,0.60)',
                fontSize: 11, cursor: 'pointer', flexShrink: 0,
              }}
            >Today</button>
          )}
          <button
            onClick={onClose}
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
          {/* Block list — flex-wrap; blocks sized by block.width % for free side-by-side layout */}
          <div
            style={{ flex: 1, overflowY: 'auto', padding: '12px 20px 8px', minHeight: 0 }}
            onClick={() => { setSelectedBlockId(null); setMoveModeId(null) }}
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
              {blocks.map((block, idx) => {
                const w          = block.width ?? 100
                const isSelected = selectedBlockId === block.id
                const isSelectable = block.type !== 'text'
                const isMoveMode = moveModeId === block.id
                const isDragging = isMoveMode && dragPos !== null
                const colSpan    = widthToColSpan(w)
                // Drop indicator: show before this block, or after last block
                const showDropBefore = dragPos !== null && !isDragging && dropIdx === idx
                const showDropAfter  = dragPos !== null && !isDragging && idx === blocks.length - 1 && dropIdx >= blocks.length
                const dropClass = showDropBefore ? 'xp-j-drop-before' : showDropAfter ? 'xp-j-drop-after' : ''

                return (
                  <GridBlockItem
                    key={block.id}
                    blockId={block.id}
                    colSpan={colSpan}
                    className={dropClass || undefined}
                    style={{
                      opacity: isDragging ? 0.25 : 1,
                      cursor: isMoveMode ? (isDragging ? 'grabbing' : 'grab') : undefined,
                      transition: isDragging ? 'none' : 'opacity 150ms',
                    }}
                    onClick={isSelectable ? e => {
                      e.stopPropagation()
                      if (moveModeId && moveModeId !== block.id) setMoveModeId(null)
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

                    {/* Resize handles: image/drawing only — sections are naturally sized by content */}
                    {isSelected && (block.type === 'image' || block.type === 'drawing') && !isDragging && (
                      <ResizeHandles onResizeStart={(dir, e) => startBlockResize(block.id, dir, e)} />
                    )}
                  </GridBlockItem>
                )
              })}
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
    </>
  )
}

// ─── Section picker inline component ─────────────────────────────────────────

function SectionPicker({ isDark, onPick }: { isDark: boolean; onPick: (c: SectionColorKey) => void }) {
  const [open, setOpen] = useState(false)
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
          padding: '4px 0', overflow: 'hidden', minWidth: 148,
        }}>
          {SECTION_COLORS.map(c => (
            <button
              key={c.key}
              onClick={() => { onPick(c.key as SectionColorKey); setOpen(false) }}
              style={{ ...menuItemStyle(true), display: 'flex', alignItems: 'center', gap: 8 }}
            >
              <span style={{
                width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                background: getSectionStyle(c.key, true).labelColor,
              }} />
              {c.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

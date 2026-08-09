'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
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

// ─── JournalTextBlock ─────────────────────────────────────────────────────────

interface JournalTextBlockProps {
  block: JournalBlock
  isDark: boolean
  isOnlyBlock: boolean
  onContentChange: (id: string, content: string) => void
  onFocus: (editor: Editor) => void
  onSelectionUpdate: () => void
  onDelete?: () => void        // undefined for first/only block (not deletable)
  canMoveUp: boolean
  canMoveDown: boolean
  onMoveUp: () => void
  onMoveDown: () => void
}

const JournalTextBlock = React.memo(function JournalTextBlock({
  block, isDark, isOnlyBlock,
  onContentChange, onFocus, onSelectionUpdate,
  onDelete, canMoveUp, canMoveDown, onMoveUp, onMoveDown,
}: JournalTextBlockProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const acc = '#7c3aed'

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

  const hasMenu = isSection || canMoveUp || canMoveDown || (!!onDelete && !isOnlyBlock)

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
                <button
                  onClick={() => { onDelete(); setMenuOpen(false) }}
                  style={{ ...menuItemStyle(isDark), color: '#f87171' }}
                >
                  🗑 Delete
                </button>
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
  canMoveUp: boolean
  canMoveDown: boolean
  onEdit: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onDelete: () => void
}

function InlineMediaBlock({ block, isDark, canMoveUp, canMoveDown, onEdit, onMoveUp, onMoveDown, onDelete }: InlineMediaBlockProps) {
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
      {/* Image */}
      {block.src && (
        <img
          src={block.thumbnail ?? block.src}
          alt={block.name ?? (block.type === 'drawing' ? 'Drawing' : 'Image')}
          onClick={() => setLightbox(true)}
          style={{
            maxWidth: '100%', display: 'block', cursor: 'zoom-in',
            borderRadius: 10,
            border: `0.5px solid ${isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)'}`,
            boxShadow: isDark ? '0 2px 12px rgba(0,0,0,0.35)' : '0 2px 8px rgba(0,0,0,0.08)',
          }}
        />
      )}

      {/* Label */}
      {block.name && (
        <div style={{
          fontSize: 10, color: isDark ? 'rgba(255,255,255,0.40)' : 'rgba(0,0,0,0.40)',
          marginTop: 4, textAlign: 'center', userSelect: 'none',
        }}>
          {block.type === 'drawing' ? '✏️ ' : '📷 '}{block.name}
        </div>
      )}

      {/* ⋮ menu */}
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
            {block.type === 'drawing' && (
              <button onClick={() => { onEdit(); setMenuOpen(false) }} style={menuItemStyle(isDark)}>
                ✏️ Edit Drawing
              </button>
            )}
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

// ─── InsertRow ────────────────────────────────────────────────────────────────

interface InsertRowProps {
  isDark: boolean
  atIndex: number
  onInsertText: (atIndex: number) => void
  onInsertSection: (atIndex: number, color: SectionColorKey) => void
  onInsertDraw: (atIndex: number) => void
  onInsertUpload: (atIndex: number, files: FileList) => void
  onInsertCamera: (atIndex: number) => void
}

function InsertRow({ isDark, atIndex, onInsertText, onInsertSection, onInsertDraw, onInsertUpload, onInsertCamera }: InsertRowProps) {
  const [open, setOpen] = useState(false)
  const [showColors, setShowColors] = useState(false)
  const popRef = useRef<HTMLDivElement>(null)
  const uploadRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    function outside(e: MouseEvent) {
      if (popRef.current?.contains(e.target as Node)) return
      setOpen(false)
      setShowColors(false)
    }
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [open])

  function close() { setOpen(false); setShowColors(false) }

  const lineColor = isDark ? 'rgba(124,58,237,0.18)' : 'rgba(124,58,237,0.12)'
  const btnColor  = isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.45)'
  const popBg     = isDark ? '#1e1130' : '#fff'
  const popBdr    = isDark ? 'rgba(124,58,237,0.30)' : 'rgba(0,0,0,0.12)'

  return (
    <div
      className="xp-j-insert"
      style={{ position: 'relative', margin: '2px 0', display: 'flex', alignItems: 'center', gap: 6, opacity: 0.35, transition: 'opacity 200ms' }}
      onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
      onMouseLeave={e => { if (!open) e.currentTarget.style.opacity = '0.35' }}
    >
      <div style={{ flex: 1, height: 1, background: lineColor }} />
      <div ref={popRef} style={{ position: 'relative', flexShrink: 0 }}>
        <button
          onClick={() => { setOpen(v => !v); setShowColors(false) }}
          title="Insert content"
          style={{
            width: 22, height: 22, borderRadius: '50%', border: `0.5px solid ${isDark ? 'rgba(124,58,237,0.45)' : 'rgba(124,58,237,0.35)'}`,
            background: isDark ? 'rgba(124,58,237,0.15)' : 'rgba(124,58,237,0.08)',
            color: isDark ? '#a78bfa' : '#7c3aed',
            fontSize: 14, fontWeight: 500, lineHeight: 1,
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >+</button>

        {open && (
          <div style={{
            position: 'absolute', top: 28, left: '50%', transform: 'translateX(-50%)',
            zIndex: 50, background: popBg,
            border: `0.5px solid ${popBdr}`, borderRadius: 10,
            boxShadow: isDark ? '0 8px 32px rgba(0,0,0,0.55)' : '0 4px 20px rgba(0,0,0,0.12)',
            padding: '4px 0', overflow: 'hidden', minWidth: 148,
          }}>
            {!showColors ? (
              <>
                <button onClick={() => { onInsertText(atIndex); close() }} style={menuItemStyle(isDark)}>+ Text Block</button>
                <button
                  onClick={() => setShowColors(true)}
                  style={{ ...menuItemStyle(isDark), display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                >
                  <span>+ Section</span><span style={{ opacity: 0.5, fontSize: 10 }}>›</span>
                </button>
                <button onClick={() => { onInsertDraw(atIndex); close() }} style={menuItemStyle(isDark)}>✏️ Draw</button>
                <label style={{ ...menuItemStyle(isDark), display: 'block', cursor: 'pointer' }}>
                  📎 Upload Image
                  <input
                    ref={uploadRef}
                    type="file" multiple accept="image/*"
                    style={{ display: 'none' }}
                    onChange={e => {
                      if (e.target.files?.length) { onInsertUpload(atIndex, e.target.files); e.currentTarget.value = '' }
                      close()
                    }}
                  />
                </label>
                <button onClick={() => { onInsertCamera(atIndex); close() }} style={menuItemStyle(isDark)}>📷 Camera</button>
              </>
            ) : (
              <>
                <button onClick={() => setShowColors(false)} style={{ ...menuItemStyle(isDark), opacity: 0.55, fontSize: 11 }}>← Back</button>
                {SECTION_COLORS.map(c => (
                  <button
                    key={c.key}
                    onClick={() => { onInsertSection(atIndex, c.key as SectionColorKey); close() }}
                    style={{ ...menuItemStyle(isDark), display: 'flex', alignItems: 'center', gap: 8 }}
                  >
                    <span style={{
                      width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                      background: getSectionStyle(c.key, isDark).labelColor,
                    }} />
                    {c.label}
                  </button>
                ))}
              </>
            )}
          </div>
        )}
      </div>
      <div style={{ flex: 1, height: 1, background: lineColor }} />
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
  const [blocks, setBlocks]         = useState<JournalBlock[]>([])
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved'>('idle')
  const [showEmoji, setShowEmoji]   = useState(false)
  const [cameraInsertAt, setCameraInsertAt] = useState<number | null>(null)
  const [focusTick, setFocusTick]   = useState(0)  // triggers dock state update
  const [drawState, setDrawState]   = useState<{
    insertAt: number
    editingBlock: JournalBlock | null
  } | null>(null)

  // ── Refs ────────────────────────────────────────────────────────────────────
  const contentMapRef   = useRef<Map<string, string>>(new Map())
  const blocksRef       = useRef<JournalBlock[]>([])
  const focusedEditor   = useRef<Editor | null>(null)
  const saveTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dateKeyRef      = useRef(dateKey)
  const emojiBtnRef     = useRef<HTMLButtonElement>(null)

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

  // Insert row handlers
  function handleInsertText(atIndex: number) {
    insertBlock(createTextBlock(), atIndex)
  }
  function handleInsertSection(atIndex: number, color: SectionColorKey) {
    insertBlock(createSectionBlock(color), atIndex)
  }
  function handleInsertDraw(atIndex: number) {
    setDrawState({ insertAt: atIndex, editingBlock: null })
  }
  function handleInsertCamera(atIndex: number) {
    setCameraInsertAt(atIndex)
  }
  async function handleInsertUpload(atIndex: number, files: FileList) {
    const atts = await buildAttachments(Array.from(files), 'upload')
    const newBlocks = atts.map(att => createImageBlock(att.url, att.name))
    const next = [...blocksRef.current]
    next.splice(atIndex + 1, 0, ...newBlocks)
    blocksRef.current = next
    setBlocks(next)
    onContentChange(buildDocStr())
    scheduleSave()
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
  const dockBg  = isDark ? 'rgba(9,4,22,0.96)' : '#f1f5f9'
  const dockBdr = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.09)'
  const dockDiv = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.12)'
  const acc = '#7c3aed'
  void acc

  function dockBtn(active = false): React.CSSProperties {
    return {
      padding: '5px 11px', borderRadius: 7, cursor: 'pointer',
      border: `0.5px solid ${active ? 'rgba(124,58,237,0.55)' : isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.15)'}`,
      background: active ? 'rgba(124,58,237,0.22)' : isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)',
      color: active ? '#a78bfa' : isDark ? 'rgba(255,255,255,0.82)' : 'rgba(0,0,0,0.72)',
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
          border-color: rgba(124,58,237,0.50) !important;
          background:   rgba(124,58,237,0.12) !important;
          color: #a78bfa !important;
          transform: translateY(-1px);
        }
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
        .xp-j-insert { user-select: none; }
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
          {/* Left: back + prev */}
          <button
            onClick={onBack}
            style={{
              padding: '5px 10px', borderRadius: 8, border: '0.5px solid rgba(255,255,255,0.16)',
              background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.78)',
              fontSize: 12, fontWeight: 500, cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap',
            }}
          >← Calendar</button>
          <button
            onClick={() => onNavigateDay(-1)}
            title="Previous day"
            style={{
              padding: '4px 9px', borderRadius: 7, border: '0.5px solid rgba(255,255,255,0.12)',
              background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.70)',
              fontSize: 18, lineHeight: 1, cursor: 'pointer', flexShrink: 0,
            }}
          >‹</button>

          {/* Centered date — absolute so it's never offset by button widths */}
          <div style={{
            position: 'absolute', left: 0, right: 0,
            display: 'flex', justifyContent: 'center', alignItems: 'center',
            pointerEvents: 'none',
          }}>
            <span style={{ color: '#fff', fontSize: 13, fontWeight: 600, letterSpacing: '-0.01em', textAlign: 'center' }}>
              {fmtEditorDate(dateKey)}
            </span>
          </div>

          {/* Spacer + right: next + today (if not today) + close */}
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
            onClick={() => onNavigateDay(1)}
            title="Next day"
            style={{
              padding: '4px 9px', borderRadius: 7, border: '0.5px solid rgba(255,255,255,0.12)',
              background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.70)',
              fontSize: 18, lineHeight: 1, cursor: 'pointer', flexShrink: 0,
            }}
          >›</button>
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
          {/* Block list */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px 8px', minHeight: 0 }}>
            {/* Insert row before first block */}
            <InsertRow
              isDark={isDark}
              atIndex={-1}
              onInsertText={handleInsertText}
              onInsertSection={handleInsertSection}
              onInsertDraw={handleInsertDraw}
              onInsertUpload={handleInsertUpload}
              onInsertCamera={handleInsertCamera}
            />

            {blocks.map((block, idx) => (
              <React.Fragment key={block.id}>
                {(block.type === 'text' || block.type === 'section') ? (
                  <JournalTextBlock
                    block={block}
                    isDark={isDark}
                    isOnlyBlock={blocks.length === 1}
                    onContentChange={onBlockContentChange}
                    onFocus={onEditorFocus}
                    onSelectionUpdate={onEditorSelectionUpdate}
                    onDelete={blocks.length > 1 ? () => deleteBlock(block.id) : undefined}
                    canMoveUp={idx > 0}
                    canMoveDown={idx < blocks.length - 1}
                    onMoveUp={() => moveBlock(block.id, -1)}
                    onMoveDown={() => moveBlock(block.id, 1)}
                  />
                ) : (
                  <InlineMediaBlock
                    block={block}
                    isDark={isDark}
                    canMoveUp={idx > 0}
                    canMoveDown={idx < blocks.length - 1}
                    onEdit={() => setDrawState({ insertAt: idx, editingBlock: block })}
                    onMoveUp={() => moveBlock(block.id, -1)}
                    onMoveDown={() => moveBlock(block.id, 1)}
                    onDelete={() => deleteBlock(block.id)}
                  />
                )}

                {/* Insert row after each block */}
                <InsertRow
                  isDark={isDark}
                  atIndex={idx}
                  onInsertText={handleInsertText}
                  onInsertSection={handleInsertSection}
                  onInsertDraw={handleInsertDraw}
                  onInsertUpload={handleInsertUpload}
                  onInsertCamera={handleInsertCamera}
                />
              </React.Fragment>
            ))}
          </div>

          {/* ── Tool dock ─────────────────────────────────────────────────── */}
          <div style={{
            background: dockBg, borderTop: `0.5px solid ${dockBdr}`,
            boxShadow: isDark ? 'inset 0 1px 0 rgba(255,255,255,0.04), 0 -4px 16px rgba(0,0,0,0.30)' : 'inset 0 1px 0 rgba(0,0,0,0.04)',
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
                onClick={handleManualSave}
                style={{
                  padding: '6px 18px', borderRadius: 8, border: 'none', cursor: 'pointer',
                  background: 'linear-gradient(135deg, #7c3aed, #6d28d9)',
                  color: '#fff', fontSize: 12, fontWeight: 600,
                  boxShadow: '0 2px 8px rgba(124,58,237,0.35)',
                  whiteSpace: 'nowrap', transition: 'opacity 120ms',
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
          border: `0.5px solid ${open ? 'rgba(124,58,237,0.55)' : isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.15)'}`,
          background: open ? 'rgba(124,58,237,0.22)' : isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)',
          color: open ? '#a78bfa' : isDark ? 'rgba(255,255,255,0.82)' : 'rgba(0,0,0,0.72)',
          fontSize: 12, fontWeight: open ? 600 : 500,
          transition: 'all 120ms', flexShrink: 0, whiteSpace: 'nowrap' as const,
        }}
        onClick={() => setOpen(v => !v)}
        title="Add a colored section"
      >+ Section</button>

      {open && (
        <div style={{
          position: 'absolute', bottom: 'calc(100% + 6px)', left: 0, zIndex: 50,
          background: isDark ? '#1e1130' : '#fff',
          border: `0.5px solid ${isDark ? 'rgba(124,58,237,0.30)' : 'rgba(0,0,0,0.12)'}`,
          borderRadius: 10,
          boxShadow: isDark ? '0 8px 32px rgba(0,0,0,0.55)' : '0 4px 20px rgba(0,0,0,0.12)',
          padding: '4px 0', overflow: 'hidden', minWidth: 148,
        }}>
          {SECTION_COLORS.map(c => (
            <button
              key={c.key}
              onClick={() => { onPick(c.key as SectionColorKey); setOpen(false) }}
              style={{ ...menuItemStyle(isDark), display: 'flex', alignItems: 'center', gap: 8 }}
            >
              <span style={{
                width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                background: getSectionStyle(c.key, isDark).labelColor,
              }} />
              {c.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

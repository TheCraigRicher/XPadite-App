'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Placeholder from '@tiptap/extension-placeholder'
import dynamic from 'next/dynamic'
import { Theme } from 'emoji-picker-react'
import type { EmojiClickData } from 'emoji-picker-react'
import {
  parseJournalDoc, parseJournalContent, serializeJournalContent,
  getSectionStyle, SECTION_COLORS,
} from './journalUtils'
import type { JournalBlock, JournalDoc } from './types'
import { buildAttachments, removeAttachmentById, ATTACHMENT_ACCEPT, AttachmentItem, ImageLightbox, CameraModal } from './attachmentUtils'
import type { TaskAttachment } from './types'

const EmojiPickerLib = dynamic(() => import('emoji-picker-react'), { ssr: false })

// ─── Plain text extractor (for read-only section previews) ───────────────────

function extractPlainText(tiptapJson: string | undefined): string {
  if (!tiptapJson) return ''
  try {
    const doc = JSON.parse(tiptapJson)
    const parts: string[] = []
    function walk(node: unknown) {
      if (!node || typeof node !== 'object') return
      const n = node as Record<string, unknown>
      if (n.type === 'text' && typeof n.text === 'string') parts.push(n.text)
      if (Array.isArray(n.content)) n.content.forEach(walk)
    }
    walk(doc)
    return parts.join(' ').trim()
  } catch {
    return tiptapJson
  }
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface JournalEditorEmbedProps {
  dateKey: string
  rawContent: string
  isDark: boolean
  onChange: (serialized: string) => void
  attachments?: TaskAttachment[]
  onAttachmentsChange?: (atts: TaskAttachment[]) => void
}

// ─── Component ────────────────────────────────────────────────────────────────

export function JournalEditorEmbed({
  dateKey, rawContent, isDark, onChange,
  attachments = [], onAttachmentsChange,
}: JournalEditorEmbedProps) {
  const [showEmoji, setShowEmoji]   = useState(false)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [uploading, setUploading]   = useState(false)
  const [lightbox, setLightbox]     = useState<string | null>(null)
  const suppressUpdate = useRef(false)
  const emojiBtnRef    = useRef<HTMLButtonElement>(null)
  const uploadRef      = useRef<HTMLInputElement>(null)
  const docRef         = useRef<JournalDoc>({ v: 1, blocks: [] })

  const acc   = '#7c3aed'
  const bdr   = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'
  const muted = isDark ? 'rgba(255,255,255,0.38)' : 'rgba(0,0,0,0.36)'

  // Parse current doc and find editable first text block
  const doc = useMemo(() => parseJournalDoc(rawContent), [rawContent]) // eslint-disable-line react-hooks/exhaustive-deps
  const firstTextBlock: JournalBlock | undefined = doc.blocks.find(b => b.type === 'text') ?? doc.blocks[0]
  const otherBlocks = doc.blocks.filter(b => b.id !== firstTextBlock?.id)

  // ── Editor ────────────────────────────────────────────────────────────────
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false, codeBlock: false, blockquote: false,
        strike: false, code: false, bold: false, italic: false, horizontalRule: false,
      }),
      TaskList,
      TaskItem.configure({ nested: false }),
      Placeholder.configure({ placeholder: 'What made today great? Reflections, insights, gratitude…' }),
    ],
    content: parseJournalContent(firstTextBlock?.content),
    editorProps: { attributes: { class: 'xp-je-prose' } },
    onUpdate: ({ editor: e }) => {
      if (suppressUpdate.current) return
      const content = serializeJournalContent(e)
      // Update first text block, preserve the rest of the doc
      const updatedBlocks = docRef.current.blocks.map(b =>
        b.id === firstTextBlock?.id ? { ...b, content, updatedAt: Date.now() } : b
      )
      const updatedDoc: JournalDoc = { ...docRef.current, blocks: updatedBlocks }
      docRef.current = updatedDoc
      onChange(JSON.stringify(updatedDoc))
    },
  })

  // Reload content when date changes
  useEffect(() => {
    const newDoc = parseJournalDoc(rawContent)
    docRef.current = newDoc
    const first = newDoc.blocks.find(b => b.type === 'text') ?? newDoc.blocks[0]
    if (!editor || !first) return
    suppressUpdate.current = true
    editor.commands.setContent(parseJournalContent(first?.content))
    requestAnimationFrame(() => { suppressUpdate.current = false })
    setShowEmoji(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateKey])

  // Keep docRef in sync when rawContent changes externally (e.g. from main Journal)
  useEffect(() => {
    docRef.current = parseJournalDoc(rawContent)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawContent])

  // ── Emoji ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!showEmoji) return
    function outside(e: MouseEvent) {
      const t = e.target as Node
      if (emojiBtnRef.current?.contains(t)) return
      if (document.getElementById('xp-je-emoji')?.contains(t)) return
      setShowEmoji(false)
    }
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [showEmoji])

  function handleEmojiClick(data: EmojiClickData) {
    editor?.chain().focus().insertContent(data.emoji).run()
    setShowEmoji(false)
  }

  // ── File attachments (legacy DayData.attachments path) ───────────────────
  async function handleFiles(files: File[] | FileList | null, source: 'upload' | 'camera') {
    if (!files || files.length === 0) return
    setUploading(true)
    try {
      const next = await buildAttachments(files, source)
      onAttachmentsChange?.([...attachments, ...next])
    } finally { setUploading(false) }
  }

  const isActive = (name: string) => editor?.isActive(name) ?? false

  function tbBtn(active: boolean): React.CSSProperties {
    return {
      padding: '3px 8px', borderRadius: 5,
      border: `0.5px solid ${active ? acc : bdr}`,
      background: active ? (isDark ? 'rgba(124,58,237,0.20)' : 'rgba(124,58,237,0.09)') : 'transparent',
      color: active ? acc : muted,
      cursor: 'pointer', fontSize: 11, fontWeight: active ? 600 : 500,
      transition: 'all 120ms', flexShrink: 0, whiteSpace: 'nowrap' as const,
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        .xp-je-prose {
          outline: none;
          font-size: 12px;
          line-height: 1.65;
          font-family: inherit;
          color: ${isDark ? '#f1f5f9' : '#0f172a'};
          min-height: 72px;
        }
        .xp-je-prose p { margin: 0 0 4px; }
        .xp-je-prose p:last-child { margin-bottom: 0; }
        .xp-je-prose ul:not([data-type="taskList"]) { padding-left: 18px; margin: 0 0 4px; list-style: disc; }
        .xp-je-prose ol { padding-left: 20px; margin: 0 0 4px; list-style: decimal; }
        .xp-je-prose li { margin-bottom: 2px; }
        .xp-je-prose ul[data-type="taskList"] { list-style: none; padding-left: 0; margin: 0 0 4px; }
        .xp-je-prose ul[data-type="taskList"] > li { display: flex; align-items: flex-start; gap: 6px; margin-bottom: 3px; }
        .xp-je-prose ul[data-type="taskList"] > li > label { flex-shrink: 0; margin-top: 2px; cursor: pointer; display: flex; }
        .xp-je-prose ul[data-type="taskList"] > li > label > input[type="checkbox"] { width: 13px; height: 13px; cursor: pointer; accent-color: ${acc}; margin: 0; }
        .xp-je-prose ul[data-type="taskList"] > li > div { flex: 1; min-width: 0; }
        .xp-je-prose ul[data-type="taskList"] > li[data-checked="true"] > div { opacity: 0.52; }
        .xp-je-prose p.is-editor-empty:first-child::before { content: attr(data-placeholder); color: ${isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.28)'}; float: left; pointer-events: none; height: 0; }
      `}</style>

      {/* Main text editor */}
      <div
        onClick={() => editor?.commands.focus()}
        style={{ minHeight: 90, cursor: 'text', padding: '8px 12px', borderRadius: 10, border: '1px solid var(--xp-bdr2)', background: 'var(--xp-bg3)' }}
      >
        <EditorContent editor={editor} />
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6, gap: 4, flexWrap: 'wrap', position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap' }}>
          <button onClick={() => editor?.chain().focus().toggleBulletList().run()} style={tbBtn(isActive('bulletList'))} title="Bulleted list">• List</button>
          <button onClick={() => editor?.chain().focus().toggleOrderedList().run()} style={tbBtn(isActive('orderedList'))} title="Numbered list">1. List</button>
          <button onClick={() => editor?.chain().focus().toggleTaskList().run()} style={tbBtn(isActive('taskList'))} title="Interactive checklist">☐ Check</button>
          {onAttachmentsChange && (
            <>
              <button onClick={() => uploadRef.current?.click()} disabled={uploading} style={{ ...tbBtn(false), opacity: uploading ? 0.5 : 1 }} title="Upload">📎</button>
              <button onClick={() => setCameraOpen(true)} disabled={uploading} style={{ ...tbBtn(false), opacity: uploading ? 0.5 : 1 }} title="Camera">📷</button>
              <input ref={uploadRef} type="file" multiple accept={ATTACHMENT_ACCEPT} style={{ display: 'none' }}
                onChange={e => { handleFiles(e.target.files, 'upload'); e.currentTarget.value = '' }} />
            </>
          )}
        </div>
        <button
          ref={emojiBtnRef}
          onClick={() => setShowEmoji(v => !v)}
          style={{ background: 'none', border: `0.5px solid ${bdr}`, borderRadius: 6, cursor: 'pointer', fontSize: 14, padding: '3px 7px', lineHeight: 1, color: muted }}
          title="Insert emoji"
        >😊</button>

        {showEmoji && (
          <div id="xp-je-emoji" style={{ position: 'absolute', bottom: 32, right: 0, zIndex: 100, borderRadius: 12, overflow: 'hidden', boxShadow: `0 8px 32px rgba(0,0,0,${isDark ? '0.50' : '0.20'})` }}>
            <EmojiPickerLib onEmojiClick={handleEmojiClick} theme={isDark ? Theme.DARK : Theme.LIGHT} width={280} height={340} searchPlaceHolder="Search emoji…" lazyLoadEmojis />
          </div>
        )}
      </div>

      {/* Other blocks — read-only preview */}
      {otherBlocks.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
          {otherBlocks.map(block => (
            <BlockReadOnly key={block.id} block={block} isDark={isDark} onPreview={src => setLightbox(src)} />
          ))}
        </div>
      )}

      {/* Legacy attachments from DayData.attachments */}
      {attachments.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
          {attachments.map(att => (
            <AttachmentItem key={att.id} attachment={att} isDark={isDark}
              onRemove={() => onAttachmentsChange?.(removeAttachmentById(attachments, att.id))}
              onPreview={() => { if (att.mimeType.startsWith('image/')) setLightbox(att.url) }}
            />
          ))}
        </div>
      )}

      {lightbox && <ImageLightbox src={lightbox} alt="Preview" onClose={() => setLightbox(null)} />}
      {cameraOpen && (
        <CameraModal onCapture={file => handleFiles([file], 'camera')} onClose={() => setCameraOpen(false)} />
      )}
    </>
  )
}

// ─── BlockReadOnly ────────────────────────────────────────────────────────────

function BlockReadOnly({ block, isDark, onPreview }: { block: JournalBlock; isDark: boolean; onPreview: (src: string) => void }) {
  if (block.type === 'drawing' || block.type === 'image') {
    return (
      <div style={{ position: 'relative' }}>
        {block.thumbnail && (
          <img
            src={block.thumbnail}
            alt={block.name ?? (block.type === 'drawing' ? 'Drawing' : 'Image')}
            onClick={() => block.src && onPreview(block.src)}
            style={{ maxWidth: '100%', borderRadius: 8, display: 'block', cursor: 'zoom-in',
              border: `0.5px solid ${isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)'}` }}
          />
        )}
        {block.name && (
          <div style={{ fontSize: 10, color: isDark ? 'rgba(255,255,255,0.38)' : 'rgba(0,0,0,0.38)', marginTop: 3, textAlign: 'center' }}>
            {block.type === 'drawing' ? '✏️ ' : '📷 '}{block.name}
          </div>
        )}
      </div>
    )
  }

  if (block.type === 'section') {
    const s = getSectionStyle(block.sectionColor ?? 'lavender', isDark)
    const colorLabel = SECTION_COLORS.find(c => c.key === block.sectionColor)?.label ?? 'Section'
    const text = extractPlainText(block.content)
    return (
      <div style={{ borderRadius: 8, border: `0.5px solid ${s.border}`, background: s.background, padding: '8px 10px' }}>
        <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: s.labelColor, marginBottom: 4 }}>{colorLabel}</div>
        {text && <div style={{ fontSize: 11, color: isDark ? 'rgba(255,255,255,0.72)' : 'rgba(0,0,0,0.68)', lineHeight: 1.5 }}>{text}</div>}
      </div>
    )
  }

  // Secondary text block — show as plain text
  const text = extractPlainText(block.content)
  if (!text) return null
  return (
    <div style={{ fontSize: 11, color: isDark ? 'rgba(255,255,255,0.58)' : 'rgba(0,0,0,0.55)', lineHeight: 1.5, paddingLeft: 8,
      borderLeft: `2px solid ${isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)'}` }}>
      {text}
    </div>
  )
}


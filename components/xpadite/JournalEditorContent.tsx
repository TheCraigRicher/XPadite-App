'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Placeholder from '@tiptap/extension-placeholder'
import { Theme } from 'emoji-picker-react'
import type { EmojiClickData } from 'emoji-picker-react'
import dynamic from 'next/dynamic'
import { buildAttachments, removeAttachmentById, ATTACHMENT_ACCEPT, AttachmentItem, ImageLightbox, CameraModal } from './attachmentUtils'
import type { TaskAttachment } from './types'

const EmojiPicker = dynamic(() => import('emoji-picker-react'), { ssr: false })

// ─── Content helpers ──────────────────────────────────────────────────────────

export function parseJournalContent(raw: string): object {
  if (!raw?.trim()) return { type: 'doc', content: [{ type: 'paragraph' }] }
  try {
    const parsed = JSON.parse(raw)
    if (parsed?.type === 'doc') return parsed
  } catch {}
  // Legacy plain text → wrap each line as a paragraph
  return {
    type: 'doc',
    content: raw.split('\n').map(line => ({
      type: 'paragraph',
      ...(line ? { content: [{ type: 'text', text: line }] } : {}),
    })),
  }
}

export function serializeJournalContent(editor: ReturnType<typeof useEditor>): string {
  if (!editor) return ''
  if (editor.getText().trim() === '') return ''
  return JSON.stringify(editor.getJSON())
}

function fmtEditorDate(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })
}

// ─── Component ────────────────────────────────────────────────────────────────

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
  attachments?: TaskAttachment[]
  onAttachmentsChange?: (atts: TaskAttachment[]) => void
}

export function JournalEditorContent({
  dateKey,
  rawContent,
  isDark,
  isEditorOnToday,
  onContentChange,
  onPersist,
  onNavigateDay,
  onNavigateToday,
  onBack,
  onClose,
  attachments = [],
  onAttachmentsChange,
}: JournalEditorContentProps) {
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved'>('idle')
  const [showEmoji, setShowEmoji] = useState(false)
  const [serialized, setSerialized] = useState('')
  const [committed, setCommitted] = useState('')
  const [cameraOpen, setCameraOpen] = useState(false)
  const [lightbox, setLightbox] = useState<string | null>(null)
  const emojiBtnRef = useRef<HTMLButtonElement>(null)
  const uploadRef = useRef<HTMLInputElement>(null)
  // Track whether the current update came from internal navigation (not user typing)
  const suppressUpdate = useRef(false)

  const acc = '#7c3aed'
  const bdr = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'
  const muted = isDark ? 'rgba(255,255,255,0.38)' : 'rgba(0,0,0,0.36)'

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        blockquote: false,
        strike: false,
        code: false,
        bold: false,
        italic: false,
        horizontalRule: false,
      }),
      TaskList,
      TaskItem.configure({ nested: false }),
      Placeholder.configure({
        placeholder: 'What made today great? Reflections, insights, gratitude…',
      }),
    ],
    content: parseJournalContent(rawContent),
    editorProps: {
      attributes: { class: 'xp-j-prose' },
    },
    onUpdate: ({ editor: e }) => {
      if (suppressUpdate.current) return
      const s = serializeJournalContent(e)
      setSerialized(s)
      onContentChange(s)
    },
  })

  // When the date changes, load new content without triggering autosave
  useEffect(() => {
    if (!editor) return
    suppressUpdate.current = true
    editor.commands.setContent(parseJournalContent(rawContent))
    // Read back the serialized form AFTER Tiptap processes the new content
    requestAnimationFrame(() => {
      const s = serializeJournalContent(editor)
      setSerialized(s)
      setCommitted(s)
      setSaveStatus('idle')
      suppressUpdate.current = false
    })
    setShowEmoji(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateKey])

  // Debounced autosave — 1.5 s after the last keystroke
  useEffect(() => {
    if (!serialized || serialized === committed) return
    const t = setTimeout(() => {
      onPersist(dateKey, serialized)
      setCommitted(serialized)
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus(s => (s === 'saved' ? 'idle' : s)), 2200)
    }, 1500)
    return () => clearTimeout(t)
  }, [serialized, committed, dateKey, onPersist])

  const handleManualSave = useCallback(() => {
    onPersist(dateKey, serialized)
    setCommitted(serialized)
    setSaveStatus('saved')
    setTimeout(() => setSaveStatus(s => (s === 'saved' ? 'idle' : s)), 2200)
  }, [dateKey, serialized, onPersist])

  // Attachments
  async function handleFiles(files: File[] | FileList | null, source: 'upload' | 'camera') {
    if (!files || files.length === 0) return
    const next = await buildAttachments(files, source)
    onAttachmentsChange?.([...attachments, ...next])
  }

  // Emoji
  function handleEmojiClick(data: EmojiClickData) {
    editor?.chain().focus().insertContent(data.emoji).run()
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

  const isActive = (name: string) => editor?.isActive(name) ?? false

  function tbBtn(active: boolean): React.CSSProperties {
    return {
      padding: '4px 10px',
      borderRadius: 6,
      border: `0.5px solid ${active ? acc : bdr}`,
      background: active
        ? isDark ? 'rgba(124,58,237,0.20)' : 'rgba(124,58,237,0.09)'
        : 'transparent',
      color: active ? acc : muted,
      cursor: 'pointer',
      fontSize: 12,
      fontWeight: active ? 600 : 500,
      transition: 'all 120ms',
      flexShrink: 0,
      whiteSpace: 'nowrap' as const,
    }
  }

  return (
    <>
      {/* Tiptap + checklist styles */}
      <style>{`
        .xp-j-prose {
          outline: none;
          font-size: 14px;
          line-height: 1.75;
          font-family: inherit;
          color: ${isDark ? '#f1f5f9' : '#0f172a'};
          min-height: 100%;
        }
        .xp-j-prose p { margin: 0 0 6px; }
        .xp-j-prose p:last-child { margin-bottom: 0; }
        .xp-j-prose ul:not([data-type="taskList"]) {
          padding-left: 20px;
          margin: 0 0 6px;
          list-style: disc;
        }
        .xp-j-prose ol {
          padding-left: 22px;
          margin: 0 0 6px;
          list-style: decimal;
        }
        .xp-j-prose li { margin-bottom: 3px; }
        .xp-j-prose ul[data-type="taskList"] {
          list-style: none;
          padding-left: 0;
          margin: 0 0 6px;
        }
        .xp-j-prose ul[data-type="taskList"] > li {
          display: flex;
          align-items: flex-start;
          gap: 7px;
          margin-bottom: 4px;
        }
        .xp-j-prose ul[data-type="taskList"] > li > label {
          flex-shrink: 0;
          margin-top: 3px;
          cursor: pointer;
          display: flex;
        }
        .xp-j-prose ul[data-type="taskList"] > li > label > input[type="checkbox"] {
          width: 14px;
          height: 14px;
          cursor: pointer;
          accent-color: ${acc};
          margin: 0;
        }
        .xp-j-prose ul[data-type="taskList"] > li > div {
          flex: 1;
          min-width: 0;
        }
        .xp-j-prose ul[data-type="taskList"] > li[data-checked="true"] > div {
          opacity: 0.52;
        }
        .xp-j-prose p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          color: ${isDark ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.30)'};
          float: left;
          pointer-events: none;
          height: 0;
        }
      `}</style>

      {/* Date navigation header */}
      <div style={{
        background: 'linear-gradient(135deg, #3b0f8a 0%, #4c1d95 100%)',
        padding: '12px 16px 14px',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <button onClick={onBack} style={{
            background: 'rgba(255,255,255,0.12)', border: 'none', borderRadius: 6,
            color: 'rgba(255,255,255,0.85)', cursor: 'pointer',
            padding: '4px 11px', fontSize: 12, fontWeight: 500,
          }}>
            ‹ Calendar
          </button>
          <button onClick={onClose} style={{
            width: 28, height: 28, borderRadius: '50%', border: 'none', cursor: 'pointer',
            background: 'rgba(255,255,255,0.14)', color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14,
          }}>
            ✕
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <button onClick={() => onNavigateDay(-1)} title="Previous day" style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'rgba(255,255,255,0.65)', fontSize: 24, padding: '0 8px', lineHeight: 1, flexShrink: 0,
          }}>‹</button>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
            <span style={{ color: '#fff', fontSize: 13, fontWeight: 600, letterSpacing: '-0.01em', textAlign: 'center', lineHeight: 1.3 }}>
              {fmtEditorDate(dateKey)}
            </span>
            {!isEditorOnToday && (
              <button onClick={onNavigateToday} style={{
                background: 'rgba(255,255,255,0.14)', border: 'none', borderRadius: 4,
                color: 'rgba(255,255,255,0.78)', cursor: 'pointer', padding: '2px 9px', fontSize: 10, fontWeight: 500,
              }}>
                Today
              </button>
            )}
          </div>
          <button onClick={() => onNavigateDay(1)} title="Next day" style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'rgba(255,255,255,0.65)', fontSize: 24, padding: '0 8px', lineHeight: 1, flexShrink: 0,
          }}>›</button>
        </div>
      </div>

      {/* Editor + toolbar */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '14px 16px 12px', overflow: 'hidden', position: 'relative' }}>
        {/* Editor scroll area */}
        <div
          onClick={() => editor?.commands.focus()}
          style={{
            flex: 1, overflowY: 'auto', cursor: 'text',
            padding: '12px 14px',
            borderRadius: 12,
            border: `0.5px solid ${bdr}`,
            background: isDark ? 'rgba(255,255,255,0.025)' : '#f8fafc',
          }}
        >
          <EditorContent editor={editor} />
        </div>

        {/* Formatting toolbar + save row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, gap: 6 }}>
          {/* Formatting controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
            <button onClick={() => editor?.chain().focus().toggleBulletList().run()} style={tbBtn(isActive('bulletList'))} title="Bulleted list">• List</button>
            <button onClick={() => editor?.chain().focus().toggleOrderedList().run()} style={tbBtn(isActive('orderedList'))} title="Numbered list">1. List</button>
            <button onClick={() => editor?.chain().focus().toggleTaskList().run()} style={tbBtn(isActive('taskList'))} title="Interactive checklist">☐ Check</button>

            {onAttachmentsChange && (
              <>
                <button onClick={() => uploadRef.current?.click()} style={tbBtn(false)} title="Upload file or photo">📎</button>
                <button onClick={() => setCameraOpen(true)} style={tbBtn(false)} title="Take a photo">📷</button>
                <input ref={uploadRef} type="file" multiple accept={ATTACHMENT_ACCEPT} style={{ display: 'none' }}
                  onChange={e => { handleFiles(e.target.files, 'upload'); e.currentTarget.value = '' }} />
              </>
            )}

            <span style={{
              fontSize: 11,
              color: saveStatus === 'saved' ? '#16a34a' : 'transparent',
              transition: 'color 200ms',
              userSelect: 'none',
              marginLeft: 4,
              whiteSpace: 'nowrap',
            }}>
              Saved ✓
            </span>
          </div>

          {/* Emoji + save */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <button
              ref={emojiBtnRef}
              onClick={() => setShowEmoji(v => !v)}
              title="Add emoji"
              style={{ background: 'none', border: `0.5px solid ${bdr}`, borderRadius: 8, cursor: 'pointer', fontSize: 16, padding: '4px 8px', lineHeight: 1, color: muted }}
            >
              😊
            </button>
            <button
              onClick={handleManualSave}
              style={{
                padding: '6px 16px', borderRadius: 8, border: 'none',
                background: 'linear-gradient(135deg, #7c3aed, #6d28d9)',
                color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              Save Notes
            </button>
          </div>
        </div>

        {/* Attachments */}
        {attachments.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 10 }}>
            {attachments.map(att => (
              <AttachmentItem
                key={att.id}
                attachment={att}
                isDark={isDark}
                onRemove={() => onAttachmentsChange?.(removeAttachmentById(attachments, att.id))}
                onPreview={() => { if (att.mimeType.startsWith('image/')) setLightbox(att.url) }}
              />
            ))}
          </div>
        )}

        {/* Emoji picker */}
        {showEmoji && (
          <div id="xp-j-emoji" style={{
            position: 'absolute', bottom: 62, right: 16, zIndex: 100,
            borderRadius: 12, overflow: 'hidden',
            boxShadow: `0 8px 32px rgba(0,0,0,${isDark ? '0.50' : '0.20'})`,
          }}>
            <EmojiPicker
              onEmojiClick={handleEmojiClick}
              theme={isDark ? Theme.DARK : Theme.LIGHT}
              width={300}
              height={360}
              searchPlaceHolder="Search emoji…"
              lazyLoadEmojis
            />
          </div>
        )}
      </div>

      {lightbox && <ImageLightbox src={lightbox} alt="Attachment preview" onClose={() => setLightbox(null)} />}
      {cameraOpen && (
        <CameraModal onCapture={file => handleFiles([file], 'camera')} onClose={() => setCameraOpen(false)} />
      )}
    </>
  )
}

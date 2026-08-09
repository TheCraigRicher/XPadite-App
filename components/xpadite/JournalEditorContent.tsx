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
import { JournalDrawModal } from './JournalDrawModal'

const EmojiPicker = dynamic(() => import('emoji-picker-react'), { ssr: false })

// ─── Content helpers ──────────────────────────────────────────────────────────

export function parseJournalContent(raw: string): object {
  if (!raw?.trim()) return { type: 'doc', content: [{ type: 'paragraph' }] }
  try {
    const parsed = JSON.parse(raw)
    if (parsed?.type === 'doc') return parsed
  } catch {}
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
  dateKey, rawContent, isDark, isEditorOnToday,
  onContentChange, onPersist, onNavigateDay, onNavigateToday,
  onBack, onClose, attachments = [], onAttachmentsChange,
}: JournalEditorContentProps) {

  const [saveStatus, setSaveStatus]   = useState<'idle' | 'saved'>('idle')
  const [showEmoji, setShowEmoji]     = useState(false)
  const [drawOpen, setDrawOpen]       = useState(false)
  const [serialized, setSerialized]   = useState('')
  const [committed, setCommitted]     = useState('')
  const [cameraOpen, setCameraOpen]   = useState(false)
  const [lightbox, setLightbox]       = useState<string | null>(null)
  const emojiBtnRef   = useRef<HTMLButtonElement>(null)
  const uploadRef     = useRef<HTMLInputElement>(null)
  const suppressUpdate = useRef(false)

  const acc = '#7c3aed'

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
    content: parseJournalContent(rawContent),
    editorProps: { attributes: { class: 'xp-j-prose' } },
    onUpdate: ({ editor: e }) => {
      if (suppressUpdate.current) return
      const s = serializeJournalContent(e)
      setSerialized(s)
      onContentChange(s)
    },
  })

  // Reload on date change, suppressing autosave
  useEffect(() => {
    if (!editor) return
    suppressUpdate.current = true
    editor.commands.setContent(parseJournalContent(rawContent))
    requestAnimationFrame(() => {
      const s = serializeJournalContent(editor)
      setSerialized(s)
      setCommitted(s)
      setSaveStatus('idle')
      suppressUpdate.current = false
    })
    setShowEmoji(false)
    setDrawOpen(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateKey])

  // Debounced autosave
  useEffect(() => {
    if (!serialized || serialized === committed) return
    const t = setTimeout(() => {
      onPersist(dateKey, serialized)
      setCommitted(serialized)
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus(s => s === 'saved' ? 'idle' : s), 2200)
    }, 1500)
    return () => clearTimeout(t)
  }, [serialized, committed, dateKey, onPersist])

  const handleManualSave = useCallback(() => {
    onPersist(dateKey, serialized)
    setCommitted(serialized)
    setSaveStatus('saved')
    setTimeout(() => setSaveStatus(s => s === 'saved' ? 'idle' : s), 2200)
  }, [dateKey, serialized, onPersist])

  // ── Attachments ───────────────────────────────────────────────────────────
  async function handleFiles(files: File[] | FileList | null, source: 'upload' | 'camera') {
    if (!files || files.length === 0) return
    const next = await buildAttachments(files, source)
    onAttachmentsChange?.([...attachments, ...next])
  }

  function handleDrawingSave(dataUrl: string) {
    const att: TaskAttachment = {
      id:        crypto.randomUUID(),
      name:      `Drawing — ${fmtEditorDate(dateKey)}`,
      mimeType:  'image/png',
      size:      Math.round(dataUrl.length * 0.75),
      url:       dataUrl,
      thumbnail: dataUrl,
      addedAt:   Date.now(),
      source:    'drawing',
    }
    onAttachmentsChange?.([...attachments, att])
    setDrawOpen(false)
  }

  // ── Emoji ─────────────────────────────────────────────────────────────────
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

  // ── Dock button style ─────────────────────────────────────────────────────
  // Premium dark-dock buttons — readable by default, purple on hover/active
  function dockBtn(active = false): React.CSSProperties {
    return {
      padding: '5px 11px', borderRadius: 7, cursor: 'pointer',
      border: `0.5px solid ${active
        ? 'rgba(124,58,237,0.55)'
        : isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.15)'}`,
      background: active
        ? 'rgba(124,58,237,0.22)'
        : isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)',
      color: active
        ? '#a78bfa'
        : isDark ? 'rgba(255,255,255,0.82)' : 'rgba(0,0,0,0.72)',
      fontSize: 12, fontWeight: active ? 600 : 500,
      transition: 'all 120ms', flexShrink: 0, whiteSpace: 'nowrap' as const,
    }
  }

  // ── Dock surface colours ──────────────────────────────────────────────────
  const dockBg   = isDark ? 'rgba(9,4,22,0.96)'                   : '#f1f5f9'
  const dockBdr  = isDark ? 'rgba(255,255,255,0.07)'               : 'rgba(0,0,0,0.09)'
  const dockDivider = isDark ? 'rgba(255,255,255,0.10)'            : 'rgba(0,0,0,0.12)'
  const editorBg = isDark ? 'rgba(255,255,255,0.025)'              : '#f8fafc'
  const editorBdr = isDark ? 'rgba(255,255,255,0.08)'              : 'rgba(0,0,0,0.10)'

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── CSS: prose, placeholder, xp-j-hdr animation, dock hover ── */}
      <style>{`
        @keyframes xpJHdrFlow {
          0%   { background-position: 0%   50%; }
          50%  { background-position: 100% 50%; }
          100% { background-position: 0%   50%; }
        }
        .xp-j-hdr {
          background: linear-gradient(
            135deg,
            #0f052e  0%,
            #2d1b69 45%,
            #4c1d95 75%,
            #1a0a4e 100%
          );
          background-size: 300% 300%;
          animation: xpJHdrFlow 16s ease infinite;
        }
        /* Dock button hover — skip active (.xp-j-active) */
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
          min-height: 100%;
        }
        .xp-j-prose p { margin: 0 0 6px; }
        .xp-j-prose p:last-child { margin-bottom: 0; }
        .xp-j-prose ul:not([data-type="taskList"]) { padding-left: 20px; margin: 0 0 6px; list-style: disc; }
        .xp-j-prose ol { padding-left: 22px; margin: 0 0 6px; list-style: decimal; }
        .xp-j-prose li { margin-bottom: 3px; }
        .xp-j-prose ul[data-type="taskList"] { list-style: none; padding-left: 0; margin: 0 0 6px; }
        .xp-j-prose ul[data-type="taskList"] > li { display: flex; align-items: flex-start; gap: 7px; margin-bottom: 4px; }
        .xp-j-prose ul[data-type="taskList"] > li > label { flex-shrink: 0; margin-top: 3px; cursor: pointer; display: flex; }
        .xp-j-prose ul[data-type="taskList"] > li > label > input[type="checkbox"] { width: 14px; height: 14px; cursor: pointer; accent-color: ${acc}; margin: 0; }
        .xp-j-prose ul[data-type="taskList"] > li > div { flex: 1; min-width: 0; }
        .xp-j-prose ul[data-type="taskList"] > li[data-checked="true"] > div { opacity: 0.52; }
        .xp-j-prose p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          color: ${isDark ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.30)'};
          float: left; pointer-events: none; height: 0;
        }
      `}</style>

      {/* ── Header — animated purple, centered date ── */}
      <div className="xp-j-hdr" style={{ flexShrink: 0, borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>

        {/* Row 1: Back | Centered date | Close */}
        <div style={{
          position: 'relative', display: 'flex', alignItems: 'center',
          padding: '12px 20px 0',
        }}>
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium hover:opacity-80 flex-shrink-0"
            style={{ background: 'rgba(255,255,255,0.08)', border: '0.5px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.80)' }}
          >
            ← Calendar
          </button>

          {/* Date — absolutely centered so it's never offset by button widths */}
          <div style={{
            position: 'absolute', left: 0, right: 0,
            display: 'flex', justifyContent: 'center', alignItems: 'center',
            pointerEvents: 'none',
          }}>
            <span style={{
              color: '#fff', fontSize: 13, fontWeight: 600,
              letterSpacing: '-0.01em', textAlign: 'center', lineHeight: 1.3,
            }}>
              {fmtEditorDate(dateKey)}
            </span>
          </div>

          {/* Close — right end */}
          <div style={{ flex: 1 }} />
          <button
            onClick={onClose}
            className="text-xs px-2.5 py-1.5 rounded-lg hover:opacity-80 flex-shrink-0"
            style={{ background: 'rgba(239,68,68,0.15)', border: '0.5px solid rgba(239,68,68,0.28)', color: '#fca5a5' }}
          >
            × Close
          </button>
        </div>

        {/* Row 2: Day navigation — centered */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 10, padding: '10px 20px 13px',
        }}>
          <button
            onClick={() => onNavigateDay(-1)}
            title="Previous day"
            style={{
              background: 'rgba(255,255,255,0.08)', border: '0.5px solid rgba(255,255,255,0.12)',
              borderRadius: 7, cursor: 'pointer',
              color: 'rgba(255,255,255,0.70)', fontSize: 18, padding: '2px 10px', lineHeight: 1,
              transition: 'all 120ms',
            }}
          >‹</button>

          {!isEditorOnToday && (
            <button
              onClick={onNavigateToday}
              className="text-[10px] px-2.5 py-1 rounded-full border transition-colors hover:border-violet-400 hover:text-violet-400"
              style={{ borderColor: 'rgba(255,255,255,0.22)', color: 'rgba(255,255,255,0.60)' }}
            >
              Today
            </button>
          )}

          <button
            onClick={() => onNavigateDay(1)}
            title="Next day"
            style={{
              background: 'rgba(255,255,255,0.08)', border: '0.5px solid rgba(255,255,255,0.12)',
              borderRadius: 7, cursor: 'pointer',
              color: 'rgba(255,255,255,0.70)', fontSize: 18, padding: '2px 10px', lineHeight: 1,
              transition: 'all 120ms',
            }}
          >›</button>
        </div>
      </div>

      {/* ── Writing canvas ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px 0', position: 'relative' }}>
        <div
          onClick={() => editor?.commands.focus()}
          style={{
            minHeight: '100%', cursor: 'text',
            padding: '16px 18px',
            borderRadius: 12,
            border: `0.5px solid ${editorBdr}`,
            background: editorBg,
            boxShadow: isDark ? 'inset 0 1px 0 rgba(255,255,255,0.03)' : 'inset 0 1px 0 rgba(0,0,0,0.02)',
            transition: 'border-color 150ms',
          }}
        >
          <EditorContent editor={editor} />
        </div>

        {/* Attachments list (below writing area, above dock) */}
        {attachments.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 10, marginBottom: 10 }}>
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
      </div>

      {/* ── Premium tool dock ── */}
      <div style={{
        background: dockBg,
        borderTop: `0.5px solid ${dockBdr}`,
        boxShadow: isDark
          ? 'inset 0 1px 0 rgba(255,255,255,0.04), 0 -4px 16px rgba(0,0,0,0.30)'
          : 'inset 0 1px 0 rgba(0,0,0,0.04)',
        padding: '10px 16px 12px',
        flexShrink: 0,
        display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', gap: 6,
        flexWrap: 'wrap',
        position: 'relative',
      }}>
        {/* Left cluster: Formatting + Attachments + Draw */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>

          {/* Formatting group */}
          <button
            className={`xp-jd-btn${isActive('bulletList') ? ' xp-j-active' : ''}`}
            style={dockBtn(isActive('bulletList'))}
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
            title="Bulleted list"
          >• List</button>
          <button
            className={`xp-jd-btn${isActive('orderedList') ? ' xp-j-active' : ''}`}
            style={dockBtn(isActive('orderedList'))}
            onClick={() => editor?.chain().focus().toggleOrderedList().run()}
            title="Numbered list"
          >1. List</button>
          <button
            className={`xp-jd-btn${isActive('taskList') ? ' xp-j-active' : ''}`}
            style={dockBtn(isActive('taskList'))}
            onClick={() => editor?.chain().focus().toggleTaskList().run()}
            title="Interactive checklist"
          >☐ Check</button>

          {/* Divider */}
          <span style={{ width: 1, height: 18, background: dockDivider, flexShrink: 0, margin: '0 2px' }} />

          {/* Attachments group */}
          {onAttachmentsChange && (
            <>
              <button
                className="xp-jd-btn"
                style={dockBtn()}
                onClick={() => uploadRef.current?.click()}
                title="Upload file or photo"
              >📎 Upload</button>
              <button
                className="xp-jd-btn"
                style={dockBtn()}
                onClick={() => setCameraOpen(true)}
                title="Take a photo"
              >📷 Camera</button>
              <input
                ref={uploadRef}
                type="file" multiple accept={ATTACHMENT_ACCEPT}
                style={{ display: 'none' }}
                onChange={e => { handleFiles(e.target.files, 'upload'); e.currentTarget.value = '' }}
              />
            </>
          )}

          {/* Draw */}
          <button
            className="xp-jd-btn"
            style={dockBtn()}
            onClick={() => setDrawOpen(true)}
            title="Freehand drawing"
          >✏️ Draw</button>
        </div>

        {/* Right cluster: Emoji + Saved ✓ + Save Notes */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {/* Saved indicator */}
          <span style={{
            fontSize: 11, whiteSpace: 'nowrap', userSelect: 'none',
            color: saveStatus === 'saved' ? '#16a34a' : 'transparent',
            transition: 'color 200ms',
          }}>
            Saved ✓
          </span>

          {/* Emoji trigger */}
          <button
            ref={emojiBtnRef}
            className="xp-jd-btn"
            onClick={() => setShowEmoji(v => !v)}
            title="Add emoji"
            style={{
              ...dockBtn(),
              fontSize: 16, padding: '4px 9px', lineHeight: 1, borderRadius: 8,
            }}
          >
            😊
          </button>

          {/* Save Notes CTA */}
          <button
            onClick={handleManualSave}
            style={{
              padding: '6px 18px', borderRadius: 8, border: 'none', cursor: 'pointer',
              background: 'linear-gradient(135deg, #7c3aed, #6d28d9)',
              color: '#fff', fontSize: 12, fontWeight: 600,
              boxShadow: '0 2px 8px rgba(124,58,237,0.35)',
              whiteSpace: 'nowrap', transition: 'opacity 120ms',
            }}
          >
            Save Notes
          </button>
        </div>

        {/* Emoji picker — floats above dock */}
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

      {/* ── Overlays ── */}
      {lightbox && (
        <ImageLightbox src={lightbox} alt="Attachment preview" onClose={() => setLightbox(null)} />
      )}
      {cameraOpen && (
        <CameraModal
          onCapture={file => handleFiles([file], 'camera')}
          onClose={() => setCameraOpen(false)}
        />
      )}
      {drawOpen && (
        <JournalDrawModal
          isDark={isDark}
          onSave={handleDrawingSave}
          onClose={() => setDrawOpen(false)}
        />
      )}
    </>
  )
}

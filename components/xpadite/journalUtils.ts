import type { Editor } from '@tiptap/react'
import type { JournalBlock, JournalDoc } from './types'

// ─── ID helpers ───────────────────────────────────────────────────────────────

export function mkId(): string {
  return typeof crypto !== 'undefined'
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2)
}

function now(): number {
  return Date.now()
}

// ─── Section colors ───────────────────────────────────────────────────────────

export const SECTION_COLORS = [
  { key: 'plain',   label: 'Plain'   },
  { key: 'blue',    label: 'Blue'    },
  { key: 'green',   label: 'Green'   },
  { key: 'peach',   label: 'Peach'   },
  { key: 'pink',    label: 'Pink'    },
  { key: 'lavender',label: 'Lavender'},
] as const

export type SectionColorKey = (typeof SECTION_COLORS)[number]['key']

interface SectionStyle {
  background: string
  border: string
  labelColor: string
}

export function getSectionStyle(colorKey: string, isDark: boolean): SectionStyle {
  const map: Record<string, { d: SectionStyle; l: SectionStyle }> = {
    plain: {
      d: { background: 'rgba(255,255,255,0.035)', border: 'rgba(255,255,255,0.10)', labelColor: 'rgba(255,255,255,0.28)' },
      l: { background: 'rgba(0,0,0,0.022)',       border: 'rgba(0,0,0,0.09)',       labelColor: 'rgba(0,0,0,0.28)' },
    },
    blue: {
      d: { background: 'rgba(59,130,246,0.10)', border: 'rgba(59,130,246,0.28)', labelColor: '#93c5fd' },
      l: { background: 'rgba(59,130,246,0.07)', border: 'rgba(59,130,246,0.22)', labelColor: '#2563eb' },
    },
    green: {
      d: { background: 'rgba(34,197,94,0.09)',  border: 'rgba(34,197,94,0.26)',  labelColor: '#86efac' },
      l: { background: 'rgba(34,197,94,0.07)',  border: 'rgba(34,197,94,0.20)',  labelColor: '#16a34a' },
    },
    peach: {
      d: { background: 'rgba(249,115,22,0.09)', border: 'rgba(249,115,22,0.25)', labelColor: '#fdba74' },
      l: { background: 'rgba(249,115,22,0.07)', border: 'rgba(249,115,22,0.20)', labelColor: '#ea580c' },
    },
    pink: {
      d: { background: 'rgba(236,72,153,0.09)', border: 'rgba(236,72,153,0.26)', labelColor: '#f9a8d4' },
      l: { background: 'rgba(236,72,153,0.07)', border: 'rgba(236,72,153,0.20)', labelColor: '#db2777' },
    },
    lavender: {
      d: { background: 'rgba(124,58,237,0.10)', border: 'rgba(124,58,237,0.28)', labelColor: '#a78bfa' },
      l: { background: 'rgba(124,58,237,0.07)', border: 'rgba(124,58,237,0.22)', labelColor: '#7c3aed' },
    },
  }
  const entry = map[colorKey] ?? map.plain
  return isDark ? entry.d : entry.l
}

// ─── Block factories ──────────────────────────────────────────────────────────

export function createTextBlock(): JournalBlock {
  return { id: mkId(), type: 'text', content: '', createdAt: now(), updatedAt: now() }
}

export function createSectionBlock(sectionColor: SectionColorKey = 'lavender'): JournalBlock {
  return { id: mkId(), type: 'section', content: '', sectionColor, createdAt: now(), updatedAt: now() }
}

export function createDrawingBlock(src: string, name: string): JournalBlock {
  return { id: mkId(), type: 'drawing', src, thumbnail: src, name, createdAt: now(), updatedAt: now() }
}

export function createImageBlock(src: string, name: string): JournalBlock {
  return { id: mkId(), type: 'image', src, thumbnail: src, name, createdAt: now(), updatedAt: now() }
}

// ─── Serialization ────────────────────────────────────────────────────────────

export function serializeJournalDoc(doc: JournalDoc): string {
  return JSON.stringify(doc)
}

// ─── Parsing ──────────────────────────────────────────────────────────────────

function isJournalDoc(parsed: unknown): parsed is JournalDoc {
  return (
    typeof parsed === 'object' &&
    parsed !== null &&
    (parsed as Record<string, unknown>).v === 1 &&
    Array.isArray((parsed as Record<string, unknown>).blocks)
  )
}

function isTiptapDoc(parsed: unknown): boolean {
  return (
    typeof parsed === 'object' &&
    parsed !== null &&
    (parsed as Record<string, unknown>).type === 'doc' &&
    Array.isArray((parsed as Record<string, unknown>).content)
  )
}

/**
 * Parse a raw `DayData.notes` string into a JournalDoc.
 * Handles three cases:
 *   1. New JournalDoc JSON  → returned as-is
 *   2. Old Tiptap JSON      → wrapped in a single text block
 *   3. Plain text / empty   → wrapped in a single text block
 */
export function parseJournalDoc(raw: string | null | undefined): JournalDoc {
  const str = (raw ?? '').trim()

  if (str) {
    try {
      const parsed = JSON.parse(str)
      if (isJournalDoc(parsed)) return parsed
      if (isTiptapDoc(parsed)) {
        // Old Tiptap document — migrate into one text block
        return {
          v: 1,
          blocks: [{ id: mkId(), type: 'text', content: str, createdAt: Date.now(), updatedAt: Date.now() }],
        }
      }
    } catch {
      // fall through to plain-text handling
    }
  }

  // Plain text or empty
  const content = str
    ? JSON.stringify({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: str }] }],
      })
    : ''

  return {
    v: 1,
    blocks: [{ id: mkId(), type: 'text', content, createdAt: Date.now(), updatedAt: Date.now() }],
  }
}

// ─── Legacy compat (used by JournalEditorEmbed) ───────────────────────────────

/**
 * Returns a Tiptap-compatible initial content object from a raw content string.
 * Accepts Tiptap JSON or plain text.
 */
export function parseJournalContent(raw: string | null | undefined): object | string {
  const str = (raw ?? '').trim()
  if (!str) return { type: 'doc', content: [{ type: 'paragraph' }] }
  try {
    const parsed = JSON.parse(str)
    if (isTiptapDoc(parsed)) return parsed
  } catch {
    // not JSON
  }
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: str }] }],
  }
}

/**
 * Serializes a Tiptap editor's content to a string, returning '' for an empty doc.
 */
export function serializeJournalContent(editor: Editor): string {
  if (editor.isEmpty) return ''
  return JSON.stringify(editor.getJSON())
}

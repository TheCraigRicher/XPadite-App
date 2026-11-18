import type { Editor } from '@tiptap/react'
import { Fragment, Slice } from '@tiptap/pm/model'
import type { Node as PMNode, Schema } from '@tiptap/pm/model'
import type { JournalBlock, JournalDoc, SectionCell } from './types'

// ─── Checklist clipboard compatibility (Journal Notes ↔ Task Notes) ───────────
// Task Notes' notes textarea is plain text and represents a checklist line as
// a literal "☐ "/"☑ " prefix (see DayModal.tsx's applyListType/toggleChecklistLine).
// Journal Notes represents the same thing as a real Tiptap taskList/taskItem
// node. These two helpers translate between the representations at the
// clipboard boundary so a checklist survives copy/paste in both directions,
// reusing the exact "☐ "/"☑ " marker convention Task Notes already uses
// instead of inventing a new one.

const CHECK_LINE_RE = /^([☐☑]) (.*)$/

/** Plain-text clipboard serialization for a copied Tiptap slice — gives
 * taskItem nodes their "☐ "/"☑ " prefix so pasting into a plain-text
 * destination (e.g. the Task Notes textarea) still reads as a checklist. */
export function journalClipboardTextSerializer(content: Fragment): string {
  function nodeText(node: PMNode): string {
    if (node.type.name === 'taskItem') {
      return (node.attrs.checked ? '☑ ' : '☐ ') + node.textContent
    }
    if (node.type.name === 'taskList') {
      const lines: string[] = []
      node.forEach(child => lines.push(nodeText(child)))
      return lines.join('\n')
    }
    return node.textContent
  }
  const parts: string[] = []
  content.forEach(node => parts.push(nodeText(node)))
  return parts.join('\n\n')
}

/** Converts "☐ "/"☑ " prefixed plain-text lines pasted into a Journal editor
 * (e.g. copied from a Task Notes textarea) into real taskList/taskItem nodes.
 * Only touches fully-closed top-level paragraphs — the first/last node of an
 * "open" slice (merging into surrounding text) is left untouched so the
 * paste never produces an invalid/corrupt slice. */
export function transformPastedChecklist(slice: Slice, schema: Schema): Slice {
  const { content, openStart, openEnd } = slice
  const taskItemType = schema.nodes.taskItem
  const taskListType = schema.nodes.taskList
  const paragraphType = schema.nodes.paragraph
  if (!taskItemType || !taskListType || !paragraphType || content.childCount === 0) return slice

  type Entry = { task: { checked: boolean; rest: string } } | { node: PMNode }
  const entries: Entry[] = []
  let changed = false

  content.forEach((node, _offset, index) => {
    const isOpenEdge = (index === 0 && openStart > 0) || (index === content.childCount - 1 && openEnd > 0)
    if (!isOpenEdge && node.isTextblock) {
      const m = node.textContent.match(CHECK_LINE_RE)
      if (m) {
        entries.push({ task: { checked: m[1] === '☑', rest: m[2] } })
        changed = true
        return
      }
    }
    entries.push({ node })
  })

  if (!changed) return slice

  const outNodes: PMNode[] = []
  let i = 0
  while (i < entries.length) {
    const entry = entries[i]
    if ('task' in entry) {
      const items: PMNode[] = []
      while (i < entries.length) {
        const e = entries[i]
        if (!('task' in e)) break
        const para = e.task.rest ? paragraphType.create(null, schema.text(e.task.rest)) : paragraphType.create(null)
        items.push(taskItemType.create({ checked: e.task.checked }, para))
        i++
      }
      outNodes.push(taskListType.create(null, items))
    } else {
      outNodes.push(entry.node)
      i++
    }
  }

  return new Slice(Fragment.from(outNodes), openStart, openEnd)
}

// ─── ID helpers ───────────────────────────────────────────────────────────────

export function mkId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // RFC 4122 v4 UUID fallback for environments where crypto.randomUUID is unavailable
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
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
  { key: 'yellow',  label: 'Yellow'  },
  { key: 'teal',    label: 'Teal'    },
  { key: 'rosewood',label: 'Rosewood'},
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
    // Same soft/translucent design philosophy as the other pastels above —
    // a low-opacity tint, not a solid fill, so normal theme text stays readable.
    yellow: {
      d: { background: 'rgba(234,179,8,0.10)',  border: 'rgba(234,179,8,0.28)',  labelColor: '#fbbf24' },
      l: { background: 'rgba(234,179,8,0.08)',  border: 'rgba(202,138,4,0.24)',  labelColor: '#a16207' },
    },
    // v1.347 — solid pastel fills (light theme) exactly as specified; the dark theme keeps the translucent-tint approach of the colors above.
    teal: {
      d: { background: 'rgba(127,207,199,0.12)', border: 'rgba(127,207,199,0.32)', labelColor: '#7fcfc7' },
      l: { background: '#D7F2F0', border: '#7FCFC7', labelColor: '#0f766e' },
    },
    rosewood: {
      d: { background: 'rgba(200,167,185,0.12)', border: 'rgba(200,167,185,0.32)', labelColor: '#d9b8c9' },
      l: { background: '#EADDE5', border: '#C8A7B9', labelColor: '#7a4a62' },
    },
  }
  const entry = map[colorKey] ?? map.plain
  return isDark ? entry.d : entry.l
}

// ─── Table colors ─────────────────────────────────────────────────────────────
// Tables live inside the ProseMirror-managed editor content, whose DOM only
// re-renders on editor transactions — not on ordinary React re-renders like an
// app-wide dark/light toggle. So table fills use one fixed, theme-independent
// set of values per color key (same names/family as SECTION_COLORS) rather
// than getSectionStyle's isDark-branched values, to stay correct regardless of
// when ProseMirror happens to paint the node.
export const TABLE_COLOR_HEX: Record<string, { bg: string; text: string }> = {
  plain:    { bg: '#eef0f4', text: '#1e1e2e' },
  blue:     { bg: '#dbeafe', text: '#1e3a8a' },
  green:    { bg: '#dcfce7', text: '#14532d' },
  peach:    { bg: '#ffe4d1', text: '#7c2d12' },
  pink:     { bg: '#fce7f3', text: '#831843' },
  lavender: { bg: '#ede9fe', text: '#4c1d95' },
  yellow:   { bg: '#fef3c7', text: '#78350f' },
  teal:     { bg: '#D7F2F0', text: '#134e4a' },
  rosewood: { bg: '#EADDE5', text: '#4a2a3b' },
}

export function getTableColor(key: string | undefined) {
  return TABLE_COLOR_HEX[key ?? 'plain'] ?? TABLE_COLOR_HEX.plain
}

// ─── Block factories ──────────────────────────────────────────────────────────

export function createTextBlock(): JournalBlock {
  return { id: mkId(), type: 'text', content: '', createdAt: now(), updatedAt: now() }
}

export function createSectionBlock(sectionColor: SectionColorKey = 'lavender'): JournalBlock {
  return { id: mkId(), type: 'section', content: '', sectionColor, createdAt: now(), updatedAt: now() }
}

export function createDrawingBlock(src: string, name: string, canvasData?: string): JournalBlock {
  return { id: mkId(), type: 'drawing', src, thumbnail: src, name, canvasData, createdAt: now(), updatedAt: now() }
}

export function createImageBlock(src: string, name: string): JournalBlock {
  return { id: mkId(), type: 'image', src, thumbnail: src, name, createdAt: now(), updatedAt: now() }
}

// ─── Section cells (split-section partitions / single-image sections) ────────

export function mkContentCell(content: string): SectionCell {
  return { kind: 'content', content }
}

export function mkImageCell(src: string, name: string, canvasData?: string): SectionCell {
  return { kind: 'image', src, thumbnail: src, name, canvasData }
}

// True only when a section has no sectionImage/partitions AND its own Tiptap
// content parses to an empty doc (no paragraphs with real content) — the
// exact predicate "paste/drop an image into a section" needs: an empty
// section takes the image directly (no split forced); anything else auto-splits.
export function isSectionEmpty(block: JournalBlock): boolean {
  if (block.sectionImage || block.partitions) return false
  const str = (block.content ?? '').trim()
  if (!str) return true
  try {
    const parsed = JSON.parse(str) as { content?: Array<{ content?: unknown[] }> }
    const nodes = parsed.content ?? []
    return nodes.every(n => !n.content || n.content.length === 0)
  } catch {
    return false
  }
}

// Concatenates two Tiptap JSON doc strings' top-level content arrays into
// one — used by "Merge Section" when both partitions are text. Falls back
// to whichever side has real content if the other fails to parse/is empty.
export function mergeTiptapContents(a: string, b: string): string {
  const parse = (s: string): Array<Record<string, unknown>> => {
    const str = (s ?? '').trim()
    if (!str) return []
    try {
      const parsed = JSON.parse(str) as { type?: string; content?: Array<Record<string, unknown>> }
      if (parsed?.type === 'doc' && Array.isArray(parsed.content)) return parsed.content
    } catch { /* fall through */ }
    return []
  }
  const merged = [...parse(a), ...parse(b)]
  if (merged.length === 0) return ''
  return JSON.stringify({ type: 'doc', content: merged })
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

// ─── v1.348: section stamp, Important star, Planner → Task Manager link hygiene ───────────────────────────────────

const STAMP_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** The section's bottom-right stamp: always "Nov 17, 2026 | 7:57 pm" — 12-hour clock, lowercase am/pm, no leading zero on the hour, in the user's LOCAL time zone,
 *  independent of the browser/device locale (the locale-driven version showed "17 Nov 2026 | 19:57" on en-GB devices). Pure formatting: never alters the timestamp. */
export function fmtSectionStamp(ts: number): string {
  const d = new Date(ts)
  const h = d.getHours()
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${STAMP_MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} | ${h12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`
}

/** The time a section's bottom-right stamp shows: the user's chosen value if there is one, otherwise the section's ORIGINAL creation time. Returns null when
 *  neither is a usable time (an older section that never recorded one): the stamp is then hidden — a creation time is never invented. */
export function sectionStampTime(b: { createdAt?: number; displayAt?: number }): number | null {
  const ok = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 86_400_000
  if (ok(b.displayAt)) return b.displayAt
  if (ok(b.createdAt)) return b.createdAt
  return null
}

/** The small star beside an Important section's title: a slightly deeper shade of that section's own pastel (neutral for Plain). */
export function getImportantStarColor(colorKey: string | undefined, isDark: boolean): string {
  const light: Record<string, string> = {
    plain: '#71717a', blue: '#3b82f6', green: '#1fa34f', peach: '#ef7a2b', pink: '#de4a8f',
    lavender: '#8b5cf6', yellow: '#cf9f0a', teal: '#2a9d91', rosewood: '#a8678a',
  }
  const dark: Record<string, string> = {
    plain: '#c4c4cf', blue: '#93c5fd', green: '#86efac', peach: '#fdba74', pink: '#f9a8d4',
    lavender: '#a78bfa', yellow: '#fbbf24', teal: '#7fcfc7', rosewood: '#d9b8c9',
  }
  const k = colorKey ?? 'plain'
  return (isDark ? dark : light)[k] ?? (isDark ? dark.plain : light.plain)
}

// A checklist item's `xpId` (its Planner → Task Manager identity) and `xpSentTaskId` (the Task Manager task it was sent as) belong to ONE item.
// Anything that makes a NEW item out of existing content — Enter/split (the editor's keepOnSplit flag), paste, duplicating or copying a section —
// must not carry them over, or the new item would show a "Sent" badge it never earned and share an identity with the original.

type TaskLinkNode = { type?: string; attrs?: Record<string, unknown>; content?: TaskLinkNode[] }

function stripTaskLinkNodes(node: TaskLinkNode | undefined): boolean {
  if (!node || typeof node !== 'object') return false
  let changed = false
  if (node.type === 'taskItem' && node.attrs && (node.attrs.xpId || node.attrs.xpSentTaskId)) {
    node.attrs = { ...node.attrs, xpId: null, xpSentTaskId: null }
    changed = true
  }
  if (Array.isArray(node.content)) for (const c of node.content) if (stripTaskLinkNodes(c)) changed = true
  return changed
}

/** A Tiptap JSON content string with every checklist item's Task Manager link removed. Returns the input untouched when there is nothing to remove. */
export function stripTaskLinks(content: string | undefined): string | undefined {
  if (!content) return content
  try {
    const doc = JSON.parse(content)
    return stripTaskLinkNodes(doc) ? JSON.stringify(doc) : content
  } catch { return content }
}

/** A copy of a section block (main content + both split halves) that carries no Task Manager links — for Duplicate and Copy-to-another-date. */
export function stripBlockTaskLinks(block: JournalBlock, liveContent?: string): JournalBlock {
  const out: JournalBlock = { ...block, content: stripTaskLinks(liveContent ?? block.content) }
  if (block.partitions) {
    const [a, b] = block.partitions
    out.partitions = [
      a.kind === 'image' ? a : { ...a, content: stripTaskLinks(a.content) },
      b.kind === 'image' ? b : { ...b, content: stripTaskLinks(b.content) },
    ] as typeof block.partitions
  }
  return out
}

/** Pasted checklist items are new items: drop the identity / Sent status they were copied with. */
export function clearTaskLinksFromSlice(slice: Slice): Slice {
  function mapFrag(frag: Fragment): { frag: Fragment; changed: boolean } {
    const nodes: PMNode[] = []; let changed = false
    frag.forEach(n => { const r = mapNode(n); nodes.push(r.node); if (r.changed) changed = true })
    return { frag: changed ? Fragment.fromArray(nodes) : frag, changed }
  }
  function mapNode(n: PMNode): { node: PMNode; changed: boolean } {
    let attrs = n.attrs; let changed = false
    if (n.type.name === 'taskItem' && (attrs.xpId || attrs.xpSentTaskId)) { attrs = { ...attrs, xpId: null, xpSentTaskId: null }; changed = true }
    const inner = n.content.childCount > 0 ? mapFrag(n.content) : { frag: n.content, changed: false }
    if (!changed && !inner.changed) return { node: n, changed: false }
    return { node: n.type.create(attrs, inner.frag, n.marks), changed: true }
  }
  const r = mapFrag(slice.content)
  return r.changed ? new Slice(r.frag, slice.openStart, slice.openEnd) : slice
}

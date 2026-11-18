// v1.349 — "Send via Email" for Planner sections and Library notes/documents. PURE logic (no React, no network): turn editor content into readable plain text
// and decide how it can be handed to the user's own email app. Nothing here sends anything, and nothing here changes a document.
//
// Plain text is the only format a mailto: link can carry. Paragraphs, line breaks, bullet / numbered lists and checklist items ("☐ " / "☑ ", the same
// markers Task Manager notes use) keep their structure; editor-internal attributes (ids, Sent links, colours) are never read, so they cannot leak.
import type { JournalBlock, JournalDoc } from './types'

type N = { type?: string; text?: string; attrs?: Record<string, unknown>; content?: N[] }

const RULE = '────────────'

function inline(n: N): string {
  if (n.type === 'text') return n.text ?? ''
  if (n.type === 'hardBreak') return '\n'
  return (n.content ?? []).map(inline).join('')
}

function letter(i: number): string { return String.fromCharCode(97 + (i % 26)) }

/** One block-level node -> lines (already indented). */
function blockLines(n: N, indent: string): string[] {
  switch (n.type) {
    case 'paragraph':
    case 'heading':
      return inline(n).split('\n').map(l => indent + l)
    case 'horizontalRule':
      return [indent + RULE]
    case 'codeBlock':
      return inline(n).split('\n').map(l => indent + l)
    case 'blockquote':
      return (n.content ?? []).flatMap(c => blockLines(c, indent + '> '))
    case 'bulletList':
    case 'orderedList':
    case 'taskList': {
      const out: string[] = []
      const start = typeof n.attrs?.start === 'number' ? (n.attrs.start as number) : 1
      const alpha = n.attrs?.type === 'a'
      ;(n.content ?? []).forEach((item, i) => {
        const marker = n.type === 'taskList' ? (item.attrs?.checked ? '☑ ' : '☐ ')
          : n.type === 'orderedList' ? `${alpha ? letter(start - 1 + i) : start + i}. `
          : '• '
        const kids = item.content ?? []
        let first = true
        for (const k of kids) {
          if (first && (k.type === 'paragraph' || k.type === 'heading')) {
            const ls = inline(k).split('\n')
            out.push(indent + marker + ls[0]); for (const l of ls.slice(1)) out.push(indent + '  ' + l)
            first = false
          } else {
            if (first) { out.push(indent + marker.trimEnd()); first = false }
            out.push(...blockLines(k, indent + '  '))
          }
        }
        if (first) out.push(indent + marker.trimEnd())   // an empty item still shows its marker
      })
      return out
    }
    case 'table':
      return (n.content ?? []).map(row => indent + (row.content ?? []).map(c => inline(c).replace(/\s*\n\s*/g, ' ').trim()).join(' | '))
    default:
      return (n.content ?? []).flatMap(c => blockLines(c, indent))
  }
}

/** Tiptap JSON (as stored in a block / cell) -> plain text. Non-JSON strings are returned as they are; empty input gives ''. */
export function tiptapToPlainText(content: string | undefined | null): string {
  if (!content || !content.trim()) return ''
  let doc: N
  try { doc = JSON.parse(content) } catch { return content.trim() }
  const lines = blockLines(doc, '')
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
  while (lines.length && !lines[0].trim()) lines.shift()
  return lines.join('\n')
}

export interface EmailContent {
  subject: string
  body: string
  /** nothing to send (no text at all) */
  empty: boolean
  /** the source had images / mind maps, which an email text body cannot carry */
  skippedMedia: boolean
}

const SUBJECT_MAX = 100
function subjectFrom(title: string | undefined, body: string, fallback: string): string {
  const t = (title ?? '').trim()
  if (t) return t.slice(0, SUBJECT_MAX)
  const first = body.split('\n').map(l => l.replace(/^[•☐☑>\s]+/, '').trim()).find(Boolean)
  return (first ?? fallback).slice(0, SUBJECT_MAX)
}

/** A Planner section: subject = its title, body = its content (both halves of a split section). */
export function sectionToEmail(block: JournalBlock, liveContent?: string): EmailContent {
  const parts: string[] = []
  let skippedMedia = false
  if (block.partitions) {
    for (const cell of block.partitions) {
      if (cell.kind === 'image') skippedMedia = true
      else { const t = tiptapToPlainText(cell.content); if (t) parts.push(t) }
    }
  } else if (block.sectionImage) {
    skippedMedia = true
  } else {
    const t = tiptapToPlainText(liveContent ?? block.content); if (t) parts.push(t)
  }
  const body = parts.join('\n\n')
  return { subject: subjectFrom(block.name, body, 'XPadite section'), body, empty: body.trim() === '', skippedMedia }
}

/** A whole Library document / note: subject = its title, body = every section in order (a section's own title becomes a heading line). */
export function docToEmail(raw: string | undefined | null, title: string): EmailContent {
  let doc: Partial<JournalDoc> | null = null
  try { doc = raw ? JSON.parse(raw) : null } catch { doc = null }
  const blocks: JournalBlock[] = Array.isArray(doc?.blocks) ? (doc!.blocks as JournalBlock[]) : []
  const parts: string[] = []
  let skippedMedia = false
  for (const b of blocks) {
    if (b.type === 'image' || b.type === 'drawing') { skippedMedia = true; continue }
    const e = sectionToEmail(b)
    if (e.skippedMedia) skippedMedia = true
    const head = b.type === 'section' && b.name?.trim() ? b.name.trim() : ''
    const text = [head, e.body].filter(Boolean).join('\n')
    if (text) parts.push(text)
  }
  // a legacy / plain-text document (not a block document at all): use its text as it is
  const body = blocks.length === 0 && raw ? (tiptapToPlainText(raw) || '') : parts.join('\n\n')
  return { subject: subjectFrom(title, body, 'XPadite note'), body, empty: body.trim() === '', skippedMedia }
}

/** mailto: URLs this long still open in every mainstream desktop and mobile mail client; longer ones are routinely cut off or refused. */
export const MAILTO_MAX = 1800

export interface EmailPlan {
  mailto: string
  /** the content does not fit a mailto: link: the full text must go through the clipboard instead (never truncated) */
  tooLong: boolean
  clipboardText: string
}

const crlf = (s: string) => s.replace(/\r?\n/g, '\r\n')

export function planEmail(e: Pick<EmailContent, 'subject' | 'body'>): EmailPlan {
  const full = `mailto:?subject=${encodeURIComponent(e.subject)}&body=${encodeURIComponent(crlf(e.body))}`
  if (full.length <= MAILTO_MAX) return { mailto: full, tooLong: false, clipboardText: e.body }
  const note = 'The full text was copied to your clipboard. Paste it here.'
  return {
    mailto: `mailto:?subject=${encodeURIComponent(e.subject.slice(0, 200))}&body=${encodeURIComponent(note)}`,
    tooLong: true,
    clipboardText: e.body,
  }
}

/** v1.350 — several Planner sections as ONE email: their text only (no titles, headings, timestamps or dividers), in the order given (the caller passes
 *  the Planner's own order), a blank line between sections. Empty sections add nothing. Subject = the Planner's title, else a fixed default. */
export function combineSectionsEmail(blocks: JournalBlock[], liveContent: (b: JournalBlock) => string | undefined, plannerTitle: string): EmailContent {
  const parts: string[] = []
  let skippedMedia = false
  for (const b of blocks) {
    const e = sectionToEmail(b, liveContent(b))
    if (e.skippedMedia) skippedMedia = true
    if (e.body) parts.push(e.body)
  }
  const body = parts.join('\n\n')
  const t = (plannerTitle ?? '').trim()
  return { subject: (t || 'XPadite Planner Notes').slice(0, SUBJECT_MAX), body, empty: body.trim() === '', skippedMedia }
}

// v1.351 — Merge Sections: PURE logic. A merge is a data-integrity-sensitive edit, so it is planned and VERIFIED here before the editor changes anything:
//  • only content the Planner editor can hold is merged (an unknown node type, a split section or an image/mind-map section stops the merge with a reason);
//  • the sources' content nodes are appended to the destination's, in Planner order, with one blank paragraph between parts;
//  • a checklist item whose task identity (xpId) or Sent link (xpSentTaskId) already exists in the merged text loses BOTH on the copy — so a merge can never
//    create two items claiming the same Task Manager task;
//  • before anything is removed, the merged text must contain every character, checklist item, divider and list of every part ("verified").
import type { JournalBlock } from './types'

type N = { type?: string; text?: string; attrs?: Record<string, unknown>; content?: N[]; marks?: unknown[] }

/** Every node type the Planner editor can hold inside a section (see the extensions in JournalEditorContent / journalDivider). */
export const SUPPORTED_NODES = new Set([
  'doc', 'paragraph', 'text', 'hardBreak', 'heading', 'bulletList', 'orderedList', 'listItem', 'taskList', 'taskItem', 'horizontalRule',
  'table', 'tableRow', 'tableHeader', 'tableCell',
])

function parseDoc(content: string | undefined): N[] | null {
  const s = (content ?? '').trim()
  if (!s) return []
  try {
    const d = JSON.parse(s) as N
    return d && d.type === 'doc' && Array.isArray(d.content) ? d.content : null
  } catch { return null }
}

function walk(nodes: N[] | undefined, fn: (n: N) => void) {
  for (const n of nodes ?? []) { fn(n); if (n.content) walk(n.content, fn) }
}

export interface ContentStats { chars: number; tasks: number; dividers: number; lists: number; tables: number; hardBreaks: number; unknown: string[] }

export function contentStats(content: string | undefined): ContentStats | null {
  const nodes = parseDoc(content)
  if (nodes === null) return null
  const st: ContentStats = { chars: 0, tasks: 0, dividers: 0, lists: 0, tables: 0, hardBreaks: 0, unknown: [] }
  walk(nodes, n => {
    if (n.type === 'text') st.chars += (n.text ?? '').length
    else if (n.type === 'taskItem') st.tasks++
    else if (n.type === 'horizontalRule') st.dividers++
    else if (n.type === 'bulletList' || n.type === 'orderedList' || n.type === 'taskList') st.lists++
    else if (n.type === 'table') st.tables++
    else if (n.type === 'hardBreak') st.hardBreaks++
    if (n.type && !SUPPORTED_NODES.has(n.type) && !st.unknown.includes(n.type)) st.unknown.push(n.type)
  })
  return st
}

export interface MergeProblem { id: string; reason: string }

/** Why a section can not be merged safely (empty list = it can). */
export function mergeProblems(blocks: JournalBlock[], liveContent: (b: JournalBlock) => string | undefined): MergeProblem[] {
  const out: MergeProblem[] = []
  for (const b of blocks) {
    const label = (b.name ?? '').trim() || (b.type === 'section' ? 'an untitled section' : 'the unsectioned text')
    if (b.partitions || b.sectionImage) { out.push({ id: b.id, reason: `"${label}" is split or holds an image / mind map, which can't be combined into text.` }); continue }
    const st = contentStats(liveContent(b))
    if (st === null) { out.push({ id: b.id, reason: `"${label}" has content that could not be read.` }); continue }
    if (st.unknown.length) out.push({ id: b.id, reason: `"${label}" contains content this merge can't carry safely (${st.unknown.join(', ')}).` })
  }
  return out
}

export type MergeResult = { ok: true; content: string; spacers: number; relinked: number } | { ok: false; reason: string }

/** destination content + the other sections' content, in the order given. Verified: nothing is lost, or ok:false. */
export function mergeContents(destContent: string | undefined, sourceContents: (string | undefined)[]): MergeResult {
  const parts = [destContent, ...sourceContents]
  const parsed = parts.map(parseDoc)
  if (parsed.some(p => p === null)) return { ok: false, reason: 'A section has content that could not be read.' }
  const stats = parts.map(contentStats)
  if (stats.some(s => s === null || s.unknown.length > 0)) return { ok: false, reason: 'A section contains content that can not be merged safely.' }

  const merged: N[] = []
  const seenIds = new Set<string>(), seenSent = new Set<string>()
  let spacers = 0, relinked = 0
  const note = (n: N) => { const a = n.attrs; if (n.type === 'taskItem' && a) { if (typeof a.xpId === 'string' && a.xpId) seenIds.add(a.xpId); if (typeof a.xpSentTaskId === 'string' && a.xpSentTaskId) seenSent.add(a.xpSentTaskId) } }
  parsed.forEach((nodes, i) => {
    const copy: N[] = JSON.parse(JSON.stringify(nodes))
    if (i > 0) {
      // a checklist item that would duplicate an identity / Sent link already in the merged text becomes a plain new item
      walk(copy, n => {
        if (n.type !== 'taskItem' || !n.attrs) return
        const id = typeof n.attrs.xpId === 'string' ? n.attrs.xpId : '', sent = typeof n.attrs.xpSentTaskId === 'string' ? n.attrs.xpSentTaskId : ''
        if ((id && seenIds.has(id)) || (sent && seenSent.has(sent))) { n.attrs = { ...n.attrs, xpId: null, xpSentTaskId: null }; relinked++ }
      })
    }
    walk(copy, note)
    if (copy.length === 0) return
    if (merged.length > 0) {
      const last = merged[merged.length - 1]
      const lastIsBlank = last.type === 'paragraph' && !(last.content && last.content.length)
      if (!lastIsBlank) { merged.push({ type: 'paragraph' }); spacers++ }
    }
    merged.push(...copy)
  })
  const content = merged.length ? JSON.stringify({ type: 'doc', content: merged }) : ''

  // verification: the merged text carries everything every part had
  const sum = stats.reduce((a, s) => ({ chars: a.chars + s!.chars, tasks: a.tasks + s!.tasks, dividers: a.dividers + s!.dividers, lists: a.lists + s!.lists, tables: a.tables + s!.tables, hardBreaks: a.hardBreaks + s!.hardBreaks }), { chars: 0, tasks: 0, dividers: 0, lists: 0, tables: 0, hardBreaks: 0 })
  const got = contentStats(content) ?? { chars: 0, tasks: 0, dividers: 0, lists: 0, tables: 0, hardBreaks: 0 }
  for (const k of ['chars', 'tasks', 'dividers', 'lists', 'tables', 'hardBreaks'] as const) {
    if (got[k] !== sum[k]) return { ok: false, reason: `The merged text did not contain everything (${k}: ${got[k]} of ${sum[k]}). Nothing was changed.` }
  }
  return { ok: true, content, spacers, relinked }
}

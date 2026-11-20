/**
 * v1.355 — Indent / Outdent that works on ordinary text, not only on list items.
 *
 * Why: the toolbar's Indent only ran `sinkListItem`, which needs a list item with a previous sibling — so a plain paragraph (or the first
 * item of a checklist) could never be indented. Indent now has two layers, applied together to whatever the selection covers:
 *
 *  1. List items keep their existing behaviour (nest under the previous item; Outdent lifts a nested item back, clearing the Sub-item flag when
 *     it becomes top-level). A top-level list item is NEVER lifted out of its list by Outdent (that would turn a checkbox into plain text).
 *     If the selected items cannot nest (e.g. the first item of a list), nothing moves — unless the selection covers the WHOLE list, in which case
 *     the whole list is indented / outdented as one block (select the list, press Indent). A partial selection never moves the other items.
 *  2. Top-level paragraphs / headings get an `xpIndent` level (1–8, 24px each) — an ordinary attribute in the existing document JSON, so it
 *     rides every save, undo, merge and Journal Notes path. Unset = 0 = renders exactly as before. It never turns text into a list item.
 *
 * Content hidden under a collapsed divider is never touched.
 */
import { Extension } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import { sinkListItem, liftListItem } from '@tiptap/pm/schema-list'
import type { EditorState } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { dividerCollapseKey, hiddenRanges } from './journalDivider'

export const MAX_INDENT = 8
const STEP_PX = 24
const TEXT = ['paragraph', 'heading']
const LISTS = ['bulletList', 'orderedList', 'taskList']
const ITEMS = ['taskItem', 'listItem']

export const XpIndentExt = Extension.create({
  name: 'xpIndent',
  addGlobalAttributes() {
    return [{
      types: [...TEXT, ...LISTS],
      attributes: {
        xpIndent: {
          default: null,
          keepOnSplit: true,
          parseHTML: el => {
            const v = Number((el as HTMLElement).getAttribute('data-xp-indent'))
            return Number.isInteger(v) && v > 0 ? Math.min(v, MAX_INDENT) : null
          },
          renderHTML: attrs => (typeof attrs.xpIndent === 'number' && attrs.xpIndent > 0 ? { 'data-xp-indent': String(Math.min(attrs.xpIndent, MAX_INDENT)) } : {}),
        },
      },
    }]
  },
})

export function indentCss(scope: string): string {
  let out = ''
  for (let n = 1; n <= MAX_INDENT; n++) out += `\n        ${scope} [data-xp-indent="${n}"][data-xp-indent][data-xp-indent] { margin-left: ${n * STEP_PX}px; }`   // tripled attribute selector: outranks the list rules' own margins
  return out + '\n'
}

const levelOf = (node: { attrs: Record<string, unknown> }): number => {
  const v = node.attrs.xpIndent
  return typeof v === 'number' && v > 0 ? Math.min(v, MAX_INDENT) : 0
}

function hiddenAt(state: EditorState): Array<{ from: number; to: number }> {
  const collapsed = dividerCollapseKey.getState(state)?.collapsed ?? []
  return collapsed.length ? hiddenRanges(state.doc, collapsed) : []
}

/** How many list items enclose the item at `pos` (0 = a top-level item). */
function parentItems(state: EditorState, pos: number): number {
  const $p = state.doc.resolve(pos)
  let n = 0
  for (let d = 1; d <= $p.depth; d++) if (ITEMS.includes($p.node(d).type.name)) n++
  return n
}

/** True when the selection touches every direct item of the list at `pos` (a caret in a one-item list counts). Selecting just some items never moves the rest. */
function coversAllItems(state: EditorState, pos: number, list: { forEach: (f: (child: { nodeSize: number }, offset: number) => void) => void }): boolean {
  const { from, to } = state.selection
  let all = true
  list.forEach((child, offset) => {
    const start = pos + 1 + offset, end = start + child.nodeSize
    if (!(start < Math.max(to, from + 1) && end > from)) all = false   // the item intersects the selection (a caret counts as one position)
  })
  return all
}

function listPass(view: EditorView, dir: 1 | -1): boolean {
  const state = view.state
  const hidden = hiddenAt(state)
  const types = new Set<string>()
  const tops: Array<{ pos: number; level: number }> = []
  let nested = false
  state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
    if (hidden.some(h => pos >= h.from && pos < h.to)) return false
    if (ITEMS.includes(node.type.name)) { types.add(node.type.name); if (parentItems(state, pos) > 0) nested = true }
    if (LISTS.includes(node.type.name) && state.doc.resolve(pos).depth === 0 && coversAllItems(state, pos, node)) tops.push({ pos, level: levelOf(node) })   // only a list the selection covers COMPLETELY moves as a whole
    return true
  })
  if (types.size === 0) return false

  if (dir > 0) {
    for (const t of ITEMS) {
      if (!types.has(t)) continue
      const cmd = sinkListItem(state.schema.nodes[t])
      if (cmd(state)) { cmd(state, view.dispatch); return true }
    }
    // nothing can nest (e.g. the first item of a list): indent the whole top-level list — only if the selection covers all of it
    const tr = state.tr; let did = false
    for (const l of tops) { if (l.level < MAX_INDENT) { tr.setNodeMarkup(l.pos, undefined, { ...state.doc.nodeAt(l.pos)!.attrs, xpIndent: l.level + 1 }); did = true } }
    if (did) view.dispatch(tr)
    return did
  }

  if (nested) {
    for (const t of ITEMS) {
      if (!types.has(t)) continue
      const cmd = liftListItem(state.schema.nodes[t])
      if (cmd(state)) {
        cmd(state, view.dispatch)
        // an item that is back at the top level is no longer a Sub-item
        const s2 = view.state, tr = s2.tr; let did = false
        s2.doc.nodesBetween(s2.selection.from, s2.selection.to, (node, pos) => {
          if (ITEMS.includes(node.type.name) && node.attrs.subItem && parentItems(s2, pos) === 0) { tr.setNodeMarkup(pos, undefined, { ...node.attrs, subItem: false }); did = true }
          return true
        })
        if (did) view.dispatch(tr)
        return true
      }
    }
    return false
  }
  // top-level items only: Outdent reduces the list's own indent, and never lifts an item out of its list
  const tr = state.tr; let did = false
  for (const l of tops) { if (l.level > 0) { tr.setNodeMarkup(l.pos, undefined, { ...state.doc.nodeAt(l.pos)!.attrs, xpIndent: l.level - 1 || null }); did = true } }
  if (did) view.dispatch(tr)
  return did
}

/** Indent (+1) or Outdent (-1) whatever the selection covers. Returns true if anything changed. */
export function applyXpIndent(editor: Editor, dir: 1 | -1): boolean {
  if (editor.isDestroyed) return false
  const view = editor.view
  let changed = listPass(view, dir)
  const state = view.state
  const hidden = hiddenAt(state)
  const tr = state.tr
  state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
    if (hidden.some(h => pos >= h.from && pos < h.to)) return false
    if (state.doc.resolve(pos).depth === 0 && TEXT.includes(node.type.name)) {
      const cur = levelOf(node), next = Math.max(0, Math.min(MAX_INDENT, cur + dir))
      if (next !== cur) { tr.setNodeMarkup(pos, undefined, { ...node.attrs, xpIndent: next || null }); changed = true }
      return false
    }
    return true
  })
  if (tr.docChanged) view.dispatch(tr)
  return changed
}

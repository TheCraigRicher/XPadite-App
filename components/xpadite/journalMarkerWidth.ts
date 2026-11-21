/**
 * v1.358 — marker width for sub-item spacing (RENDER ONLY).
 *
 * A numbered list's marker width depends on its widest label: "9." is narrow, "10." / "105." are wider, and a list can START at any number
 * (typing "10. " at the start of a line creates a list that starts at 10, and pasted lists carry their own start). CSS cannot read that number,
 * so this plugin puts a `data-xp-mw` attribute (digits / characters of the widest marker) on every numbered list as a node DECORATION, and the
 * sub-item stylesheet widens its marker gap from it.
 *
 *  • Decoration only: nothing is written to the document, the saved JSON, the HTML export, undo history or autosave. It never changes editing.
 *  • Recomputed only when the document changes (and once at start-up), so it is cheap and always matches the current list — including after
 *    adding / removing items, changing the start, or switching the list between numbers and letters.
 *  • The attribute is only set when the marker is wider than the single-character case (the default gap already covers 1–9 and a–z), so ordinary
 *    lists carry no attribute at all.
 */
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

/** Characters in the widest label of a list: numbers → digits of the last number; letters (lower-alpha) → 1 up to z, 2 up to zz, … */
export function markerChars(start: number, count: number, letters: boolean): number {
  const s = Number.isFinite(start) && start >= 1 ? Math.floor(start) : 1
  const last = s + Math.max(count, 1) - 1
  if (!letters) return String(last).length
  let n = 1, cap = 26
  while (last > cap && n < 6) { n++; cap = cap * 26 + 26 }   // a–z = 26, aa–zz = 26 + 676, …
  return n
}

function build(doc: PMNode): DecorationSet {
  const out: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.type.name !== 'orderedList') return
    const chars = markerChars(Number(node.attrs.start ?? 1), node.childCount, node.attrs.type === 'a')
    if (chars >= 2) out.push(Decoration.node(pos, pos + node.nodeSize, { 'data-xp-mw': String(Math.min(chars, 6)) }))
  })
  return DecorationSet.create(doc, out)
}

const key = new PluginKey('xpMarkerWidth')

export const XpMarkerWidthExt = Extension.create({
  name: 'xpMarkerWidth',
  addProseMirrorPlugins() {
    return [new Plugin({
      key,
      state: {
        init: (_cfg, state) => build(state.doc),
        apply: (tr, old) => (tr.docChanged ? build(tr.doc) : old),
      },
      props: { decorations: state => key.getState(state) },
    })]
  },
})

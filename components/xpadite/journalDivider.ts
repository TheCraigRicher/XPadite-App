// v1.347 — the Planner "Divider": a real block node inside the section's editor document (not decorative text).
//
// It is stored as the standard Tiptap node name `horizontalRule` ({ "type": "horizontalRule" }), so it round-trips through the existing saved JSON,
// is already understood by journalExport.ts, and is simply a block that the text-walking helpers (plain-text previews, search) skip. Both editors
// that can load a section's content (the Planner and the Task Manager's Journal Notes) register this same node, so a divider is never dropped
// when the other editor loads and re-saves the section.
//
// Unlike Tiptap's stock HorizontalRule it has NO markdown input rule: typing "---" stays plain text exactly as before.
//
// v1.351 — COLLAPSIBLE dividers.
//  • One optional attribute, `collapsible` (default false → every divider saved before v1.351 stays purely decorative and loads unchanged). It is the only thing
//    written to the document; turning it on/off is a normal edit.
//  • Collapsed / expanded is VIEW STATE, kept in a ProseMirror plugin (positions mapped through every transaction). It is never written to the document, so
//    toggling can not change content or trigger an autosave, and a reload always opens expanded.
//  • A collapsed divider hides — with node DECORATIONS, never by removing or rewriting anything — the sibling nodes after it up to the next divider (or the end
//    of its parent). The hidden nodes stay in the document, in the saved JSON, and in Task Manager Journal Notes.
//  • Protection: the selection is never left inside hidden content (it moves to the divider), and a transaction that would change hidden content is refused.

import { Node, mergeAttributes } from '@tiptap/core'
import { NodeSelection, Plugin, PluginKey, Selection, TextSelection } from '@tiptap/pm/state'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    xpDivider: {
      /** Inserts a divider at the cursor and leaves the caret in an (existing or new) paragraph below it. */
      insertXpDivider: () => ReturnType
      /** With a divider selected: switch its collapsing on / off (decorative-only). */
      toggleXpDividerCollapsible: () => ReturnType
    }
  }
}

const NAME = 'horizontalRule'
export const dividerCollapseKey = new PluginKey<{ collapsed: number[] }>('xpDividerCollapse')
const ATTR_META = 'xpDividerToggleAttr'

/** doc.nodeAt that never throws: a stale position (the document was replaced) simply finds nothing. */
function nodeAtSafe(doc: PMNode, pos: number): PMNode | null {
  if (!Number.isInteger(pos) || pos < 0 || pos > doc.content.size) return null
  try { return doc.nodeAt(pos) } catch { return null }
}

/** The nodes a collapsed divider at `pos` hides: [from, to) covering the siblings after it, up to the next divider or the end of the parent. */
export function hiddenRegion(doc: PMNode, pos: number): { from: number; to: number; nodes: Array<{ from: number; to: number }> } | null {
  const node = nodeAtSafe(doc, pos)
  if (!node || node.type.name !== NAME) return null
  const $p = doc.resolve(pos)
  const parent = $p.parent
  const out: Array<{ from: number; to: number }> = []
  let at = pos + node.nodeSize
  const from = at
  for (let i = $p.index() + 1; i < parent.childCount; i++) {
    const child = parent.child(i)
    if (child.type.name === NAME) break
    out.push({ from: at, to: at + child.nodeSize })
    at += child.nodeSize
  }
  return out.length ? { from, to: at, nodes: out } : { from, to: from, nodes: [] }
}

/** Dividers (by position) that are collapsed AND still collapsible, with the content they hide. */
export function hiddenRanges(doc: PMNode, collapsed: number[]): Array<{ divider: number; from: number; to: number }> {
  const out: Array<{ divider: number; from: number; to: number }> = []
  for (const p of collapsed) {
    const n = nodeAtSafe(doc, p)
    if (!n || n.type.name !== NAME || !n.attrs.collapsible) continue
    const r = hiddenRegion(doc, p)
    if (r && r.to > r.from) out.push({ divider: p, from: r.from, to: r.to })
  }
  return out
}

function stateOf(state: EditorState) { return dividerCollapseKey.getState(state)?.collapsed ?? [] }

function dividerPlugin(): Plugin {
  const toggleAt = (view: { state: EditorState; dispatch: (tr: Transaction) => void }, pos: number) => {
    view.dispatch(view.state.tr.setMeta(dividerCollapseKey, { toggle: pos }))
  }
  return new Plugin({
    key: dividerCollapseKey,
    state: {
      init: () => ({ collapsed: [] as number[] }),
      apply(tr, prev) {
        let c = prev.collapsed
        if (tr.docChanged) {
          c = c.flatMap(p => { const r = tr.mapping.mapResult(p, -1); return r.deleted ? [] : [r.pos] })
        }
        const meta = tr.getMeta(dividerCollapseKey) as { toggle?: number } | undefined
        if (meta && typeof meta.toggle === 'number') c = c.includes(meta.toggle) ? c.filter(x => x !== meta.toggle) : [...c, meta.toggle]
        // keep only dividers that still exist and are still collapsible (switching collapsing off, or deleting the divider, expands it)
        c = c.filter(p => { const n = nodeAtSafe(tr.doc, p); return !!n && n.type.name === NAME && !!n.attrs.collapsible })
        return c === prev.collapsed ? prev : { collapsed: c }
      },
    },
    props: {
      decorations(state) {
        const collapsed = stateOf(state)
        if (!collapsed.length) return null
        const decos: Decoration[] = []
        for (const p of collapsed) {
          const n = nodeAtSafe(state.doc, p)
          const r = hiddenRegion(state.doc, p)
          if (!n || !r) continue
          decos.push(Decoration.node(p, p + n.nodeSize, { class: 'xp-div-collapsed' }))
          for (const h of r.nodes) decos.push(Decoration.node(h.from, h.to, { class: 'xp-div-hidden', 'aria-hidden': 'true' }))
        }
        return DecorationSet.create(state.doc, decos)
      },
      // the chevron: a click on the right end of a collapsible divider toggles it (mouse and touch tap)
      handleClickOn(view, _pos, node, nodePos, event) {
        if (node.type.name !== NAME || !node.attrs.collapsible) return false
        const el = event.target as HTMLElement | null
        if (!el || el.tagName !== 'HR') return false
        const r = el.getBoundingClientRect()
        if ((event as MouseEvent).clientX < r.right - 44) return false
        toggleAt(view, nodePos)
        return true
      },
      handleTextInput(view) {
        const sel = view.state.selection
        return sel instanceof NodeSelection && sel.node.type.name === NAME && stateOf(view.state).includes(sel.from)   // IME / composed input
      },
      handleKeyDown(view, event) {
        const sel = view.state.selection
        if (!(sel instanceof NodeSelection) || sel.node.type.name !== NAME || !sel.node.attrs.collapsible) return false
        const collapsedHere = stateOf(view.state).includes(sel.from)
        if (event.key === 'Enter') { event.preventDefault(); toggleAt(view, sel.from); return true }   // Enter only: Space is typing and must never toggle
        // the selection is parked on a collapsed divider when it would otherwise be inside hidden text: typing must not replace the divider
        if (collapsedHere && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); return true }
        if (collapsedHere && (event.key === 'ArrowDown' || event.key === 'ArrowRight')) {
          // step past the hidden content to what follows it
          const r = hiddenRegion(view.state.doc, sel.from)
          if (r && r.to < view.state.doc.content.size) {
            event.preventDefault()
            view.dispatch(view.state.tr.setSelection(Selection.near(view.state.doc.resolve(r.to), 1)).scrollIntoView())
            return true
          }
        }
        return false
      },
    },
    // never edit what the user can not see
    filterTransaction(tr, state) {
      if (!tr.docChanged || tr.getMeta(ATTR_META)) return true
      // Tiptap's setContent (Undo / Redo, a resync, a reload of the section) replaces the whole document and always carries the `preventUpdate` meta: that is not an edit
      // of hidden text, it simply re-expands everything. A user's Select-all + Delete is ALSO a whole-document replace but has no such meta, so it is refused.
      if (tr.getMeta('preventUpdate') !== undefined) return true
      const ranges = hiddenRanges(state.doc, stateOf(state))
      if (!ranges.length) return true
      for (let i = 0; i < tr.steps.length; i++) {
        const before = tr.mapping.slice(0, i)
        const mapped = ranges.map(r => ({ from: before.map(r.from, 1), to: before.map(r.to, -1) }))
        let hit = false
        tr.steps[i].getMap().forEach((oldStart, oldEnd) => {
          for (const m of mapped) if (m.to > m.from && oldStart < m.to && oldEnd > m.from) hit = true
        })
        if (hit) return false
      }
      return true
    },
    // …and never leave the caret / selection inside it: it moves to the divider that hides it
    appendTransaction(_trs, _old, state) {
      const ranges = hiddenRanges(state.doc, stateOf(state))
      if (!ranges.length) return null
      const { from, to } = state.selection
      for (const r of ranges) {
        if (from < r.to && to > r.from - 0 && from >= r.from) {
          return state.tr.setSelection(NodeSelection.create(state.doc, r.divider))
        }
      }
      return null
    },
  })
}

export const XpDivider = Node.create({
  name: NAME,
  group: 'block',
  selectable: true,

  addAttributes() {
    return {
      collapsible: {
        default: false,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-collapsible') === 'true',
        renderHTML: (attrs: { collapsible?: boolean }) => attrs.collapsible ? { 'data-collapsible': 'true' } : {},
      },
    }
  },

  parseHTML() { return [{ tag: 'hr' }] },
  renderHTML({ HTMLAttributes }) { return ['hr', mergeAttributes({ class: 'xp-divider' }, HTMLAttributes)] },

  addProseMirrorPlugins() { return [dividerPlugin()] },

  addCommands() {
    return {
      insertXpDivider: () => ({ chain }) => chain()
        .insertContent({ type: this.name, attrs: { collapsible: true } })   // v1.351: a divider inserted from the toolbar can collapse; older ones stay decorative
        .command(({ tr, dispatch }) => {
          if (dispatch) {
            const { $to } = tr.selection
            const after = $to.nodeAfter
            if (after) {
              if (after.isTextblock) tr.setSelection(TextSelection.create(tr.doc, $to.pos + 1))
              else if (after.isBlock) tr.setSelection(NodeSelection.create(tr.doc, $to.pos))
              else tr.setSelection(TextSelection.create(tr.doc, $to.pos))
            } else {
              // the divider ended the document: add the paragraph the user keeps typing in
              const para = $to.parent.type.contentMatch.defaultType?.create()
              if (para) {
                const at = $to.end()
                tr.insert(at, para)
                tr.setSelection(TextSelection.create(tr.doc, at + 1))
              }
            }
            tr.scrollIntoView()
          }
          return true
        })
        .run(),
      toggleXpDividerCollapsible: () => ({ state, dispatch }) => {
        const sel = state.selection
        if (!(sel instanceof NodeSelection) || sel.node.type.name !== NAME) return false
        if (dispatch) dispatch(state.tr.setNodeMarkup(sel.from, undefined, { ...sel.node.attrs, collapsible: !sel.node.attrs.collapsible }).setMeta(ATTR_META, true).setSelection(NodeSelection.create(state.tr.doc, sel.from)))
        return true
      },
    }
  },
})

const CHEVRON = (points: string) => `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%237c3aed' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='${points}'/%3E%3C/svg%3E")`

/** Option A — "Minimal Ornamental Dots": hairline on each side of five dots, the middle one larger. One <hr>, drawn with layered gradients.
 *  v1.351: a collapsible divider adds ONE small chevron at the far right (down = expanded, right = collapsed) and nothing else. */
export function dividerCss(scope: string): string {
  const line = 'rgba(124,58,237,0.38)'
  const dot = 'rgba(124,58,237,0.62)'
  const mid = 'rgba(124,58,237,0.88)'
  const layers = (chevron: string | null) => `
            linear-gradient(${line}, ${line}),
            linear-gradient(${line}, ${line}),
            radial-gradient(circle at 50% 50%, ${mid} 0 5.5px, transparent 6px),
            radial-gradient(circle at calc(50% - 17px) 50%, ${dot} 0 3.2px, transparent 3.6px),
            radial-gradient(circle at calc(50% + 17px) 50%, ${dot} 0 3.2px, transparent 3.6px),
            radial-gradient(circle at calc(50% - 34px) 50%, ${dot} 0 2.7px, transparent 3.1px),
            radial-gradient(circle at calc(50% + 34px) 50%, ${dot} 0 2.7px, transparent 3.1px)${chevron ? `,\n            ${chevron}` : ''}`
  return `
        ${scope} hr.xp-divider {
          border: 0; height: 16px; margin: 10px 0; padding: 0; cursor: default; background-color: transparent;
          background-repeat: no-repeat;
          background-image:${layers(null)};
          background-size:
            calc(50% - 56px) 1px, calc(50% - 56px) 1px, 100% 100%, 100% 100%, 100% 100%, 100% 100%, 100% 100%;
          background-position:
            left center, right center, 0 0, 0 0, 0 0, 0 0, 0 0;
        }
        ${scope} hr.xp-divider[data-collapsible="true"] {
          cursor: pointer;
          background-image:${layers(CHEVRON('6 9 12 15 18 9'))};
          background-size:
            calc(50% - 56px) 1px, calc(50% - 82px) 1px, 100% 100%, 100% 100%, 100% 100%, 100% 100%, 100% 100%, 14px 14px;
          background-position:
            left center, right 26px center, 0 0, 0 0, 0 0, 0 0, 0 0, right 6px center;
        }
        ${scope} hr.xp-divider[data-collapsible="true"].xp-div-collapsed {
          background-image:${layers(CHEVRON('9 6 15 12 9 18'))};
        }
        /* v1.352 — phones only: balance the collapsible divider. The chevron keeps its own 26px gutter on the right, so the left line starts 26px in
           and is the same length as the right one: dots centred, equal gaps to the dots. Desktop and tablet are unchanged. */
        @media (max-width: 767px) {
          ${scope} hr.xp-divider[data-collapsible="true"] {
            background-size:
              calc(50% - 82px) 1px, calc(50% - 82px) 1px, 100% 100%, 100% 100%, 100% 100%, 100% 100%, 100% 100%, 14px 14px;
            background-position:
              left 26px center, right 26px center, 0 0, 0 0, 0 0, 0 0, 0 0, right 6px center;
          }
        }
        ${scope} .xp-div-hidden { display: none !important; }
        ${scope} hr.xp-divider.ProseMirror-selectednode { outline: 2px solid rgba(124,58,237,0.35); outline-offset: 2px; border-radius: 4px; }
  `
}

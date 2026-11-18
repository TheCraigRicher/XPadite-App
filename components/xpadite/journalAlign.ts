/**
 * v1.352 — paragraph text alignment for the Planner editor (and, attribute-only, for the Journal Notes editor).
 *
 * Stored as an ordinary `textAlign` attribute on paragraph / heading nodes inside the existing Tiptap document JSON
 * (`{ "type": "paragraph", "attrs": { "textAlign": "justify" } }`), so it rides every existing save, undo, merge and sync path.
 * Unset (null) means "never chosen": it renders exactly as before (left), so saved documents are never reflowed.
 *
 * Default for NEW writing: when the user types the first character into an EMPTY, unset, top-level paragraph, that paragraph is
 * stamped `justify`. A paragraph that already holds text is never touched by this rule, and neither are list / checklist / table
 * paragraphs, loaded content (setContent), pastes into existing text, or undo / redo.
 */
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorState } from '@tiptap/pm/state'
import { dividerCollapseKey, hiddenRanges } from './journalDivider'

export type XpAlign = 'left' | 'center' | 'right' | 'justify'
export const XP_ALIGNS: XpAlign[] = ['left', 'center', 'right', 'justify']
const TARGETS = ['paragraph', 'heading']

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    xpAlign: { setXpAlign: (value: XpAlign) => ReturnType }
  }
}

/** The alignment shown for the caret / selection start (what the toolbar reflects). */
export function currentXpAlign(state: EditorState, defaultJustify = true): XpAlign {
  const { $from } = state.selection
  if ($from.depth !== 1) return 'left'                                   // only top-level text is alignable (not list / checklist / table content)
  const node = $from.parent
  if (!TARGETS.includes(node.type.name)) return 'left'
  const v = node.attrs.textAlign as XpAlign | null
  if (v && XP_ALIGNS.includes(v)) return v
  return defaultJustify && node.type.name === 'paragraph' && node.content.size === 0 ? 'justify' : 'left'
}

export const XpAlignExt = Extension.create<{ defaultJustify: boolean }>({
  name: 'xpAlign',
  addOptions() { return { defaultJustify: true } },

  addGlobalAttributes() {
    return [{
      types: TARGETS,
      attributes: {
        textAlign: {
          default: null,
          keepOnSplit: true,
          parseHTML: el => {
            const v = (el as HTMLElement).style?.textAlign
            return v && (XP_ALIGNS as string[]).includes(v) ? v : null
          },
          renderHTML: attrs => (attrs.textAlign ? { style: `text-align: ${attrs.textAlign}` } : {}),
        },
      },
    }]
  },

  addCommands() {
    return {
      setXpAlign: (value: XpAlign) => ({ state, dispatch }) => {
        if (!XP_ALIGNS.includes(value)) return false
        const { from, to } = state.selection
        const collapsed = dividerCollapseKey.getState(state)?.collapsed ?? []
        const hidden = collapsed.length ? hiddenRanges(state.doc, collapsed) : []
        const tr = state.tr
        let changed = false
        state.doc.nodesBetween(from, to, (node, pos) => {
          if (!TARGETS.includes(node.type.name) || state.doc.resolve(pos).depth !== 0) return false   // top-level text only: list / checklist / table content is left alone
          if (hidden.some(h => pos >= h.from && pos < h.to)) return false   // never edit content hidden under a collapsed divider
          if (node.attrs.textAlign !== value) { tr.setNodeMarkup(pos, undefined, { ...node.attrs, textAlign: value }); changed = true }
          return false
        })
        if (changed && dispatch) dispatch(tr)
        return true
      },
    }
  },

  addProseMirrorPlugins() {
    if (!this.options.defaultJustify) return []
    return [new Plugin({
      key: new PluginKey('xpAlignDefault'),
      appendTransaction(trs, oldState, newState) {
        if (!trs.some(t => t.docChanged)) return null
        if (trs.some(t => t.getMeta('preventUpdate') !== undefined || t.getMeta('history$') !== undefined || t.getMeta('addToHistory') === false)) return null
        const o = oldState.selection.$from, n = newState.selection.$from
        const was = o.parent, now = n.parent
        if (was.type.name !== 'paragraph' || now.type.name !== 'paragraph') return null
        if (o.depth !== 1 || n.depth !== 1) return null                       // top-level paragraphs only
        if (was.content.size !== 0 || now.content.size === 0) return null     // the first characters typed into an empty paragraph
        if (was.attrs.textAlign || now.attrs.textAlign) return null          // never override a choice (or a saved value)
        return newState.tr.setNodeMarkup(n.before(1), undefined, { ...now.attrs, textAlign: 'justify' })
      },
    })]
  },
})

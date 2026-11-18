// v1.347 — the Planner "Divider": a real block node inside the section's editor document (not decorative text).
//
// It is stored as the standard Tiptap node name `horizontalRule` ({ "type": "horizontalRule" }), so it round-trips through the existing saved JSON,
// is already understood by journalExport.ts, and is simply a block that the text-walking helpers (plain-text previews, search) skip. Both editors
// that can load a section's content (the Planner and the Task Manager's Journal Notes) register this same node, so a divider is never dropped
// when the other editor loads and re-saves the section.
//
// Unlike Tiptap's stock HorizontalRule it has NO markdown input rule: typing "---" stays plain text exactly as before.

import { Node, mergeAttributes } from '@tiptap/core'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    xpDivider: {
      /** Inserts a divider at the cursor and leaves the caret in an (existing or new) paragraph below it. */
      insertXpDivider: () => ReturnType
    }
  }
}

export const XpDivider = Node.create({
  name: 'horizontalRule',
  group: 'block',
  selectable: true,

  parseHTML() { return [{ tag: 'hr' }] },
  renderHTML({ HTMLAttributes }) { return ['hr', mergeAttributes({ class: 'xp-divider' }, HTMLAttributes)] },

  addCommands() {
    return {
      insertXpDivider: () => ({ chain }) => chain()
        .insertContent({ type: this.name })
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
    }
  },
})

/** Option A — "Minimal Ornamental Dots": hairline on each side of five dots, the middle one larger. One <hr>, drawn with layered gradients. */
export function dividerCss(scope: string): string {
  const line = 'rgba(124,58,237,0.38)'
  const dot = 'rgba(124,58,237,0.62)'
  const mid = 'rgba(124,58,237,0.88)'
  return `
        ${scope} hr.xp-divider {
          border: 0; height: 16px; margin: 10px 0; padding: 0; cursor: default; background-color: transparent;
          background-repeat: no-repeat;
          background-image:
            linear-gradient(${line}, ${line}),
            linear-gradient(${line}, ${line}),
            radial-gradient(circle at 50% 50%, ${mid} 0 5.5px, transparent 6px),
            radial-gradient(circle at calc(50% - 17px) 50%, ${dot} 0 3.2px, transparent 3.6px),
            radial-gradient(circle at calc(50% + 17px) 50%, ${dot} 0 3.2px, transparent 3.6px),
            radial-gradient(circle at calc(50% - 34px) 50%, ${dot} 0 2.7px, transparent 3.1px),
            radial-gradient(circle at calc(50% + 34px) 50%, ${dot} 0 2.7px, transparent 3.1px);
          background-size:
            calc(50% - 56px) 1px, calc(50% - 56px) 1px, 100% 100%, 100% 100%, 100% 100%, 100% 100%, 100% 100%;
          background-position:
            left center, right center, 0 0, 0 0, 0 0, 0 0, 0 0;
        }
        ${scope} hr.xp-divider.ProseMirror-selectednode { outline: 2px solid rgba(124,58,237,0.35); outline-offset: 2px; border-radius: 4px; }
  `
}

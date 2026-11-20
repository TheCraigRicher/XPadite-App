// v1.355 — Indent / Outdent work on ordinary text, not only on list items. Source-level pins (same style as the other Planner tests);
// the behaviour itself is covered by the browser runs recorded in the release notes.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..', '..')
const read = f => fs.readFileSync(path.join(root, f), 'utf8').split(String.fromCharCode(13, 10)).join('\n')
const indent = read('components/xpadite/journalIndent.ts')
const editor = read('components/xpadite/JournalEditorContent.tsx')
const embed = read('components/xpadite/JournalEditorEmbed.tsx')
const pkg = JSON.parse(read('package.json'))

test('indent level is an ordinary attribute in the existing document JSON: no dependency, no migration, unset = 0 = unchanged rendering', () => {
  assert.ok(!Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).some(k => /indent/i.test(k)))
  assert.match(indent, /const TEXT = \['paragraph', 'heading'\]/)
  assert.match(indent, /const LISTS = \['bulletList', 'orderedList', 'taskList'\]/)
  assert.match(indent, /xpIndent: \{\n\s+default: null,/)
  assert.match(indent, /export const MAX_INDENT = 8/)
  assert.match(indent, /renderHTML: attrs => \(typeof attrs\.xpIndent === 'number' && attrs\.xpIndent > 0 \? \{ 'data-xp-indent'/)
})

test('text indent never converts text into a list; only top-level text blocks change; hidden (collapsed) content is never touched', () => {
  assert.match(indent, /state\.doc\.resolve\(pos\)\.depth === 0 && TEXT\.includes\(node\.type\.name\)/)
  assert.ok(!/wrapInList|toggleBulletList|toggleTaskList|toggleList/.test(indent))
  assert.equal((indent.match(/hidden\.some\(h => pos >= h\.from && pos < h\.to\)\) return false/g) || []).length, 2)
})

test('list behaviour: nesting is the existing sinkListItem; a first item that cannot nest indents the whole top-level list; Outdent never lifts a top-level item out of its list', () => {
  assert.match(indent, /sinkListItem\(state\.schema\.nodes\[t\]\)/)
  assert.match(indent, /nothing can nest \(e\.g\. the first item of a list\): indent the whole top-level list/)
  assert.match(indent, /if \(nested\) \{[\s\S]*liftListItem/)
  assert.match(indent, /Outdent reduces the list's own indent, and never lifts an item out of its list/)
  assert.match(indent, /node\.attrs\.subItem && parentItems\(s2, pos\) === 0\) \{ tr\.setNodeMarkup\(pos, undefined, \{ \.\.\.node\.attrs, subItem: false \}\)/)   // a lifted item is no longer a sub-item
})

test('levels are clamped 0..8 (no negative indent) and the CSS beats the list rules\' own margins', () => {
  assert.match(indent, /Math\.max\(0, Math\.min\(MAX_INDENT, cur \+ dir\)\)/)
  assert.match(indent, /\[data-xp-indent="\$\{n\}"\]\[data-xp-indent\]\[data-xp-indent\] \{ margin-left: \$\{n \* STEP_PX\}px; \}/)
})

test('both editors register it (Journal Notes keeps and shows the indent); the toolbar Indent / Outdent use the one shared function', () => {
  assert.match(editor, /TableCell,\n      XpIndentExt,\n    \],/)
  assert.match(embed, /XpIndentExt,/)
  assert.match(editor, /\$\{indentCss\('\.xp-j-prose'\)\}/)
  assert.match(embed, /\$\{indentCss\('\.xp-je-prose'\)\}/)
  const h = editor.slice(editor.indexOf('function handleIndent()'), editor.indexOf('// Sub-item — true ON/OFF toggle'))
  assert.match(h, /applyXpIndent\(ed, 1\)/)
  assert.match(h, /applyXpIndent\(ed, -1\)/)
  assert.ok(!/sinkListItem/.test(h))
  assert.equal((editor.match(/onClick=\{handleIndent\}/g) || []).length, 2)     // desktop slot + mobile slot, as before
  assert.equal((editor.match(/onClick=\{handleOutdent\}/g) || []).length, 2)    // …and one Outdent beside each
  assert.equal((editor.match(/onMouseDown=\{e => e\.preventDefault\(\)\}\n\s+onClick=\{handleOutdent\}/g) || []).length, 2)   // the editor keeps its selection
})

test('a first checklist item that cannot nest moves NOTHING unless the selection covers the whole list (then the list moves as one block)', () => {
  assert.match(indent, /function coversAllItems\(/)
  assert.match(indent, /start < Math\.max\(to, from \+ 1\) && end > from/)
  assert.match(indent, /state\.doc\.resolve\(pos\)\.depth === 0 && coversAllItems\(state, pos, node\)\) tops\.push/)
})

// v1.352 — mobile divider balance + Planner text alignment. Source-level pins (same style as the other Planner tests);
// the behaviour itself is covered by the browser runs recorded in the release notes.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..', '..')
const read = f => fs.readFileSync(path.join(root, f), 'utf8').split(String.fromCharCode(13, 10)).join('\n')
const align = read('components/xpadite/journalAlign.ts')
const editor = read('components/xpadite/JournalEditorContent.tsx')
const embed = read('components/xpadite/JournalEditorEmbed.tsx')
const divider = read('components/xpadite/journalDivider.ts')
const pkg = JSON.parse(read('package.json'))

test('alignment needs no new dependency and no migration: a global attribute on the existing paragraph / heading nodes', () => {
  assert.ok(!Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).some(k => /text-align/.test(k)))
  assert.match(align, /types: TARGETS/)
  assert.match(align, /const TARGETS = \['paragraph', 'heading'\]/)
  assert.match(align, /default: null/)                                      // unset = "never chosen" = renders exactly as before
  assert.match(align, /renderHTML: attrs => \(attrs\.textAlign \? \{ style: `text-align: \$\{attrs\.textAlign\}` \} : \{\}\)/)
  assert.deepEqual([...align.matchAll(/'(left|center|right|justify)'/g)].map(m => m[1]).filter((v, i, a) => a.indexOf(v) === i).sort(), ['center', 'justify', 'left', 'right'])
})

test('the command only touches top-level text, and never content hidden under a collapsed divider', () => {
  assert.match(align, /!TARGETS\.includes\(node\.type\.name\) \|\| state\.doc\.resolve\(pos\)\.depth !== 0\) return false/)
  assert.match(align, /hidden\.some\(h => pos >= h\.from && pos < h\.to\)\) return false/)
})

test('Justify is the default only for the first characters typed into an EMPTY, unset, top-level paragraph', () => {
  assert.match(align, /t\.getMeta\('preventUpdate'\) !== undefined/)         // loading a document (setContent) is exempt
  assert.match(align, /t\.getMeta\('history\$'\) !== undefined/)             // undo / redo are exempt
  assert.match(align, /was\.content\.size !== 0 \|\| now\.content\.size === 0\) return null/)
  assert.match(align, /was\.attrs\.textAlign \|\| now\.attrs\.textAlign\) return null/)
  assert.match(align, /o\.depth !== 1 \|\| n\.depth !== 1/)
})

test('the Planner editor registers it with the default; the Journal Notes editor registers it WITHOUT the default so alignment survives a round trip', () => {
  assert.match(editor, /BoxTitle,\n      XpAlignExt,\n      XpDivider,\n      XpTable\.configure/)
  assert.match(embed, /XpAlignExt\.configure\(\{ defaultJustify: false \}\)/)
})

test('toolbar: one compact dropdown at the end of the toolbar row (after the emoji button, before Save), four options, accessible menu', () => {
  assert.ok(editor.indexOf('>😊</button>') < editor.indexOf('<AlignPicker value='))
  assert.ok(editor.indexOf('<AlignPicker value=') < editor.indexOf('{/* Right fade + arrow */}'))
  assert.equal((editor.match(/<AlignPicker value=/g) || []).length, 1)
  assert.match(editor, /role="menu" aria-label="Text alignment"/)
  assert.match(editor, /role="menuitemradio" aria-checked=\{on\}/)
  assert.match(editor, /'Justify — Align Both Edges'/)
  assert.match(editor, /useEscapeLayer\(open, e => \{ e\.preventDefault\(\); setOpen\(false\)/)
  assert.match(editor, /minHeight: 40/)
})

test('mobile divider: ONLY a phone-width media rule changes the collapsible divider; the base (desktop / tablet) rule is byte-for-byte what v1.351 shipped', () => {
  assert.match(divider, /@media \(max-width: 767px\) \{\n\s+\$\{scope\} hr\.xp-divider\[data-collapsible="true"\] \{\n\s+background-size:\n\s+calc\(50% - 82px\) 1px, calc\(50% - 82px\) 1px,/)
  assert.match(divider, /left 26px center, right 26px center,/)
  // the v1.351 base rule is unchanged
  assert.match(divider, /calc\(50% - 56px\) 1px, calc\(50% - 82px\) 1px, 100% 100%, 100% 100%, 100% 100%, 100% 100%, 100% 100%, 14px 14px;/)
  assert.match(divider, /left center, right 26px center, 0 0, 0 0, 0 0, 0 0, 0 0, right 6px center;/)
  // dots, line colour and the chevron are not touched
  assert.equal((divider.match(/radial-gradient/g) || []).length, 5)
  assert.match(divider, /const line = 'rgba\(124,58,237,0\.38\)'/)
})

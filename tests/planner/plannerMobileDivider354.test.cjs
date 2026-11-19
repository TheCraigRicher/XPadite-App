// v1.354 — mobile collapsible divider uses the section's padding; the Section ⋮ menu's Delete rule is unchanged (pin only).
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..', '..')
const read = f => fs.readFileSync(path.join(root, f), 'utf8').split(String.fromCharCode(13, 10)).join('\n')
const editor = read('components/xpadite/JournalEditorContent.tsx')
const divider = read('components/xpadite/journalDivider.ts')

test('phones: an unsplit Planner section lets its collapsible divider grow into the section padding; dots, lines and chevron are laid out in that box', () => {
  const rule = editor.slice(editor.indexOf('@media (max-width: 767px) {\n          .xp-j-sec-wrap > div > div > .tiptap > hr.xp-divider[data-collapsible="true"]'))
  assert.ok(rule.length > 0, 'the phone rule exists')
  const block = rule.slice(0, rule.indexOf('}\n        }') + 3)
  assert.match(block, /margin-left: -10px; margin-right: -26px;/)                       // section pads 14px left / 40px right: ~4px and ~14px stay clear
  assert.match(block, /calc\(50% - 64px\) 1px, calc\(50% - 64px\) 1px, calc\(100% - 16px\) 100%/)   // equal lines; dots centred on the text column
  assert.match(block, /left center, right 16px center, 0 0, 0 0, 0 0, 0 0, 0 0, right 0 center;/)  // chevron in the extra strip, ~5px clear of the right line
  assert.match(editor, /padding: sectionStyle \? '12px 40px 12px 14px' : '0'/)           // the padding the margins are derived from
})

test('the rule is limited to unsplit Planner sections; Journal Notes, split panes and text blocks keep the v1.353 layout', () => {
  assert.match(editor, /\.xp-j-sec-wrap > div > div > \.tiptap > hr\.xp-divider/)
  assert.match(divider, /left 17px center, right 17px center, 0 0, 0 0, 0 0, 0 0, 0 0, right 0 center;/)   // fallback unchanged from v1.353
  assert.match(divider, /calc\(50% - 73px\) 1px, calc\(50% - 73px\) 1px,/)
  // the shared divider CSS (desktop, tablet, decorative) is untouched
  assert.match(divider, /calc\(50% - 56px\) 1px, calc\(50% - 82px\) 1px, 100% 100%, 100% 100%, 100% 100%, 100% 100%, 100% 100%, 14px 14px;/)
})

test('Section ⋮ menu: Delete is one shared item (same code on every screen size), last, red; a days only section asks first', () => {
  const sec = editor.slice(editor.indexOf('✉ Send via Email'), editor.indexOf('/* Plain text block menu */'))
  assert.match(sec, /\{!!onDelete && \(\n\s+<button data-testid="section-delete" onClick=\{\(\) => \{ setMenuOpen\(false\); if \(isOnlyBlock\) setConfirmDeleteOnly\(true\); else onDelete\(\) \}\} style=\{\{ \.\.\.menuItemStyle\(isDark\), color: '#f87171' \}\}>\n\s+🗑 Delete/)
  assert.match(editor, /onDelete=\{\(\) => deleteBlock\(block\.id\)\}/)                 // one handler for every section, only or not
  assert.match(editor, /onConfirm=\{\(\) => \{ setConfirmDeleteOnly\(false\); onDelete\?\.\(\) \}\}/)   // the confirmed delete is the same handler
  assert.equal((editor.match(/@media[^{]*\{[^}]*Delete/g) || []).length, 0)             // no responsive rule hides it
  const dlg = read('components/xpadite/PlannerActionDialogs.tsx')
  assert.match(dlg, /This is the only section for this day\. Deleting it will remove its contents and replace it with an empty section\./)
  assert.match(dlg, /<button type="button" autoFocus data-testid="delete-cancel"/)     // Cancel is the focused default
  // the plain-text (non-section) block menu keeps its own rule
  assert.match(editor, /\{!!onDelete && !isOnlyBlock && \(\n\s+<button onClick=\{\(\) => \{ onDelete\(\); setMenuOpen\(false\) \}\} style=\{\{ \.\.\.menuItemStyle\(isDark\), color: '#f87171' \}\}>/)
})

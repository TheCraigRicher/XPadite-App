// v1.350 — Planner-wide menu, section-selection mode, bulk Send via Email; Notes card menus (v1.349 actions were present, the screenshot showed a FOLDER card menu).
// Pure helpers are transpiled and run; the wiring is pinned at source level; real interaction (menu, selection, mailto, clipboard, touch taps) is covered by the browser run.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

const root = path.join(__dirname, '..', '..')
const read = f => fs.readFileSync(path.join(root, f), 'utf8').split(String.fromCharCode(13, 10)).join('\n')
function loadTs(rel) {
  const file = path.join(root, rel)
  const out = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText
  const m = new Module(file, module); m.filename = file; m.paths = Module._nodeModulePaths(path.dirname(file)); m._compile(out, file); return m.exports
}
const E = loadTs('components/xpadite/emailShare.ts')
const editor = read('components/xpadite/JournalEditorContent.tsx')
const notesUi = read('components/xpadite/LibraryNotesFolders.tsx')

const para = t => ({ type: 'paragraph', content: t ? [{ type: 'text', text: t }] : [] })
const docOf = (...c) => JSON.stringify({ type: 'doc', content: c })
const sec = (id, name, ...content) => ({ id, type: 'section', name, content: docOf(...content), createdAt: 1790000000000, updatedAt: 1790000000500, displayAt: 1795000000000, important: true, sectionColor: 'teal' })
const task = (t, a = {}) => ({ type: 'taskItem', attrs: { checked: false, ...a }, content: [para(t)] })

test('bulk email body: section TEXT only, in the order given, one blank line between sections; no titles, headings, timestamps, ids or styling', () => {
  const a = sec('A', 'Goals heading', para('Alpha one'), para('Alpha two'))
  const b = sec('B', 'Plan heading', { type: 'bulletList', content: [{ type: 'listItem', content: [para('b1')] }] }, { type: 'orderedList', attrs: { start: 1 }, content: [{ type: 'listItem', content: [para('n1')] }] })
  const c = sec('C', 'Todo heading', { type: 'taskList', content: [task('call', { xpId: 'SECRET', xpSentTaskId: 'T-9' }), task('mail', { checked: true })] })
  const e = E.combineSectionsEmail([a, b, c], x => x.content, 'My plan')
  assert.equal(e.body, 'Alpha one\nAlpha two\n\n• b1\n1. n1\n\n☐ call\n☑ mail')
  assert.ok(!/heading|Goals|Plan heading|Todo|SECRET|T-9|2026|1790000000000|teal|─/.test(e.body), e.body)
  assert.deepEqual([e.subject, e.empty, e.skippedMedia], ['My plan', false, false])
  // the caller's order is the Planner order: the same sections handed over in Planner order give A, B, C regardless of tick order
  assert.equal(E.combineSectionsEmail([c, a], x => x.content, '').body, '☐ call\n☑ mail\n\nAlpha one\nAlpha two')
})

test('bulk email subject: the Planner title, else "XPadite Planner Notes"; capped; the live editor text wins; empties and media handled', () => {
  const a = sec('A', 'x', para('text'))
  assert.equal(E.combineSectionsEmail([a], x => x.content, '').subject, 'XPadite Planner Notes')
  assert.equal(E.combineSectionsEmail([a], x => x.content, '   ').subject, 'XPadite Planner Notes')
  assert.equal(E.combineSectionsEmail([a], x => x.content, 'T'.repeat(300)).subject.length, 100)
  assert.equal(E.combineSectionsEmail([a], () => docOf(para('fresh unsaved text')), 't').body, 'fresh unsaved text')
  const empty = sec('E', 'empty')
  empty.content = ''
  assert.equal(E.combineSectionsEmail([empty, a], x => x.content, 't').body, 'text')            // an empty section adds nothing (no stray blank lines)
  const onlyEmpty = E.combineSectionsEmail([empty], x => x.content, 't')
  assert.deepEqual([onlyEmpty.empty, onlyEmpty.body], [true, ''])                               // -> the UI says there is nothing to send
  const media = { id: 'M', type: 'section', content: '', partitions: [{ kind: 'content', content: docOf(para('left')) }, { kind: 'image', src: 'data:x' }], createdAt: 1, updatedAt: 1 }
  const m = E.combineSectionsEmail([media], x => x.content, 't'); assert.deepEqual([m.body, m.skippedMedia], ['left', true])
  // unsectioned (text) blocks are Planner content too
  assert.equal(E.combineSectionsEmail([{ id: 'T', type: 'text', content: docOf(para('plain block')), createdAt: 1, updatedAt: 1 }], x => x.content, 't').body, 'plain block')
})

test('bulk email: long combined content goes through the clipboard in FULL (reuses the v1.349 planner), short stays a mailto', () => {
  const big = Array.from({ length: 6 }, (_, i) => sec('S' + i, 'n', ...Array.from({ length: 30 }, (_, j) => para(`Section ${i + 1} line ${j + 1} with some filler words to make it long.`))))
  const e = E.combineSectionsEmail(big, x => x.content, 'Big plan')
  const plan = E.planEmail(e)
  assert.equal(plan.tooLong, true); assert.equal(plan.clipboardText, e.body)
  assert.equal(e.body.split('\n\n').length, 6); assert.ok(e.body.includes('Section 6 line 30'))
  assert.ok(plan.mailto.length < E.MAILTO_MAX)
  assert.equal(E.planEmail(E.combineSectionsEmail([sec('s', 'n', para('hi'))], x => x.content, 'Short')).tooLong, false)
})

test('Planner-wide menu: separate from the section menus, one action, structured for more; button never shown during selection', () => {
  assert.match(editor, /data-testid="planner-menu-btn" aria-label="Planner actions"/)
  assert.match(editor, /data-testid="planner-menu-email"/)
  assert.match(editor, /<span aria-hidden="true">✉<\/span>Send via Email/)
  assert.match(editor, /type PlannerSelectAction = 'email'/)                                   // the one place a future Merge / Labels action is added
  assert.match(editor, /\{!selection && \(\n\s+<button\n\s+type="button" data-testid="planner-menu-btn"/)
  assert.match(editor, /type PlannerSelectAction = 'email' \| 'label' \| 'merge'/)   // v1.351 extended the same mechanism with Assign Label and Merge Sections
  // the title input keeps its own behaviour (Enter still jumps into the first section)
  assert.match(editor, /const firstProse = blockListRef\.current\?\.querySelector\('\.xp-j-prose'\)/)
})

test('selection mode: temporary state only — never saved, no autosave, no content mutation; everything underneath is inert', () => {
  const part1 = editor.slice(editor.indexOf('function openPlannerMenu'), editor.indexOf('function toggleSelected') + 330)
  const part2 = editor.slice(editor.indexOf('function toggleSelectAll'), editor.indexOf('// v1.351 — Assign Label'))   // selection helpers only (the v1.351 apply functions that edit the document come after)
  const sel = part1 + part2
  assert.ok(part1.length > 300 && part2.length > 300)
  assert.ok(!/scheduleSave|onPersist|buildDocStr|updateBlock|setBlocks|blocksRef\.current = |onContentChange|setIsDirty|isDirtyRef/.test(sel.replace(/blocksRef\.current\.filter/g, '')), 'selection must not touch the document or the dirty/save machinery')
  assert.match(editor, /const \[selection, setSelection\] = useState<\{ action: PlannerSelectAction; ids: Set<string> \} \| null>\(null\)/)
  assert.match(editor, /inert=\{selection \? true : undefined\}/)                              // section content, menus, drag handles, checkboxes: not focusable / clickable
  assert.equal((editor.match(/inert=\{selection \? true : undefined\}/g) || []).length, 2)   // the blocks AND the editing toolbar
  assert.match(editor, /cancelDragRef\.current\?\.\(\); setMoveModeId\(null\); setResizeModeId\(null\); setSelectedBlockId\(null\)/)   // entering selection ends a move / resize
  assert.match(editor, /if \(selectionRef\.current\) \{ e\.stopImmediatePropagation\(\); selectionRef\.current = false; setSelection\(null\); return \}/)   // Escape cancels
  // one big tap target per card: it cannot collapse the section or open anything
  assert.match(editor, /data-testid="select-card" data-selected=/)
  assert.match(editor, /role="checkbox" aria-checked=\{on\} tabIndex=\{0\}/)
  assert.match(editor, /onClick=\{e => \{ e\.stopPropagation\(\); toggleSelected\(block\.id\) \}\}/)
})

test('Continue: needs at least one selected section; uses the Planner order and live text; ends selection; never saves', () => {
  const f = editor.slice(editor.indexOf('function finishSelection'), editor.indexOf('function finishSelection') + 2200)
  assert.match(f, /if \(!selection \|\| selection\.ids\.size === 0\) return/)
  assert.match(f, /blocksRef\.current\.filter\(b => selection\.ids\.has\(b\.id\)\)/)           // document order, not tick order
  assert.match(f, /combineSectionsEmail\(chosen, b => contentMapRef\.current\.get\(b\.id\) \?\? b\.content, titleRef\.current\)/)
  assert.match(f, /if \(mail\.empty\) \{ setToast\('The selected sections are empty — there is nothing to send\.'\); return \}/)   // stays in selection mode
  assert.match(f, /shareEmail\(mail\)\n\s+endSelection\(\)/)
  assert.match(editor, /disabled=\{selection\.ids\.size === 0\}/)
  assert.match(editor, /\{selection\.ids\.size\} of \{blocks\.filter\(isPickable\)\.length\} selected/)
})

test('Notes tab: the v1.349 actions are on NOTE cards; the menu in the report was a FOLDER card (Rename + Delete only, unchanged)', () => {
  const noteMenu = notesUi.slice(notesUi.indexOf('const noteMenu'), notesUi.indexOf('const noteCard'))
  for (const l of ["'Rename'", "n.pinned ? 'Unpin' : 'Pin to Top'", "'Send via Email'", "'Move to Folder'", "'Delete'"]) assert.ok(noteMenu.includes(l), l)
  const folderMenu = notesUi.slice(notesUi.indexOf('label="Folder actions"'), notesUi.indexOf('label="Folder actions"') + 520)
  assert.deepEqual([...folderMenu.matchAll(/label: '([^']+)'/g)].map(m => m[1]), ['Rename', 'Delete'])
  assert.ok(!/Pin to Top|Send via Email/.test(folderMenu), 'folder actions are not changed')
  // the same Notes menu is used at the root, inside a folder, and for filed Planner documents (which also have Pin + Email)
  assert.match(notesUi, /\{inside\.map\(n => noteCard\(n, true\)\)\}/)
  assert.match(notesUi, /\{unfiled\.map\(n => noteCard\(n, false\)\)\}/)
  assert.match(notesUi, /label: d\.pinned \? 'Unpin' : 'Pin to Top'/)
})

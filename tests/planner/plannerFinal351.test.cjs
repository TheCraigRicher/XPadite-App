// v1.351 — modal header controls on every tab, Planner-wide Assign Label + Merge Sections, collapsible dividers.
// Pure logic is transpiled and run (plannerMerge, the divider region maths on a real ProseMirror schema); the wiring is pinned at source level; the real interaction
// (menus, selection, dialogs, undo, collapse/expand, typing protection, reload, Journal Notes) is covered by the browser run recorded in the release notes.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

const root = path.join(__dirname, '..', '..')
const read = f => fs.readFileSync(path.join(root, f), 'utf8').split(String.fromCharCode(13, 10)).join('\n')
const cache = new Map()
function loadTs(rel) {
  const file = path.join(root, rel)
  if (cache.has(file)) return cache.get(file).exports
  const out = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText
  const m = new Module(file, module); m.filename = file; m.paths = Module._nodeModulePaths(path.dirname(file)); cache.set(file, m)
  const baseRequire = m.require.bind(m)
  m.require = spec => { if (spec.startsWith('.')) for (const ext of ['.ts', '.tsx']) { const p = path.join(path.dirname(file), spec + ext); if (fs.existsSync(p)) return loadTs(path.relative(root, p)) } return baseRequire(spec) }
  m._compile(out, file); return m.exports
}
const M = loadTs('components/xpadite/plannerMerge.ts')
const D = loadTs('components/xpadite/journalDivider.ts')
const editor = read('components/xpadite/JournalEditorContent.tsx')
const shell = read('components/xpadite/JournalWorkspaceModal.tsx')
const hdr = read('components/xpadite/PlannerHeaderButtons.tsx')

const para = t => ({ type: 'paragraph', content: t ? [{ type: 'text', text: t }] : [] })
const docOf = (...c) => JSON.stringify({ type: 'doc', content: c })
const task = (t, a = {}) => ({ type: 'taskItem', attrs: { checked: false, ...a }, content: [para(t)] })
const list = (...i) => ({ type: 'taskList', content: i })
const hr = (collapsible) => ({ type: 'horizontalRule', ...(collapsible === undefined ? {} : { attrs: { collapsible } }) })
const stats = c => M.contentStats(c)

// ── 1. header controls ─────────────────────────────────────────────────────
test('modal header: Library and Journal Calendar use the same round Maximize/Close buttons as the Editor; ONE maximise state for all tabs', () => {
  assert.ok(!shell.includes('× Close'), 'no rectangular text Close buttons left')
  assert.equal((shell.match(/<PlannerHeaderButtons maximized=\{maximized\}/g) || []).length, 2)
  assert.match(shell, /const maximized = desktop && maxRequested\b/)
  assert.equal((shell.match(/useState\(false\)\n\s+const maximized/g) || []).length, 1)             // a single maxRequested state
  // identical look to the Editor's own buttons: 30px circle, same colours, same SVG icons, same data-testids
  const ed = editor.slice(editor.indexOf('const HDR_ICON_BTN'), editor.indexOf('const HDR_ICON_BTN') + 300)
  for (const part of ["width: 30, height: 30, borderRadius: '50%'", "background: 'rgba(255,255,255,0.14)'", "color: 'rgba(255,255,255,0.88)'", "border: '0.5px solid rgba(255,255,255,0.25)'"]) { assert.ok(ed.includes(part), part); assert.ok(hdr.includes(part), part) }
  for (const svg of ['M10 4v6H4M10 10 4 4', 'M4 9V4h5M4 4l6 6', 'x1="18" y1="6" x2="6" y2="18"']) { assert.ok(editor.includes(svg), svg); assert.ok(hdr.includes(svg), svg) }
  assert.match(hdr, /\.xp-hdr-btn:hover \{ background: rgba\(255,255,255,0\.26\) !important; \}/)
  assert.match(hdr, /\.xp-hdr-btn:focus-visible \{ outline: 2px solid #fff; outline-offset: 2px; \}/)
  assert.match(hdr, /className="hidden sm:flex items-center gap-2"/)                                  // same rule as the Editor: Close hidden on phones (bottom nav closes)
  assert.match(hdr, /onToggleMaximize\?: \(\) => void/)                                                // omitted below 1024px
  assert.match(shell, /onToggleMaximize=\{desktop \? \(\) => setMaxRequested\(m => !m\) : undefined\}/)
})

// ── 2. Assign Label ────────────────────────────────────────────────────────
test('Assign Label: stored on the Planner section (labelId), applied in one update; sections never become Library items', () => {
  assert.match(read('components/xpadite/types.ts'), /labelId\?: string/)
  const fn = editor.slice(editor.indexOf('function applyLabel'), editor.indexOf('function applyMerge'))
  assert.ok(fn.length > 200)
  assert.match(fn, /if \(!set\.has\(b\.id\) \|\| b\.type !== 'section'\) return b/)
  assert.match(fn, /if \(labelId\) u\.labelId = labelId; else delete u\.labelId/)                      // change / remove
  assert.ok(!/journalDocs|createExtra|updateDay|extraDoc|addJournalLabel|folderId|labelIds/.test(fn), 'no Library document, no new label, no doc-level labels')
  assert.match(fn, /onContentChange\(buildDocStr\(\)\)\n\s+scheduleSave\(\)/)                           // saved by the normal autosave
  assert.match(shell, /labelOptions=\{allCategories\}/)                                                 // the Library's own label list (built-in + custom), by id
  assert.match(editor, /const sectionLabel = isSection && block\.labelId \? blockLabelOptions\.find\(l => l\.id === block\.labelId\) : undefined/)
  assert.match(editor, /data-testid="section-label"/)
  // the picker only offers existing labels and "Remove label"; there is no "new label" control
  const dlg = read('components/xpadite/PlannerActionDialogs.tsx')
  assert.ok(!/New label|Create label|onCreate/i.test(dlg))
  assert.match(dlg, /data-testid="label-remove"/)
})

test('selection actions: one mechanism for Send via Email / Assign Label / Merge Sections; unsectioned text is not offered to Assign Label', () => {
  assert.match(editor, /type PlannerSelectAction = 'email' \| 'label' \| 'merge'/)
  for (const id of ['planner-menu-email', 'planner-menu-label', 'planner-menu-merge']) assert.ok(editor.includes(`data-testid="${id}"`), id)
  assert.match(editor, /const isPickable = \(b: JournalBlock\) => b\.type === 'section' \|\| \(b\.type === 'text' && selection\?\.action !== 'label'\)/)
  assert.match(editor, /if \(selection\.action === 'label'\) \{ setDlg\(\{ kind: 'label', ids: chosen\.map\(b => b\.id\) \}\); return \}/)
  assert.match(editor, /if \(chosen\.length < 2\) \{ setToast\('Select at least two sections to merge\.'\); return \}/)
})

// ── 3. Merge ───────────────────────────────────────────────────────────────
test('merge text: destination first, then the others in the order given, one blank paragraph between parts; every character / item / divider / list kept', () => {
  const dest = docOf(para('Dest one'), list(task('d task', { xpId: 'D1', xpSentTaskId: 'T1' })))
  const a = docOf(para('A text'), { type: 'bulletList', content: [{ type: 'listItem', content: [para('a bullet')] }] }, hr(true), para('after divider'))
  const b = docOf({ type: 'orderedList', attrs: { start: 1 }, content: [{ type: 'listItem', content: [para('b one')] }] }, { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [para('cell')] }] }] })
  const r = M.mergeContents(dest, [a, b])
  assert.equal(r.ok, true)
  const doc = JSON.parse(r.content)
  assert.deepEqual(doc.content.map(n => n.type), ['paragraph', 'taskList', 'paragraph', 'paragraph', 'bulletList', 'horizontalRule', 'paragraph', 'paragraph', 'orderedList', 'table'])
  assert.equal(r.spacers, 2)
  assert.deepEqual(doc.content[2], { type: 'paragraph' }); assert.deepEqual(doc.content[7], { type: 'paragraph' })      // spacers
  const sum = ['chars', 'tasks', 'dividers', 'lists', 'tables'].map(k => [dest, a, b].reduce((n, c) => n + stats(c)[k], 0))
  const got = ['chars', 'tasks', 'dividers', 'lists', 'tables'].map(k => stats(r.content)[k])
  assert.deepEqual(got, sum)
  assert.equal(doc.content[5].attrs.collapsible, true)                                                                   // a collapsible divider stays collapsible
  assert.match(r.content, /"xpId":"D1","xpSentTaskId":"T1"/)                                                           // Sent link of the unique item survives
})

test('merge never creates two items claiming the same Task Manager task: a duplicate identity / Sent link on the COPY is cleared (the original keeps it)', () => {
  const dest = docOf(list(task('shared', { xpId: 'X1', xpSentTaskId: 'T1' })))
  const src = docOf(list(task('shared copy', { xpId: 'X1', xpSentTaskId: 'T1' }), task('own', { xpId: 'X2', xpSentTaskId: 'T2' }), task('fresh')))
  const r = M.mergeContents(dest, [src])
  assert.equal(r.ok, true); assert.equal(r.relinked, 1)
  const items = []; (function w(n) { if (n.type === 'taskItem') items.push(n); (n.content || []).forEach(w) })(JSON.parse(r.content))
  assert.equal(items.length, 4)
  const withId = items.filter(i => i.attrs.xpId)
  assert.deepEqual(items.map(i => [i.attrs.xpId ?? null, i.attrs.xpSentTaskId ?? null]), [['X1', 'T1'], [null, null], ['X2', 'T2'], [null, null]])
  assert.equal(new Set(withId.map(i => i.attrs.xpId)).size, withId.length)
})

test('merge: empty parts, a blank paragraph already between, and unreadable / unsupported content are handled without loss', () => {
  assert.deepEqual(M.mergeContents('', ['']), { ok: true, content: '', spacers: 0, relinked: 0 })
  assert.equal(JSON.parse(M.mergeContents(docOf(para('x')), ['', docOf(para('y'))]).content).content.length, 3)         // x, spacer, y (the empty source adds nothing)
  assert.equal(JSON.parse(M.mergeContents(docOf(para('x'), para('')), [docOf(para('y'))]).content).content.length, 3)  // already ends blank: no second spacer
  assert.equal(M.mergeContents('not json', [docOf(para('y'))]).ok, false)
  const bad = docOf(para('ok'), { type: 'mysteryNode', content: [para('inside')] })
  const r = M.mergeContents(docOf(para('x')), [bad]); assert.equal(r.ok, false)
  assert.deepEqual(M.contentStats(bad).unknown, ['mysteryNode'])
})

test('mergeProblems: split sections, image / mind-map sections and unknown content stop a merge with a clear reason', () => {
  const sec = (o) => ({ id: o.id, type: 'section', name: o.name, content: o.content ?? docOf(para('t')), createdAt: 1, updatedAt: 1, ...o.extra })
  const live = b => b.content
  assert.deepEqual(M.mergeProblems([sec({ id: 'a' }), sec({ id: 'b' })], live), [])
  const p = M.mergeProblems([sec({ id: 'a', name: 'Plain' }), sec({ id: 'b', name: 'Split one', extra: { partitions: [{ kind: 'content', content: '' }, { kind: 'image', src: 'x' }] } }), sec({ id: 'c', name: 'Pic', extra: { sectionImage: { kind: 'image', src: 'x' } } }), sec({ id: 'd', name: 'Odd', content: docOf({ type: 'mysteryNode' }) })], live)
  assert.deepEqual(p.map(x => x.id), ['b', 'c', 'd'])
  assert.match(p[0].reason, /"Split one" is split or holds an image/); assert.match(p[2].reason, /mysteryNode/)
})

test('merge wiring: confirmation first, ≥2 sections, ONE document update with history before and after; destination keeps its own metadata; sources removed only after verification', () => {
  const fn = editor.slice(editor.indexOf('function applyMerge'), editor.indexOf('function confirmLabel'))
  assert.ok(fn.length > 900)
  assert.match(fn, /chosen\.length < 2/)
  assert.match(fn, /const problems = mergeProblems\(chosen, live\)/)
  assert.ok(fn.indexOf('mergeContents(') < fn.indexOf('const gone = new Set'), 'verified merge is computed BEFORE anything is removed')
  assert.match(fn, /if \(!res\.ok\) return res/)
  assert.match(fn, /pushHistory\(true\)\s+\/\/ the pre-merge state, exactly/)
  assert.match(fn, /\.map\(b => b\.id === destId \? \{ \.\.\.b, content: res\.content, updatedAt: ts \} : b\)/)     // title, colour, important, label, createdAt/displayAt all kept
  assert.match(fn, /setHistoryRestoreSeq\(s0 => s0 \+ 1\)/)
  assert.match(fn, /onContentChange\(buildDocStr\(\)\)\n\s+scheduleSave\(\)\n\s+pushHistory\(true\)/)
  assert.ok(!/createdAt|displayAt|important|sectionColor|labelId|name:/.test(fn.replace(/problems|mergeProblems/g, '')), 'section-level metadata of the destination is never rewritten')
  // nothing happens without the explicit confirm button; Cancel / backdrop / Escape just close
  assert.match(editor, /onConfirm=\{confirmMerge\}/); assert.match(editor, /onCancel=\{\(\) => setDlg\(null\)\}/)
  const dlg = read('components/xpadite/PlannerActionDialogs.tsx')
  assert.match(dlg, /Not kept from the other sections:/)                                                                  // disclosure of what is lost
  assert.match(dlg, /The kept section&apos;s title, color, Important mark, label and dates stay as they are\./)
  assert.match(dlg, /Titles: /); assert.match(dlg, /Important marks on /); assert.match(dlg, /Labels: /)
})

// ── 4. Collapsible dividers ────────────────────────────────────────────────
test('divider regions: a divider controls the siblings after it up to the NEXT divider (or the end); the next divider and earlier content are never touched', () => {
  const { Schema } = require('@tiptap/pm/model')
  const schema = new Schema({ nodes: {
    doc: { content: 'block+' }, text: { group: 'inline' },
    paragraph: { group: 'block', content: 'inline*' },
    horizontalRule: { group: 'block', attrs: { collapsible: { default: false } } },
    bulletList: { group: 'block', content: 'listItem+' }, listItem: { content: 'paragraph block*' },
  } })
  const p = t => schema.nodes.paragraph.create(null, t ? schema.text(t) : null)
  const h = c => schema.nodes.horizontalRule.create({ collapsible: c })
  const list = schema.nodes.bulletList.create(null, [schema.nodes.listItem.create(null, [p('item')])])
  const doc = schema.nodes.doc.create(null, [p('intro'), h(true), p('one'), list, h(true), p('two'), h(false), p('after decorative')])
  const pos = []; doc.forEach((n, off) => { if (n.type.name === 'horizontalRule') pos.push(off) })
  const r1 = D.hiddenRegion(doc, pos[0])
  assert.deepEqual(r1.nodes.length, 2)                                         // 'one' and the list — stops at the next divider
  assert.equal(doc.textBetween(r1.from, r1.to, ' '), 'one item')
  const r2 = D.hiddenRegion(doc, pos[1])
  assert.equal(doc.textBetween(r2.from, r2.to, ' '), 'two')                     // stops at the following (decorative) divider
  assert.equal(D.hiddenRegion(doc, pos[2]).nodes.length, 1)                     // runs to the end of the section
  assert.equal(D.hiddenRegion(doc, 0), null)                                    // not a divider
  // only collapsed AND collapsible dividers hide anything; a decorative one (collapsible:false) never does
  assert.equal(D.hiddenRanges(doc, [pos[0], pos[1]]).length, 2)
  assert.equal(D.hiddenRanges(doc, [pos[2]]).length, 0)
  assert.equal(D.hiddenRanges(doc, [9999]).length, 0)
  // two collapsed dividers hide disjoint regions (independent)
  const [a, b] = D.hiddenRanges(doc, [pos[0], pos[1]]); assert.ok(a.to <= b.divider)
})

test('collapsible dividers: view state only — one optional attribute in the document, older dividers stay decorative, nothing hidden is ever deleted', () => {
  const src = read('components/xpadite/journalDivider.ts')
  assert.match(src, /collapsible: \{\n\s+default: false,/)                                                             // existing dividers load unchanged
  assert.match(src, /new PluginKey<\{ collapsed: number\[\] \}>\('xpDividerCollapse'\)/)                              // collapsed state lives in plugin state, not in the node
  assert.ok(!/setNodeMarkup[^\n]*collapsed|attrs:\s*\{[^}]*collapsed/.test(src), 'collapsed must never be written into the document')
  assert.match(src, /Decoration\.node\(h\.from, h\.to, \{ class: 'xp-div-hidden'/)                                      // hidden with decorations, not removed
  assert.match(src, /\.xp-div-hidden \{ display: none !important; \}/)
  assert.match(src, /filterTransaction\(tr, state\)/); assert.match(src, /appendTransaction\(_trs, _old, state\)/)         // typing / deleting inside hidden content is refused; selection leaves it
  assert.match(src, /if \(tr\.getMeta\('preventUpdate'\) !== undefined\) return true/)                                   // Undo / resync (setContent) still works…
  assert.ok(!/first\.from === 0/.test(src), 'a Select-all + Delete (same whole-document range) must NOT be exempt')
  assert.match(src, /\.insertContent\(\{ type: this\.name, attrs: \{ collapsible: true \} \}\)/)                         // toolbar dividers can collapse
  assert.match(src, /setNodeMarkup\(sel\.from, undefined, \{ \.\.\.sel\.node\.attrs, collapsible: !sel\.node\.attrs\.collapsible \}\)\.setMeta\(ATTR_META, true\)/)
  // exactly one chevron, at the far right, nothing else added to the divider
  assert.equal((src.match(/polyline points=/g) || []).length, 1)
  assert.match(src, /CHEVRON\('6 9 12 15 18 9'\)/); assert.match(src, /CHEVRON\('9 6 15 12 9 18'\)/)
  assert.match(src, /right 6px center/)
  // both editors that load section content get the same node (so Journal Notes can show / keep it)
  assert.match(editor, /XpDivider,\n\s+XpTable/); assert.match(read('components/xpadite/JournalEditorEmbed.tsx'), /XpDivider,/)
  // the enable / disable control is in the dock, only while a divider is selected
  assert.match(editor, /data-testid="divider-collapsible-btn"/); assert.match(editor, /\{dividerSel !== null && \(/)
  assert.equal((editor.match(/data-testid="divider-collapsible-btn"/g) || []).length, 2)
})

test('Undo / Redo persist through the normal autosave, restore the snapshot exactly (no re-stamping), and a merge pushes history before AND after', () => {
  for (const name of ['function customUndo', 'function customRedo']) {
    const f = editor.slice(editor.indexOf(name), editor.indexOf(name) + 900)
    assert.match(f, /dirtyBlockIdsRef\.current\.clear\(\)/)            // the restored snapshot keeps its own updatedAt values
    assert.match(f, /onContentChange\(buildDocStr\(\)\)/)
    assert.match(f, /scheduleSave\(\)/)                                // one debounced save of the LATEST state: rapid Undo/Redo can not leave a stale save
    assert.match(f, /setHistoryRestoreSeq\(s => s \+ 1\)/)
  }
  const m = editor.slice(editor.indexOf('function applyMerge'), editor.indexOf('function confirmLabel'))
  assert.ok(m.indexOf('pushHistory(true)') < m.indexOf('const gone = new Set'), 'pre-merge snapshot is taken before anything is removed')
})

// v1.349 — original section timestamps + editable stamp, Library Pin to Top, Send via Email (Planner section + Library note/document).
// The pure helpers are transpiled and RUN (emailShare, journalDocs, journalUtils, SectionStampEditor's split/join); the wiring is pinned at source level;
// the real edit/save/reload flows (timestamps, pins, mailto) are covered by the browser run recorded in the release notes.
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
  m.require = spec => {
    if (spec.startsWith('.')) { for (const ext of ['.ts', '.tsx']) { const p = path.join(path.dirname(file), spec + ext); if (fs.existsSync(p)) return loadTs(path.relative(root, p)) } }
    return baseRequire(spec)
  }
  m._compile(out, file); return m.exports
}
const E = loadTs('components/xpadite/emailShare.ts')
const D = loadTs('components/xpadite/journalDocs.ts')
const U = loadTs('components/xpadite/journalUtils.ts')
const S = loadTs('components/xpadite/SectionStampEditor.tsx')
const editor = read('components/xpadite/JournalEditorContent.tsx')
const modal = read('components/xpadite/JournalWorkspaceModal.tsx')
const notesUi = read('components/xpadite/LibraryNotesFolders.tsx')

const para = t => ({ type: 'paragraph', content: t ? [{ type: 'text', text: t }] : [] })
const docOf = (...c) => JSON.stringify({ type: 'doc', content: c })
const task = (t, attrs = {}, extra = []) => ({ type: 'taskItem', attrs: { checked: false, ...attrs }, content: [para(t), ...extra] })

// ── 1. Timestamps ──────────────────────────────────────────────────────────
test('stamp time: the section\'s ORIGINAL creation time, unless the user chose a display value; never invented', () => {
  assert.equal(U.sectionStampTime({ createdAt: 1_790_000_000_000 }), 1_790_000_000_000)
  assert.equal(U.sectionStampTime({ createdAt: 1_790_000_000_000, displayAt: 1_795_000_000_000 }), 1_795_000_000_000)
  assert.equal(U.sectionStampTime({}), null)                                   // nothing recorded -> hidden, not "now"
  assert.equal(U.sectionStampTime({ createdAt: 0 }), null)
  assert.equal(U.sectionStampTime({ createdAt: NaN }), null)
  assert.equal(U.sectionStampTime({ createdAt: 1_790_000_000_000, displayAt: undefined }), 1_790_000_000_000)   // "Use original" = clearing displayAt
})

test('stamp wiring: displays createdAt/displayAt (NOT updatedAt); no edit / save / sync path writes createdAt', () => {
  assert.match(editor, /fmtBlockStamp\(sectionStampTime\(block\)!\)/)
  assert.ok(!/fmtBlockStamp\(block\.updatedAt/.test(editor), 'the stamp must not follow the last-saved time any more')
  const fn = name => { const a = editor.indexOf(name); return editor.slice(a, a + 900) }
  for (const f of ['function updateBlock(', 'const buildPersistDocStr', 'const onBlockContentChange', 'function doMoveBlockToIdx(', 'function setBlockWidth(']) {
    assert.ok(!/createdAt/.test(fn(f).split('\n\n')[0]), f + ' must not touch createdAt')
  }
  // createdAt is only ever SET where a section is created: the factories and the two copy paths (a copy is a new section)
  const sets = editor.split('\n').filter(l => /createdAt:\s*(ts|Date\.now\(\)|now\(\))/.test(l) && !/updatedAt: Date.now\(\)\s*\}\s*$/.test(l))
  assert.equal(sets.length, 5, JSON.stringify(sets))   // duplicate + copy-to-date (sections), duplicate + copy (images), the new Mind Map block: all NEW blocks
  // a duplicate / copy gets its own creation time and drops any custom stamp
  assert.equal((editor.match(/delete copy\.displayAt/g) || []).length, 2)
  // moving a section to another date keeps the SAME block (createdAt and displayAt included)
  assert.match(editor, /const moved: JournalBlock = \{ \.\.\.block, content: liveContent, updatedAt: ts \}/)
})

test('stamp editing: double-click, double-tap (a scroll is not a tap), Enter/Space; isolated from drag / collapse / text editing; Escape closes only the editor', () => {
  assert.match(editor, /onDoubleClick=\{e => \{ e\.stopPropagation\(\); openStampEditor\(e\.currentTarget\) \}\}/)
  assert.match(editor, /e\.key === 'Enter' \|\| e\.key === ' '/)
  assert.match(editor, /role="button" tabIndex=\{0\}/)
  assert.match(editor, /onMouseDown=\{e => e\.stopPropagation\(\)\}\n\s+onClick=\{e => e\.stopPropagation\(\)\}/)
  assert.match(editor, /if \(!s0 \|\| s0\.moved\) \{ lastStampTap\.current = null; return \}/)
  assert.match(editor, /now - lt\.t < 350 && Math\.hypot\(lt\.x - s0\.x, lt\.y - s0\.y\) < 30/)
  assert.match(editor, /Math\.hypot\(t\.clientX - s0\.x, t\.clientY - s0\.y\) > 10\) s0\.moved = true/)
  assert.match(editor, /touchAction: 'manipulation'/)
  assert.match(editor, /onSave=\{ts => \{ onUpdateBlock\?\.\(\{ displayAt: ts \}\); setStampRect\(null\) \}\}/)    // saves ONLY the display value of that one section
  assert.match(editor, /onReset=\{\(\) => \{ onUpdateBlock\?\.\(\{ displayAt: undefined \}\); setStampRect\(null\) \}\}/)
  assert.match(editor, /if \(hasEscapeLayer\(\)\) return/)
  assert.match(editor, /\.xp-j-stamp:hover \{ text-decoration: underline dotted/)
  assert.match(editor, /\.xp-j-stamp:focus-visible/)
})

test('stamp editor: 12-hour <-> local epoch conversion is exact and rejects impossible dates', () => {
  const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi).getTime()
  for (const [h24, mi] of [[0, 0], [0, 7], [9, 5], [11, 59], [12, 0], [12, 30], [13, 0], [19, 57], [23, 59]]) {
    const t = at(2026, 11, 17, h24, mi); const p = S.splitStamp(t)
    assert.equal(S.joinStamp(p.date, p.hour12, p.minute, p.pm), t, `${h24}:${mi}`)
  }
  assert.deepEqual(S.splitStamp(at(2026, 11, 17, 19, 57)), { date: '2026-11-17', hour12: 7, minute: 57, pm: true })
  assert.deepEqual(S.splitStamp(at(2026, 11, 18, 0, 5)), { date: '2026-11-18', hour12: 12, minute: 5, pm: false })
  assert.deepEqual(S.splitStamp(at(2026, 11, 18, 12, 0)), { date: '2026-11-18', hour12: 12, minute: 0, pm: true })
  assert.equal(S.joinStamp('2026-02-30', 3, 0, false), null)
  assert.equal(S.joinStamp('', 3, 0, false), null)
  assert.equal(S.joinStamp('2026-11-17', 13, 0, false), null)
  assert.equal(S.joinStamp('2026-11-17', 3, 60, false), null)
})

// ── 2. Library pinning ─────────────────────────────────────────────────────
test('pin: one metadata flag in the document JSON (like labels/folder): survives autosave, content untouched, never added by the editor', () => {
  const raw = JSON.stringify({ v: 1, title: 'T', blocks: [{ id: 'a', type: 'section', content: docOf(para('hi')), createdAt: 5, updatedAt: 5 }], labelIds: ['L'], pinned: true })
  const edited = JSON.stringify({ v: 1, title: 'T', blocks: [{ id: 'a', type: 'section', content: docOf(para('hi there')), createdAt: 5, updatedAt: 6 }] })   // what the editor writes: no meta
  const merged = JSON.parse(D.mergeDocMeta(edited, raw))
  assert.equal(merged.pinned, true); assert.deepEqual(merged.labelIds, ['L'])
  assert.equal(merged.blocks[0].content, docOf(para('hi there')))
  // an unpinned doc stays unpinned through autosave
  const unpinned = JSON.parse(D.mergeDocMeta(edited, JSON.stringify({ v: 1, blocks: [] })))
  assert.ok(!('pinned' in unpinned))
  // an editor payload that somehow carries pinned cannot pin an unpinned doc
  assert.ok(!('pinned' in JSON.parse(D.mergeDocMeta(JSON.stringify({ v: 1, blocks: [], pinned: true }), JSON.stringify({ v: 1, blocks: [] })))))
})

test('pin: Library entries expose it; the toggle is a metadata-only edit (blocks byte-identical)', () => {
  const raw = JSON.stringify({ v: 1, title: 'Pinned note', blocks: [{ id: 'a', type: 'section', content: docOf(para('x')), createdAt: 1, updatedAt: 1 }], pinned: true })
  const plain = JSON.stringify({ v: 1, title: 'Other', blocks: [] })
  const e = D.buildLibraryEntries({ '2026-11-09': raw, '2026-11-10': plain }, [{ id: 'n1', kind: 'note', dateKey: '2026-11-11', raw: plain, rev: null, createdAt: 3 }], [])
  assert.deepEqual(e.map(x => [x.title, x.pinned]), [['Pinned note', true], ['Other', false], ['Other', false]])
  assert.match(modal, /function togglePin\(key: string\) \{\n\s+updateEntryDoc\(key, doc => \{ const u = \{ \.\.\.doc \}; if \(u\.pinned\) delete u\.pinned; else u\.pinned = true; return u \}\)\n\s+\}/)
  const before = JSON.parse(raw); const after = { ...before }; delete after.pinned
  assert.deepEqual(after.blocks, before.blocks); assert.ok(!('pinned' in after))
})

test('pin: Documents tab leads with ONE Pinned group (each item once, filters respected, latest month still opens by default); Notes tab lists pinned first', () => {
  assert.match(modal, /filteredLibraryEntries\.filter\(e => !e\.pinned\)\.forEach/)
  assert.match(modal, /pinned\.length > 0 \? \[\{ key: PINNED_GROUP, label: '📌 Pinned', entries: pinned \}, \.\.\.months\] : months/)
  assert.match(modal, /const pinned = filteredLibraryEntries\.filter\(e => e\.pinned\)/)     // built from the FILTERED list: month / label filters still apply
  assert.match(modal, /if \(key === PINNED_GROUP\) return true/)
  assert.match(modal, /return idx === \(libMonthGroups\[0\]\?\.key === PINNED_GROUP \? 1 : 0\)/)
  assert.match(notesUi, /const pinFirst = <T extends \{ pinned: boolean \}>\(a: T\[\]\): T\[\] => \[\.\.\.a\.filter\(x => x\.pinned\), \.\.\.a\.filter\(x => !x\.pinned\)\]/)
  assert.match(notesUi, /const unfiled = pinFirst\(notes\.filter\(n => !n\.folderId\)\)/)
  assert.match(notesUi, /inside = pinFirst\(notes\.filter\(n => n\.folderId === open\.id\)\)/)
  // every card layout uses the one shared menu: three-dot item + a bare pin mark; Notes cards get the same
  assert.equal((modal.match(/pinned=\{entry\.pinned\} onTogglePin=/g) || []).length, 4)
  assert.match(modal, /\{pinned \? 'Unpin' : 'Pin to Top'\}/)
  assert.match(notesUi, /\{ label: n\.pinned \? 'Unpin' : 'Pin to Top', icon: '📌'/)
  assert.match(notesUi, /entry\.pinned && <span data-testid="pin-mark"/)
  assert.ok(!/Pinned tab|libTab === 'pinned'/.test(modal), 'no separate Pinned tab')
})

// ── 3 + 4. Email ───────────────────────────────────────────────────────────
test('email text: paragraphs, line breaks, bullet / numbered / lettered lists, nested items and checkboxes keep their structure', () => {
  const t = E.tiptapToPlainText(docOf(
    para('Intro line'), para(''), para('Second paragraph'),
    { type: 'bulletList', content: [{ type: 'listItem', content: [para('one'), { type: 'bulletList', content: [{ type: 'listItem', content: [para('nested')] }] }] }, { type: 'listItem', content: [para('two')] }] },
    { type: 'orderedList', attrs: { start: 3 }, content: [{ type: 'listItem', content: [para('three')] }, { type: 'listItem', content: [para('four')] }] },
    { type: 'orderedList', attrs: { type: 'a', start: 1 }, content: [{ type: 'listItem', content: [para('alpha')] }, { type: 'listItem', content: [para('beta')] }] },
    { type: 'taskList', content: [task('todo'), task('done', { checked: true }), task('parent', {}, [{ type: 'taskList', content: [task('child')] }])] },
    { type: 'horizontalRule' },
    { type: 'paragraph', content: [{ type: 'text', text: 'a' }, { type: 'hardBreak' }, { type: 'text', text: 'b' }] },
  ))
  assert.equal(t, ['Intro line', '', 'Second paragraph', '• one', '  • nested', '• two', '3. three', '4. four', 'a. alpha', 'b. beta', '☐ todo', '☑ done', '☐ parent', '  ☐ child', '────────────', 'a', 'b'].join('\n'))
})

test('email text never carries internal metadata: no ids, Sent links, colours or attributes', () => {
  const t = E.tiptapToPlainText(docOf({ type: 'taskList', content: [task('Send invoice', { xpId: 'SECRET-ID-1', xpSentTaskId: 't-SECRET-2', subItem: true })] }, { type: 'paragraph', attrs: { x: 'HIDDEN' }, content: [{ type: 'text', text: 'plain', marks: [{ type: 'bold' }, { type: 'textStyle', attrs: { color: '#ff0000' } }] }] }))
  assert.equal(t, '☐ Send invoice\nplain')
  assert.ok(!/SECRET|HIDDEN|ff0000|t-/.test(t))
  const block = { id: 'sec-internal-id', type: 'section', name: 'Plan', content: docOf(para('Body')), createdAt: 1790000000000, updatedAt: 1, sectionColor: 'teal', important: true, displayAt: 5 }
  const e = E.sectionToEmail(block)
  assert.ok(!/sec-internal-id|teal|1790000000000/.test(e.subject + e.body))
})

test('email: section subject = its title; content = body; empty / title-only / untitled / split sections', () => {
  const b = (o) => ({ id: 'a', type: 'section', createdAt: 1, updatedAt: 1, ...o })
  let e = E.sectionToEmail(b({ name: 'Weekly plan', content: docOf(para('Line 1'), para('Line 2')) }))
  assert.deepEqual([e.subject, e.body, e.empty, e.skippedMedia], ['Weekly plan', 'Line 1\nLine 2', false, false])
  e = E.sectionToEmail(b({ content: docOf(para('Untitled first line here'), para('more')) }))
  assert.equal(e.subject, 'Untitled first line here')                                  // no title: the first line
  e = E.sectionToEmail(b({ name: 'Only a title', content: '' }))
  assert.deepEqual([e.subject, e.empty], ['Only a title', true])                       // empty body -> the UI says there is nothing to send
  e = E.sectionToEmail(b({ content: '' })); assert.deepEqual([e.subject, e.empty], ['XPadite section', true])
  e = E.sectionToEmail(b({ name: 'Split', partitions: [{ kind: 'content', content: docOf(para('left')) }, { kind: 'image', src: 'data:x' }] }))
  assert.deepEqual([e.body, e.skippedMedia], ['left', true])                           // images are reported, never silently pretended
  e = E.sectionToEmail(b({ name: 'Live', content: docOf(para('stale')) }), docOf(para('fresh from the editor')))
  assert.equal(e.body, 'fresh from the editor')                                        // the editor's current (unsaved) text wins
  assert.equal(E.sectionToEmail(b({ name: 'x'.repeat(300), content: docOf(para('t')) })).subject.length, 100)
})

test('email: a Library document = title as subject, every section in order, section titles as headings, media reported', () => {
  const raw = JSON.stringify({ v: 1, title: 'Q4 plan', blocks: [
    { id: '1', type: 'section', name: 'Goals', content: docOf(para('Grow'), { type: 'taskList', content: [task('Hire')] }) },
    { id: '2', type: 'drawing', src: 'data:x' },
    { id: '3', type: 'text', content: docOf(para('Closing words')) },
    { id: '4', type: 'section', content: docOf(para('Untitled section body')) },
  ] })
  const e = E.docToEmail(raw, 'Q4 plan')
  assert.equal(e.subject, 'Q4 plan')
  assert.equal(e.body, 'Goals\nGrow\n☐ Hire\n\nClosing words\n\nUntitled section body')
  assert.equal(e.skippedMedia, true); assert.equal(e.empty, false)
  assert.equal(E.docToEmail(JSON.stringify({ v: 1, blocks: [] }), 'Empty').empty, true)
  assert.equal(E.docToEmail(undefined, 'Nothing').empty, true)
  // a legacy plain-text document still sends its text
  assert.equal(E.docToEmail('just words', 'Legacy').body, 'just words')
})

test('email composition: short text -> one mailto: link with the exact text; long text -> clipboard with the FULL text (never truncated)', () => {
  const short = E.planEmail({ subject: 'A & B? 100% #1 ünï', body: 'Line 1\nLine 2 & more = "quoted" 😀' })
  assert.equal(short.tooLong, false)
  const q = new URLSearchParams(short.mailto.slice('mailto:?'.length))
  assert.equal(q.get('subject'), 'A & B? 100% #1 ünï')
  assert.equal(q.get('body'), 'Line 1\r\nLine 2 & more = "quoted" 😀')                 // CRLF is what mail clients expect; every character survives
  const longBody = Array.from({ length: 400 }, (_, i) => `Paragraph ${i + 1}: some reasonably long line of text.`).join('\n')
  const long = E.planEmail({ subject: 'Big note', body: longBody })
  assert.equal(long.tooLong, true)
  assert.equal(long.clipboardText, longBody)                                           // the whole text, byte for byte
  assert.ok(long.mailto.length < E.MAILTO_MAX)                                         // the composer itself always opens
  assert.ok(decodeURIComponent(long.mailto).includes('Big note') && decodeURIComponent(long.mailto).includes('clipboard'))
  assert.ok(!decodeURIComponent(long.mailto).includes('Paragraph 2:'), 'no partial/truncated body inside the link')
  // boundary: exactly at the limit stays a mailto, one more character switches to the clipboard path
  const room = E.MAILTO_MAX - `mailto:?subject=S&body=`.length
  assert.equal(E.planEmail({ subject: 'S', body: 'a'.repeat(room) }).tooLong, false)
  assert.equal(E.planEmail({ subject: 'S', body: 'a'.repeat(room + 1) }).tooLong, true)
  assert.equal(E.planEmail({ subject: '', body: '' }).tooLong, false)
})

test('email wiring: Planner section menu + both Library surfaces use one shared hook; read-only (nothing saved, marked or sent)', () => {
  assert.match(editor, /✉ Send via Email/)
  assert.match(editor, /shareEmail\(sectionToEmail\(block, editor \? serializeJournalContent\(editor\) : block\.content\)\)/)
  assert.match(modal, /shareEmail\(docToEmail\(rawOfKey\(key\), e\?\.title \?\? 'XPadite note'\)\)/)
  assert.match(modal, /<span>✉️<\/span>Send via Email/)
  assert.match(notesUi, /label: 'Send via Email', icon: '✉️', onClick: \(\) => onEmail\(n\.key\)/)
  const hook = read('components/xpadite/useEmailShare.tsx')
  assert.match(hook, /if \(e\.empty\) \{ setToast\('This is empty — there is nothing to send\.'\); return \}/)
  assert.match(hook, /const copied = copyText\(plan\.clipboardText\)/)               // clipboard copy is started inside the click
  assert.match(hook, /else setManual\(e\)/)                                           // no clipboard permission: a copy box with the full text
  assert.ok(!/fetch\(|XMLHttpRequest|supabase|updateDay|onUpdateBlock|setItem/.test(hook), 'composition must not save, send or store anything')
  const pure = read('components/xpadite/emailShare.ts')
  assert.ok(!/fetch\(|supabase|\bwindow\b|\bdocument\.(create|body|exec)|localStorage/.test(pure))
  // the Task Manager "Sent" badge feature is a separate code path and is untouched
  assert.match(editor, /xpSentTaskId: idMap\.get\(node\.attrs\.xpId\)/)
})

// v1.348 — Sent-badge inheritance, Mark as Important, section reordering (mouse + touch), 12-hour section stamp.
// journalUtils.ts is transpiled and run for real (pure helpers + a real ProseMirror schema); the editor/wiring is pinned at source level, and the
// behaviour in a real browser (Enter after a sent checkbox, mouse + touch drags, auto-scroll) is covered by the browser run recorded in the release notes.
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
const U = loadTs('components/xpadite/journalUtils.ts')
const editor = read('components/xpadite/JournalEditorContent.tsx')

// ── 4. Timestamp ───────────────────────────────────────────────────────────
test('stamp: 12-hour clock, lowercase am/pm, no leading zero on the hour, two-digit minutes, "Mon d, yyyy | h:mm am/pm"', () => {
  const at = (y, mo, d, h, mi) => U.fmtSectionStamp(new Date(y, mo - 1, d, h, mi).getTime())
  assert.equal(at(2026, 11, 17, 19, 57), 'Nov 17, 2026 | 7:57 pm')
  assert.equal(at(2026, 11, 18, 18, 58), 'Nov 18, 2026 | 6:58 pm')
  assert.equal(at(2026, 11, 18, 9, 5), 'Nov 18, 2026 | 9:05 am')
  assert.equal(at(2026, 11, 18, 12, 0), 'Nov 18, 2026 | 12:00 pm')
  assert.equal(at(2026, 11, 18, 0, 0), 'Nov 18, 2026 | 12:00 am')
  assert.equal(at(2026, 1, 3, 0, 7), 'Jan 3, 2026 | 12:07 am')
  assert.equal(at(2026, 12, 31, 23, 59), 'Dec 31, 2026 | 11:59 pm')
})

test('stamp: uses the device time zone and never the device locale (en-GB phones used to show "17 Nov 2026 | 19:57")', () => {
  const src = read('components/xpadite/journalUtils.ts')
  const fn = src.slice(src.indexOf('export function fmtSectionStamp'), src.indexOf('/** The small star beside'))
  assert.ok(!/toLocale|Intl\./.test(fn), 'must not depend on the locale')
  assert.match(fn, /d\.getHours\(\)/)                       // local time
  assert.match(editor, /function fmtBlockStamp\(ts: number\): string \{\n  return fmtSectionStamp\(ts\)\n\}/)
  // the value shown is still updatedAt ?? createdAt (last saved), and only the colour contrast changed
  assert.match(editor, /\{fmtBlockStamp\(block\.updatedAt \?\? block\.createdAt\)\}/)
  assert.match(editor, /fontSize: 10,/)
  assert.match(editor, /color: isDark \? 'rgba\(255,255,255,0\.42\)' : 'rgba\(0,0,0,0\.42\)'/)
})

// ── 1. Sent badge ──────────────────────────────────────────────────────────
test('Sent badge root cause: both link attributes opt out of Enter/split inheritance', () => {
  const item = editor.slice(editor.indexOf('const SubItemTaskItem'), editor.indexOf('// Planner "Add Table"'))
  assert.match(item, /xpId: \{\n\s+default: null,\n\s+keepOnSplit: false,/)
  assert.match(item, /xpSentTaskId: \{\n\s+default: null,\n\s+keepOnSplit: false,/)
  // sub-item level is deliberately still inherited (a sub-item continues as a sub-item)
  assert.match(item, /subItem: \{\n\s+default: false,\n\s+parseHTML/)
})

test('Sent badge: pasted items and duplicated/copied sections are new items with no inherited link', () => {
  assert.match(editor, /transformPasted: \(slice, view\) => clearTaskLinksFromSlice\(transformPastedChecklist\(slice, view\.state\.schema\)\)/)
  assert.match(editor, /const copy: JournalBlock = \{ \.\.\.stripBlockTaskLinks\(original, liveContent\), id: mkId\(\)/)
  assert.match(editor, /const copy: JournalBlock = \{ \.\.\.stripBlockTaskLinks\(block, liveContent\), id: mkId\(\)/)
  // Move-to-another-date keeps the very same items (and their real Sent status)
  assert.match(editor, /const moved: JournalBlock = \{ \.\.\.block, content: liveContent, updatedAt: ts \}/)
  // the Sent badge itself is still driven only by the item's own attribute — never by position or neighbours
  assert.match(editor, /li\[data-xp-sent-task-id\] > div > p:first-child::after/)
  // sending still marks only items whose id was actually created, after the Task Manager write
  assert.match(editor, /idMap\.has\(node\.attrs\.xpId\)/)
})

const task = (text, attrs = {}) => ({ type: 'taskItem', attrs: { checked: false, ...attrs }, content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }] })
const list = (...items) => ({ type: 'taskList', content: items })
const doc = (...c) => JSON.stringify({ type: 'doc', content: c })

test('stripTaskLinks removes identity + Sent status from EVERY checklist item (nested too) and nothing else', () => {
  const src = doc(list(
    task('a', { xpId: 'i1', xpSentTaskId: 't1', subItem: false }),
    { type: 'taskItem', attrs: { checked: true, xpId: 'i2', xpSentTaskId: 't2' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'b' }] }, list(task('c', { xpId: 'i3', xpSentTaskId: 't3', subItem: true }))] },
  ))
  const out = JSON.parse(U.stripTaskLinks(src))
  const items = []; (function walk(n) { if (n.type === 'taskItem') items.push(n); (n.content || []).forEach(walk) })(out)
  assert.equal(items.length, 3)
  for (const it of items) { assert.equal(it.attrs.xpId, null); assert.equal(it.attrs.xpSentTaskId, null) }
  assert.equal(items[1].attrs.checked, true)            // other state untouched
  assert.equal(items[2].attrs.subItem, true)
  assert.match(U.stripTaskLinks(src), /"text":"a"/)
  // nothing to strip -> the very same string back (no needless rewrite)
  const clean = doc(list(task('x')))
  assert.equal(U.stripTaskLinks(clean), clean)
  assert.equal(U.stripTaskLinks(undefined), undefined)
  assert.equal(U.stripTaskLinks('not json'), 'not json')
})

test('stripBlockTaskLinks: a copy of a section loses every Sent link (including a split section\'s halves) but keeps everything else', () => {
  const block = {
    id: 's1', type: 'section', name: 'Plan', sectionColor: 'teal', important: true, width: 50, createdAt: 1, updatedAt: 2,
    content: doc(list(task('one', { xpId: 'i1', xpSentTaskId: 't1' }))),
    partitions: [{ kind: 'content', content: doc(list(task('left', { xpId: 'i2', xpSentTaskId: 't2' }))) }, { kind: 'image', src: 'data:x' }],
  }
  const live = doc(list(task('one live', { xpId: 'i1', xpSentTaskId: 't1' })))
  const c = U.stripBlockTaskLinks(block, live)
  assert.ok(!/xpSentTaskId":"/.test(c.content) && !/xpId":"/.test(c.content))
  assert.match(c.content, /one live/)                    // the LIVE editor content is what is copied
  assert.ok(!/xpSentTaskId":"/.test(c.partitions[0].content))
  assert.deepEqual(c.partitions[1], { kind: 'image', src: 'data:x' })
  assert.equal(c.important, true); assert.equal(c.sectionColor, 'teal'); assert.equal(c.name, 'Plan'); assert.equal(c.width, 50)
  assert.match(block.content, /"xpSentTaskId":"t1"/)     // the original block object is untouched
})

test('clearTaskLinksFromSlice (real ProseMirror schema): pasted items lose the link, text and checked state survive, other slices pass through unchanged', () => {
  const { Schema } = require('@tiptap/pm/model')
  const { Slice, Fragment } = require('@tiptap/pm/model')
  const schema = new Schema({
    nodes: {
      doc: { content: 'block+' }, text: { group: 'inline' },
      paragraph: { group: 'block', content: 'inline*' },
      taskList: { group: 'block', content: 'taskItem+' },
      taskItem: { content: 'paragraph block*', attrs: { checked: { default: false }, xpId: { default: null }, xpSentTaskId: { default: null } } },
    },
  })
  const mk = (t, attrs) => schema.nodes.taskItem.create(attrs, schema.nodes.paragraph.create(null, t ? schema.text(t) : null))
  const slice = new Slice(Fragment.from(schema.nodes.taskList.create(null, [mk('sent', { checked: true, xpId: 'i1', xpSentTaskId: 't1' }), mk('fresh', {})])), 0, 0)
  const out = U.clearTaskLinksFromSlice(slice)
  const items = []; out.content.descendants(n => { if (n.type.name === 'taskItem') items.push(n) })
  assert.equal(items.length, 2)
  assert.equal(items[0].attrs.xpSentTaskId, null); assert.equal(items[0].attrs.xpId, null)
  assert.equal(items[0].attrs.checked, true); assert.equal(items[0].textContent, 'sent'); assert.equal(items[1].textContent, 'fresh')
  const plain = new Slice(Fragment.from(schema.nodes.paragraph.create(null, schema.text('hello'))), 0, 0)
  assert.equal(U.clearTaskLinksFromSlice(plain), plain)         // untouched slice: the same object back
  const noLinks = new Slice(Fragment.from(schema.nodes.taskList.create(null, [mk('x', {})])), 0, 0)
  assert.equal(U.clearTaskLinksFromSlice(noLinks), noLinks)
  assert.equal(slice.content.firstChild.firstChild.attrs.xpSentTaskId, 't1')   // input not mutated
})

// ── 2. Mark as Important ───────────────────────────────────────────────────
test('Important: a plain optional flag on the section (nothing else changes), toggled from the section menu', () => {
  assert.match(read('components/xpadite/types.ts'), /important\?: boolean/)
  assert.match(editor, /\{block\.important \? '★ Remove Important Mark' : '☆ Mark as Important'\}/)
  assert.match(editor, /onUpdateBlock\?\.\(\{ important: block\.important \? undefined : true \}\)/)   // off = the key disappears from the saved JSON
  // the star is a bare SVG polygon: no box, pill, background or text
  const star = editor.slice(editor.indexOf('function ImportantStar'), editor.indexOf('interface JournalTextBlockProps'))
  assert.match(star, /<polygon fill=\{color\}/)
  assert.ok(!/background|border|padding|borderRadius/.test(star))
  // it follows the title (so it wraps with a long title instead of covering the ⋮ menu), also while collapsed, and uses the section colour
  assert.match(editor, /\{block\.name\}\{block\.important && <ImportantStar color=\{getImportantStarColor\(block\.sectionColor, isDark\)\} \/>\}/)
  assert.match(editor, /lineHeight: 1\.3, overflowWrap: 'anywhere'/)
  // Task Manager priorities are not touched by it
  assert.ok(!/isPriority[^\n]*important|important[^\n]*isPriority/.test(editor))
})

test('Important star colours: one per section colour (incl. Teal and Rosewood), a neutral one for Plain, light and dark', () => {
  for (const k of ['plain', 'blue', 'green', 'peach', 'pink', 'lavender', 'yellow', 'teal', 'rosewood']) {
    const l = U.getImportantStarColor(k, false), d = U.getImportantStarColor(k, true)
    assert.match(l, /^#[0-9a-f]{6}$/); assert.match(d, /^#[0-9a-f]{6}$/)
  }
  assert.equal(U.getImportantStarColor('plain', false), '#71717a')          // neutral grey
  assert.notEqual(U.getImportantStarColor('teal', false), U.getImportantStarColor('rosewood', false))
  assert.equal(U.getImportantStarColor('legacy-unknown', false), U.getImportantStarColor('plain', false))   // older/unknown keys fall back safely
  assert.equal(U.getImportantStarColor(undefined, true), U.getImportantStarColor('plain', true))
})

test('Important: duplicate keeps the flag with its own identity; changing colour / moving never drops it; Task Manager untouched', () => {
  const dup = editor.slice(editor.indexOf('function duplicateBlock'), editor.indexOf('// Appends an independent copy'))
  assert.match(dup, /\.\.\.stripBlockTaskLinks\(original, liveContent\), id: mkId\(\)/)   // spreads the original (flag included) with a NEW id
  assert.match(editor, /updateBlock\(block\.id, \{ sectionColor: color \}\)/)             // merge-style update: other fields (important) stay
  assert.match(editor, /const next = blocksRef\.current\.map\(b => b\.id === id \? \{ \.\.\.b, \.\.\.updates, updatedAt: Date\.now\(\) \} : b\)/)
  assert.match(editor, /const \[blk\] = next\.splice\(from, 1\)/)                          // reorder moves the block object itself
})

// ── 3. Section reordering ──────────────────────────────────────────────────
test('Move: one reorder system — menu "✥ Move" activates it, "📅 Move Section" still moves to another date', () => {
  assert.match(editor, /✥ Move\n/)
  assert.match(editor, /📅 Move Section/)
  assert.equal((editor.match(/function beginBlockDrag\(/g) || []).length, 1)
  assert.equal((editor.match(/function doMoveBlockToIdx\(/g) || []).length, 1)
})

test('Move: a visible drag handle for mouse AND touch; sections drag by the handle only', () => {
  assert.match(editor, /data-testid="move-grip"/)
  assert.match(editor, /onMouseDown=\{e => \{ e\.stopPropagation\(\); onMoveGripStart\?\.\(e\) \}\}/)
  assert.match(editor, /onTouchStart=\{e => \{ e\.stopPropagation\(\); onMoveGripStart\?\.\(e\) \}\}/)
  assert.match(editor, /cursor: 'grab', touchAction: 'none'/)                         // the handle never scrolls; the rest of the page does
  assert.match(editor, /onMouseDown=\{isMoveMode && !isDragging && block\.type !== 'section' \? e => startBlockMove\(block\.id, e\) : undefined\}/)
  assert.match(editor, /Math\.hypot\(xy\.x - sx, xy\.y - sy\) >= THRESHOLD/)           // a tap on the handle moves nothing
  assert.match(editor, /startGripDrag\(block\.id, e\)/)
})

test('Move: touchcancel / Cancel / Escape end the drag cleanly; the machine always tears itself down', () => {
  const m = editor.slice(editor.indexOf('function beginBlockDrag'), editor.indexOf('function startGripDrag'))
  assert.match(m, /document\.addEventListener\('touchcancel', onCancel\)/)
  assert.match(m, /document\.removeEventListener\('touchcancel', onCancel\)/)
  assert.match(m, /function onCancel\(\) \{ if \(!ended\) teardown\(\) \}/)
  for (const must of ['dragMoveRef.current = null', 'setDragPos(null)', 'setMoveModeId(null)', 'cancelAnimationFrame(raf)']) assert.ok(m.includes(must), must)
  assert.match(editor, /if \(moveModeIdRef\.current\) \{\n\s+e\.stopImmediatePropagation\(\)\n\s+cancelDragRef\.current\?\.\(\)/)
  assert.match(editor, /onMoveCancel=\{\(\) => \{ cancelDragRef\.current\?\.\(\); setMoveModeId\(null\) \}\}/)
})

test('Move: the scrollable Planner area auto-scrolls near its top/bottom edge and the drop slot is recomputed while it scrolls', () => {
  const m = editor.slice(editor.indexOf('function beginBlockDrag'), editor.indexOf('function startGripDrag'))
  assert.match(m, /container\?\.closest\('\.xp-j-content-scroll'\)/)                   // the real scroller (also when the modal is maximised)
  assert.match(m, /scroller\.scrollTop = before \+ dy/)
  assert.match(m, /if \(scroller\.scrollTop !== before\) applyPointer\(lastXY\)/)
  assert.match(m, /Math\.min\(24,/)                                                    // bounded speed: no jumps
  assert.match(editor, /className="xp-j-content-scroll"/)
})

test('Move: reordering is only the existing array move + normal autosave (content, colour, dividers, flag, stamps travel with the block)', () => {
  const mv = editor.slice(editor.indexOf('function doMoveBlockToIdx'), editor.indexOf('// Extracts the pointer position'))
  assert.match(mv, /next\.splice\(adj, 0, blk\)/)
  assert.match(mv, /onContentChange\(buildDocStr\(\)\)\n\s+scheduleSave\(\)/)
  assert.ok(!/updatedAt/.test(mv), 'a reorder must not rewrite any block timestamp')
})

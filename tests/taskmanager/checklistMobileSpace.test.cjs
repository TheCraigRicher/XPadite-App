// v1.318 — mobile Task Manager checklist: a box (☐/☑ at the start of a line) toggles whatever follows it — text, spaces, or nothing.
// Real-Chrome verification (320/360/390/430px, every format, edits, Save/refresh, tablet/desktop unchanged) was done during
// development; this file runs the REAL toggle function and guards the implementation contract.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const src = fs.readFileSync(path.join(__dirname, '..', '..', 'components/xpadite/DayModal.tsx'), 'utf8').replace(/\r\n/g, '\n')
const a = src.indexOf('// ── Checklist (☐ / ☑) clicks')
const b = src.indexOf('function handleTitleEditEnd')
const block = src.slice(a, b)
const mobile = block.slice(0, block.indexOf('function handleNotesTextareaClick'))

// Runs the real toggleChecklistGlyph from DayModal.tsx against a given notes draft; returns the new text (or null if untouched).
function loadToggle(journal) {
  const start = src.indexOf('function toggleChecklistGlyph')
  const end = src.indexOf('function mobileChecklistHit')
  const js = ts.transpileModule(src.slice(start, end) + '\nmodule.exports = toggleChecklistGlyph', { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const m = { exports: {} }
  let out = null
  new Function('module', 'exports', 'draftJournal', 'task', 'onNotesDraftChange', js)(m, m.exports, journal, { journal: '' }, v => { out = v })
  return i => { out = null; m.exports(i); return out }
}

test('every required format toggles ☐ <-> ☑ and nothing else changes (spaces and text are kept)', () => {
  const doc = ['☐ Buy groceries', '☐Buy groceries', '☐', '☐  Buy groceries', '☑Completed task', '☑ Done', 'plain line'].join('\n')
  const toggle = loadToggle(doc)
  const only = (i, line) => {
    const r = toggle(i).split('\n')
    assert.equal(r[i], line)
    assert.deepEqual(r.filter((_, k) => k !== i), doc.split('\n').filter((_, k) => k !== i), 'every other line untouched')
  }
  only(0, '☑ Buy groceries'); only(1, '☑Buy groceries'); only(2, '☑'); only(3, '☑  Buy groceries')
  only(4, '☐Completed task'); only(5, '☐ Done')
  assert.equal(toggle(6), null, 'a non-checkbox line is never rewritten')
  assert.equal(toggle(99), null, 'an out-of-range line is ignored')
})

test('toggling twice returns the exact original text for every format (including trailing spaces and tabs)', () => {
  for (const line of ['☐ a', '☐a', '☐', '☐  a', '☑a', '☑', '☑  a  ', '☐\t tab']) {
    const once = loadToggle(line)(0)
    assert.equal(loadToggle(once)(0), line, JSON.stringify(line))
    assert.equal(once.slice(1), line.slice(1), 'only the first character differs')
  }
})

test('boxes with text typed directly beside them, or after edits, still toggle (box + any following text)', () => {
  for (const line of ['☐abc', '☐Replaced', '☑x', '☐1', '☐-', '☐😀 emoji']) assert.equal(loadToggle(line)(0).slice(1), line.slice(1))
})

test('no whitespace is required anywhere in the phone detection path', () => {
  assert.ok(/\[☐☑\]\/\.test\(value\)/.test(mobile) && !/\[☐☑\] \//.test(mobile), 'quick pre-check has no trailing space')
  assert.ok(/line\.startsWith\('☐'\) \|\| line\.startsWith\('☑'\)/.test(mobile) && !/startsWith\('[☐☑] '\)/.test(mobile), 'glyph scan has no trailing space')
  assert.ok(!/toggleChecklistLine/.test(mobile), 'the space-dependent shared toggle is not used on phones')
  assert.ok(/toggleChecklistGlyph\(index\)/.test(mobile))
})

test('nothing is inserted or rewritten: the toggle never adds or normalises a space', () => {
  const tg = mobile.slice(mobile.indexOf('function toggleChecklistGlyph'), mobile.indexOf('function mobileChecklistHit'))
  assert.ok(/'☑' \+ line\.slice\(1\)/.test(tg) && /'☐' \+ line\.slice\(1\)/.test(tg))
  assert.ok(!/\+ ' '/.test(tg) && !/\.replace\(/.test(tg) && !/trim/.test(tg))
  assert.ok(/onNotesDraftChange\(lines\.join\('\\n'\)\)/.test(tg), 'still goes through the existing notes draft + Save path')
})

test('phones are routed to their own tap handler first; tablet/desktop fall through to the mouse path (checklistDesktop.test.cjs)', () => {
  assert.ok(/if \(window\.innerWidth < MOBILE_CHECKLIST_MAX_WIDTH\) \{ handleMobileChecklistTap\(e\); return \}/.test(block))
  assert.ok(!/toggleChecklistLine/.test(src), 'the old space-dependent toggle no longer exists anywhere')
})

test('v1.317 behaviour preserved: real-layout hit-testing, finger-sized zone, caret/focus restore, pointer-down capture', () => {
  assert.ok(/ms\.whiteSpace = 'pre-wrap'/.test(mobile) && /range\.setStart\(node, offset\); range\.setEnd\(node, offset \+ 1\)/.test(mobile))
  assert.ok(/clientX >= originX && clientX <= xMax && clientY >= top - slack && clientY <= bottom \+ slack/.test(mobile))
  assert.ok(/: 3\b/.test(mobile) && /: right \+ 16/.test(mobile), "phones (mode 'touch'): ±3px rows and 16px past the box — values unchanged")
  assert.ok(/ta\.setSelectionRange\(before\.start, before\.end\)/.test(block) && /ta\.blur\(\)/.test(block))
  assert.ok(/onPointerDown=\{handleNotesPointerDown\}/.test(src))
})

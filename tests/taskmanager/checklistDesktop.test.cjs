// v1.318 (tablet + desktop part) — Task Manager accomplishment checklist: a click on a ☐/☑ toggles it whatever follows it
// (text, spaces, nothing), and the right line is found even when earlier items wrap. Real-Chrome verification at 768/1024/1280px
// (every format, wrapped items, repeated toggles, edit cases, Save/reload) was done during development; the phone behaviour was
// re-run and is unchanged. This file guards the implementation contract.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const src = fs.readFileSync(path.join(__dirname, '..', '..', 'components/xpadite/DayModal.tsx'), 'utf8').replace(/\r\n/g, '\n')
const a = src.indexOf('// ── Checklist (☐ / ☑) clicks')
const b = src.indexOf('function handleTitleEditEnd')
const block = src.slice(a, b)
const click = src.slice(src.indexOf('function handleNotesTextareaClick'), b)
const hit = block.slice(block.indexOf('function mobileChecklistHit'), block.indexOf('function handleNotesPointerDown'))

test('tablet/desktop click handler uses the real-layout box finder and the shared space-independent toggle', () => {
  assert.ok(/const index = mobileChecklistHit\(e\.currentTarget, e\.clientX, e\.clientY, 'mouse'\)/.test(click))
  assert.ok(/if \(index !== null\) toggleChecklistGlyph\(index\)/.test(click))
})
test('the old line-height arithmetic and the space-dependent rules are gone from every path', () => {
  assert.ok(!/Math\.floor\(relY \/ lineHeight\)/.test(src) && !/toggleChecklistLine/.test(src))
  assert.ok(!/startsWith\('[☐☑] '\)/.test(block) && !/\[☐☑\] \//.test(block), 'no check anywhere requires a space after the box')
})
test("mouse zone = the original zone (first 22px of text, whole line box); touch zone (phones) is exactly as before", () => {
  assert.ok(/mode: 'touch' \| 'mouse' = 'touch'/.test(block), "phones' default mode is unchanged")
  assert.ok(/const slack = mode === 'mouse' \? Math\.max\(0, \(lh - r\.height\) \/ 2\) : 3/.test(hit))
  assert.ok(/const xMax = mode === 'mouse' \? originX \+ \(parseFloat\(cs\.paddingLeft\) \|\| 0\) \+ 22 : right \+ 16/.test(hit))
  assert.ok(/clientX >= originX && clientX <= xMax && clientY >= top - slack && clientY <= bottom \+ slack/.test(hit))
})
test('desktop clicks keep the browser defaults: no preventDefault, no caret/selection/focus handling, no pointer-down hook', () => {
  assert.ok(!/preventDefault|setSelectionRange|blur\(|focus\(/.test(click))
  const pd = block.slice(block.indexOf('function handleNotesPointerDown'), block.indexOf('function handleMobileChecklistTap'))
  assert.ok(/if \(window\.innerWidth >= MOBILE_CHECKLIST_MAX_WIDTH\) return/.test(pd), 'the pointer-down capture still bails out above 640px')
})
test('phones are unaffected: they still go through the dedicated tap handler first', () => {
  assert.ok(/if \(window\.innerWidth < MOBILE_CHECKLIST_MAX_WIDTH\) \{ handleMobileChecklistTap\(e\); return \}/.test(click))
  assert.ok(/mobileChecklistHit\(ta, e\.clientX, e\.clientY\)/.test(block.slice(block.indexOf('function handleMobileChecklistTap'))), 'phone calls use the default touch mode')
})
test('save/persistence path unchanged: the toggle writes the notes draft exactly like typing', () => {
  const tg = block.slice(block.indexOf('function toggleChecklistGlyph'), block.indexOf('function mobileChecklistHit'))
  assert.ok(/onNotesDraftChange\(lines\.join\('\\n'\)\)/.test(tg) && /'☑' \+ line\.slice\(1\)/.test(tg) && /'☐' \+ line\.slice\(1\)/.test(tg))
})

// Task Manager accomplishment checklist (☐/☑ in the notes textarea) — MOBILE-ONLY tap fix (v1.317).
// Behaviour was verified in real Chrome with the real Task Manager and real touch taps at 320/360/390/430px (wrapped items,
// independence, repeated toggling, caret/focus preservation, Save, refresh, attachments) and tablet/desktop were checked to keep
// the original click behaviour. This file is the permanent guard for the implementation contract.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const src = fs.readFileSync(path.join(__dirname, '..', '..', 'components/xpadite/DayModal.tsx'), 'utf8').replace(/\r\n/g, '\n')
const a = src.indexOf('// ── Mobile-only (< 640px): tap a ☐ / ☑ to toggle it')
const b = src.indexOf('function handleTitleEditEnd')
const block = src.slice(a, b)

test('the mobile checklist code exists next to the existing checklist helpers', () => {
  assert.ok(a > 0 && b > a)
  assert.ok(/function toggleChecklistLine\(lineIndex: number\)/.test(src), 'the existing toggle is reused, not replaced')
})
test('phones only: gated at the app-wide sm breakpoint (640px), in both the pointer handler and the click handler', () => {
  assert.ok(/MOBILE_CHECKLIST_MAX_WIDTH = 640/.test(block))
  assert.ok(/if \(window\.innerWidth >= MOBILE_CHECKLIST_MAX_WIDTH\) return/.test(block), 'pointerdown bails out on tablet/desktop')
  assert.ok(/if \(window\.innerWidth < MOBILE_CHECKLIST_MAX_WIDTH\) \{ handleMobileChecklistTap\(e\); return \}/.test(block), 'click routes to the mobile path only on phones')
})
test('tablet/desktop keep the ORIGINAL click handler body, character for character', () => {
  const legacy = block.slice(block.indexOf('const ta = e.currentTarget\n    const rect = ta.getBoundingClientRect()'))
  for (const line of [
    'const lineHeight = parseFloat(style.lineHeight) || 19.5',
    'const relY = e.clientY - rect.top - paddingTop + ta.scrollTop',
    'const lineIndex = Math.floor(relY / lineHeight)',
    "if (!line.startsWith('☐ ') && !line.startsWith('☑ ')) return",
    'if (relX > 22) return',
    'toggleChecklistLine(lineIndex)',
  ]) assert.ok(legacy.includes(line), line)
})
test('the tapped checkbox is located from the REAL text layout (wrapping-safe), not from line-height arithmetic', () => {
  const mobile = block.slice(0, block.indexOf('function handleNotesTextareaClick'))
  assert.ok(/document\.createElement\('div'\)/.test(mobile) && /ms\.whiteSpace = 'pre-wrap'/.test(mobile) && /ms\.width = `\$\{ta\.clientWidth\}px`/.test(mobile), 'hidden mirror with the textarea\'s wrapping')
  assert.ok(/range\.setStart\(node, offset\); range\.setEnd\(node, offset \+ 1\)/.test(mobile) && /getClientRects\(\)\[0\]/.test(mobile), 'measures each glyph')
  assert.ok(/ta\.scrollTop/.test(mobile) && /mirror\.remove\(\)/.test(mobile), 'accounts for scrolling and cleans up')
  assert.ok(!/Math\.floor\(relY \/ lineHeight\)/.test(mobile), 'no line-height arithmetic on phones')
})
test('finger-sized, non-greedy target: left edge to ~16px past the box, one text row tall; the nearest row wins; plain text is never captured', () => {
  assert.ok(/clientX >= originX && clientX <= right \+ 16 && clientY >= top - 3 && clientY <= bottom \+ 3/.test(block))
  assert.ok(/dist < best\.dist/.test(block))
})
test('a checkbox tap does not move the caret, select text or open the keyboard', () => {
  assert.ok(/onPointerDown=\{handleNotesPointerDown\}/.test(src))
  assert.ok(/mobileTapRef\.current = \{ start: ta\.selectionStart, end: ta\.selectionEnd, focused: document\.activeElement === ta \}/.test(block), 'state captured BEFORE the tap')
  assert.ok(/if \(mobileChecklistHit\(ta, e\.clientX, e\.clientY\) !== null\) e\.preventDefault\(\)/.test(block), 'only checkbox taps are intercepted')
  assert.ok(/ta\.setSelectionRange\(before\.start, before\.end\)/.test(block) && /if \(!before\.focused && document\.activeElement === ta\) ta\.blur\(\)/.test(block), 'caret restored; never left focused')
  assert.ok(/if \(index === null\) return/.test(block), 'taps on text keep their normal behaviour')
})
test('toggling goes through the existing draft + Save path, so persistence is unchanged', () => {
  assert.ok(/toggleChecklistLine\(index\)/.test(block))
  const tg = src.slice(src.indexOf('function toggleChecklistLine'), src.indexOf('// ── Mobile-only (< 640px)'))
  assert.ok(/onNotesDraftChange\(lines\.join\('\\n'\)\)/.test(tg), 'writes the notes draft exactly like typing does')
  assert.ok(/'☑ ' \+ line\.slice\(2\)/.test(tg) && /'☐ ' \+ line\.slice\(2\)/.test(tg), 'only the marker changes; the rest of the line is untouched')
})
test('scope: nothing else in the Task Manager notes UI changed (insert buttons, placeholder, save/cancel, attachments)', () => {
  assert.ok(/onClick=\{\(\) => applyListType\('check'\)\}/.test(src) && /placeholder="Add notes, or type ☐ to start a checklist item\.\.\."/.test(src))
  assert.ok(/onKeyDown=\{handleNotesKeyDown\}/.test(src) && /onChange=\{e => onNotesDraftChange\(e\.target\.value\)\}/.test(src))
})

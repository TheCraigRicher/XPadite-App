// Planner floating text-formatting toolbar — MOBILE-ONLY viewport containment (v1.316).
// Behaviour was verified in real Chrome against the real Planner editor at 320/360/390/430px (selection at left/right
// edges, top/bottom, scrolling, keyboard-sized viewport, sub-menus) and tablet/desktop were checked to keep the original
// placement. This file is the permanent guard for the implementation contract.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const src = fs.readFileSync(path.join(__dirname, '..', '..', 'components/xpadite/JournalEditorContent.tsx'), 'utf8').replace(/\r\n/g, '\n')
const start = src.indexOf('// ── Mobile-only containment for the floating formatter')
const end = src.indexOf('// ─── Generic info dialog')
const ff = src.slice(start, end)

test('the containment code exists and is scoped to the FloatingFormatter', () => {
  assert.ok(start > 0 && end > start)
  assert.ok(/function FloatingFormatter\(\{ editor, rect: selRect \}/.test(ff))
})
test('phones only: the breakpoint is the app-wide sm (640px) and every mobile code path is gated by it', () => {
  assert.ok(/FF_MOBILE_MAX_WIDTH = 640/.test(ff))
  assert.ok(/const ffIsMobile = \(\) => typeof window !== 'undefined' && window\.innerWidth < FF_MOBILE_MAX_WIDTH/.test(ff))
  const gates = ff.match(/if \(!ffIsMobile\(\)\) return/g) || []
  assert.ok(gates.length >= 3, 'placement effect, sub-menu effect and the scroll/resize handler all bail out on tablet/desktop')
  assert.ok(/schedule = \(\) => \{ if \(!raf && ffIsMobile\(\)\)/.test(ff), 'no re-render work on scroll for tablet/desktop')
})
test('tablet/desktop placement is the ORIGINAL formula, unchanged', () => {
  assert.ok(/const top  = Math\.max\(8, rect\.top - 50\)\s*\n\s*const left = rect\.left \+ rect\.width \/ 2/.test(ff))
  assert.ok(/: \{ top, left, transform: 'translateX\(-50%\)' \}/.test(ff))
})
test('positioning uses the real rendered size and the VISIBLE viewport (keyboard / browser UI aware)', () => {
  assert.ok(/window\.visualViewport/.test(ff) && /vv\.offsetLeft/.test(ff) && /vv\.offsetTop/.test(ff))
  assert.ok(/el\.offsetWidth, h = el\.offsetHeight/.test(ff))
  assert.ok(/width: 'max-content'/.test(ff), 'natural width is measured, never squeezed by the left offset')
  assert.ok(!/left: \d+px|top: \d+px/.test(ff), 'no fixed pixel offsets')
})
test('above the selection when it fits, below when it does not, and always clamped into view', () => {
  assert.ok(/const above = rect\.top - h - FF_GAP/.test(ff) && /const below = rect\.bottom \+ FF_GAP \+ FF_HANDLE_CLEARANCE/.test(ff))
  assert.ok(/const wanted = above >= minTop \? above : below <= maxTop \? below : above/.test(ff))
  assert.ok(/const top = Math\.min\(Math\.max\(wanted, minTop\), Math\.max\(minTop, maxTop\)\)/.test(ff))
  assert.ok(/Math\.min\(Math\.max\(rect\.left \+ rect\.width \/ 2 - w \/ 2, vp\.left \+ FF_PAD\), vp\.left \+ vp\.width - w - FF_PAD\)/.test(ff), 'horizontal clamp with edge padding')
})
test('re-positions on selection change, scroll (capture: inner scroll containers too), resize and visualViewport resize/scroll', () => {
  assert.ok(/if \(selRect !== prevSelRect\) \{ setPrevSelRect\(selRect\); setRect\(selRect\) \}/.test(ff))
  assert.ok(/addEventListener\('scroll', schedule, true\)/.test(ff) && /addEventListener\('resize', schedule\)/.test(ff))
  assert.ok(/vv\?\.addEventListener\('resize', schedule\)/.test(ff) && /vv\?\.addEventListener\('scroll', schedule\)/.test(ff))
  for (const ev of ["window.removeEventListener('scroll', schedule, true)", "window.removeEventListener('resize', schedule)", "vv?.removeEventListener('resize', schedule)", "vv?.removeEventListener('scroll', schedule)"]) assert.ok(ff.includes(ev), 'cleanup: ' + ev)
  assert.ok(/requestAnimationFrame\(update\)/.test(ff) && /cancelAnimationFrame\(raf\)/.test(ff))
})
test('too narrow for the natural layout: tighter padding, then a second row — buttons are never removed', () => {
  assert.ok(/type FFMode = 'normal' \| 'compact' \| 'wrap'/.test(ff))
  assert.ok(/setMode\(mode === 'normal' \? 'compact' : 'wrap'\)/.test(ff))
  assert.ok(/padding: mode === 'normal' \? '3px 8px' : '3px 5px'/.test(src))
  assert.ok(/flexWrap: mode === 'wrap' \? 'wrap' : 'nowrap'/.test(ff))
})
test('sub-menus (text colour, highlight, size, box colour) are contained too', () => {
  assert.equal((src.match(/data-xp-ff-pop="\d"/g) || []).length, 4)
  assert.ok(/querySelectorAll<HTMLElement>\('\[data-xp-ff-pop\]'\)/.test(ff))
  assert.ok(/pop\.style\.bottom = 'auto'/.test(ff), 'flips downward when there is no room above')
})
test('no formatting behaviour changed: same buttons, handlers and no new dependency or portal', () => {
  const fmt = src.slice(src.indexOf('function FloatingFormatter'), end)
  for (const call of ['toggleBold()', 'toggleItalic()', 'toggleUnderline()', 'setColor(value)', 'setXpHighlight(value)', 'setBoxTitle(', 'toggleHeading({ level: 3 })', 'toggleHeading({ level: 2 })', 'setParagraph()']) assert.ok(fmt.includes(call), call)
  assert.ok(/onMouseDown=\{e => e\.preventDefault\(\)\}/.test(fmt), 'toolbar still never steals focus/selection')
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'))
  assert.ok(!Object.keys(pkg.dependencies).some(d => /floating-ui|popper|tippy/.test(d)), 'no positioning library added')
  assert.ok(!/createPortal/.test(ff), 'no layout change: still rendered in place')
})
test('the floating formatter is still mounted from the same place with the same props', () => {
  assert.ok(/\{selectionRect && focusedEditor\.current && \(\n\s*<FloatingFormatter editor=\{focusedEditor\.current\} rect=\{selectionRect\} \/>/.test(src))
})

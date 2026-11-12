// v1.334 — tablet modal refinement: pins the opt-in markers, the tablet media query and that nothing else (phone / desktop rules) was touched.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ROOT = path.resolve(__dirname, '..', '..')
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join('\n')
const C = 'components/xpadite/'

test('tablet = touch-first (pointer: coarse), 640-1400px wide, >=560px tall: phones, mouse windows and desktops are outside it', () => {
  const css = read('app/globals.css')
  const i = css.indexOf('@media (pointer: coarse) and (min-width: 640px) and (max-width: 1400px) and (min-height: 560px) {')
  assert.ok(i > 0, 'the tablet media query exists')
  const block = css.slice(i)
  assert.equal((css.match(/pointer: coarse\) and \(min-width: 640px\)/g) ?? []).length, 1, 'one tablet definition, not several competing ones')
  for (const sel of ['.xp-tab-overlay', '.xp-tab-shell', '.xp-tab-hide-activity-btns']) assert.ok(block.includes(sel), sel)
  assert.match(block, /height: 100dvh !important/); assert.match(block, /env\(safe-area-inset-top/); assert.match(block, /border-radius: 0 !important/)
  assert.match(block, /overscroll-behavior: contain/)
  // everything the tablet block adds is inside that one media query: nothing unconditional about the markers
  assert.ok(!css.slice(0, css.indexOf('/* ── Tablet modals (v1.334)')).includes('xp-tab-'), 'no xp-tab rule outside the tablet query')
})

test('every listed modal opts in (overlay + card); the main calendar strip is marked for tablet-only hiding', () => {
  const need = {
    'MeetingsModal.tsx': [1, 1], 'JournalWorkspaceModal.tsx': [2, 2], 'AnalyticsModal.tsx': [5, 5], 'GalleryModal.tsx': [1, 1],
    'AICoachPage.tsx': [1, 1], 'HelpFeedbackModal.tsx': [1, 1], 'SyncModal.tsx': [1, 1], 'GoalManagerModal.tsx': [1, 1],
  }
  for (const [f, [o, s]] of Object.entries(need)) {
    const t = read(C + f)
    assert.equal((t.match(/xp-tab-overlay/g) ?? []).length, o, f + ' overlay'); assert.equal((t.match(/xp-tab-shell/g) ?? []).length, s, f + ' shell')
  }
  const app = read(C + 'XpaditeApp.tsx')
  assert.match(app, /className="hidden sm:block lg:hidden xp-tab-hide-activity-btns">\s*<ActivityButtons \/>/)
})

test('phone and desktop code paths are untouched: the original responsive classes are all still present', () => {
  assert.match(read(C + 'GoalManagerModal.tsx'), /fixed inset-x-0 top-0 bottom-14 sm:inset-0 z-50 flex flex-col sm:flex-row sm:items-start sm:justify-center sm:overflow-y-auto sm:p-3 sm:pt-4/)
  assert.match(read(C + 'SyncModal.tsx'), /w-full sm:max-w-\[560px\] h-full sm:h-auto sm:max-h-\[86vh\] rounded-none sm:rounded-2xl/)
  assert.match(read(C + 'HelpFeedbackModal.tsx'), /sm:max-w-\[880px\] h-full sm:h-\[86vh\]/)
  assert.match(read(C + 'GalleryModal.tsx'), /sm:max-w-\[1120px\] h-full sm:h-\[88vh\]/)
  assert.match(read(C + 'MeetingsModal.tsx'), /sm:h-\[calc\(100dvh-28px\)\] sm:max-w-\[640px\] md:max-w-\[900px\] lg:max-w-\[1296px\]/)
  assert.match(read('app/globals.css'), /@media \(max-width: 639px\) \{\s*\/\* Propagate tokens to the whole AI Coach overlay on mobile \*\//)
})

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
  assert.equal((css.match(/pointer: coarse\) and \(min-width: 640px\) and \(max-width: 1400px\)/g) ?? []).length, 1, 'one tablet definition, not several competing ones')
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

test('v1.335: the Expandable Month modal opts in; Mind Mapping from the main menu closes back to the main app, from the Planner back to the editor', () => {
  const m = read(C + 'MonthFullPage.tsx')
  assert.match(m, /'fixed inset-0 z-50 overflow-y-auto xp-mfp-overlay xp-tab-overlay'/); assert.match(m, /'w-full rounded-2xl xp-mfp-box xp-tab-shell'/)
  const css = read('app/globals.css'); assert.match(css, /\.xp-tab-overlay \.xp-mfp-wrap \{[^}]*padding: 0 !important/)
  // the request records the entry point (existing request/clear flow, no new navigation state)
  const ctx = read(C + 'AppContext.tsx')
  assert.match(ctx, /mindMapRequest: \{ dateKey: string; nonce: number; closeOnExit: boolean \} \| null/); assert.match(ctx, /requestMindMap = useCallback\(\(dateKey: string, closeOnExit = false\)/)
  assert.match(read(C + 'XpaditeApp.tsx'), /requestMindMap\(today, !\(journalNotesOpen \|\| mobileTab === 'planner'\)\)/)
  const ed = read(C + 'JournalEditorContent.tsx')
  assert.match(ed, /exitToMainRef\.current = mindMapRequest\.closeOnExit; setDrawState/)
  assert.match(ed, /const toMain = exitToMainRef\.current; exitToMainRef\.current = false\s*\n\s*setDrawState\(null\); setMmcFit\(false\)\s*\n\s*if \(toMain\) guardedNavigate\(onClose\)/)
  assert.ok(!/exitToMainRef\.current = true/.test(ed), 'the Planner button path never sets it, so it keeps returning to the editor')
})

test('v1.336 — analytics dashboards: their body is the single tablet scroller (marker + CSS), for Day, Week, embedded Month and Year', () => {
  for (const f of ['DayFullPage.tsx', 'WeekFullPage.tsx', 'YearFullPage.tsx']) assert.match(read(C + f), /sm:flex-none sm:overflow-visible xp-tab-body"/, f)
  assert.match(read(C + 'MonthFullPage.tsx'), /embedded \? 'flex-1 overflow-y-auto sm:flex-none sm:overflow-visible xp-tab-body' : undefined/)
  const css = read('app/globals.css'); const i = css.indexOf('@media (pointer: coarse) and (min-width: 640px)')
  const rule = css.slice(i).match(/\.xp-tab-shell \.xp-tab-body \{[^}]*\}/)
  assert.ok(rule, 'rule is inside the tablet media query'); assert.match(rule[0], /overflow-y: auto !important/); assert.match(rule[0], /min-height: 0 !important/)
  assert.ok(!css.slice(0, i).includes('xp-tab-body'), 'nothing outside the tablet query')
})

test('v1.337 — dashboard card pairing is tablet-portrait only: 5 markers per dashboard, every rule inside one narrower-than-lg tablet query', () => {
  for (const f of ['DayFullPage.tsx', 'WeekFullPage.tsx', 'YearFullPage.tsx', 'MonthFullPage.tsx']) {
    const s = read(C + f)
    for (const m of ['xp-td-dash', 'xp-td-r1', 'xp-td-gg', 'xp-td-r2', 'xp-td-r3']) assert.equal((s.match(new RegExp(m + '"', 'g')) ?? []).length, 1, f + ' ' + m)
    // the original responsive classes are all still there (phone / desktop paths untouched)
    assert.ok(s.includes('grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 lg:gap-4 xp-td-r3"'), f + ' row 3 keeps lg:grid-cols-3')
    assert.ok(s.includes('lg:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)] items-stretch gap-3 lg:gap-4 xp-td-r2"'), f + ' row 2 keeps its lg columns')
  }
  const css = read('app/globals.css'); const q = '@media (pointer: coarse) and (min-width: 640px) and (max-width: 1023px) and (min-height: 560px) {'
  const i = css.indexOf(q); assert.ok(i > 0, 'portrait tablet query exists')
  assert.equal(css.split('xp-td-dash').length - 1, css.slice(i).split('xp-td-dash').length - 1, 'every xp-td rule is inside it')
  const block = css.slice(i, css.indexOf('\n}\n', i))
  assert.match(block, /\.xp-td-dash \{ display: grid; grid-template-columns: repeat\(2/)
  assert.match(block, /\.xp-td-r3 > :nth-child\(1\) \{ order: 4/); assert.match(block, /\.xp-td-r3 > :nth-child\(3\) \{ order: 8/)
  assert.equal((css.match(/max-width: 1023px\) and \(min-height: 560px\)/g) ?? []).length, 1)
})

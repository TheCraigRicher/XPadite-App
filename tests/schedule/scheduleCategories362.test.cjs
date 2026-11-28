// v1.362 — My Schedule category expansion. The REAL scheduleLogic / scheduleEngine modules are compiled and run; wiring is pinned structurally.
// Nothing here touches a database (the built-in categories are code constants; only custom categories are ever stored).
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const ROOT = path.resolve(__dirname, '..', '..')
const OUT = path.join(ROOT, 'node_modules', '.cache', 'xpadite-categories-v1362'); fs.mkdirSync(OUT, { recursive: true })
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').split(String.fromCharCode(13, 10)).join('\n')
for (const n of ['scheduleLogic', 'scheduleEngine', 'zdate', 'dueStatus', 'deadlineLink', 'dueSync']) {
  try { fs.writeFileSync(path.join(OUT, n + '.js'), ts.transpileModule(read(`components/xpadite/${n}.ts`), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText.replace(/require\("@\/components\/xpadite\/([A-Za-z]+)"\)/g, 'require("./$1")')) } catch { /* optional */ }
}
const L = require(path.join(OUT, 'scheduleLogic.js'))
const E = require(path.join(OUT, 'scheduleEngine.js'))
const by = id => L.SCHEDULE_CATEGORIES.find(c => c.id === id)
const at = (y, m, d, h = 0) => new Date(y, m - 1, d, h).getTime()
const IDS = L.SCHEDULE_CATEGORIES.map(c => c.id)

test('final palette: names, order, ids and colours are exactly as specified; the six originals are untouched', () => {
  assert.deepEqual(IDS, ['lecture', 'meeting', 'assignment', 'test', 'study', 'personal', 'other', 'urgent', 'appointment', 'work'])
  assert.deepEqual(L.SCHEDULE_CATEGORIES.map(c => c.label), ['Lecture / Class', 'Meeting', 'Assignment', 'Test', 'Study / Focus', 'Personal', 'Other', 'Urgent / Priority', 'Appointment', 'Work'])
  assert.ok(L.SCHEDULE_CATEGORIES.every(c => c.builtIn === true))
  const orig = { lecture: ['#e4d4fb', '#a78bfa', '#4c1d95'], meeting: ['#bff5d9', '#34d399', '#065f46'], assignment: ['#fbd3ea', '#f472b6', '#831843'], study: ['#c3e2fb', '#60a5fa', '#1e3a8a'], personal: ['#fbf6a8', '#e0b81a', '#713f12'], other: ['#fddbae', '#fb923c', '#7c2d12'] }
  for (const [id, v] of Object.entries(orig)) assert.deepEqual([by(id).bg, by(id).edge, by(id).text], v, id + ' colours unchanged')
  assert.deepEqual([by('test').bg, by('test').edge, by('test').text], ['#f3e3c9', '#b87916', '#80500b'])
  assert.deepEqual([by('urgent').bg, by('urgent').edge, by('urgent').text], ['#ffdada', '#ff0000', '#b91c1c'])
  assert.deepEqual([by('appointment').bg, by('appointment').edge, by('appointment').text], ['#ccfff9', '#00ffe6', '#007d72'])
  assert.deepEqual([by('work').bg, by('work').edge, by('work').text], ['#d6deff', '#002fff', '#0025ba'])
  assert.equal(new Set(L.SCHEDULE_CATEGORIES.map(c => c.edge)).size, 10); assert.equal(new Set(IDS).size, 10)
})

test('event text stays readable on every translucent background (WCAG ≥ 4.5:1)', () => {
  const lum = h => { const n = parseInt(h.slice(1), 16); const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(n >> 16 & 255) + 0.7152 * f(n >> 8 & 255) + 0.0722 * f(n & 255) }
  for (const c of L.SCHEDULE_CATEGORIES) { const [a, b] = [lum(c.bg), lum(c.text)].sort((x, y) => y - x); assert.ok((a + 0.05) / (b + 0.05) >= 4.5, c.id) }
})

test('backward compatibility: an existing "assignment" event keeps its id/data and now shows as Assignment; unknown ids still fall back to Other (not to the last item)', () => {
  const legacy = { id: 'e1', title: 'Essay', category: 'assignment', startAt: at(2026, 12, 1, 9), endAt: at(2026, 12, 1, 10) }
  assert.equal(L.categoryMeta(legacy.category).label, 'Assignment'); assert.equal(L.categoryMeta(legacy.category).edge, '#f472b6')
  assert.equal(legacy.category, 'assignment', 'never reclassified as Test')
  assert.equal(L.categoryMeta('no-such-category').id, 'other')
  assert.equal(L.categoryMeta('work').label, 'Work')
})

test('each new category filters independently (events, All, and the checkbox view)', () => {
  const evs = ['test', 'urgent', 'appointment', 'work', 'assignment', 'meeting'].map((c, i) => ({ id: 'e' + i, title: c, category: c, startAt: 1 + i, endAt: 2 + i }))
  for (const c of ['test', 'urgent', 'appointment', 'work']) {
    assert.deepEqual(L.filterScheduleEvents(evs, { query: '', category: c, source: 'all', hidden: [], categories: L.SCHEDULE_CATEGORIES }).map(e => e.category), [c])
    const hid = L.filterScheduleEvents(evs, { query: '', category: 'all', source: 'all', hidden: [c], categories: L.SCHEDULE_CATEGORIES }).map(e => e.category)
    assert.equal(hid.length, 5); assert.ok(!hid.includes(c))
  }
  const st = E.toggleCategoryVisible({ filter: 'all', hidden: [], hiddenSources: [] }, 'urgent'); assert.deepEqual(st.hidden, ['urgent'])
  assert.deepEqual(E.toggleCategoryVisible(st, 'urgent').hidden, [])
  assert.deepEqual(L.filterOptions(L.SCHEDULE_CATEGORIES).map(o => o.value), ['all', ...IDS, 'google', 'microsoft'])
})

test('visibility defaults: nothing is hidden at start (the hidden list is in-memory only), so existing users see the new categories', () => {
  const src = read('components/xpadite/MeetingsModal.tsx')
  assert.match(src, /useState<ScheduleCategoryId\[\]>\(\[\]\)/, 'hidden starts empty')
  assert.ok(!/localStorage[^\n]*hidden|hidden[^\n]*localStorage/i.test(src), 'hidden categories are never persisted')
})

test('Copy, Paste and Duplicate keep each new category; recurrence is kept', () => {
  for (const c of ['test', 'urgent', 'appointment', 'work', 'assignment']) {
    const ev = { id: 'o', title: 'X', category: c, startAt: at(2026, 12, 15, 14), endAt: at(2026, 12, 15, 15), recurrence: 'weekly', reminderMins: 10, reminderAlarm: true }
    const clip = E.copyEventClip(ev); assert.equal(clip.category, c)
    const pasted = E.pasteFromClip(clip, at(2026, 12, 20, 9), 'n', IDS)
    assert.equal(pasted.category, c); assert.equal(pasted.recurrence, 'weekly'); assert.equal(pasted.reminderAlarm, true)
    assert.equal(E.duplicateFormValues(ev, []).category, c)
  }
})

test('Urgent / Priority is purely visual: choosing it creates no deadline, reminder, alarm or Task Manager priority', () => {
  for (const f of ['components/xpadite/scheduleLogic.ts', 'components/xpadite/scheduleEngine.ts', 'components/xpadite/deadlineLink.ts', 'components/xpadite/scheduleContext.ts']) {
    assert.ok(!/['"]urgent['"]/.test(read(f).replace(/\{ id: 'urgent'[^\n]*\n/, '').replace(/'urgent' \| /, '')), f + ' has no special handling of the urgent id')
  }
  const ev = E.pasteFromClip(E.copyEventClip({ id: 'o', title: 'U', category: 'urgent', startAt: 1_000_000_000_000, endAt: 1_000_003_600_000 }), 1_000_000_000_000, 'n', IDS)
  assert.ok(!ev.isDeadline && ev.reminderMins === null && !ev.reminderAlarm)
})

test('no database migration, server code or dependency change; custom categories stay unaffected and still protected', () => {
  assert.ok(!fs.readdirSync(path.join(ROOT, 'supabase/migrations')).some(f => /^0(29|3\d)/.test(f)), 'no new migration')
  assert.match(read('lib/supabase/schedule-data.ts'), /!c\.builtIn/, 'only custom categories are stored')
  const pkg = JSON.parse(read('package.json')); assert.equal(pkg.version, '0.1.0')
  const r = E.renameCategory(L.SCHEDULE_CATEGORIES, 'work', 'Job'); assert.equal(r.ok, false)
  const custom = E.addCategory(L.SCHEDULE_CATEGORIES, 'Gym', '#123456', 'cat-gym'); assert.equal(custom.ok, true)
  assert.equal(E.addCategory(L.SCHEDULE_CATEGORIES, 'work', '#123456', 'x').ok, false, 'a new custom category cannot reuse a built-in name (incl. the new ones)')
  assert.equal(E.addCategory(L.SCHEDULE_CATEGORIES, 'Red', '#FF0000', 'x').ok, false, 'nor a built-in colour')
})

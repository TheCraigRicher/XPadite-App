// My Schedule — Month View: pure logic (components/xpadite/scheduleMonth.ts, real module) + structural/independence checks.
// Nothing here touches Supabase: Month View is another view of the same in-memory events.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const ROOT = path.resolve(__dirname, '..', '..')
const OUT = path.join(ROOT, 'node_modules', '.cache', 'xpadite-month'); fs.mkdirSync(OUT, { recursive: true })
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join('\n')
const compile = f => fs.writeFileSync(path.join(OUT, f + '.js'), ts.transpileModule(read(`components/xpadite/${f}.ts`), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText)
compile('scheduleLogic'); compile('scheduleMonth')
const L = require(path.join(OUT, 'scheduleLogic.js'))
const M = require(path.join(OUT, 'scheduleMonth.js'))

const at = (y, m, d, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi).getTime()
const ev = (id, s, e, extra = {}) => ({ id, title: id, category: 'meeting', startAt: s, endAt: e, ...extra })
const flat = g => g.flat().map(c => c.key)

// ── grid shape ──
test('every month shows 5 or 6 full rows of 7 consecutive real dates (Sun-first)', () => {
  for (let y = 2024; y <= 2030; y++) for (let m = 0; m < 12; m++) {
    const w = M.monthGridWeeks(new Date(y, m, 1), 0)
    assert.ok(w.length === 5 || w.length === 6, `${y}-${m + 1}: ${w.length} rows`)
    for (const row of w) { assert.equal(row.length, 7); assert.equal(row[0].getDay(), 0) }
    const all = w.flat()
    for (let i = 1; i < all.length; i++) assert.equal(M.dateKey(all[i]) > M.dateKey(all[i - 1]), true, 'strictly increasing, no repeats/skips across DST')
    const days = all.filter(d => d.getMonth() === m).length
    assert.equal(days, new Date(y, m + 1, 0).getDate(), `${y}-${m + 1}: every day of the month appears once`)
  }
})

test('a 4-week February (2026 starts on a Sunday, 28 days) is padded to 5 rows; Monday-first also works', () => {
  assert.equal(L.monthWeeks(new Date(2026, 1, 1), 0).length, 4)
  assert.equal(M.monthGridWeeks(new Date(2026, 1, 1), 0).length, 5)
  const mon = M.monthGridWeeks(new Date(2026, 10, 1), 1)
  assert.ok(mon.every(r => r[0].getDay() === 1))
})

test('leap years: Feb 2028 has the 29th, Feb 2027 / 2100 do not', () => {
  const k = y => flat(M.buildMonthGrid([], new Date(y, 1, 1), new Date(y, 1, 1)))
  assert.ok(k(2028).includes('2028-02-29')); assert.ok(!k(2027).includes('2027-02-29')); assert.ok(!k(2100).includes('2100-02-29'))
  const cells = M.buildMonthGrid([], new Date(2028, 1, 1), new Date(2028, 1, 1)).flat()
  assert.equal(cells.filter(c => c.inMonth).length, 29)
})

test('month navigation never skips or repeats a month (Jan 31 → Feb, Dec → Jan, Jan → Dec) and rolls years', () => {
  let m = new Date(2026, 11, 1)
  m = M.shiftMonthStart(m, 1); assert.equal(`${m.getFullYear()}-${m.getMonth() + 1}`, '2027-1')
  m = M.shiftMonthStart(m, -1); assert.equal(`${m.getFullYear()}-${m.getMonth() + 1}`, '2026-12')
  let x = new Date(2026, 0, 1); const seen = []
  for (let i = 0; i < 26; i++) { seen.push(`${x.getFullYear()}-${x.getMonth() + 1}`); x = M.shiftMonthStart(x, 1) }
  assert.equal(new Set(seen).size, 26)
  assert.equal(seen[12], '2027-1'); assert.equal(seen[25], '2028-2')
  // the existing week-view helper (used by the toolbar arrows) clamps Jan 31 correctly as well
  const jan31 = L.shiftMonth(new Date(2027, 0, 31), 1); assert.equal(`${jan31.getMonth() + 1}/${jan31.getDate()}`, '2/28')
  const leap = L.shiftMonth(new Date(2028, 0, 31), 1); assert.equal(`${leap.getMonth() + 1}/${leap.getDate()}`, '2/29')
})

test('today is flagged exactly once; overflow days are not in-month', () => {
  const g = M.buildMonthGrid([], new Date(2026, 10, 1), new Date(2026, 10, 7, 15), 0).flat()
  assert.equal(g.filter(c => c.isToday).length, 1); assert.equal(g.find(c => c.isToday).key, '2026-11-07')
  assert.equal(g[0].key, '2026-11-01'); assert.equal(g[0].inMonth, true)
  assert.equal(g[g.length - 1].inMonth, false); assert.equal(g[g.length - 1].key, '2026-12-05')
  const none = M.buildMonthGrid([], new Date(2026, 10, 1), new Date(2027, 5, 1)).flat()
  assert.equal(none.filter(c => c.isToday).length, 0)
})

// ── events on dates ──
test('events sit on their own date, chronologically, with overlaps as separate entries', () => {
  const evs = [ev('late', at(2026, 11, 7, 15), at(2026, 11, 7, 16)), ev('a', at(2026, 11, 7, 9), at(2026, 11, 7, 10)), ev('b', at(2026, 11, 7, 9, 30), at(2026, 11, 7, 11)), ev('other', at(2026, 11, 8, 9), at(2026, 11, 8, 10))]
  const c = M.buildMonthGrid(evs, new Date(2026, 10, 1), new Date(2026, 10, 7)).flat().find(x => x.key === '2026-11-07')
  assert.deepEqual(c.events.map(e => e.id), ['a', 'b', 'late'])
})

test('multi-day events appear on every day they cover, once per day, never duplicated', () => {
  const trip = ev('trip', at(2026, 11, 5, 22), at(2026, 11, 7, 2))
  const g = M.buildMonthGrid([trip], new Date(2026, 10, 1), new Date(2026, 10, 1)).flat()
  assert.deepEqual(g.filter(c => c.events.length).map(c => c.key), ['2026-11-05', '2026-11-06', '2026-11-07'])
  assert.ok(g.every(c => new Set(c.events.map(e => e.id)).size === c.events.length))
  assert.deepEqual(M.multiDayPosition(trip, new Date(2026, 10, 5)), { fromEarlier: false, intoLater: true })
  assert.deepEqual(M.multiDayPosition(trip, new Date(2026, 10, 6)), { fromEarlier: true, intoLater: true })
  assert.deepEqual(M.multiDayPosition(trip, new Date(2026, 10, 7)), { fromEarlier: true, intoLater: false })
  // a continuing event sorts as if it began at midnight, ahead of a 1 AM event
  const one = ev('one', at(2026, 11, 7, 1), at(2026, 11, 7, 2))
  assert.deepEqual(M.monthDayEvents([one, trip], new Date(2026, 10, 7)).map(e => e.id), ['trip', 'one'])
})

test('an event ending exactly at midnight does not leak onto the next day; zero-length events are ignored (same rule as the week grid)', () => {
  const e = ev('x', at(2026, 11, 7, 23), at(2026, 11, 8, 0))
  assert.equal(M.monthDayEvents([e], new Date(2026, 10, 8)).length, 0); assert.equal(M.monthDayEvents([e], new Date(2026, 10, 7)).length, 1)
  assert.equal(M.monthDayEvents([ev('z', at(2026, 11, 7, 9), at(2026, 11, 7, 9))], new Date(2026, 10, 7)).length, 0)
})

test('recurring events are shown exactly as the production model stores them (one occurrence; no expansion invented here)', () => {
  const r = ev('r', at(2026, 11, 2, 9), at(2026, 11, 2, 10), { recurrence: 'weekly' })
  const g = M.buildMonthGrid([r], new Date(2026, 10, 1), new Date(2026, 10, 1)).flat()
  assert.equal(g.reduce((n, c) => n + c.events.length, 0), 1)
})

test('local-day keys are stable in DST-change months (no off-by-one from 23/25-hour days)', () => {
  for (const [y, m] of [[2026, 3], [2026, 11], [2027, 3], [2027, 11]]) {
    const cells = M.buildMonthGrid([ev('e', at(y, m, 15, 12), at(y, m, 15, 13))], new Date(y, m - 1, 1), new Date(y, m - 1, 15)).flat()
    assert.equal(cells.filter(c => c.events.length).map(c => c.key)[0], `${y}-${String(m).padStart(2, '0')}-15`)
    assert.equal(new Set(cells.map(c => c.key)).size, cells.length)
  }
})

// ── overflow ──
test('chip capacity: always shows at least one event; "+N more" takes one slot and counts the hidden remainder', () => {
  assert.deepEqual(M.chipCapacity(0, 3), { shown: 0, more: 0 })
  assert.deepEqual(M.chipCapacity(3, 3), { shown: 3, more: 0 })
  assert.deepEqual(M.chipCapacity(5, 3), { shown: 2, more: 3 })
  assert.deepEqual(M.chipCapacity(5, 1), { shown: 1, more: 4 })
  assert.deepEqual(M.chipCapacity(5, 0.2), { shown: 1, more: 4 })
  for (let total = 1; total < 30; total++) for (let fits = 0; fits < 8; fits++) { const c = M.chipCapacity(total, fits); assert.equal(c.shown + c.more, total); assert.ok(c.shown >= 1) }
})

// ── last-view preference ──
test('view preference parsing accepts only the three views; storage failures never throw', () => {
  assert.equal(M.parseViewPref('month'), 'month'); assert.equal(M.parseViewPref('today'), 'today'); assert.equal(M.parseViewPref('schedule'), 'schedule')
  for (const bad of ['', 'Month', 'week', null, undefined, 3, {}, '__proto__']) assert.equal(M.parseViewPref(bad), null)
  global.window = { localStorage: { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') } } }
  assert.equal(M.readViewPref(), null); assert.doesNotThrow(() => M.writeViewPref('month'))
  const store = {}; global.window = { localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v } } }
  M.writeViewPref('month'); assert.equal(M.readViewPref(), 'month'); assert.equal(store[M.VIEW_PREF_KEY], 'month')
  delete global.window
})

// ── structure: wiring, layout and independence from the v1.328 backend work ──
test('Month tab is the third tab, right of Today, with the same tab styling, and Add Event + menu stay in place', () => {
  const m = read('components/xpadite/MeetingsModal.tsx')
  const tabs = m.slice(m.indexOf('const TABS'), m.indexOf('// ── Meeting detail'))
  assert.ok(tabs.indexOf("key: 'schedule'") < tabs.indexOf("key: 'today'") && tabs.indexOf("key: 'today'") < tabs.indexOf("key: 'month'"))
  assert.match(tabs, /label: \(\) => 'Month'/)
  const row = m.slice(m.indexOf('{/* Tabs + the one Add Event button'), m.indexOf('{/* Body */}'))
  assert.ok(row.indexOf('TABS.map') < row.indexOf('aria-label="Add Event"') && row.indexOf('aria-label="Add Event"') < row.indexOf('<ScheduleMenu'))
  assert.equal((row.match(/TABS\.map/g) || []).length, 1, 'one tab row, no extra toolbar row')
  assert.match(row, /background: tab === t\.key \? '#7c3aed'/)
  assert.match(row, /px-2 sm:px-4/, 'phone: the first row shares the calendar container left/right edge (8px)')
  assert.ok(!/-m[lrx]-|margin(Left|Right): -/.test(row), 'no negative-margin hacks')
  assert.match(m, /mode=\{tab === 'month' \? 'month' : 'week'\}/)
})

test('filters, month and selected date are owned by the modal / survive tab switches', () => {
  const m = read('components/xpadite/MeetingsModal.tsx'), v = read('components/xpadite/MyScheduleView.tsx')
  assert.match(m, /schedAnchor/); assert.match(m, /schedSelDay/)
  assert.ok(!/useState\(\(\) => startOfDay\(new Date\(\)\)\)/.test(v.slice(v.indexOf('export function MyScheduleView'), v.indexOf('export function MyScheduleView') + 1200)), 'anchor is no longer private to the view')
  assert.ok(/if \(t\.key === 'today' \|\| tab === 'today'\) setWeekSelId\(null\)/.test(m), 'My Schedule ↔ Month keeps the selection')
})

test('empty-date click re-uses the EXISTING add form (onAddAt) — no second form exists', () => {
  const v = read('components/xpadite/MyScheduleView.tsx'), g = read('components/xpadite/ScheduleMonthGrid.tsx')
  assert.match(v, /else onAddAt\(cell\.date, 9 \* 60\)/); assert.match(v, /onAdd=\{d => \{ setDaySheet\(null\); onAddAt\(d, 9 \* 60\) \}\}/)
  assert.ok(!/EventForm|<form/.test(g), 'the month files never define their own form')
})

test('Month View is frontend-only: no Supabase, RPC, migration, billing or v1.328 sync dependency in any file it adds or changes', () => {
  const files = ['scheduleMonth.ts', 'ScheduleMonthGrid.tsx', 'MyScheduleView.tsx', 'MeetingsModal.tsx']
  const forbidden = /supabase|\.rpc\(|schedule_apply|calendar_day_save|schedule_set_sync|schedule_events|schedule-data|dayMerge|deadlineLink|DayConflict|DeadlineMark|taskSync|stripe|fetch\(/i
  for (const f of files) { const s = read(`components/xpadite/${f}`).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); assert.ok(!forbidden.test(s), `${f} must not reference ${s.match(forbidden)}`) }
  assert.ok(!fs.readdirSync(path.join(ROOT, 'supabase/migrations')).some(n => /^02[2-9]_/.test(n)), 'no 022+ migrations on this branch')
})

test('accessibility + motion hooks: grid roles, labelled cells, focus rings, reduced motion', () => {
  const g = read('components/xpadite/ScheduleMonthGrid.tsx')
  for (const s of ['role="grid"', 'role="gridcell"', 'role="columnheader"', 'aria-label={label}', ':focus-visible', 'prefers-reduced-motion', 'aria-pressed', "e.key === 'Enter'"]) assert.ok(g.includes(s), s)
  assert.ok(!/#[0-9a-f]{6}/i.test(g.replace(/#7c3aed/gi, '').replace(/#ffffff/gi, '')), 'only the existing purple/white + category/CSS-variable colours — no new palette')
})

// ── month picker dropdown (Week + Month views) ──
test('pickMonthAnchor: day-of-month clamps like the arrows; week view keeps the weekday inside the chosen month', () => {
  const sat = new Date(2026, 10, 7)                                               // Sat Nov 7 2026
  const dec = M.pickMonthAnchor(sat, 2026, 11, false); assert.equal(`${dec.getMonth() + 1}/${dec.getDate()}`, '12/7')
  const decW = M.pickMonthAnchor(sat, 2026, 11, true); assert.equal(decW.getDay(), 6); assert.equal(decW.getMonth(), 11); assert.equal(decW.getDate(), 5)
  const feb = M.pickMonthAnchor(new Date(2027, 0, 31), 2027, 1, false); assert.equal(`${feb.getMonth() + 1}/${feb.getDate()}`, '2/28')
  const leap = M.pickMonthAnchor(new Date(2027, 0, 31), 2028, 1, false); assert.equal(`${leap.getMonth() + 1}/${leap.getDate()}`, '2/29')
  for (let y = 2025; y <= 2030; y++) for (let m = 0; m < 12; m++) for (const d of [1, 15, 28, 29, 30, 31]) {
    const a = new Date(2026, 5, Math.min(d, 30)); const r = M.pickMonthAnchor(a, y, m, true)
    assert.equal(r.getMonth(), m); assert.equal(r.getFullYear(), y); assert.equal(r.getDay(), a.getDay())
    const r2 = M.pickMonthAnchor(a, y, m, false); assert.equal(r2.getMonth(), m)
  }
})

test('month picker: only the center label is the trigger; arrows, Today and layout wiring untouched; Today+Filter grouped only for phone Month View', () => {
  const v = read('components/xpadite/MyScheduleView.tsx'), p = read('components/xpadite/ScheduleMonthPicker.tsx')
  assert.equal((v.match(/picker=\{monthPicker\}/g) || []).length, 2, 'phone + tablet/desktop month NavGroups (the week-range NavGroups get none)')
  assert.ok(!/Previous week[^\n]*picker=|picker=[^\n]*Next week/.test(v))
  assert.match(v, /onPrev=\{\(\) => setAnchor\(a => shiftMonth\(a, -1\)\)\} onNext=\{\(\) => setAnchor\(a => shiftMonth\(a, 1\)\)\}/, 'month arrows keep their existing handlers')
  assert.match(v, /\{month \? <div className="flex items-center gap-0\.5 min-\[361px\]:gap-1">\{phoneTodayFilter\}<\/div> : phoneTodayFilter\}/)
  assert.ok(/12/.test(p) && /grid-cols-3/.test(p) && /role="dialog"/.test(p) && /LAYER_ATTR/.test(p) && /key === 'Escape'/.test(p) && /pointerdown/.test(p) && /prefers-reduced-motion/.test(p) && /aria-pressed/.test(p))
  assert.ok(!/supabase|fetch\(|\.rpc\(|localStorage/i.test(p), 'presentation only')
})

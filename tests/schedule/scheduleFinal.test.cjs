// My Schedule — final frontend refinement: cross-midnight events, 12/24-hour time entry, and the phone-only toolbar.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { spawnSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..', '..')
const OUT = path.join(ROOT, 'node_modules', '.cache', 'xpadite-schedule-final'); fs.mkdirSync(OUT, { recursive: true })
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join('\n')
const compile = f => fs.writeFileSync(path.join(OUT, f + '.js'), ts.transpileModule(read(`components/xpadite/${f}.ts`), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText)
compile('scheduleLogic'); compile('scheduleEngine')
const L = require(path.join(OUT, 'scheduleLogic.js'))
const E = require(path.join(OUT, 'scheduleEngine.js'))

// DST can't be tested by changing process.env.TZ mid-run (ignored on Windows), so these run in a child Node started in a real DST zone.
function inLA(body) {
  const src = `const L=require(${JSON.stringify(path.join(OUT, 'scheduleLogic.js'))}),E=require(${JSON.stringify(path.join(OUT, 'scheduleEngine.js'))});const ev=(id,s,e)=>({id,title:id,category:'meeting',startAt:s,endAt:e});console.log(JSON.stringify((()=>{${body}})()))`
  const r = spawnSync(process.execPath, ['-e', src], { env: { ...process.env, TZ: 'America/Los_Angeles' }, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout)
}
const at = (y, m, d, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi).getTime()
const ev = (id, s, e, x = {}) => ({ id, title: id, category: 'meeting', startAt: s, endAt: e, ...x })
const form = (o = {}) => ({ title: 'T', date: '2026-11-04', endDate: '2026-11-04', start: '10:00', end: '11:00', category: 'meeting', location: '', meetingUrl: '', notes: '', reminderMins: null, recurrence: 'none', ...o })

// ── Task 1: cross-midnight ──────────────────────────────────────────────────
test('overnight example from the brief: Nov 4 10:00 PM → Nov 5 1:30 AM validates, 3 h 30 min, no "end must be after start"', () => {
  const f = form({ start: '22:00', end: '01:30', endDate: '2026-11-05' })
  assert.deepEqual(L.validateScheduleForm(f), {})
  const fields = L.formToEventFields(f)
  assert.equal(fields.startAt, at(2026, 11, 4, 22)); assert.equal(fields.endAt, at(2026, 11, 5, 1, 30))
  assert.equal(L.durationLabel(fields.startAt, fields.endAt), '3 hr 30 min')
})
test('without an end date, an earlier end time is still an error — with a hint to use "Ends on a different day"', () => {
  const e = L.validateScheduleForm(form({ start: '22:00', end: '01:30', endDate: '2026-11-04' })).end
  assert.match(e, /Ends on a different day/)
  assert.ok(L.validateScheduleForm(form({ start: '22:00', end: '01:30', endDate: '' })).end, 'a missing end date behaves like the start date')
  assert.ok(L.validateScheduleForm(form({ start: '10:00', end: '10:00', endDate: '2026-11-04' })).end, 'zero length')
  assert.ok(L.validateScheduleForm(form({ endDate: '2026-11-03' })).end, 'an end date before the start date')
  assert.deepEqual(L.validateScheduleForm(form({ start: '23:00', end: '00:00', endDate: '2026-11-05' })), {}, 'ending exactly at midnight is a next-day 00:00')
  assert.ok(L.validateScheduleForm(form({ endDate: '2026-02-31' })).endDate, 'impossible end date')
  assert.ok(L.validateScheduleForm(form({ endDate: '2026-11-20' })).endDate, 'longer than 7 days is refused (typo guard)')
  assert.deepEqual(L.validateScheduleForm(form({ endDate: '2026-11-11', end: '10:00' })), {}, 'exactly 7 days is fine')
})
test('editing: an existing overnight event round-trips through the form unchanged (no silent data change)', () => {
  const e = ev('late', at(2026, 11, 4, 22), at(2026, 11, 5, 1, 30), { title: 'Late Night Study', category: 'study' })
  const f = L.eventToForm(e)
  assert.deepEqual([f.date, f.endDate, f.start, f.end], ['2026-11-04', '2026-11-05', '22:00', '01:30'])
  assert.deepEqual(L.validateScheduleForm(f), {})
  const back = L.formToEventFields(f); assert.equal(back.startAt, e.startAt); assert.equal(back.endAt, e.endAt)
  const mid = ev('m', at(2026, 11, 4, 23), at(2026, 11, 5, 0)); const g = L.eventToForm(mid)
  assert.deepEqual([g.endDate, g.end], ['2026-11-05', '00:00']); assert.equal(L.formToEventFields(g).endAt, mid.endAt)
})
test('editing the date moves the end date with it; a same-day event stays same-day', () => {
  const over = L.eventToForm(ev('x', at(2026, 11, 4, 22), at(2026, 11, 5, 1)))
  const moved = E.withDateChange(over, '2026-11-10'); assert.deepEqual([moved.date, moved.endDate], ['2026-11-10', '2026-11-11'])
  const same = E.withDateChange(form(), '2026-11-10'); assert.deepEqual([same.date, same.endDate], ['2026-11-10', '2026-11-10'])
  const span = E.withDateChange(form({ endDate: '2026-11-06' }), '2026-12-30'); assert.equal(span.endDate, '2027-01-01', 'a 2-day span crosses the year end')
})
test('Add/Duplicate: changing the start keeps the length — overnight events keep exact duration, same-day events are held at 23:59', () => {
  const over = form({ start: '22:00', end: '01:30', endDate: '2026-11-05' })
  const m = E.withStartChange(over, { start: '21:00' }); assert.deepEqual([m.start, m.end, m.endDate], ['21:00', '00:30', '2026-11-05'])
  const d = E.withStartChange(over, { date: '2026-11-09' }); assert.deepEqual([d.date, d.start, d.end, d.endDate], ['2026-11-09', '22:00', '01:30', '2026-11-10'])
  const same = E.withStartChange(form({ start: '09:00', end: '10:30' }), { start: '23:00' }); assert.deepEqual([same.end, same.endDate], ['23:59', '2026-11-04'], 'does not silently roll into tomorrow')
  const day = E.withStartChange(form({ start: '09:00', end: '10:30' }), { date: '2026-11-09' }); assert.equal(day.endDate, '2026-11-09')
  assert.equal(E.withStartChange(form(), { start: '' }).endDate, '2026-11-04')
})
test('conflicts across midnight: form, duplicate and move all see the overhang', () => {
  const night = ev('Night', at(2026, 11, 4, 22), at(2026, 11, 5, 1, 30))
  assert.match(E.formConflict(form({ date: '2026-11-05', endDate: '2026-11-05', start: '00:30', end: '01:00' }), [night]), /already have 'Night'/, 'next morning inside the overhang')
  assert.equal(E.formConflict(form({ date: '2026-11-05', endDate: '2026-11-05', start: '01:30', end: '02:00' }), [night]), null, 'starting exactly when it ends')
  assert.match(E.formConflict(form({ date: '2026-11-04', endDate: '2026-11-05', start: '23:00', end: '00:30' }), [night]), /Night/, 'a new overnight event overlapping another')
  assert.equal(E.formConflict(form({ date: '2026-11-04', endDate: '2026-11-04', start: '21:00', end: '22:00' }), [night]), null, 'ends exactly when it starts')
  // editing an overnight event never conflicts with itself, and an unchanged time is grandfathered
  const f = L.eventToForm(night)
  assert.equal(E.formConflict(f, [night], { excludeId: 'Night' }), null)
  assert.equal(E.formConflict(f, [night, ev('Other', at(2026, 11, 5, 0), at(2026, 11, 5, 1))], { excludeId: 'Night', original: { startAt: night.startAt, endAt: night.endAt } }), null)
  assert.match(E.formConflict({ ...f, end: '02:30' }, [night, ev('Other', at(2026, 11, 5, 2), at(2026, 11, 5, 3))], { excludeId: 'Night', original: { startAt: night.startAt, endAt: night.endAt } }), /Other/, 'extending into the next event')
})
test('duplicating an overnight event keeps its duration and its crossing; same-day copies stay on one day', () => {
  const night = ev('Night', at(2026, 11, 4, 22), at(2026, 11, 5, 1, 30), { title: 'Late Night Study' })
  const f = E.duplicateFormValues(night, [night])
  assert.equal(L.durationLabel(L.formToEventFields(f).startAt, L.formToEventFields(f).endAt), '3 hr 30 min')
  assert.equal(f.date, '2026-11-05', 'first free start at/after the original end'); assert.equal(f.start, '01:30'); assert.equal(f.end, '05:00'); assert.equal(f.endDate, '2026-11-05')
  assert.deepEqual(L.validateScheduleForm({ ...f, title: 'x' }), {})
  const busy = E.duplicateFormValues(night, [night, ev('b', at(2026, 11, 5, 1, 30), at(2026, 11, 5, 5, 30))]); assert.equal(busy.start, '05:30')
  const day = E.duplicateFormValues(ev('d', at(2026, 11, 4, 9), at(2026, 11, 4, 10, 30)), [])
  assert.deepEqual([day.date, day.endDate, day.start, day.end], ['2026-11-04', '2026-11-04', '10:30', '12:00'])
  const crossing = E.duplicateFormValues(ev('c', at(2026, 11, 4, 22), at(2026, 11, 5, 1)), [ev('c', at(2026, 11, 4, 22), at(2026, 11, 5, 1))])
  assert.ok(crossing.endDate >= crossing.date)
})
test('dragging an overnight event keeps its length, and it can be edited afterwards', () => {
  const night = ev('Night', at(2026, 11, 4, 22), at(2026, 11, 5, 1, 30))
  const p = E.planMove(night, new Date(2026, 10, 6), 21 * 60, [night])
  assert.equal(p.ok, true); assert.equal(p.endAt - p.startAt, 210 * 60_000)
  const f = L.eventToForm({ ...night, startAt: p.startAt, endAt: p.endAt })
  assert.deepEqual([f.date, f.endDate, f.start, f.end], ['2026-11-06', '2026-11-07', '21:00', '00:30']); assert.deepEqual(L.validateScheduleForm({ ...f, title: 'x' }), {})
})
test('DST (real America/Los_Angeles zone): overnight events keep exact elapsed time, round-trip losslessly, conflicts and moves stay exact', () => {
  const r = inLA(`
    const off = [new Date(2026,10,1,3).getTimezoneOffset(), new Date(2026,6,1).getTimezoneOffset()]
    const start = new Date(2026,9,31,23).getTime(), end = new Date(2026,10,1,3).getTime()   // autumn change: the 1 AM hour repeats
    const f = L.eventToForm(ev('dst', start, end)); const back = L.formToEventFields({ ...f, title: 'x' })
    const moved = E.withStartChange(f, { date: '2026-11-01' })
    const sp = new Date(2026,2,7,23).getTime(), spEnd = sp + 4*3600000                       // spring change: 2 AM doesn't exist
    const g = L.eventToForm(ev('s', sp, spEnd)); const gb = L.formToEventFields({ ...g, title: 'x' })
    const c1 = E.findConflicts({ startAt: new Date(2026,10,1,0,30).getTime(), endAt: new Date(2026,10,1,0,30).getTime() + 7200000 }, [ev('x', new Date(2026,10,1,0,30).getTime() + 7200000, new Date(2026,10,1,0,30).getTime() + 14400000)]).length
    const w = ev('w', new Date(2026,9,28,9).getTime(), new Date(2026,9,28,10,30).getTime())
    const p = E.planMove(w, new Date(2026,10,2), 14*60, [w])
    return { off, hours: (end-start)/3600000, form: [f.date,f.endDate,f.start,f.end], rt: [back.startAt===start, back.endAt===end], moved: [moved.start,moved.end,moved.endDate],
             spring: [g.endDate, g.end, gb.endAt===spEnd], nonexistent: [L.parseLocal('2026-03-08','02:30'), L.parseLocal('2026-03-08','03:30') !== null], c1,
             move: [p.endAt - p.startAt, new Date(p.startAt).getHours()], errNone: L.validateScheduleForm({ ...f, title: 'x' }) }`)
  assert.deepEqual(r.off, [480, 420].reverse().reverse(), 'the child really is in a DST zone (PST in Nov, PDT in Jul)')
  assert.equal(r.hours, 5, 'five real hours across the repeated 1 AM'); assert.deepEqual(r.form, ['2026-10-31', '2026-11-01', '23:00', '03:00']); assert.deepEqual(r.rt, [true, true])
  assert.deepEqual(r.moved, ['23:00', '04:00', '2026-11-02'], 'moved to an ordinary night: the exact 5 real hours are kept, so it ends at 04:00')
  assert.deepEqual(r.spring, ['2026-03-08', '04:00', true], 'across the spring change 23:00 + 4 real hours = 04:00'); assert.equal(r.nonexistent[0], null, 'a time that does not exist is refused, not silently shifted'); assert.equal(r.nonexistent[1], true)
  assert.equal(r.c1, 0, 'back-to-back across the repeated hour is not a conflict'); assert.deepEqual(r.move, [90 * 60000, 14], 'drag keeps exactly 90 minutes and lands on the requested wall-clock time')
  assert.deepEqual(r.errNone, {})
})
test('date boundaries: month- and year-end overnight events', () => {
  const nye = ev('nye', at(2026, 12, 31, 22), at(2027, 1, 1, 2)); const f = L.eventToForm(nye)
  assert.deepEqual([f.date, f.endDate], ['2026-12-31', '2027-01-01']); assert.deepEqual(L.validateScheduleForm({ ...f, title: 'x' }), {})
  assert.equal(L.daySlice(nye, new Date(2027, 0, 1)).endMin, 120); assert.equal(L.daySlice(nye, new Date(2026, 11, 31)).endMin, 1440)
  const leap = L.eventToForm(ev('l', at(2028, 2, 28, 23), at(2028, 2, 29, 1))); assert.equal(leap.endDate, '2028-02-29')
})

// ── Task 2: 12/24-hour time entry ───────────────────────────────────────────
test('formatTimeValue shows the stored 24-hour value in the chosen format without changing it', () => {
  assert.deepEqual(['00:00', '00:05', '09:30', '12:00', '12:45', '13:00', '23:59'].map(t => L.formatTimeValue(t, '12h')), ['12:00 AM', '12:05 AM', '9:30 AM', '12:00 PM', '12:45 PM', '1:00 PM', '11:59 PM'])
  assert.deepEqual(['00:00', '09:30', '13:00', '23:59'].map(t => L.formatTimeValue(t, '24h')), ['00:00', '09:30', '13:00', '23:59'])
  for (const bad of ['', '9:30', '24:00', '12:60', 'abc']) assert.equal(L.formatTimeValue(bad), '', bad)
  for (const t of L.timeOptions(1)) { assert.equal(L.parseTimeText(L.formatTimeValue(t, '12h')), t); assert.equal(L.parseTimeText(L.formatTimeValue(t, '24h')), t) }   // all 1,440 minutes round-trip in both formats
})
test('parseTimeText accepts the ways people type times, and nothing ambiguous or impossible', () => {
  const ok = { '2:30 pm': '14:30', '2:30PM': '14:30', '2pm': '14:00', '2 p.m.': '14:00', '12am': '00:00', '12:15 am': '00:15', '12pm': '12:00', '12:00 PM': '12:00', '11:59 pm': '23:59', '14:30': '14:30', '1430': '14:30', '930': '09:30', '9': '09:00', '09:05': '09:05', '0': '00:00', '23': '23:00', ' 7:05 a ': '07:05', '1:5 am': null }
  for (const [t, v] of Object.entries(ok)) assert.equal(L.parseTimeText(t), v, t)
  for (const bad of ['', '  ', '24:00', '25', '13pm', '0am', '12:60', '9:75', 'noon', '2:30 xm', '1:2:3', '-1']) assert.equal(L.parseTimeText(bad), null, bad)
  assert.equal(L.timeOptions(15).length, 96); assert.equal(L.timeOptions(15)[95], '23:45'); assert.equal(L.timeOptions(60).length, 24)
})
test('every time label the schedule shows takes the format: hours, clocks, ranges (default stays 12-hour)', () => {
  const t = at(2026, 11, 4, 15, 45)
  assert.equal(L.clockLabel(t), '3:45 PM'); assert.equal(L.clockLabel(t, '24h'), '15:45'); assert.equal(L.timeRangeLabel(t, t + 3600000, '24h'), '15:45 – 16:45')
  assert.equal(L.hourLabel(15), '3 PM'); assert.equal(L.hourLabel(15, '24h'), '15:00')
  assert.match(E.conflictMessage([ev('A', at(2026, 11, 4, 15), at(2026, 11, 4, 16))], t, '24h'), /from 15:00 to 16:00/)
})
// ── Tasks 3–8: phone-only toolbar (structure) ───────────────────────────────
const V = () => read('components/xpadite/MyScheduleView.tsx'), MB = () => read('components/xpadite/ScheduleMobile.tsx'), M = () => read('components/xpadite/MeetingsModal.tsx'), MENU = () => read('components/xpadite/ScheduleMenu.tsx')
test('week range short label: compact, respects Sunday/Monday start, handles month and year boundaries', () => {
  assert.equal(L.weekRangeShort(new Date(2026, 10, 4)), 'Nov 1–7'); assert.equal(L.weekRangeShort(new Date(2026, 10, 4), 1), 'Nov 2–8')
  assert.equal(L.weekRangeShort(new Date(2026, 10, 30)), 'Nov 29–Dec 5'); assert.equal(L.weekRangeShort(new Date(2026, 11, 30)), 'Dec 27–Jan 2'); assert.equal(L.weekRangeShort(new Date(2026, 9, 30)), 'Oct 25–31')
})
test('filter state helpers: active detection, consistent choices, reset', () => {
  assert.equal(E.isFilterActive(E.NO_FILTER), false); assert.equal(E.isFilterActive({ filter: 'google', hidden: [] }), true); assert.equal(E.isFilterActive({ filter: 'all', hidden: ['study'] }), true)
  assert.deepEqual(E.selectFilter({ filter: 'all', hidden: ['study', 'other'] }, 'study'), { filter: 'study', hidden: ['other'] }, 'choosing a hidden category switches it back on')
  assert.deepEqual(E.selectFilter({ filter: 'study', hidden: [] }, 'google'), { filter: 'google', hidden: [] })
  assert.deepEqual(E.toggleHiddenCategory({ filter: 'study', hidden: [] }, 'study'), { filter: 'all', hidden: ['study'] }, 'hiding the chosen category resets the choice to All')
  assert.deepEqual(E.toggleHiddenCategory({ filter: 'study', hidden: [] }, 'other'), { filter: 'study', hidden: ['other'] })
  assert.deepEqual(E.toggleHiddenCategory({ filter: 'all', hidden: ['other'] }, 'other'), { filter: 'all', hidden: [] })
  // semantics are unchanged: filter + hidden + query combine
  const cats = L.SCHEDULE_CATEGORIES
  const list = [ev('Gym', 1, 2, { category: 'other' }), ev('Study', 1, 2, { category: 'study' }), ev('g', 1, 2, { category: 'meeting', source: 'google' })]
  const run = (st, q = '') => L.filterScheduleEvents(list, { query: q, ...L.splitFilter(st.filter), hidden: st.hidden, categories: cats }).map(e => e.id)
  assert.deepEqual(run(E.NO_FILTER), ['Gym', 'Study', 'g']); assert.deepEqual(run({ filter: 'google', hidden: [] }), ['g']); assert.deepEqual(run({ filter: 'all', hidden: ['other'] }), ['Study', 'g'])
  assert.deepEqual(run({ filter: 'all', hidden: ['other'] }, 'stu'), ['Study'], 'search + filter together'); assert.deepEqual(run(E.NO_FILTER, 'stu'), ['Study'], 'clearing the filter keeps the search')
})
test('row 1 stays one line down to 320px (tighter padding below 361px)', () => {
  const m = M(); assert.ok(/px-2 min-\[361px\]:px-2\.5 sm:px-3/.test(m) && /px-2\.5 min-\[361px\]:px-\[13px\]/.test(m))
})
test('desktop/tablet regression guard: existing toolbar, sidebar, drag, slot and sizing code is still present and unchanged', () => {
  const v = V(), m = M()
  assert.ok(/<aside className="hidden lg:flex flex-col gap-3 w-\[296px\]/.test(v) && /<EventSheet/.test(v) && /lg:hidden absolute inset-0/.test(read('components/xpadite/ScheduleParts.tsx')))
  assert.ok(/LONG_PRESS_MS = 450/.test(v) && /isDoubleTap\(lastTapRef\.current/.test(v) && /planMove\(s\.ev, dys\[idx\], raw, evs, f\)/.test(v))
  assert.ok(/fixed inset-0 z-\[70\]/.test(m) && /sm:max-w-\[640px\] md:max-w-\[900px\] lg:max-w-\[1296px\]/.test(m) && /env\(safe-area-inset-top/.test(m))
  assert.ok(!/useIsPhone\(\)[\s\S]{0,40}lg:/.test(v), 'phone detection does not leak into the lg layout')
})
test('still frontend-only: nothing in the new files persists or fetches', () => {
  for (const f of ['ScheduleMobile.tsx', 'scheduleLogic.ts', 'scheduleEngine.ts', 'ScheduleParts.tsx', 'MyScheduleView.tsx']) {
    const code = read(`components/xpadite/${f}`).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    assert.ok(!/supabase|fetch\(|localStorage|sessionStorage|indexedDB|XMLHttpRequest/i.test(code), f)
  }
})
